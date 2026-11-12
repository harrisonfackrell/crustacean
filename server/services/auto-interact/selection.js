/**
 * Selection strategies for the auto-interact browsing sessions.
 *
 * Pure functions (no service state) that pick the next community, post,
 * comment, or content length for an avatar, using weighted sampling with
 * a temperature parameter that controls exploration vs exploitation.
 */

// Base weight distribution for comment length (1-10).
// Left-skewed: length 1 is the most common (~22%), ~30% for lengths > 4.
// Used for all comment generation (top-level comments use it directly;
// sub-comments bias toward the parent's length on top of it).
// All weights sum to exactly 1.
const COMMENT_LENGTH_WEIGHTS = [
  0.22,  // length 1 - most common
  0.18,  // length 2
  0.17,  // length 3
  0.12,  // length 4
  0.10,  // length 5
  0.07,  // length 6
  0.05,  // length 7
  0.04,  // length 8
  0.03,  // length 9
  0.02   // length 10 - rarest
];

// Post-specific weight distribution for content length (1-10).
// Unimodal with a mode of 6, making longer posts more likely than in the
// comment distribution. All weights sum to exactly 1.
const POST_LENGTH_WEIGHTS = [
  0.02,  // length 1
  0.04,  // length 2
  0.06,  // length 3
  0.09,  // length 4
  0.15,  // length 5
  0.23,  // length 6 - mode
  0.17,  // length 7
  0.11,  // length 8
  0.07,  // length 9
  0.06   // length 10
];

/**
 * Sample a 1-based index from a weight distribution that sums to ~1.
 */
function sampleLength(weights) {
  let r = Math.random();
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i + 1;
  }
  return weights.length;
}

function randomCommentLength() {
  return sampleLength(COMMENT_LENGTH_WEIGHTS);
}

function randomPostLength() {
  return sampleLength(POST_LENGTH_WEIGHTS);
}

/**
 * Generate a length (1-10) biased toward the target content's stored length
 * scale (Posts.length_scale / Comments.length_scale). Multiplies the comment
 * distribution by a Gaussian kernel centered on the target length, so the
 * result clusters near the target while retaining the natural left-skew of
 * the base distribution.
 *
 * Falls back to estimating the scale from the content text if no stored
 * value is available.
 *
 * @param {{length_scale?: number, title?: string, content?: string}} target - The post or comment being replied to
 * @param {number} [sigma=1.5] - Spread of the bias; lower = tighter clustering
 * @param {Function} [estimate] - Fallback estimator (text) => number
 */
function biasedReplyLength(target, sigma = 1.5, estimate = () => 3) {
  let targetLen = Number(target && target.length_scale);
  if (!targetLen || targetLen < 1) {
    const text = target
      ? (target.title ? `${target.title}\n${target.content}` : target.content)
      : '';
    targetLen = estimate(text);
  }
  targetLen = Math.max(1, Math.min(10, Math.round(targetLen)));

  const biased = COMMENT_LENGTH_WEIGHTS.map((w, i) => {
    const length = i + 1;
    const dist = length - targetLen;
    return w * Math.exp(-(dist * dist) / (2 * sigma * sigma));
  });

  const total = biased.reduce((sum, w) => sum + w, 0);
  const normalized = biased.map(w => w / total);
  return sampleLength(normalized);
}

/**
 * Select a community weighted by the avatar's preference score.
 * Uses softmax-like weighting: exp(score / temperature) for each community.
 *
 * @param {Map<number, number>} [prefs] - communityId -> score cache from
 *   ensurePreferences(); looked up in the DB per community when omitted.
 */
function selectCommunity(db, avatar, communities, temperature = 2, prefs = null) {
  const weights = communities.map(c => {
    const score = prefs
      ? (prefs.has(c.id) ? prefs.get(c.id) : 0)
      : (db.get(
          'SELECT score FROM AvatarCommunityPreferences WHERE avatar_id = ? AND community_id = ?',
          [avatar.id, c.id]
        )?.score || 0);
    return { item: c, weight: Math.exp(score / temperature) };
  });
  return weightedPick(weights);
}

/**
 * Select a post weighted by hotness, with some randomness for exploration.
 * Skips posts already in `visited`. Posts with zero or very few interactions
 * get a baseline weight so new posts are always discoverable even in
 * established communities.
 */
function selectPost(posts, visited, { temperature = 1.5, freshBoost = 2.0 } = {}) {
  const available = posts.filter(p => !visited.has(p.id));
  if (available.length === 0) return null;

  const weights = available.map(p => {
    const hotnessWeight = Math.exp((p.hotness || 0) / temperature);
    const engagement = (p.upvotes || 0) + (p.commentCount || 0);
    const weight = engagement < 3 ? Math.max(hotnessWeight, freshBoost) : hotnessWeight;
    return { item: p, weight };
  });
  return weightedPick(weights);
}

/**
 * Select a comment to potentially reply to, preferring comments with high
 * engagement and comments whose author the avatar has a positive
 * relationship with. Works on a flat list of all comments (any depth).
 */
function selectCommentForReply(db, comments, avatar, postId) {
  if (comments.length === 0) return null;

  // Filter out: own comments, already-replied-to comments
  const available = comments.filter(c => {
    if (c.avatar_id === avatar.id) return false;
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
    const weight = Math.max(0, relScore) * 0.4 + (c.score || 0) * 0.3 + 1;
    return { item: c, weight };
  });
  return weightedPick(weights);
}

/**
 * Weighted pick from [{item, weight}]. Returns the chosen item.
 */
function weightedPick(weights) {
  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
  let r = Math.random() * totalWeight;
  for (const w of weights) {
    r -= w.weight;
    if (r <= 0) return w.item;
  }
  return weights[weights.length - 1].item;
}

module.exports = {
  COMMENT_LENGTH_WEIGHTS,
  POST_LENGTH_WEIGHTS,
  sampleLength,
  randomCommentLength,
  randomPostLength,
  biasedReplyLength,
  selectCommunity,
  selectPost,
  selectCommentForReply,
  weightedPick
};
