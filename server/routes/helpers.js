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
    c.avatar = getDb().get('SELECT name, handle FROM Avatars WHERE id = ?', [c.avatar_id]);
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

module.exports = {
  sanitizeCommunityName,
  sanitizeAvatarHandle,
  getVoteCount,
  getCommentCount,
  getCommentsForPost,
  sortPosts,
  sortComments,
  calculateHotness,
};
