const express = require('express');
const { getDb, resetAllEmergentData } = require('./helpers');

const router = express.Router();

// GLOBAL RESET
router.post('/reset/all', (req, res) => {
  resetAllEmergentData(getDb());
  res.json({ success: true });
});

// DATABASE DESTROY (Resets ALL data - emergent AND non-emergent)
router.post('/destroy/database', (req, res) => {
  getDb().destroy();
  res.json({ success: true });
});

module.exports = router;
