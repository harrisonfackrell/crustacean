import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import PostCard from '../components/PostCard';
import AvatarActionModal from '../components/AvatarActionModal';
import { useInteract } from '../hooks/useInteract';

function CommunityPage({ id: idProp }) {
  const { id: idFromParams } = useParams();
  const id = idProp || idFromParams;
  const isPseudoCommunity = id === 'all';
  const [community, setCommunity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', rules: [] });
  const [newRule, setNewRule] = useState('');
  const [avatars, setAvatars] = useState([]);
  const [avatarCount, setAvatarCount] = useState(0);
  const [communityCount, setCommunityCount] = useState(0);
  const [communitiesList, setCommunitiesList] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [globalRules, setGlobalRules] = useState([]);
  const [postModal, setPostModal] = useState(false);
  const [sort, setSort] = useState('top');

  useEffect(() => {
    loadCommunity();
    if (!isPseudoCommunity) {
      loadAvatars();
    } else {
      loadGlobalRules();
      loadAvatarCount();
      loadCommunityCount();
      loadCommunitiesList();
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

  const loadAvatarCount = async () => {
    try {
      const data = await api.getAvatars();
      setAvatarCount(data.length);
    } catch (err) {
      console.error('Failed to load avatar count:', err);
    }
  };

  const loadCommunityCount = async () => {
    try {
      const data = await api.getCommunities();
      setCommunityCount(data.length);
    } catch (err) {
      console.error('Failed to load community count:', err);
    }
  };

  const loadCommunitiesList = async () => {
    try {
      const data = await api.getCommunities();
      setCommunitiesList(data);
    } catch (err) {
      console.error('Failed to load communities list:', err);
    }
  };

  const loadGlobalRules = async () => {
    try {
      const rules = await api.getGlobalRules();
      setGlobalRules(rules);
    } catch (err) {
      console.error('Failed to load global rules:', err);
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
          rules: Array.isArray(data.rules) ? data.rules : (data.rules ? JSON.parse(data.rules) : [])
        });
      }
    } catch (err) {
      console.error('Failed to load community:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddRule = () => {
    if (!newRule.trim()) return;
    setForm({ ...form, rules: [...form.rules, newRule.trim()] });
    setNewRule('');
  };

  const handleRemoveRule = (index) => {
    setForm({ ...form, rules: form.rules.filter((_, i) => i !== index) });
  };

  const handleAddGlobalRule = async () => {
    if (!newRule.trim()) return;
    try {
      await api.addGlobalRule(newRule.trim());
      setNewRule('');
      loadGlobalRules();
      loadCommunity();
    } catch (err) {
      console.error('Failed to add global rule:', err);
    }
  };

  const handleDeleteGlobalRule = async (ruleId) => {
    try {
      await api.deleteGlobalRule(ruleId);
      loadGlobalRules();
      loadCommunity();
    } catch (err) {
      console.error('Failed to delete global rule:', err);
    }
  };

  const handleSave = async () => {
    if (isPseudoCommunity) {
      // For the pseudo-community, global rules are already persisted via API calls
      setEditing(false);
      setNewRule('');
      return;
    }
    try {
      await api.updateCommunity(id, { name: form.name, description: form.description, rules: form.rules });
      setEditing(false);
      setNewRule('');
      loadCommunity();
    } catch (err) {
      console.error('Failed to save community:', err);
    }
  };

  const handleReset = async () => {
    if (isPseudoCommunity) {
      if (!confirm('Reset ALL emergent data? This will clear all posts, comments, votes, and relationships. This cannot be undone.')) return;
      if (!confirm('Are you absolutely sure?')) return;
      try {
        await api.resetAll();
        loadCommunity();
      } catch (err) {
        console.error('Failed to reset:', err);
      }
    } else {
      if (!confirm('Reset all emergent data for this community? This cannot be undone.')) return;
      try {
        await api.resetCommunity(id);
        loadCommunity();
      } catch (err) {
        console.error('Failed to reset community:', err);
      }
    }
  };

  const handleExport = async () => {
    if (isPseudoCommunity) {
      try {
        const data = await api.exportAll();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'crustacean-export.json';
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error('Failed to export:', err);
      }
    } else {
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
    }
  };

  const handlePost = async ({ selectedAvatar, extraContext, length, inputTitle }) => {
    try {
      const result = await api.generatePost({ avatar_id: selectedAvatar, community_id: id, extra_context: extraContext, title: inputTitle, length });
      await api.createPost({ community_id: id, avatar_id: selectedAvatar, title: result.title, content: result.content });
      setPostModal(false);
      loadCommunity();
    } catch (err) {
      console.error('Failed to post:', err);
    }
  };

  const { voteOnPost } = useInteract(loadCommunity);

  const getSortedPosts = (posts, sortType) => {
    if (!posts) return [];
    if (sortType === 'top') {
      return [...posts].sort((a, b) => (b.commentCount || 0) - (a.commentCount || 0));
    }
    return posts;
  };

  // Build reactive empty state message for the pseudo-community
  const getEmptyStateMessage = () => {
    if (!isPseudoCommunity) return 'No posts yet';

    if (avatarCount === 0 && communityCount === 0) {
      return (
        <div className="empty-state">
          <p>🦀 No posts yet!</p>
          <p style={{ marginTop: '8px', fontSize: '14px', color: 'var(--color-text-muted)' }}>
            To get started, you'll need some Avatars and Communities.{' '}
            <Link to="/avatars" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>
              Add an Avatar
            </Link>{' '}
            or{' '}
            <Link to="/communities" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>
              create a Community
            </Link>
            {' — '}or{' '}
            <Link to="/settings" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>
              go to Settings
            </Link>{' '}
            to generate or import them.
          </p>
        </div>
      );
    }

    if (avatarCount > 0 && communityCount > 0) {
      // Has both avatars and communities - show link to the first community if there's only one,
      // otherwise list available communities or link to the communities page
      const singleCommunity = communitiesList.length === 1 ? communitiesList[0] : null;
      return (
        <div className="empty-state">
          <p>🦀 No posts yet!</p>
          <p style={{ marginTop: '8px', fontSize: '14px', color: 'var(--color-text-muted)' }}>
            {singleCommunity
              ? `You have ${avatarCount} avatars and ${communityCount} community ready to go. Go to`
              : `You have ${avatarCount} avatars and ${communityCount} communities ready to go. Go to`}{' '}
            <Link to={singleCommunity ? `/community/${singleCommunity.id}` : '/communities'} style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>
              {singleCommunity ? `c/${singleCommunity.name}` : 'a community'}
            </Link>{' '}
            and start posting, or turn on auto mode.
          </p>
        </div>
      );
    }

    // Has avatars but no communities, or has communities but no avatars
    if (avatarCount === 0) {
      return (
        <div className="empty-state">
          <p>🦀 No posts yet!</p>
          <p style={{ marginTop: '8px', fontSize: '14px', color: 'var(--color-text-muted)' }}>
            You have communities but no avatars.{' '}
            <Link to="/avatars" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>
              Add an Avatar
            </Link>{' '}
            to start posting, or{' '}
            <Link to="/settings" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>
              go to Settings
            </Link>{' '}
            to generate one.
          </p>
        </div>
      );
    }

    return (
      <div className="empty-state">
        <p>🦀 No posts yet!</p>
        <p style={{ marginTop: '8px', fontSize: '14px', color: 'var(--color-text-muted)' }}>
          You have avatars but no communities.{' '}
          <Link to="/communities" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>
            Create a Community
          </Link>{' '}
          and start posting, or{' '}
          <Link to="/settings" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>
            go to Settings
          </Link>{' '}
          to import some.
        </p>
      </div>
    );
  };

  if (loading) return <div className="loading">Loading...</div>;
  if (!community) return <div className="empty-state">Community not found</div>;

  return (
    <div className="container">
      <div className="community-header" style={{ position: 'relative' }}>
        <div className="community-banner"></div>
        {/* Three-dot menu over the banner - hidden while editing */}
        {!editing && (
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
                <div className="modal menu-dropdown" style={{ position: 'absolute', top: '100%', right: 0, marginTop: '4px', zIndex: 1000 }} onClick={e => e.stopPropagation()}>
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
            <div className="community-edit-form">
              {isPseudoCommunity ? (
                <>
                  <div className="form-group">
                    <label>Name</label>
                    <input value="All" disabled style={{ backgroundColor: 'var(--color-surface-hover)', cursor: 'not-allowed' }} />
                  </div>
                  <div className="form-group">
                    <label>Description</label>
                    <textarea value="Every post from every community" disabled style={{ backgroundColor: 'var(--color-surface-hover)', cursor: 'not-allowed' }} />
                  </div>
                  <div className="form-group">
                    <label>Global Rules</label>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                      <input
                        value={newRule}
                        onChange={e => setNewRule(e.target.value)}
                        placeholder="Add a global rule..."
                        onKeyDown={e => e.key === 'Enter' && handleAddGlobalRule()}
                      />
                      <button className="icon-add-btn" onClick={handleAddGlobalRule}>+</button>
                    </div>
                    {globalRules.length > 0 && globalRules.map((rule) => (
                        <div key={rule.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
                          <span>{rule.rule}</span>
                          <button className="icon-trash-btn" onClick={() => handleDeleteGlobalRule(rule.id)}>🗑️</button>
                        </div>
                      ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="form-group">
                    <label>Name</label>
                    <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Description</label>
                    <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Rules</label>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                      <input
                        value={newRule}
                        onChange={e => setNewRule(e.target.value)}
                        placeholder="Add a rule..."
                        onKeyDown={e => e.key === 'Enter' && handleAddRule()}
                      />
                      <button className="icon-add-btn" onClick={handleAddRule}>+</button>
                    </div>
                    {form.rules.length > 0 && form.rules.map((rule, index) => (
                        <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
                          <span>{rule}</span>
                          <button className="icon-trash-btn" onClick={() => handleRemoveRule(index)}>🗑️</button>
                        </div>
                      ))}
                  </div>
                </>
              )}
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

          {/* Sort / Edit controls - desktop: pinned bottom-right of header; mobile: flows below content */}
          <div className="community-sort-controls">
            {editing ? (
              <>
                <button className="primary" onClick={handleSave}>Save</button>
                <button className="secondary" onClick={() => setEditing(false)}>Cancel</button>
              </>
            ) : (
              ['top', 'new'].map(s => (
                <button
                  key={s}
                  className={`sort-btn ${sort === s ? 'primary' : 'secondary'}`}
                  onClick={() => setSort(s)}
                >
                  {s === 'top' ? '📈 ' : '🕐 '}{s}
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
            onClick={() => setPostModal(true)}
            style={{ whiteSpace: 'nowrap' }}
          >
            📝 Post
          </button>
        )}
        <div style={{ flex: 1, height: '1px', backgroundColor: '#e2e8f0' }} />
      </div>

      {/* Posts */}
      {community.posts?.length === 0 ? (
        getEmptyStateMessage()
      ) : (
        getSortedPosts(community.posts, sort).map(post => (
          <PostCard key={post.id} post={post} showCommunity={isPseudoCommunity} onVote={voteOnPost} avatars={avatars} />
        ))
      )}

      {/* Post Modal */}
      {postModal && (
        <AvatarActionModal
          avatars={avatars}
          title="Select Avatar to Post"
          actionLabel="Post"
          onAction={handlePost}
          onClose={() => setPostModal(false)}
          showLength={true}
          showTitleField={true}
          titleFieldPlaceholder="Enter a title for the post..."
        />
      )}
    </div>
  );
}


export default CommunityPage;
