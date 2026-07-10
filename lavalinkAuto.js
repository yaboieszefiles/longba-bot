'use strict';
const REMOTE_NODE_LIST_URLS = [
    'https://lavalink-list.ajieblogs.eu.org/all',
    'https://lavalink-list-api.pages.dev/nodes.json',
];

const FALLBACK_NODES = [
    { host: 'lavalink.jirayu.net', port: 13592, password: 'youshallnotpass', secure: false },
    { host: 'lavalinkv4.serenetia.com', port: 80, password: 'https://seretia.link/discord', secure: false },
    { host: 'lava.g3v.co.uk', port: 9008, password: 'lavalinkjol', secure: false },
    { host: 'lavalink.triniumhost.com', port: 4333, password: 'free', secure: false },
    { host: 'lavalink.triniumhost.com', port: 2333, password: 'kirito', secure: false },
    { host: 'lavalink.triniumhost.com', port: 9008, password: 'free', secure: false },
    { host: 'lavalink.triniumhost.com', port: 6000, password: 'trinium', secure: false },
    { host: 'n3.nexcloud.in', port: 2026, password: 'nexcloud', secure: false },
    { host: 'omega.vexanode.cloud', port: 2031, password: 'https://discord.vexanode.cloud', secure: false },
    { host: 'lava2.kasawa.pro', port: 2334, password: 'youshallnotpass', secure: false },
    { host: 'lavav4.minecuta.com', port: 2333, password: 'discord.gg/gKuXdRs', secure: false },
    { host: '157-254-192-15', port: 2333, password: 'youshallnotpass', secure: false },
    { host: 'lavalinkv4.serenetia.com', port: 443, password: 'https://seretia.link/discord', secure: true },
    { host: 'lavalink.jirayu.net', port: 443, password: 'youshallnotpass', secure: true },
    { host: 'lava-v4.millohost.my.id', port: 443, password: 'https://discord.gg/mj55J2K3ep', secure: true },
    { host: 'lavalink-v4.triniumhost.com', port: 443, password: 'free', secure: true },
    { host: 'nodelink.triniumhost.com', port: 443, password: 'free', secure: true },
    { host: 'nodelink-02.triniumhost.com', port: 443, password: 'trinium', secure: true },
    { host: 'lavalinkv4.serenetia.com', port: 443, password: 'https://dsc.gg/ajidevserver', secure: true },
    { host: 'lavalinkv4.serenetia.com', port: 80, password: 'https://dsc.gg/ajidevserver', secure: false },
    { host: 'lavalinkv3.serenetia.com', port: 443, password: 'https://dsc.gg/ajidevserver', secure: true },
    { host: 'lavalinkv3.serenetia.com', port: 80, password: 'https://dsc.gg/ajidevserver', secure: false },
    { host: 'lavalink.serenetia.com', port: 443, password: 'https://dsc.gg/ajidevserver', secure: true },
    { host: 'lavalink.serenetia.com', port: 80, password: 'https://dsc.gg/ajidevserver', secure: false },
];

function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

async function fetchRemoteNodes() {
    const collected = [];
    for (const url of REMOTE_NODE_LIST_URLS) {
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
            if (!res.ok) continue;
            const data = await res.json();
            if (Array.isArray(data)) {
                for (const n of data) {
                    if (n?.host && n?.port) {
                        collected.push({
                            host: n.host,
                            port: Number(n.port),
                            password: n.password || 'youshallnotpass',
                            secure: Boolean(n.secure),
                        });
                    }
                }
            }
        } catch {
        }
    }
    return collected;
}

async function getCandidateNodes() {
    const remote = await fetchRemoteNodes();
    const combined = [...remote, ...FALLBACK_NODES];

    const seen = new Set();
    const unique = [];
    for (const n of combined) {
        const key = `${n.host}:${n.port}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(n);
    }
    return shuffle(unique);
}

async function isNodeReachable(node, timeoutMs = 5000) {
    try {
        const scheme = node.secure ? 'https' : 'http';
        const res = await fetch(`${scheme}://${node.host}:${node.port}/version`, {
            signal: AbortSignal.timeout(timeoutMs),
            headers: { Authorization: node.password },
        });
        return res.ok;
    } catch {
        return false;
    }
}

function pruneExpiredExcludes(exclude) {
    if (!(exclude instanceof Map)) return;
    const now = Date.now();
    for (const [key, expiresAt] of exclude) {
        if (typeof expiresAt === 'number' && expiresAt <= now) {
            exclude.delete(key);
        }
    }
}

async function raceToFirstReachable(candidates, exclude, onAttempt) {
    pruneExpiredExcludes(exclude);
    const toTry = candidates.filter((n) => !exclude.has(`${n.host}:${n.port}`));
    if (toTry.length === 0) return null;

    const attempts = toTry.map(async (node) => {
        onAttempt?.(node);
        const ok = await isNodeReachable(node);
        if (!ok) throw new Error(`${node.host}:${node.port} unreachable`);
        return node;
    });

    try {
        return await Promise.any(attempts);
    } catch {
        return null;
    }
}

async function findWorkingNode({ preferredNode, onAttempt, exclude = new Set() } = {}) {
    let round = 0;
    while (true) {
        round++;
        const candidates = [];
        if (preferredNode && round === 1) candidates.push(preferredNode);
        candidates.push(...(await getCandidateNodes()));

        const found = await raceToFirstReachable(candidates, exclude, onAttempt);
        if (found) return found;

        const waitMs = Math.min(30000, 3000 * round);
        console.warn(`[Music] No working Lavalink node found (round ${round}). Retrying in ${Math.round(waitMs / 1000)}s...`);
        await new Promise((r) => setTimeout(r, waitMs));
    }
}

module.exports = { findWorkingNode, getCandidateNodes, isNodeReachable };