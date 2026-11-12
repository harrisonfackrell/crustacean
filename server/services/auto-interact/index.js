const { getDatabase } = require('../../db');
const { getLLMService } = require('../llm');
const {
  enrichPosts,
  enrichComments,
  buildCommentTree,
  flattenCommentTree
} = require('../enrichment');
const { selectCommunity, selectPost, selectCommentForReply } = require('./selection');
const { ensurePreferences, buildSessionContext } = require('./context');
const {
  AvatarSession,
  voteOnPost,
  processCommentNode,
  maybeCreatePost,
  maybeCommentOnPost,
  maybeCommentOnComment
} = require('./actions');

/**
 * Auto-Interact Service
 *
 * Models Crustacean as a tree: Communities → Posts → Comments (nested).
 * Each Avatar "browses" by performing a random walk through this tree,
 * governed by probabilistic transition rules (see selection.js). During a
 * browsing session, the Avatar always votes on everything it sees and
 * comments when conditions are met (not on its own content).
 *
 * The service runs a continuous event-loop when started, processing
 * Avatars in round-robin order until stopped. When there is nothing to do
 * (no avatars or communities) it sleeps instead of busy-spinning.
 *
 * Internals are split across:
 *   selection.js - weighted community/post/comment/length sampling
 *   context.js   - preference bootstrapping + session context building
 *   actions.js   - per-node LLM actions (votes, posts, comments)
 */

// Delay (ms) before re-checking when there is nothing to do.
const IDLE_DELAY_MS = 5000;

class AutoInteractService {
  constructor() {
    this.db = null;
    this.llm = null;
    this.running = false;
    this.abortFlag = false;
    // Round-robin turn counter so every avatar gets an equal, guaranteed
    // number of browsing sessions. Pure random selection produces large
    // short-window variance: with a handful of avatars one can easily go
    // many minutes without a single session while others rack up a dozen
    // contributions.
    this.turn = 0;
    // Hard cap on actions (votes + comments + post creations) a single
    // avatar may perform in one session. Without this, a session that hits
    // a hot, heavily-commented post can consume a large share of LLM work,
    // starving the avatars waiting for their turn.
    this.MAX_ACTIONS_PER_TURN = 8;
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
    setImmediate(() => this._runLoop());
  }

  /**
   * Stop the auto-interact loop.
   */
  stop() {
    console.log('[AutoInteract] Stopping...');
    this.running = false;
    this.abortFlag = true;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * The main event-loop. Drives processing via setImmediate so it yields
   * to the event loop between each avatar, avoiding blocking.
   */
  async _runLoop() {
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

    const avatars = db.all('SELECT * FROM Avatars');
    const communities = db.all('SELECT * FROM Communities');

    if (avatars.length === 0 || communities.length === 0) {
      // Nothing to do — sleep instead of tight-looping, then re-check.
      // Re-checking every IDLE_DELAY_MS means newly created avatars or
      // communities are picked up without a restart.
      await this._sleep(IDLE_DELAY_MS);
      if (this.running && !this.abortFlag) {
        setImmediate(() => this._runLoop());
      }
      return;
    }

    const globalRules = db.all('SELECT rule FROM GlobalRules ORDER BY id').map(r => r.rule);

    // Pick the next avatar in round-robin order (stable ordering by id),
    // guaranteeing an even spread of sessions across all avatars.
    const ordered = [...avatars].sort((a, b) => a.id - b.id);
    const avatar = ordered[this.turn % ordered.length];
    this.turn += 1;

    try {
      await this.processAvatar(avatar, communities, globalRules);
    } catch (err) {
      console.error('[AutoInteract] Error processing avatar:', err.message, err.stack);
    }
    if (this.running && !this.abortFlag) {
      setImmediate(() => this._runLoop());
    }
  }

  /**
   * Process a single avatar's browsing session.
   * The avatar walks the tree: picks a community, may create a post,
   * browses existing posts, votes on everything, and may comment.
   *
   * @param {object} avatar - Avatar row
   * @param {Array} [communities] - Community rows (fetched if omitted)
   * @param {Array} [globalRules] - Rule strings (fetched if omitted)
   * @param {number} [maxActions] - Cap on LLM-driven actions this session
   */
  async processAvatar(avatar, communities = null, globalRules = null, maxActions = this.MAX_ACTIONS_PER_TURN) {
    const db = this.getDb();
    const llm = this.getLLM();
    const session = new AvatarSession(db, llm, avatar, maxActions);

    if (!communities) {
      communities = db.all('SELECT * FROM Communities');
    }
    if (!globalRules) {
      globalRules = db.all('SELECT rule FROM GlobalRules ORDER BY id').map(r => r.rule);
    }

    // Ensure community preferences exist for all communities (cached in
    // memory for this session).
    const prefs = await ensurePreferences(db, llm, avatar, communities);

    // Choose a community weighted by preference score
    const community = selectCommunity(db, avatar, communities, 2, prefs);
    if (!community) return;

    // --- Phase 0: Maybe create a new post in this community ---
    // ~25% chance the avatar creates a new post instead of just browsing
    if (Math.random() < 0.25) {
      await maybeCreatePost(session, community);
    }

    // Get posts in this community, sorted by hotness (one batched
    // enrichment instead of per-post count queries)
    const posts = enrichPosts(db, db.all(
      'SELECT * FROM Posts WHERE community_id = ? ORDER BY created_at DESC',
      [community.id]
    )).sort((a, b) => b.hotness - a.hotness);
    if (posts.length === 0) return;

    // Browsing session: walk through posts
    // The avatar visits a number of posts (1 to min(3, posts.length))
    const postsToVisit = Math.min(3, posts.length);
    const visitedPosts = new Set();

    for (let visit = 0; visit < postsToVisit && !this.abortFlag && session.budget.remaining > 0; visit++) {
      // Choose a post — weighted toward hotness but with exploration
      const post = selectPost(posts, visitedPosts);
      if (!post) break;
      visitedPosts.add(post.id);

      // Load full comment tree for this post (batched enrichment)
      const commentTree = buildCommentTree(
        enrichComments(db, db.all(
          'SELECT * FROM Comments WHERE post_id = ? ORDER BY created_at ASC',
          [post.id]
        ))
      );

      // Build context from what the avatar has seen this session
      const context = buildSessionContext(db, avatar, visitedPosts, community);

      // --- Phase 1: Vote on the post ---
      await voteOnPost(session, post);

      // --- Phase 2: Process all comments (vote on each, recursively) ---
      for (const comment of commentTree) {
        if (this.abortFlag || session.budget.remaining <= 0) break;
        await processCommentNode(session, comment, post);
      }

      // --- Phase 3: Comment on the post (skip own posts) ---
      if (post.avatar_id !== avatar.id && session.budget.remaining > 0) {
        await maybeCommentOnPost(session, post, community, globalRules, context);
      }

      // --- Phase 4: Reply to a comment in the tree (skip own comments) ---
      if (session.budget.remaining > 0) {
        const allComments = flattenCommentTree(commentTree);
        const targetComment = selectCommentForReply(db, allComments, avatar, post.id);
        if (targetComment) {
          await maybeCommentOnComment(session, targetComment, post, community, globalRules, context);
        }
      }

      // --- Phase 5: Decide whether to continue browsing or stop ---
      // ~30% chance to stop browsing this community
      if (Math.random() < 0.3) break;
    }
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
