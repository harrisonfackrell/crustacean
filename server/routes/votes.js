const express = require('express');
const { getDatabase } = require('../db');
const { updateRelationship } = require('../utils/relationships');

function getDb() {
  return getDatabase();
}

const router = express.Router();

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

module.exports = router;
