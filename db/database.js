const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'bot.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    coins INTEGER NOT NULL DEFAULT 0,
    aura INTEGER NOT NULL DEFAULT 0,
    items TEXT NOT NULL DEFAULT '{}',
    luck_bets_used INTEGER NOT NULL DEFAULT 0,
    luck_last_reset INTEGER NOT NULL DEFAULT 0,
    streak_count INTEGER NOT NULL DEFAULT 0,
    streak_last_claim TEXT
);

CREATE TABLE IF NOT EXISTS marriages (
    user_id TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS setup (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cooldowns (
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_users_coins ON users(coins DESC);
CREATE INDEX IF NOT EXISTS idx_users_aura ON users(aura DESC);

CREATE TABLE IF NOT EXISTS game_sessions (
    user_id TEXT NOT NULL,
    game_type TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    state TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, game_type)
);
`);

const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!cols.includes('tokens')) {
    db.exec("ALTER TABLE users ADD COLUMN tokens INTEGER NOT NULL DEFAULT 0");
    db.exec("CREATE INDEX IF NOT EXISTS idx_users_tokens ON users(tokens DESC)");
    console.log('[DB] Migrated: added tokens column to users table');
}

module.exports = db;