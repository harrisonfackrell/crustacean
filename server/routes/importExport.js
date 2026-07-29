const express = require('express');
const { getDatabase } = require('../db');
const { sanitizeAvatarHandle, sanitizeCommunityName } = require('./helpers');

function getDb() {
  return getDatabase();
}

const router = express.Router();

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
        const { name, handle, private_bio, public_bio } = item.data;
        // Sanitize handle during import: remove spaces and special characters silently
        const sanitizedHandle = sanitizeAvatarHandle(handle);
        try {
          getDb().run(
            'INSERT OR IGNORE INTO Avatars (name, handle, private_bio, public_bio) VALUES (?, ?, ?, ?)',
            [name, sanitizedHandle, private_bio || '', public_bio || '']
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
  const avatars = getDb().all('SELECT name, handle, private_bio, public_bio FROM Avatars');
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

module.exports = router;
