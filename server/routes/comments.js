const express = require('express');
const { getDatabase } = require('../db');
const { estimateLengthScale } = require('../utils/lengthScale');

function getDb() {
  return getDatabase();
}

const router = express.Router();

router.post('/comments', (req, res) => {
  const { post_id, parent_comment_id, avatar_id, content } = req.body;
  if (!post_id || !avatar_id || !content) {
    return res.status(400).json({ error: 'post_id, avatar_id, and content are required' });
  }
  // Check if this avatar already replied to this post (with same parent_comment_id or no parent)
  const existingComment = getDb().get(
    'SELECT id FROM Comments WHERE avatar_id = ? AND post_id = ? AND parent_comment_id = ?',
    [avatar_id, post_id, parent_comment_id || null]
  );
  if (existingComment) {
    return res.status(409).json({ error: 'Avatar has already replied here' });
  }
  const lengthScale = estimateLengthScale(content);
  getDb().run(
    'INSERT INTO Comments (post_id, parent_comment_id, avatar_id, content, length_scale) VALUES (?, ?, ?, ?, ?)',
    [post_id, parent_comment_id || null, avatar_id, content, lengthScale]
  );
  const id = getDb().lastInsertRowid();
  res.json({ id });
});

router.delete('/comments/:id', (req, res) => {
  getDb().run('DELETE FROM Comments WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// Check if an avatar has already commented on a post (with optional parent_comment_id)
router.get('/comments/check/:avatar_id/:post_id', (req, res) => {
  const { avatar_id, post_id } = req.params;
  const { parent_comment_id } = req.query;
  const comment = getDb().get(
    'SELECT id FROM Comments WHERE avatar_id = ? AND post_id = ? AND parent_comment_id = ?',
    [avatar_id, post_id, parent_comment_id || null]
  );
  res.json({ hasCommented: !!comment });
});

module.exports = router;
