const { getDatabase } = require('../db');
const { getLLMService } = require('./llm');
const { updateRelationship } = require('../utils/relationships');
const { calculateHotness } = require('../utils/hotness');

class AutoInteractService {
  constructor() {
    this.db = getDatabase();
    this.llm = getLLMService();
    this.isRunning = false;
    this.timer = null;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.runCycle();
  }

  stop() {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async runCycle() {
    if (!this.isRunning) return;

    const autoEnabled = this.db.get('SELECT value FROM Settings WHERE key = ?', ['auto_interact_enabled']);
    if (autoEnabled?.value !== 'true') {
      this.scheduleNextCycle();
      return;
    }

    const avatars = this.db.all(
      'SELECT * FROM Avatars WHERE is_auto_enabled = 1 ORDER BY auto_interval ASC'
    );

    for (const avatar of avatars) {
      if (!this.isRunning) break;

      try {
        await this.processAvatar(avatar);
      } catch (error) {
        console.error(`Auto-interact error for avatar ${avatar.name}:`, error.message, error.stack);
      }
    }

    this.scheduleNextCycle();
  }

  scheduleNextCycle() {
    if (!this.isRunning) return;
    // Find the minimum interval among enabled avatars
    const minInterval = this.db.get(
      'SELECT MIN(auto_interval) as min_interval FROM Avatars WHERE is_auto_enabled = 1'
    );
    const intervalMs = (minInterval?.min_interval || 5) * 60 * 1000;
    this.timer = setTimeout(() => this.runCycle(), intervalMs);
  }

  async processAvatar(avatar) {
    // Step 1: Select a Community
    const community = await this.selectCommunity(avatar);
    if (!community) return;

    const globalRules = this.db.all('SELECT rule FROM GlobalRules');

    // Step 2: Determine how many interactions this avatar should do this cycle
    const maxInteractions = this.getInteractionsPerCycle(avatar);
    for (let i = 0; i < maxInteractions; i++) {
      if (!this.isRunning) break;
      const currentHotPosts = this.getHotPosts(community.id, 20);
      const shouldPostOriginal = this.decideAction(avatar, currentHotPosts);

      if (shouldPostOriginal) {
        // Create an original post
        await this.createOriginalPost(avatar, community, globalRules);
      } else {
        // Interact with existing content
        await this.interactWithExisting(avatar, community, currentHotPosts, globalRules);
      }
    }
  }

  async selectCommunity(avatar) {
    const communities = this.db.all('SELECT * FROM Communities');
    if (communities.length === 0) return null;

    // Get or create preferences for each community
    const preferences = [];
    for (const community of communities) {
      let pref = this.db.get(
        'SELECT score FROM AvatarCommunityPreferences WHERE avatar_id = ? AND community_id = ?',
        [avatar.id, community.id]
      );

      if (!pref) {
        // First time - evaluate via LLM
        try {
          const score = await this.llm.generateCommunityPreference(avatar, community);
          this.db.run(
            'INSERT INTO AvatarCommunityPreferences (avatar_id, community_id, score) VALUES (?, ?, ?)',
            [avatar.id, community.id, score]
          );
          pref = { score };
        } catch (error) {
          console.error(`Failed to generate community preference for ${avatar.name}:`, error.message);
          pref = { score: 0 };
        }
      }

      preferences.push({ community, score: pref.score });
    }

    // Weighted selection by |score| + epsilon
    const epsilon = 0.1;
    const weights = preferences.map(p => Math.abs(p.score) + epsilon);
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    let random = Math.random() * totalWeight;
    for (let i = 0; i < preferences.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        return preferences[i].community;
      }
    }

    return preferences[preferences.length - 1].community;
  }

  getInteractionsPerCycle(avatar) {
    // Each avatar does 2-5 interactions per cycle based on their settings
    let base = 2 + Math.floor(Math.random() * 3); // 2-4
    // Higher reply_chance and vote_chance avatars tend to do more
    if (Math.random() < avatar.reply_chance * 0.5) base++;
    if (Math.random() < avatar.vote_chance * 0.3) base++;
    return Math.min(base, 6); // Cap at 6
  }

  decideAction(avatar, hotPosts) {
    // Probability of posting an original uses the complement of the same decay
    // function used for comment depth selection: P(original) = exp(-decay * postCount)
    // With decay = 0.3: ~100% when empty, ~37% at 3 posts, ~5% at 10, ~1.1% at 15
    const postCount = hotPosts.length;
    const decay = 0.3;
    const probability = Math.exp(-decay * postCount);
    return Math.random() < probability;
  }

