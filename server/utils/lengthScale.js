/**
 * Length Scale Utility
 *
 * Maps a piece of text to a discrete "length scale" of 1-10, matching the
 * qualitative buckets used by LLMService.getLengthInstruction(). The scale is
 * derived from the text's sentence count and is persisted on Posts/Comments so
 * that reply-length generation can bias toward the length of the content it is
 * responding to, rather than re-estimating it on the fly.
 */

/**
 * Estimate the 1-10 length scale of a piece of text from its sentence count.
 * Bucket boundaries mirror getLengthInstruction() in services/llm.js.
 *
 * @param {string} text
 * @returns {number} A length scale between 1 and 10.
 */
function estimateLengthScale(text) {
  if (!text || text.trim() === '') return 1;

  const sentences = text
    .split(/[.!?]+/)
    .filter(s => s.trim().length > 0)
    .length;

  if (sentences <= 1) return 1;
  if (sentences <= 4) return 2;
  if (sentences <= 10) return 3;
  if (sentences <= 16) return 4;
  if (sentences <= 24) return 5;
  if (sentences <= 34) return 6;
  if (sentences <= 46) return 7;
  if (sentences <= 58) return 8;
  if (sentences <= 70) return 9;
  return 10;
}

module.exports = { estimateLengthScale };
