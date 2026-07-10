const db = require('./database');

db.exec(`
    CREATE TABLE IF NOT EXISTS guild_members (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT,
        global_name TEXT,
        updated_at INTEGER,
        PRIMARY KEY (guild_id, user_id)
    )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_guild_members_guild ON guild_members (guild_id)`);

const upsertGuildMemberStmt = db.prepare(`
    INSERT INTO guild_members (guild_id, user_id, username, global_name, updated_at)
    VALUES (@guild_id, @user_id, @username, @global_name, @updated_at)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
        username = excluded.username,
        global_name = excluded.global_name,
        updated_at = excluded.updated_at
`);
const deleteGuildMemberStmt = db.prepare('DELETE FROM guild_members WHERE guild_id = ? AND user_id = ?');
const deleteGuildMembersForGuildStmt = db.prepare('DELETE FROM guild_members WHERE guild_id = ?');
const getGuildMembersStmt = db.prepare('SELECT user_id, username, global_name FROM guild_members WHERE guild_id = ?');
const countGuildMembersStmt = db.prepare('SELECT COUNT(*) AS count FROM guild_members WHERE guild_id = ?');

function isGuildMemberCacheSeeded(guildId) {
    return countGuildMembersStmt.get(guildId).count > 0;
}

function upsertGuildMember(guildId, userId, username, globalName) {
    upsertGuildMemberStmt.run({
        guild_id: guildId,
        user_id: userId,
        username: username ?? null,
        global_name: globalName ?? null,
        updated_at: Date.now()
    });
}

function removeGuildMember(guildId, userId) {
    deleteGuildMemberStmt.run(guildId, userId);
}

function setGuildMembers(guildId, members) {
    const tx = db.transaction((rows) => {
        deleteGuildMembersForGuildStmt.run(guildId);
        const now = Date.now();
        for (const m of rows) {
            upsertGuildMemberStmt.run({
                guild_id: guildId,
                user_id: m.userId,
                username: m.username ?? null,
                global_name: m.globalName ?? null,
                updated_at: now
            });
        }
    });
    tx(members);
}

function getGuildMembers(guildId) {
    return getGuildMembersStmt.all(guildId);
}

function clearGuildMembers(guildId) {
    deleteGuildMembersForGuildStmt.run(guildId);
}

const upsertUserStmt = db.prepare(`
    INSERT INTO users (user_id, coins, aura, tokens, items, luck_bets_used, luck_last_reset, streak_count, streak_last_claim)
    VALUES (@user_id, @coins, @aura, @tokens, @items, @luck_bets_used, @luck_last_reset, @streak_count, @streak_last_claim)
    ON CONFLICT(user_id) DO UPDATE SET
        coins = excluded.coins,
        aura = excluded.aura,
        tokens = excluded.tokens,
        items = excluded.items,
        luck_bets_used = excluded.luck_bets_used,
        luck_last_reset = excluded.luck_last_reset,
        streak_count = excluded.streak_count,
        streak_last_claim = excluded.streak_last_claim
`);

const getUserStmt = db.prepare('SELECT * FROM users WHERE user_id = ?');
const addCoinsStmt = db.prepare(`
    INSERT INTO users (user_id, coins) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET coins = coins + excluded.coins
`);
const setCoinsStmt = db.prepare(`
    INSERT INTO users (user_id, coins) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET coins = excluded.coins
`);
const addAuraStmt = db.prepare(`
    INSERT INTO users (user_id, aura) VALUES (?, 0)
    ON CONFLICT(user_id) DO NOTHING
`);
const setAuraStmt = db.prepare('UPDATE users SET aura = ? WHERE user_id = ?');
const addTokensStmt = db.prepare(`
    INSERT INTO users (user_id, tokens) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET tokens = tokens + excluded.tokens
`);
const setTokensStmt = db.prepare(`
    INSERT INTO users (user_id, tokens) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET tokens = excluded.tokens
`);
const updateItemsStmt = db.prepare(`
    INSERT INTO users (user_id, items) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET items = excluded.items
`);
const updateLuckStmt = db.prepare(`
    INSERT INTO users (user_id, luck_bets_used, luck_last_reset) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
        luck_bets_used = excluded.luck_bets_used,
        luck_last_reset = excluded.luck_last_reset
`);
const updateStreakStmt = db.prepare(`
    INSERT INTO users (user_id, streak_count, streak_last_claim) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
        streak_count = excluded.streak_count,
        streak_last_claim = excluded.streak_last_claim
`);

