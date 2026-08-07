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
    const postAvatar = targetAvatar;
    context = `--- Post by ${postAvatar?.name} (@${postAvatar?.handle}) ---\n`;
    if (post.title) context += `Title: ${post.title}\n`;
    context += `Content: ${post.content}`;
  } else if (target_type === 'comment') {
    const comment = getDb().get('SELECT * FROM Comments WHERE id = ?', [target_id]);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    const post = getDb().get('SELECT * FROM Posts WHERE id = ?', [comment.post_id]);
    community = getDb().get('SELECT * FROM Communities WHERE id = ?', [post.community_id]);
    targetAvatar = getDb().get('SELECT * FROM Avatars WHERE id = ?', [comment.avatar_id]);

    // Build the full thread chain from root post up to the target comment
    const chain = buildCommentChain(getDb(), comment);
    context = buildThreadContext(chain);
  }

  const globalRules = getDb().all('SELECT rule FROM GlobalRules');

  try {
    const content = await getLLMService().generateContent('comment', avatar, targetAvatar, community, globalRules, context, extra_context || '', '', Number(length) || 3);
    res.json({ content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Walk up the comment tree from a given comment to the root post,
 * collecting each node in order (root post first, then each parent comment,
 * ending with the target comment).
 */
function buildCommentChain(db, comment) {
  const chain = [];
  let current = comment;

  // Walk up to find the root post
  while (current.parent_comment_id !== null) {
    current = db.get('SELECT * FROM Comments WHERE id = ?', [current.parent_comment_id]);
    if (!current) break;
  }

  // current should now be a top-level comment (parent_comment_id IS NULL)
  // Add the root post first
  const post = db.get('SELECT * FROM Posts WHERE id = ?', [comment.post_id]);
  if (post) {
    const postAvatar = db.get('SELECT * FROM Avatars WHERE id = ?', [post.avatar_id]);
    chain.push({ type: 'post', data: post, avatar: postAvatar });
  }

  // Now walk down from the top-level comment to the target comment
  const path = findPathToComment(db, comment, post);
  chain.push(...path);

  return chain;
}

/**
 * Find the path from the root post to the target comment,
 * returning each intermediate comment with its avatar.
 */
function findPathToComment(db, targetComment, post) {
  const path = [];
  const ancestors = [];

  // Collect ancestors from target up to top-level
  let current = targetComment;
  while (current) {
    ancestors.unshift(current);
    if (current.parent_comment_id === null) break;
    current = db.get('SELECT * FROM Comments WHERE id = ?', [current.parent_comment_id]);
  }

  // Add each ancestor with its avatar
  for (const c of ancestors) {
    const avatar = db.get('SELECT * FROM Avatars WHERE id = ?', [c.avatar_id]);
    path.push({ type: 'comment', data: c, avatar });
  }

  return path;
}

/**
 * Format a chain of post + comments into a readable context string
 * with author attribution and indentation showing thread depth.
 */
function buildThreadContext(chain) {
  let context = '';

  for (let i = 0; i < chain.length; i++) {
    const item = chain[i];

    if (item.type === 'post') {
      context += `--- Post by ${item.avatar?.name} (@${item.avatar?.handle}) ---\n`;
      if (item.data.title) context += `Title: ${item.data.title}\n`;
      context += `Content: ${item.data.content}\n`;
    } else if (item.type === 'comment') {
      const depth = i - 1; // 0 for first comment (top-level), 1 for reply, etc.
      const indent = '  '.repeat(depth);
      context += `${indent}--- Comment by ${item.avatar?.name} (@${item.avatar?.handle}) ---\n`;
      context += `${indent}Content: ${item.data.content}\n`;
    }
  }

  return context.trim();
}

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

// LLM MODELS LISTING (OpenAI-compatible /models endpoint)
router.get('/llm/models', async (req, res) => {
  const { apiUrl, apiKey } = getLLMService().getSettings();

  if (!apiUrl || apiUrl === 'http://localhost:11434/v1') {
    return res.status(400).json({ error: 'LLM API URL not configured' });
  }

  try {
    const headers = {
      'Content-Type': 'application/json'
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(`${apiUrl}/models`, {
      method: 'GET',
      headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Models API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    res.json(data.data || []);
  } catch (error) {
    console.error('Failed to fetch LLM models:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
