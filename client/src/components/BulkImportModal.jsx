import { useState } from 'react';

function BulkImportModal({ onClose, onImport }) {
  const [context, setContext] = useState('');
  const [count, setCount] = useState(3);
  const [includeExisting, setIncludeExisting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const data = await onImport({ context, count, includeExisting });
      // If import succeeds, close the modal
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to generate and import');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Quick Start: Generate Avatars & Communities</h3>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', marginBottom: '16px' }}>
            Use AI to generate avatars and communities for you. Provide context below to guide the generation, then click "Generate & Import" to create them automatically.
          </p>
          <div className="form-group">
            <label>Context (optional)</label>
            <textarea
              value={context}
              onChange={e => setContext(e.target.value)}
              placeholder="Give the AI some direction — e.g., 'Create 3 tech-savvy avatars for a programming community' or leave it blank for random content."
              style={{ minHeight: '100px' }}
            />
          </div>
          <div className="form-group">
            <label>Number of Avatars & Communities: {count}</label>
            <input
              type="range"
              min="1"
              max="10"
              value={count}
              onChange={e => setCount(Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>
          <label className="form-checkbox">
            <input
              type="checkbox"
              checked={includeExisting}
              onChange={e => setIncludeExisting(e.target.checked)}
            />
            Include existing data as reference (to avoid duplicates)
          </label>
          {error && (
            <div style={{ color: 'var(--color-danger)', fontSize: '14px', marginBottom: '12px' }}>
              {error}
            </div>
          )}
          <div className="form-actions">
            <button className="primary" onClick={handleGenerate} disabled={generating}>
              {generating ? 'Generating...' : 'Generate & Import'}
            </button>
            <button className="secondary" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BulkImportModal;
