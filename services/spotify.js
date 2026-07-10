'use strict';
const searchCache = require('../db/search-cache');

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
let spotifyCCToken = null, spotifyCCExpiry = 0;

async function getSpotifyToken() {
    if (spotifyCCToken && Date.now() < spotifyCCExpiry) return spotifyCCToken;
    const creds = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
    const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${creds}` },
        body: 'grant_type=client_credentials'
    });
    const json = await res.json();
    if (!json.access_token) throw new Error('Failed to obtain Spotify token');
    spotifyCCToken = json.access_token;
    spotifyCCExpiry = Date.now() + (json.expires_in - 60) * 1000;
    return spotifyCCToken;
}

async function spotifyApiSearch(query, type, limit = 1) {
    const cached = searchCache.getSpotifySearch(query, type, limit);
    if (cached) return cached;

    const token = await getSpotifyToken();
    const res = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=${type}&limit=${limit}&market=PH`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`Spotify search failed (${res.status})`);
    const json = await res.json();
    searchCache.setSpotifySearch(query, type, limit, json);
    return json;
}

function spotifyTrackImage(track) {
    return track?.album?.images?.[0]?.url || null;
}

function spotifyTrackArtists(track) {
    return (track?.artists || []).map(a => a.name).join(' ');
}

module.exports = { getSpotifyToken, spotifyApiSearch, spotifyTrackImage, spotifyTrackArtists };
