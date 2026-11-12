const { getDatabase } = require('../db');

/**
 * Route-level helpers: input sanitization and cascade deletes.
 *
 * Data enrichment (vote counts, comment trees, sorting) lives in
 * services/enrichment.js so routes and the auto-interact service share one
 * implementation.
 */

// Sanitize community names: remove spaces and special characters, keep only alphanumeric and hyphens
function sanitizeCommunityName(name) {
  return name.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
}

// Sanitize avatar handles: remove spaces and special characters, keep only alphanumeric and underscores
function sanitizeAvatarHandle(handle) {
  return handle.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
}

// ============================================================
// Cascade delete helpers
//
// SQLite foreign keys are declared but not enforced (the sql.js
// connection never runs `PRAGMA foreign_keys = ON`), so deletes
// must be performed explicitly to avoid orphaned rows that the
// UI would otherwise render as "Unknown" / misleading links.
//
// Each cascade runs in one transaction, so the database is
// persisted to disk exactly once per cascade.
// ============================================================

/**
 * Delete a post and everything that references it (its comments,
 * and the votes cast on the post or on any of those comments).
 */
function deletePostCascade(db, postId) {
  db.transaction(() => {
    // Votes on the post's comments (must come before deleting comments)
    db.run(
      "DELETE FROM Votes WHERE target_type = 'comment' AND target_id IN (SELECT id FROM Comments WHERE post_id = ?)",
      [postId]
    );
    // Votes on the post itself
    db.run(
      "DELETE FROM Votes WHERE target_type = 'post' AND target_id = ?",
      [postId]
    );
    // Comments (replies to deleted comments are promoted to top-level by
    // the comment-tree builder, which is the desired UX)
    db.run('DELETE FROM Comments WHERE post_id = ?', [postId]);
    // The post
    db.run('DELETE FROM Posts WHERE id = ?', [postId]);
  });
}

/**
 * Delete a single comment and the votes cast on it. Replies to the
 * deleted comment are promoted to top-level by the comment-tree builder.
 */
function deleteCommentCascade(db, commentId) {
  db.transaction(() => {
    db.run(
      "DELETE FROM Votes WHERE target_type = 'comment' AND target_id = ?",
      [commentId]
    );
    db.run('DELETE FROM Comments WHERE id = ?', [commentId]);
  });
}

/**
 * Delete a community and all of its posts (plus the comments and votes
 * that belong to those posts), then the per-avatar community preferences.
 */
function deleteCommunityCascade(db, communityId) {
  db.transaction(() => {
    const postIds = db.all('SELECT id FROM Posts WHERE community_id = ?', [communityId]).map(r => r.id);
    for (const postId of postIds) {
      // Nested transaction: runs inline, saved once by the outer call
      deletePostCascade(db, postId);
    }
    db.run('DELETE FROM AvatarCommunityPreferences WHERE community_id = ?', [communityId]);
    db.run('DELETE FROM Communities WHERE id = ?', [communityId]);
  });
}

/**
 * Clear an avatar's emergent data: its posts (with their comments + votes),
 * its standalone comments, all votes involving its content (whether cast by
 * it or on it), its community preferences, and relationship records.
 * The avatar row itself is kept.
 */
function clearAvatarEmergentData(db, avatarId) {
  const postIds = db.all('SELECT id FROM Posts WHERE avatar_id = ?', [avatarId]).map(r => r.id);
  const commentIds = db.all('SELECT id FROM Comments WHERE avatar_id = ?', [avatarId]).map(r => r.id);

  db.transaction(() => {
    // 1. Delete the avatar's posts (cascades to their comments + votes)
    for (const postId of postIds) {
      deletePostCascade(db, postId);
    }

    // 2. Delete the avatar's remaining comments (on others' posts)
    db.run('DELETE FROM Comments WHERE avatar_id = ?', [avatarId]);

    // 3. Remove votes cast by OTHER avatars on the avatar's posts/comments
    //    (votes cast by the avatar itself are removed in step 4)
    if (postIds.length > 0) {
      const placeholders = postIds.map(() => '?').join(', ');
      db.run(
        `DELETE FROM Votes WHERE target_type = 'post' AND target_id IN (${placeholders}) AND avatar_id != ?`,
        [...postIds, avatarId]
      );
    }
    if (commentIds.length > 0) {
      const placeholders = commentIds.map(() => '?').join(', ');
      db.run(
        `DELETE FROM Votes WHERE target_type = 'comment' AND target_id IN (${placeholders}) AND avatar_id != ?`,
        [...commentIds, avatarId]
      );
    }

    // 4. Delete all votes cast by the avatar itself
    db.run('DELETE FROM Votes WHERE avatar_id = ?', [avatarId]);

    // 5. Preferences and relationships
    db.run('DELETE FROM AvatarCommunityPreferences WHERE avatar_id = ?', [avatarId]);
    db.run('DELETE FROM AvatarRelationships WHERE actor_id = ? OR target_id = ?', [avatarId, avatarId]);
  });
}

/**
 * Delete an avatar and all of the emergent data it produced.
 */
function deleteAvatarCascade(db, avatarId) {
  db.transaction(() => {
    clearAvatarEmergentData(db, avatarId);
    db.run('DELETE FROM Avatars WHERE id = ?', [avatarId]);
  });
}

/**
 * Delete all emergent data across the network (posts, comments, votes,
 * preferences, relationships). Avatars, communities, and settings are kept.
 */
function resetAllEmergentData(db) {
  db.transaction(() => {
    db.run('DELETE FROM Votes');
    db.run('DELETE FROM Comments');
    db.run('DELETE FROM Posts');
    db.run('DELETE FROM AvatarCommunityPreferences');
    db.run('DELETE FROM AvatarRelationships');
  });
}

module.exports = {
  getDb: getDatabase,
  sanitizeCommunityName,
  sanitizeAvatarHandle,
  deletePostCascade,
  deleteCommentCascade,
  deleteCommunityCascade,
  clearAvatarEmergentData,
  deleteAvatarCascade,
  resetAllEmergentData
};