function parseItems(raw) {
    try {
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function ensureUser(userId) {
    db.prepare('INSERT OR IGNORE INTO users (user_id) VALUES (?)').run(userId);
}

function getUserRow(userId) {
    ensureUser(userId);
    return getUserStmt.get(userId);
}

function getCoins(userId) {
    const row = getUserRow(userId);
    return row?.coins ?? 0;
}

function setCoins(userId, coins) {
    setCoinsStmt.run(userId, Math.max(0, Math.floor(coins)));
}

function addCoins(userId, amount) {
    addCoinsStmt.run(userId, Math.floor(amount));
}

function getAura(userId) {
    const row = getUserRow(userId);
    return row?.aura ?? 0;
}

function addAura(userId, amount) {
    ensureUser(userId);
    db.prepare('UPDATE users SET aura = aura + ? WHERE user_id = ?').run(Math.floor(amount), userId);
}

function setAura(userId, aura) {
    ensureUser(userId);
    setAuraStmt.run(Math.floor(aura), userId);
}

function getTokens(userId) {
    const row = getUserRow(userId);
    return row?.tokens ?? 0;
}

function addTokens(userId, amount) {
    addTokensStmt.run(userId, Math.floor(amount));
}

function setTokens(userId, tokens) {
    setTokensStmt.run(userId, Math.max(0, Math.floor(tokens)));
}

function getItems(userId) {
    const row = getUserRow(userId);
    return parseItems(row?.items);
}

function setItems(userId, items) {
    updateItemsStmt.run(userId, JSON.stringify(items || {}));
}

function getLuck(userId) {
    const row = getUserRow(userId);
    return {
        betsUsed: row?.luck_bets_used ?? 0,
        lastReset: row?.luck_last_reset ?? 0
    };
}

function setLuck(userId, luck) {
    updateLuckStmt.run(userId, luck.betsUsed ?? 0, luck.lastReset ?? 0);
}

function getStreak(userId) {
    const row = getUserRow(userId);
    return {
        lastClaim: row?.streak_last_claim ?? null,
        streak: row?.streak_count ?? 0
    };
}

function setStreak(userId, streak) {
    updateStreakStmt.run(userId, streak.streak ?? 0, streak.lastClaim ?? null);
}

function getAllCoinsMap() {
    const map = {};
    for (const row of db.prepare('SELECT user_id, coins FROM users WHERE coins != 0').all()) {
        map[row.user_id] = row.coins;
    }
    return map;
}

function getAllItemsMap() {
    const map = {};
    for (const row of db.prepare('SELECT user_id, items FROM users WHERE items != \'{}\'').all()) {
        map[row.user_id] = parseItems(row.items);
    }
    return map;
}

function getTopCoins(limit = 10) {
    return db.prepare('SELECT user_id, coins FROM users ORDER BY coins DESC LIMIT ?').all(limit);
}

function getTopAura(limit = 10) {
    return db.prepare('SELECT user_id, aura FROM users ORDER BY aura DESC LIMIT ?').all(limit);
}

function getTopTokens(limit = 10) {
    return db.prepare('SELECT user_id, tokens FROM users ORDER BY tokens DESC LIMIT ?').all(limit);
}

function getPartner(userId) {
    const row = db.prepare('SELECT partner_id FROM marriages WHERE user_id = ?').get(userId);
    return row?.partner_id ?? null;
}

function isMarried(userId) {
    return Boolean(getPartner(userId));
}

function setMarriage(userId, partnerId) {
    const tx = db.transaction(() => {
        db.prepare('INSERT OR REPLACE INTO marriages (user_id, partner_id) VALUES (?, ?)').run(userId, partnerId);
        db.prepare('INSERT OR REPLACE INTO marriages (user_id, partner_id) VALUES (?, ?)').run(partnerId, userId);
    });
    tx();
}

function clearMarriage(userId) {
    const partnerId = getPartner(userId);
    const tx = db.transaction(() => {
        db.prepare('DELETE FROM marriages WHERE user_id = ?').run(userId);
        if (partnerId) {
            db.prepare('DELETE FROM marriages WHERE user_id = ?').run(partnerId);
        }
    });
    tx();
    return partnerId;
}

function getSetup() {
    const setup = {};
    for (const row of db.prepare('SELECT key, value FROM setup').all()) {
        setup[row.key] = row.value;
    }
    return setup;
}

function getSetupValue(key, defaultValue = null) {
    const row = db.prepare('SELECT value FROM setup WHERE key = ?').get(key);
    return row ? row.value : defaultValue;
}

function setSetupValue(key, value) {
    db.prepare('INSERT OR REPLACE INTO setup (key, value) VALUES (?, ?)').run(key, String(value));
}

function importUser(userId, data) {
    upsertUserStmt.run({
        user_id: userId,
        coins: data.coins ?? 0,
        aura: data.aura ?? 0,
        tokens: data.tokens ?? 0,
        items: JSON.stringify(data.items ?? {}),
        luck_bets_used: data.luck?.betsUsed ?? 0,
        luck_last_reset: data.luck?.lastReset ?? 0,
        streak_count: data.streak?.streak ?? 0,
        streak_last_claim: data.streak?.lastClaim ?? null
    });
}

function importFromLegacyJson({
    points = {},
    reputation = {},
    tokens = {},
    items = {},
    luck = {},
    streaks = {}
}) {
    const allIds = new Set([
        ...Object.keys(points),
        ...Object.keys(reputation),
        ...Object.keys(tokens),
        ...Object.keys(items),
        ...Object.keys(luck),
        ...Object.keys(streaks)
    ]);

    const tx = db.transaction((ids) => {
        for (const userId of ids) {
            importUser(userId, {
                coins: points[userId] ?? 0,
                aura: reputation[userId] ?? 0,
                tokens: tokens[userId] ?? 0,
                items: items[userId] ?? {},
                luck: luck[userId]
                    ? { betsUsed: luck[userId].betsUsed ?? 0, lastReset: luck[userId].lastReset ?? 0 }
                    : undefined,
                streak: streaks[userId]
                    ? { streak: streaks[userId].streak ?? 0, lastClaim: streaks[userId].lastClaim ?? null }
                    : undefined
            });
        }
    });
    tx(allIds);
}

function importMarriages(marriages) {
    const seen = new Set();
    const tx = db.transaction(() => {
        for (const [userId, partnerId] of Object.entries(marriages)) {
            const key = [userId, partnerId].sort().join(':');
            if (seen.has(key)) continue;
            seen.add(key);
            db.prepare('INSERT OR REPLACE INTO marriages (user_id, partner_id) VALUES (?, ?)').run(userId, partnerId);
            db.prepare('INSERT OR REPLACE INTO marriages (user_id, partner_id) VALUES (?, ?)').run(partnerId, userId);
        }
    });
    tx();
}

function importSetup(setupData) {
    const tx = db.transaction(() => {
        for (const [key, value] of Object.entries(setupData || {})) {
            if (value !== undefined && value !== null) {
                setSetupValue(key, value);
            }
        }
    });
    tx();
}

function getCooldown(userId, key) {
    const row = db.prepare('SELECT expires_at FROM cooldowns WHERE user_id = ? AND key = ?').get(userId, key);
    return row?.expires_at ?? 0;
}

function setCooldown(userId, key, expiresAt) {
    db.prepare(`
        INSERT INTO cooldowns (user_id, key, expires_at) VALUES (?, ?, ?)
        ON CONFLICT(user_id, key) DO UPDATE SET expires_at = excluded.expires_at
    `).run(userId, key, expiresAt);
}

const saveGameSessionStmt = db.prepare(`
    INSERT INTO game_sessions (user_id, game_type, channel_id, message_id, state, updated_at)
    VALUES (@user_id, @game_type, @channel_id, @message_id, @state, @updated_at)
    ON CONFLICT(user_id, game_type) DO UPDATE SET
        channel_id = excluded.channel_id,
        message_id = excluded.message_id,
        state = excluded.state,
        updated_at = excluded.updated_at
`);
const deleteGameSessionStmt = db.prepare('DELETE FROM game_sessions WHERE user_id = ? AND game_type = ?');
const getAllGameSessionsStmt = db.prepare('SELECT * FROM game_sessions WHERE game_type = ?');

function saveGameSession(userId, gameType, channelId, messageId, state) {
    saveGameSessionStmt.run({
        user_id: userId,
        game_type: gameType,
        channel_id: channelId,
        message_id: messageId,
        state: JSON.stringify(state),
        updated_at: Date.now()
    });
}

function deleteGameSession(userId, gameType) {
    deleteGameSessionStmt.run(userId, gameType);
}

function getAllGameSessions(gameType) {
    return getAllGameSessionsStmt.all(gameType).map(row => ({
        userId: row.user_id,
        channelId: row.channel_id,
        messageId: row.message_id,
        state: JSON.parse(row.state),
        updatedAt: row.updated_at
    }));
}

module.exports = {
    getCoins,
    setCoins,
    addCoins,
    getAura,
    addAura,
    setAura,
    getTokens,
    setTokens,
    addTokens,
    getItems,
    setItems,
    getLuck,
    setLuck,
    getStreak,
    setStreak,
    getAllCoinsMap,
    getAllItemsMap,
    getTopCoins,
    getTopAura,
    getTopTokens,
    getPartner,
    isMarried,
    setMarriage,
    clearMarriage,
    getSetup,
    getSetupValue,
    setSetupValue,
    importFromLegacyJson,
    importMarriages,
    importSetup,
    getCooldown,
    setCooldown,
    saveGameSession,
    deleteGameSession,
    getAllGameSessions,
    isGuildMemberCacheSeeded,
    upsertGuildMember,
    removeGuildMember,
    setGuildMembers,
    getGuildMembers,
    clearGuildMembers
};