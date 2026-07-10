'use strict';
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
    getPlayer, setSpotifyMetaByUrl, addAutoplayHistory, clearGuildMusicState,
} = require('./state');
const { fetchSyncedLyrics, buildLyricsSection } = require('./lyrics');

let _client = null;

function getMusicNodeOptions(channel) {
                    return {
        metadata: { channel },
    };
}

function isOverOneHour(duration) {
    if (!duration || typeof duration !== 'string') return false;
    const parts = duration.split(':').map(Number);
        if (parts.length === 3) return parts[0] >= 1;
        return false;
}

async function enqueueMusic(voiceChannel, searchResultOrTrack, textChannel) {
    const nodeOptions = getMusicNodeOptions(textChannel);
    if (searchResultOrTrack?.tracks?.length) {
        if (searchResultOrTrack.playlist && searchResultOrTrack.tracks.length > 1) {
            return getPlayer().play(voiceChannel, searchResultOrTrack, { nodeOptions });
        }
        return getPlayer().play(voiceChannel, searchResultOrTrack.tracks[0], { nodeOptions });
    }
    if (!searchResultOrTrack) {
        throw new Error('No playable track');
    }
    return getPlayer().play(voiceChannel, searchResultOrTrack, { nodeOptions });
}

function clearMusicNowPlayingInterval(guildId) {
    const interval = musicNowPlayingIntervals.get(guildId);
    if (interval) {
        clearInterval(interval);
        musicNowPlayingIntervals.delete(guildId);
    }
}

function clearMusicNowPlayingMessage(guildId) {
    musicNowPlayingMessages.delete(guildId);
    musicLyricsCache.delete(guildId);
}

function disableContainerControls(container) {
    for (const comp of container?.components ?? []) {
        if (Array.isArray(comp.components)) {
            for (const inner of comp.components) {
                if (typeof inner.setDisabled === 'function') inner.setDisabled(true);
            }
        }
    }
    return container;
}

async function disableNowPlayingControls(guildId, content) {
    clearMusicNowPlayingInterval(guildId);
    const stored = musicNowPlayingMessages.get(guildId);
    if (!stored?.message?.editable) {
        clearMusicNowPlayingMessage(guildId);
        return;
    }
    try {
        await stored.message.edit({
            components: content
                ? [new ContainerBuilder().setAccentColor(0x5A5A5C).addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(content)
                  )]
                : [],
            flags: MessageFlags.IsComponentsV2
        });
    } catch {
        /* message may be deleted */
    }
    clearMusicNowPlayingMessage(guildId);
}

function getQueue(guildId) {
    return getPlayer().nodes.get(guildId);
}

function canControlMusic(member, guild) {
    const queue = getQueue(guild.id);
    if (!queue) return false;
    const botChannelId = guild.members.me?.voice?.channelId;
    const userChannelId = member?.voice?.channelId;
    return Boolean(botChannelId && userChannelId && botChannelId === userChannelId);
}

async function findRelatedSpotifyTracks(guildId, seedName, seedArtistNames) {
    const alreadyPlayed = musicAutoplayHistory.get(guildId) || new Set();
    const pool = [];
    try {
        const search = await spotifyApiSearch(`${seedName} ${seedArtistNames}`, 'track', 1);
        const seedTrack = search?.tracks?.items?.[0];
        const artistNames = (seedTrack?.artists || []).map(a => a.name).filter(Boolean).slice(0, 3);

                        for (const name of artistNames) {
            const artistSearch = await spotifyApiSearch(`artist:"${name}"`, 'track', 10).catch(() => null);
            pool.push(...(artistSearch?.tracks?.items || []));
        }

                        const primaryArtistName = artistNames[0];
        if (primaryArtistName) {
            const artistLookup = await spotifyApiSearch(primaryArtistName, 'artist', 1).catch(() => null);
            const genre = artistLookup?.artists?.items?.[0]?.genres?.[0];
            if (genre) {
                const genreSearch = await spotifyApiSearch(`genre:"${genre}"`, 'track', 10).catch(() => null);
                pool.push(...(genreSearch?.tracks?.items || []));
            }
        }
    } catch (err) {
        console.error('[Autoplay] related-track lookup failed:', err.message);
    }

    const seen = new Set();
    const unique = [];
    for (const t of pool) {
        if (!t?.id || seen.has(t.id) || alreadyPlayed.has(t.id)) continue;
        if (t.name?.toLowerCase().trim() === seedName?.toLowerCase().trim()) continue;
        seen.add(t.id);
        unique.push(t);
    }
        for (let i = unique.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [unique[i], unique[j]] = [unique[j], unique[i]];
    }
    return unique.slice(0, 5);
}

