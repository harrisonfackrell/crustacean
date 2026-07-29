const express = require('express');
const { getDatabase } = require('../db');

function getDb() {
  return getDatabase();
}

const router = express.Router();

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

module.exports = router;
