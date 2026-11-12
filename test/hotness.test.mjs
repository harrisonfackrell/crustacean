import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { calculateHotness } = require('../server/utils/hotness');

const T0 = new Date('2026-01-01T00:00:00Z').toISOString();
const T_LATER = new Date('2026-01-02T00:00:00Z').toISOString(); // +1 day

describe('calculateHotness', () => {
  it('gives zero-vote posts a baseline of comment boost + time term', () => {
    const h = calculateHotness(0, 0, 0, T0);
    // score 0 -> order = log10(1) = 0; commentBoost = log10(1) = 0
    expect(h).toBeCloseTo(new Date(T0).getTime() / 1000 / 45000, 10);
  });

  it('ranks higher-scored posts above lower-scored ones (same age)', () => {
    expect(calculateHotness(100, 0, 0, T0)).toBeGreaterThan(calculateHotness(10, 0, 0, T0));
  });

  it('penalizes downvotes', () => {
    expect(calculateHotness(10, 0, 0, T0)).toBeGreaterThan(calculateHotness(0, 10, 0, T0));
  });

  it('boosts posts with more comments (same score, same age)', () => {
    expect(calculateHotness(10, 0, 50, T0)).toBeGreaterThan(calculateHotness(10, 0, 1, T0));
  });

  it('boosts newer posts (same score)', () => {
    expect(calculateHotness(10, 0, 0, T_LATER)).toBeGreaterThan(calculateHotness(10, 0, 0, T0));
  });

  it('handles very high scores with log10 scaling', () => {
    // log10(1000) = 3, commentBoost 0
    const h = calculateHotness(1000, 0, 0, T0);
    expect(h).toBeCloseTo(3 + new Date(T0).getTime() / 1000 / 45000, 10);
  });
});
