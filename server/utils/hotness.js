/**
 * Reddit-style hot score.
 * order = log10(max(abs(score), 1)) * sign(score) + timestamp / 45000
 *
 * Unlike the previous formula which divided by age (causing rapid decay),
 * this adds a time component so newer posts get a boost but high-scoring
 * older posts can still rank well. The 45000 divisor controls the balance
 * between score and recency.
 */

function calculateHotness(upvotes, downvotes, commentCount, createdAt) {
  const score = upvotes + downvotes;
  const timestamp = new Date(createdAt).getTime();

  const order = Math.log10(Math.max(score, 1));
  const hotScore = order + timestamp / 900000;

  return hotScore;
}

module.exports = { calculateHotness };
