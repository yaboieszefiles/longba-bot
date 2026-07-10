'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const lines = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8').split(/\r?\n/);

function slice(start, end) {
    return lines.slice(start - 1, end).join('\n');
}

function write(rel, content) {
    const full = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    console.log('Wrote', rel);
}

// Backup original
fs.copyFileSync(path.join(ROOT, 'index.js'), path.join(ROOT, 'index.js.bak'));

write('lib/bootstrap.js', slice(1, 18) + '\n');

write('services/spotify.js', `'use strict';
const searchCache = require('../db/search-cache');

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
let spotifyCCToken = null, spotifyCCExpiry = 0;

${slice(36, 71)}

module.exports = { getSpotifyToken, spotifyApiSearch, spotifyTrackImage, spotifyTrackArtists };
`);

write('games/blackjack.js', `'use strict';
const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const store = require('../db/store');

${slice(75, 179)}

module.exports = {
    CARD_EMOJIS,
    activeBJGames,
    bjCreateDeck,
    bjCardValue,
    bjCalcHand,
    bjCardEmoji,
    bjRenderHand,
    bjBuildContainer,
    bjDealerPlay,
    bjResolve,
};
`);

write('games/mines.js', `'use strict';
const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

${slice(183, 300)}

module.exports = {
    activeMinesGames,
    MINES_GRID_SIZE,
    MINES_HOUSE_EDGE,
    minesMultiplier,
    minesFormatShort,
    minesGenerateMines,
    minesBuildContainer,
};
`);

write('services/linkvertise.js', `'use strict';

const WATCHADS_GIFTS = 3;
const pendingKeys = new Map();

${slice(305, 327)}

module.exports = { WATCHADS_GIFTS, pendingKeys, getLinkvertiseLink };
`);

write('utils/format.js', `'use strict';

${slice(1634, 1671)}

module.exports = { formatCooldown, getRoleForAura };
`);

write('lib/constants.js', `'use strict';

const coinEmojis = {
    heads: '<:head:1491122639719239722>',
    tails: '<:tails:1491122700213813509>'
};
const colors = [
    { name: 'Red', emoji: '<:red:1491112099915501608>' },
    { name: 'Orange', emoji: '<:orange:1491112058563854417>' },
    { name: 'Yellow', emoji: '<:yellow:1491112087743758417>' },
    { name: 'Green', emoji: '<:green:1491112046283194663>' },
    { name: 'Blue', emoji: '<:blue:1491112033779843174>' },
    { name: 'Purple', emoji: '<:purple:1491112144110882836>' },
];

const emojiIap = {
    'anting2': '<:anting2:1491119853854261308>',
    'agimat': '<:agimat:1491119820358553600>',
    'Chicken': '<a:chicken:1491117598417490032>',
    'ak': '<:ak47:1491119777635106887>',
    'Bag': '<:bag:1491120194670821426>',
    'mask': '<:mask:1491119765027029124>',
    'Coke': '<:cocaine:1491119792910897272>',
    'Weed': '<:jointtttt:1514466300485832894>',
    'Marlboro': '<:cigg:1514467639400071328>',
    'Hamster' : '<a:hmster:1506538001088643153>',
    'Cat' : '<a:cat:1496798083823046696>',
    'Dog' : '<a:dog:1496797720432742421>'
};

module.exports = { coinEmojis, colors, emojiIap };
`);

// Member cache — functions close over the Discord client passed at init time
write('cache/members.js', `'use strict';
const store = require('../db/store');

function initMemberCache(client) {
    const memberCache = new Map(); // guildId -> Map(userId -> { user: { username, globalName } })

${slice(406, 453).split('\n').map(l => '    ' + l).join('\n')}

    return {
        memberCache,
        buildMemberMapFromRows,
        seedGuildMemberCache,
        getCachedMembers,
        seedAllUncachedGuilds,
    };
}

module.exports = { initMemberCache };
`);

// Music state (329-342)
write('music/state.js', `'use strict';

process.env.UV_THREADPOOL_SIZE = '2';

${slice(331, 342).replace('let player;', 'let player = null;')}

function setPlayer(p) { player = p; }
function getPlayer() { return player; }

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
};
`);

