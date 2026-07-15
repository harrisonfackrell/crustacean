import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import PostCard from '../components/PostCard';
import CommentItem from '../components/CommentItem';
import AvatarActionModal from '../components/AvatarActionModal';
import { useInteract } from '../hooks/useInteract';

function PostPage() {
  const { id } = useParams();
  const [post, setPost] = useState(null);
  const [avatars, setAvatars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // 'vote', 'comment', null
  const [postVotes, setPostVotes] = useState([]); // Track votes on this post
  const [sort, setSort] = useState('hot');

  useEffect(() => {
    loadData();
    loadPostVotes();
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
    } finally {
      setLoading(false);
    }
  };

  const loadPostVotes = async () => {
    try {
      const votes = await api.getVotesOnTarget('post', id);
      setPostVotes(votes);
    } catch (err) {
      // Silently fail - votes may not exist yet
    }
  };

  const { voteOnPost, voteOnComment, commentOnPost, commentOnComment } = useInteract(() => {
    loadData();
    loadPostVotes();
  });

  const handleUnvote = async (voteId) => {
    try {
      await api.deleteVote(voteId);
      loadData();
      loadPostVotes();
    } catch (err) {
      console.error('Failed to unvote:', err);
    }
  };

  const handleDeletePost = async () => {
    if (!confirm('Delete this post?')) return;
    try {
      await api.deletePost(id);
      window.history.back();
    } catch (err) {
      console.error('Failed to delete post:', err);
    }
  };

  const handleVote = async ({ selectedAvatar }) => {
    await voteOnPost(id, selectedAvatar);
    setModal(null);
  };

  const handleComment = async ({ selectedAvatar, extraContext, length }) => {
    await commentOnPost(id, selectedAvatar, extraContext, length);
    setModal(null);
  };

  const handleDeleteComment = async (commentId) => {
    if (!confirm('Delete this comment?')) return;
    try {
      await api.deleteComment(commentId);
      loadData();
    } catch (err) {
      console.error('Failed to delete comment:', err);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;
  if (!post) return <div className="empty-state">Post not found</div>;

  return (
    <div className="container">

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
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '24px 0 16px' }}>
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

      {post.comments?.map(comment => (
        <CommentItem
          key={comment.id}
          comment={comment}
          avatars={avatars}
          onVote={(commentId, avatarId) => voteOnComment(commentId, avatarId)}
          onComment={(commentId, length, avatarId) => commentOnComment(id, commentId, avatarId, length)}
          onDelete={handleDeleteComment}
        />
      ))}

      {/* Modals */}
      {modal === 'vote' && (
        <AvatarActionModal
          avatars={avatars}
          title="Select Avatar to Vote"
          actionLabel="Vote"
          onAction={handleVote}
          onClose={() => setModal(null)}
        />
      )}
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
