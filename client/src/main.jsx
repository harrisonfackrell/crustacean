import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Dynamic background color based on scroll position
const updateBackground = () => {
  const { scrollY, innerHeight, document } = window;
  const { body } = document;
  const { scrollHeight } = body;
  
  // If we're at the top (or overscrolling up), use navbar color
  // If we're at the bottom (or overscrolling down), use original bg color
  if (scrollY === 0) {
    body.style.background = 'var(--color-surface)';
  } else if (scrollY + innerHeight >= scrollHeight - 1) {
    body.style.background = 'var(--color-bg)';
  } else {
    // In the middle, use the original bg color
    body.style.background = 'var(--color-bg)';
  }
};

window.addEventListener('scroll', updateBackground, { passive: true });
window.addEventListener('resize', updateBackground, { passive: true });

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
