const express = require('express');
const { getDb } = require('./helpers');

const router = express.Router();

router.get('/global-rules', (req, res) => {
  const rules = getDb().all('SELECT * FROM GlobalRules ORDER BY id');
  res.json(rules);
});

router.post('/global-rules', (req, res) => {
  const { rule } = req.body;
  if (!rule) {
    return res.status(400).json({ error: 'rule is required' });
  }
  const db = getDb();
  db.run('INSERT INTO GlobalRules (rule) VALUES (?)', [rule]);
  res.json({ id: db.lastInsertRowid(), rule });
});

router.delete('/global-rules/:id', (req, res) => {
  getDb().run('DELETE FROM GlobalRules WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
