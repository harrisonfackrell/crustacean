const express = require('express');
const {
  getDb,
  sanitizeAvatarHandle,
  deleteAvatarCascade,
  clearAvatarEmergentData
} = require('./helpers');
const { enrichPosts, enrichComments } = require('../services/enrichment');

// Upper bound on history items returned by GET /avatars/:id so the payload
// stays bounded even for very active avatars. The UI paginates client-side.
const HISTORY_LIMIT = 50;

const router = express.Router();

router.get('/avatars', (req, res) => {
  const avatars = getDb().all('SELECT * FROM Avatars ORDER BY id');
  res.json(avatars);
});

router.get('/avatars/:id', (req, res) => {
  const db = getDb();
  const avatar = db.get('SELECT * FROM Avatars WHERE id = ?', [req.params.id]);
  if (!avatar) {
    return res.status(404).json({ error: 'Avatar not found' });
  }

  // Karma: one aggregate query instead of loading every vote row.
  // Includes votes cast on this avatar's content, whether or not the
  // underlying post/comment still exists (matches previous behavior).
  const karmaRow = db.get(
    `SELECT COALESCE(SUM(v.vote_value), 0) as karma
     FROM Votes v
     LEFT JOIN Posts p ON v.target_type = 'post' AND v.target_id = p.id
     LEFT JOIN Comments c ON v.target_type = 'comment' AND v.target_id = c.id
     WHERE (p.avatar_id = ? OR c.avatar_id = ?)`,
    [avatar.id, avatar.id]
  );
  const karma = karmaRow ? karmaRow.karma : 0;

  // History, newest first, bounded (see HISTORY_LIMIT)
  const posts = enrichPosts(db, db.all(
    'SELECT * FROM Posts WHERE avatar_id = ? ORDER BY created_at DESC LIMIT ?',
    [avatar.id, HISTORY_LIMIT]
  ));
  const comments = enrichComments(db, db.all(
    'SELECT * FROM Comments WHERE avatar_id = ? ORDER BY created_at DESC LIMIT ?',
    [avatar.id, HISTORY_LIMIT]
  ));
  for (const comment of comments) {
    const post = db.get('SELECT id, title, community_id FROM Posts WHERE id = ?', [comment.post_id]);
    comment.post_title = post ? post.title : null;
    if (post) {
      comment.community = db.get('SELECT id, name FROM Communities WHERE id = ?', [post.community_id]) || null;
    }
  }

  const votes = db.all(
    'SELECT * FROM Votes WHERE avatar_id = ? ORDER BY created_at DESC',
    [avatar.id]
  );

  // Friends and foes
  const relationships = db.all(
    `SELECT ar.score, a.id, a.name, a.handle
     FROM AvatarRelationships ar
     JOIN Avatars a ON ar.target_id = a.id
     WHERE ar.actor_id = ? AND ar.score != 0
     ORDER BY ABS(ar.score) DESC`,
    [avatar.id]
  );

  const friends = relationships.filter(r => r.score > 0);
  const foes = relationships.filter(r => r.score < 0);

  res.json({ ...avatar, karma, posts, comments, votes, friends, foes });
});

router.post('/avatars', (req, res) => {
  const { name, handle, private_bio, public_bio } = req.body;
  if (!name || !handle) {
    return res.status(400).json({ error: 'name and handle are required' });
  }
  const sanitizedHandle = sanitizeAvatarHandle(handle);
  if (!sanitizedHandle) {
    return res.status(400).json({ error: 'handle must contain at least one valid character (a-z, 0-9, _)' });
  }
  const db = getDb();
  db.run(
    'INSERT INTO Avatars (name, handle, private_bio, public_bio) VALUES (?, ?, ?, ?)',
    [name, sanitizedHandle, private_bio || '', public_bio || '']
  );
  res.json({ id: db.lastInsertRowid(), name, handle: sanitizedHandle });
});

router.put('/avatars/:id', (req, res) => {
  const db = getDb();
  const avatar = db.get('SELECT * FROM Avatars WHERE id = ?', [req.params.id]);
  if (!avatar) {
    return res.status(404).json({ error: 'Avatar not found' });
  }
  const { name, handle, private_bio, public_bio } = req.body;
  // Sanitize handle if provided and different from existing
  let sanitizedHandle = avatar.handle;
  if (handle && handle !== avatar.handle) {
    sanitizedHandle = sanitizeAvatarHandle(handle);
    if (!sanitizedHandle) {
      return res.status(400).json({ error: 'handle must contain at least one valid character (a-z, 0-9, _)' });
    }
  }
  db.run(
    'UPDATE Avatars SET name = COALESCE(?, name), handle = COALESCE(?, handle), private_bio = COALESCE(?, private_bio), public_bio = COALESCE(?, public_bio) WHERE id = ?',
    [name, sanitizedHandle, private_bio, public_bio, avatar.id]
  );
  res.json({ success: true });
});

router.delete('/avatars/:id', (req, res) => {
  deleteAvatarCascade(getDb(), req.params.id);
  res.json({ success: true });
});

router.post('/avatars/:id/reset', (req, res) => {
  const db = getDb();
  const avatar = db.get('SELECT * FROM Avatars WHERE id = ?', [req.params.id]);
  if (!avatar) {
    return res.status(404).json({ error: 'Avatar not found' });
  }
  clearAvatarEmergentData(db, avatar.id);
  res.json({ success: true });
});

router.get('/avatars/:id/export', (req, res) => {
  const db = getDb();
  const avatar = db.get('SELECT name, handle, private_bio, public_bio FROM Avatars WHERE id = ?', [req.params.id]);
  if (!avatar) {
    return res.status(404).json({ error: 'Avatar not found' });
  }
  // Exclude id from export to avoid duplicate key errors on import
  const { id: _id, ...avatarData } = avatar;
  res.json({ type: 'avatar', data: avatarData });
});

module.exports = router;
