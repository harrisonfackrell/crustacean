import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import PostCard from '../components/PostCard';
import CommentItem from '../components/CommentItem';
import AvatarActionModal from '../components/AvatarActionModal';
import { useInteract } from '../hooks/useInteract';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';

function PostPage() {
  const { id } = useParams();
  const [post, setPost] = useState(null);
  const [avatars, setAvatars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // 'comment', null
  const [sort, setSort] = useState('hot');
  const { notify } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();

  useEffect(() => {
    loadData();
  }, [id, sort]);

  const loadData = async () => {
    try {
      const [postData, avatarData] = await Promise.all([
        api.getPost(id, sort),
        api.getAvatars()
      ]);
      setPost(postData);
      setAvatars(avatarData);
    } catch (err) {
      console.error('Failed to load post:', err);
      notify(err.message || 'Failed to load post', 'error');
    } finally {
      setLoading(false);
    }
  };

  const { voteOnPost, voteOnComment, commentOnPost, commentOnComment } = useInteract(() => {
    loadData();
  });

  const handleDeletePost = async () => {
    const ok = await confirm({
      title: 'Delete this post?',
      body: 'The post, its comments, and all related votes will be removed. This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deletePost(id);
      notify('Post deleted', 'success');
      window.history.back();
    } catch (err) {
      console.error('Failed to delete post:', err);
      notify(err.message || 'Failed to delete post', 'error');
    }
  };

  const handleComment = async ({ selectedAvatar, extraContext, length }) => {
    await commentOnPost(id, selectedAvatar, extraContext, length);
    setModal(null);
  };

  const handleDeleteComment = async (commentId) => {
    const ok = await confirm({
      title: 'Delete this comment?',
      body: 'This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteComment(commentId);
      notify('Comment deleted', 'success');
      loadData();
    } catch (err) {
      console.error('Failed to delete comment:', err);
      notify(err.message || 'Failed to delete comment', 'error');
    }
  };

  if (loading) return <div className="loading">Loading...</div>;
  if (!post) return <div className="empty-state">Post not found</div>;

  return (
    <div className="container">
      {confirmDialog}

      {/* Post */}
      <PostCard
        post={post}
        showCommunity={true}
        showCommentCount={false}
        onDelete={handleDeletePost}
        onComment={() => setModal('comment')}
        onVote={voteOnPost}
        avatars={avatars}
      />

      {/* Comments */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '16px 0 8px' }}>
        <div style={{ flex: 1, height: '1px', backgroundColor: '#e2e8f0' }} />
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b', whiteSpace: 'nowrap' }}>💬 {post.commentCount || 0} Comment{(post.commentCount || 0) !== 1 ? 's' : ''}</span>
        <div style={{ flex: 1, height: '1px', backgroundColor: '#e2e8f0' }} />
      </div>

      {/* Sort Selector for Comments */}
      <div style={{ display: 'flex', gap: '4px', margin: '0 0 16px' }}>
        {['hot', 'new', 'top'].map(s => (
          <button
            key={s}
            className={sort === s ? 'primary' : 'secondary'}
            onClick={() => setSort(s)}
            style={{ textTransform: 'capitalize', fontSize: '13px', padding: '6px 14px' }}
          >
            {s === 'hot' ? '🔥 ' : s === 'new' ? '🕐 ' : '📈 '}{s}
          </button>
        ))}
      </div>

      {!post.comments?.length ? (
        <div className="empty-state">
          <p>No comments yet</p>
          <button className="primary" style={{ marginTop: '12px' }} onClick={() => setModal('comment')}>
            Be the first to comment
          </button>
        </div>
      ) : (
        post.comments.map(comment => (
          <CommentItem
            key={comment.id}
            comment={comment}
            avatars={avatars}
            onVote={(commentId, avatarId) => voteOnComment(commentId, avatarId)}
            onComment={(commentId, extraContext, length, avatarId) => commentOnComment(id, commentId, avatarId, extraContext, length)}
            onDelete={handleDeleteComment}
          />
        ))
      )}

      {/* Modals */}
      {modal === 'comment' && (
        <AvatarActionModal
          avatars={avatars}
          title="Select Avatar to Comment"
          actionLabel="Comment"
          onAction={handleComment}
          onClose={() => setModal(null)}
          showLength={true}
        />
      )}
    </div>
  );
}

export default PostPage;
