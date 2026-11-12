import { useState } from 'react';

// Promise-based replacement for window.confirm().
// Usage:
//   const { confirm, dialog } = useConfirm();
//   if (await confirm({ title: 'Delete post?', body: 'This cannot be undone.', confirmLabel: 'Delete', danger: true })) { ... }
//   ...
//   return (<> ... {dialog} </>)
export function useConfirm() {
  const [state, setState] = useState(null); // { title, body, confirmLabel, cancelLabel, danger, resolve }

  const confirm = (opts = {}) => {
    const {
      title = 'Are you sure?',
      body = '',
      confirmLabel = 'Confirm',
      cancelLabel = 'Cancel',
      danger = false,
    } = opts;

    return new Promise((resolve) => {
      setState({ title, body, confirmLabel, cancelLabel, danger, resolve });
    });
  };

  const settle = (result) => {
    if (state) {
      state.resolve(result);
      setState(null);
    }
  };

  const dialog = state ? (
    <div className="modal-overlay" onClick={() => settle(false)}>
      <div className="modal confirm-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{state.title}</h3>
          <button onClick={() => settle(false)} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          {state.body && <p style={{ marginBottom: '16px' }}>{state.body}</p>}
          <div className="form-actions" style={{ justifyContent: 'flex-end' }}>
            <button className="secondary" onClick={() => settle(false)}>
              {state.cancelLabel}
            </button>
            <button
              className={state.danger ? 'danger' : 'primary'}
              onClick={() => settle(true)}
              autoFocus
            >
              {state.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, dialog };
}
