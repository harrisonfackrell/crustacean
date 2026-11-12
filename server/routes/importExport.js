const express = require('express');
const { getDb, sanitizeAvatarHandle, sanitizeCommunityName } = require('./helpers');
const { parseCommunityRules } = require('../services/enrichment');

const router = express.Router();

router.post('/import', (req, res) => {
  // Handle both wrapped format ({ data: ... }) and raw format (data is the export itself)
  const rawBody = req.body;
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

  const db = getDb();
  const results = [];

  for (const item of items) {
    try {
      if (item.type === 'avatar') {
        const { name, handle, private_bio, public_bio } = item.data;
        // Sanitize handle during import: remove spaces and special characters silently
        const sanitizedHandle = sanitizeAvatarHandle(handle);
        db.run(
          'INSERT OR IGNORE INTO Avatars (name, handle, private_bio, public_bio) VALUES (?, ?, ?, ?)',
          [name, sanitizedHandle, private_bio || '', public_bio || '']
        );
        results.push({ type: 'avatar', success: db.changes() > 0, skipped: db.changes() === 0 });
      } else if (item.type === 'community') {
        const { name, description, rules } = item.data;
        // Sanitize community name during import: remove spaces and special characters silently
        const sanitizedName = sanitizeCommunityName(name);
        // rules may already be an array (from /export/all) or a JSON string (from individual export)
        const rulesValue = typeof rules === 'string' ? rules : JSON.stringify(rules || []);
        // OR IGNORE + changes(): a community with an existing name is skipped,
        // not duplicated (Communities.name is UNIQUE since schema v5)
        db.run(
          'INSERT OR IGNORE INTO Communities (name, description, rules) VALUES (?, ?, ?)',
          [sanitizedName, description || '', rulesValue]
        );
        results.push({ type: 'community', success: db.changes() > 0, skipped: db.changes() === 0 });
      } else if (item.type === 'globalRule') {
        const { rule } = item.data;
        db.run('INSERT INTO GlobalRules (rule) VALUES (?)', [rule]);
        results.push({ type: 'globalRule', id: db.lastInsertRowid(), success: true });
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
  const db = getDb();
  const avatars = db.all('SELECT name, handle, private_bio, public_bio FROM Avatars ORDER BY id');
  const communities = db.all('SELECT name, description, rules FROM Communities ORDER BY id');
  const globalRules = db.all('SELECT rule FROM GlobalRules ORDER BY id');

  const formattedCommunities = communities.map(c => ({
    type: 'community',
    data: { ...c, rules: parseCommunityRules(c.rules) }
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

module.exports = router;
