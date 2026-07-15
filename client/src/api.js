const API_BASE = '/api';

async function request(method, path, body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || 'Request failed');
  }
  return response.json();
}

export const api = {
  // Settings
  getSettings: () => request('GET', '/settings'),
  setSetting: (key, value) => request('PUT', '/settings', { key, value }),

  // Auto-Interact
  startAutoInteract: () => request('POST', '/auto-interact/start'),
  stopAutoInteract: () => request('POST', '/auto-interact/stop'),
  runAutoInteractOnce: (avatarId) => request('POST', '/auto-interact/run-once', { avatar_id: avatarId }),

  // Avatars
  getAvatars: () => request('GET', '/avatars'),
  getAvatar: (id) => request('GET', `/avatars/${id}`),
  createAvatar: (data) => request('POST', '/avatars', data),
  updateAvatar: (id, data) => request('PUT', `/avatars/${id}`, data),
  deleteAvatar: (id) => request('DELETE', `/avatars/${id}`),
  resetAvatar: (id) => request('POST', `/avatars/${id}/reset`),
  exportAvatar: (id) => request('GET', `/avatars/${id}/export`),

  // Communities
  getCommunities: () => request('GET', '/communities'),
  getCommunity: (id, sort = 'hot') => {
    const params = new URLSearchParams({ sort });
    return request('GET', `/communities/${id}?${params}`);
  },
  createCommunity: (data) => request('POST', '/communities', data),
  updateCommunity: (id, data) => request('PUT', `/communities/${id}`, data),
  deleteCommunity: (id) => request('DELETE', `/communities/${id}`),
  resetCommunity: (id) => request('POST', `/communities/${id}/reset`),
  exportCommunity: (id) => request('GET', `/communities/${id}/export`),

  // Posts
  getPost: (id, sort = 'hot') => {
    const params = new URLSearchParams({ sort });
    return request('GET', `/posts/${id}?${params}`);
  },
  createPost: (data) => request('POST', '/posts', data),
  deletePost: (id) => request('DELETE', `/posts/${id}`),

  // Comments
  createComment: (data) => request('POST', '/comments', data),
  deleteComment: (id) => request('DELETE', `/comments/${id}`),
  checkComment: (avatarId, postId, parentCommentId = null) => {
    const params = new URLSearchParams({ parent_comment_id: parentCommentId || '' });
    return request('GET', `/comments/check/${avatarId}/${postId}?${params}`);
  },

  // Votes
  createVote: (data) => request('POST', '/votes', data),
  getVote: (targetType, targetId, avatarId) => request('GET', `/votes/${targetType}/${targetId}/${avatarId}`),
  getVotesOnTarget: (targetType, targetId) => request('GET', `/votes/target/${targetType}/${targetId}`),
  deleteVote: (id) => request('DELETE', `/votes/${id}`),

  // Global Rules
  getGlobalRules: () => request('GET', '/global-rules'),
  addGlobalRule: (rule) => request('POST', '/global-rules', { rule }),
  deleteGlobalRule: (id) => request('DELETE', `/global-rules/${id}`),

  // Import/Export
  importData: (data) => request('POST', '/import', { data }),
  exportAll: () => request('GET', '/export/all'),

  // Global Reset
  resetAll: () => request('POST', '/reset/all'),

  // LLM Generation
  generatePost: (data) => request('POST', '/llm/generate-post', data),
  generateComment: (data) => request('POST', '/llm/generate-comment', data),
  generateVote: (data) => request('POST', '/llm/generate-vote', data),

  // Bulk Import Generation
  generateBulkImport: (data) => request('POST', '/llm/generate-bulk-import', data)
};
