const express = require('express');
const { getDatabase } = require('../db');

function getDb() {
  return getDatabase();
}

const router = express.Router();

// GLOBAL RESET
router.post('/reset/all', (req, res) => {
  getDb().run('DELETE FROM Posts');
  getDb().run('DELETE FROM Comments');
  getDb().run('DELETE FROM Votes');
  getDb().run('DELETE FROM AvatarCommunityPreferences');
  getDb().run('DELETE FROM AvatarRelationships');
  res.json({ success: true });
});

// DATABASE DESTROY (Resets ALL data - emergent AND non-emergent)
router.post('/destroy/database', (req, res) => {
  getDb().destroy();
  res.json({ success: true });
});

module.exports = router;
