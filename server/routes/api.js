const express = require('express');
const { getDatabase } = require('../db');
const { getLLMService } = require('../services/llm');
const { getAutoInteractService } = require('../services/auto-interact');
const { updateRelationship } = require('../utils/relationships');
const { calculateHotness } = require('../utils/hotness');

// Sanitize community names: remove spaces and special characters, keep only alphanumeric and hyphens
function sanitizeCommunityName(name) {
  return name.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
}

// Sanitize avatar handles: remove spaces and special characters, keep only alphanumeric and underscores
function sanitizeAvatarHandle(handle) {
  return handle.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
}

const router = express.Router();

// Database is initialized by the server before routes are hit
function getDb() {
  return getDatabase();
}

// ============================================================
// SETTINGS
// ============================================================

router.get('/settings', (req, res) => {
  const settings = getDb().all('SELECT key, value FROM Settings');
  const settingsObj = {};
  settings.forEach(s => { settingsObj[s.key] = s.value; });
  res.json(settingsObj);
});

router.put('/settings', (req, res) => {
  const { key, value } = req.body;
  if (!key || value === undefined) {
    return res.status(400).json({ error: 'key and value are required' });
  }
  getDb().run('INSERT OR REPLACE INTO Settings (key, value) VALUES (?, ?)', [key, String(value)]);
  res.json({ success: true });
});

// ============================================================
// AUTO-INTERACT
// ============================================================

router.post('/auto-interact/start', (req, res) => {
  const autoInteract = getAutoInteractService();
  getDb().run('INSERT OR REPLACE INTO Settings (key, value) VALUES (?, ?)', ['auto_interact_enabled', 'true']);
  autoInteract.start();
  res.json({ success: true });
});

router.post('/auto-interact/stop', (req, res) => {
  const autoInteract = getAutoInteractService();
  getDb().run('INSERT OR REPLACE INTO Settings (key, value) VALUES (?, ?)', ['auto_interact_enabled', 'false']);
  autoInteract.stop();
  res.json({ success: true });
});