  async createOriginalPost(avatar, community, globalRules) {
    const context = this.buildContextForPost(avatar, community, null);

    try {
      const length = this.getRandomLength();
      const result = await this.llm.generateContent('post', avatar, null, community, globalRules, context, '', '', length);

      // LLM returns { title, content } when no title is provided
      const title = (typeof result === 'object' && result.title) ? result.title : '';
      const content = (typeof result === 'object' && result.content) ? result.content : result;

      this.db.run(
        'INSERT INTO Posts (community_id, avatar_id, title, content) VALUES (?, ?, ?, ?)',
        [community.id, avatar.id, title, content]
      );

      console.log(`Avatar ${avatar.name} created a post in ${community.name}`);
    } catch (error) {
      console.error(`Failed to create post for ${avatar.name}:`, error.message);
    }
  }

  async interactWithExisting(avatar, community, hotPosts, globalRules) {
    if (hotPosts.length === 0) return false;

    // Select a post to interact with
    const selectedPost = this.selectPost(avatar, hotPosts);
    if (!selectedPost) return false;

    const postAvatar = this.db.get('SELECT * FROM Avatars WHERE id = ?', [selectedPost.avatar_id]);

    // Always vote on the post
    const shouldVote = Math.random() < Math.max(avatar.vote_chance, 0.8);
    // Very high chance to comment/reply
    const shouldReply = Math.random() < Math.max(avatar.reply_chance, 0.9);

    if (shouldVote) {
      await this.voteOnContent(avatar, 'post', selectedPost.id, selectedPost.content);
    }

    if (shouldReply) {
      // Recursively select the best reply target, starting from the post.
      // At each level, the probability of going deeper increases with child count.
      const target = await this.selectReplyTarget(avatar, selectedPost, 'post', postAvatar, community, globalRules);
      if (target) {
        await this.executeReply(avatar, target, community, globalRules);
      }
    }

    // Vote on some comments in this post
    const voteComments = this.getHotComments(selectedPost.id, 20);
    if (voteComments.length > 0 && Math.random() < 0.7) {
      const commentsToVote = Math.min(voteComments.length, Math.floor(Math.random() * 3) + 1);
      const shuffled = [...voteComments].sort(() => Math.random() - 0.5);
      for (let j = 0; j < commentsToVote; j++) {
        const comment = shuffled[j];
        await this.voteOnContent(avatar, 'comment', comment.id, comment.content);
      }
    }

    return true;
  }

  /**
   * Recursively select a reply target in the comment tree.
   * At each level, decides whether to reply to the current node or go deeper.
   * P(go deeper) = 1 - exp(-decay * childCount) where decay = 0.3.
   * Returns an object { type, id, author, content, parentCommentId, post } or null.
   */
  async selectReplyTarget(avatar, parent, parentType, parentAuthor, community, globalRules) {
    // Get children of the current parent
    let children = [];
    if (parentType === 'post') {
      children = this.getHotComments(parent.id, 20);
    } else {
      // Get sub-comments of the current comment
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      children = this.db.all(
        `SELECT c.*, a.id as avatar_id, a.name as avatar_name
         FROM Comments c
         JOIN Avatars a ON c.avatar_id = a.id
         WHERE c.parent_comment_id = ? AND c.created_at >= ?
         ORDER BY c.created_at DESC
         LIMIT ?`,
        [parent.id, oneDayAgo, 20]
      );
      children = children.map(c => ({
        ...c,
        hotness: calculateHotness(
          this.getUpvotes('comment', c.id),
          this.getDownvotes('comment', c.id),
          this.getSubCommentCount(c.id),
          c.created_at
        )
      }));
    }

    const childCount = children.length;
    const pGoDeeper = childCount > 0 ? 1 - Math.exp(-0.3 * childCount) : 0;

    if (childCount > 0 && Math.random() < pGoDeeper) {
      // Go deeper: select a child and recurse
      const filtered = children.filter(c => c.avatar_id !== avatar.id);
      if (filtered.length === 0) {
        // All children are by the same avatar — reply to current parent instead
        if (parentAuthor.id !== avatar.id) {
          return {
            type: parentType,
            id: parent.id,
            author: parentAuthor,
            content: parent.content,
            parentCommentId: parent.parent_comment_id || null,
            post: parent
          };
        }
        return null;
      }
      const selected = this.selectComment(avatar, filtered);
      if (!selected) {
        return null;
      }
      return await this.selectReplyTarget(avatar, selected, 'comment', selected, community, globalRules);
    } else {
      // Reply to the current parent
      if (parentAuthor.id === avatar.id) {
        return null; // Don't reply to own content
      }
      return {
        type: parentType,
        id: parent.id,
        author: parentAuthor,
        content: parent.content,
        parentCommentId: parent.parent_comment_id || null,
        post: parent
      };
    }
  }

