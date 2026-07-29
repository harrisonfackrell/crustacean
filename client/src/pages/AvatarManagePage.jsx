import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

function AvatarManagePage() {
  const [avatars, setAvatars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateAvatar, setShowCreateAvatar] = useState(false);
  const [avatarForm, setAvatarForm] = useState({ name: '', handle: '', private_bio: '', public_bio: '', auto_interval: 5, vote_chance: 0.5, reply_chance: 0.5, is_auto_enabled: 1 });
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const a = await api.getAvatars();
      setAvatars(a);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredAvatars = avatars.filter(a =>
    a.handle.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreateAvatar = async () => {
    if (!avatarForm.name || !avatarForm.handle) return;
    try {
      await api.createAvatar(avatarForm);
      setAvatarForm({ name: '', handle: '', private_bio: '', public_bio: '', auto_interval: 5, vote_chance: 0.5, reply_chance: 0.5, is_auto_enabled: 1 });
      setShowCreateAvatar(false);
      loadData();
    } catch (err) {
      console.error('Failed to create avatar:', err);
    }
  };

  const handleDeleteAvatar = async (id) => {
    if (!confirm('Delete this avatar?')) return;
    try {
      await api.deleteAvatar(id);
      loadData();
    } catch (err) {
      console.error('Failed to delete avatar:', err);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="container">

      {/* Avatar List */}
      <div className="card">
        <div className="card-header">
          <h3>Avatars ({avatars.length})</h3>
          <input
            type="text"
            placeholder="Search by handle or name..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ flex: 1, marginLeft: '16px', padding: '4px 8px', fontSize: '12px' }}
          />
          <button className="create-community-btn" onClick={() => setShowCreateAvatar(true)}>+</button>
        </div>
        <div className="card-body">
          {filteredAvatars.length === 0 ? (
            <p className="empty-state">{avatars.length === 0 ? 'No avatars yet' : 'No avatars match your search'}</p>
          ) : (
            filteredAvatars.map(a => (
              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--color-border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Link to={`/avatar/${a.id}`} style={{ color: 'var(--color-text)' }}>u/{a.handle}</Link>{' '}
                  <span style={{ color: 'var(--color-text-muted)' }}>{a.name}</span>
                  <span style={{ marginLeft: '8px', fontSize: '12px', color: a.is_auto_enabled ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                    {a.is_auto_enabled ? '● Auto' : '○ Manual'}
                  </span>
                  <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.public_bio || 'No bio'}</div>
                </div>
                <button className="danger" style={{ width: '32px', height: '32px', padding: 0, flexShrink: 0, marginLeft: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }} onClick={() => handleDeleteAvatar(a.id)}>🗑️</button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Create Avatar Modal */}
      {showCreateAvatar && (
        <div className="modal-overlay" onClick={() => setShowCreateAvatar(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create Avatar</h3>
              <button onClick={() => setShowCreateAvatar(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Name *</label>
                <input value={avatarForm.name} onChange={e => setAvatarForm({ ...avatarForm, name: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Handle *</label>
                <input value={avatarForm.handle} onChange={e => setAvatarForm({ ...avatarForm, handle: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Private Bio</label>
                <textarea value={avatarForm.private_bio} onChange={e => setAvatarForm({ ...avatarForm, private_bio: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Public Bio</label>
                <textarea value={avatarForm.public_bio} onChange={e => setAvatarForm({ ...avatarForm, public_bio: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                <div className="form-group">
                  <label>Auto Interval (min)</label>
                  <input type="number" value={avatarForm.auto_interval} onChange={e => setAvatarForm({ ...avatarForm, auto_interval: parseInt(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>Vote Chance</label>
                  <input type="number" step="0.1" min="0" max="1" value={avatarForm.vote_chance} onChange={e => setAvatarForm({ ...avatarForm, vote_chance: parseFloat(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>Reply Chance</label>
                  <input type="number" step="0.1" min="0" max="1" value={avatarForm.reply_chance} onChange={e => setAvatarForm({ ...avatarForm, reply_chance: parseFloat(e.target.value) })} />
                </div>
              </div>
              <label className="form-checkbox">
                <input
                  type="checkbox"
                  checked={!!avatarForm.is_auto_enabled}
                  onChange={e => setAvatarForm({ ...avatarForm, is_auto_enabled: e.target.checked ? 1 : 0 })}
                />
                Auto-Interact Enabled
              </label>
              <div className="form-actions">
                <button className="primary" onClick={handleCreateAvatar}>Create</button>
                <button className="secondary" onClick={() => setShowCreateAvatar(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AvatarManagePage;
