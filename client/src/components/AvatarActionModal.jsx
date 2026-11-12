import { useMemo, useState } from 'react';
import { useToast } from './Toast';

// Human-friendly labels for the length scale (1-10)
const LENGTH_LABELS = {
  1: 'Very short',
  2: 'Short',
  3: 'Medium',
  4: 'Medium',
  5: 'Medium-long',
  6: 'Long',
  7: 'Long',
  8: 'Very long',
  9: 'Very long',
  10: 'Epic',
};

function AvatarActionModal({
  avatars,
  title,
  actionLabel,
  onAction,
  onClose,
  showLength = false,
  extraContextPlaceholder = 'Add any additional context for the LLM...',
  showTitleField = false,
  titleFieldLabel = 'Title (optional - LLM will generate one if left blank)',
  titleFieldPlaceholder = 'Enter a title...',
  initialTitle = '',
}) {
  const [selectedAvatar, setSelectedAvatar] = useState(null);
  const [extraContext, setExtraContext] = useState('');
  const [length, setLength] = useState(3);
  const [generating, setGenerating] = useState(false);
  const [inputTitle, setInputTitle] = useState(initialTitle);
  const [query, setQuery] = useState('');
  const { notify } = useToast();

  const filteredAvatars = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return avatars;
    return avatars.filter(
      a => a.handle?.toLowerCase().includes(q) || a.name?.toLowerCase().includes(q)
    );
  }, [avatars, query]);

  const handleAction = async () => {
    if (!selectedAvatar) return;
    setGenerating(true);
    try {
      await onAction({ selectedAvatar, extraContext, length, inputTitle });
      notify(`${actionLabel} succeeded`, 'success');
    } catch (err) {
      // Surface the failure and keep the modal open; parents close it
      // themselves only on success.
      notify(err.message || `${actionLabel} failed`, 'error');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {avatars.length > 8 && (
            <div className="form-group">
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={`Search ${avatars.length} avatars...`}
                style={{ marginBottom: '8px' }}
              />
            </div>
          )}
          <div className="avatar-selector">
            {filteredAvatars.length === 0 ? (
              <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>No avatars match "{query}"</span>
            ) : (
              filteredAvatars.map(a => (
                <div
                  key={a.id}
                  className={`avatar-option ${selectedAvatar === a.id ? 'selected' : ''}`}
                  onClick={() => setSelectedAvatar(a.id)}
                  title={a.name}
                >
                  u/{a.handle}
                </div>
              ))
            )}
          </div>
          {avatars.length === 0 && (
            <p style={{ fontSize: '13px', color: 'var(--color-danger)' }}>
              No avatars exist yet. Create one in the Avatars section first.
            </p>
          )}
          {showTitleField && (
            <div className="form-group" style={{ marginTop: '16px' }}>
              <label>{titleFieldLabel}</label>
              <input value={inputTitle} onChange={e => setInputTitle(e.target.value)} placeholder={titleFieldPlaceholder} />
            </div>
          )}
          <div className="form-group" style={{ marginTop: '16px' }}>
            <label>Extra Context (optional)</label>
            <textarea
              value={extraContext}
              onChange={e => setExtraContext(e.target.value)}
              placeholder={extraContextPlaceholder}
            />
          </div>
          {showLength && (
            <div className="form-group" style={{ marginTop: '16px' }}>
              <label>Length: {LENGTH_LABELS[length] || length} ({length}/10)</label>
              <input
                type="range"
                min="1"
                max="10"
                value={length}
                onChange={e => setLength(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
          )}
          <div className="form-actions">
            <button className="primary" onClick={handleAction} disabled={!selectedAvatar || generating}>
              {generating ? 'Generating...' : actionLabel}
            </button>
            <button className="secondary" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AvatarActionModal;