  /**
   * Execute a reply to the selected target.
   */
  async executeReply(avatar, target, community, globalRules) {
    if (!target) return;

    let context;
    if (target.type === 'post') {
      context = this.buildContextForPost(avatar, community, target.post);
    } else {
      context = this.buildContextForComment(avatar, community, target.post, target);
    }

    try {
      const length = this.getRandomLength();
      const content = await this.llm.generateContent(
        'comment', avatar, target.author, community, globalRules, context, '', '', length
      );

      if (target.parentCommentId) {
        this.db.run(
          'INSERT INTO Comments (post_id, parent_comment_id, avatar_id, content) VALUES (?, ?, ?, ?)',
          [target.post.id, target.id, avatar.id, content]
        );
      } else {
        this.db.run(
          'INSERT INTO Comments (post_id, avatar_id, content) VALUES (?, ?, ?)',
          [target.post.id, avatar.id, content]
        );
      }

      console.log(`Avatar ${avatar.name} replied to ${target.type} by ${target.author.name}`);
    } catch (error) {
      console.error(`Failed to create reply for ${avatar.name}:`, error.message);
    }
  }

  async voteOnContent(avatar, targetType, targetId, targetText) {
    try {
      const voteValue = await this.llm.generateVote(avatar, targetText);

      // Check if a vote already exists for this avatar on this target
      const existingVote = this.db.get(
        'SELECT id, vote_value FROM Votes WHERE avatar_id = ? AND target_type = ? AND target_id = ?',
        [avatar.id, targetType, targetId]
      );

      if (existingVote) {
        // Skip if the vote value is the same
        if (existingVote.vote_value === voteValue) {
          console.log(`Avatar ${avatar.name} already voted ${voteValue > 0 ? 'up' : 'down'} on ${targetType} ${targetId}`);
          return;
        }
        // Update existing vote
        this.db.run(
          'UPDATE Votes SET vote_value = ? WHERE id = ?',
          [voteValue, existingVote.id]
        );
      } else {
        // Insert new vote
        this.db.run(
          'INSERT INTO Votes (avatar_id, target_type, target_id, vote_value) VALUES (?, ?, ?, ?)',
          [avatar.id, targetType, targetId, voteValue]
        );
      }

      // Update relationships
      if (targetType === 'post') {
        const post = this.db.get('SELECT avatar_id FROM Posts WHERE id = ?', [targetId]);
        if (post) {
          updateRelationship(this.db, avatar.id, post.avatar_id, voteValue);
        }
      } else {
        const comment = this.db.get('SELECT avatar_id FROM Comments WHERE id = ?', [targetId]);
        if (comment) {
          updateRelationship(this.db, avatar.id, comment.avatar_id, voteValue);
        }
      }

      console.log(`Avatar ${avatar.name} voted ${voteValue > 0 ? 'up' : 'down'} on ${targetType} ${targetId}`);
    } catch (error) {
      console.error(`Failed to vote for ${avatar.name}:`, error.message);
    }
  }

  selectPost(avatar, hotPosts) {
    if (hotPosts.length === 0) return null;

    const weights = hotPosts.map(post => {
      let weight = post.hotness || 1;

      // Influence by relationship with the post's author
      const rel = this.db.get(
        'SELECT score FROM AvatarRelationships WHERE actor_id = ? AND target_id = ?',
        [avatar.id, post.avatar_id]
      );

      if (rel) {
        weight += Math.abs(rel.score) * 0.5;
      }

      return Math.max(weight, 0.1); // Floor
    });

    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let random = Math.random() * totalWeight;

    for (let i = 0; i < hotPosts.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        return hotPosts[i];
      }
    }

