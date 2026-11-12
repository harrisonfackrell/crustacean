import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import BulkImportModal from '../components/BulkImportModal';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { useDebouncedPersist } from '../hooks/useDebouncedPersist';
import { downloadJson } from '../utils/download';

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
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState(null);
  const [saved, setSaved] = useState(false);
  const { notify } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();

  // LLM settings persist automatically after a short idle. The hook skips
  // the initial load, so visiting the page does not re-save current values.
  const persistSetting = useCallback((key, value) => {
    api.setSetting(key, value)
      .then(() => {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      })
      .catch(err => {
        console.error('Failed to save setting:', err);
        notify(err.message || 'Failed to save setting', 'error');
      });
  }, [notify]);

  useDebouncedPersist('llm_api_url', settings.llm_api_url, persistSetting);
  useDebouncedPersist('llm_api_key', settings.llm_api_key, persistSetting);
  useDebouncedPersist('llm_model', settings.llm_model, persistSetting);
  useDebouncedPersist('global_system_prompt', settings.global_system_prompt, persistSetting);

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
      notify(err.message || 'Failed to load settings', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchModels = async () => {
    if (!settings.llm_api_url) {
      setModelsError('Please enter an API URL first');
      return;
    }
    setModelsLoading(true);
    setModelsError(null);
    try {
      const data = await api.getModels();
      setModels(data.map(m => m.id));
    } catch (err) {
      console.error('Failed to fetch models:', err);
      setModelsError(err.message || 'Failed to fetch models');
    } finally {
      setModelsLoading(false);
    }
  };

  const handleModelSelect = async (modelValue) => {
    // Save immediately on explicit selection (no debounce needed)
    setSettings({ ...settings, llm_model: modelValue });
    persistSetting('llm_model', modelValue);
  };

  const handleAddRule = async () => {
    if (!newRule.trim()) return;
    try {
      await api.addGlobalRule(newRule.trim());
      setNewRule('');
      const rules = await api.getGlobalRules();
      setGlobalRules(rules);
    } catch (err) {
      console.error('Failed to add rule:', err);
      notify(err.message || 'Failed to add rule', 'error');
    }
  };

  const handleDeleteRule = async (id) => {
    try {
      await api.deleteGlobalRule(id);
      const rules = await api.getGlobalRules();
      setGlobalRules(rules);
    } catch (err) {
      console.error('Failed to delete rule:', err);
      notify(err.message || 'Failed to delete rule', 'error');
    }
  };

  const handleExportAll = async () => {
    try {
      const data = await api.exportAll();
      downloadJson(data, 'crustacean-export.json');
      notify('Export complete', 'success');
    } catch (err) {
      console.error('Failed to export:', err);
      notify(err.message || 'Failed to export', 'error');
    }
  };

  const handleImport = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await api.importData(data);
      notify('Import complete', 'success');
      loadData();
    } catch (err) {
      console.error('Failed to import:', err);
      notify('Import failed: ' + err.message, 'error');
    }
  };

  const handleGlobalReset = async () => {
    const ok = await confirm({
      title: 'Reset ALL emergent data?',
      body: 'This will clear all posts, comments, votes, and relationships. Avatars, communities, and settings are kept. This cannot be undone.',
      confirmLabel: 'Reset everything',
      danger: true,
    });
    if (!ok) return;
    const sure = await confirm({
      title: 'Are you absolutely sure?',
      body: 'Every post, comment, vote, and relationship will be permanently deleted.',
      confirmLabel: 'Yes, reset everything',
      danger: true,
    });
    if (!sure) return;
    try {
      await api.resetAll();
      notify('All emergent data reset', 'success');
      loadData();
    } catch (err) {
      console.error('Failed to reset:', err);
      notify(err.message || 'Failed to reset', 'error');
    }
  };

  const handleDatabaseDestroy = async () => {
    const ok = await confirm({
      title: 'DESTROY THE ENTIRE DATABASE?',
      body: 'This will clear ALL data including avatars, communities, settings, and rules. This cannot be undone.',
      confirmLabel: 'Destroy database',
      danger: true,
    });
    if (!ok) return;
    const sure = await confirm({
      title: 'THIS WILL PERMANENTLY DELETE EVERYTHING.',
      body: 'Avatars, communities, posts, comments, votes, rules, and LLM settings will all be gone.',
      confirmLabel: 'Yes, destroy it',
      danger: true,
    });
    if (!sure) return;
    try {
      await api.destroyDatabase();
      notify('Database destroyed', 'success');
      loadData();
    } catch (err) {
      console.error('Failed to destroy database:', err);
      notify(err.message || 'Failed to destroy database', 'error');
    }
  };

  const handleQuickStart = async ({ context, avatarCount, communityCount, includeExisting }) => {
    // Errors propagate to the modal, which keeps itself open and toasts
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
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="container">
      {confirmDialog}

      {/* Data Control */}
      <div className="card" style={{ marginTop: '16px' }}>
        <div className="card-header"><h3>Data Control</h3></div>
        <div className="card-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button className="primary" onClick={() => setShowBulkImportModal(true)}>🚀 Quick Generate</button>
              <label className="menu-item" style={{ padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', background: 'var(--color-text)', color: 'var(--color-surface)', display: 'inline-block', border: 'none' }}>
                📥 Import from File
                <input type="file" accept=".json" style={{ display: 'none', fontSize: '14px' }} onChange={e => { const file = e.target.files[0]; if (file) handleImport(file); e.target.value = ''; }} />
              </label>
              <button className="menu-item" style={{ cursor: 'pointer', background: 'var(--color-text)', color: 'var(--color-surface)' }} onClick={handleExportAll}>📤 Export to File</button>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button className="danger" onClick={handleGlobalReset}>🔄 Reset Emergent Data</button>
              <button className="danger" onClick={handleDatabaseDestroy}>💥 Destroy Database</button>
            </div>
          </div>
        </div>
      </div>

      {/* LLM Configuration */}
      <div className="card" style={{ marginTop: '16px' }}>
        <div className="card-header">
          <h3>LLM Configuration</h3>
          {saved && (
            <span style={{ fontSize: '12px', color: 'var(--color-success)' }}>✓ Saved</span>
          )}
        </div>
        <div className="card-body">
          <div className="form-group">
            <label>API URL (OpenAI-compatible)</label>
            <input
              value={settings.llm_api_url || ''}
              onChange={e => setSettings({ ...settings, llm_api_url: e.target.value })}
              placeholder="e.g., http://localhost:11434/v1"
            />
          </div>
          <div className="form-group">
            <label>API Key (optional)</label>
            <input
              type="password"
              value={settings.llm_api_key || ''}
              onChange={e => setSettings({ ...settings, llm_api_key: e.target.value })}
              placeholder="sk-..."
            />
          </div>
          <div className="form-group">
            <label>Model</label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <select
                value={models.includes(settings.llm_model || '') ? settings.llm_model : ''}
                onChange={e => {
                  if (e.target.value) handleModelSelect(e.target.value);
                }}
                disabled={modelsLoading || modelsError || models.length === 0}
                style={{ flex: '1 1 180px', minWidth: 0 }}
              >
                <option value="">Select a model...</option>
                {models.map(model => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
              <button
                type="button"
                className="primary"
                onClick={fetchModels}
                disabled={modelsLoading || !settings.llm_api_url}
                title="Refresh model list"
                style={{ whiteSpace: 'nowrap' }}
              >
                {modelsLoading ? 'Loading...' : models.length > 0 ? '↻ Refresh' : 'Fetch Models'}
              </button>
            </div>
            {modelsError && (
              <small style={{ color: 'var(--color-danger)', display: 'block', marginTop: '4px' }}>
                {modelsError}
              </small>
            )}
          </div>
          <div className="form-group">
            <label>Model (type a custom name if it's not in the list)</label>
            <input
              value={settings.llm_model || ''}
              onChange={e => setSettings({ ...settings, llm_model: e.target.value })}
              placeholder="e.g., llama3, gpt-4"
            />
            <small style={{ color: 'var(--color-text-muted)', display: 'block', marginTop: '4px' }}>
              Saved automatically. The dropdown and this field both control the same setting.
            </small>
          </div>
          <div className="form-group">
            <label>Global System Prompt (appended to every LLM call)</label>
            <textarea
              value={settings.global_system_prompt || ''}
              onChange={e => setSettings({ ...settings, global_system_prompt: e.target.value })}
              placeholder="e.g., All avatars are deep-sea crustaceans with a love of shell puns."
              style={{ minHeight: '120px' }}
            />
          </div>
        </div>
      </div>

      {/* Global Rules */}
      <div className="card" style={{ marginTop: '16px' }}>
        <div className="card-header"><h3>Global Rules</h3></div>
        <div className="card-body">
          <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '12px' }}>
            Rules apply to every avatar in every community, in addition to each community's own rules.
          </p>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            <input
              value={newRule}
              onChange={e => setNewRule(e.target.value)}
              placeholder="Add a global rule..."
              onKeyDown={e => e.key === 'Enter' && handleAddRule()}
            />
            <button className="icon-add-btn" onClick={handleAddRule}>+</button>
          </div>
          {globalRules.length === 0 ? (
            <p className="empty-state" style={{ padding: '16px 0' }}>No global rules</p>
          ) : (
            globalRules.map((rule) => (
              <div key={rule.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
                <span>{rule.rule}</span>
                <button className="icon-trash-btn" onClick={() => handleDeleteRule(rule.id)}>🗑️</button>
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
