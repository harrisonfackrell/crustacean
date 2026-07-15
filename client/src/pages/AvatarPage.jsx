import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import PostCard from '../components/PostCard';

function AvatarPage() {
  const { id } = useParams();
  const [avatar, setAvatar] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});

  useEffect(() => {
    loadAvatar();
  }, [id]);

  const loadAvatar = async () => {
    try {
      const data = await api.getAvatar(id);
      setAvatar(data);
      setForm({
        name: data.name,
        handle: data.handle,
        private_bio: data.private_bio,
        public_bio: data.public_bio,
        auto_interval: data.auto_interval,
        vote_chance: data.vote_chance,
        reply_chance: data.reply_chance,
        is_auto_enabled: data.is_auto_enabled
      });
    } catch (err) {
      console.error('Failed to load avatar:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      await api.updateAvatar(id, form);
      setEditing(false);
      loadAvatar();
    } catch (err) {
      console.error('Failed to save avatar:', err);
    }
  };

  const handleReset = async () => {
    if (!confirm('Reset all emergent data for this avatar? This cannot be undone.')) return;
    try {
      await api.resetAvatar(id);
      loadAvatar();
    } catch (err) {
      console.error('Failed to reset avatar:', err);
    }
  };

  const handleExport = async () => {
    try {
      const data = await api.exportAvatar(id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${form.handle || 'avatar'}-export.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export avatar:', err);
    }
  };

  const handleRunAutoInteract = async () => {
    try {
      await api.runAutoInteractOnce(id);
      loadAvatar();
    } catch (err) {
      console.error('Failed to run auto-interact:', err);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;
  if (!avatar) return <div className="empty-state">Avatar not found</div>;

  return (
    <div className="container">
      <div className="profile-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div>
              <div className="profile-name">{avatar.name}</div>
              <div className="profile-handle">u/{avatar.handle}</div>
            </div>
            <div className="profile-stats" style={{ display: 'flex', gap: '16px' }}>
              <div className="profile-stat">
                <div className="profile-stat-value">{avatar.karma || 0}</div>
                <div className="profile-stat-label">Karma</div>
              </div>
              <div className="profile-stat">
                <div className="profile-stat-value">{avatar.posts?.length || 0}</div>
                <div className="profile-stat-label">Posts</div>
              </div>
              <div className="profile-stat">
                <div className="profile-stat-value">{avatar.comments?.length || 0}</div>
                <div className="profile-stat-label">Comments</div>
              </div>
              <div className="profile-stat">
                <div className="profile-stat-value">{avatar.friends?.length || 0}</div>
                <div className="profile-stat-label">Friends</div>
              </div>
              <div className="profile-stat">
                <div className="profile-stat-value">{avatar.foes?.length || 0}</div>
                <div className="profile-stat-label">Foes</div>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {!editing ? (
              <button className="secondary" onClick={() => setEditing(true)}>Edit</button>
            ) : (
              <>
                <button className="primary" onClick={handleSave}>Save</button>
                <button className="secondary" onClick={() => setEditing(false)}>Cancel</button>
              </>
            )}
            <button className="secondary" onClick={handleRunAutoInteract}>⚡ Run Auto-Interact</button>
            <button className="secondary" onClick={handleExport}>📤 Export</button>
            <button className="danger" onClick={handleReset}>🔄 Reset</button>
          </div>
        </div>

        {editing ? (
          <div style={{ marginTop: '16px' }}>
            <div className="form-group">
              <label>Name</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Handle</label>
              <input value={form.handle} onChange={e => setForm({ ...form, handle: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Private Bio</label>
              <textarea value={form.private_bio} onChange={e => setForm({ ...form, private_bio: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Public Bio</label>
              <textarea value={form.public_bio} onChange={e => setForm({ ...form, public_bio: e.target.value })} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
              <div className="form-group">
                <label>Auto Interval (min)</label>
                <input type="number" value={form.auto_interval} onChange={e => setForm({ ...form, auto_interval: parseInt(e.target.value) })} />
              </div>
              <div className="form-group">
                <label>Vote Chance (0-1)</label>
                <input type="number" step="0.1" min="0" max="1" value={form.vote_chance} onChange={e => setForm({ ...form, vote_chance: parseFloat(e.target.value) })} />
              </div>
              <div className="form-group">
                <label>Reply Chance (0-1)</label>
                <input type="number" step="0.1" min="0" max="1" value={form.reply_chance} onChange={e => setForm({ ...form, reply_chance: parseFloat(e.target.value) })} />
              </div>
            </div>
            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={!!form.is_auto_enabled}
                  onChange={e => setForm({ ...form, is_auto_enabled: e.target.checked ? 1 : 0 })}
                />{' '}
                Auto-Interact Enabled
              </label>
            </div>
          </div>
        ) : (
          <>
            <div style={{ marginTop: '8px' }}>{avatar.public_bio || 'Not set'}</div>
          </>
        )}
      </div>

      {/* Friends & Foes */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '16px' }}>
        <div className="card">
          <div className="card-header"><h3>Friends</h3></div>
          <div className="card-body">
            {avatar.friends?.length === 0 ? (
              <p className="empty-state">No friends yet</p>
            ) : (
              avatar.friends.map(f => (
                <div key={f.id} style={{ padding: '4px 0', display: 'flex', justifyContent: 'space-between' }}>
                  <Link to={`/avatar/${f.id}`}>u/{f.handle}</Link>
                  <span className="badge positive">{f.score.toFixed(1)}</span>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3>Foes</h3></div>
          <div className="card-body">
            {avatar.foes?.length === 0 ? (
              <p className="empty-state">No foes yet</p>
            ) : (
              avatar.foes.map(f => (
                <div key={f.id} style={{ padding: '4px 0', display: 'flex', justifyContent: 'space-between' }}>
                  <Link to={`/avatar/${f.id}`}>u/{f.handle}</Link>
                  <span className="badge negative">{f.score.toFixed(1)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Post History */}
      <div className="card" style={{ marginTop: '16px' }}>
        <div className="card-header"><h3>Post History</h3></div>
        <div className="card-body">
          {avatar.posts?.length === 0 ? (
            <p className="empty-state">No posts yet</p>
          ) : (
            avatar.posts.map(p => {
              const score = (p.upvotes || 0) - (p.downvotes || 0);
              const voteColor = score > 0 ? 'var(--color-upvote)' : score < 0 ? 'var(--color-downvote)' : 'var(--color-text-muted)';
              const scoreColor = score > 0 ? 'var(--color-upvote)' : score < 0 ? 'var(--color-downvote)' : 'var(--color-text-muted)';
              return (
                <div key={p.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    {/* Vote display */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '32px', paddingTop: '2px' }}>
                      <span style={{ fontSize: '12px', color: voteColor, lineHeight: 1 }}>▲</span>
                      <span style={{ fontWeight: 700, fontSize: '13px', color: scoreColor, margin: '2px 0' }}>{score}</span>
                      <span style={{ fontSize: '12px', color: voteColor, lineHeight: 1 }}>▼</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Community and post title */}
                      <div className="post-meta" style={{ marginBottom: '4px' }}>
                        <Link to={`/community/${p.community?.id || 'all'}`}>c/{p.community?.name || 'Unknown'}</Link>
                        {p.title && (
                          <Link to={`/post/${p.id}`} style={{ fontWeight: 600, color: 'var(--color-highlight)', marginLeft: '6px' }}>
                            {p.title}
                          </Link>
                        )}
                      </div>
                      {/* Post content - clickable */}
                      <Link to={`/post/${p.id}`}>
                        <div className="post-text" style={{ fontSize: '13px' }}>{p.content}</div>
                      </Link>
                      <div className="post-meta">{new Date(p.created_at).toLocaleString()}</div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Comment History */}
      <div className="card" style={{ marginTop: '16px' }}>
        <div className="card-header"><h3>Comment History</h3></div>
        <div className="card-body">
          {avatar.comments?.length === 0 ? (
            <p className="empty-state">No comments yet</p>
          ) : (
            avatar.comments.map(c => {
              const score = (c.upvotes || 0) - (c.downvotes || 0);
              const voteColor = score > 0 ? 'var(--color-upvote)' : score < 0 ? 'var(--color-downvote)' : 'var(--color-text-muted)';
              const scoreColor = score > 0 ? 'var(--color-upvote)' : score < 0 ? 'var(--color-downvote)' : 'var(--color-text-muted)';
              return (
                <div key={c.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    {/* Vote display */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '32px', paddingTop: '2px' }}>
                      <span style={{ fontSize: '12px', color: voteColor, lineHeight: 1 }}>▲</span>
                      <span style={{ fontWeight: 700, fontSize: '13px', color: scoreColor, margin: '2px 0' }}>{score}</span>
                      <span style={{ fontSize: '12px', color: voteColor, lineHeight: 1 }}>▼</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Community and post title */}
                      <div className="post-meta" style={{ marginBottom: '4px' }}>
                        <Link to={`/community/${c.community?.id || 'all'}`}>c/{c.community?.name || 'Unknown'}</Link>
                        {c.post_title && (
                          <Link to={`/post/${c.post_id}`} style={{ fontWeight: 600, color: 'var(--color-highlight)', marginLeft: '6px' }}>
                            {c.post_title}
                          </Link>
                        )}
                      </div>
                      {/* Comment content - clickable to post */}
                      <Link to={`/post/${c.post_id}`}>
                        <div className="post-text" style={{ fontSize: '13px' }}>{c.content}</div>
                      </Link>
                      <div className="post-meta">{new Date(c.created_at).toLocaleString()}</div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default AvatarPage;
