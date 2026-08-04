'use strict';
const { spotifyApiSearch } = require('./spotify');

const MIN_INTERVAL_MS = 12 * 60 * 1000;

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

async function applyAvatar(client, artistName) {
    inFlight = true;
    try {
        const imageUrl = await getArtistImageUrl(artistName);
        if (!imageUrl) return;

        const res = await fetch(imageUrl);
        if (!res.ok) throw new Error(`Image fetch failed (${res.status})`);
        const buffer = Buffer.from(await res.arrayBuffer());

        await client.user.setAvatar(buffer);
        lastChangeAt = Date.now();
        console.log(`[BotAvatar] Avatar switched to artist: ${artistName}`);
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

    const elapsed = Date.now() - lastChangeAt;
    if (elapsed >= MIN_INTERVAL_MS && !inFlight) {
        applyAvatar(client, artist);
    } else {
        pendingArtist = artist;
        scheduleFlush(client);
    }
}

module.exports = { requestAvatarUpdate };
