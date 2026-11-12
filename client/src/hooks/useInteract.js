import { useState, useCallback } from 'react';
import { api } from '../api';

/**
 * Interaction actions that drive the LLM (vote / comment / reply).
 * Each action reloads the view on success. On failure we log and
 * re-throw: the calling AvatarActionModal is responsible for surfacing the
 * error to the user via a toast and for keeping the modal open.
 */
export function useInteract(onReload) {
  const [generating, setGenerating] = useState(false);

  const run = useCallback(async (fn) => {
    setGenerating(true);
    try {
      await fn();
      await onReload();
    } catch (err) {
      console.error('Interaction failed:', err);
      throw err;
    } finally {
      setGenerating(false);
    }
  }, [onReload]);

  const voteOnPost = useCallback((postId, selectedAvatar) => run(async () => {
    const result = await api.generateVote({ avatar_id: selectedAvatar, target_type: 'post', target_id: postId });
    await api.createVote({ avatar_id: selectedAvatar, target_type: 'post', target_id: postId, vote_value: result.vote_value });
  }), [run]);

  const voteOnComment = useCallback((commentId, selectedAvatar) => run(async () => {
    const result = await api.generateVote({ avatar_id: selectedAvatar, target_type: 'comment', target_id: commentId });
    await api.createVote({ avatar_id: selectedAvatar, target_type: 'comment', target_id: commentId, vote_value: result.vote_value });
  }), [run]);

  const commentOnPost = useCallback((postId, selectedAvatar, extraContext, length) => run(async () => {
    const result = await api.generateComment({ avatar_id: selectedAvatar, target_type: 'post', target_id: postId, extra_context: extraContext, length });
    await api.createComment({ post_id: postId, avatar_id: selectedAvatar, content: result.content });
  }), [run]);

  const commentOnComment = useCallback((postId, commentId, selectedAvatar, extraContext, length) => run(async () => {
    const result = await api.generateComment({ avatar_id: selectedAvatar, target_type: 'comment', target_id: commentId, extra_context: extraContext, length });
    await api.createComment({ post_id: postId, parent_comment_id: commentId, avatar_id: selectedAvatar, content: result.content });
  }), [run]);

  return {
    generating,
    voteOnPost,
    voteOnComment,
    commentOnPost,
    commentOnComment,
  };
}
