const { getDatabase } = require('../db');

/**
 * LLM Service - handles all communication with the OpenAI-compatible backend.
 */

class LLMService {
  constructor() {
    this.db = getDatabase();
  }

  getSettings() {
    const apiUrl = this.db.get('SELECT value FROM Settings WHERE key = ?', ['llm_api_url']);
    const apiKey = this.db.get('SELECT value FROM Settings WHERE key = ?', ['llm_api_key']);
    const model = this.db.get('SELECT value FROM Settings WHERE key = ?', ['llm_model']);
    const globalPrompt = this.db.get('SELECT value FROM Settings WHERE key = ?', ['global_system_prompt']);

    return {
      apiUrl: apiUrl?.value || 'http://localhost:11434/v1',
      apiKey: apiKey?.value || '',
      model: model?.value || 'llama3',
      globalSystemPrompt: globalPrompt?.value || ''
    };
  }

  async callLLM(systemPrompt, userPrompt) {
    const { apiUrl, apiKey, model } = this.getSettings();

    const headers = {
      'Content-Type': 'application/json'
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const body = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.8,
      max_tokens: 8192
    };

    try {
      const response = await fetch(`${apiUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return data.choices[0].message.content.trim();
    } catch (error) {
      console.error('LLM API call failed:', error.message);
      throw error;
    }
  }

  /**
   * Generate content for a Post or Comment.
   * For posts, if a title is provided, the LLM incorporates it into the content.
   * If no title is provided, the LLM first generates the content, then generates a title in a second call.
   */
  async generateContent(actionType, avatar, targetAvatar, community, globalRules, context, extraContext = '', title = '', length = 3) {
    const relationshipText = this.formatRelationship(avatar.id, targetAvatar?.id);

    const isPost = actionType === 'post';
    const hasTitle = isPost && title.trim() !== '';
    const lengthInstruction = this.getLengthInstruction(length);

    // Clarify the interaction target when replying
    const targetDescription = targetAvatar
      ? `You are replying to a contribution by "${targetAvatar.name}" (@${targetAvatar.handle}). Their public bio: ${targetAvatar.public_bio || 'No public bio set.'}`
      : '';

    const systemPrompt = `
You are an AI avatar named "${avatar.name}" (@${avatar.handle}).
Your private bio: ${avatar.private_bio || 'No private bio set.'}
${targetDescription}
${relationshipText}

You are in the community "${community.name}".
Description: ${community.description || 'No description.'}
Rules: ${community.rules ? JSON.parse(community.rules).join(', ') : 'No rules.'}
Global Rules: ${globalRules.join(', ')}

${extraContext}

Your task: ${isPost ? 'Write an original post for this community.' : 'Write a reply/comment to the content below.'}
${hasTitle ? `
The title for the post: "${title}". Write the post content that matches and expands on this title.` : ''}
    `.trim();

    const userPrompt = `
Below is what you have been reading while browsing this community. Use this as background context for your contribution:

${context}

Please write your ${actionType} now. ${lengthInstruction}. Reply ONLY with the content, and do not include the title in the post.
    `.trim();

    const content = await this.callLLM(systemPrompt, userPrompt);

    // If generating a post without a title, make a second LLM call to generate the title
    if (!hasTitle && isPost) {
      const titlePrompt = `
You are an AI avatar named "${avatar.name}" (@${avatar.handle}).
You are in the community "${community.name}".

Your task: Generate a concise, engaging title for the following post.
Reply with ONLY the title, nothing else.

Post content:
${content}

Title:
    `.trim();

      const generatedTitle = await this.callLLM(
        'You are a helpful assistant. Reply with ONLY the requested title, nothing else.',
        titlePrompt
      );

      return {
        title: generatedTitle,
        content: content
      };
    }

    return content;
  }

  /**
   * Generate a vote decision (+1 or -1).
   */
  async generateVote(avatar, text) {
    const systemPrompt = `
You are an AI avatar named "${avatar.name}" (@${avatar.handle}).
Your private bio: ${avatar.private_bio || 'No private bio set.'}

You are asked to vote on the following content. Reply with ONLY +1 or -1.
    `.trim();

    const userPrompt = `Content to vote on:

${text}

Your vote (+1 or -1):
    `.trim();

    const result = await this.callLLM(systemPrompt, userPrompt);
    if (result.includes('+1') || result.includes('1') && !result.includes('-1')) {
      return 1;
    } else if (result.includes('-1')) {
      return -1;
    }
    // Default to +1 if unclear
    return 1;
  }

  /**
   * Generate a community preference score (-10 to 10).
   */
  async generateCommunityPreference(avatar, community) {
    const systemPrompt = `
You are an AI avatar named "${avatar.name}" (@${avatar.handle}).
Your private bio: ${avatar.private_bio || 'No private bio set.'}

You are evaluating a community. Reply with ONLY a number from -10 to 10.
-10 = Strongly dislike, 0 = Indifferent, 10 = Strongly like.
    `.trim();

    const userPrompt = `Community: ${community.name}
Description: ${community.description || 'No description.'}
Rules: ${community.rules ? JSON.parse(community.rules).join(', ') : 'No rules.'}

Your evaluation (-10 to 10):
    `.trim();

    const result = await this.callLLM(systemPrompt, userPrompt);
    const match = result.match(/-?\d+/);
    if (match) {
      const score = parseInt(match[0], 10);
      return Math.max(-10, Math.min(10, score));
    }
    return 0;
  }

  /**
   * Format relationship score into English text.
   */
  formatRelationship(actorId, targetId) {
    if (!targetId) return '';
    const rel = this.db.get(
      'SELECT score FROM AvatarRelationships WHERE actor_id = ? AND target_id = ?',
      [actorId, targetId]
    );

    if (!rel || rel.score === 0) {
      return 'You do not know this person.';
    }

    const score = rel.score;
    if (score > 5) return 'You have a very positive relationship with this person.';
    if (score > 2) return 'You have a positive relationship with this person.';
    if (score > 0) return 'You have a slightly positive relationship with this person.';
    if (score > -2) return 'You have a slightly negative relationship with this person.';
    if (score > -5) return 'You have a negative relationship with this person.';
    return 'You have a very negative relationship with this person.';
  }

  /**
   * Generate a qualitative length instruction based on a 1-10 scale.
   */
  getLengthInstruction(length) {
    const clamped = Math.max(1, Math.min(10, Math.round(length)));
    const instructions = {
      1: 'Keep your contribution very brief — just 1 short paragraph.',
      2: 'Keep your contribution brief — about 1 to 2 short paragraphs, each of which should be 5 to 7 sentences in length.',
      3: 'Write a concise contribution — about 2 to 3 paragraphs, each of which should be 5 to 7 sentences in length.',
      4: 'Write a moderate contribution — about 2 to 4 paragraphs, each of which should be 5 to 7 sentences in length.',
      5: 'Write a well-developed contribution — about 3 to 5 paragraphs, each of which should be 5 to 7 sentences in length.',
      6: 'Write a detailed contribution — about 4 to 6 paragraphs, each of which should be 5 to 7 sentences in length.',
      7: 'Write a thorough contribution — about 5 to 7 paragraphs, each of which should be 5 to 7 sentences in length.',
      8: 'Write an extensive contribution — about 6 to 8 paragraphs, each of which should be 5 to 7 sentences in length.',
      9: 'Write a very detailed contribution — about 7 to 10 paragraphs, each of which should be 5 to 7 sentences in length.',
      10: 'Write an in-depth, comprehensive contribution — about 8 to 12 paragraphs, each of which should be 5 to 7 sentences in length.',
    };
    return instructions[clamped];
  }

  /**
   * Generate a bulk import JSON payload compatible with the import API.
   * Returns an object with type 'full_export' and data containing avatars and communities arrays.
   */
  async generateBulkImport(context, avatarCount, communityCount, existingData = null) {
    // Build existing data reference text if provided — include the full export
    let existingDataText = '';
    if (existingData && existingData.type === 'full_export' && existingData.data) {
      const existingAvatars = existingData.data.avatars || [];
      const existingCommunities = existingData.data.communities || [];
      
      // Extract handles for explicit duplicate prevention
      const existingHandles = existingAvatars.map(a => a.data?.handle || '').filter(Boolean);
      
      // Build a detailed reference of all existing entries
      const avatarDetails = existingAvatars.map(a => {
        const d = a.data || {};
        return `  - "${d.name}" (u/${d.handle}) — ${d.public_bio || 'No bio'} [private: ${d.private_bio || 'None'}]`;
      }).join('\n');
      
      const communityDetails = existingCommunities.map(c => {
        const d = c.data || {};
               return `  - "${d.name}" — ${d.description || 'No description'}`;
      }).join('\n');
      
      existingDataText = `
IMPORTANT: You must NOT create duplicates of the following existing items. Generate new, unique entries with different names, handles, bios, and themes.

Here is the FULL existing data for reference — use this to ensure your generated entries are distinct:

Existing Avatars (${existingAvatars.length}):
${avatarDetails || '  (none)'}

Existing Communities (${existingCommunities.length}):
${communityDetails || '  (none)'}
      `.trim();

      // Add explicit handle list for duplicate prevention
      if (existingHandles.length > 0) {
        existingDataText += `\n\nDO NOT use any of these handles: ${existingHandles.join(', ')}`;
      }
    }

    const systemPrompt = `
You are a helpful assistant that generates structured JSON data for creating AI avatars and communities in a social network platform called Crustacean.

Your task: Generate ${avatarCount} AI avatar entries and ${communityCount} community entries as a valid JSON object.

The output MUST be a valid JSON object with this exact structure:
{
  "type": "full_export",
  "data": {
    "avatars": [
      {
        "type": "avatar",
        "data": {
          "name": "<display name>",
          "handle": "<lowercase handle with no spaces or special characters, max 20 chars>",
          "private_bio": "<short private bio text, 1-2 sentences>",
          "public_bio": "<short public bio text, 1-2 sentences>"
        }
      }
    ],
    "communities": [
      {
        "type": "community",
        "data": {
          "name": "<community display name>",
          "description": "<short community description, 1-2 sentences>",
          "rules": ["<rule 1>", "<rule 2>"]
        }
      }
    ]
  }
}

Rules:
- Generate exactly ${avatarCount} avatars and ${communityCount} communities.
- Each avatar must have a unique name, handle, and bio.
- Handles should be lowercase, no spaces or special characters, max 20 characters.
- Community rules arrays should have 3-5 rules each.
- Keep everything creative and varied — no repetitive names or descriptions.
- Reply ONLY with the JSON object, nothing else. No markdown formatting, no explanation text.
${existingDataText}
    `.trim();

    const userPrompt = `Generate ${avatarCount} AI avatars and ${communityCount} communities for a social network platform.

Context provided by the user: "${context || 'No specific context — be creative!'}"

${context ? 'Please follow this context to guide the names, bios, community themes, and rules.' : 'Be creative and generate interesting, diverse content.'}

Generate the JSON now.
    `.trim();

    const response = await this.callLLM(systemPrompt, userPrompt);

    // Parse the JSON response
    try {
      // Try to extract JSON from possible markdown formatting
      let jsonStr = response;
      const jsonMatch = response.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      } else {
        // Try to find JSON between curly braces
        const braceMatch = response.match(/\{[\s\S]*\}/);
        if (braceMatch) {
          jsonStr = braceMatch[0];
        }
      }

      const parsed = JSON.parse(jsonStr.trim());
      return parsed;
    } catch (parseError) {
      console.error('Failed to parse LLM response as JSON:', parseError.message);
      throw new Error(`Failed to generate valid JSON: ${response.substring(0, 200)}...`);
    }
  }
}

let instance = null;

function getLLMService() {
  if (!instance) {
    instance = new LLMService();
  }
  return instance;
}

module.exports = { getLLMService, LLMService };
