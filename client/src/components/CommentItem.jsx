import { useState } from 'react';
import { Link } from 'react-router-dom';
import AvatarActionModal from './AvatarActionModal';

function CommentItem({ comment, avatars, onVote, onComment, onDelete }) {
  const [modal, setModal] = useState(null);

  const score = (comment.upvotes || 0) - (comment.downvotes || 0);
  const scoreColor = score > 0 ? 'var(--color-upvote)' : score < 0 ? 'var(--color-downvote)' : 'var(--color-text-muted)';

  const handleVote = async ({ selectedAvatar }) => {
    await onVote(comment.id, selectedAvatar);
    setModal(null);
  };

  const handleComment = async ({ selectedAvatar, length }) => {
    await onComment(comment.id, length, selectedAvatar);
    setModal(null);
  };

  return (
    <div className="comment-card">
      <div className="comment-header">
        <div className="comment-meta">
          <Link to={`/avatar/${comment.avatar?.id}`}>{'u/' + comment.avatar?.handle || 'Unknown'}</Link>{' '}
          • <span style={{ color: scoreColor }}>{score}</span> • {new Date(comment.created_at).toLocaleString()}
        </div>
      </div>
      <div className="comment-text">{comment.content}</div>
      <div className="comment-actions">
        <button onClick={() => setModal('vote')}>
          ↗ Share
        </button>
        <button onClick={() => setModal('comment')}>
          💬 Reply
        </button>
        {onDelete && (
          <button onClick={() => onDelete(comment.id)} style={{ color: 'var(--color-danger)' }}>
            🗑 Delete
          </button>
        )}
      </div>

      {/* Nested Replies */}
      {comment.replies?.length > 0 && (
        <div className="comment-replies">
          {comment.replies.map(reply => (
            <CommentItem
              key={reply.id}
              comment={reply}
              avatars={avatars}
              onVote={onVote}
              onComment={onComment}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {modal === 'vote' && (
        <AvatarActionModal
          avatars={avatars}
          title="Vote on Comment"
          actionLabel="Vote"
          onAction={handleVote}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'comment' && (
        <AvatarActionModal
          avatars={avatars}
          title="Reply to Comment"
          actionLabel="Reply"
          onAction={handleComment}
          onClose={() => setModal(null)}
          showLength={true}
        />
      )}
    </div>
  );
}

export default CommentItem;
