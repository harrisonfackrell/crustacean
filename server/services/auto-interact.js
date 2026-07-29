const { getDatabase } = require('../db');
const { getLLMService } = require('../services/llm');
const { updateRelationship } = require('../utils/relationships');
const { calculateHotness } = require('../utils/hotness');

/**
 * Auto-Interact Service
 *
 * Models Crustacean as a tree: Communities → Posts → Comments (nested).
 * Each Avatar "browses" by performing a random walk through this tree,
 * governed by probabilistic transition rules. During a browsing session,
 * the Avatar votes on everything it sees and may choose to comment based
 * on its personality settings (vote_chance, reply_chance).
 *
 * The service runs continuously via a tight event-loop (no intervals) when
 * started, processing Avatars in round-robin order until stopped.
 */

class AutoInteractService {
  constructor() {
    this.db = null;
    this.llm = null;
    this.running = false;
    this.abortFlag = false;
    // Track which avatars have already acted on which nodes this cycle
    // to prevent duplicate actions within a single processAvatar call
    this.actionLog = new Map(); // avatarId -> Set of "type:id" strings
  }

  getDb() {
    if (!this.db) this.db = getDatabase();
    return this.db;
  }

  getLLM() {
    if (!this.llm) this.llm = getLLMService();
    return this.llm;
  }

  /**
   * Start the auto-interact loop.
   * Processes enabled avatars in round-robin fashion until stop() is called.
   */
  start() {
    if (this.running) return;
    this.running = true;
    this.abortFlag = false;
    console.log('[AutoInteract] Started');
    this._runLoop();
  }

  /**
   * Stop the auto-interact loop.
   */
  stop() {
    console.log('[AutoInteract] Stopping...');
    this.running = false;
    this.abortFlag = true;
  }

  /**
   * The main event-loop. Drives processing via setImmediate so it yields
   * to the event loop between each avatar, avoiding blocking.
   */
  _runLoop() {
    if (!this.running || this.abortFlag) {
      console.log('[AutoInteract] Stopped');
      this.running = false;
      return;
    }

    let db;
    try {
      db = this.getDb();
    } catch (err) {
      console.error('[AutoInteract] Failed to get database:', err.message);
      setImmediate(() => this._runLoop());
      return;
    }

    const avatars = db.all(
      'SELECT * FROM Avatars WHERE is_auto_enabled = 1'
    );

    if (avatars.length === 0) {
      // No avatars to process — keep the loop alive but yield
      setImmediate(() => this._runLoop());
      return;
    }

    const communities = db.all('SELECT * FROM Communities');
    if (communities.length === 0) {
      setImmediate(() => this._runLoop());
      return;
    }

    const globalRules = db.all('SELECT rule FROM GlobalRules').map(r => r.rule);

    // Pick a random avatar to process this iteration
    const avatar = avatars[Math.floor(Math.random() * avatars.length)];

    this.actionLog.clear();

    this.processAvatar(avatar, communities, globalRules)
      .then(() => {
        setImmediate(() => this._runLoop());
      })
      .catch((err) => {
        console.error('[AutoInteract] Error processing avatar:', err.message, err.stack);
        // Ensure the loop keeps going even on errors
        setImmediate(() => this._runLoop());
      });
  }

