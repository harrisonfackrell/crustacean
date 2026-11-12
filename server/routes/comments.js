const express = require('express');
const { getDb, deleteCommentCascade } = require('./helpers');
const { estimateLengthScale } = require('../utils/lengthScale');

const router = express.Router();

router.post('/comments', (req, res) => {
  const { post_id, parent_comment_id, avatar_id, content } = req.body;
  if (!post_id || !avatar_id || !content) {
    return res.status(400).json({ error: 'post_id, avatar_id, and content are required' });
  }
  const db = getDb();
  // An avatar may comment once per (post, parent) — one top-level comment
  // and one reply per comment thread node.
  const existingComment = db.get(
    'SELECT id FROM Comments WHERE avatar_id = ? AND post_id = ? AND parent_comment_id IS ?',
    [avatar_id, post_id, parent_comment_id || null]
  );
  if (existingComment) {
    return res.status(409).json({ error: 'Avatar has already replied here' });
  }
  const lengthScale = estimateLengthScale(content);
  db.run(
    'INSERT INTO Comments (post_id, parent_comment_id, avatar_id, content, length_scale) VALUES (?, ?, ?, ?, ?)',
    [post_id, parent_comment_id || null, avatar_id, content, lengthScale]
  );
  res.json({ id: db.lastInsertRowid() });
});

router.delete('/comments/:id', (req, res) => {
  // Cascade so votes on the comment are removed with it
  deleteCommentCascade(getDb(), req.params.id);
  res.json({ success: true });
});

// Check if an avatar has already commented on a post (with optional parent_comment_id)
router.get('/comments/check/:avatar_id/:post_id', (req, res) => {
  const { avatar_id, post_id } = req.params;
  const { parent_comment_id } = req.query;
  const db = getDb();
  const comment = db.get(
    'SELECT id FROM Comments WHERE avatar_id = ? AND post_id = ? AND parent_comment_id IS ?',
    [avatar_id, post_id, parent_comment_id || null]
  );
  res.json({ hasCommented: !!comment });
});

module.exports = router;
