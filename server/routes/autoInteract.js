const express = require('express');
const { getDatabase } = require('../db');
const { getAutoInteractService } = require('../services/auto-interact');

function getDb() {
  return getDatabase();
}

const router = express.Router();

router.get('/auto-interact/status', (req, res) => {
  const autoInteract = getAutoInteractService();
  res.json({ running: autoInteract.running });
});

router.post('/auto-interact/start', (req, res) => {
  const autoInteract = getAutoInteractService();
  autoInteract.start();
  res.json({ success: true });
});

router.post('/auto-interact/stop', (req, res) => {
  const autoInteract = getAutoInteractService();
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

module.exports = router;
