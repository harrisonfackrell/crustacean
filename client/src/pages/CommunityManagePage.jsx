import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

function CommunityManagePage() {
  const [communities, setCommunities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateCommunity, setShowCreateCommunity] = useState(false);
  const [communityForm, setCommunityForm] = useState({ name: '', description: '', rules: '' });
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const c = await api.getCommunities();
      setCommunities(c);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredCommunities = communities.filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreateCommunity = async () => {
    if (!communityForm.name) return;
    try {
      const rulesArray = communityForm.rules.split('\n').filter(r => r.trim());
      await api.createCommunity({ name: communityForm.name, description: communityForm.description, rules: rulesArray });
      setCommunityForm({ name: '', description: '', rules: '' });
      setShowCreateCommunity(false);
      loadData();
    } catch (err) {
      console.error('Failed to create community:', err);
    }
  };

  const handleDeleteCommunity = async (id) => {
    if (!confirm('Delete this community?')) return;
    try {
      await api.deleteCommunity(id);
      loadData();
    } catch (err) {
      console.error('Failed to delete community:', err);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="container">

      {/* Community List */}
      <div className="card">
        <div className="card-header">
          <h3>Communities ({communities.length})</h3>
          <input
            type="text"
            placeholder="Search by name..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ flex: 1, marginLeft: '16px', padding: '4px 8px', fontSize: '12px' }}
          />
        </div>
        <div className="card-body">
          {/* "All" pseudo-community - always first */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--color-border)' }}>
            <div>
              <Link to="/"><strong>c/All</strong></Link>
              <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>Every post from every community.</div>
            </div>
          </div>
          {filteredCommunities.length === 0 ? (
            <p className="empty-state">{communities.length === 0 ? 'No communities yet' : 'No communities match your search'}</p>
          ) : (
            filteredCommunities.map(c => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--color-border)' }}>
                <div>
                  <Link to={`/community/${c.id}`}><strong>{'c/' + c.name}</strong></Link>
                  <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>{c.description || 'No description'}</div>
                </div>
                <button className="danger" style={{ width: '32px', height: '32px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }} onClick={() => handleDeleteCommunity(c.id)}>🗑️</button>
              </div>
            ))
          )}
          <button className="create-community-btn" onClick={() => setShowCreateCommunity(true)}>+</button>
        </div>
      </div>

      {/* Create Community Modal */}
      {showCreateCommunity && (
        <div className="modal-overlay" onClick={() => setShowCreateCommunity(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create Community</h3>
              <button onClick={() => setShowCreateCommunity(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Name *</label>
                <input value={communityForm.name} onChange={e => setCommunityForm({ ...communityForm, name: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea value={communityForm.description} onChange={e => setCommunityForm({ ...communityForm, description: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Rules (one per line)</label>
                <textarea value={communityForm.rules} onChange={e => setCommunityForm({ ...communityForm, rules: e.target.value })} style={{ minHeight: '150px' }} />
              </div>
              <div className="form-actions">
                <button className="primary" onClick={handleCreateCommunity}>Create</button>
                <button className="secondary" onClick={() => setShowCreateCommunity(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CommunityManagePage;