    return hotPosts[hotPosts.length - 1];
  }

  selectComment(avatar, hotComments) {
    if (hotComments.length === 0) return null;

    const weights = hotComments.map(comment => {
      let weight = comment.hotness || 1;

      // Influence by relationship with the comment's author
      const rel = this.db.get(
        'SELECT score FROM AvatarRelationships WHERE actor_id = ? AND target_id = ?',
        [avatar.id, comment.avatar_id]
      );

      if (rel) {
        weight += Math.abs(rel.score) * 0.5;
      }

      return Math.max(weight, 0.1);
    });

    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let random = Math.random() * totalWeight;

    for (let i = 0; i < hotComments.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        return hotComments[i];
      }
    }

    return hotComments[hotComments.length - 1];
  }

  getHotPosts(communityId, limit = 20) {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const posts = this.db.all(
      `SELECT p.*, a.id as avatar_id, a.name as avatar_name
       FROM Posts p
       JOIN Avatars a ON p.avatar_id = a.id
       WHERE p.community_id = ? AND p.created_at >= ?
       ORDER BY p.created_at DESC
       LIMIT ?`,
      [communityId, oneDayAgo, limit * 2] // Get more to sort by hotness
    );

    return posts.map(post => ({
      ...post,
      hotness: calculateHotness(
        this.getUpvotes('post', post.id),
        this.getDownvotes('post', post.id),
        this.getCommentCount(post.id),
        post.created_at
      )
    }))
    .sort((a, b) => b.hotness - a.hotness)
    .slice(0, limit);
  }

  getHotComments(postId, limit = 20) {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const comments = this.db.all(
      `SELECT c.*, a.id as avatar_id, a.name as avatar_name
       FROM Comments c
       JOIN Avatars a ON c.avatar_id = a.id
       WHERE c.post_id = ? AND c.created_at >= ?
       ORDER BY c.created_at DESC
       LIMIT ?`,
      [postId, oneDayAgo, limit * 2]
    );

    return comments.map(comment => ({
      ...comment,
      hotness: calculateHotness(
        this.getUpvotes('comment', comment.id),
        this.getDownvotes('comment', comment.id),
        this.getSubCommentCount(comment.id),
        comment.created_at
      )
    }))
    .sort((a, b) => b.hotness - a.hotness)
    .slice(0, limit);
  }

  getUpvotes(targetType, targetId) {
    const result = this.db.get(
      'SELECT COUNT(*) as count FROM Votes WHERE target_type = ? AND target_id = ? AND vote_value = 1',
      [targetType, targetId]
    );
    return result?.count || 0;
  }

  getDownvotes(targetType, targetId) {
    const result = this.db.get(
      'SELECT COUNT(*) as count FROM Votes WHERE target_type = ? AND target_id = ? AND vote_value = -1',
      [targetType, targetId]
    );
    return result?.count || 0;
  }

  getCommentCount(postId) {
    const result = this.db.get(
      'SELECT COUNT(*) as count FROM Comments WHERE post_id = ?',
      [postId]
    );
    return result?.count || 0;
  }

  getSubCommentCount(commentId) {
    const result = this.db.get(
      'SELECT COUNT(*) as count FROM Comments WHERE parent_comment_id = ?',
      [commentId]
    );
    return result?.count || 0;
  }

  buildContextForPost(avatar, community, post) {
    let context = `Community: ${community.name}\n`;

    if (post) {
      context += `Post by ${post.avatar_name}: ${post.content}\n`;
    }

    // Add some history from the avatar's posting history
    const avatarPosts = this.db.all(
      'SELECT content FROM Posts WHERE avatar_id = ? ORDER BY created_at DESC LIMIT 3',
      [avatar.id]
    );
    if (avatarPosts.length > 0) {
      context += `\nYour recent posts:\n${avatarPosts.map(p => `- ${p.content}`).join('\n')}\n`;
    }

    return context;
  }

  buildContextForComment(avatar, community, post, comment) {
    let context = `Community: ${community.name}\n`;
    context += `Post: ${post.content}\n`;
    context += `Comment by ${comment.avatar_name}: ${comment.content}\n`;

    return context;
  }

  /**
   * Generate a random length value (1-10) biased toward 3.
   * Shorter results are more common, longer results are rarer.
   * Uses inverse distance weighting from the mode (3).
   */
  getRandomLength() {
    const weights = [];
    for (let i = 1; i <= 10; i++) {
      // Weight is inversely proportional to distance from 3
      // Use 1/(distance + 1) to avoid division by zero and give mode highest weight
      const distance = Math.abs(i - 3);
      weights.push(1 / (distance + 1));
    }
    // Normalize weights
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const normalizedWeights = weights.map(w => w / totalWeight);

    // Weighted random selection
    let random = Math.random();
    for (let i = 0; i < normalizedWeights.length; i++) {
      random -= normalizedWeights[i];
      if (random <= 0) {
        return i + 1;
      }
    }

    return 10; // Fallback
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
