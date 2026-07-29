/**
 * Reddit-style hot score.
 * order = log10(max(abs(score), 1)) * sign(score) + timestamp / 45000
 *
 * Unlike the previous formula which divided by age (causing rapid decay),
 * this adds a time component so newer posts get a boost but high-scoring
 * older posts can still rank well. The 45000 divisor controls the balance
 * between score and recency. Comment count also contributes, so controversial
 * posts with lots of engagement stay visible.
 */

function calculateHotness(upvotes, downvotes, commentCount, createdAt) {
  // Score = upvotes - downvotes (net positive sentiment)
  const score = upvotes - downvotes;
  const timestamp = new Date(createdAt).getTime();

  // Reddit-style: log10 of absolute score, preserving sign for direction
  const order = Math.log10(Math.max(Math.abs(score), 1)) * Math.sign(score || 1);
  // Comment contribution: controversial posts (many upvotes AND many downvotes)
  // get a boost from both the vote activity and the comment activity.
  // log10 scaling keeps the contribution modest and balanced with the score.
  const commentBoost = Math.log10(Math.max(commentCount, 1));
  // Granularity constant in seconds — controls how much recency matters.
  // Larger value = recency matters less (older posts can compete more).
  // Smaller value = recency matters more (newer posts get bigger boost).
  const granularity = 45000;
  const hotScore = order + commentBoost + (timestamp / 1000) / granularity;

  return hotScore;
}

module.exports = { calculateHotness };
