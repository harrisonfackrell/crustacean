const express = require('express');

// Import sub-routers
const settingsRouter = require('./settings');
const autoInteractRouter = require('./autoInteract');
const avatarsRouter = require('./avatars');
const communitiesRouter = require('./communities');
const postsRouter = require('./posts');
const commentsRouter = require('./comments');
const votesRouter = require('./votes');
const globalRulesRouter = require('./globalRules');
const importExportRouter = require('./importExport');
const resetDestroyRouter = require('./resetDestroy');
const llmRouter = require('./llm');

const router = express.Router();

// Mount sub-routers at the /api prefix (routes define their own paths)
router.use(settingsRouter);
router.use(autoInteractRouter);
router.use(avatarsRouter);
router.use(communitiesRouter);
router.use(postsRouter);
router.use(commentsRouter);
router.use(votesRouter);
router.use(globalRulesRouter);
router.use(importExportRouter);
router.use(resetDestroyRouter);
router.use(llmRouter);

// Unknown API routes get a JSON 404 (instead of Express's HTML default)
router.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
});

// Central error handler: guarantees a JSON error body for anything that
// slips past the individual route handlers.
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  console.error('[API] Unhandled error:', err.message, err.stack);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = router;
