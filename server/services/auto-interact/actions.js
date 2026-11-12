const { estimateLengthScale } = require('../../utils/lengthScale');
const { updateRelationship } = require('../../utils/relationships');
const {
  randomPostLength,
  randomCommentLength,
  biasedReplyLength
} = require('./selection');

/**
 * Per-turn session state for a single avatar. Actions mutate the budget and
 * action log in place.
 */
class AvatarSession {
  constructor(db, llm, avatar, maxActions) {
    this.db = db;
    this.llm = llm;
    this.avatar = avatar;
    // Action budget: actions stop doing work once it reaches zero.
    this.budget = { remaining: maxActions };
    // Keys already acted on this turn ("post:1", "comment:5", ...)
    this.actionLog = new Set();
  }

  hasLogged(key) {
    return this.actionLog.has(key);
  }

  logAction(key) {
    this.actionLog.add(key);
  }

  spendBudget() {
    if (this.budget) this.budget.remaining -= 1;
  }
}

/**
 * Vote on a post (always votes on everything it sees).
 */
async function voteOnPost(session, post) {
  const { db, llm, avatar } = session;
  const actionKey = `post:${post.id}`;

  if (session.budget.remaining <= 0) return;
  if (session.hasLogged(actionKey)) return;
  if (db.get('SELECT id FROM Votes WHERE avatar_id = ? AND target_type = ? AND target_id = ?',
    [avatar.id, 'post', post.id])) return;

  try {
    const text = post.title ? `${post.title}\n${post.content}` : post.content;
    const voteValue = await llm.generateVote(avatar, text);

    // One transaction: the vote plus both relationship updates persist in a
    // single save instead of one per write.
    db.transaction(() => {
      db.run(
        'INSERT INTO Votes (avatar_id, target_type, target_id, vote_value) VALUES (?, ?, ?, ?)',
        [avatar.id, 'post', post.id, voteValue]
      );
      updateRelationship(db, avatar.id, post.avatar_id, voteValue);
    });

    session.logAction(actionKey);
    session.spendBudget();
  } catch (err) {
    console.error(`[AutoInteract] Vote on post ${post.id} failed:`, err.message);
  }
}

/**
 * Recursively process a comment node: vote on it, then its replies.
 * Children are processed even if this node was already acted on.
 */
async function processCommentNode(session, comment, post) {
  const { db, llm, avatar } = session;
  const actionKey = `comment:${comment.id}`;

  if (!session.hasLogged(actionKey) && session.budget.remaining > 0) {
    const existingVote = db.get(
      'SELECT id FROM Votes WHERE avatar_id = ? AND target_type = ? AND target_id = ?',
      [avatar.id, 'comment', comment.id]
    );
    if (!existingVote) {
      try {
        const voteValue = await llm.generateVote(avatar, comment.content);
        db.transaction(() => {
          db.run(
            'INSERT INTO Votes (avatar_id, target_type, target_id, vote_value) VALUES (?, ?, ?, ?)',
            [avatar.id, 'comment', comment.id, voteValue]
          );
          updateRelationship(db, avatar.id, comment.avatar_id, voteValue);
        });
        session.logAction(actionKey);
        session.spendBudget();
      } catch (err) {
        console.error(`[AutoInteract] Vote on comment ${comment.id} failed:`, err.message);
      }
    }
  }

  for (const reply of comment.replies || []) {
    if (session.budget.remaining <= 0) return;
    await processCommentNode(session, reply, post);
  }
}

/**
 * Create a new post in a community (the caller decides whether to try).
 */
async function maybeCreatePost(session, community) {
  const { db, llm, avatar } = session;

  if (session.budget.remaining <= 0) return;

  try {
    const result = await llm.generateContent(
      'post',
      avatar,
      null,
      community,
      [],
      `You are in the community r/${community.name}.`,
      '',
      '',
      randomPostLength()
    );

    const title = result.title || '';
    const content = result.content || result;
    const lengthScale = estimateLengthScale(title ? `${title}\n${content}` : content);

    db.run(
      'INSERT INTO Posts (community_id, avatar_id, title, content, length_scale) VALUES (?, ?, ?, ?, ?)',
      [community.id, avatar.id, title, content, lengthScale]
    );

    session.logAction(`create_post:${community.id}`);
    session.spendBudget();
  } catch (err) {
    console.error(`[AutoInteract] Create post in community ${community.id} failed:`, err.message);
  }
}

/**
 * Maybe comment on a post (top-level). Skips own posts and posts already
 * commented on this session or in previous sessions.
 */
async function maybeCommentOnPost(session, post, community, globalRules, context) {
  const { db, llm, avatar } = session;
  const actionKey = `comment_on_post:${post.id}`;

  if (session.budget.remaining <= 0) return;
  if (session.hasLogged(actionKey)) return;
  if (post.avatar_id === avatar.id) return;
  if (db.get(
    'SELECT id FROM Comments WHERE avatar_id = ? AND post_id = ? AND parent_comment_id IS NULL',
    [avatar.id, post.id]
  )) return;

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
      randomCommentLength()
    );
    const lengthScale = estimateLengthScale(content);

    db.run(
      'INSERT INTO Comments (post_id, parent_comment_id, avatar_id, content, length_scale) VALUES (?, ?, ?, ?, ?)',
      [post.id, null, avatar.id, content, lengthScale]
    );

    session.logAction(actionKey);
    session.spendBudget();
  } catch (err) {
    console.error(`[AutoInteract] Comment on post ${post.id} failed:`, err.message);
  }
}

/**
 * Maybe reply to a specific comment. Skips own comments and comments
 * already replied to.
 */
async function maybeCommentOnComment(session, comment, post, community, globalRules, context) {
  const { db, llm, avatar } = session;
  const actionKey = `reply_to_comment:${comment.id}`;

  if (session.budget.remaining <= 0) return;
  if (session.hasLogged(actionKey)) return;
  if (comment.avatar_id === avatar.id) return;
  if (db.get(
    'SELECT id FROM Comments WHERE avatar_id = ? AND post_id = ? AND parent_comment_id = ?',
    [avatar.id, post.id, comment.id]
  )) return;

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
      biasedReplyLength(comment, 1.5, estimateLengthScale)
    );
    const lengthScale = estimateLengthScale(content);

    db.run(
      'INSERT INTO Comments (post_id, parent_comment_id, avatar_id, content, length_scale) VALUES (?, ?, ?, ?, ?)',
      [post.id, comment.id, avatar.id, content, lengthScale]
    );

    session.logAction(actionKey);
    session.spendBudget();
  } catch (err) {
    console.error(`[AutoInteract] Reply to comment ${comment.id} failed:`, err.message);
  }
}

module.exports = {
  AvatarSession,
  voteOnPost,
  processCommentNode,
  maybeCreatePost,
  maybeCommentOnPost,
  maybeCommentOnComment
};
