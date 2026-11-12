import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { formatRelativeTime } from '../utils/time';
import { downloadJson } from '../utils/download';

const MAX_CONTENT_LENGTH = 200; // Characters before truncation
const HISTORY_PAGE_SIZE = 25;

function AvatarPage() {
  const { id } = useParams();
  const [avatar, setAvatar] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [form, setForm] = useState({});
  const [historyTab, setHistoryTab] = useState('all'); // 'posts' | 'comments' | 'all'
  const [expandedItems, setExpandedItems] = useState({}); // Track expanded history items
  const [visibleHistory, setVisibleHistory] = useState(HISTORY_PAGE_SIZE);
  const [runningOnce, setRunningOnce] = useState(false);
  const { notify } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();

  useEffect(() => {
    loadAvatar();
    setVisibleHistory(HISTORY_PAGE_SIZE);
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
      });
    } catch (err) {
      console.error('Failed to load avatar:', err);
      notify(err.message || 'Failed to load avatar', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      await api.updateAvatar(id, form);
      setEditing(false);
      notify('Avatar saved', 'success');
      loadAvatar();
    } catch (err) {
      console.error('Failed to save avatar:', err);
      notify(err.message || 'Failed to save avatar', 'error');
    }
  };

  const handleReset = async () => {
    const ok = await confirm({
      title: `Reset u/${form.handle || avatar?.handle}?`,
      body: 'All of this avatar\'s posts, comments, votes, and relationships will be deleted. This cannot be undone.',
      confirmLabel: 'Reset avatar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.resetAvatar(id);
      notify('Avatar reset', 'success');
      loadAvatar();
    } catch (err) {
      console.error('Failed to reset avatar:', err);
      notify(err.message || 'Failed to reset avatar', 'error');
    }
  };

  const handleExport = async () => {
    try {
      const data = await api.exportAvatar(id);
      downloadJson(data, `${form.handle || 'avatar'}-export.json`);
    } catch (err) {
      console.error('Failed to export avatar:', err);
      notify(err.message || 'Failed to export avatar', 'error');
    }
  };

  const handleRunAutoInteract = async () => {
    setRunningOnce(true);
    try {
      await api.runAutoInteractOnce(id);
      notify('Browsing session complete', 'success');
      loadAvatar();
    } catch (err) {
      console.error('Failed to run auto-interact:', err);
      notify(err.message || 'Browsing session failed', 'error');
    } finally {
      setRunningOnce(false);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;
  if (!avatar) return <div className="empty-state">Avatar not found</div>;

  const toggleExpand = (itemId) => {
    setExpandedItems(prev => ({ ...prev, [itemId]: !prev[itemId] }));
  };

  const isLongContent = (content) => content && content.length > MAX_CONTENT_LENGTH;

  const renderTruncatedContent = (item, type) => {
    const isExpanded = expandedItems[item.id];
    const content = item.content;
    if (!content) return null;

    const shouldTruncate = isLongContent(content) && !isExpanded;

    return (
      <Link to={`/post/${type === 'post' ? item.id : item.post_id}`}>
        <div
          className="post-text"
          style={{
            fontSize: '13px',
            display: shouldTruncate ? '-webkit-box' : 'block',
            WebkitLineClamp: shouldTruncate ? 3 : 'unset',
            WebkitBoxOrient: shouldTruncate ? 'vertical' : 'unset',
            overflow: shouldTruncate ? 'hidden' : 'visible',
            textOverflow: shouldTruncate ? 'ellipsis' : 'unset',
          }}
        >
          {content}
        </div>
      </Link>
    );
  };

  const renderHistoryItem = (item, type) => {
    const score = (item.upvotes || 0) - (item.downvotes || 0);
    const voteColor = score > 0 ? 'var(--color-upvote)' : score < 0 ? 'var(--color-downvote)' : 'var(--color-text-muted)';
    const scoreColor = score > 0 ? 'var(--color-upvote)' : score < 0 ? 'var(--color-downvote)' : 'var(--color-text-muted)';
    const isPost = type === 'post';
    const isExpanded = expandedItems[item.id];
    const shouldTruncate = isLongContent(item.content) && !isExpanded;
    const time = formatRelativeTime(item.created_at);

    return (
      <div key={item.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          {/* Vote display */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '32px', paddingTop: '2px' }}>
            <span style={{ fontSize: '12px', color: voteColor, lineHeight: 1 }}>▲</span>
            <span style={{ fontWeight: 700, fontSize: '13px', color: scoreColor, margin: '2px 0' }}>{score}</span>
            <span style={{ fontSize: '12px', color: voteColor, lineHeight: 1 }}>▼</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Community, post title, and timestamp inline */}
            <div className="post-meta" style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <Link to={`/community/${item.community?.id || 'all'}`}>c/{item.community?.name || 'All'}</Link>
              {isPost && item.title && (
                <Link to={`/post/${item.id}`} style={{ fontWeight: 600, color: 'var(--color-highlight)' }}>
                  {item.title}
                </Link>
              )}
              {!isPost && item.post_title && (
                <Link to={`/post/${item.post_id}`} style={{ fontWeight: 600, color: 'var(--color-highlight)' }}>
                  {item.post_title}
                </Link>
              )}
              <span title={time.title}>{time.label}</span>
            </div>
            {/* Content - truncated with expand */}
            {renderTruncatedContent(item, type)}
            {/* Show more button where timestamp was */}
            {shouldTruncate && (
              <button
                className="secondary"
                style={{
                  fontSize: '12px',
                  padding: '2px 8px',
                  marginTop: '4px',
                  cursor: 'pointer',
                  background: 'none',
                  border: '1px solid var(--color-border)',
                  borderRadius: '4px',
                  color: 'var(--color-text-muted)',
                }}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleExpand(item.id); }}
              >
                Show more
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const combinedHistory = [
    ...(avatar.posts || []).map(p => ({ ...p, _type: 'post' })),
    ...(avatar.comments || []).map(c => ({ ...c, _type: 'comment' }))
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const filteredHistory = combinedHistory.filter(item => {
    if (historyTab === 'all') return true;
    // Handle both singular and plural forms: _type='post' matches 'posts', _type='comment' matches 'comments'
    const typeMatch = historyTab.replace(/s$/, '') === item._type;
    return typeMatch;
  });

  const visibleHistoryItems = filteredHistory.slice(0, visibleHistory);
  const hasMoreHistory = filteredHistory.length > visibleHistory;

  return (
    <div className="container">
      {confirmDialog}
      <div className="profile-header" style={{ position: 'relative' }}>
        {/* Three-dot menu over the header - hidden while editing */}
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
                      <button className="menu-item" style={{flex: 1}} onClick={() => { handleRunAutoInteract(); setMenuOpen(false); }} disabled={runningOnce}>
                        {runningOnce ? '⏳ Browsing...' : '🎲 Browse'}
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
        <div className="profile-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
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
            {editing && (
              <>
                <button className="primary" onClick={handleSave}>Save</button>
                <button className="secondary" onClick={() => setEditing(false)}>Cancel</button>
              </>
            )}
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
          </div>
        ) : (
          <>
            <div style={{ marginTop: '8px' }}>{avatar.public_bio || 'Not set'}</div>
          </>
        )}
      </div>

      {/* Friends & Foes */}
      <div className="two-col-grid">
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

      {/* Combined Post & Comment History with Toggle */}
      <div className="card" style={{ marginTop: '16px' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>History</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className={historyTab === 'posts' ? 'primary' : 'secondary'}
              style={{ padding: '4px 12px', fontSize: '13px', cursor: 'pointer' }}
              onClick={() => { setHistoryTab('posts'); setVisibleHistory(HISTORY_PAGE_SIZE); }}
            >
              Posts
            </button>
            <button
              className={historyTab === 'comments' ? 'primary' : 'secondary'}
              style={{ padding: '4px 12px', fontSize: '13px', cursor: 'pointer' }}
              onClick={() => { setHistoryTab('comments'); setVisibleHistory(HISTORY_PAGE_SIZE); }}
            >
              Comments
            </button>
            <button
              className={historyTab === 'all' ? 'primary' : 'secondary'}
              style={{ padding: '4px 12px', fontSize: '13px', cursor: 'pointer' }}
              onClick={() => { setHistoryTab('all'); setVisibleHistory(HISTORY_PAGE_SIZE); }}
            >
              All
            </button>
          </div>
        </div>
        <div className="card-body">
          {filteredHistory.length === 0 ? (
            <p className="empty-state">No posts or comments yet</p>
          ) : (
            <>
              {visibleHistoryItems.map(item => renderHistoryItem(item, item._type))}
              {hasMoreHistory && (
                <div style={{ textAlign: 'center', padding: '12px 0' }}>
                  <button className="secondary" onClick={() => setVisibleHistory(c => c + HISTORY_PAGE_SIZE)}>
                    Load more ({filteredHistory.length - visibleHistory} remaining)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default AvatarPage;
