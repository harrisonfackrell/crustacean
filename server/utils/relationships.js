/**
 * Relationship system for Avatars.
 * NewScore = OldScore + (Delta * ImpactFactor) / (1 + |OldScore|)
 * 
 * Upvotes increase the score, downvotes decrease it.
 * The acting Avatar is impacted more than the target Avatar.
 */

function updateRelationship(db, actorId, targetId, delta, actorImpactFactor = 2, targetImpactFactor = 1) {
  // Prevent self-relationships
  if (actorId === targetId) return;

  // Update actor -> target relationship
  const actorRel = db.get(
    'SELECT score FROM AvatarRelationships WHERE actor_id = ? AND target_id = ?',
    [actorId, targetId]
  );

  if (actorRel) {
    const newScore = actorRel.score + (delta * actorImpactFactor) / (1 + Math.abs(actorRel.score));
    db.run(
      'UPDATE AvatarRelationships SET score = ? WHERE actor_id = ? AND target_id = ?',
      [newScore, actorId, targetId]
    );
  } else {
    const newScore = (delta * actorImpactFactor) / (1 + 0); // |0| = 0
    db.run(
      'INSERT INTO AvatarRelationships (actor_id, target_id, score) VALUES (?, ?, ?)',
      [actorId, targetId, newScore]
    );
  }

  // Update target -> actor relationship (reverse direction)
  const targetRel = db.get(
    'SELECT score FROM AvatarRelationships WHERE actor_id = ? AND target_id = ?',
    [targetId, actorId]
  );

  if (targetRel) {
    const newScore = targetRel.score + (delta * targetImpactFactor) / (1 + Math.abs(targetRel.score));
    db.run(
      'UPDATE AvatarRelationships SET score = ? WHERE actor_id = ? AND target_id = ?',
      [newScore, targetId, actorId]
    );
  } else {
    const newScore = (delta * targetImpactFactor) / (1 + 0);
    db.run(
      'INSERT INTO AvatarRelationships (actor_id, target_id, score) VALUES (?, ?, ?)',
      [targetId, actorId, newScore]
    );
  }
}

module.exports = { updateRelationship };
