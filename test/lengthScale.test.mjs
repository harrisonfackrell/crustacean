import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { estimateLengthScale } = require('../server/utils/lengthScale');

function sentences(n) {
  return Array.from({ length: n }, (_, i) => `Sentence ${i + 1}.`).join(' ');
}

describe('estimateLengthScale', () => {
  it('returns 1 for empty/whitespace text', () => {
    expect(estimateLengthScale('')).toBe(1);
    expect(estimateLengthScale('   ')).toBe(1);
    expect(estimateLengthScale(null)).toBe(1);
  });

  it('returns 1 for a single sentence', () => {
    expect(estimateLengthScale('Just one sentence.')).toBe(1);
    expect(estimateLengthScale('No period at all')).toBe(1);
  });

  it('buckets by sentence count boundaries', () => {
    expect(estimateLengthScale(sentences(2))).toBe(2);
    expect(estimateLengthScale(sentences(4))).toBe(2);
    expect(estimateLengthScale(sentences(5))).toBe(3);
    expect(estimateLengthScale(sentences(10))).toBe(3);
    expect(estimateLengthScale(sentences(16))).toBe(4);
    expect(estimateLengthScale(sentences(24))).toBe(5);
    expect(estimateLengthScale(sentences(34))).toBe(6);
    expect(estimateLengthScale(sentences(46))).toBe(7);
    expect(estimateLengthScale(sentences(58))).toBe(8);
    expect(estimateLengthScale(sentences(70))).toBe(9);
    expect(estimateLengthScale(sentences(71))).toBe(10);
  });

  it('splits on all terminal punctuation', () => {
    expect(estimateLengthScale('One! Two? Three.')).toBe(2);
  });
});
