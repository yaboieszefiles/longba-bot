const db = require('./database');

db.exec(`
    CREATE TABLE IF NOT EXISTS search_cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        cached_at INTEGER NOT NULL
    )
`);

const stmtGet = db.prepare('SELECT value FROM search_cache WHERE key = ?');
const stmtSet = db.prepare(`
    INSERT INTO search_cache (key, value, cached_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, cached_at = excluded.cached_at
`);
const stmtDelete = db.prepare('DELETE FROM search_cache WHERE key = ?');

function normalizeKey(str) {
    return String(str).toLowerCase().trim().replace(/\s+/g, ' ');
}

function get(key) {
    const row = stmtGet.get(key);
    if (!row) return null;
    try {
        return JSON.parse(row.value);
    } catch {
        stmtDelete.run(key);
        return null;
    }
}

function set(key, value) {
    stmtSet.run(key, JSON.stringify(value), Date.now());
}

module.exports = {
        getSpotifySearch(query, type, limit) {
        return get(`spotify:${type}:${limit}:${normalizeKey(query)}`);
    },
    setSpotifySearch(query, type, limit, value) {
        set(`spotify:${type}:${limit}:${normalizeKey(query)}`, value);
    },

        getYoutubeUrl(name, artist) {
        return get(`yt:${normalizeKey(name)}|${normalizeKey(artist)}`);
    },
    setYoutubeUrl(name, artist, url) {
        set(`yt:${normalizeKey(name)}|${normalizeKey(artist)}`, url);
    }
};
