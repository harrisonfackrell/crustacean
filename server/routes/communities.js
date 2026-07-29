const express = require('express');
const { getDatabase } = require('../db');
const { sanitizeCommunityName, getVoteCount, getCommentCount, getCommentsForPost, sortPosts, calculateHotness } = require('./helpers');

function getDb() {
  return getDatabase();
}

const router = express.Router();

router.get('/communities', (req, res) => {
  const communities = getDb().all('SELECT * FROM Communities');
  res.json(communities);
});

router.get('/communities/all', (req, res) => {
  const sort = req.query.sort || 'hot';
  // Pseudo-community: returns all posts from all communities
  let posts = getDb().all(
    'SELECT * FROM Posts ORDER BY created_at DESC'
  ).map(post => ({
    ...post,
    avatar: getDb().get('SELECT name, handle FROM Avatars WHERE id = ?', [post.avatar_id]),
    community: getDb().get('SELECT name FROM Communities WHERE id = ?', [post.community_id]),
    commentCount: getCommentCount(getDb, post.id),
    comments: getCommentsForPost(getDb, post.id, sort),
    hotness: calculateHotness(
      getVoteCount(getDb, 'post', post.id, 1),
      getVoteCount(getDb, 'post', post.id, -1),
      getCommentCount(getDb, post.id),
      post.created_at
    ),
    upvotes: getVoteCount(getDb, 'post', post.id, 1),
    downvotes: getVoteCount(getDb, 'post', post.id, -1)
  }));

  posts = sortPosts(posts, sort);

  const globalRules = getDb().all('SELECT rule FROM GlobalRules ORDER BY id');
  const rules = globalRules.map(r => r.rule);

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
  const community = getDb().get('SELECT * FROM Communities WHERE id = ?', [req.params.id]);
  if (!community) {
    return res.status(404).json({ error: 'Community not found' });
  }

  const sort = req.query.sort || 'hot';

  // Get posts
  let posts = getDb().all(
    'SELECT * FROM Posts WHERE community_id = ? ORDER BY created_at DESC',
    [community.id]
  ).map(post => ({
    ...post,
    avatar: getDb().get('SELECT name, handle FROM Avatars WHERE id = ?', [post.avatar_id]),
    commentCount: getCommentCount(getDb, post.id),
    comments: getCommentsForPost(getDb, post.id, sort),
    hotness: calculateHotness(
      getVoteCount(getDb, 'post', post.id, 1),
      getVoteCount(getDb, 'post', post.id, -1),
      getCommentCount(getDb, post.id),
      post.created_at
    ),
    upvotes: getVoteCount(getDb, 'post', post.id, 1),
    downvotes: getVoteCount(getDb, 'post', post.id, -1)
  }));

  posts = sortPosts(posts, sort);

  // Parse rules from JSON string to array (matching /communities/all behavior)
  const rules = community.rules ? JSON.parse(community.rules) : [];

  res.json({ ...community, rules, posts });
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
  getDb().run(
    'INSERT INTO Communities (name, description, rules) VALUES (?, ?, ?)',
    [sanitizedName, description || '', JSON.stringify(rules || [])]
  );
  const id = getDb().lastInsertRowid();
  res.json({ id, name: sanitizedName });
});

router.put('/communities/:id', (req, res) => {
  const community = getDb().get('SELECT * FROM Communities WHERE id = ?', [req.params.id]);
  if (!community) {
    return res.status(404).json({ error: 'Community not found' });
  }
  const { name, description, rules } = req.body;
  // Sanitize name if provided and different from existing
  let sanitizedName = name !== undefined ? sanitizeCommunityName(name) : community.name;
  if (name !== undefined && !sanitizedName) {
    return res.status(400).json({ error: 'community name must contain at least one valid character (a-z, 0-9, -)' });
  }
  getDb().run(
    'UPDATE Communities SET name = COALESCE(?, name), description = COALESCE(?, description), rules = COALESCE(?, rules) WHERE id = ?',
    [sanitizedName, description, rules !== undefined ? JSON.stringify(rules) : rules, community.id]
  );
  res.json({ success: true });
});

router.delete('/communities/:id', (req, res) => {
  getDb().run('DELETE FROM Communities WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

router.post('/communities/:id/reset', (req, res) => {
  const community = getDb().get('SELECT * FROM Communities WHERE id = ?', [req.params.id]);
  if (!community) {
    return res.status(404).json({ error: 'Community not found' });
  }
  // Clear emergent data for this community
  getDb().run('DELETE FROM Posts WHERE community_id = ?', [community.id]);
  getDb().run('DELETE FROM AvatarCommunityPreferences WHERE community_id = ?', [community.id]);
  res.json({ success: true });
});

router.get('/communities/:id/export', (req, res) => {
  const community = getDb().get('SELECT name, description, rules FROM Communities WHERE id = ?', [req.params.id]);
  if (!community) {
    return res.status(404).json({ error: 'Community not found' });
  }
  // Exclude id from export to avoid duplicate key errors on import
  const { id, ...communityData } = community;
  // Parse rules from JSON string to array for import compatibility
  const rules = communityData.rules ? JSON.parse(communityData.rules) : [];
  res.json({ type: 'community', data: { ...communityData, rules } });
});

module.exports = router;
