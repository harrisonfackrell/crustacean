import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');
const { Database, SCHEMA_VERSION } = require('../server/db');

const LEGACY_SCHEMA = `
  CREATE TABLE Avatars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    handle TEXT NOT NULL UNIQUE,
    private_bio TEXT DEFAULT '',
    public_bio TEXT DEFAULT ''
  );
  CREATE TABLE Communities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    rules TEXT DEFAULT '[]'
  );
  CREATE TABLE GlobalRules (id INTEGER PRIMARY KEY AUTOINCREMENT, rule TEXT NOT NULL);
  CREATE TABLE Posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    community_id INTEGER NOT NULL,
    avatar_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE Comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    parent_comment_id INTEGER DEFAULT NULL,
    avatar_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE Votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    avatar_id INTEGER NOT NULL,
    target_type TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    vote_value INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE AvatarCommunityPreferences (
    avatar_id INTEGER NOT NULL,
    community_id INTEGER NOT NULL,
    score REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (avatar_id, community_id)
  );
  CREATE TABLE AvatarRelationships (
    actor_id INTEGER NOT NULL,
    target_id INTEGER NOT NULL,
    score REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (actor_id, target_id)
  );
  CREATE TABLE Settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

let SQL;
let tmpDir;

function tableColumns(db, table) {
  // db.exec is the raw sql.js passthrough
  const result = db.exec(`PRAGMA table_info(${table})`);
  return (result[0] ? result[0].values : []).map(r => r[1]);
}

async function makeLegacyDbFile(file) {
  const legacy = new SQL.Database();
  legacy.run(LEGACY_SCHEMA);
  legacy.run("INSERT INTO Avatars (name, handle) VALUES ('A', 'a')");
  legacy.run("INSERT INTO Communities (name, description) VALUES ('dup', 'x')");
  legacy.run("INSERT INTO Communities (name, description) VALUES ('dup', 'y')");
  legacy.run("INSERT INTO Posts (community_id, avatar_id, content) VALUES (1, 1, 'One. Two. Three. Four. Five.')");
  legacy.run("INSERT INTO Comments (post_id, parent_comment_id, avatar_id, content) VALUES (1, NULL, 1, 'Hi.')");
  // duplicate vote rows that v2 must dedupe
  legacy.run("INSERT INTO Votes (avatar_id, target_type, target_id, vote_value) VALUES (1, 'post', 1, 1)");
  legacy.run("INSERT INTO Votes (avatar_id, target_type, target_id, vote_value) VALUES (1, 'post', 1, -1)");
  const data = legacy.export();
  fs.writeFileSync(file, Buffer.from(data));
  legacy.close();
}

beforeAll(async () => {
  SQL = await initSqlJs();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crustacean-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Database migrations', () => {
  it('upgrades a legacy (user_version=0) database to the current schema', async () => {
    const file = path.join(tmpDir, 'legacy.db');
    await makeLegacyDbFile(file);
    const db = new Database(file);
    await db.init();

    const version = db.exec('PRAGMA user_version')[0].values[0][0];
    expect(version).toBe(SCHEMA_VERSION);

    // v1: Posts.title
    expect(tableColumns(db.db, 'Posts')).toContain('title');
    // v4: length_scale added and backfilled (5 sentences -> scale 3)
    expect(tableColumns(db.db, 'Posts')).toContain('length_scale');
    expect(tableColumns(db.db, 'Comments')).toContain('length_scale');
    const post = db.get('SELECT length_scale FROM Posts WHERE id = 1');
    expect(post.length_scale).toBe(3);
    const comment = db.get('SELECT length_scale FROM Comments WHERE id = 1');
    expect(comment.length_scale).toBe(1);

    // v2: Votes deduped (2 rows with same key -> 1, first kept = +1)
    const votes = db.all('SELECT * FROM Votes');
    expect(votes.length).toBe(1);
    expect(votes[0].vote_value).toBe(1);

    // v5: Communities UNIQUE(name) with duplicates collapsed (first kept)
    const communities = db.all('SELECT * FROM Communities');
    expect(communities.length).toBe(1);
    expect(communities[0].description).toBe('x');

    // default settings seeded
    expect(db.get('SELECT value FROM Settings WHERE key = ?', ['llm_model']).value).toBe('llama3');

    db.db.close();
  });

  it('creates a fresh database at the current schema with settings', async () => {
    const file = path.join(tmpDir, 'fresh.db');
    const db = new Database(file);
    await db.init();
    expect(db.exec('PRAGMA user_version')[0].values[0][0]).toBe(SCHEMA_VERSION);
    expect(fs.existsSync(file)).toBe(true);
    expect(db.get('SELECT value FROM Settings WHERE key = ?', ['llm_api_url']).value)
      .toBe('http://localhost:11434/v1');
    db.db.close();
  });

  it('reopening a migrated database is a no-op (idempotent)', async () => {
    const file = path.join(tmpDir, 'reopened.db');
    await makeLegacyDbFile(file);
    const first = new Database(file);
    await first.init();
    first.db.close();

    const second = new Database(file);
    await second.init();
    expect(second.exec('PRAGMA user_version')[0].values[0][0]).toBe(SCHEMA_VERSION);
    // data still intact after reload + re-migration
    expect(second.all('SELECT * FROM Posts').length).toBe(1);
    second.db.close();
  });

  it('transaction commits and saves exactly once', async () => {
    const file = path.join(tmpDir, 'tx.db');
    const db = new Database(file);
    await db.init();
    const saveSpy = vi.spyOn(db, 'save');
    db.transaction(() => {
      db.run('INSERT INTO GlobalRules (rule) VALUES (?)', ['a']);
      db.run('INSERT INTO GlobalRules (rule) VALUES (?)', ['b']);
      db.run('INSERT INTO GlobalRules (rule) VALUES (?)', ['c']);
    });
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(db.all('SELECT * FROM GlobalRules').length).toBe(3);
    db.db.close();
  });

  it('transaction rolls back on error', async () => {
    const file = path.join(tmpDir, 'txfail.db');
    const db = new Database(file);
    await db.init();
    let threw = false;
    try {
      db.transaction(() => {
        db.run('INSERT INTO GlobalRules (rule) VALUES (?)', ['a']);
        throw new Error('boom');
      });
    } catch (err) {
      threw = true;
      expect(err.message).toBe('boom');
    }
    expect(threw).toBe(true);
    expect(db.all('SELECT * FROM GlobalRules').length).toBe(0);
    db.db.close();
  });

  it('atomic save leaves no .tmp file behind', async () => {
    const file = path.join(tmpDir, 'atomic.db');
    const db = new Database(file);
    await db.init();
    db.run('INSERT INTO GlobalRules (rule) VALUES (?)', ['x']);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
    expect(fs.existsSync(file)).toBe(true);
    db.db.close();
  });
});
