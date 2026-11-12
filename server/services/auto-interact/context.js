const { parseCommunityRules } = require('../enrichment');

/**
 * Context building for auto-interact sessions: turns what the avatar has
 * been "reading" this session into a prompt-ready string.
 */

/**
 * Build the avatar's preferences for a set of communities, generating
 * missing scores via the LLM (falling back to 0 on failure).
 *
 * @returns {Map<number, number>} communityId -> score
 */
async function ensurePreferences(db, llm, avatar, communities) {
  const prefs = new Map();
  for (const community of communities) {
    const row = db.get(
      'SELECT score FROM AvatarCommunityPreferences WHERE avatar_id = ? AND community_id = ?',
      [avatar.id, community.id]
    );
    if (row) {
      prefs.set(community.id, row.score);
      continue;
    }
    let score = 0;
    try {
      score = await llm.generateCommunityPreference(avatar, {
        ...community,
        rules: parseCommunityRules(community.rules)
      });
    } catch {
      score = 0;
    }
    db.run(
      'INSERT INTO AvatarCommunityPreferences (avatar_id, community_id, score) VALUES (?, ?, ?)',
      [avatar.id, community.id, score]
    );
    prefs.set(community.id, score);
  }
  return prefs;
}

/**
 * Build context from the avatar's browsing session: the posts (and a few
 * of their top-level comments) it has seen so far. This gives the LLM a
 * realistic "what this user has been reading" context.
 *
 * @param {Set<number>} visitedPostIds
 */
function buildSessionContext(db, avatar, visitedPostIds, community) {
  let context = `You are browsing r/${community.name}.\n`;
  context += `Community description: ${community.description || 'No description.'}\n`;

  for (const postId of visitedPostIds) {
    const post = db.get('SELECT * FROM Posts WHERE id = ?', [postId]);
    if (!post) continue;

    const postAvatar = db.get('SELECT name, handle FROM Avatars WHERE id = ?', [post.avatar_id]);
    context += `\n--- Post by ${postAvatar?.name} (@${postAvatar?.handle}) ---\n`;
    if (post.title) context += `Title: ${post.title}\n`;
    context += `Content: ${post.content}\n`;

    // Include top-level comments as context (bounded to keep prompt size sane)
    const comments = db.all(
      'SELECT c.*, a.name, a.handle FROM Comments c JOIN Avatars a ON c.avatar_id = a.id WHERE c.post_id = ? AND c.parent_comment_id IS NULL ORDER BY c.created_at ASC',
      [postId]
    ).slice(0, 5);

    if (comments.length > 0) {
      context += 'Comments:\n';
      for (const c of comments) {
        context += `  - ${c.name} (@${c.handle}): ${c.content}\n`;
      }
    }
  }

  return context;
}

module.exports = { ensurePreferences, buildSessionContext };
