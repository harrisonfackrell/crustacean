import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AvatarActionModal from './AvatarActionModal';
import { formatRelativeTime } from '../utils/time';

function PostCard({
  post,
  showCommunity = true,
  onDelete,
  onComment,
  onVote,
  avatars,
  showCommentCount = true,
}) {
  const navigate = useNavigate();
  const score = (post.upvotes || 0) - (post.downvotes || 0);
  const voteColor = score > 0 ? 'var(--color-upvote)' : score < 0 ? 'var(--color-downvote)' : 'var(--color-text-muted)';
  const [modal, setModal] = useState(null);
  const time = formatRelativeTime(post.created_at);

  // "Share" is the immersive vote mechanic: sharing content with an Avatar
  // provokes it to react. Both the arrows and the Share button open the
  // same avatar-selection modal.
  const openVoteModal = () => {
    if (onVote) setModal('vote');
  };

  const handleVote = async ({ selectedAvatar }) => {
    await onVote(post.id, selectedAvatar);
    setModal(null);
  };

  return (
    <div className="post-card">
      <div className="post-votes">
        <button onClick={openVoteModal} title="Share with an Avatar (vote up)" aria-label="Share upvote">▲</button>
        <span className="vote-count" style={{ color: voteColor }}>{score}</span>
        <button onClick={openVoteModal} title="Share with an Avatar (vote down)" aria-label="Share downvote">▼</button>
      </div>
      <div className="post-content">
        <div className="post-meta">
          <Link to={`/avatar/${post.avatar_id}`}>{'u/' + (post.avatar?.handle || 'deleted')}</Link>{' '}
          {showCommunity && (
            <>
              in <Link to={`/community/${post.community_id || 'all'}`}>{'c/' + (post.community?.name || 'All')}</Link>{' '}
            </>
          )}
          • <span title={time.title}>{time.label}</span>
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
