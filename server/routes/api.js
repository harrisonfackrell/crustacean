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

module.exports = router;
