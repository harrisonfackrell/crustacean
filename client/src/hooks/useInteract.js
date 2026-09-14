import { useState } from 'react';
import { api } from '../api';

export function useInteract(onReload) {
  const [generating, setGenerating] = useState(false);

  const voteOnPost = async (postId, selectedAvatar) => {
    setGenerating(true);
    try {
      const result = await api.generateVote({ avatar_id: selectedAvatar, target_type: 'post', target_id: postId });
      await api.createVote({ avatar_id: selectedAvatar, target_type: 'post', target_id: postId, vote_value: result.vote_value });
      await onReload();
    } catch (err) {
      console.error('Failed to vote on post:', err);
    } finally {
      setGenerating(false);
    }
  };

  const voteOnComment = async (commentId, selectedAvatar) => {
    setGenerating(true);
    try {
      const result = await api.generateVote({ avatar_id: selectedAvatar, target_type: 'comment', target_id: commentId });
      await api.createVote({ avatar_id: selectedAvatar, target_type: 'comment', target_id: commentId, vote_value: result.vote_value });
      await onReload();
    } catch (err) {
      console.error('Failed to vote on comment:', err);
    } finally {
      setGenerating(false);
    }
  };

  const commentOnPost = async (postId, selectedAvatar, extraContext, length) => {
    setGenerating(true);
    try {
      const result = await api.generateComment({ avatar_id: selectedAvatar, target_type: 'post', target_id: postId, extra_context: extraContext, length });
      await api.createComment({ post_id: postId, avatar_id: selectedAvatar, content: result.content });
      await onReload();
    } catch (err) {
      if (err.message === 'Avatar has already replied here') {
        console.warn('Avatar already replied to this post');
      } else {
        console.error('Failed to comment on post:', err);
      }
    } finally {
      setGenerating(false);
    }
  };

  const commentOnComment = async (postId, commentId, selectedAvatar, extraContext, length) => {
    setGenerating(true);
    try {
      const result = await api.generateComment({ avatar_id: selectedAvatar, target_type: 'comment', target_id: commentId, extra_context: extraContext, length });
      await api.createComment({ post_id: postId, parent_comment_id: commentId, avatar_id: selectedAvatar, content: result.content });
      await onReload();
    } catch (err) {
      if (err.message === 'Avatar has already replied here') {
        console.warn('Avatar already replied to this comment');
      } else {
        console.error('Failed to reply to comment:', err);
      }
    } finally {
      setGenerating(false);
    }
  };

  return {
    generating,
    voteOnPost,
    voteOnComment,
    commentOnPost,
    commentOnComment,
  };
}
