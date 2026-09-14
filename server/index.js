const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase, getDatabase } = require('./db');
const { getAutoInteractService } = require('./services/auto-interact');
const apiRouter = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// API Routes
app.use('/api', apiRouter);

// Serve static files from React build in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'client', 'dist', 'index.html'));
  });
}

async function startServer() {
  try {
    // Initialize database
    await initDatabase();
    console.log('Database initialized');

    // Resume auto-interact if it was enabled before the server restarted
    const autoSetting = getDatabase().get(
      "SELECT value FROM Settings WHERE key = 'auto_interact_enabled'"
    );
    if (autoSetting && autoSetting.value === 'true') {
      getAutoInteractService().start();
    }

    app.listen(PORT, () => {
      console.log(`Crustacean server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;