  /**
   * Process a single avatar's browsing session.
   * The avatar walks the tree: picks a community, may create a post,
   * browses existing posts, votes on everything, and may comment.
   */
  async processAvatar(avatar, communities = null, globalRules = null) {
    const db = this.getDb();
    const llm = this.getLLM();

    if (!communities) {
      communities = db.all('SELECT * FROM Communities');
    }
    if (!globalRules) {
      globalRules = db.all('SELECT rule FROM GlobalRules').map(r => r.rule);
    }

    // Ensure community preferences exist for all communities
    for (const community of communities) {
      const pref = db.get(
        'SELECT * FROM AvatarCommunityPreferences WHERE avatar_id = ? AND community_id = ?',
        [avatar.id, community.id]
      );
      if (!pref) {
        // Generate preference score via LLM
        try {
          const score = await llm.generateCommunityPreference(avatar, community);
          db.run(
            'INSERT INTO AvatarCommunityPreferences (avatar_id, community_id, score) VALUES (?, ?, ?)',
            [avatar.id, community.id, score]
          );
        } catch {
          db.run(
            'INSERT INTO AvatarCommunityPreferences (avatar_id, community_id, score) VALUES (?, ?, ?)',
            [avatar.id, community.id, 0]
          );
        }
      }
    }

    // Choose a community weighted by preference score
    const community = this._weightedCommunitySelect(avatar, communities);
    if (!community) return;

    // --- Phase 0: Maybe create a new post in this community ---
    // ~25% chance the avatar creates a new post instead of just browsing
    if (Math.random() < 0.25) {
      await this._maybeCreatePost(llm, avatar, community, globalRules);
    }

    // Get posts in this community, sorted by hotness
    const posts = this._getPostsByHotness(community.id);
    if (posts.length === 0) return;

    // Browsing session: walk through posts
    // The avatar visits a number of posts (1 to min(3, posts.length))
    const postsToVisit = Math.min(3, posts.length);
    const visitedPosts = new Set();

    for (let visit = 0; visit < postsToVisit && !this.abortFlag; visit++) {
      // Choose a post — weighted toward hotness but with exploration
      const post = this._weightedPostSelect(posts, visitedPosts);
      if (!post) break;
      visitedPosts.add(post.id);

      // Load full comment tree for this post
      const commentTree = this._buildCommentTree(post.id);

      // Build context from what the avatar has seen this session
      const context = this._buildSessionContext(avatar, visitedPosts, community);

      // --- Phase 1: Vote on the post ---
      await this._voteOnPost(llm, avatar, post, community, globalRules, context);

      // --- Phase 2: Process all comments (vote on each, recursively) ---
      for (const comment of commentTree) {
        if (this.abortFlag) break;
        await this._processCommentNode(llm, avatar, comment, post, community, globalRules, context);
      }

      // --- Phase 3: Decide whether to comment on the post (skip own posts) ---
      if (post.avatar_id !== avatar.id && Math.random() < avatar.reply_chance) {
        await this._maybeCommentOnPost(llm, avatar, post, community, globalRules, context);
      }

      // --- Phase 4: Decide whether to reply to any comment in the tree (skip own comments) ---
      if (Math.random() < avatar.reply_chance) {
        const allComments = this._flattenCommentTree(commentTree);
        const targetComment = this._selectCommentForReply(allComments, avatar, post.id);
        if (targetComment) {
          await this._maybeCommentOnComment(llm, avatar, targetComment, post, community, globalRules, context);
        }
      }

      // --- Phase 5: Decide whether to continue browsing or switch ---
      // ~30% chance to stop browsing this community
      if (Math.random() < 0.3) break;
    }
  }

  // ============================================================
  // Weighted Selection Helpers
  // ============================================================

  /**
   * Select a community weighted by the avatar's preference score.
   * Uses softmax-like weighting: exp(score / temperature) for each community.
   */
  _weightedCommunitySelect(avatar, communities) {
    const db = this.getDb();
    const temperature = 2; // Controls exploration vs exploitation

    const weights = communities.map(c => {
      const pref = db.get(
        'SELECT score FROM AvatarCommunityPreferences WHERE avatar_id = ? AND community_id = ?',
        [avatar.id, c.id]
      );
      const score = pref ? pref.score : 0;
      return { community: c, weight: Math.exp(score / temperature) };
    });

    const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
    let r = Math.random() * totalWeight;

    for (const w of weights) {
      r -= w.weight;
      if (r <= 0) return w.community;
    }
    return weights[weights.length - 1].community;
  }

  /**
   * Select a post weighted by hotness, with some randomness for exploration.
   * Skips posts the avatar has already visited this session.
   */
  _weightedPostSelect(posts, visitedPosts) {
    const available = posts.filter(p => !visitedPosts.has(p.id));
    if (available.length === 0) return null;

    // Hotness-weighted selection with temperature.
    // Posts with zero or very few interactions get a baseline weight
    // so new posts are always discoverable even in established communities.
    const temperature = 1.5;
    const freshPostBoost = 2.0; // minimum weight for posts with low engagement
    const weights = available.map(p => {
      const hotnessWeight = Math.exp((p.hotness || 0) / temperature);
      // Give posts with no/low engagement a guaranteed floor
      const engagement = (p.upvotes || 0) + (p.commentCount || 0);
      const weight = engagement < 3 ? Math.max(hotnessWeight, freshPostBoost) : hotnessWeight;
      return { post: p, weight };
    });

    const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
    let r = Math.random() * totalWeight;

    for (const w of weights) {
      r -= w.weight;
      if (r <= 0) return w.post;
    }
    return weights[weights.length - 1].post;
  }

