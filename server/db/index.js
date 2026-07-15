const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS Avatars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    handle TEXT NOT NULL UNIQUE,
    private_bio TEXT DEFAULT '',
    public_bio TEXT DEFAULT '',
    auto_interval INTEGER DEFAULT 5,
    vote_chance REAL DEFAULT 0.5,
    reply_chance REAL DEFAULT 0.5,
    is_auto_enabled BOOLEAN DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS Communities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
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

class Database {
  constructor() {
    this.dbPath = path.join(__dirname, '..', '..', 'data', 'crustacean.db');
    this.db = null;
    this.SQL = null;
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
      // Migration: Add title column to Posts if it doesn't exist
      try {
        this.db.run('ALTER TABLE Posts ADD COLUMN title TEXT DEFAULT ""');
      } catch (e) {
        // Column already exists
      }
      // Migration: Add UNIQUE constraint on (avatar_id, target_type, target_id) to Votes
      try {
        // Check if the Votes table already has the unique constraint by trying to create it
        // If the table already has it, this will fail (which is fine)
        // We need to recreate the table since SQLite doesn't support ALTER TABLE ADD CONSTRAINT
        const hasConstraint = this.db.get(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='Votes' AND sql LIKE '%UNIQUE(avatar_id, target_type, target_id)%'"
        );
        if (!hasConstraint) {
          // Recreate the Votes table with the unique constraint
          this.db.run('BEGIN TRANSACTION');
          this.db.run(`
            CREATE TABLE IF NOT EXISTS Votes_new (
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
          // Copy data, keeping only the first vote per (avatar_id, target_type, target_id)
          this.db.run(`
            INSERT INTO Votes_new (id, avatar_id, target_type, target_id, vote_value, created_at)
            SELECT id, avatar_id, target_type, target_id, vote_value, created_at
            FROM Votes
            WHERE id IN (
              SELECT MIN(id) FROM Votes GROUP BY avatar_id, target_type, target_id
            )
          `);
          this.db.run('DROP TABLE Votes');
          this.db.run('ALTER TABLE Votes_new RENAME TO Votes');
          this.db.run('COMMIT');
        }
      } catch (e) {
        // Migration already applied or error - ignore
      }
      // Migration: Add UNIQUE constraint on (avatar_id, post_id, parent_comment_id) to Comments
      try {
        const hasCommentsConstraint = this.db.get(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='Comments' AND sql LIKE '%UNIQUE(avatar_id, post_id, parent_comment_id)%'"
        );
        if (!hasCommentsConstraint) {
          // Recreate the Comments table with the unique constraint
          this.db.run('BEGIN TRANSACTION');
          this.db.run(`
            CREATE TABLE IF NOT EXISTS Comments_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              post_id INTEGER NOT NULL,
              parent_comment_id INTEGER DEFAULT NULL,
              avatar_id INTEGER NOT NULL,
              content TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              FOREIGN KEY (post_id) REFERENCES Posts(id) ON DELETE CASCADE,
              FOREIGN KEY (parent_comment_id) REFERENCES Comments(id) ON DELETE CASCADE,
              FOREIGN KEY (avatar_id) REFERENCES Avatars(id) ON DELETE CASCADE,
              UNIQUE(avatar_id, post_id, parent_comment_id)
            )
          `);
          // Copy data, keeping only the first comment per (avatar_id, post_id, parent_comment_id)
          this.db.run(`
            INSERT INTO Comments_new (id, post_id, parent_comment_id, avatar_id, content, created_at)
            SELECT id, post_id, parent_comment_id, avatar_id, content, created_at
            FROM Comments
            WHERE id IN (
              SELECT MIN(id) FROM Comments GROUP BY avatar_id, post_id, parent_comment_id
            )
          `);
          this.db.run('DROP TABLE Comments');
          this.db.run('ALTER TABLE Comments_new RENAME TO Comments');
          this.db.run('COMMIT');
        }
      } catch (e) {
        // Migration already applied or error - ignore
      }
    } else {
      this.db = new this.SQL.Database();
      this.db.run(SCHEMA);
      // Insert default settings
      this.db.run("INSERT OR IGNORE INTO Settings (key, value) VALUES ('auto_interact_enabled', 'false')");
      this.db.run("INSERT OR IGNORE INTO Settings (key, value) VALUES ('llm_api_url', 'http://localhost:11434/v1')");
      this.db.run("INSERT OR IGNORE INTO Settings (key, value) VALUES ('llm_api_key', '')");
      this.db.run("INSERT OR IGNORE INTO Settings (key, value) VALUES ('llm_model', 'llama3')");
      this.db.run("INSERT OR IGNORE INTO Settings (key, value) VALUES ('global_system_prompt', '')");
      this.save();
    }
  }

  save() {
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.dbPath, buffer);
  }

  run(sql, params = []) {
    this.db.run(sql, params);
    this.save();
    return this.db;
  }

  get(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      return row;
    }
    return null;
  }

  all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    return results;
  }

  lastInsertRowid() {
    const result = this.db.exec('SELECT last_insert_rowid() as id');
    if (result.length > 0 && result[0].values.length > 0) {
      return result[0].values[0][0];
    }
    return null;
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

module.exports = { initDatabase, getDatabase, Database, SCHEMA };
