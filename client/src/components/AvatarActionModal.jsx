import { useState } from 'react';

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

  const handleAction = async () => {
    if (!selectedAvatar) return;
    setGenerating(true);
    try {
      await onAction({ selectedAvatar, extraContext, length, inputTitle });
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
              <label>Length: {length}</label>
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