  /**
   * Select a comment to potentially reply to, preferring comments with
   * high engagement and comments the avatar has a positive relationship with.
   * Works with a flat list of all comments (any depth) from _flattenCommentTree.
   */
  _selectCommentForReply(comments, avatar, postId) {
    if (comments.length === 0) return null;
    const db = this.getDb();

    // Filter out: own comments, already-replied-to comments
    const available = comments.filter(c => {
      // Skip own comments
      if (c.avatar_id === avatar.id) return false;
      // Skip if already replied to this comment
      const alreadyReplied = db.get(
        'SELECT id FROM Comments WHERE avatar_id = ? AND post_id = ? AND parent_comment_id = ?',
        [avatar.id, postId, c.id]
      );
      return !alreadyReplied;
    });

    if (available.length === 0) return null;

    // Weight by: relationship with author + comment score
    const weights = available.map(c => {
      const rel = db.get(
        'SELECT score FROM AvatarRelationships WHERE actor_id = ? AND target_id = ?',
        [avatar.id, c.avatar_id]
      );
      const relScore = rel ? rel.score : 0;
      // Prefer replying to people we like and to higher-scoring comments
      const weight = Math.max(0, relScore) * 0.4 + (c.score || 0) * 0.3 + 1;
      return { comment: c, weight };
    });

    const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
    let r = Math.random() * totalWeight;

    for (const w of weights) {
      r -= w.weight;
      if (r <= 0) return w.comment;
    }
    return weights[weights.length - 1].comment;
  }

  // ============================================================
  // Data Loading Helpers
  // ============================================================

  /**
   * Get posts in a community sorted by hotness.
   */
  _getPostsByHotness(communityId) {
    const db = this.getDb();
    const posts = db.all(
      'SELECT * FROM Posts WHERE community_id = ? ORDER BY created_at DESC',
      [communityId]
    ).map(post => {
      const upvotes = this._getVoteCount('post', post.id, 1);
      const downvotes = this._getVoteCount('post', post.id, -1);
      const commentCount = this._getCommentCount(post.id);
      return {
        ...post,
        upvotes,
        downvotes,
        commentCount,
        hotness: calculateHotness(upvotes, downvotes, commentCount, post.created_at)
      };
    });

    return posts.sort((a, b) => b.hotness - a.hotness);
  }

  /**
   * Build the top-level comment tree for a post.
   * Returns flat array of top-level comments, each with nested replies.
   */
  _buildCommentTree(postId) {
    const db = this.getDb();
    const comments = db.all(
      'SELECT * FROM Comments WHERE post_id = ? ORDER BY created_at ASC',
      [postId]
    );

    const map = {};
    const topLevel = [];

    comments.forEach(c => {
      const upvotes = this._getVoteCount('comment', c.id, 1);
      const downvotes = this._getVoteCount('comment', c.id, -1);
      const enriched = {
        ...c,
        upvotes,
        downvotes,
        score: upvotes - downvotes,
        avatar: db.get('SELECT id, name, handle, public_bio FROM Avatars WHERE id = ?', [c.avatar_id]),
        replies: []
      };
      map[c.id] = enriched;
    });

    comments.forEach(c => {
      const node = map[c.id];
      if (c.parent_comment_id && map[c.parent_comment_id]) {
        map[c.parent_comment_id].replies.push(node);
      } else {
        topLevel.push(node);
      }
    });

    return topLevel;
  }

  // ============================================================
  // Context Building
  // ============================================================

  /**
   * Build context string from the avatar's browsing session.
   * Includes the content of posts and comments the avatar has seen.
   * This gives the LLM a realistic "what this user has been reading" context.
   */
  _buildSessionContext(avatar, visitedPostIds, community) {
    const db = this.getDb();
    let context = `You are browsing r/${community.name}.\n`;
    context += `Community description: ${community.description || 'No description.'}\n`;

    for (const postId of visitedPostIds) {
      const post = db.get('SELECT * FROM Posts WHERE id = ?', [postId]);
      if (!post) continue;

      const postAvatar = db.get('SELECT name, handle FROM Avatars WHERE id = ?', [post.avatar_id]);
      context += `\n--- Post by ${postAvatar?.name} (@${postAvatar?.handle}) ---\n`;
      if (post.title) context += `Title: ${post.title}\n`;
      context += `Content: ${post.content}\n`;

      // Include top-level comments as context
      const comments = db.all(
        'SELECT c.*, a.name, a.handle FROM Comments c JOIN Avatars a ON c.avatar_id = a.id WHERE c.post_id = ? AND c.parent_comment_id IS NULL ORDER BY c.created_at ASC',
        [postId]
      ).slice(0, 5); // Limit to 5 top-level comments to keep context manageable

      if (comments.length > 0) {
        context += `Comments:\n`;
        for (const c of comments) {
          context += `  - ${c.name} (@${c.handle}): ${c.content}\n`;
        }
      }
    }

    return context;
  }