async function maybeAutoplay(queue) {
    const guildId = queue.guild.id;
    if (musicAutoplayLock.has(guildId)) return;
    if (queue.tracks.size > 0) return;     musicAutoplayLock.add(guildId);
    try {
        const botChannel = queue.guild.members.me?.voice?.channel;
        const humansPresent = botChannel?.members?.some(m => !m.user.bot);
        if (!humansPresent) {
            console.log(`[Autoplay] ${guildId}: skipped — no one left in the voice channel`);
            return disableNowPlayingControls(guildId);
        }

        const seed = musicLastTrack.get(guildId);
        if (!seed) {
            console.log(`[Autoplay] ${guildId}: skipped — no last-played track recorded as a seed`);
            return disableNowPlayingControls(guildId);
        }
        const seedMeta = seed.spotifyMeta || spotifyMetaByUrl.get(seed.url);
        const seedName = seedMeta?.name || seed.title;
        const seedArtist = seedMeta?.artist || seed.author;
        console.log(`[Autoplay] ${guildId}: looking for songs related to "${seedName}" — ${seedArtist}`);

        const related = await findRelatedSpotifyTracks(guildId, seedName, seedArtist);
        if (!related.length) {
            console.log(`[Autoplay] ${guildId}: no related tracks found`);
            return disableNowPlayingControls(guildId);
        }

        let queued = 0;
        for (const t of related) {
            const trackName = t.name;
            const trackArtists = spotifyTrackArtists(t);
            let image = spotifyTrackImage(t);
            let res = null;
            const cachedUrl = searchCache.getYoutubeUrl(trackName, trackArtists);
            if (cachedUrl) {
                res = await getPlayer().search(cachedUrl, { requestedBy: _client.user, guildId }).catch(() => null);
            }
            if (!res?.tracks?.length) {
                res = await getPlayer().search(`${trackName} ${trackArtists}`, {
                    requestedBy: _client.user,
                    searchEngine: SearchEngine.YOUTUBE_SEARCH,
                    guildId
                }).catch(() => null);
                if (res?.tracks?.length) {
                    searchCache.setYoutubeUrl(trackName, trackArtists, res.tracks[0].url);
                }
            }
            if (!res?.tracks?.length || isOverOneHour(res.tracks[0].duration)) continue;
                                    if (!image) {
                const fallbackSearch = await spotifyApiSearch(`${trackName} ${trackArtists}`, 'track', 1).catch(() => null);
                image = spotifyTrackImage(fallbackSearch?.tracks?.items?.[0]);
            }
            if (image) res.tracks[0].thumbnail = image;
            res.tracks[0].spotifyMeta = { name: trackName, artist: trackArtists };
            setSpotifyMetaByUrl(res.tracks[0].url, { name: trackName, artist: trackArtists });
            queue.addTrack(res.tracks[0]);
            addAutoplayHistory(guildId, t.id);
            queued++;
        }
        console.log(`[Autoplay] ${guildId}: queued ${queued}/${related.length} related tracks`);

        if (queued > 0) {
            if (!queue.node.isPlaying()) await queue.node.play().catch((err) => {
                console.error('[Autoplay] queue.node.play() failed:', err);
            });
        } else {
            disableNowPlayingControls(guildId);
        }
    } catch (err) {
        console.error('[Autoplay] error:', err);
        disableNowPlayingControls(guildId);
    } finally {
        musicAutoplayLock.delete(guildId);
    }
}

function parseTimeLabelToSeconds(label) {
    const parts = String(label).split(':').map(Number);
    if (parts.some(isNaN)) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
}