// Music lyrics (347-395)
write('music/lyrics.js', `'use strict';
const { musicLyricsCache } = require('./state');

${slice(347, 395)}

module.exports = { parseLRC, fetchSyncedLyrics, buildLyricsSection };
`);

// Music core (455-1027)
const musicBody = slice(455, 1027)
    .replace(/(?<![.\w])player(?=\.)/g, 'getPlayer().')
    .replace(/function registerPlayerEvents\(\) \{/, 'function registerPlayerEvents(player, client) {\n    _client = client;')
    .replace(/getPlayer\(\)\.events\.on/g, 'player.events.on')
    .replace(/requestedBy: client\.user/g, 'requestedBy: _client.user');

write('music/index.js', `'use strict';
const {
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SectionBuilder,
    ThumbnailBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, MessageFlags,
} = require('discord.js');
const { SearchEngine } = require('../musicBackend');
const searchCache = require('../db/search-cache');
const { spotifyApiSearch, spotifyTrackImage, spotifyTrackArtists } = require('../services/spotify');
const {
    musicNowPlayingIntervals, musicNowPlayingMessages, musicLyricsCache,
    spotifyMetaByUrl, musicLastTrack, musicAutoplayHistory, musicAutoplayLock,
    getPlayer,
} = require('./state');
const { fetchSyncedLyrics, buildLyricsSection } = require('./lyrics');

let _client = null;

${musicBody}

module.exports = {
    getMusicNodeOptions,
    isOverOneHour,
    enqueueMusic,
    clearMusicNowPlayingInterval,
    clearMusicNowPlayingMessage,
    disableContainerControls,
    disableNowPlayingControls,
    getQueue,
    canControlMusic,
    findRelatedSpotifyTracks,
    maybeAutoplay,
    parseTimeLabelToSeconds,
    getNowPlayingThumbnail,
    buildNowPlayingPayload,
    publishNowPlaying,
    isInteractionExpiredError,
    ackComponentInteraction,
    respondToComponent,
    handleNowPlayingButton,
    registerPlayerEvents,
};
`);

// Baccarat (1673-1860) + GIF constants (1862-1872)
write('games/baccarat.js', `'use strict';
const {
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, MediaGalleryBuilder, MediaGalleryItemBuilder,
    ComponentType, MessageFlags,
} = require('discord.js');
const store = require('../db/store');

${slice(1862, 1872)}

${slice(1673, 1860)}

module.exports = { startBaccaratRound, WAITING_GIF, bankerGifs, playerGifs };
`);

// Commands (1388-1607)
write('commands/definitions.js', `'use strict';
const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../lib/constants');

function buildCommands() {
    return [
${slice(1389, 1606)}
    ];
}

module.exports = { buildCommands };
`);

// Command registration (1610-1630)
write('commands/register.js', `'use strict';
const { REST, Routes } = require('discord.js');

function registerCommands(commands, token) {
    const rest = new REST({ version: '10' }).setToken(token);
    (async () => {
        try {
            console.log('Started refreshing application (/) commands.');
            await rest.put(
                Routes.applicationCommands('1491110943873044640'),
                { body: commands }
            );
            console.log('Successfully reloaded application (/) commands.');
        } catch (error) {
            console.error('Error reloading commands:', error);
        }
    })();
}

module.exports = { registerCommands };
`);

// Interaction handler (1875-5522)
write('handlers/interactions.js', `'use strict';

function registerInteractionHandlers(deps) {
    const {
        client, store, searchCache, player, SearchEngine,
        getLinkvertiseLink, pendingKeys, WATCHADS_GIFTS,
        getQueue, disableNowPlayingControls, handleNowPlayingButton,
        buildNowPlayingPayload, publishNowPlaying, enqueueMusic, isOverOneHour,
        spotifyApiSearch, spotifyTrackImage, spotifyTrackArtists,
        getTracks, getData,
        activeBJGames, bjBuildContainer, bjDealerPlay, bjResolve, bjCalcHand,
        activeMinesGames, minesBuildContainer, minesMultiplier, MINES_GRID_SIZE,
        startBaccaratRound,
        activeCockfight,
        pendingMarriages,
        formatCooldown, getRoleForAura,
        colors, coinEmojis, emojiIap,
        getCachedMembers,
        canControlMusic,
        cmdCooldowns,
        spotifyMetaByUrl,
    } = deps;

${slice(1876, 5522)}
}

module.exports = { registerInteractionHandlers };
`);

// VC coins job (1086-1232)
write('jobs/vcCoins.js', `'use strict';
const {
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SectionBuilder,
    ThumbnailBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ComponentType, MessageFlags,
} = require('discord.js');
const store = require('../db/store');

function startVcCoinJob(client) {
    let activeUsersInVC = new Set();

${slice(1086, 1232)}

    return activeUsersInVC;
}

module.exports = { startVcCoinJob };
`);

// Agimat checker (1234-1270)
write('jobs/agimatChecker.js', `'use strict';

function startAgimatChecker(client) {
    const notifiedExpiredAgimat = {};

${slice(1234, 1270)}
}

module.exports = { startAgimatChecker };
`);

// Guild events (1272-1347)
write('events/guild.js', `'use strict';
const {
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SectionBuilder,
    ThumbnailBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const store = require('../db/store');

function registerGuildEvents(client, { memberCache, seedGuildMemberCache }) {
${slice(1272, 1347).replace(/^client\./gm, '    client.')}
}

module.exports = { registerGuildEvents };
`);

// Voice events (1349-1373)
write('events/voice.js', `'use strict';

function registerVoiceEvents(client, { getQueue, disableNowPlayingControls }) {
${slice(1349, 1373).replace(/^client\./gm, '    client.')}
}

module.exports = { registerVoiceEvents };
`);

// New thin index.js
write('index.js', `'use strict';

require('./lib/bootstrap');

const { getTracks, getData } = require('spotify-url-info')(globalThis.fetch);
require('dotenv').config();

const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const { createMusicPlayer, SearchEngine } = require('./musicBackend');
const store = require('./db/store');
const searchCache = require('./db/search-cache');

const { WATCHADS_GIFTS, pendingKeys, getLinkvertiseLink } = require('./services/linkvertise');
const { spotifyApiSearch, spotifyTrackImage, spotifyTrackArtists } = require('./services/spotify');
const { activeBJGames, bjBuildContainer, bjDealerPlay, bjResolve, bjCalcHand } = require('./games/blackjack');
const { activeMinesGames, minesBuildContainer, minesMultiplier, MINES_GRID_SIZE } = require('./games/mines');
const { startBaccaratRound } = require('./games/baccarat');
const { initMemberCache } = require('./cache/members');
const { setPlayer } = require('./music/state');
const music = require('./music');
const { formatCooldown, getRoleForAura } = require('./utils/format');
const { coinEmojis, colors, emojiIap } = require('./lib/constants');
const { buildCommands } = require('./commands/definitions');
const { registerCommands } = require('./commands/register');
const { registerInteractionHandlers } = require('./handlers/interactions');
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

registerInteractionHandlers({
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
    activeMinesGames,
    minesBuildContainer,
    minesMultiplier,
    MINES_GRID_SIZE,
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
});

client.once('clientReady', async () => {
    console.log(\`Logged in as \${client.user.tag}\`);
    client.user.setStatus('online');
    await player.init().catch((err) => {
        console.error('[Music] Failed to connect to Lavalink node — check LAVALINK_HOST/PORT/PASSWORD and that the Docker container is running:', err);
    });
    await seedAllUncachedGuilds();
    const updateStatus = () => {
        const serverCount = client.guilds.cache.size;
        client.user.setActivity(\`with \${serverCount} servers\`, {
            type: ActivityType.Streaming,
            url: 'https://twitch.tv/roesalie'
        });
    };
    updateStatus();
    setInterval(updateStatus, 5 * 60 * 1000);
});

client.login(DISCORD_TOKEN);
`);

console.log('Done. Total source lines:', lines.length);
