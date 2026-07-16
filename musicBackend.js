'use strict';

const { LavalinkManager } = require('lavalink-client');
const { findWorkingNode } = require('./lavalinkAuto');

const SearchEngine = {
    YOUTUBE_SEARCH: 'ytsearch',
    AUTO: 'auto',
};

const SEARCH_TIMEOUT_MS = Number(process.env.LAVALINK_SEARCH_TIMEOUT_MS) || 10000;
const NODE_BLACKLIST_MS = Number(process.env.LAVALINK_NODE_BLACKLIST_MS) || 5 * 60 * 1000;

function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            const err = new Error(`${label} timed out after ${ms}ms`);
            err.code = 'LAVALINK_OP_TIMEOUT';
            reject(err);
        }, ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isTimeoutError(err) {
    return err?.code === 'LAVALINK_OP_TIMEOUT' || err?.name === 'TimeoutError' || err?.name === 'AbortError';
}

function formatDuration(ms) {
    if (!ms || !isFinite(ms) || ms <= 0) return '00:00';
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function getBotIdFromToken(token) {
    try {
        const first = String(token).split('.')[0];
        const padded = first.padEnd(first.length + ((4 - (first.length % 4)) % 4), '=');
        return Buffer.from(padded, 'base64').toString('utf8');
    } catch {
        return undefined;
    }
}

function wrapTrack(rawTrack) {
    if (!rawTrack) return null;
    if (!rawTrack.pluginInfo) rawTrack.pluginInfo = {};
    if (!rawTrack.pluginInfo.clientData) rawTrack.pluginInfo.clientData = {};
    const clientData = rawTrack.pluginInfo.clientData;
    const info = rawTrack.info || {};

    return {
        get title() { return info.title || 'Unknown title'; },
        get author() { return info.author || 'Unknown artist'; },
        get url() { return info.uri || info.identifier || ''; },
        get duration() { return info.isStream ? 'LIVE' : formatDuration(info.duration); },
        get thumbnail() { return clientData.thumbnail || info.artworkUrl || null; },
        set thumbnail(v) { clientData.thumbnail = v; },
        get requestedBy() { return rawTrack.requester || null; },
        get spotifyMeta() { return clientData.spotifyMeta || null; },
        set spotifyMeta(v) { clientData.spotifyMeta = v; },
                _lavalinkTrack: rawTrack,
    };
}

function unwrapTrack(track) {
    return track && track._lavalinkTrack ? track._lavalinkTrack : track;
}

class QueueAdapter {
    constructor(lavalinkPlayer, guild, metadataStore) {
        this._p = lavalinkPlayer;
        this.guild = guild;
        this._metadataStore = metadataStore;
    }

    get metadata() {
        return this._metadataStore.get(this._p.guildId) || {};
    }

    get currentTrack() {
        return wrapTrack(this._p.queue.current);
    }

    get repeatMode() {
        const map = { off: 0, track: 1, queue: 2 };
        return map[this._p.repeatMode] ?? 0;
    }

    setRepeatMode(mode) {
        const map = ['off', 'track', 'queue'];
        this._p.setRepeatMode(map[mode] || 'off');
    }

    get tracks() {
        const p = this._p;
        return {
            get size() { return p.queue.tracks.length; },
            toArray: () => p.queue.tracks.map(wrapTrack),
            clear: () => { p.queue.splice(0, p.queue.tracks.length); },
            shuffle: () => p.queue.shuffle(),
        };
    }

    get node() {
        const p = this._p;
        return {
            isPlaying: () => Boolean(p.playing) && !p.paused,
            isPaused: () => Boolean(p.paused),
            play: () => p.play(),
            pause: () => p.pause(),
            resume: () => p.resume(),
            skip: () => p.skip(),
                                                getTimestamp: () => {
                const current = p.queue?.current;
                if (!current) return null;
                const totalMs = current.info?.duration || 0;
                const currentMs = current.info?.isStream ? 0 : Math.max(0, Math.min(p.position || 0, totalMs || Infinity));
                return {
                    current: { value: currentMs, label: formatDuration(currentMs) },
                    total: { value: totalMs, label: current.info?.isStream ? 'LIVE' : formatDuration(totalMs) },
                };
            },
        };
    }

    addTrack(track) {
        this._p.queue.add(unwrapTrack(track));
    }

    delete() {
        this._metadataStore.delete(this._p.guildId);
        this._p.destroy().catch(() => {});
    }
}

function createMusicPlayer(client, {
    host = process.env.LAVALINK_HOST || undefined,
    port = process.env.LAVALINK_PORT ? Number(process.env.LAVALINK_PORT) : undefined,
    password = process.env.LAVALINK_SERVER_PASSWORD || process.env.LAVALINK_PASSWORD || undefined,
    secure = process.env.LAVALINK_SECURE === 'true',
    autoDiscoverPublicNode = process.env.LAVALINK_AUTO_DISCOVER !== 'false',
} = {}) {
    const clientId = getBotIdFromToken(process.env.DISCORD_TOKEN) || process.env.DISCORD_CLIENT_ID;

    const metadataStore = new Map();
    const badNodes = new Map();
    const playerSnapshots = new Map();
    let manager = null;
    let currentNodeKey = null;
    let reconnecting = false;

    function attachNodeManagerLogging(mgr) {
        mgr.nodeManager.on('error', (node, error) => {
            console.error(`[Music] Lavalink node "${node.id}" errored:`, error?.message || error);
        });
        mgr.nodeManager.on('disconnect', (node, reason) => {
            console.warn(`[Music] Lavalink node "${node.id}" disconnected:`, reason);
            handleNodeLost();
        });
        mgr.nodeManager.on('reconnecting', (node) => {
            console.warn(`[Music] Lavalink node "${node.id}" reconnecting...`);
        });
        mgr.nodeManager.on('connect', (node) => {
            console.log(`[Music] Lavalink node "${node.id}" connected.`);
        });
    }

    function anyNodeConnected() {
        try {
            return manager ? [...manager.nodeManager.nodes.values()].some((n) => n.connected) : false;
        } catch {
            return false;
        }
    }

    function getAllPlayers() {
        if (!manager) return [];
        try {
            if (manager.players && typeof manager.players.values === 'function') {
                return [...manager.players.values()];
            }
        } catch {
           
        }

        const players = [];
        for (const guildId of metadataStore.keys()) {
            const lp = manager.getPlayer(guildId);
            if (lp) players.push(lp);
        }
        return players;
    }

    function snapshotAllPlayers() {
        for (const lp of getAllPlayers()) {
            try {
                const current = lp.queue?.current || null;
                const queued = lp.queue?.tracks ? [...lp.queue.tracks] : [];
                if (!current && queued.length === 0) continue; 
                playerSnapshots.set(lp.guildId, {
                    voiceChannelId: lp.voiceChannelId,
                    textChannelId: metadataStore.get(lp.guildId)?.channel?.id,
                    volume: lp.volume,
                    repeatMode: lp.repeatMode,
                    paused: lp.paused,
                    position: lp.position,
                    currentTrack: current,
                    queueTracks: queued,
                });
            } catch (err) {
                console.error(`[Music] Could not snapshot player for guild ${lp.guildId}:`, err?.message || err);
            }
        }
    }
    async function restorePlayers() {
        if (playerSnapshots.size === 0) return;
        const snapshots = [...playerSnapshots.entries()];
        playerSnapshots.clear();

        for (const [guildId, snap] of snapshots) {
            try {
                if (!snap.voiceChannelId) continue;

                let lp = manager.getPlayer(guildId);
                if (!lp) {
                    lp = manager.createPlayer({
                        guildId,
                        voiceChannelId: snap.voiceChannelId,
                        textChannelId: snap.textChannelId,
                        selfDeaf: true,
                        volume: snap.volume ?? 100,
                    });
                }
                if (!lp.connected) await lp.connect();

                const tracksToRestore = [snap.currentTrack, ...snap.queueTracks].filter(Boolean);
                if (tracksToRestore.length === 0) continue;

                await lp.queue.add(tracksToRestore);
                await lp.play();

                if (snap.repeatMode) lp.setRepeatMode(snap.repeatMode);
                if (snap.position && !snap.currentTrack?.info?.isStream) {
                    setTimeout(() => lp.seek(snap.position).catch(() => {}), 1500);
                }
                if (snap.paused) {
                    setTimeout(() => lp.pause().catch(() => {}), 1600);
                }

                console.log(`[Music] Restored queue for guild ${guildId} after node swap (${tracksToRestore.length} track(s)).`);
            } catch (err) {
                console.error(`[Music] Failed to restore queue for guild ${guildId} after reconnect:`, err?.message || err);
            }
        }
    }
    async function performNodeSwitch(reason) {
        reconnecting = true;
        if (currentNodeKey) badNodes.set(currentNodeKey, Date.now() + NODE_BLACKLIST_MS);
        snapshotAllPlayers();
        console.warn(`[Music] ${reason} — searching for a more stable node...`);
        try {
            await connectToAnyNode();
            await restorePlayers();
        } catch (err) {
            console.error('[Music] Failed to recover a Lavalink connection:', err);
        } finally {
            reconnecting = false;
        }
    }

    async function handleNodeLost() {
        if (reconnecting || anyNodeConnected()) return;
        await performNodeSwitch('Lost the Lavalink connection');
    }
    async function forceSwitchNode(reason) {
        if (reconnecting) {
            while (reconnecting) {
                await new Promise((r) => setTimeout(r, 250));
            }
            return;
        }
        await performNodeSwitch(reason);
    }

    async function connectToAnyNode() {
        const preferredNode = (host && port && password && !badNodes.has(`${host}:${port}`))
            ? { host, port, password, secure }
            : null;

        const node = autoDiscoverPublicNode
            ? await findWorkingNode({
                preferredNode,
                exclude: badNodes,
                onAttempt: (n) => console.log(`[Music] Trying Lavalink node ${n.host}:${n.port}...`),
            })
            : preferredNode;

        if (!node) {
            throw new Error('[Music] No Lavalink node available. Set LAVALINK_* in .env or leave LAVALINK_AUTO_DISCOVER on.');
        }

        currentNodeKey = `${node.host}:${node.port}`;
        const nodeId = `node-${Date.now()}`;
        const nodeOptions = { id: nodeId, host: node.host, port: node.port, authorization: node.password, secure: node.secure };

        if (!manager) {
            manager = new LavalinkManager({
                nodes: [nodeOptions],
                sendToShard: (guildId, payload) => client.guilds.cache.get(guildId)?.shard?.send(payload),
                client: { id: clientId, username: 'Music' },
                autoSkip: true,
                playerOptions: {
                    defaultSearchPlatform: 'ytsearch',
                    onDisconnect: { autoReconnect: false, destroyPlayer: true },
                    onEmptyQueue: { destroyAfterMs: undefined },
                },
            });
            attachNodeManagerLogging(manager);
            await manager.init({ id: client.user.id, username: client.user.username });
        } else {
            try {
                const oldNodes = [...manager.nodeManager.nodes.values()];
                manager.nodeManager.createNode(nodeOptions).connect();
                for (const old of oldNodes) {
                    old?.destroy?.();
                }
            } catch (err) {
                console.error('[Music] Could not hot-swap the Lavalink node — a bot restart may be needed:', err);
                throw err;
            }
        }

        console.log(`[Music] Lavalink ready: ${node.host}:${node.port} (secure=${node.secure}).`);
    }

    async function getOrCreatePlayer(guildId, voiceChannelId, textChannelId) {
        if (!manager) throw new Error('[Music] Player not initialized yet — call player.init() first.');
        if (!anyNodeConnected() && !reconnecting) {
            console.warn('[Music] No connected node detected before creating a player — attempting to reconnect...');
            await handleNodeLost();
        }
        if (!anyNodeConnected()) {
            throw new Error('[Music] Still no Lavalink node available after a reconnect attempt. Try again in a few seconds.');
        }
        let lp = manager.getPlayer(guildId);

        // If this player is still attached to a node that no longer exists/connected
        // (e.g. it survived a node swap because it had no current track/queue to
        // snapshot), it's a stale reference — throw it away and recreate.
        if (lp && (!lp.node || !lp.node.connected)) {
            console.warn(`[Music] Player for guild ${guildId} was attached to a dead node — recreating it.`);
            try { await lp.destroy(); } catch {}
            try { manager.players?.delete?.(guildId); } catch {}
            lp = null;
        }

        if (!lp) {
            if (!voiceChannelId) {
                throw new Error(`[Music] No active player for guild ${guildId} and no voiceChannelId given to create one`);
            }
            lp = manager.createPlayer({
                guildId,
                voiceChannelId,
                textChannelId,
                selfDeaf: true,
                volume: 100,
            });
        }
        if (!lp.connected) await lp.connect();
        return lp;
    }

    const facade = {
                async init() {
            await connectToAnyNode();
        },
        sendRawData(data) {
            manager?.sendRawData(data);
        },

                nodes: {
            get(guildId) {
                if (!manager) return undefined;
                const lp = manager.getPlayer(guildId);
                if (!lp) return undefined;
                const guild = client.guilds.cache.get(guildId);
                return new QueueAdapter(lp, guild, metadataStore);
            },
        },

                                        async search(query, opts = {}) {
            const { requestedBy, searchEngine, guildId, voiceChannelId, textChannelId } = opts;
            if (!guildId) throw new Error('[Music] player.search() now requires opts.guildId');

            const lp = await getOrCreatePlayer(guildId, voiceChannelId, textChannelId);

            const isUrl = /^https?:\/\//.test(query);
            const searchQuery = !isUrl && searchEngine === SearchEngine.YOUTUBE_SEARCH
                ? { query, source: 'ytsearch' }
                : { query };

            let res;
            try {
                res = await withTimeout(lp.search(searchQuery, requestedBy), SEARCH_TIMEOUT_MS, 'Lavalink search');
            } catch (err) {
                if (!isTimeoutError(err)) throw err;
                console.warn(`[Music] Search timed out on node "${currentNodeKey}" — switching to a more stable node and retrying once...`);
                await forceSwitchNode(`Search timed out on node "${currentNodeKey}"`);
                const retryLp = await getOrCreatePlayer(guildId, voiceChannelId, textChannelId);
                res = await withTimeout(retryLp.search(searchQuery, requestedBy), SEARCH_TIMEOUT_MS, 'Lavalink search (retry)');
            }

            if (!res?.tracks?.length) return { tracks: [] };
            return {
                tracks: res.tracks.map(wrapTrack),
                playlist: res.playlist || null,
            };
        },

                async play(voiceChannel, searchResultOrTrack, { nodeOptions } = {}) {
            const guildId = voiceChannel.guild.id;
            const textChannel = nodeOptions?.metadata?.channel;
            const lp = await getOrCreatePlayer(guildId, voiceChannel.id, textChannel?.id);
            metadataStore.set(guildId, { channel: textChannel || null });

            const rawTracks = searchResultOrTrack?.tracks?.length
                ? searchResultOrTrack.tracks.map(unwrapTrack)
                : [unwrapTrack(searchResultOrTrack)];

            try {
                await withTimeout(lp.queue.add(rawTracks), SEARCH_TIMEOUT_MS, 'Lavalink queue.add');
                if (!lp.playing) await withTimeout(lp.play(), SEARCH_TIMEOUT_MS, 'Lavalink play');
            } catch (err) {
                if (!isTimeoutError(err)) throw err;
                console.warn(`[Music] Play timed out on node "${currentNodeKey}" — switching to a more stable node and retrying once...`);
                await forceSwitchNode(`Play timed out on node "${currentNodeKey}"`);
                const retryLp = await getOrCreatePlayer(guildId, voiceChannel.id, textChannel?.id);
                await withTimeout(retryLp.queue.add(rawTracks), SEARCH_TIMEOUT_MS, 'Lavalink queue.add (retry)');
                if (!retryLp.playing) await withTimeout(retryLp.play(), SEARCH_TIMEOUT_MS, 'Lavalink play (retry)');
                return new QueueAdapter(retryLp, voiceChannel.guild, metadataStore);
            }

            return new QueueAdapter(lp, voiceChannel.guild, metadataStore);
        },

                events: {
            on(eventName, handler) {
                const guild = (guildId) => client.guilds.cache.get(guildId);
                const q = (lp) => new QueueAdapter(lp, guild(lp.guildId), metadataStore);
                const bind = (attach) => {
                    if (manager) { attach(manager); return; }
                    const wait = setInterval(() => {
                        if (manager) { clearInterval(wait); attach(manager); }
                    }, 200);
                };

                switch (eventName) {
                    case 'playerStart':
                        bind((mgr) => mgr.on('trackStart', (lp, track) => handler(q(lp), wrapTrack(track))));
                        break;
                    case 'playerFinish':
                        bind((mgr) => mgr.on('trackEnd', (lp) => handler(q(lp))));
                        break;
                    case 'emptyQueue':
                        bind((mgr) => mgr.on('queueEnd', (lp) => handler(q(lp))));
                        break;
                    case 'playerError':
                        bind((mgr) => mgr.on('trackError', (lp, track, payload) => {
                            const err = new Error(payload?.exception?.message || 'Unknown playback error');
                            handler(q(lp), err, wrapTrack(track));
                        }));
                        break;
                    case 'disconnect':
                        bind((mgr) => mgr.on('playerDisconnect', (lp) => handler(q(lp))));
                        break;
                    default:
                        console.warn(`[Music] musicBackend: no mapping for event "${eventName}" — ignored`);
                }
            },
        },

                        get _manager() { return manager; },
    };

    return facade;
}

module.exports = { createMusicPlayer, SearchEngine };
