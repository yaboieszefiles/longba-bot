'use strict';
const { musicLyricsCache } = require('./state');

function parseLRC(lrc) {
    const lines = [];
    const regex = /\[(\d{2}):(\d{2})\.(\d{1,3})\](.*)/g;
    let match;
    while ((match = regex.exec(lrc)) !== null) {
        const t = parseInt(match[1], 10) * 60 + parseInt(match[2], 10) + parseInt(match[3].padEnd(3, '0'), 10) / 1000;
        const text = match[4].trim();
        if (text) lines.push({ time: t, text });
    }
    return lines.sort((a, b) => a.time - b.time);
}

async function fetchSyncedLyrics(name, artist) {
    try {
        const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(`${name} ${artist || ''}`)}`, {
            headers: { 'User-Agent': 'LongbaBot/1.0' },
            signal: AbortSignal.timeout(8000)
        });
        if (!res.ok) return null;
        const results = await res.json();
        const best = results.find(r => r.trackName?.toLowerCase().includes((name || '').toLowerCase().substring(0, 10))) || results[0];
        if (!best?.syncedLyrics) return null;
        const lines = parseLRC(best.syncedLyrics);
        if (!lines.length) return null;
        return { synced: true, lines };
    } catch {
        return null;
    }
}

function buildLyricsSection(guildId, elapsedSec) {
    const cache = musicLyricsCache.get(guildId);
    const lines = cache?.lyrics?.lines;
    if (!lines?.length) return null;

    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].time <= elapsedSec) idx = i;
        else break;
    }

    const rows = [];
    if (idx > 0) rows.push(`-# ${lines[idx - 1].text}`);
    rows.push(idx >= 0 ? `**${lines[idx].text}**` : '-# ♪ ♪ ♪');
    if (idx >= 0 && idx + 1 < lines.length) rows.push(`-# ${lines[idx + 1].text}`);
    return rows.join('\n');
}

module.exports = { parseLRC, fetchSyncedLyrics, buildLyricsSection };