router.post('/auto-interact/run-once', async (req, res) => {
  const { avatar_id } = req.body;
  const autoInteract = getAutoInteractService();
  const avatar = getDb().get('SELECT * FROM Avatars WHERE id = ?', [avatar_id]);
  if (!avatar) {
    return res.status(404).json({ error: 'Avatar not found' });
  }
  try {
    await autoInteract.processAvatar(avatar);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// AVATARS
// ============================================================

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
    upvotes: getVoteCount('post', post.id, 1),
    downvotes: getVoteCount('post', post.id, -1),
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
      upvotes: getVoteCount('comment', comment.id, 1),
      downvotes: getVoteCount('comment', comment.id, -1),
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

// ============================================================
// COMMUNITIES
// ============================================================

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
    commentCount: getCommentCount(post.id),
    comments: getCommentsForPost(post.id, sort),
    hotness: calculateHotness(
      getVoteCount('post', post.id, 1),
      getVoteCount('post', post.id, -1),
      getCommentCount(post.id),
      post.created_at
    ),
    upvotes: getVoteCount('post', post.id, 1),
    downvotes: getVoteCount('post', post.id, -1)
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
    commentCount: getCommentCount(post.id),
    comments: getCommentsForPost(post.id, sort),
    hotness: calculateHotness(
      getVoteCount('post', post.id, 1),
      getVoteCount('post', post.id, -1),
      getCommentCount(post.id),
      post.created_at
    ),
    upvotes: getVoteCount('post', post.id, 1),
    downvotes: getVoteCount('post', post.id, -1)
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

// ============================================================
// POSTS
// ============================================================

router.get('/posts/:id', (req, res) => {
  const post = getDb().get('SELECT * FROM Posts WHERE id = ?', [req.params.id]);
  if (!post) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const sort = req.query.sort || 'hot';

  post.avatar = getDb().get('SELECT name, handle FROM Avatars WHERE id = ?', [post.avatar_id]);
  post.community = getDb().get('SELECT name FROM Communities WHERE id = ?', [post.community_id]);
  post.upvotes = getVoteCount('post', post.id, 1);
  post.downvotes = getVoteCount('post', post.id, -1);
  post.hotness = calculateHotness(post.upvotes, post.downvotes, post.commentCount || 0, post.created_at);

  // Get comments
  const comments = getCommentsForPost(post.id, sort);
  post.comments = comments;
  post.commentCount = getCommentCount(post.id);

  res.json(post);
});

router.post('/posts', (req, res) => {
  const { community_id, avatar_id, title, content } = req.body;
  if (!community_id || !avatar_id || !content) {
    return res.status(400).json({ error: 'community_id, avatar_id, and content are required' });
  }
  getDb().run(
    'INSERT INTO Posts (community_id, avatar_id, title, content) VALUES (?, ?, ?, ?)',
    [community_id, avatar_id, title || '', content]
  );
  const id = getDb().lastInsertRowid();
  res.json({ id });
});

router.delete('/posts/:id', (req, res) => {
  getDb().run('DELETE FROM Posts WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ============================================================
// COMMENTS
// ============================================================

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
  getDb().run(
    'INSERT INTO Comments (post_id, parent_comment_id, avatar_id, content) VALUES (?, ?, ?, ?)',
    [post_id, parent_comment_id || null, avatar_id, content]
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

// ============================================================
// VOTES
// ============================================================

router.post('/votes', (req, res) => {
  const { avatar_id, target_type, target_id, vote_value } = req.body;
  if (!avatar_id || !target_type || !target_id || !vote_value) {
    return res.status(400).json({ error: 'avatar_id, target_type, target_id, and vote_value are required' });
  }
  if (!['post', 'comment'].includes(target_type)) {
    return res.status(400).json({ error: 'target_type must be "post" or "comment"' });
  }
  if (![1, -1].includes(vote_value)) {
    return res.status(400).json({ error: 'vote_value must be 1 or -1' });
  }

  // Check if a vote already exists for this avatar on this target
  const existingVote = getDb().get(
    'SELECT id, vote_value FROM Votes WHERE avatar_id = ? AND target_type = ? AND target_id = ?',
    [avatar_id, target_type, target_id]
  );

  if (existingVote) {
    // Update existing vote
    getDb().run(
      'UPDATE Votes SET vote_value = ? WHERE id = ?',
      [vote_value, existingVote.id]
    );
    // If the vote value changed, update the relationship accordingly
    if (existingVote.vote_value !== vote_value) {
      const targetAvatarId = target_type === 'post'
        ? getDb().get('SELECT avatar_id FROM Posts WHERE id = ?', [target_id])?.avatar_id
        : getDb().get('SELECT avatar_id FROM Comments WHERE id = ?', [target_id])?.avatar_id;
      if (targetAvatarId) {
        updateRelationship(getDb(), avatar_id, targetAvatarId, vote_value);
      }
    }
    return res.json({ id: existingVote.id });
  }

  // Insert new vote
  getDb().run(
    'INSERT INTO Votes (avatar_id, target_type, target_id, vote_value) VALUES (?, ?, ?, ?)',
    [avatar_id, target_type, target_id, vote_value]
  );

  // Update relationships
  const targetAvatarId = target_type === 'post'
    ? getDb().get('SELECT avatar_id FROM Posts WHERE id = ?', [target_id])?.avatar_id
    : getDb().get('SELECT avatar_id FROM Comments WHERE id = ?', [target_id])?.avatar_id;

  if (targetAvatarId) {
    updateRelationship(getDb(), avatar_id, targetAvatarId, vote_value);
  }

  const id = getDb().lastInsertRowid();
  res.json({ id });
});

// Get all votes on a target (useful for showing which avatars have voted)
router.get('/votes/target/:target_type/:target_id', (req, res) => {
  const { target_type, target_id } = req.params;
  if (!['post', 'comment'].includes(target_type)) {
    return res.status(400).json({ error: 'target_type must be "post" or "comment"' });
  }
  const votes = getDb().all(
    'SELECT v.*, a.name, a.handle FROM Votes v JOIN Avatars a ON v.avatar_id = a.id WHERE v.target_type = ? AND v.target_id = ?',
    [target_type, target_id]
  );
  res.json(votes);
});

// Get existing vote for an avatar on a target
router.get('/votes/:target_type/:target_id/:avatar_id', (req, res) => {
  const { target_type, target_id, avatar_id } = req.params;
  if (!['post', 'comment'].includes(target_type)) {
    return res.status(400).json({ error: 'target_type must be "post" or "comment"' });
  }
  const vote = getDb().get(
    'SELECT * FROM Votes WHERE avatar_id = ? AND target_type = ? AND target_id = ?',
    [avatar_id, target_type, target_id]
  );
  if (!vote) {
    return res.status(404).json({ error: 'No vote found' });
  }
  res.json(vote);
});

// Delete a vote (unvote)
router.delete('/votes/:id', (req, res) => {
  const vote = getDb().get('SELECT * FROM Votes WHERE id = ?', [req.params.id]);
  if (!vote) {
    return res.status(404).json({ error: 'Vote not found' });
  }
  getDb().run('DELETE FROM Votes WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ============================================================
// GLOBAL RULES
// ============================================================

router.get('/global-rules', (req, res) => {
  const rules = getDb().all('SELECT * FROM GlobalRules ORDER BY id');
  res.json(rules);
});

router.post('/global-rules', (req, res) => {
  const { rule } = req.body;
  if (!rule) {
    return res.status(400).json({ error: 'rule is required' });
  }
  getDb().run('INSERT INTO GlobalRules (rule) VALUES (?)', [rule]);
  const id = getDb().lastInsertRowid();
  res.json({ id, rule });
});

router.delete('/global-rules/:id', (req, res) => {
  getDb().run('DELETE FROM GlobalRules WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ============================================================
// IMPORT / EXPORT
// ============================================================

router.post('/import', (req, res) => {
  // Handle both wrapped format ({ data: ... }) and raw format (data is the export itself)
  const rawBody = req.body;
  // If rawBody.type === 'full_export', it's a raw export - use rawBody directly
  // If rawBody.data exists but rawBody.type doesn't, it's wrapped format
  let data = rawBody.type === 'full_export' ? rawBody : (rawBody.data !== undefined ? rawBody.data : rawBody);
  if (!data) {
    return res.status(400).json({ error: 'data is required' });
  }

  // Handle both flat array format and nested full_export format
  let items;
  if (data.type === 'full_export') {
    // Nested format from /export/all - flatten it
    items = [
      ...(data.data.avatars || []),
      ...(data.data.communities || []),
      ...(data.data.globalRules || [])
    ];
  } else {
    // Flat array format
    items = Array.isArray(data) ? data : [data];
  }

  const results = [];

  for (const item of items) {
    try {
      if (item.type === 'avatar') {
        const { name, handle, private_bio, public_bio, auto_interval, vote_chance, reply_chance, is_auto_enabled } = item.data;
        // Sanitize handle during import: remove spaces and special characters silently
        const sanitizedHandle = sanitizeAvatarHandle(handle);
        try {
          getDb().run(
            'INSERT OR IGNORE INTO Avatars (name, handle, private_bio, public_bio, auto_interval, vote_chance, reply_chance, is_auto_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [name, sanitizedHandle, private_bio || '', public_bio || '', auto_interval || 5, vote_chance || 0.5, reply_chance || 0.5, is_auto_enabled !== undefined ? is_auto_enabled : 1]
          );
          // Check if the row was actually inserted (lastInsertRowid returns 0 on IGNORE)
          const id = getDb().lastInsertRowid();
          results.push({ type: 'avatar', id, success: id > 0 });
        } catch (error) {
          results.push({ type: 'avatar', success: false, error: error.message });
        }
      } else if (item.type === 'community') {
        const { name, description, rules } = item.data;
        // Sanitize community name during import: remove spaces and special characters silently
        const sanitizedName = sanitizeCommunityName(name);
        // rules may already be an array (from /export/all) or a JSON string (from individual export)
        const rulesValue = typeof rules === 'string' ? rules : JSON.stringify(rules || []);
        getDb().run(
          'INSERT INTO Communities (name, description, rules) VALUES (?, ?, ?)',
          [sanitizedName, description || '', rulesValue]
        );
        results.push({ type: 'community', id: getDb().lastInsertRowid(), success: true });
      } else if (item.type === 'globalRule') {
        const { rule } = item.data;
        getDb().run('INSERT INTO GlobalRules (rule) VALUES (?)', [rule]);
        results.push({ type: 'globalRule', id: getDb().lastInsertRowid(), success: true });
      } else {
        results.push({ type: item.type || 'unknown', success: false, error: 'Unknown type' });
      }
    } catch (error) {
      results.push({ type: item.type || 'unknown', success: false, error: error.message });
    }
  }

  res.json({ results });
});

router.get('/export/all', (req, res) => {
  const avatars = getDb().all('SELECT name, handle, private_bio, public_bio, auto_interval, vote_chance, reply_chance, is_auto_enabled FROM Avatars');
  const communities = getDb().all('SELECT name, description, rules FROM Communities');
  const globalRules = getDb().all('SELECT rule FROM GlobalRules');

  // Parse rules from JSON string to array for import compatibility
  const formattedCommunities = communities.map(c => ({
    type: 'community',
    data: { ...c, rules: c.rules ? JSON.parse(c.rules) : [] }
  }));

  const formattedAvatars = avatars.map(a => ({ type: 'avatar', data: a }));
  const formattedGlobalRules = globalRules.map(r => ({ type: 'globalRule', data: r }));

  res.json({
    type: 'full_export',
    data: {
      avatars: formattedAvatars,
      communities: formattedCommunities,
      globalRules: formattedGlobalRules
    }
  });
});

// ============================================================
// GLOBAL RESET
// ============================================================

router.post('/reset/all', (req, res) => {
  getDb().run('DELETE FROM Posts');
  getDb().run('DELETE FROM Comments');
  getDb().run('DELETE FROM Votes');
  getDb().run('DELETE FROM AvatarCommunityPreferences');
  getDb().run('DELETE FROM AvatarRelationships');
  res.json({ success: true });
});

// ============================================================
// LLM CONTENT GENERATION (Manual Provocation)
// ============================================================

router.post('/llm/generate-post', async (req, res) => {
  const { avatar_id, community_id, extra_context, title, length } = req.body;
  const avatar = getDb().get('SELECT * FROM Avatars WHERE id = ?', [avatar_id]);
  const community = getDb().get('SELECT * FROM Communities WHERE id = ?', [community_id]);
  const globalRules = getDb().all('SELECT rule FROM GlobalRules');

  if (!avatar || !community) {
    return res.status(404).json({ error: 'Avatar or Community not found' });
  }

  try {
    const result = await getLLMService().generateContent('post', avatar, null, community, globalRules, '', extra_context || '', title || '', Number(length) || 3);
    // If title was provided, result is just the content string
    if (title && title.trim()) {
      res.json({ title: title.trim(), content: result });
    } else {
      // LLM generated both title and content
      res.json({ title: result.title || '', content: result.content || result });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/llm/generate-comment', async (req, res) => {
  const { avatar_id, target_type, target_id, extra_context, length } = req.body;
  const avatar = getDb().get('SELECT * FROM Avatars WHERE id = ?', [avatar_id]);

  if (!avatar) {
    return res.status(404).json({ error: 'Avatar not found' });
  }

  let targetAvatar, community, context = '';

  if (target_type === 'post') {
    const post = getDb().get('SELECT * FROM Posts WHERE id = ?', [target_id]);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    community = getDb().get('SELECT * FROM Communities WHERE id = ?', [post.community_id]);
    targetAvatar = getDb().get('SELECT * FROM Avatars WHERE id = ?', [post.avatar_id]);
    context = `Post content: ${post.content}`;
  } else if (target_type === 'comment') {
    const comment = getDb().get('SELECT * FROM Comments WHERE id = ?', [target_id]);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    const post = getDb().get('SELECT * FROM Posts WHERE id = ?', [comment.post_id]);
    community = getDb().get('SELECT * FROM Communities WHERE id = ?', [post.community_id]);
    targetAvatar = getDb().get('SELECT * FROM Avatars WHERE id = ?', [comment.avatar_id]);
    context = `Post content: ${post.content}\nComment content: ${comment.content}`;
  }

  const globalRules = getDb().all('SELECT rule FROM GlobalRules');

  try {
    const content = await getLLMService().generateContent('comment', avatar, targetAvatar, community, globalRules, context, extra_context || '', '', Number(length) || 3);
    res.json({ content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/llm/generate-vote', async (req, res) => {
  const { avatar_id, target_type, target_id } = req.body;
  const avatar = getDb().get('SELECT * FROM Avatars WHERE id = ?', [avatar_id]);

  if (!avatar) {
    return res.status(404).json({ error: 'Avatar not found' });
  }

  let text;
  if (target_type === 'post') {
    const post = getDb().get('SELECT content FROM Posts WHERE id = ?', [target_id]);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    text = post.content;
  } else {
    const comment = getDb().get('SELECT content FROM Comments WHERE id = ?', [target_id]);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    text = comment.content;
  }

  try {
    const voteValue = await getLLMService().generateVote(avatar, text);
    res.json({ vote_value: voteValue });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// LLM BULK IMPORT GENERATION (Quick Start)
// ============================================================

router.post('/llm/generate-bulk-import', async (req, res) => {
  const { context, count, existingData } = req.body;
  const avatarCount = Number(count) || 3;

  if (!avatarCount || avatarCount < 1 || avatarCount > 10) {
    return res.status(400).json({ error: 'count must be between 1 and 10' });
  }

  try {
    const result = await getLLMService().generateBulkImport(context || '', avatarCount, existingData || null);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function getVoteCount(targetType, targetId, voteValue) {
  const result = getDb().get(
    'SELECT COUNT(*) as count FROM Votes WHERE target_type = ? AND target_id = ? AND vote_value = ?',
    [targetType, targetId, voteValue]
  );
  return result?.count || 0;
}

function getCommentCount(postId) {
  const result = getDb().get(
    'SELECT COUNT(*) as count FROM Comments WHERE post_id = ?',
    [postId]
  );
  return result?.count || 0;
}

function getCommentsForPost(postId, sort = 'hot') {
  const comments = getDb().all(
    'SELECT * FROM Comments WHERE post_id = ? ORDER BY created_at ASC',
    [postId]
  );

  // Build nested structure
  const topLevel = [];
  const map = {};

  comments.forEach(c => {
    c.avatar = getDb().get('SELECT name, handle FROM Avatars WHERE id = ?', [c.avatar_id]);
    c.upvotes = getVoteCount('comment', c.id, 1);
    c.downvotes = getVoteCount('comment', c.id, -1);
    c.hotness = calculateHotness(c.upvotes, c.downvotes, 0, c.created_at);
    c.score = c.upvotes - c.downvotes;
    c.replies = [];
    map[c.id] = c;
  });

  comments.forEach(c => {
    if (c.parent_comment_id && map[c.parent_comment_id]) {
      map[c.parent_comment_id].replies.push(c);
    } else {
      topLevel.push(c);
    }
  });

  // Sort top-level comments
  topLevel.sort(sortComments(sort));

  // Sort nested replies recursively
  const sortReplies = (comments) => {
    comments.forEach(c => {
      if (c.replies && c.replies.length > 0) {
        c.replies.sort(sortComments(sort));
        sortReplies(c.replies);
      }
    });
  };
  sortReplies(topLevel);

  return topLevel;
}

function sortPosts(posts, sort) {
  switch (sort) {
    case 'new':
      return posts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    case 'top':
      return posts.sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0));
    case 'hot':
    default:
      return posts.sort((a, b) => b.hotness - a.hotness);
  }
}

function sortComments(sort) {
  switch (sort) {
    case 'new':
      return (a, b) => new Date(b.created_at) - new Date(a.created_at);
    case 'top':
      return (a, b) => (b.score || 0) - (a.score || 0);
    case 'hot':
    default:
      return (a, b) => b.hotness - a.hotness;
  }
}

module.exports = router;
