import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AvatarActionModal from './AvatarActionModal';

function PostCard({
  post,
  showCommunity = true,
  onDelete,
  onComment,
  onVote,
  avatars,
  compact = false,
  showCommentCount = true,
}) {
  const navigate = useNavigate();
  const score = (post.upvotes || 0) - (post.downvotes || 0);
  const voteColor = score > 0 ? 'var(--color-upvote)' : score < 0 ? 'var(--color-downvote)' : 'var(--color-text-muted)';
  const [modal, setModal] = useState(null);

  const handleVote = async ({ selectedAvatar }) => {
    await onVote(post.id, selectedAvatar);
    setModal(null);
  };

  if (compact) {
    return (
      <div style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
        <Link to={`/post/${post.id}`}>
          <div className="post-text">{post.content}</div>
        </Link>
        <div className="post-meta">{new Date(post.created_at).toLocaleString()}</div>
      </div>
    );
  }

  return (
    <div className="post-card">
      <div className="post-votes">
        <button style={{ color: voteColor }}>▲</button>
        <span className="vote-count" style={{ color: voteColor }}>{score}</span>
        <button style={{ color: voteColor }}>▼</button>
      </div>
      <div className="post-content">
        <div className="post-meta">
          <Link to={`/avatar/${post.avatar_id}`}>{'u/' + post.avatar?.handle || 'Unknown'}</Link>{' '}
          {showCommunity && (
            <>
              in <Link to={`/community/${post.community_id || 'all'}`}>{'c/' + (post.community?.name || 'All')}</Link>{' '}
            </>
          )}
          • {new Date(post.created_at).toLocaleString()}
        </div>
        <Link to={`/post/${post.id}`}>
          {post.title && <div className="post-title">{post.title}</div>}
          <div className="post-text">{post.content}</div>
        </Link>
        <div className="post-actions">
          {onVote && (
            <button onClick={() => setModal('vote')}>↗ Share</button>
          )}
          <button onClick={() => onComment ? onComment() : navigate(`/post/${post.id}`)}>
            💬 {showCommentCount ? `${post.commentCount || 0} Comment${(post.commentCount || 0) !== 1 ? 's' : ''}` : 'Reply'}
          </button>
          {onDelete && (
            <button onClick={() => onDelete(post.id)} style={{ color: 'var(--color-danger)' }}>
              🗑 Delete
            </button>
          )}
        </div>
      </div>

      {/* Modals */}
      {modal === 'vote' && onVote && (
        <AvatarActionModal
          avatars={avatars}
          title="Select Avatar to Vote"
          actionLabel="Vote"
          onAction={handleVote}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

export default PostCard;
