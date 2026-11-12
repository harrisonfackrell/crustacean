import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const { Database } = require('../server/db');
const {
  parseCommunityRules,
  enrichPosts,
  enrichComments,
  buildCommentTree,
  flattenCommentTree
} = require('../server/services/enrichment');

let tmpDir;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crustacean-enrich-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function seededDb() {
  const file = path.join(tmpDir, `enrich-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = new Database(file);
  await db.init();
  db.transaction(() => {
    db.run("INSERT INTO Avatars (name, handle) VALUES ('Al', 'al')");
    db.run("INSERT INTO Avatars (name, handle) VALUES ('Bo', 'bo')");
    db.run("INSERT INTO Communities (name, description, rules) VALUES ('c1', '', ?)", [JSON.stringify(['no spam'])]);
    db.run("INSERT INTO Posts (community_id, avatar_id, title, content) VALUES (1, 1, 't1', 'p1')");
    db.run("INSERT INTO Posts (community_id, avatar_id, title, content) VALUES (1, 2, 't2', 'p2')");
    db.run("INSERT INTO Comments (post_id, parent_comment_id, avatar_id, content) VALUES (1, NULL, 2, 'c1')");
    db.run("INSERT INTO Comments (post_id, parent_comment_id, avatar_id, content) VALUES (1, 1, 1, 'c2')");
    db.run("INSERT INTO Comments (post_id, parent_comment_id, avatar_id, content) VALUES (1, 2, 2, 'c3')");
    db.run("INSERT INTO Votes (avatar_id, target_type, target_id, vote_value) VALUES (2, 'post', 1, 1)");
    db.run("INSERT INTO Votes (avatar_id, target_type, target_id, vote_value) VALUES (1, 'comment', 1, 1)");
    db.run("INSERT INTO Votes (avatar_id, target_type, target_id, vote_value) VALUES (2, 'comment', 1, -1)");
  });
  return db;
}

describe('parseCommunityRules', () => {
  it('parses a JSON rules array', () => {
    expect(parseCommunityRules('["a", "b"]')).toEqual(['a', 'b']);
  });
  it('returns [] for empty, null, and invalid JSON', () => {
    expect(parseCommunityRules(null)).toEqual([]);
    expect(parseCommunityRules('')).toEqual([]);
    expect(parseCommunityRules('not json')).toEqual([]);
  });
  it('rejects non-array JSON (rules are always stored as arrays)', () => {
    expect(parseCommunityRules('"just one"')).toEqual([]);
    expect(parseCommunityRules('42')).toEqual([]);
  });
});

describe('enrichPosts', () => {
  it('adds avatars, vote tallies, and comment counts in one pass', async () => {
    const db = await seededDb();
    const posts = enrichPosts(db, db.all('SELECT * FROM Posts ORDER BY id'));
    expect(posts.length).toBe(2);
    expect(posts[0].avatar.handle).toBe('al');
    expect(posts[0].upvotes).toBe(1);
    expect(posts[0].downvotes).toBe(0);
    expect(posts[0].commentCount).toBe(3);
    expect(posts[1].commentCount).toBe(0);
    db.db.close();
  });
});

describe('enrichComments + buildCommentTree', () => {
  it('builds a nested tree with avatars and scores', async () => {
    const db = await seededDb();
    const tree = buildCommentTree(
      enrichComments(db, db.all('SELECT * FROM Comments WHERE post_id = 1'))
    );
    expect(tree.length).toBe(1);
    expect(tree[0].content).toBe('c1');
    expect(tree[0].avatar.handle).toBe('bo');
    expect(tree[0].score).toBe(0); // +1 and -1
    expect(tree[0].replies.length).toBe(1);
    expect(tree[0].replies[0].content).toBe('c2');
    expect(tree[0].replies[0].replies.length).toBe(1);
    expect(tree[0].replies[0].replies[0].content).toBe('c3');

    const flat = flattenCommentTree(tree);
    expect(flat.map(c => c.content)).toEqual(['c1', 'c2', 'c3']);
    db.db.close();
  });

  it('promotes orphaned replies to top level', async () => {
    const db = await seededDb();
    db.run('DELETE FROM Comments WHERE id = 1');
    const comments = enrichComments(db, db.all('SELECT * FROM Comments WHERE post_id = 1'));
    // c2's parent (1) is gone -> promoted to root; c3's parent (2) still
    // exists -> stays nested under c2
    const tree = buildCommentTree(comments);
    expect(tree.length).toBe(1);
    expect(tree[0].content).toBe('c2');
    expect(tree[0].replies[0].content).toBe('c3');
    db.db.close();
  });
});
