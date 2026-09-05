const express = require('express');
const { getDatabase } = require('../db');
const { getVoteCount, getCommentCount, getCommentsForPost, calculateHotness } = require('./helpers');
const { estimateLengthScale } = require('../utils/lengthScale');

function getDb() {
  return getDatabase();
}

const router = express.Router();

router.get('/posts/:id', (req, res) => {
  const post = getDb().get('SELECT * FROM Posts WHERE id = ?', [req.params.id]);
  if (!post) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const sort = req.query.sort || 'hot';

  post.avatar = getDb().get('SELECT name, handle FROM Avatars WHERE id = ?', [post.avatar_id]);
  post.community = getDb().get('SELECT name FROM Communities WHERE id = ?', [post.community_id]);
  post.upvotes = getVoteCount(getDb, 'post', post.id, 1);
  post.downvotes = getVoteCount(getDb, 'post', post.id, -1);
  post.hotness = calculateHotness(post.upvotes, post.downvotes, post.commentCount || 0, post.created_at);

  // Get comments
  const comments = getCommentsForPost(getDb, post.id, sort);
  post.comments = comments;
  post.commentCount = getCommentCount(getDb, post.id);

  res.json(post);
});

router.post('/posts', (req, res) => {
  const { community_id, avatar_id, title, content } = req.body;
  if (!community_id || !avatar_id || !content) {
    return res.status(400).json({ error: 'community_id, avatar_id, and content are required' });
  }
  const lengthScale = estimateLengthScale(title ? `${title}\n${content}` : content);
  getDb().run(
    'INSERT INTO Posts (community_id, avatar_id, title, content, length_scale) VALUES (?, ?, ?, ?, ?)',
    [community_id, avatar_id, title || '', content, lengthScale]
  );
  const id = getDb().lastInsertRowid();
  res.json({ id });
});

router.delete('/posts/:id', (req, res) => {
  getDb().run('DELETE FROM Posts WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
