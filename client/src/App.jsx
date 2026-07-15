import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { api } from './api';

import AvatarPage from './pages/AvatarPage';
import CommunityPage from './pages/CommunityPage';
import PostPage from './pages/PostPage';
import SettingsPage from './pages/SettingsPage';
import AvatarManagePage from './pages/AvatarManagePage';
import CommunityManagePage from './pages/CommunityManagePage';

function App() {
  const [autoInteractEnabled, setAutoInteractEnabled] = useState(false);
  const [settings, setSettings] = useState({});

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const s = await api.getSettings();
      setSettings(s);
      setAutoInteractEnabled(s.auto_interact_enabled === 'true');
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  };

  const toggleAutoInteract = async () => {
    try {
      if (autoInteractEnabled) {
        await api.stopAutoInteract();
      } else {
        await api.startAutoInteract();
      }
      setAutoInteractEnabled(!autoInteractEnabled);
    } catch (err) {
      console.error('Failed to toggle auto-interact:', err);
    }
  };

  return (
    <Router>
      <div className="app">
        <header className="header">
          <div className="container">
            <Link to="/" className="header-logo">🦀 Crustacean</Link>
            <nav className="header-nav">
              <Link to="/communities">Communities</Link>
              <Link to="/avatars">Avatars</Link>
              <Link to="/settings">Settings</Link>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: autoInteractEnabled ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                  Auto: {autoInteractEnabled ? 'ON' : 'OFF'}
                </span>
                <div className={`toggle ${autoInteractEnabled ? 'active' : ''}`} onClick={toggleAutoInteract} />
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
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