function getNowPlayingThumbnail(track) {
    if (track.thumbnail && typeof track.thumbnail === 'string' && track.thumbnail.startsWith('http')) {
        return track.thumbnail;
    }
    const videoId = track.url?.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/)?.[1];
    if (videoId) return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    return 'https://i.imgur.com/4M34hi2.png';
}

function buildNowPlayingPayload(queue, track) {
    const guildId = queue.guild.id;
    if (!track) {
        return {
            components: [
                new ContainerBuilder().setAccentColor(0x5A5A5C).addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('-# ✕ Nothing is playing right now')
                )
            ],
            flags: MessageFlags.IsComponentsV2
        };
    }
    const progress = queue?.node?.getTimestamp?.() || null;
    const elapsed = progress?.current?.label || '0:00';
    const total = progress?.total?.label || track.duration || '00:00';
    const elapsedSec = typeof progress?.current?.value === 'number'
        ? progress.current.value / 1000
        : parseTimeLabelToSeconds(elapsed);
    const paused = queue?.node?.isPaused();
    const queueLength = (queue?.tracks?.size || 0) + (queue?.currentTrack ? 1 : 0);
    const position = queue?.currentTrack ? 1 : 0;
    const loopMode = queue?.repeatMode ?? 0;
    const thumbnailUrl = getNowPlayingThumbnail(track);
        const displayTitle = track.spotifyMeta?.name || spotifyMetaByUrl.get(track.url)?.name || track.title;
    const displayArtist = track.spotifyMeta?.artist || spotifyMetaByUrl.get(track.url)?.artist || track.author;

    const container = new ContainerBuilder().setAccentColor(0x5A5A5C);

                const titleSection = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`### ${displayTitle}`),
            new TextDisplayBuilder().setContent(`${displayArtist}`),
            new TextDisplayBuilder().setContent(`${elapsed} / ${total}`)
        )
        .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: thumbnailUrl } }));

    container.addSectionComponents(titleSection);
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

        const lyricsText = buildLyricsSection(guildId, elapsedSec);
    if (lyricsText) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lyricsText));
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    }

        container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`music_np_toggle:${guildId}`)
                .setEmoji(paused
                    ? { name: 'Play', id: '1523460110532350093' }
                    : { name: 'PAUSE', id: '1523460108456034434' })
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!queue?.currentTrack),

            new ButtonBuilder()
                .setCustomId(`music_np_skip:${guildId}`)
                .setEmoji({ name: 'Skip', id: '1523460112537358386' })
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!queue?.currentTrack),

            new ButtonBuilder()
                .setCustomId(`music_np_loop:${guildId}`)
                .setEmoji({ name: 'Loop', id: '1523460106271064284' })
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!queue?.currentTrack),

            new ButtonBuilder()
                .setCustomId(`music_np_stop:${guildId}`)
                .setEmoji({ name: 'Stop', id: '1523460114558746735' })
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!queue)
        )
    );

        const upcomingTracks = queue?.tracks?.toArray?.()?.slice(0, 25) ?? [];
    if (upcomingTracks.length > 0) {
        const menu = new StringSelectMenuBuilder()
            .setCustomId(`music_np_jump:${guildId}`)
            .setPlaceholder('Up next — select to play')
            .addOptions(
                upcomingTracks.map((t, i) => {
                    const meta = t.spotifyMeta || spotifyMetaByUrl.get(t.url);
                    const name = meta?.name || t.title;
                    return {
                        label: name.substring(0, 100),
                        description: t.duration || 'Unknown duration',
                        value: i.toString()
                    };
                })
            );
        container.addActionRowComponents(new ActionRowBuilder().addComponents(menu));
    }

    return {
        components: [container],
        flags: MessageFlags.IsComponentsV2
    };
}

