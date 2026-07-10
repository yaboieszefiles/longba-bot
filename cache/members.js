'use strict';
const store = require('../db/store');

function initMemberCache(client) {
    const memberCache = new Map();
    function buildMemberMapFromRows(rows) {
        const map = new Map();
        for (const row of rows) {
            map.set(row.user_id, { user: { username: row.username, globalName: row.global_name } });
        }
        return map;
    }

    async function seedGuildMemberCache(guild) {
        const members = await guild.members.fetch();
        store.setGuildMembers(guild.id, [...members.values()].map(m => ({
            userId: m.id,
            username: m.user.username,
            globalName: m.user.globalName
        })));
        const map = buildMemberMapFromRows(store.getGuildMembers(guild.id));
        memberCache.set(guild.id, map);
        console.log(`[Cache] Seeded ${map.size} members for ${guild.name} (one-time fetch, now persisted)`);
        return map;
    }

    async function getCachedMembers(guild) {
        const cached = memberCache.get(guild.id);
        if (cached) return cached;

        if (store.isGuildMemberCacheSeeded(guild.id)) {
            const map = buildMemberMapFromRows(store.getGuildMembers(guild.id));
            memberCache.set(guild.id, map);
            return map;
        }

                        return seedGuildMemberCache(guild);
    }

            async function seedAllUncachedGuilds() {
        for (const guild of client.guilds.cache.values()) {
            if (store.isGuildMemberCacheSeeded(guild.id)) continue;
            try {
                await seedGuildMemberCache(guild);
            } catch (err) {
                console.error(`[Cache] Initial seed failed for ${guild.name}:`, err.message);
            }
        }
    }

    return {
        memberCache,
        buildMemberMapFromRows,
        seedGuildMemberCache,
        getCachedMembers,
        seedAllUncachedGuilds,
    };
}

module.exports = { initMemberCache };
