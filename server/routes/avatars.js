const express = require('express');
const { getDatabase } = require('../db');
const { sanitizeAvatarHandle, getVoteCount } = require('./helpers');

function getDb() {
  return getDatabase();
}

const router = express.Router();

router.get('/avatars', (req, res) => {
  const avatars = getDb().all('SELECT * FROM Avatars');
  res.json(avatars);
});

router.get('/avatars/:id', (req, res) => {
  const avatar = getDb().get('SELECT * FROM Avatars WHERE id = ?', [req.params.id]);
  if (!avatar) {
    return res.status(404).json({ error: 'Avatar not found' });
  }

  // Karma calculation
  const upvotes = getDb().all(
    `SELECT v.vote_value FROM Votes v
     LEFT JOIN Posts p ON v.target_type = 'post' AND v.target_id = p.id
     LEFT JOIN Comments c ON v.target_type = 'comment' AND v.target_id = c.id
     WHERE (p.avatar_id = ? OR c.avatar_id = ?)`,
    [avatar.id, avatar.id]
  );
  const karma = upvotes.reduce((sum, v) => sum + v.vote_value, 0);

  const posts = getDb().all(
    'SELECT * FROM Posts WHERE avatar_id = ? ORDER BY created_at DESC',
    [avatar.id]
  ).map(post => ({
    ...post,
    community: getDb().get('SELECT id, name FROM Communities WHERE id = ?', [post.community_id]),
    upvotes: getVoteCount(getDb, 'post', post.id, 1),
    downvotes: getVoteCount(getDb, 'post', post.id, -1),
  }));
  const comments = getDb().all(
    'SELECT * FROM Comments WHERE avatar_id = ? ORDER BY created_at DESC',
    [avatar.id]
  ).map(comment => {
    const post = getDb().get('SELECT id, title, community_id FROM Posts WHERE id = ?', [comment.post_id]);
    const community = post ? getDb().get('SELECT id, name FROM Communities WHERE id = ?', [post.community_id]) : null;
    return {
      ...comment,
      post_title: post?.title || null,
      post_id: comment.post_id,
      community,
      upvotes: getVoteCount(getDb, 'comment', comment.id, 1),
      downvotes: getVoteCount(getDb, 'comment', comment.id, -1),
    };
  });
  const votes = getDb().all(
    'SELECT * FROM Votes WHERE avatar_id = ? ORDER BY created_at DESC',
    [avatar.id]
  );

  // Friends and foes
  const relationships = getDb().all(
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
  const { name, handle, private_bio, public_bio, auto_interval, vote_chance, reply_chance, is_auto_enabled } = req.body;
  if (!name || !handle) {
    return res.status(400).json({ error: 'name and handle are required' });
  }
  const sanitizedHandle = sanitizeAvatarHandle(handle);
  if (!sanitizedHandle) {
    return res.status(400).json({ error: 'handle must contain at least one valid character (a-z, 0-9, _)' });
  }
  getDb().run(
    'INSERT INTO Avatars (name, handle, private_bio, public_bio, auto_interval, vote_chance, reply_chance, is_auto_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [name, sanitizedHandle, private_bio || '', public_bio || '', auto_interval || 5, vote_chance || 0.5, reply_chance || 0.5, is_auto_enabled !== undefined ? is_auto_enabled : 1]
  );
  const id = getDb().lastInsertRowid();
  res.json({ id, name, handle: sanitizedHandle });
});

router.put('/avatars/:id', (req, res) => {
  const avatar = getDb().get('SELECT * FROM Avatars WHERE id = ?', [req.params.id]);
  if (!avatar) {
    return res.status(404).json({ error: 'Avatar not found' });
  }
  const { name, handle, private_bio, public_bio, auto_interval, vote_chance, reply_chance, is_auto_enabled } = req.body;
  // Sanitize handle if provided and different from existing
  let sanitizedHandle = handle;
  if (handle && handle !== avatar.handle) {
    sanitizedHandle = sanitizeAvatarHandle(handle);
    if (!sanitizedHandle) {
      return res.status(400).json({ error: 'handle must contain at least one valid character (a-z, 0-9, _)' });
    }
  } else {
    sanitizedHandle = avatar.handle;
  }
  getDb().run(
    'UPDATE Avatars SET name = COALESCE(?, name), handle = COALESCE(?, handle), private_bio = COALESCE(?, private_bio), public_bio = COALESCE(?, public_bio), auto_interval = COALESCE(?, auto_interval), vote_chance = COALESCE(?, vote_chance), reply_chance = COALESCE(?, reply_chance), is_auto_enabled = COALESCE(?, is_auto_enabled) WHERE id = ?',
    [name, sanitizedHandle, private_bio, public_bio, auto_interval, vote_chance, reply_chance, is_auto_enabled, avatar.id]
  );
  res.json({ success: true });
});

router.delete('/avatars/:id', (req, res) => {
  getDb().run('DELETE FROM Avatars WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

router.post('/avatars/:id/reset', (req, res) => {
  const avatar = getDb().get('SELECT * FROM Avatars WHERE id = ?', [req.params.id]);
  if (!avatar) {
    return res.status(404).json({ error: 'Avatar not found' });
  }
  // Clear emergent data
  getDb().run('DELETE FROM Posts WHERE avatar_id = ?', [avatar.id]);
  getDb().run('DELETE FROM Comments WHERE avatar_id = ?', [avatar.id]);
  getDb().run('DELETE FROM Votes WHERE avatar_id = ?', [avatar.id]);
  getDb().run('DELETE FROM AvatarCommunityPreferences WHERE avatar_id = ?', [avatar.id]);
  getDb().run('DELETE FROM AvatarRelationships WHERE actor_id = ?', [avatar.id]);
  getDb().run('DELETE FROM AvatarRelationships WHERE target_id = ?', [avatar.id]);
  res.json({ success: true });
});

router.get('/avatars/:id/export', (req, res) => {
  const avatar = getDb().get('SELECT name, handle, private_bio, public_bio, auto_interval, vote_chance, reply_chance, is_auto_enabled FROM Avatars WHERE id = ?', [req.params.id]);
  if (!avatar) {
    return res.status(404).json({ error: 'Avatar not found' });
  }
  // Exclude id from export to avoid duplicate key errors on import
  const { id, ...avatarData } = avatar;
  res.json({ type: 'avatar', data: avatarData });
});

module.exports = router;
