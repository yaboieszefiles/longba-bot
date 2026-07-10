'use strict';

process.env.UV_THREADPOOL_SIZE = '2';

const SPOTIFY_META_MAX = 500;
const AUTOPLAY_HISTORY_MAX = 200;

const musicNowPlayingIntervals = new Map();
const musicNowPlayingMessages = new Map();
const musicLyricsCache = new Map(); const spotifyMetaByUrl = new Map();
const musicLastTrack = new Map();       const musicAutoplayHistory = new Map(); const musicAutoplayLock = new Set();    let player = null;

function setPlayer(p) { player = p; }
function getPlayer() { return player; }

function setSpotifyMetaByUrl(url, meta) {
    if (!url) return;
    if (spotifyMetaByUrl.has(url)) spotifyMetaByUrl.delete(url);
    spotifyMetaByUrl.set(url, meta);
    while (spotifyMetaByUrl.size > SPOTIFY_META_MAX) {
        const oldest = spotifyMetaByUrl.keys().next().value;
        spotifyMetaByUrl.delete(oldest);
    }
}

function addAutoplayHistory(guildId, trackId) {
    if (!trackId) return;
    let history = musicAutoplayHistory.get(guildId);
    if (!history) {
        history = new Set();
        musicAutoplayHistory.set(guildId, history);
    }
    history.add(trackId);
    while (history.size > AUTOPLAY_HISTORY_MAX) {
        const oldest = history.values().next().value;
        history.delete(oldest);
    }
}

function clearGuildMusicState(guildId) {
    const interval = musicNowPlayingIntervals.get(guildId);
    if (interval) {
        clearInterval(interval);
        musicNowPlayingIntervals.delete(guildId);
    }
    musicNowPlayingMessages.delete(guildId);
    musicLyricsCache.delete(guildId);
    musicLastTrack.delete(guildId);
    musicAutoplayHistory.delete(guildId);
    musicAutoplayLock.delete(guildId);
}

module.exports = {
    musicNowPlayingIntervals,
    musicNowPlayingMessages,
    musicLyricsCache,
    spotifyMetaByUrl,
    musicLastTrack,
    musicAutoplayHistory,
    musicAutoplayLock,
    setPlayer,
    getPlayer,
    setSpotifyMetaByUrl,
    addAutoplayHistory,
    clearGuildMusicState,
};
