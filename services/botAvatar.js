'use strict';
const fs = require('fs');
const path = require('path');
const { spotifyApiSearch } = require('./spotify');

const MIN_INTERVAL_MS = 12 * 60 * 1000;

const DEFAULT_AVATAR_URL = 'https://cdn.discordapp.com/attachments/1491135613544431698/1534710885459820685/wa.png';
const DEFAULT_AVATAR_PATH = path.join(__dirname, '..', 'assets', 'default-pfp.png');

const DEFAULT_SENTINEL = '__DEFAULT__';

const artistImageCache = new Map();

let lastChangeAt = 0;  
let pendingArtist = null; 
let flushTimer = null;
let inFlight = false;

function primaryArtistOf(artistString) {
    if (!artistString) return null;
    return artistString
        .split(/,|&|\/| feat\.?| ft\.?| x | - Topic/i)[0]
        .trim() || null;
}

async function getArtistImageUrl(artistName) {
    const key = artistName.toLowerCase();
    if (artistImageCache.has(key)) return artistImageCache.get(key);

    try {
        const result = await spotifyApiSearch(artistName, 'artist', 1);
        const url = result?.artists?.items?.[0]?.images?.[0]?.url || null;
        artistImageCache.set(key, url);
        return url;
    } catch (err) {
        console.error('[BotAvatar] Spotify artist lookup failed:', err.message || err);
        return null;
    }
}

async function fetchBuffer(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Image fetch failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
}

async function getDefaultAvatarBuffer() {
    if (fs.existsSync(DEFAULT_AVATAR_PATH)) {
        return fs.readFileSync(DEFAULT_AVATAR_PATH);
    }
    const buffer = await fetchBuffer(DEFAULT_AVATAR_URL);
    fs.mkdirSync(path.dirname(DEFAULT_AVATAR_PATH), { recursive: true });
    fs.writeFileSync(DEFAULT_AVATAR_PATH, buffer);
    return buffer;
}

async function applyAvatar(client, target) {
    inFlight = true;
    try {
        const isDefault = target === DEFAULT_SENTINEL;
        const buffer = isDefault
            ? await getDefaultAvatarBuffer()
            : await (async () => {
                const imageUrl = await getArtistImageUrl(target);
                return imageUrl ? fetchBuffer(imageUrl) : null;
            })();

        if (!buffer) return;

        await client.user.setAvatar(buffer);
        lastChangeAt = Date.now();
        console.log(isDefault
            ? '[BotAvatar] Avatar reverted to default pfp'
            : `[BotAvatar] Avatar switched to artist: ${target}`);
    } catch (err) {
        const status = err.status || err.code;
        if (status === 429) {
            const retryAfterMs = (err.retry_after || err.retryAfter || 60) * 1000;
            console.warn(`[BotAvatar] Rate limited by Discord, backing off ${retryAfterMs}ms`);
            lastChangeAt = Date.now() + retryAfterMs - MIN_INTERVAL_MS;
        } else {
            console.error('[BotAvatar] Failed to set avatar:', err.message || err);
        }
    } finally {
        inFlight = false;
    }
}

function scheduleFlush(client) {
    if (flushTimer) return;
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastChangeAt));
    flushTimer = setTimeout(async () => {
        flushTimer = null;
        if (pendingArtist) {
            const artist = pendingArtist;
            pendingArtist = null;
            await applyAvatar(client, artist);
        }
    }, wait);
}

function requestAvatarUpdate(client, rawArtistString) {
    const artist = primaryArtistOf(rawArtistString);
    if (!artist || !client?.user) return;
    queueChange(client, artist);
}


function requestAvatarReset(client) {
    if (!client?.user) return;
    queueChange(client, DEFAULT_SENTINEL);
}

function queueChange(client, target) {
    const elapsed = Date.now() - lastChangeAt;
    if (elapsed >= MIN_INTERVAL_MS && !inFlight) {
        applyAvatar(client, target);
    } else {
        pendingArtist = target;
        scheduleFlush(client);
    }
}

module.exports = { requestAvatarUpdate, requestAvatarReset };