async function publishNowPlaying(queue, track) {
    const guildId = queue.guild.id;
    const channel = queue.metadata?.channel;
    if (!channel?.send) return;

    clearMusicNowPlayingInterval(guildId);

    const stored = musicNowPlayingMessages.get(guildId);

    if (stored?.message?.editable) {
        if (stored.payload?.components?.[0]) {
            disableContainerControls(stored.payload.components[0]);
            await stored.message.edit(stored.payload).catch(() => {});
        } else {
                        await stored.message.edit({
                components: [],
                flags: MessageFlags.IsComponentsV2
            }).catch(() => {});
        }
    }

                        const meta = track.spotifyMeta || spotifyMetaByUrl.get(track.url);
    const lyricsName = meta?.name || track.title;
    const lyricsArtist = meta?.artist || track.author;
    const lyrics = await fetchSyncedLyrics(lyricsName, lyricsArtist);
    if (!lyrics) console.log(`[Lyrics] No match for "${lyricsName}" — ${lyricsArtist}`);
    musicLyricsCache.set(guildId, { trackUrl: track.url, lyrics });

    const payload = buildNowPlayingPayload(queue, track);
    const msg = await channel.send(payload);
    musicNowPlayingMessages.set(guildId, { message: msg, trackUrl: track.url, payload });

    const interval = setInterval(async () => {
        const liveQueue = getQueue(guildId);
        if (!liveQueue?.currentTrack || liveQueue.currentTrack.url !== track.url) {
            clearInterval(interval);
            musicNowPlayingIntervals.delete(guildId);
            return;
        }

        const livePayload = buildNowPlayingPayload(liveQueue, liveQueue.currentTrack);
        const entry = musicNowPlayingMessages.get(guildId);
        if (entry) entry.payload = livePayload;
        await msg.edit(livePayload).catch(() => {});
    }, 5000);

    musicNowPlayingIntervals.set(guildId, interval);
}

function isInteractionExpiredError(err) {
    return err?.code === 10062 || err?.code === 40060 || err?.code === 10008;
}

async function ackComponentInteraction(interaction) {
    if (interaction.deferred || interaction.replied) return;
    await interaction.deferUpdate();
}

async function replyOrFollowUp(interaction, payload) {
    try {
        if (interaction.deferred || interaction.replied) {
            return await interaction.followUp(payload);
        }
        return await interaction.reply(payload);
    } catch (err) {
        if (!isInteractionExpiredError(err)) {
            console.error('[Music] replyOrFollowUp failed:', err);
        }
    }
}

async function respondToComponent(interaction, payload) {
    try {
        await ackComponentInteraction(interaction);
        return await interaction.editReply(payload);
    } catch (err) {
        if (isInteractionExpiredError(err) && interaction.message?.editable) {
            return interaction.message.edit(payload);
        }
        throw err;
    }
}

