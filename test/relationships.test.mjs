import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { updateRelationship } = require('../server/utils/relationships');

// Minimal in-memory stand-in for the Database wrapper.
function makeDb() {
  const store = new Map();
  const key = (a, t) => `${a}->${t}`;
  return {
    get(sql, params) {
      const m = /FROM AvatarRelationships WHERE actor_id = \? AND target_id = \?/.exec(sql);
      if (!m) return null;
      const row = store.get(key(params[0], params[1]));
      return row ? { score: row } : null;
    },
    run(sql, params) {
      const isUpdate = /UPDATE AvatarRelationships/.test(sql);
      const k = key(params[1], params[2]);
      if (isUpdate) {
        store.set(k, params[0]);
      } else {
        // INSERT (avatar_id, target_id, score)
        store.set(key(params[0], params[1]), params[2]);
      }
      return { run() { return this; } };
    },
    _store: store
  };
}

describe('updateRelationship', () => {
  let db;
  beforeEach(() => { db = makeDb(); });

  it('ignores self-relationships', () => {
    updateRelationship(db, 1, 1, 1);
    expect(db._store.size).toBe(0);
  });

  it('creates both directions for a new relationship', () => {
    updateRelationship(db, 1, 2, 1);
    // actor impact 2: 1*2/(1+0) = 2 ; target impact 1: 1*1/(1+0) = 1
    expect(db._store.get('1->2')).toBeCloseTo(2);
    expect(db._store.get('2->1')).toBeCloseTo(1);
  });

  it('downvotes move both directions negative', () => {
    updateRelationship(db, 1, 2, -1);
    expect(db._store.get('1->2')).toBeCloseTo(-2);
    expect(db._store.get('2->1')).toBeCloseTo(-1);
  });

  it('dampens change as |score| grows', () => {
    updateRelationship(db, 1, 2, 1); // 1->2 = 2
    updateRelationship(db, 1, 2, 1); // 2 + 2/(1+2) = 2.667
    expect(db._store.get('1->2')).toBeCloseTo(2 + 2 / 3);
  });

  it('accumulates over repeated votes', () => {
    updateRelationship(db, 1, 2, 1);
    updateRelationship(db, 1, 2, 1);
    updateRelationship(db, 1, 2, -1);
    const score = db._store.get('1->2');
    // 2 -> 2.667 -> 2.667 - 2/(1+2.667)
    expect(score).toBeCloseTo(2 + 2 / 3 - 2 / (1 + 2 + 2 / 3));
  });
});
