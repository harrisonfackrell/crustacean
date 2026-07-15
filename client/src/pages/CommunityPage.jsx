import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import PostCard from '../components/PostCard';
import { useInteract } from '../hooks/useInteract';

function CommunityPage({ id: idProp }) {
  const { id: idFromParams } = useParams();
  const id = idProp || idFromParams;
  const isPseudoCommunity = id === 'all';
  const [community, setCommunity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', rules: '' });
  const [avatars, setAvatars] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [postModal, setPostModal] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState(null);
  const [postTitle, setPostTitle] = useState('');
  const [extraContext, setExtraContext] = useState('');
  const [length, setLength] = useState(3);
  const [generating, setGenerating] = useState(false);
  const [sort, setSort] = useState('hot');

  useEffect(() => {
    loadCommunity();
    if (!isPseudoCommunity) {
      loadAvatars();
    }
  }, [id, sort]);

  const loadAvatars = async () => {
    try {
      const data = await api.getAvatars();
      setAvatars(data);
    } catch (err) {
      console.error('Failed to load avatars:', err);
    }
  };

  const loadCommunity = async () => {
    try {
      const data = await api.getCommunity(id, sort);
      setCommunity(data);
      if (!isPseudoCommunity) {
        setForm({
          name: data.name,
          description: data.description,
          rules: Array.isArray(data.rules) ? data.rules.join('\n') : (data.rules ? JSON.parse(data.rules).join('\n') : '')
        });
      }
    } catch (err) {
      console.error('Failed to load community:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      const rulesArray = form.rules.split('\n').filter(r => r.trim());
      await api.updateCommunity(id, { name: form.name, description: form.description, rules: rulesArray });
      setEditing(false);
      loadCommunity();
    } catch (err) {
      console.error('Failed to save community:', err);
    }
  };

  const handleReset = async () => {
    if (!confirm('Reset all emergent data for this community? This cannot be undone.')) return;
    try {
      await api.resetCommunity(id);
      loadCommunity();
    } catch (err) {
      console.error('Failed to reset community:', err);
    }
  };

  const handleExport = async () => {
    try {
      const data = await api.exportCommunity(id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${form.name || 'community'}-export.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export community:', err);
    }
  };

  const handlePost = async () => {
    if (!selectedAvatar) return;
    setGenerating(true);
    try {
      const result = await api.generatePost({ avatar_id: selectedAvatar, community_id: id, extra_context: extraContext, title: postTitle, length });
      await api.createPost({ community_id: id, avatar_id: selectedAvatar, title: result.title, content: result.content });
      setPostModal(false);
      setSelectedAvatar(null);
      setPostTitle('');
      setExtraContext('');
      loadCommunity();
    } catch (err) {
      console.error('Failed to post:', err);
    } finally {
      setGenerating(false);
    }
  };

  const { voteOnPost } = useInteract(loadCommunity);

  if (loading) return <div className="loading">Loading...</div>;
  if (!community) return <div className="empty-state">Community not found</div>;

  return (
    <div className="container">
      <div className="community-header" style={{ position: 'relative' }}>
        <div className="community-banner"></div>
        {/* Three-dot menu over the banner - hidden while editing */}
        {!isPseudoCommunity && !editing && (
          <div style={{ position: 'absolute', top: '12px', right: '12px', zIndex: 10 }}>
            <button
              className="secondary"
              onClick={() => setMenuOpen(!menuOpen)}
              style={{ fontSize: '18px', padding: '4px 10px' }}
              aria-label="More options"
            >
              ⋮
            </button>
            {menuOpen && (
              <>
                <div className="modal-overlay" onClick={() => setMenuOpen(false)} />
                <div className="modal" style={{ position: 'absolute', top: '100%', right: 0, marginTop: '4px', minWidth: '300px', zIndex: 1000 }} onClick={e => e.stopPropagation()}>
                  <div className="modal-body" style={{ padding: '8px 8px' }}>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                      <button className="primary" style={{flex: 1}} onClick={() => { setEditing(true); setMenuOpen(false); }}>
                        ✏️ Edit
                      </button>
                      <button className="menu-item" style={{flex: 1}} onClick={() => { handleExport(); setMenuOpen(false); }}>
                        📤 Export
                      </button>
                      <button className="menu-item danger" style={{flex: 1}} onClick={() => { handleReset(); setMenuOpen(false); }}>
                        🔄 Reset
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
        <div className="community-header-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div className="community-icon">
                <span>c/</span>
              </div>
              <div className="community-info">
                <div className="community-name">{'c/' + community.name}</div>
              </div>
            </div>
          </div>

          {editing ? (
            <div style={{ marginTop: '16px' }}>
              <div className="form-group">
                <label>Name</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Rules (one per line)</label>
                <textarea value={form.rules} onChange={e => setForm({ ...form, rules: e.target.value })} style={{ minHeight: '150px' }} />
              </div>
            </div>
          ) : (
            <>
              {community.description && <div style={{ marginTop: '12px' }}>{community.description}</div>}
              {community.rules && Array.isArray(community.rules) && community.rules.length > 0 && (
                <div style={{ marginTop: '12px' }}>
                  <strong>{isPseudoCommunity ? 'Global Rules:' : 'Rules:'}</strong>
                  <ul style={{ marginTop: '8px', paddingLeft: '20px' }}>
                    {community.rules.map((rule, i) => (
                      <li key={i}>{rule}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {/* Sort / Edit controls - bottom-right of header, absolutely positioned to never add vertical space */}
          <div style={{ position: 'absolute', bottom: '24px', right: '24px', display: 'flex', justifyContent: 'flex-end', gap: '4px' }}>
            {editing ? (
              <>
                <button className="primary" onClick={handleSave}>Save</button>
                <button className="secondary" onClick={() => setEditing(false)}>Cancel</button>
              </>
            ) : (
              ['hot', 'new', 'top'].map(s => (
                <button
                  key={s}
                  className={sort === s ? 'primary' : 'secondary'}
                  onClick={() => setSort(s)}
                  style={{ textTransform: 'capitalize', fontSize: '13px', padding: '6px 14px' }}
                >
                  {s === 'hot' ? '🔥 ' : s === 'new' ? '🕐 ' : '📈 '}{s}
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Delimiter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: isPseudoCommunity ? 0 : '12px', margin: '16px 0 16px' }}>
        <div style={{ flex: 1, height: '1px', backgroundColor: '#e2e8f0' }} />
        {!isPseudoCommunity && (
          <button
            className="primary"
            onClick={() => { setPostModal(true); setSelectedAvatar(null); setPostTitle(''); setExtraContext(''); setLength(3); }}
            style={{ whiteSpace: 'nowrap' }}
          >
            📝 Post
          </button>
        )}
        <div style={{ flex: 1, height: '1px', backgroundColor: '#e2e8f0' }} />
      </div>

      {/* Posts */}
      {community.posts?.length === 0 ? (
        <div className="empty-state">No posts yet</div>
      ) : (
        community.posts.map(post => (
          <PostCard key={post.id} post={post} showCommunity={isPseudoCommunity} onVote={voteOnPost} avatars={avatars} />
        ))
      )}

      {/* Post Modal */}
      {postModal && (
        <div className="modal-overlay" onClick={() => setPostModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Select Avatar to Post</h3>
              <button onClick={() => setPostModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="avatar-selector">
                {avatars.map(a => (
                  <div
                    key={a.id}
                    className={`avatar-option ${selectedAvatar === a.id ? 'selected' : ''}`}
                    onClick={() => setSelectedAvatar(a.id)}
                  >
                    u/{a.handle}
                  </div>
                ))}
              </div>
              <div className="form-group" style={{ marginTop: '16px' }}>
                <label>Title (optional - LLM will generate one if left blank)</label>
                <input value={postTitle} onChange={e => setPostTitle(e.target.value)} placeholder="Enter a title for the post..." />
              </div>
              <div className="form-group" style={{ marginTop: '16px' }}>
                <label>Extra Context (optional)</label>
                <textarea value={extraContext} onChange={e => setExtraContext(e.target.value)} placeholder="Add any additional context for the LLM..." />
              </div>
              <div className="form-group" style={{ marginTop: '16px' }}>
                <label>Length: {length}</label>
                <input type="range" min="1" max="10" value={length} onChange={e => setLength(Number(e.target.value))} style={{ width: '100%' }} />
              </div>
              <div className="form-actions">
                <button className="primary" onClick={handlePost} disabled={!selectedAvatar || generating}>
                  {generating ? 'Generating...' : 'Post'}
                </button>
                <button className="secondary" onClick={() => setPostModal(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


export default CommunityPage;
