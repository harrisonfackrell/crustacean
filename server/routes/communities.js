const express = require('express');
const {
  getDb,
  sanitizeCommunityName,
  deletePostCascade,
  deleteCommunityCascade
} = require('./helpers');
const {
  enrichPosts,
  getCommentsForPost,
  parseCommunityRules,
  sortPosts
} = require('../services/enrichment');

/**
 * Fetch a community's posts (all of them, sorted) enriched with avatars,
 * vote counts, comment counts, hotness, and nested comment trees.
 * Used by both the pseudo-community endpoint and the per-community endpoint.
 */
function fetchPostsForCommunity(db, sort, communityId = null) {
  const sql = communityId === null
    ? 'SELECT * FROM Posts ORDER BY created_at DESC'
    : 'SELECT * FROM Posts WHERE community_id = ? ORDER BY created_at DESC';
  const params = communityId === null ? [] : [communityId];

  const posts = enrichPosts(db, db.all(sql, params));
  for (const post of posts) {
    post.comments = getCommentsForPost(db, post.id, sort);
  }
  return sortPosts(posts, sort);
}

const router = express.Router();

router.get('/communities', (req, res) => {
  const communities = getDb().all('SELECT * FROM Communities ORDER BY id');
  for (const community of communities) {
    community.rules = parseCommunityRules(community.rules);
  }
  res.json(communities);
});

router.get('/communities/all', (req, res) => {
  const db = getDb();
  const sort = req.query.sort || 'hot';

  const posts = fetchPostsForCommunity(db, sort);
  const rules = db.all('SELECT rule FROM GlobalRules ORDER BY id').map(r => r.rule);

  res.json({
    id: 'all',
    name: 'All',
    description: 'Every post from every community',
    rules,
    posts,
    isPseudoCommunity: true
  });
});

router.get('/communities/:id', (req, res) => {
  const db = getDb();
  const community = db.get('SELECT * FROM Communities WHERE id = ?', [req.params.id]);
  if (!community) {
    return res.status(404).json({ error: 'Community not found' });
  }

  const sort = req.query.sort || 'hot';
  const posts = fetchPostsForCommunity(db, sort, community.id);

  res.json({
    ...community,
    rules: parseCommunityRules(community.rules),
    posts
  });
});

router.post('/communities', (req, res) => {
  const { name, description, rules } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  const sanitizedName = sanitizeCommunityName(name);
  if (!sanitizedName) {
    return res.status(400).json({ error: 'community name must contain at least one valid character (a-z, 0-9, -)' });
  }
  const db = getDb();
  db.run(
    'INSERT INTO Communities (name, description, rules) VALUES (?, ?, ?)',
    [sanitizedName, description || '', JSON.stringify(rules || [])]
  );
  res.json({ id: db.lastInsertRowid(), name: sanitizedName });
});

router.put('/communities/:id', (req, res) => {
  const db = getDb();
  const community = db.get('SELECT * FROM Communities WHERE id = ?', [req.params.id]);
  if (!community) {
    return res.status(404).json({ error: 'Community not found' });
  }
  const { name, description, rules } = req.body;
  // Sanitize name if provided and different from existing
  let sanitizedName = community.name;
  if (name !== undefined) {
    sanitizedName = sanitizeCommunityName(name);
    if (!sanitizedName) {
      return res.status(400).json({ error: 'community name must contain at least one valid character (a-z, 0-9, -)' });
    }
  }
  db.run(
    'UPDATE Communities SET name = ?, description = COALESCE(?, description), rules = COALESCE(?, rules) WHERE id = ?',
    [sanitizedName, description, rules !== undefined ? JSON.stringify(rules) : undefined, community.id]
  );
  res.json({ success: true });
});

router.delete('/communities/:id', (req, res) => {
  deleteCommunityCascade(getDb(), req.params.id);
  res.json({ success: true });
});

router.post('/communities/:id/reset', (req, res) => {
  const db = getDb();
  const community = db.get('SELECT * FROM Communities WHERE id = ?', [req.params.id]);
  if (!community) {
    return res.status(404).json({ error: 'Community not found' });
  }
  // Clear emergent data for this community. Nested cascades run inline;
  // the outer transaction persists the whole reset in a single save.
  const postIds = db.all('SELECT id FROM Posts WHERE community_id = ?', [community.id]).map(r => r.id);
  db.transaction(() => {
    for (const postId of postIds) {
      deletePostCascade(db, postId);
    }
    db.run('DELETE FROM AvatarCommunityPreferences WHERE community_id = ?', [community.id]);
  });
  res.json({ success: true });
});

router.get('/communities/:id/export', (req, res) => {
  const db = getDb();
  const community = db.get('SELECT name, description, rules FROM Communities WHERE id = ?', [req.params.id]);
  if (!community) {
    return res.status(404).json({ error: 'Community not found' });
  }
  // Exclude id from export to avoid duplicate key errors on import
  const { id: _id, ...communityData } = community;
  res.json({ type: 'community', data: { ...communityData, rules: parseCommunityRules(communityData.rules) } });
});

module.exports = router;
