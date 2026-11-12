const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { estimateLengthScale } = require('../utils/lengthScale');

// Current schema. New databases are created directly with this schema and
// stamped with SCHEMA_VERSION. Existing databases are upgraded by the
// idempotent migrations in MIGRATIONS (run against PRAGMA user_version).
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS Avatars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    handle TEXT NOT NULL UNIQUE,
    private_bio TEXT DEFAULT '',
    public_bio TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS Communities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    rules TEXT DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS GlobalRules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS Posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    community_id INTEGER NOT NULL,
    avatar_id INTEGER NOT NULL,
    title TEXT DEFAULT '',
    content TEXT NOT NULL,
    length_scale INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (community_id) REFERENCES Communities(id) ON DELETE CASCADE,
    FOREIGN KEY (avatar_id) REFERENCES Avatars(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS Comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    parent_comment_id INTEGER DEFAULT NULL,
    avatar_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    length_scale INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (post_id) REFERENCES Posts(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_comment_id) REFERENCES Comments(id) ON DELETE CASCADE,
    FOREIGN KEY (avatar_id) REFERENCES Avatars(id) ON DELETE CASCADE,
    UNIQUE(avatar_id, post_id, parent_comment_id)
  );

  CREATE TABLE IF NOT EXISTS Votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    avatar_id INTEGER NOT NULL,
    target_type TEXT NOT NULL CHECK(target_type IN ('post', 'comment')),
    target_id INTEGER NOT NULL,
    vote_value INTEGER NOT NULL CHECK(vote_value IN (1, -1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (avatar_id) REFERENCES Avatars(id) ON DELETE CASCADE,
    UNIQUE(avatar_id, target_type, target_id)
  );

  CREATE TABLE IF NOT EXISTS AvatarCommunityPreferences (
    avatar_id INTEGER NOT NULL,
    community_id INTEGER NOT NULL,
    score REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (avatar_id, community_id),
    FOREIGN KEY (avatar_id) REFERENCES Avatars(id) ON DELETE CASCADE,
    FOREIGN KEY (community_id) REFERENCES Communities(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS AvatarRelationships (
    actor_id INTEGER NOT NULL,
    target_id INTEGER NOT NULL,
    score REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (actor_id, target_id),
    FOREIGN KEY (actor_id) REFERENCES Avatars(id) ON DELETE CASCADE,
    FOREIGN KEY (target_id) REFERENCES Avatars(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS Settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

const DEFAULT_SETTINGS = [
  ['llm_api_url', 'http://localhost:11434/v1'],
  ['llm_api_key', ''],
  ['llm_model', 'llama3'],
  ['global_system_prompt', '']
];

// ============================================================
// Migration helpers
// ============================================================

function tableColumns(db, table) {
  const result = db.exec(`PRAGMA table_info(${table})`);
  const rows = (result[0] && result[0].values) || [];
  return new Set(rows.map(r => r[1]));
}

function tableHasConstraint(db, table, needle) {
  const row = db.get("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", [table]);
  return !!(row && row.sql && row.sql.includes(needle));
}

// Versioned, idempotent migrations. Each entry upgrades to `version`
// (1-based, in order). Idempotency matters because databases created
// before versioned migrations existed (user_version = 0) run every
// migration, including ones already applied by the old ad-hoc code.
const MIGRATIONS = [
  {
    // v1: Posts.title
    up(db) {
      if (!tableColumns(db, 'Posts').has('title')) {
        db.run('ALTER TABLE Posts ADD COLUMN title TEXT DEFAULT ""');
      }
    }
  },
  {
    // v2: UNIQUE(avatar_id, target_type, target_id) on Votes
    // (SQLite can't add constraints to existing tables; recreate it)
    up(db) {
      if (tableHasConstraint(db, 'Votes', 'UNIQUE(avatar_id, target_type, target_id)')) return;
      db.transaction(() => {
        db.run(`
          CREATE TABLE Votes_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            avatar_id INTEGER NOT NULL,
            target_type TEXT NOT NULL CHECK(target_type IN ('post', 'comment')),
            target_id INTEGER NOT NULL,
            vote_value INTEGER NOT NULL CHECK(vote_value IN (1, -1)),
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (avatar_id) REFERENCES Avatars(id) ON DELETE CASCADE,
            UNIQUE(avatar_id, target_type, target_id)
          )
        `);
        // Keep only the first vote per (avatar_id, target_type, target_id)
        db.run(`
          INSERT INTO Votes_new (id, avatar_id, target_type, target_id, vote_value, created_at)
          SELECT id, avatar_id, target_type, target_id, vote_value, created_at
          FROM Votes
          WHERE id IN (SELECT MIN(id) FROM Votes GROUP BY avatar_id, target_type, target_id)
        `);
        db.run('DROP TABLE Votes');
        db.run('ALTER TABLE Votes_new RENAME TO Votes');
      });
    }
  },
  {
    // v3: UNIQUE(avatar_id, post_id, parent_comment_id) on Comments
    up(db) {
      if (tableHasConstraint(db, 'Comments', 'UNIQUE(avatar_id, post_id, parent_comment_id)')) return;
      const hasScale = tableColumns(db, 'Comments').has('length_scale');
      const cols = hasScale
        ? 'id, post_id, parent_comment_id, avatar_id, content, length_scale, created_at'
        : 'id, post_id, parent_comment_id, avatar_id, content, created_at';
      db.transaction(() => {
        db.run(`
          CREATE TABLE Comments_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id INTEGER NOT NULL,
            parent_comment_id INTEGER DEFAULT NULL,
            avatar_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            ${hasScale ? 'length_scale INTEGER DEFAULT 1,' : ''}
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (post_id) REFERENCES Posts(id) ON DELETE CASCADE,
            FOREIGN KEY (parent_comment_id) REFERENCES Comments(id) ON DELETE CASCADE,
            FOREIGN KEY (avatar_id) REFERENCES Avatars(id) ON DELETE CASCADE,
            UNIQUE(avatar_id, post_id, parent_comment_id)
          )
        `);
        // Keep only the first comment per (avatar_id, post_id, parent_comment_id)
        db.run(`
          INSERT INTO Comments_new (${cols})
          SELECT ${cols} FROM Comments
          WHERE id IN (SELECT MIN(id) FROM Comments GROUP BY avatar_id, post_id, parent_comment_id)
        `);
        db.run('DROP TABLE Comments');
        db.run('ALTER TABLE Comments_new RENAME TO Comments');
      });
    }
  },
  {
    // v4: length_scale on Posts and Comments, backfilled from content
    up(db) {
      const needPost = !tableColumns(db, 'Posts').has('length_scale');
      const needComment = !tableColumns(db, 'Comments').has('length_scale');
      if (needPost) db.run('ALTER TABLE Posts ADD COLUMN length_scale INTEGER DEFAULT 1');
      if (needComment) db.run('ALTER TABLE Comments ADD COLUMN length_scale INTEGER DEFAULT 1');

      if (needPost || needComment) {
        db.transaction(() => {
          if (needPost) {
            const postRows = db.all('SELECT id, title, content FROM Posts');
            for (const row of postRows) {
              const scale = estimateLengthScale(row.title ? `${row.title}\n${row.content}` : row.content);
              db.run('UPDATE Posts SET length_scale = ? WHERE id = ?', [scale, row.id]);
            }
          }
          if (needComment) {
            const commentRows = db.all('SELECT id, content FROM Comments');
            for (const row of commentRows) {
              db.run('UPDATE Comments SET length_scale = ? WHERE id = ?', [estimateLengthScale(row.content), row.id]);
            }
          }
        });
      }
    }
  },
  {
    // v5: UNIQUE(name) on Communities (import deduplication)
    up(db) {
      if (tableHasConstraint(db, 'Communities', 'UNIQUE')) return;
      db.transaction(() => {
        db.run(`
          CREATE TABLE Communities_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT DEFAULT '',
            rules TEXT DEFAULT '[]'
          )
        `);
        // Keep only the first community with each name
        db.run(`
          INSERT INTO Communities_new (id, name, description, rules)
          SELECT id, name, description, rules FROM Communities
          WHERE id IN (SELECT MIN(id) FROM Communities GROUP BY name)
        `);
        db.run('DROP TABLE Communities');
        db.run('ALTER TABLE Communities_new RENAME TO Communities');
      });
    }
  }
];

const SCHEMA_VERSION = MIGRATIONS.length;

class Database {
  constructor(dbPath = null) {
    this.dbPath = dbPath || path.join(__dirname, '..', '..', 'data', 'crustacean.db');
    this.db = null;
    this.SQL = null;
    this._lastInsertId = null;
    this._changes = 0;
    this._inTransaction = false;
  }

  async init() {
    this.SQL = await initSqlJs();

    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    if (fs.existsSync(this.dbPath)) {
      const filebuffer = fs.readFileSync(this.dbPath);
      this.db = new this.SQL.Database(filebuffer);
      this._runMigrations();
    } else {
      this.db = new this.SQL.Database();
      this.db.run(SCHEMA);
      this._setUserVersion(SCHEMA_VERSION);
      this._seedDefaultSettings();
      this.save();
    }
  }

  // ============================================================
  // Persistence
  // ============================================================

  save() {
    // Atomic write: export to a temp file, then rename over the real one,
    // so a crash mid-write can never leave a truncated database file.
    const data = this.db.export();
    const buffer = Buffer.from(data);
    const tmpPath = `${this.dbPath}.tmp`;
    fs.writeFileSync(tmpPath, buffer);
    fs.renameSync(tmpPath, this.dbPath);
  }

  // Run a batch of writes as one transaction and persist exactly once.
  // Nested calls run inline; the outermost call commits and saves.
  // Returns whatever fn() returns.
  transaction(fn) {
    if (this._inTransaction) {
      return fn();
    }
    this._inTransaction = true;
    try {
      this.db.run('BEGIN');
      const result = fn();
      this.db.run('COMMIT');
      this.save();
      return result;
    } catch (err) {
      try { this.db.run('ROLLBACK'); } catch { /* connection already broken */ }
      throw err;
    } finally {
      this._inTransaction = false;
    }
  }

  // ============================================================
  // Query API
  // ============================================================

  run(sql, params = []) {
    this.db.run(sql, params);
    // Capture the last inserted rowid and affected-row count before any
    // save: db.export() (inside save()) resets both on the connection.
    const result = this.db.exec('SELECT last_insert_rowid() as id, changes() as changes');
    if (result[0] && result[0].values[0]) {
      this._lastInsertId = result[0].values[0][0];
      this._changes = result[0].values[0][1];
    } else {
      this._lastInsertId = null;
      this._changes = 0;
    }
    if (!this._inTransaction) {
      this.save();
    }
    return this;
  }

  get(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  }

  // Raw sql.js passthrough for statements the wrapper doesn't model
  // (schema introspection via PRAGMAs, etc.).
  exec(sql) {
    return this.db.exec(sql);
  }

  all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  // Rowid of the row inserted by the most recent run() call (null if none).
  lastInsertRowid() {
    return this._lastInsertId !== null ? this._lastInsertId : null;
  }

  // Number of rows modified by the most recent run() call.
  changes() {
    return this._changes;
  }

  // ============================================================
  // Migrations
  // ============================================================

  _getUserVersion() {
    const result = this.db.exec('PRAGMA user_version');
    return (result[0] && result[0].values[0] && result[0].values[0][0]) || 0;
  }

  _setUserVersion(version) {
    this.db.run(`PRAGMA user_version = ${parseInt(version, 10)}`);
  }

  _seedDefaultSettings() {
    for (const [key, value] of DEFAULT_SETTINGS) {
      this.db.run('INSERT OR IGNORE INTO Settings (key, value) VALUES (?, ?)', [key, value]);
    }
  }

  _runMigrations() {
    const version = this._getUserVersion();

    if (version === 0) {
      // Legacy database from before versioned migrations: the old code
      // applied the same upgrades ad-hoc on every startup, so run the
      // full list. Every migration is idempotent, so the ones that were
      // already applied are no-ops.
      for (const migration of MIGRATIONS) {
        migration.up(this);
      }
      this._setUserVersion(SCHEMA_VERSION);
    } else {
      for (let i = version; i < MIGRATIONS.length; i++) {
        MIGRATIONS[i].up(this);
      }
    }

    this.transaction(() => {
      this._seedDefaultSettings();
    });
  }

  // ============================================================
  // Reset / destroy
  // ============================================================

  destroy() {
    // Preserve LLM connection settings before destroying the database
    const preserved = {};
    const keys = ['llm_api_url', 'llm_api_key', 'llm_model', 'global_system_prompt'];
    try {
      if (this.db) {
        for (const key of keys) {
          const row = this.get('SELECT value FROM Settings WHERE key = ?', [key]);
          preserved[key] = row ? row.value : null;
        }
      }
    } catch {
      // If we can't read settings, they'll fall back to defaults
    }

    if (this.db) {
      this.db.close();
      this.db = null;
    }

    if (fs.existsSync(this.dbPath)) {
      fs.unlinkSync(this.dbPath);
    }

    // Reinitialize with a fresh database
    this.db = new this.SQL.Database();
    this.db.run(SCHEMA);
    this._setUserVersion(SCHEMA_VERSION);
    for (const [key, defaultValue] of DEFAULT_SETTINGS) {
      const value = preserved[key] !== null && preserved[key] !== undefined ? preserved[key] : defaultValue;
      this.db.run('INSERT OR REPLACE INTO Settings (key, value) VALUES (?, ?)', [key, value]);
    }
    this.save();
  }
}

// Singleton instance - initialized by server/index.js
let instance = null;

async function initDatabase() {
  if (!instance) {
    instance = new Database();
    await instance.init();
  }
  return instance;
}

function getDatabase() {
  return instance;
}

module.exports = { initDatabase, getDatabase, Database, SCHEMA, SCHEMA_VERSION };
