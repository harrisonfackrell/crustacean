import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { api } from './api';
import { ToastProvider, useToast } from './components/Toast';

import AvatarPage from './pages/AvatarPage';
import CommunityPage from './pages/CommunityPage';
import PostPage from './pages/PostPage';
import SettingsPage from './pages/SettingsPage';
import AvatarManagePage from './pages/AvatarManagePage';
import CommunityManagePage from './pages/CommunityManagePage';

const STATUS_POLL_MS = 5000;

function AppContent() {
  const [autoInteractEnabled, setAutoInteractEnabled] = useState(false);
  const [autoIdle, setAutoIdle] = useState(false);
  const [toggling, setToggling] = useState(false);
  const { notify } = useToast();

  // Track whether the user is actively toggling so the poller doesn't
  // clobber the UI mid-toggle.
  const togglingRef = useRef(false);

  useEffect(() => {
    loadSettings();
    const interval = setInterval(pollStatus, STATUS_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  const loadSettings = async () => {
    try {
      const [s, status] = await Promise.all([
        api.getSettings(),
        api.getAutoInteractStatus()
      ]);
      // The server is the source of truth for whether the loop is running;
      // fall back to the persisted setting if the status call fails.
      setAutoInteractEnabled(status.running || s.auto_interact_enabled === 'true');
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  };

  // The loop only does work when there is something to do: at least one
  // avatar and at least one community. Surface that as an "idle" badge so
  // the user isn't fooled into thinking activity is happening.
  const pollStatus = async () => {
    if (togglingRef.current) return;
    try {
      const status = await api.getAutoInteractStatus();
      setAutoInteractEnabled(status.running);
      if (status.running) {
        const [avatars, communities] = await Promise.all([
          api.getAvatars(),
          api.getCommunities()
        ]);
        setAutoIdle(avatars.length === 0 || communities.length === 0);
      } else {
        setAutoIdle(false);
      }
    } catch (err) {
      // Server briefly unreachable — ignore
    }
  };

  const toggleAutoInteract = async () => {
    if (togglingRef.current) return;
    togglingRef.current = true;
    setToggling(true);
    try {
      const newValue = !autoInteractEnabled;
      if (newValue) {
        await api.startAutoInteract();
      } else {
        await api.stopAutoInteract();
      }
      // Persist the setting so the state survives a page reload
      await api.setSetting('auto_interact_enabled', String(newValue));
      setAutoInteractEnabled(newValue);
      setAutoIdle(false);
    } catch (err) {
      console.error('Failed to toggle auto-interact:', err);
      notify(err.message || 'Failed to toggle auto-interact', 'error');
    } finally {
      togglingRef.current = false;
      setToggling(false);
    }
  };

  const autoLabel = autoInteractEnabled
    ? (autoIdle ? 'IDLE' : 'ON')
    : 'OFF';
  const autoColor = autoInteractEnabled
    ? (autoIdle ? 'var(--color-text-muted)' : 'var(--color-success)')
    : 'var(--color-text-muted)';

  return (
    <div className="app">
      <header className="header">
        <div className="container">
          <Link to="/" className="header-logo">🦀 Crustacean</Link>
          <nav className="header-nav">
            <Link to="/communities">Communities</Link>
            <Link to="/avatars">Avatars</Link>
            <Link to="/settings">Settings</Link>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              title={autoInteractEnabled && autoIdle
                ? 'Auto-interact is on but idle: it needs at least one avatar and one community to do anything.'
                : 'Auto-interact: avatars browse, vote, and comment automatically'}
            >
              <span className="auto-status-label" style={{ fontSize: '12px', color: autoColor }}>
                Auto: {autoLabel}
              </span>
              <div
                className={`toggle ${autoInteractEnabled ? 'active' : ''}`}
                onClick={toggleAutoInteract}
                style={toggling ? { opacity: 0.6 } : undefined}
                role="switch"
                aria-checked={autoInteractEnabled}
                aria-label="Toggle auto-interact"
              />
            </span>
          </nav>
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<CommunityPage id="all" />} />
          <Route path="/avatar/:id" element={<AvatarPage />} />
          <Route path="/community/:id" element={<CommunityPage />} />
          <Route path="/post/:id" element={<PostPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/avatars" element={<AvatarManagePage />} />
          <Route path="/communities" element={<CommunityManagePage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}

function NotFound() {
  return (
    <div className="container" style={{ textAlign: 'center', padding: '48px 0' }}>
      <h1 style={{ fontSize: '64px', marginBottom: '8px' }}>🦀</h1>
      <h2>Page not found</h2>
      <p style={{ color: 'var(--color-text-muted)' }}>
        This page doesn't exist — it may have been deleted or the link is wrong.
      </p>
      <p>
        <Link to="/" style={{ color: 'var(--color-accent, #e8985e)' }}>← Back to the feed</Link>
      </p>
    </div>
  );
}

function App() {
  return (
    <Router>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </Router>
  );
}

export default App;
