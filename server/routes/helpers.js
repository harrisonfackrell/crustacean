const { calculateHotness } = require('../utils/hotness');

// Sanitize community names: remove spaces and special characters, keep only alphanumeric and hyphens
function sanitizeCommunityName(name) {
  return name.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
}

// Sanitize avatar handles: remove spaces and special characters, keep only alphanumeric and underscores
function sanitizeAvatarHandle(handle) {
  return handle.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
}

function getVoteCount(getDb, targetType, targetId, voteValue) {
  const result = getDb().get(
    'SELECT COUNT(*) as count FROM Votes WHERE target_type = ? AND target_id = ? AND vote_value = ?',
    [targetType, targetId, voteValue]
  );
  return result?.count || 0;
}

function getCommentCount(getDb, postId) {
  const result = getDb().get(
    'SELECT COUNT(*) as count FROM Comments WHERE post_id = ?',
    [postId]
  );
  return result?.count || 0;
}

function getCommentsForPost(getDb, postId, sort = 'hot') {
  const comments = getDb().all(
    'SELECT * FROM Comments WHERE post_id = ? ORDER BY created_at ASC',
    [postId]
  );

  // Build nested structure
  const topLevel = [];
  const map = {};

  comments.forEach(c => {
    c.avatar = getDb().get('SELECT id, name, handle FROM Avatars WHERE id = ?', [c.avatar_id]);
    c.upvotes = getVoteCount(getDb, 'comment', c.id, 1);
    c.downvotes = getVoteCount(getDb, 'comment', c.id, -1);
    c.hotness = calculateHotness(c.upvotes, c.downvotes, 0, c.created_at);
    c.score = c.upvotes - c.downvotes;
    c.replies = [];
    map[c.id] = c;
  });

  comments.forEach(c => {
    if (c.parent_comment_id && map[c.parent_comment_id]) {
      map[c.parent_comment_id].replies.push(c);
    } else {
      topLevel.push(c);
    }
  });

  // Sort top-level comments
  topLevel.sort(sortComments(getDb, sort));

  // Sort nested replies recursively
  const sortReplies = (comments) => {
    comments.forEach(c => {
      if (c.replies && c.replies.length > 0) {
        c.replies.sort(sortComments(getDb, sort));
        sortReplies(c.replies);
      }
    });
  };
  sortReplies(topLevel);

  return topLevel;
}

function sortPosts(posts, sort) {
  switch (sort) {
    case 'new':
      return posts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    case 'top':
      return posts.sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0));
    case 'hot':
    default:
      return posts.sort((a, b) => b.hotness - a.hotness);
  }
}

function sortComments(getDb, sort) {
  switch (sort) {
    case 'new':
      return (a, b) => new Date(b.created_at) - new Date(a.created_at);
    case 'top':
      return (a, b) => (b.score || 0) - (a.score || 0);
    case 'hot':
    default:
      return (a, b) => b.hotness - a.hotness;
  }
}

// ============================================================
// Cascade delete helpers
//
// SQLite foreign keys are declared but not enforced (the sql.js
// connection never runs `PRAGMA foreign_keys = ON`), so deletes
// must be performed explicitly to avoid orphaned rows that the
// UI would otherwise render as "Unknown" / misleading links.
// ============================================================

/**
 * Delete a post and everything that references it (its comments,
 * and the votes cast on the post or on any of those comments).
 */
function deletePostCascade(getDb, postId) {
  const db = getDb();
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
  // Comments (children are removed alongside parents; replies to them are
  // promoted to top-level by getCommentsForPost, which is the desired UX)
  db.run('DELETE FROM Comments WHERE post_id = ?', [postId]);
  // The post
  db.run('DELETE FROM Posts WHERE id = ?', [postId]);
}

/**
 * Delete a community and all of its posts (plus the comments and votes
 * that belong to those posts), then the per-avatar community preferences.
 */
function deleteCommunityCascade(getDb, communityId) {
  const db = getDb();
  const postIds = db.all('SELECT id FROM Posts WHERE community_id = ?', [communityId]).map(r => r.id);

  if (postIds.length > 0) {
    // Delete posts one-by-one so each post's comments + votes are cleaned up
    for (const postId of postIds) {
      deletePostCascade(getDb, postId);
    }
  }

  db.run('DELETE FROM AvatarCommunityPreferences WHERE community_id = ?', [communityId]);
  db.run('DELETE FROM Communities WHERE id = ?', [communityId]);
}

/**
 * Delete an avatar and all emergent data it produced: its posts (with
 * their comments + votes), its standalone comments, all votes involving
 * its content (whether cast by it or on it), its community preferences,
 * and relationship records. Child comments that replied to a deleted
 * comment are promoted to top-level.
 */
function deleteAvatarCascade(getDb, avatarId) {
  const db = getDb();

  // Capture everything that will be deleted so we can clean up votes
  const postIds = db.all('SELECT id FROM Posts WHERE avatar_id = ?', [avatarId]).map(r => r.id);
  const commentIds = db.all('SELECT id FROM Comments WHERE avatar_id = ?', [avatarId]).map(r => r.id);

  // 1. Delete the avatar's posts (cascades to their comments + votes on them)
  for (const postId of postIds) {
    deletePostCascade(getDb, postId);
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

  // 6. The avatar itself
  db.run('DELETE FROM Avatars WHERE id = ?', [avatarId]);
}

module.exports = {
  sanitizeCommunityName,
  sanitizeAvatarHandle,
  getVoteCount,
  getCommentCount,
  getCommentsForPost,
  sortPosts,
  sortComments,
  calculateHotness,
  deletePostCascade,
  deleteCommunityCascade,
  deleteAvatarCascade,
};