  // ============================================================
  // Action Methods
  // ============================================================

  /**
   * Vote on a post. Always votes on everything the avatar sees.
   */
  async _voteOnPost(llm, avatar, post, community, globalRules, context) {
    const db = this.getDb();
    const actionKey = `post:${post.id}`;

    if (this.actionLog.has(avatar.id) && this.actionLog.get(avatar.id).has(actionKey)) {
      return; // Already voted this session
    }

    // Check if already voted
    const existing = db.get(
      'SELECT * FROM Votes WHERE avatar_id = ? AND target_type = ? AND target_id = ?',
      [avatar.id, 'post', post.id]
    );
    if (existing) return;

    // Only vote if avatar's vote_chance allows it
    if (Math.random() >= avatar.vote_chance) return;

    try {
      const text = post.title ? `${post.title}\n${post.content}` : post.content;
      const voteValue = await llm.generateVote(avatar, text);

      db.run(
        'INSERT INTO Votes (avatar_id, target_type, target_id, vote_value) VALUES (?, ?, ?, ?)',
        [avatar.id, 'post', post.id, voteValue]
      );

      // Update relationship with post author
      updateRelationship(db, avatar.id, post.avatar_id, voteValue);

      this._logAction(avatar.id, actionKey);
    } catch (err) {
      console.error(`[AutoInteract] Vote on post ${post.id} failed:`, err.message);
    }
  }

  /**
   * Recursively process a comment node: vote on it, then process its replies.
   */
  async _processCommentNode(llm, avatar, comment, post, community, globalRules, context) {
    const db = this.getDb();
    const actionKey = `comment:${comment.id}`;

    if (this.actionLog.has(avatar.id) && this.actionLog.get(avatar.id).has(actionKey)) {
      // Still process children even if we already acted on this node
      for (const reply of comment.replies || []) {
        await this._processCommentNode(llm, avatar, reply, post, community, globalRules, context);
      }
      return;
    }

    // Vote on this comment
    const existingVote = db.get(
      'SELECT * FROM Votes WHERE avatar_id = ? AND target_type = ? AND target_id = ?',
      [avatar.id, 'comment', comment.id]
    );

    if (!existingVote && Math.random() < avatar.vote_chance) {
      try {
        const voteValue = await llm.generateVote(avatar, comment.content);
        db.run(
          'INSERT INTO Votes (avatar_id, target_type, target_id, vote_value) VALUES (?, ?, ?, ?)',
          [avatar.id, 'comment', comment.id, voteValue]
        );
        updateRelationship(db, avatar.id, comment.avatar_id, voteValue);
        this._logAction(avatar.id, actionKey);
      } catch (err) {
        console.error(`[AutoInteract] Vote on comment ${comment.id} failed:`, err.message);
      }
    }

    // Process replies
    for (const reply of comment.replies || []) {
      await this._processCommentNode(llm, avatar, reply, post, community, globalRules, context);
    }
  }

  /**
   * Maybe create a new post in a community.
   */
  async _maybeCreatePost(llm, avatar, community, globalRules) {
    const db = this.getDb();

    try {
      const result = await llm.generateContent(
        'post',
        avatar,
        null,
        community,
        globalRules,
        `You are in the community r/${community.name}.`,
        '',
        '',
        avatar.auto_interval || 3
      );

      // result is { title, content } from generateContent for posts
      const title = result.title || '';
      const content = result.content || result;

      db.run(
        'INSERT INTO Posts (community_id, avatar_id, title, content) VALUES (?, ?, ?, ?)',
        [community.id, avatar.id, title, content]
      );

      this._logAction(avatar.id, `create_post:${community.id}`);
    } catch (err) {
      console.error(`[AutoInteract] Create post in community ${community.id} failed:`, err.message);
    }
  }

