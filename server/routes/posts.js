const express = require('express');
const { getDb, deletePostCascade } = require('./helpers');
const { enrichPosts, getCommentsForPost } = require('../services/enrichment');
const { estimateLengthScale } = require('../utils/lengthScale');

const router = express.Router();

router.get('/posts/:id', (req, res) => {
  const db = getDb();
  const post = db.get('SELECT * FROM Posts WHERE id = ?', [req.params.id]);
  if (!post) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const sort = req.query.sort || 'hot';

  // Enrichment computes upvotes, downvotes, commentCount, and hotness
  // together, so the hotness formula sees the real comment count.
  enrichPosts(db, [post]);
  post.comments = getCommentsForPost(db, post.id, sort);

  res.json(post);
});

router.post('/posts', (req, res) => {
  const { community_id, avatar_id, title, content } = req.body;
  if (!community_id || !avatar_id || !content) {
    return res.status(400).json({ error: 'community_id, avatar_id, and content are required' });
  }
  const db = getDb();
  const lengthScale = estimateLengthScale(title ? `${title}\n${content}` : content);
  db.run(
    'INSERT INTO Posts (community_id, avatar_id, title, content, length_scale) VALUES (?, ?, ?, ?, ?)',
    [community_id, avatar_id, title || '', content, lengthScale]
  );
  res.json({ id: db.lastInsertRowid() });
});

router.delete('/posts/:id', (req, res) => {
  deletePostCascade(getDb(), req.params.id);
  res.json({ success: true });
});

module.exports = router;
