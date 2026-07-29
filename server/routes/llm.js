const express = require('express');
const { getDatabase } = require('../db');
const { getLLMService } = require('../services/llm');

function getDb() {
  return getDatabase();
}

const router = express.Router();

// LLM CONTENT GENERATION (Manual Provocation)
router.post('/llm/generate-post', async (req, res) => {
  const { avatar_id, community_id, extra_context, title, length } = req.body;
  const avatar = getDb().get('SELECT * FROM Avatars WHERE id = ?', [avatar_id]);
  const community = getDb().get('SELECT * FROM Communities WHERE id = ?', [community_id]);
  const globalRules = getDb().all('SELECT rule FROM GlobalRules');

  if (!avatar || !community) {
    return res.status(404).json({ error: 'Avatar or Community not found' });
  }

  try {
    const result = await getLLMService().generateContent('post', avatar, null, community, globalRules, '', extra_context || '', title || '', Number(length) || 3);
    // If title was provided, result is just the content string
    if (title && title.trim()) {
      res.json({ title: title.trim(), content: result });
    } else {
      // LLM generated both title and content
      res.json({ title: result.title || '', content: result.content || result });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/llm/generate-comment', async (req, res) => {
  const { avatar_id, target_type, target_id, extra_context, length } = req.body;
  const avatar = getDb().get('SELECT * FROM Avatars WHERE id = ?', [avatar_id]);

  if (!avatar) {
    return res.status(404).json({ error: 'Avatar not found' });
  }

  let targetAvatar, community, context = '';

  if (target_type === 'post') {
    const post = getDb().get('SELECT * FROM Posts WHERE id = ?', [target_id]);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    community = getDb().get('SELECT * FROM Communities WHERE id = ?', [post.community_id]);
    targetAvatar = getDb().get('SELECT * FROM Avatars WHERE id = ?', [post.avatar_id]);
    context = `Post content: ${post.content}`;
  } else if (target_type === 'comment') {
    const comment = getDb().get('SELECT * FROM Comments WHERE id = ?', [target_id]);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    const post = getDb().get('SELECT * FROM Posts WHERE id = ?', [comment.post_id]);
    community = getDb().get('SELECT * FROM Communities WHERE id = ?', [post.community_id]);
    targetAvatar = getDb().get('SELECT * FROM Avatars WHERE id = ?', [comment.avatar_id]);
    context = `Post content: ${post.content}\nComment content: ${comment.content}`;
  }

  const globalRules = getDb().all('SELECT rule FROM GlobalRules');

  try {
    const content = await getLLMService().generateContent('comment', avatar, targetAvatar, community, globalRules, context, extra_context || '', '', Number(length) || 3);
    res.json({ content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/llm/generate-vote', async (req, res) => {
  const { avatar_id, target_type, target_id } = req.body;
  const avatar = getDb().get('SELECT * FROM Avatars WHERE id = ?', [avatar_id]);

  if (!avatar) {
    return res.status(404).json({ error: 'Avatar not found' });
  }

  let text;
  if (target_type === 'post') {
    const post = getDb().get('SELECT content FROM Posts WHERE id = ?', [target_id]);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    text = post.content;
  } else {
    const comment = getDb().get('SELECT content FROM Comments WHERE id = ?', [target_id]);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    text = comment.content;
  }

  try {
    const voteValue = await getLLMService().generateVote(avatar, text);
    res.json({ vote_value: voteValue });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// LLM BULK IMPORT GENERATION (Quick Start)
router.post('/llm/generate-bulk-import', async (req, res) => {
  const { context, avatarCount, communityCount, existingData } = req.body;
  const avatars = Number(avatarCount) || 0;
  const communities = Number(communityCount) || 0;

  if (avatars < 0 || avatars > 10) {
    return res.status(400).json({ error: 'avatarCount must be between 0 and 10' });
  }
  if (communities < 0 || communities > 10) {
    return res.status(400).json({ error: 'communityCount must be between 0 and 10' });
  }
  if (avatars === 0 && communities === 0) {
    return res.status(400).json({ error: 'at least one of avatarCount or communityCount must be greater than 0' });
  }

  try {
    const result = await getLLMService().generateBulkImport(context || '', avatars, communities, existingData || null);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