  /**
   * Maybe comment on a post (top-level comment).
   */
  async _maybeCommentOnPost(llm, avatar, post, community, globalRules, context) {
    const db = this.getDb();
    const actionKey = `comment_on_post:${post.id}`;

    if (this.actionLog.has(avatar.id) && this.actionLog.get(avatar.id).has(actionKey)) {
      return;
    }

    // Skip own posts
    if (post.avatar_id === avatar.id) return;

    // Check if already commented on this post
    const existing = db.get(
      'SELECT id FROM Comments WHERE avatar_id = ? AND post_id = ? AND parent_comment_id IS NULL',
      [avatar.id, post.id]
    );
    if (existing) return;

    try {
      const targetAvatar = db.get('SELECT * FROM Avatars WHERE id = ?', [post.avatar_id]);
      const content = await llm.generateContent(
        'comment',
        avatar,
        targetAvatar,
        community,
        globalRules,
        context,
        '',
        '',
        avatar.auto_interval || 3
      );

      db.run(
        'INSERT INTO Comments (post_id, parent_comment_id, avatar_id, content) VALUES (?, ?, ?, ?)',
        [post.id, null, avatar.id, content]
      );

      this._logAction(avatar.id, actionKey);
    } catch (err) {
      if (err.message.includes('Avatar has already replied')) {
        return; // Already commented
      }
      console.error(`[AutoInteract] Comment on post ${post.id} failed:`, err.message);
    }
  }

  /**
   * Maybe comment on a specific comment (reply).
   */
  async _maybeCommentOnComment(llm, avatar, comment, post, community, globalRules, context) {
    const db = this.getDb();
    const actionKey = `reply_to_comment:${comment.id}`;

    if (this.actionLog.has(avatar.id) && this.actionLog.get(avatar.id).has(actionKey)) {
      return;
    }

    // Skip own comments
    if (comment.avatar_id === avatar.id) return;

    // Check if already replied to this comment
    const existing = db.get(
      'SELECT id FROM Comments WHERE avatar_id = ? AND post_id = ? AND parent_comment_id = ?',
      [avatar.id, post.id, comment.id]
    );
    if (existing) return;

    try {
      const targetAvatar = db.get('SELECT * FROM Avatars WHERE id = ?', [comment.avatar_id]);
      const content = await llm.generateContent(
        'comment',
        avatar,
        targetAvatar,
        community,
        globalRules,
        context,
        '',
        '',
        avatar.auto_interval || 3
      );

      db.run(
        'INSERT INTO Comments (post_id, parent_comment_id, avatar_id, content) VALUES (?, ?, ?, ?)',
        [post.id, comment.id, avatar.id, content]
      );

      this._logAction(avatar.id, actionKey);
    } catch (err) {
      if (err.message.includes('Avatar has already replied')) {
        return; // Already replied
      }
      console.error(`[AutoInteract] Reply to comment ${comment.id} failed:`, err.message);
    }
  }

  // ============================================================
  // Utility Methods
  // ============================================================

  /**
   * Get vote count for a target.
   */
  _getVoteCount(targetType, targetId, voteValue) {
    const db = this.getDb();
    const result = db.get(
      'SELECT COUNT(*) as count FROM Votes WHERE target_type = ? AND target_id = ? AND vote_value = ?',
      [targetType, targetId, voteValue]
    );
    return result?.count || 0;
  }

  /**
   * Get comment count for a post.
   */
  _getCommentCount(postId) {
    const db = this.getDb();
    const result = db.get(
      'SELECT COUNT(*) as count FROM Comments WHERE post_id = ?',
      [postId]
    );
    return result?.count || 0;
  }

  /**
   * Flatten a nested comment tree into a flat array of all comments.
   * Each comment retains its depth and score for weighted selection.
   */
  _flattenCommentTree(tree, depth = 0) {
    const flat = [];
    for (const node of tree) {
      flat.push({ ...node, depth });
      if (node.replies && node.replies.length > 0) {
        flat.push(...this._flattenCommentTree(node.replies, depth + 1));
      }
    }
    return flat;
  }

  /**
   * Log an action for this avatar to prevent duplicates within a session.
   */
  _logAction(avatarId, actionKey) {
    if (!this.actionLog.has(avatarId)) {
      this.actionLog.set(avatarId, new Set());
    }
    this.actionLog.get(avatarId).add(actionKey);
  }
}

let instance = null;

function getAutoInteractService() {
  if (!instance) {
    instance = new AutoInteractService();
  }
  return instance;
}

module.exports = { getAutoInteractService, AutoInteractService };
