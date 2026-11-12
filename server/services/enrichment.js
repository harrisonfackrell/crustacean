const { calculateHotness } = require('../utils/hotness');

/**
 * Shared data enrichment for posts and comments.
 *
 * Previously every route (and the auto-interact service) enriched rows with
 * its own per-row queries — one SELECT for the avatar, two for the vote
 * counts, one for the comment count, per post. This module loads that data
 * with a handful of aggregate SQL queries per page of results and applies it
 * in memory, so a list of N posts costs a constant number of queries.
 */

/**
 * Safely parse the `rules` column of Communities, which stores a JSON array
 * as text. Corrupt or missing values yield an empty array instead of a
 * throw (which used to surface as an unhandled 500 on list endpoints).
 */
function parseCommunityRules(rules) {
  if (Array.isArray(rules)) return rules;
  if (!rules) return [];
  try {
    const parsed = JSON.parse(rules);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ============================================================
// Aggregate lookup helpers (constant number of queries)
// ============================================================

/**
 * @returns {Map<number, {upvotes: number, downvotes: number}>}
 */
function getVoteCounts(db, targetType, targetIds) {
  const counts = new Map();
  for (const id of new Set(targetIds)) {
    counts.set(id, { upvotes: 0, downvotes: 0 });
  }
  if (counts.size === 0) return counts;

  const ids = [...counts.keys()];
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db.all(
    `SELECT target_id, vote_value, COUNT(*) as n FROM Votes
     WHERE target_type = ? AND target_id IN (${placeholders})
     GROUP BY target_id, vote_value`,
    [targetType, ...ids]
  );
  for (const row of rows) {
    const entry = counts.get(row.target_id);
    if (!entry) continue;
    if (row.vote_value === 1) entry.upvotes = row.n;
    else entry.downvotes = row.n;
  }
  return counts;
}

/**
 * @returns {Map<number, number>} postId -> comment count
 */
function getCommentCounts(db, postIds) {
  const counts = new Map();
  for (const id of new Set(postIds)) counts.set(id, 0);
  if (counts.size === 0) return counts;

  const ids = [...counts.keys()];
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db.all(
    `SELECT post_id, COUNT(*) as n FROM Comments
     WHERE post_id IN (${placeholders}) GROUP BY post_id`,
    ids
  );
  for (const row of rows) counts.set(row.post_id, row.n);
  return counts;
}

/**
 * @returns {Map<number, {id, name, handle, public_bio}>}
 */
function getAvatarsById(db, avatarIds) {
  const map = new Map();
  const ids = [...new Set(avatarIds.filter(Boolean))];
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db.all(
    'SELECT id, name, handle, public_bio FROM Avatars WHERE id IN (' + placeholders + ')',
    ids
  );
  for (const row of rows) map.set(row.id, row);
  return map;
}

/**
 * @returns {Map<number, {id, name}>}
 */
function getCommunitiesById(db, communityIds) {
  const map = new Map();
  const ids = [...new Set(communityIds.filter(Boolean))];
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db.all('SELECT id, name FROM Communities WHERE id IN (' + placeholders + ')', ids);
  for (const row of rows) map.set(row.id, row);
  return map;
}

// ============================================================
// Enrichment
// ============================================================

/**
 * Enrich a flat array of Posts rows (mutated in place) with avatar,
 * community, upvotes, downvotes, commentCount, and hotness.
 *
 * @param {object} options
 * @param {boolean} [options.withCommunity=true] Attach `community` objects.
 * @param {boolean} [options.withAvatars=true] Attach `avatar` objects.
 * @returns the same array
 */
function enrichPosts(db, posts, { withCommunity = true, withAvatars = true } = {}) {
  if (posts.length === 0) return posts;

  const avatars = withAvatars ? getAvatarsById(db, posts.map(p => p.avatar_id)) : null;
  const communities = withCommunity ? getCommunitiesById(db, posts.map(p => p.community_id)) : null;
  const votes = getVoteCounts(db, 'post', posts.map(p => p.id));
  const commentCounts = getCommentCounts(db, posts.map(p => p.id));

  for (const post of posts) {
    if (avatars) post.avatar = avatars.get(post.avatar_id) || null;
    if (communities) post.community = communities.get(post.community_id) || null;
    const v = votes.get(post.id) || { upvotes: 0, downvotes: 0 };
    post.upvotes = v.upvotes;
    post.downvotes = v.downvotes;
    post.commentCount = commentCounts.get(post.id) || 0;
    post.hotness = calculateHotness(post.upvotes, post.downvotes, post.commentCount, post.created_at);
  }
  return posts;
}

/**
 * Enrich a flat array of Comments rows (mutated in place) with avatar,
 * upvotes, downvotes, score, and hotness.
 *
 * @returns the same array
 */
function enrichComments(db, comments) {
  if (comments.length === 0) return comments;

  const avatars = getAvatarsById(db, comments.map(c => c.avatar_id));
  const votes = getVoteCounts(db, 'comment', comments.map(c => c.id));

  for (const c of comments) {
    c.avatar = avatars.get(c.avatar_id) || null;
    const v = votes.get(c.id) || { upvotes: 0, downvotes: 0 };
    c.upvotes = v.upvotes;
    c.downvotes = v.downvotes;
    c.score = v.upvotes - v.downvotes;
    c.hotness = calculateHotness(c.upvotes, c.downvotes, 0, c.created_at);
  }
  return comments;
}

// ============================================================
// Comment tree
// ============================================================

/**
 * Build a nested comment tree from a flat (already enriched) array of
 * comments. Each node gets a `replies` array. Orphaned replies (whose
 * parent was deleted) are promoted to top-level, matching long-standing UX.
 *
 * @returns {Array} the top-level nodes
 */
function buildCommentTree(comments) {
  const map = new Map();
  for (const c of comments) {
    c.replies = [];
    map.set(c.id, c);
  }
  const topLevel = [];
  for (const c of comments) {
    const parent = c.parent_comment_id ? map.get(c.parent_comment_id) : null;
    if (parent) parent.replies.push(c);
    else topLevel.push(c);
  }
  return topLevel;
}

/**
 * Flatten a nested comment tree (depth-first) into a flat array.
 */
function flattenCommentTree(tree) {
  const flat = [];
  for (const node of tree) {
    flat.push(node);
    if (node.replies.length > 0) flat.push(...flattenCommentTree(node.replies));
  }
  return flat;
}

/**
 * Sort a nested comment tree in place using the given comparator.
 */
function sortCommentTree(tree, comparator) {
  for (const node of tree) {
    if (node.replies.length > 0) sortCommentTree(node.replies, comparator);
    node.replies.sort(comparator);
  }
  tree.sort(comparator);
  return tree;
}

// ============================================================
// Sorting
// ============================================================

function sortPosts(posts, sort) {
  switch (sort) {
    case 'new':
      return posts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    case 'top':
      return posts.sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0));
    case 'hot':
    default:
      return posts.sort((a, b) => (b.hotness || 0) - (a.hotness || 0));
  }
}

function sortCommentsTree(tree, sort) {
  switch (sort) {
    case 'new':
      return sortCommentTree(tree, (a, b) => new Date(b.created_at) - new Date(a.created_at));
    case 'top':
      return sortCommentTree(tree, (a, b) => (b.score || 0) - (a.score || 0));
    case 'hot':
    default:
      return sortCommentTree(tree, (a, b) => (b.hotness || 0) - (a.hotness || 0));
  }
}

/**
 * Load the (sorted) nested comment tree for a post in a constant number of
 * queries. The single source of truth for comment-tree building.
 */
function getCommentsForPost(db, postId, sort = 'hot') {
  const rows = db.all(
    'SELECT * FROM Comments WHERE post_id = ? ORDER BY created_at ASC',
    [postId]
  );
  enrichComments(db, rows);
  const tree = buildCommentTree(rows);
  sortCommentsTree(tree, sort);
  return tree;
}

module.exports = {
  parseCommunityRules,
  getVoteCounts,
  getCommentCounts,
  getAvatarsById,
  getCommunitiesById,
  enrichPosts,
  enrichComments,
  buildCommentTree,
  flattenCommentTree,
  sortCommentTree,
  sortPosts,
  sortCommentsTree,
  getCommentsForPost
};