async function handleNowPlayingButton(interaction) {
    const [action, guildId] = interaction.customId.split(':');
    if (!guildId || interaction.guild?.id !== guildId) {
        return interaction.reply({
            content: '-# ✕ Invalid control',
            flags: MessageFlags.Ephemeral
        });
    }

    const queue = getQueue(guildId);
    if (!queue) {
        await disableNowPlayingControls(guildId);
        return interaction.reply({
            content: '-# ✕ No active queue',
            flags: MessageFlags.Ephemeral
        });
    }

    if (!canControlMusic(interaction.member, interaction.guild)) {
        return interaction.reply({
            content: '-# ✕ Join the same voice channel as the bot',
            flags: MessageFlags.Ephemeral
        });
    }

    const control = action.replace('music_np_', '');

    if (control === 'skip') {
        if (!queue.currentTrack) {
            return interaction.reply({
                content: '-# ✕ Nothing to skip',
                flags: MessageFlags.Ephemeral
            });
        }
        try {
            await ackComponentInteraction(interaction);
            queue.node.skip();
            return;
        } catch (err) {
            console.error('[Music] skip button error:', err);
            return replyOrFollowUp(interaction, {
                content: '-# ✕ Could not skip',
                flags: MessageFlags.Ephemeral
            });
        }
    }

    if (control === 'toggle') {
        if (!queue.currentTrack) {
            return interaction.reply({
                content: '-# ✕ Nothing playing',
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            if (queue.node.isPaused()) {
                queue.node.resume();
            } else if (queue.node.isPlaying()) {
                queue.node.pause();
            } else {
                return interaction.reply({
                    content: '-# ✕ Nothing playing',
                    flags: MessageFlags.Ephemeral
                });
            }

            await ackComponentInteraction(interaction);
            const payload = buildNowPlayingPayload(queue, queue.currentTrack);
            await interaction.message.edit(payload).catch(() => {});
            const entry = musicNowPlayingMessages.get(guildId);
            if (entry) entry.payload = payload;

            return;
        } catch (err) {
            console.error('[Music] toggle button error:', err);
            return replyOrFollowUp(interaction, {
                content: '-# ✕ Could not change playback',
                flags: MessageFlags.Ephemeral
            });
        }
    }

    if (control === 'shuffle') {
        if (queue.tracks.size < 2) {
            return interaction.reply({
                content: '-# ✕ Not enough tracks in queue to shuffle',
                flags: MessageFlags.Ephemeral
            });
        }
        try {
            await ackComponentInteraction(interaction);
            queue.tracks.shuffle();
            const payload = buildNowPlayingPayload(queue, queue.currentTrack);
            await interaction.message.edit(payload).catch(() => {});
            const entry = musicNowPlayingMessages.get(guildId);
            if (entry) entry.payload = payload;
            return;
        } catch (err) {
            console.error('[Music] shuffle button error:', err);
            return replyOrFollowUp(interaction, { content: '-# ✕ Could not shuffle', flags: MessageFlags.Ephemeral });
        }
    }

    if (control === 'loop') {
        if (!queue.currentTrack) {
            return interaction.reply({
                content: '-# ✕ Nothing playing',
                flags: MessageFlags.Ephemeral
            });
        }
        try {
            await ackComponentInteraction(interaction);
            const current = queue.repeatMode ?? 0;
            const next = (current + 1) % 3;
            queue.setRepeatMode(next);
            const payload = buildNowPlayingPayload(queue, queue.currentTrack);
            await interaction.message.edit(payload).catch(() => {});
            const entry = musicNowPlayingMessages.get(guildId);
            if (entry) entry.payload = payload;
            return;
        } catch (err) {
            console.error('[Music] loop button error:', err);
            return replyOrFollowUp(interaction, { content: '-# ✕ Could not change loop', flags: MessageFlags.Ephemeral });
        }
    }

    if (control === 'stop') {
        try {
            await ackComponentInteraction(interaction);
            clearMusicNowPlayingInterval(guildId);
            musicAutoplayHistory.delete(guildId);
            musicLastTrack.delete(guildId);
            queue.delete();
            await interaction.message.edit({
                components: [new ContainerBuilder().setAccentColor(0x5A5A5C).addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('⏹  Playback stopped.')
                )],
                flags: MessageFlags.IsComponentsV2
            }).catch(() => {});
            clearMusicNowPlayingMessage(guildId);
            return;
        } catch (err) {
            console.error('[Music] stop button error:', err);
            return replyOrFollowUp(interaction, {
                content: '-# ✕ Could not stop',
                flags: MessageFlags.Ephemeral
            });
        }
    }
}

function registerPlayerEvents(player, client) {
    _client = client;
    player.events.on('playerError', (queue, error, track) => {
        const msg = error?.message || String(error);
        console.error('[Music] playerError:', track?.title, msg);
        const channel = queue.metadata?.channel;
        if (!channel?.send) return;

        channel.send(`-# ✕ Could not play **${track?.title || 'track'}** — skipping...`).catch(() => {});
    });

    player.events.on('emptyQueue', (queue) => {
        maybeAutoplay(queue).catch((err) => {
            console.error('[Autoplay] emptyQueue handler error:', err);
            disableNowPlayingControls(queue.guild.id);
        });
    });

    player.events.on('playerFinish', (queue) => {
        if (!queue.tracks.size) {
            maybeAutoplay(queue).catch((err) => {
                console.error('[Autoplay] playerFinish handler error:', err);
                disableNowPlayingControls(queue.guild.id);
            });
        }
    });

    player.events.on('disconnect', (queue) => {
        disableNowPlayingControls(queue.guild.id);
        musicAutoplayHistory.delete(queue.guild.id);
        musicLastTrack.delete(queue.guild.id);
        musicAutoplayLock.delete(queue.guild.id);
    });

    player.events.on('playerStart', (queue, track) => {
        musicLastTrack.set(queue.guild.id, track);
        publishNowPlaying(queue, track).catch((err) => {
            console.error('[Music] now playing panel error:', err);
        });
    });
}

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