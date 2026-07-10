'use strict';

require('./lib/bootstrap');

const { getTracks, getData } = require('spotify-url-info')(globalThis.fetch);
require('dotenv').config();

const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const { createMusicPlayer, SearchEngine } = require('./musicBackend');
const store = require('./db/store');
const searchCache = require('./db/search-cache');

const { WATCHADS_GIFTS, pendingKeys, getLinkvertiseLink } = require('./services/linkvertise');
const { spotifyApiSearch, spotifyTrackImage, spotifyTrackArtists } = require('./services/spotify');
const { activeBJGames, bjBuildContainer, bjDealerPlay, bjResolve, bjCalcHand, bjCreateDeck, bjSerialize, bjDeserialize } = require('./games/blackjack');
const { activeMinesGames, minesBuildContainer, minesMultiplier, MINES_GRID_SIZE, minesGenerateMines, minesSerialize, minesDeserialize } = require('./games/mines');
const { startBaccaratRound } = require('./games/baccarat');
const { initMemberCache } = require('./cache/members');
const { setPlayer } = require('./music/state');
const music = require('./music');
const { formatCooldown, getRoleForAura } = require('./utils/format');
const { coinEmojis, colors, emojiIap } = require('./lib/constants');
const { buildCommands } = require('./commands/definitions');
const { registerCommands } = require('./commands/register');
const { registerInteractionHandlers, resumeGameSessions } = require('./handlers/interactions');
const { startVcCoinJob } = require('./jobs/vcCoins');
const { startAgimatChecker } = require('./jobs/agimatChecker');
const { registerGuildEvents } = require('./events/guild');
const { registerVoiceEvents } = require('./events/voice');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || '';
const cmdCooldowns = new Map();
const activeCockfight = {};
const pendingMarriages = {};

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
    ],
});

const player = createMusicPlayer(client);
setPlayer(player);
music.registerPlayerEvents(player, client);

client.on('raw', (data) => player.sendRawData(data));

const {
    memberCache,
    seedGuildMemberCache,
    getCachedMembers,
    seedAllUncachedGuilds,
} = initMemberCache(client);

startVcCoinJob(client);
startAgimatChecker(client);

registerGuildEvents(client, { memberCache, seedGuildMemberCache });
registerVoiceEvents(client, {
    getQueue: music.getQueue,
    disableNowPlayingControls: music.disableNowPlayingControls,
});

const commands = buildCommands();
module.exports = { commands };
registerCommands(commands, DISCORD_TOKEN);

process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
});

const interactionDeps = {
    client,
    store,
    searchCache,
    player,
    SearchEngine,
    getLinkvertiseLink,
    pendingKeys,
    WATCHADS_GIFTS,
    getQueue: music.getQueue,
    disableNowPlayingControls: music.disableNowPlayingControls,
    handleNowPlayingButton: music.handleNowPlayingButton,
    buildNowPlayingPayload: music.buildNowPlayingPayload,
    publishNowPlaying: music.publishNowPlaying,
    enqueueMusic: music.enqueueMusic,
    isOverOneHour: music.isOverOneHour,
    spotifyApiSearch,
    spotifyTrackImage,
    spotifyTrackArtists,
    getTracks,
    getData,
    activeBJGames,
    bjBuildContainer,
    bjDealerPlay,
    bjResolve,
    bjCalcHand,
    bjCreateDeck,
    bjSerialize,
    bjDeserialize,
    activeMinesGames,
    minesBuildContainer,
    minesMultiplier,
    MINES_GRID_SIZE,
    minesGenerateMines,
    minesSerialize,
    minesDeserialize,
    startBaccaratRound,
    activeCockfight,
    pendingMarriages,
    formatCooldown,
    getRoleForAura,
    colors,
    coinEmojis,
    emojiIap,
    getCachedMembers,
    canControlMusic: music.canControlMusic,
    cmdCooldowns,
    spotifyMetaByUrl: require('./music/state').spotifyMetaByUrl,
    setSpotifyMetaByUrl: require('./music/state').setSpotifyMetaByUrl,
};

registerInteractionHandlers(interactionDeps);

client.once('clientReady', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    client.user.setStatus('online');
    await player.init().catch((err) => {
        console.error('[Music] Failed to connect to Lavalink node — check LAVALINK_HOST/PORT/PASSWORD and that the Docker container is running:', err);
    });
    await resumeGameSessions(interactionDeps).catch((err) => {
        console.error('[Games] Failed to resume saved Blackjack/Mines sessions:', err);
    });
    await seedAllUncachedGuilds();
    const updateStatus = () => {
        const serverCount = client.guilds.cache.size;
        client.user.setActivity(`with ${serverCount} servers`, {
            type: ActivityType.Streaming,
            url: 'https://twitch.tv/roesalie'
        });
    };
    updateStatus();
    setInterval(updateStatus, 5 * 60 * 1000);
});

client.login(DISCORD_TOKEN);