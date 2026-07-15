import { useState, useEffect } from 'react';
import { api } from '../api';
import BulkImportModal from '../components/BulkImportModal';

function SettingsPage() {
  const [settings, setSettings] = useState({
    llm_api_url: '',
    llm_api_key: '',
    llm_model: '',
    global_system_prompt: ''
  });
  const [globalRules, setGlobalRules] = useState([]);
  const [newRule, setNewRule] = useState('');
  const [loading, setLoading] = useState(true);
  const [showBulkImportModal, setShowBulkImportModal] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [s, rules] = await Promise.all([
        api.getSettings(),
        api.getGlobalRules()
      ]);
      setSettings(s);
      setGlobalRules(rules);
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSetting = async (key, value) => {
    try {
      await api.setSetting(key, value);
      setSettings({ ...settings, [key]: value });
    } catch (err) {
      console.error('Failed to save setting:', err);
    }
  };

  const handleAddRule = async () => {
    if (!newRule.trim()) return;
    try {
      await api.addGlobalRule(newRule.trim());
      setNewRule('');
      loadData();
    } catch (err) {
      console.error('Failed to add rule:', err);
    }
  };

  const handleDeleteRule = async (id) => {
    try {
      await api.deleteGlobalRule(id);
      loadData();
    } catch (err) {
      console.error('Failed to delete rule:', err);
    }
  };

  const handleExportAll = async () => {
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
  };

  const handleImport = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await api.importData(data);
      loadData();
    } catch (err) {
      console.error('Failed to import:', err);
      alert('Import failed: ' + err.message);
    }
  };

  const handleGlobalReset = async () => {
    if (!confirm('Reset ALL emergent data? This will clear all posts, comments, votes, and relationships. This cannot be undone.')) return;
    if (!confirm('Are you absolutely sure?')) return;
    try {
      await api.resetAll();
      loadData();
    } catch (err) {
      console.error('Failed to reset:', err);
    }
  };

  const handleDatabaseDestroy = async () => {
    if (!confirm('DESTROY THE ENTIRE DATABASE? This will clear ALL data including avatars, communities, settings, and rules. This cannot be undone.')) return;
    if (!confirm('THIS WILL PERMANENTLY DELETE EVERYTHING. Are you absolutely sure?')) return;
    try {
      await api.destroyDatabase();
      loadData();
    } catch (err) {
      console.error('Failed to destroy database:', err);
    }
  };

  const handleQuickStart = async ({ context, avatarCount, communityCount, includeExisting }) => {
    try {
      const payload = { context, avatarCount, communityCount };
      
      // If the checkbox is checked, fetch and include existing data as reference
      if (includeExisting) {
        const existingData = await api.exportAll();
        payload.existingData = existingData;
      }
      
      // Step 1: Generate the bulk import data via LLM
      const bulkData = await api.generateBulkImport(payload);
      
      // Step 2: Import the generated data
      await api.importData(bulkData);
      
      // Step 3: Reload the page to reflect changes
      loadData();
    } catch (err) {
      throw err;
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="container">

      {/* Data Control */}
      <div className="card" style={{ marginTop: '16px' }}>
        <div className="card-header"><h3>Data Control</h3></div>
        <div className="card-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="primary" onClick={() => setShowBulkImportModal(true)}>🚀 Quick Generate</button>
              <label className="menu-item" style={{ padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', background: 'var(--color-text)', color: 'var(--color-surface)', display: 'inline-block', border: 'none' }}>
                📥 Import from File
                <input type="file" accept=".json" style={{ display: 'none', fontSize: '14px' }} onChange={e => { const file = e.target.files[0]; if (file) handleImport(file); e.target.value = ''; }} />
              </label>
              <button className="menu-item" style={{ cursor: 'pointer', background: 'var(--color-text)', color: 'var(--color-surface)' }} onClick={handleExportAll}>📤 Export to File</button>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="danger" onClick={handleGlobalReset}>🔄 Reset Emergent Data</button>
              <button className="danger" onClick={handleDatabaseDestroy}>💥 Destroy Database</button>
            </div>
          </div>
        </div>
      </div>

      {/* LLM Configuration */}
      <div className="card" style={{ marginTop: '16px' }}>
        <div className="card-header"><h3>LLM Configuration</h3></div>
        <div className="card-body">
          <div className="form-group">
            <label>API URL (OpenAI-compatible)</label>
            <input
              value={settings.llm_api_url || ''}
              onChange={e => handleSaveSetting('llm_api_url', e.target.value)}
              placeholder="http://localhost:11434/v1"
            />
          </div>
          <div className="form-group">
            <label>API Key (optional)</label>
            <input
              type="password"
              value={settings.llm_api_key || ''}
              onChange={e => handleSaveSetting('llm_api_key', e.target.value)}
              placeholder="sk-..."
            />
          </div>
          <div className="form-group">
            <label>Model</label>
            <input
              value={settings.llm_model || ''}
              onChange={e => handleSaveSetting('llm_model', e.target.value)}
              placeholder="llama3"
            />
          </div>
          <div className="form-group">
            <label>Global System Prompt (optional)</label>
            <textarea
              value={settings.global_system_prompt || ''}
              onChange={e => handleSaveSetting('global_system_prompt', e.target.value)}
              placeholder="Additional system prompt context for all LLM calls..."
              style={{ minHeight: '100px' }}
            />
          </div>
        </div>
      </div>

      {/* Global Rules */}
      <div className="card" style={{ marginTop: '16px' }}>
        <div className="card-header"><h3>Global Rules</h3></div>
        <div className="card-body">
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <input
              value={newRule}
              onChange={e => setNewRule(e.target.value)}
              placeholder="Add a global rule..."
              onKeyDown={e => e.key === 'Enter' && handleAddRule()}
            />
            <button className="primary" onClick={handleAddRule}>Add</button>
          </div>
          {globalRules.length === 0 ? (
            <p className="empty-state">No global rules set</p>
          ) : (
            globalRules.map(rule => (
              <div key={rule.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
                <span>{rule.rule}</span>
                <button className="danger" onClick={() => handleDeleteRule(rule.id)}>Delete</button>
              </div>
            ))
          )}
        </div>
      </div>
      {/* Bulk Import Modal */}
      {showBulkImportModal && (
        <BulkImportModal
          onClose={() => setShowBulkImportModal(false)}
          onImport={handleQuickStart}
        />
      )}
    </div>
  );
}

export default SettingsPage;
