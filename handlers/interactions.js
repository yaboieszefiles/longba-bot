'use strict';

const {
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SectionBuilder,
    ThumbnailBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
    StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
    PermissionsBitField, ComponentType, EmbedBuilder,
} = require('discord.js');

function attachBlackjackCollector(msg, game, channel, ctx) {
    const { store, activeBJGames, bjBuildContainer, bjDealerPlay, bjResolve, bjCalcHand, bjSerialize } = ctx;
    const userId = game.userId;

    activeBJGames.set(userId, game);
    store.saveGameSession(userId, 'blackjack', channel.id, msg.id, bjSerialize(game));

    function bjEndGame(status) {
        activeBJGames.delete(userId);
        store.deleteGameSession(userId, 'blackjack');
        if (status === 'win') store.addCoins(userId, game.bet * 2);
        else if (status === 'push') store.addCoins(userId, game.bet);
        collector.stop('resolved');
        msg.edit({
            components: [bjBuildContainer(game, status)],
            flags: MessageFlags.IsComponentsV2
        }).catch(() => {});
    }

    const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i => ['bj_hit', 'bj_stand', 'bj_double'].includes(i.customId),
        time: 2 * 60 * 1000
    });

    collector.on('collect', async i => {
        if (i.user.id !== userId) {
            return i.reply({
                content: '-# <:flork_hmmm31:1491903354786545714> This is not your game!',
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            await i.deferUpdate();

            if (i.customId === 'bj_hit') {
                game.playerHand.push(game.deck.pop());
                const total = bjCalcHand(game.playerHand);

                if (total > 21) return bjEndGame('bust');
                if (total === 21) {
                    bjDealerPlay(game);
                    return bjEndGame(bjResolve(game));
                }

                store.saveGameSession(userId, 'blackjack', channel.id, msg.id, bjSerialize(game));
                msg.edit({
                    components: [bjBuildContainer(game)],
                    flags: MessageFlags.IsComponentsV2
                }).catch(() => {});
            }

            if (i.customId === 'bj_stand') {
                bjDealerPlay(game);
                return bjEndGame(bjResolve(game));
            }

            if (i.customId === 'bj_double') {
                const currentCoins = store.getCoins(userId);
                if (game.playerHand.length !== 2 || currentCoins < game.bet) {
                    return i.followUp({
                        content: '-# <:flork_hmmm31:1491903354786545714> You can\'t double down right now!',
                        flags: MessageFlags.Ephemeral
                    }).catch(() => {});
                }
                store.addCoins(userId, -game.bet);
                game.bet *= 2;
                game.playerHand.push(game.deck.pop());
                bjDealerPlay(game);
                const total = bjCalcHand(game.playerHand);
                return bjEndGame(total > 21 ? 'bust' : bjResolve(game));
            }
        } catch (err) {
            console.error('[Blackjack] Collector error:', err);
            bjEndGame('lose');
        }
    });

    collector.on('end', (_, reason) => {
        if (reason === 'resolved') return;
        if (activeBJGames.has(userId)) {
            activeBJGames.delete(userId);
            store.deleteGameSession(userId, 'blackjack');
            msg.edit({
                components: [bjBuildContainer(game, 'lose')],
                flags: MessageFlags.IsComponentsV2
            }).catch(() => {});
        }
    });
}

function attachMinesCollector(msg, game, channel, ctx) {
    const { store, activeMinesGames, minesBuildContainer, minesMultiplier, MINES_GRID_SIZE, minesSerialize } = ctx;
    const userId = game.userId;

    activeMinesGames.set(userId, game);
    store.saveGameSession(userId, 'mines', channel.id, msg.id, minesSerialize(game));

    function minesEndGame(status) {
        activeMinesGames.delete(userId);
        store.deleteGameSession(userId, 'mines');
        if (status === 'win' || status === 'cashout') {
            const mult = minesMultiplier(game.mineCount, game.revealed.size);
            store.addCoins(userId, Math.floor(game.bet * mult));
        }
        collector.stop('resolved');
        msg.edit({
            components: [minesBuildContainer(game, status)],
            flags: MessageFlags.IsComponentsV2
        }).catch(() => {});
    }

    const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i => i.customId === 'mines_cashout' || i.customId.startsWith('mines_'),
        time: 3 * 60 * 1000
    });

    collector.on('collect', async i => {
        if (i.user.id !== userId) {
            return i.reply({
                content: '-# <:flork_hmmm31:1491903354786545714> This is not your game!',
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            await i.deferUpdate();

            if (i.customId === 'mines_cashout') {
                return minesEndGame('cashout');
            }

            const idx = parseInt(i.customId.split('_')[1], 10);
            if (isNaN(idx) || game.revealed.has(idx)) return;

            if (game.mines.has(idx)) {
                return minesEndGame('lose');
            }

            game.revealed.add(idx);
            const safeTiles = MINES_GRID_SIZE - game.mineCount;
            if (game.revealed.size === safeTiles) {
                return minesEndGame('win');
            }

            store.saveGameSession(userId, 'mines', channel.id, msg.id, minesSerialize(game));
            msg.edit({
                components: [minesBuildContainer(game)],
                flags: MessageFlags.IsComponentsV2
            }).catch(() => {});
        } catch (err) {
            console.error('[Mines] Collector error:', err);
            minesEndGame('lose');
        }
    });

    collector.on('end', (_, reason) => {
        if (reason === 'resolved') return;
        if (activeMinesGames.has(userId)) {
            activeMinesGames.delete(userId);
            store.deleteGameSession(userId, 'mines');
            msg.edit({
                components: [minesBuildContainer(game, 'lose')],
                flags: MessageFlags.IsComponentsV2
            }).catch(() => {});
        }
    });
}

async function resumeGameSessions(ctx) {
    const { client, store } = ctx;

    const bjSessions = store.getAllGameSessions('blackjack');
    for (const session of bjSessions) {
        try {
            const channel = await client.channels.fetch(session.channelId);
            const msg = await channel.messages.fetch(session.messageId);
            const game = ctx.bjDeserialize(session.state);
            attachBlackjackCollector(msg, game, channel, ctx);
            await msg.edit({
                components: [ctx.bjBuildContainer(game)],
                flags: MessageFlags.IsComponentsV2
            }).catch(() => {});
            console.log(`[Blackjack] Resumed game for user ${session.userId}`);
        } catch (err) {
            console.warn(`[Blackjack] Could not resume game for user ${session.userId}, refunding bet:`, err.message);
            store.addCoins(session.userId, session.state.bet);
            store.deleteGameSession(session.userId, 'blackjack');
        }
    }

    const minesSessions = store.getAllGameSessions('mines');
    for (const session of minesSessions) {
        try {
            const channel = await client.channels.fetch(session.channelId);
            const msg = await channel.messages.fetch(session.messageId);
            const game = ctx.minesDeserialize(session.state);
            attachMinesCollector(msg, game, channel, ctx);
            await msg.edit({
                components: [ctx.minesBuildContainer(game)],
                flags: MessageFlags.IsComponentsV2
            }).catch(() => {});
            console.log(`[Mines] Resumed game for user ${session.userId}`);
        } catch (err) {
            console.warn(`[Mines] Could not resume game for user ${session.userId}, refunding bet:`, err.message);
            store.addCoins(session.userId, session.state.bet);
            store.deleteGameSession(session.userId, 'mines');
        }
    }
}

function registerInteractionHandlers(deps) {
    const {
        client, store, searchCache, player, SearchEngine,
        getLinkvertiseLink, pendingKeys, WATCHADS_GIFTS,
        getQueue, disableNowPlayingControls, handleNowPlayingButton,
        buildNowPlayingPayload, publishNowPlaying, enqueueMusic, isOverOneHour,
        spotifyApiSearch, spotifyTrackImage, spotifyTrackArtists,
        getTracks, getData,
        activeBJGames, bjBuildContainer, bjDealerPlay, bjResolve, bjCalcHand, bjCreateDeck,
        bjSerialize, bjDeserialize,
        activeMinesGames, minesBuildContainer, minesMultiplier, MINES_GRID_SIZE, minesGenerateMines,
        minesSerialize, minesDeserialize,
        startBaccaratRound,
        activeCockfight,
        pendingMarriages,
        formatCooldown, getRoleForAura,
        colors, coinEmojis, emojiIap,
        getCachedMembers,
        canControlMusic,
        cmdCooldowns,
        setSpotifyMetaByUrl,
        spotifyMetaByUrl,
    } = deps;

    client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand() && !interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;
    if (interaction.isCommand() && interaction.commandName === 'rewards') {
        const userId = interaction.user.id;
        const now = Date.now();
        const lastClaim = store.getCooldown(userId, 'rewards') || 0;
        const cooldownLeft = lastClaim - now;
        if (cooldownLeft > 0) {
            const hours = Math.floor(cooldownLeft / (1000 * 60 * 60));
            const minutes = Math.floor((cooldownLeft % (1000 * 60 * 60)) / (1000 * 60));
            return interaction.reply({
                content: `-# <:flork_hmmm31:1491903354786545714> You already claimed! Come back in **${hours}h ${minutes}m**.`,
                flags: MessageFlags.Ephemeral
            });
        }
        await interaction.deferReply();
        const link = await getLinkvertiseLink(userId);
        if (!link) {
            return interaction.editReply({ content: '-# Something went wrong. Try again later.' });
        }

        const rewardsContainer = new ContainerBuilder()
            .setAccentColor(0x9B59B6)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## <:acoin:1508147096631513188> Earn Rewards`)
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `**What you get**
> <:gift:1502999386467336312> **${WATCHADS_GIFTS}x Gifts** after completing the task`
                )
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(false))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `**How to claim**
` +
                    `> **1.** Click **Complete Task** below
` +
                    `> **2.** Finish the short task on the page
` +
                    `> **3.** Copy the key you receive
` +
                    `> **4.** Come back and click **I have a key**`
                )
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `-# Completing tasks helps keep the bot alive. Thank you for your support! <a:93964noellehappy:1491130797917212693>`
                )
            )
            .addActionRowComponents(
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('Complete Task')
                        .setEmoji({ id: '1512852060503015515', name: 'rsillylurefusecall', animated: true })
                        .setStyle(ButtonStyle.Link)
                        .setURL(link),
                    new ButtonBuilder()
                        .setCustomId('watchads_enter_key')
                        .setLabel('I have a key')
                        .setEmoji({ id: '1502999386467336312', name: 'gift' })
                        .setStyle(ButtonStyle.Secondary)
                )
            );

        return interaction.editReply({
            components: [rewardsContainer],
            flags: MessageFlags.IsComponentsV2
        });
    }

        if (interaction.isButton() && interaction.customId === 'watchads_enter_key') {
        const modal = new ModalBuilder()
            .setCustomId('watchads_key_modal')
            .setTitle('Enter Your Reward Key');
        const keyInput = new TextInputBuilder()
            .setCustomId('reward_key_input')
            .setLabel('Paste your key here')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g. 31ab31110ee04c98')
            .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
        return interaction.showModal(modal);
    }

        if (interaction.isModalSubmit() && interaction.customId === 'watchads_key_modal') {
        const key = interaction.fields.getTextInputValue('reward_key_input').trim();
        const userId = interaction.user.id;

        if (!key || !pendingKeys.has(key)) {
            return interaction.reply({
                content: '<:flork_hmmm31:1491903354786545714> Invalid or expired key! Please try again with </rewards:1512861685453685033>.',
                flags: MessageFlags.Ephemeral
            });
        }

        const { discordId } = pendingKeys.get(key);

        if (discordId !== userId) {
            return interaction.reply({
                content: '<:flork_hmmm31:1491903354786545714> This key does not belong to you!',
                flags: MessageFlags.Ephemeral
            });
        }
        pendingKeys.delete(key);
        const userItem = store.getItems(userId);
        if (!userItem.gift) userItem.gift = { quantity: 0 };
        userItem.gift.quantity += WATCHADS_GIFTS;
        store.setItems(userId, userItem);
        store.setCooldown(userId, 'rewards', Date.now() + 3 * 60 * 60 * 1000);

                const claimUser = interaction.user;
        fetch('https://discord.com/api/webhooks/1514686160989851699/MU5HToC51qCv46Au6_WEmHHvZ4wZEXkWQVWmVcblHs4OoJJwYJ7FUGLyNVhWdpXk2x_w', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [{
                    title: '<:gift:1502999386467336312> Reward Claimed',
                    color: 0x5A5A5C,
                    fields: [
                        { name: 'User', value: `${claimUser.tag}`, inline: true },
                        { name: 'User ID', value: claimUser.id, inline: true },
                        { name: 'Key Used', value: `\`${key}\``, inline: false },
                        { name: 'Server', value: interaction.guild?.name || 'DM', inline: true },
                    ],
                    timestamp: new Date().toISOString(),
                    footer: { text: 'Rewards Logger' }
                }]
            })
        }).catch(err => console.error('[Webhook] Failed to log reward claim:', err.message));

        return interaction.reply({
            content: `<a:93964noellehappy:1491130797917212693> Key accepted! You received **${WATCHADS_GIFTS}x <:gift:1502999386467336312> Gifts**!\n-# Come back in 3 hours to claim again!`,
            flags: MessageFlags.Ephemeral
        });
    }
    if (interaction.isCommand() && interaction.commandName === 'help') {
        const botAvatar = client.user.displayAvatarURL();

        const container = new ContainerBuilder().setAccentColor(0x5A5A5C);

                const headerSection = new SectionBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`<a:chicken:1491117598417490032> **Longba**`),
                new TextDisplayBuilder().setContent(
                    `Welcome to <@1491110943873044640>'s help!\n` +
                    `Use the select menu below to browse commands.\n\n` +
                    `[Support Server](https://discord.gg/c7H9JXdVND) | [Buy Me A Coffee](https://i.imgur.com/AQ7dIr8.jpeg)`
                )
            )
            .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: botAvatar } }));

        container.addSectionComponents(headerSection);
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

                container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## Commands\n` +
                `<:acoin:1508147096631513188> **Economy** — Coins, shop, rob, daily, and more\n` +
                `<:49933hamstersad:1491131447246065774> **Pets** — Pet commands and abilities\n` +
                `<a:coin_flip_circle:1491122157667750111> **Games** — Coinflip, colorgame, blackjack, cockfight, baccarat\n` +
                `<a:981409kuromising:1511121608897724426> **Music** — Play songs and control the music player\n` +
                `<a:flame:1491148060217180282> **Aura** — Aura system commands\n` +
                `<:gift:1502999386467336312> **Rewards** — Earn free Gifts and bonus items`
            )
        );
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('help_menu')
            .setPlaceholder('Browse commands...')
            .addOptions([
                {
                    label: 'Main Menu',
                    description: 'Go back to the main help page',
                    value: 'main',
                    emoji: '<a:chicken:1491117598417490032>'
                },
                {
                    label: 'Economy',
                    description: 'Coins, shop, rob, daily, and more',
                    value: 'economy',
                    emoji: '<:acoin:1508147096631513188>'
                },
                {
                    label: 'Pets',
                    description: 'Pet commands and abilities',
                    value: 'pets',
                    emoji: '<:49933hamstersad:1491131447246065774>'
                },
                {
                    label: 'Games',
                    description: 'Coinflip, colorgame, cockfight, baccarat',
                    value: 'games',
                    emoji: '<a:coin_flip_circle:1491122157667750111>'
                },
                {
                    label: 'Music',
                    description: 'Play songs and control the music player',
                    value: 'music',
                    emoji: '<a:981409kuromising:1511121608897724426>'
                },
                {
                    label: 'Aura',
                    description: 'Aura system commands',
                    value: 'aura',
                    emoji: '<a:flame:1491148060217180282>'
                },
                {
                    label: 'Rewards',
                    description: 'Earn free Gifts and bonus items',
                    value: 'rewards',
                    emoji: '<:gift:1502999386467336312>'
                }
            ]);

        container.addActionRowComponents(new ActionRowBuilder().addComponents(selectMenu));

        await interaction.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'help_menu') {
        const selected = interaction.values[0];
        const botAvatar = client.user.displayAvatarURL();

        const pages = {
            main: () => {
                const c = new ContainerBuilder().setAccentColor(0x5A5A5C);
                const headerSection = new SectionBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`<a:chicken:1491117598417490032> **Longba**`),
                        new TextDisplayBuilder().setContent(
                            `Welcome to <@1491110943873044640>'s help!\n` +
                            `Use the select menu below to browse commands.\n\n` +
                            `[Support Server](https://discord.gg/c7H9JXdVND) | [Buy Me A Coffee](https://i.imgur.com/AQ7dIr8.jpeg)`
                        )
                    )
                    .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: botAvatar } }));
                c.addSectionComponents(headerSection);
                c.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
                c.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `## Commands\n` +
                        `<:acoin:1508147096631513188> **Economy** — Coins, shop, rob, daily, and more\n` +
                        `<:49933hamstersad:1491131447246065774> **Pets** — Pet commands and abilities\n` +
                        `<a:coin_flip_circle:1491122157667750111> **Games** — Coinflip, colorgame, cockfight, baccarat\n` +
                        `<a:981409kuromising:1511121608897724426> **Music** — Play songs and control the music player\n` +
                        `<a:flame:1491148060217180282> **Aura** — Aura system commands\n` +
                        `<:gift:1502999386467336312> **Rewards** — Earn free Gifts and bonus items`
                    )
                );
                return c;
            },

            economy: () => {
                const c = new ContainerBuilder().setAccentColor(0x5A5A5C);
                c.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## <:acoin:1508147096631513188> Economy Commands`)
                );
                c.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
                c.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `</coins:1491154182508642438> — Check your Coins balance\n` +
                        `</daily:1491118301277847759> — Claim daily reward (**5,000 Coins** + streak bonus)\n` +
                        `</give:1491118301672243321> — Give Coins, items, or Tokens to another user\n` +
                        `-# Supports: **Coins**, **Gift**, **Coke**, **Weed**, **Token**\n` +
                        `</rob:1491118301277847758> — Attempt to rob another user\n` +
                        `</shop:1491118301277847760> — Open the item/pet shop\n` +
                        `</sell:1491118301672243324> — Sell coke or weed\n` +
                        `</craft:1491903806500241448> — Craft drugs (requires AK, Mask, Bag)\n` +
                        `</use:1491118301672243325> — Use an item (coke, weed, gift)\n` +
                        `</leaderboard:1496805139514921083> — View top richest players\n` +
                        `</marry:1503021068213026876> — Propose to someone (requires Ring)\n` +
                        `</divorce:1503021068213026877> — Divorce your partner`
                    )
                );
                return c;
            },

            pets: () => {
                const c = new ContainerBuilder().setAccentColor(0x5A5A5C);
                c.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## <:49933hamstersad:1491131447246065774> Pet Commands`)
                );
                c.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
                c.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `</pet:1496842251975000164> \`cat\` — +3,500 VC Coins every 30 mins\n` +
                        `</pet:1496842251975000164> \`dog\` — Check your Agimat time remaining\n` +
                        `</pet:1496842251975000164> \`hamster\` — 8.5x luck in coinflip (15 bets/2hrs)\n` +
                        `</pet:1496842251975000164> \`fox\` — Steal coins from richest user without Agimat\n` +
                        `</pet:1496842251975000164> \`crow\` — Steal drugs from users without Agimat\n` +
                        `</pet:1496842251975000164> \`kitsune\` — Grant **+1,000–2,000 Aura** to a user\n` +
                        `</pet:1496842251975000164> \`rabbit\` — Extend your Agimat by **+1 to 3 hours**\n` +
                        `</pet:1496842251975000164> \`owl\` — Inspect a target's Agimat expiry time\n` +
                        `</pet:1496842251975000164> \`rat\` — Reduce a target's Agimat by **1–3 hours**\n` +
                        `</pet:1496842251975000164> \`raccoon\` — Raid a target and steal a big amount of their Coins, Coke & Weed\n` +
                        `</pet:1496842251975000164> \`octopus\` — Resets the cooldown of your last used pet`
                    )
                );
                return c;
            },

            games: () => {
                const c = new ContainerBuilder().setAccentColor(0x5A5A5C);
                c.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## <a:coin_flip_circle:1491122157667750111> Games Commands`)
                );
                c.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
                c.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `</coinflip:1491118301672243322> — Bet on heads or tails (max **50,000 Coins**)\n` +
                        `</colorgame:1491118301277847761> — Bet on a color, roll 3 dice (max **50,000 Coins**)\n` +
                        `</cockfight:1491118301672243323> — Fight with your chicken (max **50,000 Coins**)\n` +
                        `</baccarat:1492287183497728331> — Live baccarat betting game (max **50,000/click**)\n` +
                        `</blackjack:1515737612969836564> — Play Blackjack (max **50,000 Coins**)\n` +
                        `</mines:1521440373740666880> — Open chests, avoid the bombs (max **50,000 Coins**)\n` +
                        `-# Buy a **Chicken** from </shop:1491118301277847760> to join cockfights!`
                    )
                );
                return c;
            },

            music: () => {
                const c = new ContainerBuilder().setAccentColor(0x5A5A5C);
                c.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## <a:981409kuromising:1511121608897724426> Music Commands`)
                );
                c.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
                c.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `\`/play\` — Play a song by name, or paste a Spotify link\n\n` +
                        `**Now Playing controls** *(buttons under the player)*\n` +
                        `<:PAUSE:1523460108456034434> /<:Play:1523460110532350093> — Pause / Resume\n` +
                        `<:Skip:1523460112537358386> — Skip to the next track\n` +
                        `<:Loop:1523460106271064284> — Toggle loop\n` +
                        `<:Stop:1523460114558746735> — Stop and clear the queue\n\n` +
                        `**Up next dropdown** — pick any queued track to jump straight to it\n\n` +
                        `-# Synced lyrics and live progress show automatically while a track plays!`
                    )
                );
                return c;
            },

            rewards: () => {
                const c = new ContainerBuilder().setAccentColor(0x5A5A5C);
                c.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## <:gift:1502999386467336312> Rewards`)
                );
                c.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
                c.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `</rewards:1512861685453685033> — Complete a short task to earn **${WATCHADS_GIFTS}x <:gift:1502999386467336312> Gifts**!\n\n` +
                        `After finishing the tasks, you'll receive a key.\n` +
                        `Come back and click **"I have a key"** to claim your rewards.\n\n` +
                        `-# Cooldown: **3 hours** per claim.\n` +
                        `-# Completing tasks helps keep the bot alive. Thank you! <a:93964noellehappy:1491130797917212693>`
                    )
                );
                return c;
            },
            aura: () => {
                const c = new ContainerBuilder().setAccentColor(0x5A5A5C);
                c.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## <a:flame:1491148060217180282> Aura Commands`)
                );
                c.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
                c.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `</profile:1513520850794582076> — Check your current Aura\n` +
                        `</smoke:1491118301672243328> — Smoke a cig to gain Aura\n` +
                        `</use:1491118301672243325> \`weed\` — Use weed for **+100–250 Aura**\n` +
                        `</use:1491118301672243325> \`coke\` — Use coke for **+250–500 Aura**\n\n` +
                        `**Aura Roles** *(auto-assigned)*\n` +
                        `> 1,000 — Smoker\n` +
                        `> 10,000 — Lv. 10\n` +
                        `> 25,000 — Lv. 25\n` +
                        `> 50,000 — Lv. 50\n` +
                        `> 75,000 — Lv. 75\n` +
                        `> 100,000 — Lv. 100`
                    )
                );
                return c;
            }
        };

        const buildPage = pages[selected];
        if (!buildPage) return;

        const pageContainer = buildPage();

                pageContainer.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('help_menu')
            .setPlaceholder('Browse commands...')
            .addOptions([
                { label: 'Main Menu', description: 'Go back to the main help page', value: 'main', emoji: '<a:chicken:1491117598417490032>' },
                { label: 'Economy', description: 'Coins, shop, rob, daily, and more', value: 'economy', emoji: '<:acoin:1508147096631513188>' },
                { label: 'Pets', description: 'Pet commands and abilities', value: 'pets', emoji: '<:49933hamstersad:1491131447246065774>' },
                { label: 'Games', description: 'Coinflip, colorgame, cockfight, baccarat', value: 'games', emoji: '<a:coin_flip_circle:1491122157667750111>' },
                { label: 'Music', description: 'Play songs and control the music player', value: 'music', emoji: '<a:981409kuromising:1511121608897724426>' },
                { label: 'Aura', description: 'Aura system commands', value: 'aura', emoji: '<a:flame:1491148060217180282>' },
                { label: 'Rewards', description: 'Earn free Gifts and bonus items', value: 'rewards', emoji: '<:gift:1502999386467336312>' }
            ]);
        pageContainer.addActionRowComponents(new ActionRowBuilder().addComponents(selectMenu));

        await interaction.update({
            components: [pageContainer],
            flags: MessageFlags.IsComponentsV2
        });
    }
    if (interaction.isCommand() && interaction.commandName === 'nowplaying') {
        const queue = getQueue(interaction.guildId);

        if (!queue?.currentTrack) {
            return interaction.reply({
                content: '-# ✕ Nothing is currently playing.',
                flags: MessageFlags.Ephemeral
            });
        }

        return interaction.reply({
            ...buildNowPlayingPayload(queue, queue.currentTrack),
            fetchReply: true
        });
    }
    if (interaction.isButton() && typeof interaction.customId === 'string' && interaction.customId.startsWith('music_np_')) {
        try {
            await handleNowPlayingButton(interaction);
        } catch (err) {
            console.error('[Music] button interaction error:', err);
            if (!interaction.replied && !interaction.deferred) {
                interaction.reply({
                    content: '-# ✕ Control error — try again',
                    flags: MessageFlags.Ephemeral
                }).catch(() => {});
            }
        }
        return;
    }
    if (interaction.isCommand() && interaction.commandName === 'play') {
        const voice = interaction.member?.voice?.channel;
        if (!voice) {
            return interaction.reply({
                content: '-# ✕ Join a voice channel first.',
                flags: MessageFlags.Ephemeral
            });
        }

                                const botChannelId = interaction.guild.members.me?.voice?.channelId;
        if (botChannelId && botChannelId !== voice.id) {
            return interaction.reply({
                content: `-# ✕ I'm already playing in <#${botChannelId}> — join that voice channel to add songs.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const query = interaction.options.getString('query', true);
        await interaction.deferReply();

                if (/(?:youtube\.com|youtu\.be)/i.test(query)) {
            return interaction.editReply(
                "-# ✕ YouTube links aren't supported here — search by **song name**, or paste a **Spotify** link instead."
            );
        }

        const isSpotifyLink = /open\.spotify\.com|spotify\.link/i.test(query);

                                async function queueSpotifyTrack(name, artistNames, image) {
            let res = null;
            const cachedUrl = searchCache.getYoutubeUrl(name, artistNames);
            const searchGuildOpts = { guildId: interaction.guildId, voiceChannelId: voice.id, textChannelId: interaction.channel?.id };
            if (cachedUrl) {
                res = await player.search(cachedUrl, { requestedBy: interaction.user, ...searchGuildOpts }).catch(() => null);
            }
            if (!res?.tracks?.length) {
                res = await player.search(`${name} ${artistNames}`, {
                    requestedBy: interaction.user,
                    searchEngine: SearchEngine.YOUTUBE_SEARCH,
                    ...searchGuildOpts
                });
                if (res?.tracks?.length) {
                    searchCache.setYoutubeUrl(name, artistNames, res.tracks[0].url);
                }
            }
            if (!res?.tracks?.length || isOverOneHour(res.tracks[0].duration)) return null;

                                                                        let coverImage = image;
            if (!coverImage) {
                const fallbackSearch = await spotifyApiSearch(`${name} ${artistNames}`, 'track', 1).catch(() => null);
                coverImage = spotifyTrackImage(fallbackSearch?.tracks?.items?.[0]);
            }
            if (coverImage) res.tracks[0].thumbnail = coverImage;
                                                            res.tracks[0].spotifyMeta = { name, artist: artistNames };
            setSpotifyMetaByUrl(res.tracks[0].url, { name, artist: artistNames });
            await enqueueMusic(voice, res, interaction.channel);
            return res.tracks[0];
        }

        try {
            if (isSpotifyLink) {
                const artistMatch = query.match(/spotify\.com\/artist\/([a-zA-Z0-9]+)/);

                if (artistMatch) {
                                                                                const artistPage = await getData(query).catch(() => null);
                    const artistName = artistPage?.name || artistPage?.title;
                    if (!artistName) {
                        return interaction.editReply('-# ✕ Could not read that artist page — try pasting the link again.');
                    }
                    const artistSearch = await spotifyApiSearch(`artist:"${artistName}"`, 'track', 10).catch(() => null);
                    const topTracks = artistSearch?.tracks?.items || [];
                    if (!topTracks.length) {
                        return interaction.editReply(`-# ✕ No tracks found for **${artistName}**.`);
                    }
                    let added = 0;
                    for (const track of topTracks.slice(0, 10)) {
                        const t = await queueSpotifyTrack(track.name, spotifyTrackArtists(track), spotifyTrackImage(track)).catch(() => null);
                        if (t) added++;
                    }
                    if (!added) {
                        return interaction.editReply(`-# ✕ Couldn't queue any tracks by **${artistName}**.`);
                    }
                                        return interaction.deleteReply().catch(() => {});
                }

                                const tracks = await getTracks(query);
                if (!tracks?.length) {
                    return interaction.editReply('-# ✕ No tracks found from that Spotify link.');
                }
                if (tracks.length === 1) {
                    const t = await queueSpotifyTrack(tracks[0].name, tracks[0].artist, tracks[0].image);
                    if (!t) {
                        return interaction.editReply("-# ✕ Couldn't find a playable result for that track (or it's over 1 hour long).");
                    }
                    return interaction.deleteReply().catch(() => {});
                }
                let added = 0;
                for (const track of tracks) {
                    const t = await queueSpotifyTrack(track.name, track.artist, track.image).catch(() => null);
                    if (t) added++;
                }
                if (!added) {
                    return interaction.editReply(`-# ✕ Couldn't queue any tracks from that link.`);
                }
                return interaction.deleteReply().catch(() => {});
            }

                        const search = await spotifyApiSearch(query, 'track', 1);
            const track = search.tracks?.items?.[0];
            if (!track) return interaction.editReply(`-# ✕ No song found for **${query}**.`);
            const t = await queueSpotifyTrack(track.name, spotifyTrackArtists(track), spotifyTrackImage(track));
            if (!t) {
                return interaction.editReply(
                    `-# ✕ Sorry, I couldn't queue **${track.name}** — either no playable result was found, or it's longer than **1 hour** (our bot hosting can't handle it). Use </rewards:1512861685453685033> to help keep the bot running!`
                );
            }
            return interaction.deleteReply().catch(() => {});

        } catch (err) {
            console.error('[Music] /play error:', err);
            return interaction.deleteReply().catch(() => {});
        }
    }
    if (
        interaction.isStringSelectMenu() &&
        typeof interaction.customId === 'string' &&
        interaction.customId.startsWith('music_np_jump:')
    ) {
        const queue = getQueue(interaction.guildId);
        if (!queue?.currentTrack) {
            return interaction.reply({ content: 'No active queue.', flags: MessageFlags.Ephemeral });
        }
        const selectedIndex = parseInt(interaction.values[0]);
        const tracks = queue.tracks.toArray();
        const selectedTrack = tracks[selectedIndex];
        if (!selectedTrack) {
            return interaction.reply({ content: 'Track not found.', flags: MessageFlags.Ephemeral });
        }
        tracks.splice(selectedIndex, 1);
        queue.tracks.clear();
        queue.addTrack(selectedTrack);
        tracks.forEach(track => queue.addTrack(track));
        queue.node.skip();
        const jumpMeta = selectedTrack.spotifyMeta || spotifyMetaByUrl.get(selectedTrack.url);
        const jumpTitle = jumpMeta?.name || selectedTrack.title;
        return interaction.reply({
            content: `⏭  Jumped to **${jumpTitle}**`,
            flags: MessageFlags.Ephemeral
        });
    }
    if (interaction.isCommand() && interaction.commandName === 'stop') {
        const queue = getQueue(interaction.guildId);
        if (!queue) {
            return interaction.reply({
                content: '-# ✕ No active queue.',
                flags: MessageFlags.Ephemeral
            });
        }

        await disableNowPlayingControls(interaction.guildId);
        queue.delete();
                await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
        return interaction.deleteReply().catch(() => {});
    }
    if (interaction.isCommand() && interaction.commandName === 'serverhop') {

        let guilds = [...client.guilds.cache.values()]
            .filter(g => g.memberCount >= 100)
            .sort((a, b) => b.memberCount - a.memberCount);

        if (!guilds.length) {
            return interaction.reply({
                content: '-# No servers found with 100+ members.',
                flags: MessageFlags.Ephemeral
            });
        }

        let page = 0;

        const serverHopJoinCooldown = new Map();

        function canCreateInvite(guild) {
            const me = guild.members.me ?? guild.members.cache.get(client.user.id);

            const channel = guild.channels.cache.find(c =>
                c.isTextBased() &&
                c.permissionsFor(me)?.has([
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.CreateInstantInvite
                ])
            );

            return !!channel;
        }

        async function buildServerHopContainer(guild, disabled = false) {
            const owner = await guild.fetchOwner().catch(() => null);
            const iconUrl = guild.iconURL({ dynamic: true });
            const inviteAvailable = canCreateInvite(guild)
                ? '<a:138056check:1510971269393289257> Yes'
                : '<:739666scribblecross:1510971355359744031> No';

            const container = new ContainerBuilder()
                .setAccentColor(0x5A5A5C);

                        const titleSection = new SectionBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## ${guild.name}`),
                    new TextDisplayBuilder().setContent(guild.description || 'No description available.')
                );

            if (iconUrl) {
                titleSection.setThumbnailAccessory(
                    new ThumbnailBuilder({ media: { url: iconUrl } })
                );
            }

            container.addSectionComponents(titleSection);

                        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

                        container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `<:821905ownertag:1510975785752723456> **Owner:** ${owner ? owner.user.tag : `<@${guild.ownerId}>`}\n` +
                    `<:928205membericon:1510970495473025144> **Members:** ${guild.memberCount.toLocaleString()}\n` +
                    `<a:679771nitrobooster:1510970946624819222> **Boost Level:** ${guild.premiumTier}\n` +
                    `<:172874link:1510971054175031356> **Invite Available:** ${inviteAvailable}`
                )
            );

                        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

                        container.addActionRowComponents(
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('serverhop_back')
                        .setEmoji('1511035172064198707')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(disabled),

                    new ButtonBuilder()
                        .setCustomId('serverhop_page')
                        .setLabel(`${page + 1}/${guilds.length}`)
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true),

                    new ButtonBuilder()
                        .setCustomId('serverhop_next')
                        .setEmoji('1511035189751713803')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(disabled),

                    new ButtonBuilder()
                        .setCustomId('serverhop_join')
                        .setEmoji('1510971054175031356')
                        .setLabel('Join')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(disabled)
                )
            );

            return container;
        }

        const msg = await interaction.reply({
            components: [await buildServerHopContainer(guilds[page])],
            flags: MessageFlags.IsComponentsV2,
            fetchReply: true
        });

        const collector = msg.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 300000
        });

        collector.on('collect', async i => {

            if (i.user.id !== interaction.user.id) {
                return i.reply({
                    content: '-# This menu is not yours.',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (i.customId === 'serverhop_next') {
                page = (page + 1) % guilds.length;
            }

            if (i.customId === 'serverhop_back') {
                page = (page - 1 + guilds.length) % guilds.length;
            }

            if (i.customId === 'serverhop_next' || i.customId === 'serverhop_back') {
                try {
                    await i.update({
                        components: [await buildServerHopContainer(guilds[page])],
                        flags: MessageFlags.IsComponentsV2
                    });
                } catch (err) {
                    if (err.code === 10062) return;                     throw err;
                }
                return;
            }

            if (i.customId === 'serverhop_join') {

                const userId = i.user.id;
                const now = Date.now();

                if (serverHopJoinCooldown.has(userId)) {
                    const expires = serverHopJoinCooldown.get(userId);

                    if (now < expires) {
                        const remaining = Math.ceil((expires - now) / 1000);

                        return i.reply({
                            content: `<:flork_hmmm31:1491903354786545714> Please wait **${remaining}s** before requesting another invite.`,
                            flags: MessageFlags.Ephemeral
                        });
                    }
                }

                serverHopJoinCooldown.set(userId, now + 20000);

                setTimeout(() => {
                    serverHopJoinCooldown.delete(userId);
                }, 20000);

                const guild = guilds[page];
                const me = guild.members.me ?? guild.members.cache.get(client.user.id);

                const channel = guild.channels.cache.find(c =>
                    c.isTextBased() &&
                    c.permissionsFor(me)?.has([
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.CreateInstantInvite
                    ])
                );

                if (!channel) {
                    return i.reply({
                        content: '<:739666scribblecross:1510971355359744031> I cannot create an invite for this server.',
                        flags: MessageFlags.Ephemeral
                    });
                }

                try {
                    const invite = await channel.createInvite({
                        maxAge: 86400,
                        maxUses: 0,
                        unique: true
                    });

                    await i.user.send({
                        embeds: [
                            new EmbedBuilder()
                                .setColor('#000000')
                                .setTitle(`<:50738globe:1510971657882304522> ${guild.name}`)
                                .setDescription(
                                    `<:172874link:1510971054175031356> Invite Link:\n${invite.url}`
                                )
                                .setThumbnail(guild.iconURL({ dynamic: true }))
                        ]
                    });

                    return i.reply({
                        content: '<a:138056check:1510971269393289257> Invite sent to your DMs.',
                        flags: MessageFlags.Ephemeral
                    });

                } catch (err) {
                    if (err.code === 50007) {
                        return i.reply({
                            content: '<:739666scribblecross:1510971355359744031> I couldn\'t DM you. Please enable DMs and try again.',
                            flags: MessageFlags.Ephemeral
                        });
                    }
                    return i.reply({
                        content: '<:739666scribblecross:1510971355359744031> Failed to create invite.',
                        flags: MessageFlags.Ephemeral
                    });
                }
            }
        });

        collector.on('end', async () => {
            msg.edit({
                components: [await buildServerHopContainer(guilds[page], true)],
                flags: MessageFlags.IsComponentsV2
            }).catch(() => {});
        });
    }
    if (interaction.isCommand() && interaction.commandName === 'use') {
        const userId = interaction.user.id;
        const item = interaction.options.getString('item');
        let userItem = store.getItems(userId);
        let reputationGain = 0;
        if (item === 'marijuana') {
            if (userItem.marijuana && userItem.marijuana.quantity > 0) {
                userItem.marijuana.quantity--;

                reputationGain = Math.floor(Math.random() * 250) + 100;
                store.setItems(userId, userItem);
                const auraBefore = store.getAura(userId) || 0;
                store.addAura(userId, reputationGain);

                await interaction.reply({
                    content: `<:High_On_Weed_Inv63:1491127897845665863> You used <a:bong_hit:1491127699018612937> **Weed** and gained **+${reputationGain} <a:flame:1491148060217180282> Aura**.`
                });
                return;
            } else {
                return interaction.reply({
                    content: `-# You don't have any **Weed** to use.`,
                    flags: MessageFlags.Ephemeral
                });
            }
        }
        else if (item === 'cocaine') {
            if (userItem.cocaine && userItem.cocaine.quantity > 0) {
                userItem.cocaine.quantity--;

                reputationGain = Math.floor(Math.random() * 500) + 250;
                store.setItems(userId, userItem);
                const auraBefore = store.getAura(userId) || 0;
                store.addAura(userId, reputationGain);

                await interaction.reply({
                    content: `<:stoner44:1491125634045444106> You used <a:snort_cocaine:1491127551580438528> **Coke** and gained **+${reputationGain} <a:flame:1491148060217180282> Aura**.`
                });
                return;
            } else {
                return interaction.reply({
                    content: `-# You don't have any **Coke** to use.`,
                    flags: MessageFlags.Ephemeral
                });
            }
        }
        else if (item === 'gift') {
            let userItem = store.getItems(userId);
            const gifts = userItem.gift?.quantity || 0;
            if (gifts <= 0) {
                return interaction.reply({
                    content: `-# You don't have any <:gift:1502999386467336312> Gift.`,
                    flags: MessageFlags.Ephemeral
                });
            }
            userItem.gift.quantity--;
            if (userItem.gift.quantity <= 0) {
                delete userItem.gift;

            }
            store.setItems(userId, userItem);

            await interaction.reply({
                content: `<a:shaking_gift_box:1503669069474300036> *Opening your Gift...*`
            });
            setTimeout(async () => {
                                userItem = store.getItems(userId);

                const roll = Math.random() * 100;

                let rewardMessage = '';

                if (roll < 35) {

                    const coinsReward =
                        Math.floor(Math.random() * (10000 - 6000 + 1)) + 6000;

                    store.addCoins(userId, coinsReward);

                    rewardMessage =
                        `<:acoin:1508147096631513188> **${coinsReward.toLocaleString()} Coins**`;

                }

                else if (roll < 60) {

                    const weedReward =
                        Math.floor(Math.random() * (6 - 2 + 1)) + 2;

                    if (!userItem.marijuana)
                        userItem.marijuana = { quantity: 0 };

                    userItem.marijuana.quantity += weedReward;

                    rewardMessage =
                        `<:jointtttt:1514466300485832894> **${weedReward}g Weed**`;

                }

                else if (roll < 76) {

                    const cocaineReward =
                        Math.floor(Math.random() * (3 - 2 + 1)) + 2;

                    if (!userItem.cocaine)
                        userItem.cocaine = { quantity: 0 };

                    userItem.cocaine.quantity += cocaineReward;

                    rewardMessage =
                        `<:cocaine:1491119792910897272> **${cocaineReward}g Coke**`;

                }

                else if (roll < 79) {

                                        const tokenReward = Math.floor(Math.random() * 3) + 1;
                    store.addTokens(userId, tokenReward);

                    rewardMessage =
                        `<:470609wishpiece:1513187268506943538> **${tokenReward} Token${tokenReward > 1 ? 's' : ''}**`;

                }

                else if (roll < 79.5) {

                                        userItem.owl = (userItem.owl || 0) + 1;

                    rewardMessage =
                        `<a:aaowl:1506537098449125520> **Owl Pet**`;

                }

                else if (roll < 79.8) {

                                        userItem.rat = (userItem.rat || 0) + 1;

                    rewardMessage =
                        `<a:rat:1506514518937698435> **Rat Pet**`;

                }

                else if (roll < 79.9) {

                                        userItem.raccoon = (userItem.raccoon || 0) + 1;

                    rewardMessage =
                        `<a:raccoon:1512103318921679058> **Raccoon Pet**`;

                }

                else {

                    const coinsReward =
                        Math.floor(Math.random() * (8000 - 5000 + 1)) + 5000;

                    store.addCoins(userId, coinsReward);

                    rewardMessage =
                        `<:acoin:1508147096631513188> **${coinsReward.toLocaleString()} Bonus Coins**`;

                }

                                store.setItems(userId, userItem);

                await interaction.editReply({
                    content:
                        `<:gift:1502999386467336312> **Gift Opened!**\n` +
                        `-# You got ${rewardMessage}`
                });

            }, 4000);

            return;
        }
        else {
            return interaction.reply({
                content: `-# You need to specify an item. Example: **/use marijuana**, **/use weed** (or **/use coke**, or **/use gift**.`,
                flags: MessageFlags.Ephemeral
            });
        }
    }
    if (interaction.commandName === 'divorce') {
        const userId = interaction.user.id;
        if (!store.isMarried(userId)) {
            return interaction.reply({
                content: '-# You don\'t have a partner.',
                flags: MessageFlags.Ephemeral
            });
        }
        const partnerId = store.clearMarriage(userId);
        {
            let userItem = store.getItems(userId);
            if (userItem?.ring) {
                delete userItem.ring;
                store.setItems(userId, userItem);
            }
        }

        return interaction.reply(
            `<a:brokenheart:1502993288813215824> <@${userId}> divorced <@${partnerId}>.`
        );
    }
    if (interaction.isCommand() && interaction.commandName === 'marry') {
        const proposerId = interaction.user.id;
        const target = interaction.options.getUser('user');

        if (target.id === proposerId) {
            return interaction.reply({
                content: '-# You can\'t marry yourself.',
                flags: MessageFlags.Ephemeral
            });
        }
        if (store.isMarried(proposerId) || store.isMarried(target.id)) {
            return interaction.reply({
                content: '-# One of you is already married.',
                flags: MessageFlags.Ephemeral
            });
        }
        {
            const _pi = store.getItems(proposerId);
            if (!_pi?.ring || _pi.ring.quantity < 1) {
                return interaction.reply({
                    content: '-# You need a <:ring:1502977846488989808> Ring to propose.',
                    flags: MessageFlags.Ephemeral
                });
            }
        }
        if (pendingMarriages[proposerId]) {
            return interaction.reply({
                content: '-# You still have a pending proposal. Please wait.',
                flags: MessageFlags.Ephemeral
            });
        }
        pendingMarriages[proposerId] = Date.now() + 10 * 60 * 1000;
        setTimeout(() => {
            delete pendingMarriages[proposerId];
        }, 10 * 60 * 1000);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`accept_marry_${proposerId}_${target.id}`)
                .setLabel('Accept')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`decline_marry_${proposerId}_${target.id}`)
                .setLabel('Decline')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`cancel_marry_${proposerId}_${target.id}`)
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );
        return interaction.reply({
            content: `<:ring:1502977846488989808> <@${proposerId}> proposed to <@${target.id}>!`,
            components: [row]
        });
    }
    if (interaction.isCommand() && interaction.commandName === 'profile') {
        const target = interaction.options.getUser('user') || interaction.user;
        const userId = target.id;
        const items = store.getItems(userId);
        const coins = store.getCoins(userId) || 0;
        const aura = store.getAura(userId) || 0;
        const tokens = store.getTokens(userId) || 0;
        const cocaine = items?.cocaine?.quantity || 0;
        const marijuana = items?.marijuana?.quantity || 0;
        const marlboro = items?.marlboro?.quantity || 0;
        const gift = items?.gift?.quantity || 0;
        function shortNum(n) {
            if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M+`;
            if (n >= 1_000) return `${Math.floor(n / 1_000)}K+`;
            return n.toLocaleString();
        }

        const petList = [
            { key: 'kitsune',  emoji: '<a:Kitsune:1499843448834887750>',      name: 'Kitsune'  },
            { key: 'dog',      emoji: '<a:dog:1496797720432742421>',           name: 'Dog'      },
            { key: 'cat',      emoji: '<a:cat:1496798083823046696>',           name: 'Cat'      },
            { key: 'hamster',  emoji: '<a:hmster:1506538001088643153>',        name: 'Hamster'  },
            { key: 'fox',      emoji: '<a:fox:1498290944330694717>',           name: 'Fox'      },
            { key: 'crow',     emoji: '<a:crow:1498865634778288148>',          name: 'Crow'     },
            { key: 'owl',      emoji: '<a:aaowl:1506537098449125520>',         name: 'Owl'      },
            { key: 'rabbit',   emoji: '<a:arrabit:1506535349910900777>',       name: 'Rabbit'   },
            { key: 'rat',      emoji: '<a:rat:1506514518937698435>',           name: 'Rat'      },
            { key: 'raccoon',  emoji: '<a:raccoon:1512103318921679058>',       name: 'Raccoon'  },
            { key: 'octopus',  emoji: '<a:1370e260783e5050d1bc0fcf92c0fb14:1515543312776302603>', name: 'Octopus' },
            { key: 'chicken',  emoji: '<a:chicken:1491117598417490032>',       name: 'Chicken'  },
            { key: 'monkey',  emoji: '<a:Monkey:1514250117677584435>',       name: 'Monkey'  },
        ];

        const ownedPets = petList.filter(p => items?.[p.key]);
        const auraRole = getRoleForAura(aura);
        const avatarURL = target.displayAvatarURL({ size: 256 });

                const container = new ContainerBuilder().setAccentColor(0x5A5A5C);
                function getAuraBadge(a) {
            if (a >= 100_000) return `<a:bong_hit:1491127699018612937> Hustler`;
            if (a >= 50_000)  return `<:ak47:1491119777635106887> Shottas`;
            if (a >= 10_000)  return `<a:467813smoking:1491124330049048696> Chainsmoker`;
            if (a >= 1_000)   return `<a:cig:1491124938554343575> Smoker`;
            return `<a:64000stitchpats:1491131081552953486> Clean`;
        }
        function getCoinBadge(c) {
            if (c >= 1_000_000) return `<:HighClass:1513862929542418602> High Class Citizen`;
            if (c >= 500_000)   return `<:MidClass:1513862734427459654> Mid Class Citizen`;
            if (c >= 100_000)   return `<:LowClass:1513862509671743579> Low Class Citizen`;
            return `<:Broke:1513862288531259502> Broke`;
        }
                const partnerId = store.getPartner(userId);
        let partnerName = null;
        if (partnerId) {
            try {
                const partnerUser = await client.users.fetch(partnerId);
                partnerName = partnerUser.username;
            } catch {}
        }

                const headerSection = new SectionBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`### *${target.username}'s Profile*`),
                new TextDisplayBuilder().setContent(
                    `-# **${getAuraBadge(aura)}**\n-# **${getCoinBadge(coins)}**` +
                    (partnerName ? `\n-# <:ring:1502977846488989808> **${partnerName}**` : '') +
                    (items?.mask?.acquiredDate
                        ? `\n-# <:mask:1491119765027029124> **Longba user since** <t:${Math.floor(new Date(items.mask.acquiredDate).getTime() / 1000)}:D>`
                        : '')
                )
            )
            .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: avatarURL } }));
        container.addSectionComponents(headerSection);
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

                container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# **Resources**`)
        );
        const statsRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('profile_coins')
                .setEmoji('<:acoin:1508147096631513188>')
                .setLabel(`${shortNum(coins)}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId('profile_aura')
                .setEmoji('<a:flame:1491148060217180282>')
                .setLabel(`${shortNum(aura)}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId('profile_tokens')
                .setEmoji('<:470609wishpiece:1513187268506943538>')
                .setLabel(`${shortNum(tokens)}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
        );
        container.addActionRowComponents(statsRow);

        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

                container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `-# **Pets** (${ownedPets.length})\n` +
                (ownedPets.length > 0
                    ? ownedPets.map(p => `${p.emoji}`).join('  ')
                    : `-# No pets yet.`)
            )
        );

        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

                const bagItems = [
            { emoji: '<:cocaine:1491119792910897272>',   label: `${cocaine}g`,    qty: cocaine   },
            { emoji: '<:jointtttt:1514466300485832894>',    label: `${marijuana}g`, qty: marijuana },
            { emoji: '<:cigg:1514467639400071328>', label: `${marlboro}`,    qty: marlboro  },
            { emoji: '<:gift:1502999386467336312>',      label: `${gift}`,            qty: gift      },
        ].filter(b => b.qty > 0);

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `-# **Bag**\n` +
                (bagItems.length > 0
                    ? bagItems.map(b => `${b.emoji} **${b.label}**`).join('  ')
                    : `-# Empty.`)
            )
        );

        await interaction.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] }
        });
    }
    if (interaction.isCommand() && interaction.commandName === 'pet') {
        const userId = interaction.user.id;
        const petType = interaction.options.getString('type');
        let userItem = store.getItems(userId);

        if (!userItem[petType]) {
            return interaction.reply({
                content: `-# You don't have a **${petType}**.`,
                flags: MessageFlags.Ephemeral
            });
        }
        const now = Date.now();
        const cooldownTime = 60 * 60 * 1000;
        const _petCdExpires = store.getCooldown(userId, `pet:${petType}`);
        if (now < _petCdExpires) {
            const remaining = _petCdExpires - now;
            const timeLeft = formatCooldown(remaining);
            return interaction.reply({
                content: `-# <:flork_hmmm31:1491903354786545714> *Your **${petType}** is still resting...* Come back in **${timeLeft}**.`,
                flags: MessageFlags.Ephemeral
            });
        }
        if (petType === 'raccoon') {
            const target = interaction.options.getUser('target');
            const now = Date.now();
            const cooldownTime = 60 * 60 * 1000;

            const _raccoonCd = store.getCooldown(userId, 'pet:raccoon');
            if (now < _raccoonCd) {
                const remaining = _raccoonCd - now;
                const timeLeft = formatCooldown(remaining);
                return interaction.reply({
                    content: `-# <a:raccoon:1512103318921679058> *Your Raccoon is laying low after the raid...* Come back in **${timeLeft}**.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            if (!target) {
                return interaction.reply({
                    content: '-# Please select a target user.',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (target.id === userId) {
                return interaction.reply({
                    content: '-# You can\'t use **raccoon** on yourself.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const targetItems = store.getItems(target.id);

            if (targetItems.agimat && targetItems.agimat.expiresAt > Date.now()) {
                return interaction.reply({
                    content: `-# <a:raccoon:1512103318921679058> <@${target.id}> has an active **Agimat**! Your raccoon got scared off.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const targetCoins = store.getCoins(target.id) || 0;
            const stolenCoins = Math.floor(targetCoins * 0.25);
            const stolenCocaine = Math.max(0, Math.floor((targetItems.cocaine?.quantity || 0) * 0.15));
            const stolenWeed = Math.max(0, Math.floor((targetItems.marijuana?.quantity || 0) * 0.15));

            if (stolenCoins <= 0 && stolenCocaine <= 0 && stolenWeed <= 0) {
                return interaction.reply({
                    content: `-# <a:raccoon:1512103318921679058> <@${target.id}> has nothing to steal!`,
                    flags: MessageFlags.Ephemeral
                });
            }

                        if (stolenCoins > 0) {
                store.addCoins(target.id, -stolenCoins);
                store.addCoins(userId, stolenCoins);
            }
            if (stolenCocaine > 0) {
                targetItems.cocaine.quantity -= stolenCocaine;
                if (targetItems.cocaine.quantity <= 0) delete targetItems.cocaine;
                if (!userItem.cocaine) userItem.cocaine = { quantity: 0 };
                userItem.cocaine.quantity += stolenCocaine;
            }
            if (stolenWeed > 0) {
                targetItems.marijuana.quantity -= stolenWeed;
                if (targetItems.marijuana.quantity <= 0) delete targetItems.marijuana;
                if (!userItem.marijuana) userItem.marijuana = { quantity: 0 };
                userItem.marijuana.quantity += stolenWeed;
            }

            store.setItems(userId, userItem);
            store.setItems(target.id, targetItems);
            store.setCooldown(userId, 'pet:raccoon', now + cooldownTime);
            store.setCooldown(userId, 'pet:lastUsed', 0); userItem.lastUsedPet = 'raccoon'; store.setItems(userId, userItem);

            await interaction.reply({
                content:
                    `<a:raccoon:1512103318921679058> Your **Raccoon** raided <@${target.id}>!\n` +
                    `-# <:acoin:1508147096631513188> Coins stolen: **${stolenCoins.toLocaleString()}**\n` +
                    `-# <:cocaine:1491119792910897272> Coke stolen: **${stolenCocaine}g**\n` +
                    `-# <:jointtttt:1514466300485832894> Weed stolen: **${stolenWeed}g**`
            });

            try {
                const targetUser = await client.users.fetch(target.id);
                await targetUser.send(
                    `<a:raccoon:1512103318921679058> A **Raccoon** raided you!\n` +
                    `-# <:acoin:1508147096631513188> Coins stolen: **${stolenCoins.toLocaleString()}**\n` +
                    `-# <:cocaine:1491119792910897272> Coke stolen: **${stolenCocaine}g**\n` +
                    `-# <:jointtttt:1514466300485832894> Weed stolen: **${stolenWeed}g**`
                ).catch(() => {});
            } catch {
                            }
            return;
        }
        if (petType === 'rat') {
            const target = interaction.options.getUser('target');
            const now = Date.now();
            const cooldownTime = 2 * 60 * 60 * 1000;

            const _ratCd = store.getCooldown(userId, 'pet:rat');
            if (now < _ratCd) {
                const remaining = _ratCd - now;
                const timeLeft = formatCooldown(remaining);
                return interaction.reply({
                    content: `-# <a:rat:1506514518937698435> *The rat is hiding in the shadows, recovering...* Come back in **${timeLeft}**.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            if (!target) {
                return interaction.reply({
                    content: '-# Please select a target user first.',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (target.id === userId) {
                return interaction.reply({
                    content: '-# You can\'t use **rat** on yourself.',
                    flags: MessageFlags.Ephemeral
                });
            }

            let targetItems = store.getItems(target.id);

            if (!targetItems.agimat || !targetItems.agimat.expiresAt) {
                return interaction.reply({
                    content: `-# <a:rat:1506514518937698435> <@${target.id}> does not have an active Agimat.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            if (Date.now() > targetItems.agimat.expiresAt) {
                return interaction.reply({
                    content: `-# <a:rat:1506514518937698435> <@${target.id}>'s Agimat has expired.`,
                    flags: MessageFlags.Ephemeral
                });
            }
            const roll = Math.random();
            let removedMs;
            let displayText;
            if (roll < 0.35) {
                                const remaining = targetItems.agimat.expiresAt - Date.now();
                removedMs = Math.floor(remaining * 0.15);
                const removedMins = Math.floor(removedMs / (1000 * 60));
                const dispHours = Math.floor(removedMins / 60);
                const dispMins = removedMins % 60;
                displayText = dispHours > 0
                    ? `**${dispHours}h ${dispMins}m**`
                    : `**${dispMins}m**`;
            } else {
                                const removedHours = Math.floor(Math.random() * 3) + 1;
                removedMs = removedHours * 60 * 60 * 1000;
                displayText = `**${removedHours}h**`;
            }
            targetItems.agimat.expiresAt -= removedMs;
            if (targetItems.agimat.expiresAt < Date.now()) {
                targetItems.agimat.expiresAt = Date.now();
            }
            store.setCooldown(userId, 'pet:rat', now + cooldownTime);
            userItem.lastUsedPet = 'rat'; store.setItems(userId, userItem);
            store.setItems(target.id, targetItems);
            await interaction.reply({
                content:
                    `<a:rat:1506514518937698435> **Rat** *weakened <@${target.id}>'s Agimat!*\n` +
                    `-# <:agimat:1491119820358553600> Reduced Agimat duration by ${displayText}`
            });
            try {
                const targetUser = await client.users.fetch(target.id);
                await targetUser.send({
                    content:
                        `<a:rat:1506514518937698435> A **rat** targeted your Agimat.\n` +
                        `-# <:agimat:1491119820358553600> Duration reduced by ${displayText}`
                });
            } catch (err) {
                console.log(`Couldn't DM ${target.id}`);
            }
            return;
        }
        if (petType === 'rabbit') {
            const userData = store.getItems(userId);

            if (!userData.agimat || !userData.agimat.expiresAt) {
                return interaction.reply({
                    content: '-# <a:arrabit:1506535349910900777> You don\'t have an active **Agimat** to extend.',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (Date.now() > userData.agimat.expiresAt) {
                return interaction.reply({
                    content: '-# <a:arrabit:1506535349910900777> Your Agimat has expired. Please buy a new one first.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const now = Date.now();
            const cooldownTime = 2 * 60 * 60 * 1000;
            const _rabbitCd = store.getCooldown(userId, 'pet:rabbit');
            if (now < _rabbitCd) {
                const remaining = _rabbitCd - now;
                const timeLeft = formatCooldown(remaining);
                return interaction.reply({
                    content: `-# <a:arrabit:1506535349910900777> *The Rabbit is still catching its breath...* Come back in **${timeLeft}**.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const addedHours = Math.floor(Math.random() * 3) + 1;             const addedMs = addedHours * 60 * 60 * 1000;

            userData.agimat.expiresAt += addedMs;

            store.setCooldown(userId, 'pet:rabbit', now + cooldownTime);
            userItem.lastUsedPet = 'rabbit'; store.setItems(userId, userItem);
            store.setItems(userId, userData);

            return interaction.reply({
                content:
                    `<a:arrabit:1506535349910900777> **Rabbit** *boosted your Agimat.*\n` +
                    `-# <:agimat:1491119820358553600> Duration extended by **${addedHours} hour${addedHours > 1 ? 's' : ''}**`
            });
        }
        if (petType === 'dog') {

            if (!userItem.agimat || !userItem.agimat.expiresAt) {
                return interaction.reply({
                    content: `-# <a:dog:1496797720432742421> You don\'t have an active **Agimat** right now.`,
                    flags: MessageFlags.Ephemeral
                });
            }
            const expiresAt = userItem.agimat.expiresAt;
            const remaining = expiresAt - Date.now();
            if (remaining <= 0) {
                return interaction.reply({
                    content: `-# <a:dog:1496797720432742421> Your Agimat has expired! Buy a new one from the shop. </shop:1491118301277847760>`,
                    flags: MessageFlags.Ephemeral
                });
            }
            const minutes = Math.floor(remaining / 1000 / 60);
            const hours = Math.floor(minutes / 60);
            const mins = minutes % 60;
            return interaction.reply({
                content:
                    `<a:dog:1496797720432742421> Your **Dog** checked your Agimat.\n` +
                    `-# <:agimat:1491119820358553600> Agimat expires in **${hours}h ${mins}m**.`,
                flags: MessageFlags.Ephemeral
            });
        }
        if (petType === 'owl') {
            const target = interaction.options.getUser('target');
            const now = Date.now();
            const cooldownTime = 3 * 60 * 60 * 1000;
            const _owlCd = store.getCooldown(userId, 'pet:owl');
            if (now < _owlCd) {
                const remaining = _owlCd - now;
                const timeLeft = formatCooldown(remaining);
                return interaction.reply({
                    content: `-# <a:aaowl:1506537098449125520> *The Owl is resting its eyes after the last inspection...* Try again in **${timeLeft}**.`,
                    flags: MessageFlags.Ephemeral
                });
            }
            if (!target) {
                return interaction.reply({
                    content: '-# Please select a target user first.',
                    flags: MessageFlags.Ephemeral
                });
            }
            if (target.id === userId) {
                return interaction.reply({
                    content: '-# You can\'t inspect yourself.',
                    flags: MessageFlags.Ephemeral
                });
            }
            let targetItems = store.getItems(target.id);
            store.setCooldown(userId, 'pet:owl', now + cooldownTime);
            userItem.lastUsedPet = 'owl'; store.setItems(userId, userItem);
            const success = Math.random() < 0.70;
            if (!success) {
                return interaction.reply({
                    content: `-# <a:aaowl:1506537098449125520> Your Owl failed to inspect <@${target.id}> Try again next time.`,
                    flags: MessageFlags.Ephemeral
                });
            }
            if (!targetItems.agimat || !targetItems.agimat.expiresAt) {
                return interaction.reply({
                    content: `-# <a:aaowl:1506537098449125520> <@${target.id}> has no active Agimat.`,
                    flags: MessageFlags.Ephemeral
                });
            }
            const expiresAt = targetItems.agimat.expiresAt;
            if (Date.now() > expiresAt) {
                return interaction.reply({
                    content: `-# <a:aaowl:1506537098449125520> <@${target.id}>'s Agimat already expired.`,
                    flags: MessageFlags.Ephemeral
                });
            }
            const remainingMs = expiresAt - Date.now();
            const totalMinutes = Math.floor(remainingMs / 60000);
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            try {
                await target.send(
                    `<a:aaowl:1506537098449125520> | Someone discovered when your <:agimat:1491119820358553600> **Agimat** expires.`
                );
            } catch (err) {
                console.log(`Couldn't DM ${target.id}`);
            }
            return interaction.reply({
                content:
                    `<a:aaowl:1506537098449125520> Owl inspected <@${target.id}>.\n-# ` +
                    `<:agimat:1491119820358553600> Agimat expires in **${hours}h ${minutes}m**`,
                flags: MessageFlags.Ephemeral
            });
        }
        if (petType === 'kitsune') {
            const target = interaction.options.getUser('target') || interaction.user;
            const now = Date.now();
            const cooldownTime = 30 * 60 * 1000;
            const _kitsuneCd = store.getCooldown(userId, 'pet:kitsune');
            if (now < _kitsuneCd) {
                const remaining = _kitsuneCd - now;
                const timeLeft = formatCooldown(remaining);
                return interaction.reply({
                    content: `-# <a:Kitsune:1499843448834887750> *The Kitsune is meditating to restore her power...* Try again in **${timeLeft}**.`,
                    flags: MessageFlags.Ephemeral
                });
            }
            const auraGain = Math.floor(Math.random() * (2000 - 1000 + 1)) + 1000;
            store.addAura(target.id, auraGain);
            store.setCooldown(userId, 'pet:kitsune', now + cooldownTime);
            userItem.lastUsedPet = 'kitsune'; store.setItems(userId, userItem);

            return interaction.reply({
                content:
                    `<a:Kitsune:1499843448834887750> **Kitsune** granted **+${auraGain} <a:flame:1491148060217180282> Aura** to <@${target.id}>!`
            });
        }
        if (petType === 'crow') {
            const _crowCd = store.getCooldown(userId, 'pet:crow');
            if (now < _crowCd) {
                const remaining = _crowCd - now;
                const timeLeft = formatCooldown(remaining);
                return interaction.reply({
                    content: `-# <a:crow:1498865634778288148> *The Crow is perched on a branch, preening its feathers after the last heist...* Come back in **${timeLeft}**.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            await interaction.deferReply();

            try {
                const guildMembers = await getCachedMembers(interaction.guild);

                const validTargets = Object.entries(store.getAllItemsMap()).filter(([id, items]) => {
                    if (id === userId) return false;
                    if (!guildMembers.has(id)) return false;
                    if (items.agimat && items.agimat.expiresAt > Date.now()) return false;

                    return (
                        (items.cocaine?.quantity || 0) > 0 ||
                        (items.marijuana?.quantity || 0) > 0
                    );
                });

                if (validTargets.length === 0) {
                    return interaction.reply({
                        content: '-# There is no valid target with items to steal from.',
                        flags: MessageFlags.Ephemeral

                    });
                }

                const [targetId, targetItems] = validTargets.sort((a, b) => {
                    const totalA =
                        (a[1].cocaine?.quantity || 0) +
                        (a[1].marijuana?.quantity || 0);

                    const totalB =
                        (b[1].cocaine?.quantity || 0) +
                        (b[1].marijuana?.quantity || 0);

                    return totalB - totalA;
                })[0];

                let stolenCocaine = 0;
                let stolenWeed = 0;

                                if ((targetItems.cocaine?.quantity || 0) > 0) {
                    stolenCocaine = Math.max(
                        1,
                        Math.floor(targetItems.cocaine.quantity * 0.10)
                    );

                    targetItems.cocaine.quantity -= stolenCocaine;

                    if (targetItems.cocaine.quantity <= 0) {
                        delete targetItems.cocaine;
                    }

                    if (!userItem.cocaine) {
                        userItem.cocaine = { quantity: 0 };
                    }

                    userItem.cocaine.quantity += stolenCocaine;
                }

                                if ((targetItems.marijuana?.quantity || 0) > 0) {
                    stolenWeed = Math.max(
                        1,
                        Math.floor(targetItems.marijuana.quantity * 0.10)
                    );

                    targetItems.marijuana.quantity -= stolenWeed;

                    if (targetItems.marijuana.quantity <= 0) {
                        delete targetItems.marijuana;
                    }

                    if (!userItem.marijuana) {
                        userItem.marijuana = { quantity: 0 };
                    }

                    userItem.marijuana.quantity += stolenWeed;
                }

                store.setCooldown(userId, `pet:${petType}`, now + cooldownTime);
                userItem.lastUsedPet = petType;
                store.setItems(userId, userItem);
                store.setItems(targetId, targetItems);

                await interaction.editReply({
                    content:
                        `<a:crow:1498865634778288148> Your **Crow** stole from <@${targetId}>!\n` +
                        `-# <:cocaine:1491119792910897272> Coke stolen: **${stolenCocaine}g**\n` +
                        `-# <:jointtttt:1514466300485832894> Weed stolen: **${stolenWeed}g**`
                });

                client.users.fetch(targetId)
                    .then(user =>
                        user.send(
                            `<a:crow:1498865634778288148> You got robbed by a **Crow**!\n` +
                            `-# <:cocaine:1491119792910897272> Coke stolen: **${stolenCocaine}g**\n` +
                            `-# <:jointtttt:1514466300485832894> Weed stolen: **${stolenWeed}g**`
                        ).catch(() => {})
                    );
            } catch (err) {
                console.error(err);
                return interaction.deferReply({
                    content: '<a:crow:1498865634778288148> *Your crow went on a heist but got chased off!*\n-# Try again in a moment.',
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        if (petType === 'fox') {
            const _foxCd = store.getCooldown(userId, 'pet:fox');
            if (now < _foxCd) {
                const remaining = _foxCd - now;
                const timeLeft = formatCooldown(remaining);
                return interaction.reply({
                    content: `-# <a:fox:1498290944330694717> *The Fox slipped back into its den after the last steal, still catching its breath...* Come back in **${timeLeft}**.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            await interaction.deferReply();

            try {
                const guildMembers = await getCachedMembers(interaction.guild);

                const validTargets = Object.entries(store.getAllCoinsMap()).filter(([id]) => {
                    if (id === userId) return false;
                    if (!guildMembers.has(id)) return false;

                    const targetItems = store.getItems(id);

                    if (
                        targetItems.agimat &&
                        targetItems.agimat.expiresAt > Date.now()
                    ) {
                        return false;
                    }

                    return true;
                });

                if (validTargets.length === 0) {
                    return interaction.reply({
                        content: '-# There is no valid target available to steal from right now.',
                        flags: MessageFlags.Ephemeral
                    });
                }

                const [targetId, targetCoins] = validTargets.sort(
                    ([, a], [, b]) => b - a
                )[0];

                const stealAmount = Math.floor(targetCoins * 0.10);

                if (stealAmount <= 0) {
                    return interaction.editReply({
                        content: '-# There are no Coins to collect.'
                    });
                }
                store.addCoins(targetId, -stealAmount);
                store.addCoins(userId, stealAmount);
                store.setCooldown(userId, `pet:${petType}`, now + cooldownTime);
                return interaction.editReply({
                    content:
                        `<a:fox:1498290944330694717> Your **Fox** stole ` +
                        `**${stealAmount.toLocaleString()} <:acoin:1508147096631513188>** ` +
                        `from <@${targetId}>`
                });
            } catch (err) {
                console.error(err);
                return interaction.deferReply({
                    content: '<a:fox:1498290944330694717> *Your fox got scared and ran back to its den...*\n-# Try again in a moment.',
                    flags: MessageFlags.Ephemeral
                });
            }
        }
        if (petType === 'octopus') {
            const _octopusCd = store.getCooldown(userId, 'pet:octopus');
            if (now < _octopusCd) {
                const remaining = _octopusCd - now;
                const timeLeft = formatCooldown(remaining);
                return interaction.reply({
                    content: `-# <a:1370e260783e5050d1bc0fcf92c0fb14:1515543312776302603> Your **Octopus** is still tired from the last reset. Come back in **${timeLeft}**.`,
                    flags: MessageFlags.Ephemeral
                });
            }
            const lastPet = userItem.lastUsedPet;
            if (!lastPet) {
                return interaction.reply({
                    content: `-# <a:1370e260783e5050d1bc0fcf92c0fb14:1515543312776302603> Your **Octopus** has nothing to reset yet — use another pet first!`,
                    flags: MessageFlags.Ephemeral
                });
            }
            const currentCd = store.getCooldown(userId, `pet:${lastPet}`);
            if (currentCd <= Date.now()) {
                return interaction.reply({
                    content: `-# <a:1370e260783e5050d1bc0fcf92c0fb14:1515543312776302603> Your **${lastPet}** cooldown is already up — no need to reset!`,
                    flags: MessageFlags.Ephemeral
                });
            }
            store.setCooldown(userId, `pet:${lastPet}`, 0);
            store.setCooldown(userId, 'pet:octopus', now + 60 * 60 * 1000);
            userItem.lastUsedPet = null;
            store.setItems(userId, userItem);
            return interaction.reply({
                content: `<a:1370e260783e5050d1bc0fcf92c0fb14:1515543312776302603> **Octopus** reset the cooldown of your **${lastPet}**! It's ready to use again.`
            });
        }
        const auraGain = Math.floor(Math.random() * (1000 - 500 + 1)) + 500;
        store.addAura(userId, auraGain);
        store.setCooldown(userId, `pet:${petType}`, now + cooldownTime);
        userItem.lastUsedPet = petType;
        store.setItems(userId, userItem);
        const petEmoji = {
            cat: '<a:cat:1496798083823046696>',
            hamster: '<a:hmster:1506538001088643153>',
            monkey: '<a:Monkey:1514250117677584435>'
        };
        await interaction.reply({
            content: `${petEmoji[petType]} Your **${petType}** gave you **+${auraGain} <a:flame:1491148060217180282> Aura**!\n-# next collect in 1 hour`
        });
    }
    if (interaction.commandName === 'blackjack') {
        const userId = interaction.user.id;
        const bet = interaction.options.getInteger('bet');

        if (activeBJGames.has(userId)) {
            return interaction.reply({
                content: '-# <:flork_hmmm31:1491903354786545714> You already have an active Blackjack game!',
                flags: MessageFlags.Ephemeral
            });
        }

        const userCoins = store.getCoins(userId);
        if (userCoins < bet) {
            return interaction.reply({
                content: `-# You need **${bet.toLocaleString()} <:acoin:1508147096631513188>** to play. You only have **${userCoins.toLocaleString()}**.`,
                flags: MessageFlags.Ephemeral
            });
        }

        store.addCoins(userId, -bet);
        const deck = bjCreateDeck();
        const playerHand = [deck.pop(), deck.pop()];
        const dealerHand = [deck.pop(), deck.pop()];
        const game = { userId, bet, deck, playerHand, dealerHand };

                if (bjCalcHand(playerHand) === 21) {
            const payout = Math.floor(bet * 1.5);
            store.addCoins(userId, bet + payout);
            return interaction.reply({
                components: [bjBuildContainer(game, 'blackjack')],
                flags: MessageFlags.IsComponentsV2
            });
        }

        let msg;
        try {
            await interaction.reply({
                components: [bjBuildContainer(game)],
                flags: MessageFlags.IsComponentsV2
            });

            msg = await interaction.fetchReply();
        } catch (err) {
            store.addCoins(userId, bet);
            console.error('[Blackjack] Setup error:', err);
            throw err;
        }

        attachBlackjackCollector(msg, game, interaction.channel, deps);

        return;
    }
    if (interaction.commandName === 'mines') {
        const userId = interaction.user.id;
        const bet = interaction.options.getInteger('bet');
        const mineCount = interaction.options.getInteger('bombs');

        if (activeMinesGames.has(userId)) {
            return interaction.reply({
                content: '-# <:flork_hmmm31:1491903354786545714> You already have an active Mines game!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (mineCount < 1 || mineCount > MINES_GRID_SIZE - 1) {
            return interaction.reply({
                content: `-# Bombs must be between **1** and **${MINES_GRID_SIZE - 1}**.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const userCoins = store.getCoins(userId);
        if (userCoins < bet) {
            return interaction.reply({
                content: `-# You need **${bet.toLocaleString()} <:acoin:1508147096631513188>** to play. You only have **${userCoins.toLocaleString()}**.`,
                flags: MessageFlags.Ephemeral
            });
        }

        store.addCoins(userId, -bet);
        const game = {
            userId,
            bet,
            mineCount,
            mines: minesGenerateMines(mineCount),
            revealed: new Set()
        };

        let msg;
        try {
            await interaction.reply({
                components: [minesBuildContainer(game)],
                flags: MessageFlags.IsComponentsV2
            });
            msg = await interaction.fetchReply();
        } catch (err) {
            store.addCoins(userId, bet);
            console.error('[Mines] Setup error:', err);
            throw err;
        }

        attachMinesCollector(msg, game, interaction.channel, deps);

        return;
    }
    if (interaction.commandName === "baccarat") {
                if (interaction.guild) {
            const botMember = interaction.guild.members.me;
            const channel = interaction.channel;
            if (botMember && channel && !channel.permissionsFor(botMember).has(PermissionsBitField.Flags.EmbedLinks)) {
                return interaction.reply({
                    content: '-# <:flork_hmmm31:1491903354786545714> I need **Embed Links** permission in this channel to run Baccarat.',
                    flags: MessageFlags.Ephemeral
                });
            }
        }
        const betAmount = interaction.options.getInteger("amount");
        await interaction.reply({
            components: [
                new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('-# Starting Baccarat...')
                    )
            ],
            flags: MessageFlags.IsComponentsV2
        });
        startBaccaratRound(interaction, betAmount);
    }
    if (interaction.isCommand() && interaction.commandName === 'craft') {
        const userId = interaction.user.id;
        const itemToCraft = interaction.options.getString('item');

        let userItem = store.getItems(userId);

        const now = Date.now();

        const _craftCd = store.getCooldown(userId, 'craft');
        if (now < _craftCd) {
            const remaining = _craftCd - now;
            const timeLeft = formatCooldown(remaining);
            return interaction.reply({
                content: `-# <:flork_hmmm31:1491903354786545714> *You're still cleaning up from the last batch...* Wait **${timeLeft}** before crafting again.`,
                flags: MessageFlags.Ephemeral
            });
        }

                const hasAk = !!userItem.ak;
        const hasMask = !!userItem.mask;
        const hasBag = !!userItem.bag;

        if (!hasAk || !hasMask || !hasBag) {
            let owned = [];
            if (hasAk) owned.push(`${emojiIap['ak']} AK`);
            if (hasMask) owned.push(`${emojiIap['mask']} Mask`);
            if (hasBag) owned.push(`${emojiIap['Bag']} Bag`);

            return interaction.reply({
                content:
                    `<a:SadCat:1491126710622490704> **Insufficient requirements!**\n` +
                    `${emojiIap['ak']} AK + ${emojiIap['mask']} Mask + ${emojiIap['Bag']} Bag\n\n` +
                    `<:bag:1491120194670821426> **Currently Owned:**\n${owned.length > 0 ? owned.join('\n') : 'You don\'t have any.'}`,
                flags: MessageFlags.Ephemeral
            });
        }

                const cooldownMins = Math.random() < 0.5 ? 30 : 50;
        const cooldownTime = cooldownMins * 60 * 1000;
        store.setCooldown(userId, 'craft', now + cooldownTime);

                const failed = Math.random() < 0.40;

        if (failed) {
            const failMessages = itemToCraft === 'cocaine' ? [
                `You were measuring the cut when you sneezed — white powder everywhere. Batch ruined.`,
                `The mix ratio was off. You cooked it too hot and burned the whole thing.`,
                `Heard footsteps outside. Panicked and flushed it all down the drain.`,
                `Your hands were shaking too much. Spilled the chemicals on the floor.`,
                `Power went out mid-cook. Everything solidified wrong. Trash.`,
            ] : [
                `You rolled it too loose and it fell apart before you could seal it.`,
                `Forgot to dry the batch first. It's all soggy and useless now.`,
                `Your lighter slipped and caught the whole tray on fire.`,
                `Mixed up the bags — that wasn't oregano. Whole batch is contaminated.`,
                `Got distracted and left it out too long. It's completely dried out and crumbled.`,
            ];

            const failMsg = failMessages[Math.floor(Math.random() * failMessages.length)];
            const craftEmoji = itemToCraft === 'cocaine'
                ? `<:Itachi_Sniff46:1491127175158567216>`
                : `<:roll_joint:1513869458144362606>`;

            return interaction.reply({
                content:
                    `${craftEmoji} **Craft Failed!**\n` +
                    `*${failMsg}*\n` +
                    `-# <:flork_hmmm31:1491903354786545714> Cooldown: **${cooldownMins} mins**`
            });
        }

        let amount = 0;
        let emoji = '';
        let itemName = '';
        let raccoonBonus = 0;
        const hasRaccoon = !!userItem.kitsune;

        if (itemToCraft === 'cocaine') {
            amount = Math.floor(Math.random() * 3) + 2;             emoji = emojiIap['Coke'];
            itemName = 'Coke';

            const successLines = [
                `Measured every gram. Clean cook. The product came out perfect.`,
                `Mask on, bag ready. You ran the whole operation smooth like clockwork.`,
                `Took your time with the cut. Quality over quantity — and you delivered both.`,
                `The lab smelled like money. You smiled under the mask.`,
                `Hands steady, eyes focused. Another clean batch wrapped and ready.`,
            ];

            if (hasRaccoon) { raccoonBonus = 3; amount += raccoonBonus; }
            if (!userItem.cocaine) userItem.cocaine = { quantity: 0 };
            userItem.cocaine.quantity += amount;

            const line = successLines[Math.floor(Math.random() * successLines.length)];
            store.setItems(userId, userItem);

            await interaction.reply({
                content:
                    `<:Itachi_Sniff46:1491127175158567216> **Craft Successful!** You crafted ${emoji}**${amount}g ${itemName}**\n` +
                    `*${line}*\n` +
                    (hasRaccoon ? `-# <a:Kitsune:1499843448834887750> Kitsune bonus: **+${raccoonBonus}g** · ` : `-# `) +
                    `<:flork_hmmm31:1491903354786545714> Next craft in **${cooldownMins} mins**`
            });

        } else if (itemToCraft === 'marijuana') {
            amount = Math.floor(Math.random() * 5) + 3;             emoji = emojiIap['Weed'];
            itemName = 'Weed';

            const successLines = [
                `Rolled it tight, licked the seal, and tucked the batch away. Clean work.`,
                `The whole room smelled like a forest. You packed every joint with care.`,
                `Fingers green, bag full. Another session, another batch done right.`,
                `You took one sniff to check quality. Nodded. This was the good stuff.`,
                `Slow and steady — every joint rolled perfect. You don't rush the craft.`,
            ];

            if (hasRaccoon) { raccoonBonus = 3; amount += raccoonBonus; }
            if (!userItem.marijuana) userItem.marijuana = { quantity: 0 };
            userItem.marijuana.quantity += amount;

            const line = successLines[Math.floor(Math.random() * successLines.length)];
            store.setItems(userId, userItem);

            await interaction.reply({
                content:
                    `<:roll_joint:1513869458144362606> **Craft Successful!** You crafted <a:joint_time:1513877573774479461>**${amount}g ${itemName}**\n` +
                    `*${line}*\n` +
                    (hasRaccoon ? `-# <a:Kitsune:1499843448834887750> Kitsune bonus: **+${raccoonBonus}g** · ` : `-# `) +
                    `<:flork_hmmm31:1491903354786545714> Next craft in **${cooldownMins} mins**`
            });
        }
    }
    if (interaction.isCommand() && interaction.commandName === 'daily') {
        const userId = interaction.user.id;
        const now = new Date();
        const today = now.toISOString().split('T')[0];

        let streakData = store.getStreak(userId);
        const lastClaim = streakData.lastClaim;

        if (lastClaim === today) {
            const nextDaily = new Date(now);
            nextDaily.setUTCHours(24, 0, 0, 0);
            const unixTime = Math.floor(nextDaily.getTime() / 1000);
            return interaction.reply({
                content:
                    `-# You've already claimed your **daily reward** today! <:49933hamstersad:1491131447246065774> Come back <t:${unixTime}:R> (<t:${unixTime}:t>)\n-# Use </rewards:1512861685453685033> for extra rewards!`,
                flags: MessageFlags.Ephemeral
            });
        }
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        if (lastClaim === yesterdayStr) {
            streakData.streak += 1;
        } else {
            streakData.streak = 1;
        }
        streakData.lastClaim = today;

        const baseReward = 5000;
        const streakBonus = streakData.streak * 2000;
        const totalReward = baseReward + streakBonus;

        store.addCoins(userId, totalReward);

        let marriageText = '';
        if (store.isMarried(userId)) {
            const giftAmount = Math.floor(Math.random() * 3) + 1;
            let userItem = store.getItems(userId);
            if (!userItem.gift) {
                userItem.gift = { quantity: 0 };
            }
            userItem.gift.quantity += giftAmount;
            store.setItems(userId, userItem);
            marriageText =
                `\n-# <:ring:1502977846488989808> **Marriage Benefit:** +${giftAmount} <:gift:1502999386467336312> Gift`;
        }

        store.setStreak(userId, streakData);

        await interaction.reply({
            content:
                `<a:64000stitchpats:1491131081552953486> **Daily Reward Claimed!**\n` +
                `You received <:acoin:1508147096631513188> **__${totalReward.toLocaleString()}__ Coins**` +
                `${marriageText}` +
                `\n-# <a:flame:1491148060217180282> Daily Streak: **${streakData.streak}**`
        });
    }
    if (interaction.isCommand() && interaction.commandName === 'smoke') {
        const userId = interaction.user.id;
        let userItem = store.getItems(userId);
        const smokeCdExpires = store.getCooldown(userId, 'smoke') || 0;
        if (smokeCdExpires > Date.now()) {
            const timeRemaining = Math.ceil((smokeCdExpires - Date.now()) / 1000);
            await interaction.reply({
                content: `-# You need to wait **${timeRemaining} seconds** before you can smoke again! <a:SadCat:1491126710622490704>`,
                flags: MessageFlags.Ephemeral
            });
            return;
        }
        if (!userItem || !userItem.marlboro || userItem.marlboro.quantity < 1) {
            await interaction.reply({
                content: `You don't have any **Cigarette** to smoke! <a:SadCat:1491126710622490704>\n-# Buy some from the </shop:1491118301277847760>!`,
            });
            return;
        }
        userItem.marlboro.quantity -= 1;
        if (userItem.marlboro.quantity <= 0) {
            delete userItem.marlboro;
        }

        store.setCooldown(userId, 'smoke', Date.now() + 5 * 60 * 1000);
        const reputationGain = Math.floor(Math.random() * 110) + 55;
        store.addAura(userId, reputationGain);

        store.setItems(userId, userItem);
        await interaction.reply({
            content: `<a:467813smoking:1491124330049048696> You smoked a <a:cig:1491124938554343575>**Cig**. You gained **+${reputationGain} <a:flame:1491148060217180282>Aura**!`
        });
    }
    if (interaction.isCommand() && interaction.commandName === 'sell') {
        const userId = interaction.user.id;
        const itemName = interaction.options.getString('item');
        let userItem = store.getItems(userId);
        let totalEarned = 0;

        if (itemName === 'marijuana') {
            if (userItem.marijuana && userItem.marijuana.quantity > 0) {
                const quantitySold = 1;
                const earnings = Math.floor(Math.random() * (1500 - 1000 + 1)) + 1000;
                totalEarned = earnings * quantitySold;
                userItem.marijuana.quantity -= quantitySold;

                await interaction.reply({ content: `You sold <:Bud:1514463448841453649> 1g **Weed** for **<:acoin:1508147096631513188> ${earnings} Coins**. You now have ${userItem.marijuana.quantity}g Weed left.` });
            } else {
                await interaction.reply({ content: 'You don\'t have any **Weed** to sell. Use </rewards:1512861685453685033> for extra rewards!' });
                return;
            }
        } else if (itemName === 'cocaine') {
            if (userItem.cocaine && userItem.cocaine.quantity > 0) {
                const quantitySold = 1;
                const earnings = Math.floor(Math.random() * (2000 - 1000 + 1)) + 1000;
                totalEarned = earnings * quantitySold;
                userItem.cocaine.quantity -= quantitySold;

                await interaction.reply({ content: `You sold <:cocaine:1491119792910897272> 1g **Coke** for **<:acoin:1508147096631513188> ${earnings} Coins**. You now have ${userItem.cocaine.quantity}g Coke left.` });
            } else {
                await interaction.reply({ content: 'You don\'t have any **Coke** to sell. Use </rewards:1512861685453685033> for extra rewards!' });
                return;
            }
        }

        store.addCoins(userId, totalEarned);
        store.setItems(userId, userItem);
    }
if (interaction.isCommand() && interaction.commandName === 'shop') {

        const PAGES = [
        {
            key: 'items',
            label: '📦 Item Shop',
            accentColor: 0x5A5A5C,
            items: [
                { emoji: '<:anting2:1491119853854261308>',  name: 'Anting-anting', price: '5,000 Coins',     desc: '+500 Coins every 30 mins in VC · Valid for 1 day',         id: 'buy-anting2' },
                { emoji: '<:agimat:1491119820358553600>',   name: 'Agimat',         price: '1,000 Coins',     desc: 'Shield from robbery · Valid for 1 day',                   id: 'buy-agimat' },
                { emoji: '<:ak47:1491119777635106887>',     name: 'AK-47',          price: '50,000 Coins',    desc: '+20% success chance on /rob',                             id: 'buy-ak' },
                { emoji: '<:bag:1491120194670821426>',      name: 'Bag',            price: '75,000 Coins',    desc: '+10% additional stolen coins from /rob',                  id: 'buy-bag' },
                { emoji: '<:mask:1491119765027029124>',     name: 'Skii Mask',      price: '25,000 Coins',    desc: 'Hides your identity from victim DMs',                     id: 'buy-mask' },
                { emoji: '<:cocaine:1491119792910897272>',  name: 'Coke', price: '5,000 Coins',     desc: '1 gram · +++ Aura via /use · Max 10 buys per 8hrs',      id: 'buy-cocaine' },
                { emoji: '<:jointtttt:1514466300485832894>',   name: 'Weed', price: '2,500 Coins',     desc: '1 gram · ++ Aura via /use · Max 10 buys per 8hrs',       id: 'buy-marijuana' },
                { emoji: '<:cigg:1514467639400071328>',name: 'Cig',       price: '12 Coins',     desc: '1 cigarette · + Aura via /smoke · Max 100 pcs',        id: 'buy-marlboro' },
                { emoji: '<:gift:1502999386467336312>',     name: 'Gift',           price: '80,000 Coins',    desc: '<:470609wishpiece:1513187268506943538><a:aaowl:1506537098449125520><a:rat:1506514518937698435><a:raccoon:1512103318921679058> · /use to open · /rewards for free',        id: 'buy-gift' },
                { emoji: '<:ring:1502977846488989808>',     name: 'Ring',           price: '1,000,000 Coins', desc: 'Required for /marry · -10% tax on /give · Daily bonus',   id: 'buy-ring' },
            ],
        },
        {
            key: 'pets',
            label: '🐾 Pet Shop',
            accentColor: 0x5A5A5C,
            items: [
                { emoji: '<a:dog:1496797720432742421>',          name: 'Dog',     price: '350,000 Coins',   desc: 'Checks your Agimat & alerts when it expires',             id: 'buy-dog' },
                { emoji: '<a:cat:1496798083823046696>',          name: 'Cat',     price: '450,000 Coins',   desc: '+3,500 VC Coins every 30 mins',                           id: 'buy-cat' },
                { emoji: '<a:hmster:1506538001088643153>',       name: 'Hamster', price: '2,500,000 Coins', desc: '8.5x luck in coinflip (15 bets per 2hrs)',                id: 'buy-hamster' },
                { emoji: '<a:fox:1498290944330694717>',          name: 'Fox',     price: '300g Coke',    desc: 'Steals coins from richest user without Agimat',           id: 'buy-fox' },
                { emoji: '<a:crow:1498865634778288148>',         name: 'Crow',    price: '550g Weed',  desc: 'Steals drugs from users without Agimat',                  id: 'buy-crow' },
                { emoji: '<a:Kitsune:1499843448834887750>',      name: 'Kitsune', price: '250,000 Coins',   desc: 'Req: 100K Aura · +3 bonus drugs when crafting',           id: 'buy-kitsune' },
                { emoji: '<a:arrabit:1506535349910900777>',      name: 'Rabbit',  price: '1,000,000 Coins', desc: 'Extends Agimat duration by +1 to 3 hours',               id: 'buy-rabbit' },
                { emoji: '<a:chicken:1491117598417490032>',      name: 'Chicken', price: '2,500 Coins',     desc: 'Fighting chicken for /cockfight',                         id: 'buy-chicken' },
            ],
        },
        {
            key: 'tokens',
            label: '<:470609wishpiece:1513187268506943538> Token Shop',
            accentColor: 0x5A5A5C,
            items: [
                { emoji: '<:470609wishpiece:1513187268506943538>', name: 'Token',   price: '5,000 Aura',   desc: 'Buy 1 Token using your Aura',                             id: 'buy-token' },
                { emoji: '<a:aaowl:1506537098449125520>',          name: 'Owl',    price: '150 Tokens',   desc: 'Detects a target\'s Agimat expiry time',                  id: 'buy-owl' },
                { emoji: '<a:rat:1506514518937698435>',            name: 'Rat',    price: '220 Tokens',   desc: 'Weakens target\s Agimat duration',                        id: 'buy-rat' },
                { emoji: '<a:raccoon:1512103318921679058>',        name: 'Raccoon',price: '450 Tokens',   desc: 'Raids target — steals Coins, Coke & Weed',             id: 'buy-raccoon' },
                { emoji: '<a:Monkey:1514250117677584435>',         name: 'Monkey', price: '300 Tokens',   desc: 'Steals back from robbers while Agimat is active.', id: 'buy-monkey' },
                { emoji: '<a:1370e260783e5050d1bc0fcf92c0fb14:1515543312776302603>', name: 'Octopus', price: '200 Tokens', desc: 'Resets the cooldown of your last used pet',          id: 'buy-octopus' },
                { emoji: '<:Giamt:1513486130421567639>',           name: 'Agimat+',  price: '3 Tokens',      desc: 'Extends your Agimat duration by +6 hours',                id: 'buy-giamt' },
            ],
        },
    ];

        function buildShopContainer(pageIndex, navDisabled = false) {
        const page = PAGES[pageIndex];
        const container = new ContainerBuilder().setAccentColor(page.accentColor);

                        const isTokenPage = page.key === 'tokens';

        if (isTokenPage) {
            const titleSection = new SectionBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## ${page.label}`),
                    new TextDisplayBuilder().setContent('-# Spend Tokens on exclusive pets!')
                )
                .setButtonAccessory(
                    new ButtonBuilder()
                        .setCustomId('buy-token')
                        .setLabel('Buy Token')
                        .setEmoji({ id: '1513187268506943538', name: 'wishpiece' })
                        .setStyle(ButtonStyle.Secondary)
                );
            container.addSectionComponents(titleSection);
        } else {
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## ${page.label}`),
                new TextDisplayBuilder().setContent('-# Buy items with unique perks!')
            );
        }

                container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

                const itemLines = page.items.map(item =>
            `${item.emoji} **${item.name}** — **${item.price}**\n-# ${item.desc}`
        ).join('\n');
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(itemLines)
        );

                container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

                        const buyButtons = page.items
            .filter(item => !(isTokenPage && item.id === 'buy-token'))
            .map(item =>
                new ButtonBuilder()
                    .setCustomId(item.id)
                    .setLabel('Buy')
                    .setEmoji(extractEmoji(item.emoji))
                    .setStyle(ButtonStyle.Secondary)
            );

                for (let i = 0; i < buyButtons.length; i += 3) {
            container.addActionRowComponents(
                new ActionRowBuilder().addComponents(buyButtons.slice(i, i + 3))
            );
        }

                container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

                container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('shop_back')
                    .setEmoji('1511035172064198707')
                    .setLabel('Back')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(navDisabled || pageIndex === 0),

                new ButtonBuilder()
                    .setCustomId('shop_page_indicator')
                    .setLabel(`${pageIndex + 1} / ${PAGES.length}`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),

                new ButtonBuilder()
                    .setCustomId('shop_next')
                    .setEmoji('1511035189751713803')
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(navDisabled || pageIndex === PAGES.length - 1)
            )
        );

        return container;
    }

        function extractEmoji(emojiStr) {
                const match = emojiStr.match(/<a?:(\w+):(\d+)>/);
        if (match) return { name: match[1], id: match[2], animated: emojiStr.startsWith('<a:') };
        return { name: emojiStr };     }

        let currentPage = 0;

    await interaction.reply({
        components: [buildShopContainer(currentPage)],
        flags: MessageFlags.IsComponentsV2,
    });

    const message = await interaction.fetchReply();

        const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 10 * 60 * 1000,     });

    collector.on('collect', async i => {
                if (i.customId === 'shop_next' || i.customId === 'shop_back') {
            if (i.customId === 'shop_next') currentPage = Math.min(currentPage + 1, PAGES.length - 1);
            if (i.customId === 'shop_back') currentPage = Math.max(currentPage - 1, 0);

            try {
                await i.update({
                    components: [buildShopContainer(currentPage)],
                    flags: MessageFlags.IsComponentsV2,
                });
            } catch (err) {
                if (err.code === 10062) return;
                throw err;
            }
            return;
        }

                        if (i.user.id !== interaction.user.id) {
            return i.reply({
                content: '-# <:flork_hmmm31:1491903354786545714> This shop isn\'t yours!',
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
        }

                try {
            await i.deferReply({ flags: MessageFlags.Ephemeral });
        } catch (err) {
            if (err.code === 10062) return;
            throw err;
        }

        const userId = i.user.id;
        let userItem = store.getItems(userId);

                if (i.customId === 'buy-anting2') {
            if (userItem.anting2 && userItem.anting2.expiresAt > Date.now()) {
                return i.editReply({ content: '-# You already have an active **Anting-anting**!', flags: MessageFlags.Ephemeral });
            }
            if (store.getCoins(userId) < 5000) {
                return i.editReply({ content: '-# You need **5,000 Coins**. Use </rewards:1512861685453685033> for free rewards!', flags: MessageFlags.Ephemeral });
            }
            store.addCoins(userId, -5000);
            userItem.anting2 = { expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
            store.setItems(userId, userItem);
            return i.editReply({ content: '-# <:anting2:1491119853854261308> **Anting-anting** purchased! VC bonus active for 1 day.', flags: MessageFlags.Ephemeral });
        }

        if (i.customId === 'buy-agimat') {
            if (userItem.agimat && userItem.agimat.expiresAt > Date.now()) {
                return i.editReply({ content: '-# You already have an active **Agimat**!', flags: MessageFlags.Ephemeral });
            }
            if (store.getCoins(userId) < 1000) {
                return i.editReply({ content: '-# You need **1,000 Coins**. Use </rewards:1512861685453685033> for free rewards!', flags: MessageFlags.Ephemeral });
            }
            store.addCoins(userId, -1000);
            userItem.agimat = { expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
            store.setItems(userId, userItem);
            return i.editReply({ content: '-# <:agimat:1491119820358553600> **Agimat** activated! Robbery protection for 1 day.', flags: MessageFlags.Ephemeral });
        }

        if (i.customId === 'buy-ak') {
            if (userItem.ak) return i.editReply({ content: '-# You already own an **AK-47**.', flags: MessageFlags.Ephemeral });
            if (store.getCoins(userId) < 50000) {
                return i.editReply({ content: '-# You need **50,000 Coins**. Use </rewards:1512861685453685033> for free rewards!', flags: MessageFlags.Ephemeral });
            }
            store.addCoins(userId, -50000);
            userItem.ak = { acquiredDate: new Date().toISOString() };
            store.setItems(userId, userItem);
            return i.editReply({ content: '-# <:ak47:1491119777635106887> **AK-47** purchased! +20% rob success chance.', flags: MessageFlags.Ephemeral });
        }

        if (i.customId === 'buy-bag') {
            if (userItem.bag) return i.editReply({ content: '-# You already own a **Bag**.', flags: MessageFlags.Ephemeral });
            if (store.getCoins(userId) < 75000) {
                return i.editReply({ content: '-# You need **75,000 Coins**. Use </rewards:1512861685453685033> for free rewards!', flags: MessageFlags.Ephemeral });
            }
            store.addCoins(userId, -75000);
            userItem.bag = { acquiredDate: new Date().toISOString() };
            store.setItems(userId, userItem);
            return i.editReply({ content: '-# <:bag:1491120194670821426> **Bag** purchased! +10% stolen coins bonus.', flags: MessageFlags.Ephemeral });
        }

        if (i.customId === 'buy-mask') {
            if (userItem.mask) return i.editReply({ content: '-# You already own a **Skii Mask**.', flags: MessageFlags.Ephemeral });
            if (store.getCoins(userId) < 25000) {
                return i.editReply({ content: '-# You need **25,000 Coins**. Use </rewards:1512861685453685033> for free rewards!', flags: MessageFlags.Ephemeral });
            }
            store.addCoins(userId, -25000);
            userItem.mask = { acquiredDate: new Date().toISOString() };
            store.setItems(userId, userItem);
            return i.editReply({ content: '-# <:mask:1491119765027029124> **Skii Mask** purchased! Your identity is hidden.', flags: MessageFlags.Ephemeral });
        }

        if (i.customId === 'buy-cocaine') {
            const now = Date.now();
            if (!userItem.cocaineBuy) userItem.cocaineBuy = { count: 0, cooldown: 0 };
            if (userItem.cocaineBuy.cooldown > now) {
                const remaining = Math.ceil((userItem.cocaineBuy.cooldown - now) / 1000);
                return i.editReply({ content: `-# Buy limit reached! Try again in **${remaining}s**.`, flags: MessageFlags.Ephemeral });
            }
            if (store.getCoins(userId) < 5000) {
                return i.editReply({ content: '-# You need **5,000 Coins**. Use </rewards:1512861685453685033> for free rewards!', flags: MessageFlags.Ephemeral });
            }
            store.addCoins(userId, -5000);
            if (!userItem.cocaine) userItem.cocaine = { quantity: 0 };
            userItem.cocaine.quantity += 1;
            userItem.cocaineBuy.count += 1;
            if (userItem.cocaineBuy.count >= 10) {
                userItem.cocaineBuy.count = 0;
                userItem.cocaineBuy.cooldown = now + 8 * 60 * 60 * 1000;
            }
            store.setItems(userId, userItem);
            return i.editReply({ content: `-# <:cocaine:1491119792910897272> Bought 1 **Coke**. (${userItem.cocaineBuy.count}/10 buys)`, flags: MessageFlags.Ephemeral });
        }

        if (i.customId === 'buy-marijuana') {
            const now = Date.now();
            if (!userItem.marijuanaBuy) userItem.marijuanaBuy = { count: 0, cooldown: 0 };
            if (userItem.marijuanaBuy.cooldown > now) {
                const remaining = Math.ceil((userItem.marijuanaBuy.cooldown - now) / 1000);
                return i.editReply({ content: `-# Buy limit reached! Try again in **${remaining}s**.`, flags: MessageFlags.Ephemeral });
            }
            if (store.getCoins(userId) < 2500) {
                return i.editReply({ content: '-# You need **2,500 Coins**. Use </rewards:1512861685453685033> for free rewards!', flags: MessageFlags.Ephemeral });
            }
            store.addCoins(userId, -2500);
            if (!userItem.marijuana) userItem.marijuana = { quantity: 0 };
            userItem.marijuana.quantity += 1;
            userItem.marijuanaBuy.count += 1;
            if (userItem.marijuanaBuy.count >= 10) {
                userItem.marijuanaBuy.count = 0;
                userItem.marijuanaBuy.cooldown = now + 8 * 60 * 60 * 1000;
            }
            store.setItems(userId, userItem);
            return i.editReply({ content: `-# <:jointtttt:1514466300485832894> Bought 1 **Weed**. (${userItem.marijuanaBuy.count}/10 buys)`, flags: MessageFlags.Ephemeral });
        }

        if (i.customId === 'buy-marlboro') {
            if (store.getCoins(userId) < 12) {
                return i.editReply({ content: '-# You need **1,000 Coins**. Use </rewards:1512861685453685033> for free rewards!', flags: MessageFlags.Ephemeral });
            }
            if (!userItem.marlboro) userItem.marlboro = { quantity: 0 };
            if (userItem.marlboro.quantity + 1 > 100) {
                return i.editReply({ content: `-# Max cigarette limit is **100 pcs**. You have **${userItem.marlboro.quantity}** already.`, flags: MessageFlags.Ephemeral });
            }
            store.addCoins(userId, -12);
            userItem.marlboro.quantity += 1;
            store.setItems(userId, userItem);
            return i.editReply({ content: `-# <:cigg:1514467639400071328> Bought **Marlboro**! You now have **${userItem.marlboro.quantity} pcs**.`, flags: MessageFlags.Ephemeral });
        }

        if (i.customId === 'buy-gift') {
            if (store.getCoins(userId) < 80000) {
                return i.editReply({ content: '-# You need **80,000 Coins**. Use </rewards:1512861685453685033> for free rewards!', flags: MessageFlags.Ephemeral });
            }
            store.addCoins(userId, -80000);
            if (!userItem.gift) userItem.gift = { quantity: 0 };
            userItem.gift.quantity += 1;
            store.setItems(userId, userItem);
            return i.editReply({ content: '-# <:gift:1502999386467336312> Bought **1 Gift** for 80,000 Coins!', flags: MessageFlags.Ephemeral });
        }

        if (i.customId === 'buy-ring') {
            if (userItem.ring) return i.editReply({ content: '-# You already own a **Ring**. <:ring:1502977846488989808>', flags: MessageFlags.Ephemeral });
            if (store.getCoins(userId) < 1000000) {
                return i.editReply({ content: '-# You need **1,000,000 Coins**. Use </rewards:1512861685453685033> for free rewards!', flags: MessageFlags.Ephemeral });
            }
            store.addCoins(userId, -1000000);
            userItem.ring = { quantity: 1 };
            store.setItems(userId, userItem);
            return i.editReply({ content: '-# <:ring:1502977846488989808> **Ring** purchased! You can now /marry someone.', flags: MessageFlags.Ephemeral });
        }

                if (i.customId === 'buy-dog') {
            if (userItem.dog) return i.editReply({ content: '-# You already have a **Dog**. <a:dog:1496797720432742421>', flags: MessageFlags.Ephemeral });
            if (store.getCoins(userId) < 350000) return i.editReply({ content: '-# You need **350,000 Coins**.', flags: MessageFlags.Ephemeral });
            store.addCoins(userId, -350000);
            userItem.dog = true;
            store.setItems(userId, userItem);
            return i.editReply({ content: '-# <a:dog:1496797720432742421> **Dog** purchased!', flags: MessageFlags.Ephemeral });
        }

        if (i.customId === 'buy-cat') {
            if (userItem.cat) return i.editReply({ content: '-# You already have a **Cat**. <a:cat:1496798083823046696>', flags: MessageFlags.Ephemeral });
            if (store.getCoins(userId) < 450000) return i.editReply({ content: '-# You need **450,000 Coins**.', flags: MessageFlags.Ephemeral });
            store.addCoins(userId, -450000);
            userItem.cat = true;
            store.setItems(userId, userItem);
            return i.editReply({ content: '-# <a:cat:1496798083823046696> **Cat** purchased!', flags: MessageFlags.Ephemeral });
        }

        if (i.customId === 'buy-hamster') {
            if (userItem.hamster) return i.editReply({ content: '-# You already have a **Hamster**. <a:hmster:1506538001088643153>', flags: MessageFlags.Ephemeral });
            if (store.getCoins(userId) < 2500000) return i.editReply({ content: '-# You need **2,500,000 Coins**.', flags: MessageFlags.Ephemeral });
            store.addCoins(userId, -2500000);
            userItem.hamster = true;
            store.setItems(userId, userItem);
            return i.editReply({ content: '-# <a:hmster:1506538001088643153> **Hamster** purchased!', flags: MessageFlags.Ephemeral });
        }

        if (i.customId === 'buy-fox') {
            if (userItem.fox) return i.editReply({ content: '-# You already have a **Fox**. <a:fox:1498290944330694717>', flags: MessageFlags.Ephemeral });
            if (!userItem.cocaine || userItem.cocaine.quantity < 300) {
                return i.editReply({ content: '-# You need **300g Coke** <:cocaine:1491119792910897272> to buy a Fox.', flags: MessageFlags.Ephemeral });
            }
            userItem.cocaine.quantity -= 300;
            userItem.fox = true;
            store.setItems(userId, userItem);
            return i.editReply({ content: '-# <a:fox:1498290944330694717> **Fox** purchased!', flags: MessageFlags.Ephemeral });
        }

        if (i.customId === 'buy-crow') {
            if (userItem.crow) return i.editReply({ content: '-# You already have a **Crow**. <a:crow:1498865634778288148>', flags: MessageFlags.Ephemeral });
            if (!userItem.marijuana || userItem.marijuana.quantity < 550) {
                return i.editReply({ content: '-# You need **550g Weed** <:jointtttt:1514466300485832894> to buy a Crow.', flags: MessageFlags.Ephemeral });
            }
            userItem.marijuana.quantity -= 550;
            userItem.crow = true;
            store.setItems(userId, userItem);
            return i.editReply({ content: '-# <a:crow:1498865634778288148> **Crow** purchased!', flags: MessageFlags.Ephemeral });
        }

        if (i.customId === 'buy-kitsune') {
            if (userItem.kitsune) return i.editReply({ content: '-# You already have a **Kitsune**. <a:Kitsune:1499843448834887750>', flags: MessageFlags.Ephemeral });
            const userAura = store.getAura(userId) || 0;
            if (userAura < 100000) return i.editReply({ content: `-# You need **100,000 Aura** to buy a Kitsune. You have **${userAura.toLocaleString()}**.`, flags: MessageFlags.Ephemeral });
            if (store.getCoins(userId) < 250000) return i.editReply({ content: '-# You need **250,000 Coins**.', flags: MessageFlags.Ephemeral });
            store.addCoins(userId, -250000);
            userItem.kitsune = true;
            store.setItems(userId, userItem);
            return i.editReply({ content: '-# <a:Kitsune:1499843448834887750> **Kitsune** purchased!', flags: MessageFlags.Ephemeral });
        }

        if (i.customId === 'buy-rabbit') {
            if (userItem.rabbit) return i.editReply({ content: '-# You already have a **Rabbit**. <a:arrabit:1506535349910900777>', flags: MessageFlags.Ephemeral });
            if (store.getCoins(userId) < 1000000) return i.editReply({ content: '-# You need **1,000,000 Coins**.', flags: MessageFlags.Ephemeral });
            store.addCoins(userId, -1000000);
            userItem.rabbit = { lastUsed: 0 };
            store.setItems(userId, userItem);
            return i.editReply({ content: '-# <a:arrabit:1506535349910900777> **Rabbit** purchased!', flags: MessageFlags.Ephemeral });
        }
        if (i.customId === 'buy-chicken') {
            if (userItem.chicken) return i.editReply({ content: '-# You already have a **Chicken**. <a:chicken:1491117598417490032>', flags: MessageFlags.Ephemeral });
            if (store.getCoins(userId) < 2500) return i.editReply({ content: '-# You need **2,500 Coins**.', flags: MessageFlags.Ephemeral });
            store.addCoins(userId, -2500);
            userItem.chicken = { winstreak: 0 };
            store.setItems(userId, userItem);
            return i.editReply({ content: '-# <a:chicken:1491117598417490032> **Chicken** purchased! Ready for /cockfight.', flags: MessageFlags.Ephemeral });
        }
                if (i.customId === 'buy-token') {
            const userAura = store.getAura(userId) || 0;
            if (userAura < 5000) return i.editReply({ content: `-# You need **5,000 Aura** to buy 1 Token. You have **${userAura.toLocaleString()}**.`, flags: MessageFlags.Ephemeral });
            store.addAura(userId, -5000);
            store.addTokens(userId, 1);
            return i.editReply({ content: `-# <:470609wishpiece:1513187268506943538> Bought **1 Token** for 5,000 Aura! You now have **${store.getTokens(userId)} Tokens**.`, flags: MessageFlags.Ephemeral });
        }

        if (i.customId === 'buy-owl') {
            const price = 150;
            const userTokens = store.getTokens(userId);
            if (userTokens < price) return i.editReply({ content: `-# You need **${price} Tokens**. You have **${userTokens}**.`, flags: MessageFlags.Ephemeral });
            store.addTokens(userId, -price);
            userItem.owl = (typeof userItem.owl === 'object' ? (userItem.owl?.quantity || 0) : (userItem.owl || 0)) + 1;
            store.setItems(userId, userItem);
            return i.editReply({ content: `-# <a:aaowl:1506537098449125520> Bought **Owl** for ${price} Tokens! You now have **${userItem.owl} Owl(s)**.`, flags: MessageFlags.Ephemeral });
        }

        if (i.customId === 'buy-rat') {
            const price = 220;
            const userTokens = store.getTokens(userId);
            if (userTokens < price) return i.editReply({ content: `-# You need **${price} Tokens**. You have **${userTokens}**.`, flags: MessageFlags.Ephemeral });
            store.addTokens(userId, -price);
            userItem.rat = (typeof userItem.rat === 'object' ? (userItem.rat?.quantity || 0) : (userItem.rat || 0)) + 1;
            store.setItems(userId, userItem);
            return i.editReply({ content: `-# <a:rat:1506514518937698435> Bought **Rat** for ${price} Tokens! You now have **${userItem.rat} Rat(s)**.`, flags: MessageFlags.Ephemeral });
        }

        if (i.customId === 'buy-raccoon') {
            const price = 450;
            const userTokens = store.getTokens(userId);
            if (userTokens < price) return i.editReply({ content: `-# You need **${price} Tokens**. You have **${userTokens}**.`, flags: MessageFlags.Ephemeral });
            store.addTokens(userId, -price);
            userItem.raccoon = (typeof userItem.raccoon === 'object' ? (userItem.raccoon?.quantity || 0) : (userItem.raccoon || 0)) + 1;
            store.setItems(userId, userItem);
            return i.editReply({ content: `-# <a:raccoon:1512103318921679058> Bought **Raccoon** for ${price} Tokens! You now have **${userItem.raccoon} Raccoon(s)**.`, flags: MessageFlags.Ephemeral });
        }
        if (i.customId === 'buy-monkey') {
            const price = 300;
            const userTokens = store.getTokens(userId);
            if (userTokens < price) return i.editReply({ content: `-# You need **${price} Tokens**. You have **${userTokens}**.`, flags: MessageFlags.Ephemeral });
            store.addTokens(userId, -price);
            userItem.monkey = (typeof userItem.monkey === 'object' ? (userItem.monkey?.quantity || 0) : (userItem.monkey || 0)) + 1;
            store.setItems(userId, userItem);
            return i.editReply({ content: `-# <a:Monkey:1514250117677584435> Bought **monkey** for ${price} Tokens! You now have **${userItem.monkey} monkey(s)**.`, flags: MessageFlags.Ephemeral });
        }
        if (i.customId === 'buy-octopus') {
            const price = 200;
            const userTokens = store.getTokens(userId);
            if (userTokens < price) return i.editReply({ content: `-# You need **${price} Tokens**. You have **${userTokens}**.`, flags: MessageFlags.Ephemeral });
            store.addTokens(userId, -price);
            userItem.octopus = (typeof userItem.octopus === 'object' ? (userItem.octopus?.quantity || 0) : (userItem.octopus || 0)) + 1;
            store.setItems(userId, userItem);
            return i.editReply({ content: `-# <a:1370e260783e5050d1bc0fcf92c0fb14:1515543312776302603> Bought **Octopus** for ${price} Tokens! You now have **${userItem.octopus} Octopus(es)**.`, flags: MessageFlags.Ephemeral });
        }
        if (i.customId === 'buy-giamt') {
            const price = 3;
            const userTokens = store.getTokens(userId);
            if (userTokens < price) return i.editReply({ content: `-# You need **${price} Token**. You have **${userTokens}**.`, flags: MessageFlags.Ephemeral });
            if (!userItem.agimat || userItem.agimat.expiresAt <= Date.now()) {
                return i.editReply({ content: `-# <:Giamt:1513486130421567639> You don't have an active **Agimat** to extend!`, flags: MessageFlags.Ephemeral });
            }
            store.addTokens(userId, -price);
            userItem.agimat.expiresAt += 6 * 60 * 60 * 1000;
            store.setItems(userId, userItem);
            const newExpiry = Math.floor(userItem.agimat.expiresAt / 1000);
            return i.editReply({ content: `-# <:Giamt:1513486130421567639> **Agimat** extended by **6 hours**! Now expires <t:${newExpiry}:R>.`, flags: MessageFlags.Ephemeral });
        }
    });

        collector.on('end', async () => {
        await message.edit({
            components: [buildShopContainer(currentPage, true)],
            flags: MessageFlags.IsComponentsV2,
        }).catch(() => {});
    });
}

    if (interaction.isButton()) {
        const userId = interaction.user.id;
        let userItem = store.getItems(userId);
        if (interaction.customId === 'rob_buy_agimat') {
            if (userItem.agimat && userItem.agimat.expiresAt > Date.now()) {
                return interaction.reply({ content: '-# You already have an active **Agimat**!', flags: MessageFlags.Ephemeral });
            }
            if (store.getCoins(userId) < 1000) {
                return interaction.reply({ content: '-# You need **1,000 Coins**. Use </rewards:1512861685453685033> for free rewards!', flags: MessageFlags.Ephemeral });
            }
            store.addCoins(userId, -1000);
            userItem.agimat = { expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
            store.setItems(userId, userItem);
            return interaction.reply({ content: '-# <:agimat:1491119820358553600> **Agimat** activated! Robbery protection for 1 day.', flags: MessageFlags.Ephemeral });
        }
        if (interaction.customId.startsWith('accept_marry_')) {
            const parts = interaction.customId.split('_');
            const proposerId = parts[2];
            const targetId = parts[3];
            if (interaction.user.id !== targetId) {
                return interaction.reply({
                    content: '-# You are not the one who should accept this.',
                    flags: MessageFlags.Ephemeral
                });
            }
            if (!pendingMarriages[proposerId]) {
                return interaction.reply({
                    content: '-# The proposal has expired.',
                    flags: MessageFlags.Ephemeral
                });
            }
            delete pendingMarriages[proposerId];
            store.setMarriage(proposerId, targetId);
            {
            let proposerItems = store.getItems(proposerId);
            if (proposerItems?.ring?.quantity > 0) {
                proposerItems.ring.quantity -= 1;
                if (proposerItems.ring.quantity <= 0) delete proposerItems.ring;
                store.setItems(proposerId, proposerItems);
            }
        }

            return interaction.update({
                content: `<:ring:1502977846488989808> <@${proposerId}> and <@${targetId}> are now married! <a:93964noellehappy:1491130797917212693>`,
                components: []
            });
        }
        if (interaction.customId.startsWith('decline_marry_')) {
            const [, , proposerId, targetId] = interaction.customId.split('_');
            if (interaction.user.id !== targetId) {
                return interaction.reply({
                    content: '-# This is not for you.',
                    flags: MessageFlags.Ephemeral
                });
            }
            delete pendingMarriages[proposerId];
            return interaction.update({
                content: `<:flork_hmmm31:1491903354786545714> <@${targetId}> declined the proposal.`,
                components: []
            });
        }
        if (interaction.customId.startsWith('cancel_marry_')) {
            const [, , proposerId] = interaction.customId.split('_');
            if (interaction.user.id !== proposerId) {
                return interaction.reply({
                    content: '-# Only you can cancel this.',
                    flags: MessageFlags.Ephemeral
                });
            }
            delete pendingMarriages[proposerId];
            return interaction.update({
                content: `-# <:flork_hmmm31:1491903354786545714> Proposal cancelled.`,
                components: []
            });
        }
    }
    if (interaction.isCommand() && interaction.commandName === 'cockfight') {

        const betAmount = interaction.options.getInteger('bet');
        const userId = interaction.user.id;

        const formatNumber = (num) => num.toLocaleString();

        let items = store.getItems(userId);
        const chicken = items?.chicken;

                if (!chicken) {
            return interaction.reply({
                content: `-# You don't have a chicken to join cockfights! Buy one from the </shop:1491118301277847760> first <a:chicken:1491117598417490032>`,
                flags: MessageFlags.Ephemeral
            });
        }

                if (activeCockfight[userId]) {
            return interaction.reply({
                content: `-# Your chicken is already fighting! <a:rooster_fight:1491116466815107182>`,
                flags: MessageFlags.Ephemeral
            });
        }

                const _chickenCd = store.getCooldown(userId, 'chicken');
        if (_chickenCd > Date.now()) {
            const timeLeft = formatCooldown(_chickenCd - Date.now());
            return interaction.reply({
                content: `-# <a:chicken:1491117598417490032> *Your chicken is still recovering from the last fight, squawking in the corner...* Come back in **${timeLeft}**.`,
                flags: MessageFlags.Ephemeral
            });
        }

                const userCoins = store.getCoins(userId);

        if (!userCoins || userCoins < betAmount) {
            return interaction.reply({
                content: `-# you don't have enough **Coins** to bet!`,
                flags: MessageFlags.Ephemeral
            });
        }

                if (betAmount > 50000) {
            return interaction.reply({
                content: `-# the maximum bet is **50,000 Coins**.`,
                flags: MessageFlags.Ephemeral
            });
        }

                if (betAmount <= 0) {
            return interaction.reply({
                content: 'Invalid amount.',
                flags: MessageFlags.Ephemeral
            });
        }

                activeCockfight[userId] = true;

                store.setCooldown(userId, 'chicken', Date.now() + 3600000);

                store.addCoins(userId, -betAmount);

        await interaction.reply(
            '<a:rooster_fight:1491116466815107182>'
        );

        setTimeout(async () => {

            const win = Math.random() < 0.55;

                        if (win) {

                const totalWinnings = betAmount * 2;

                store.addCoins(userId, totalWinnings);

                const freshItems = store.getItems(userId);

                const liveChicken =
                    freshItems.chicken || chicken;

                liveChicken.winstreak =
                    (liveChicken.winstreak || 0) + 1;

                freshItems.chicken = liveChicken;

                store.setItems(userId, freshItems);

                delete activeCockfight[userId];

                await interaction.editReply({
                    content:
    `<a:chicken:1491117598417490032> | *Your chicken won the cockfight!*\n<a:flame:1491148060217180282> Winstreak: **${liveChicken.winstreak}** | You won **<:acoin:1508147096631513188>__${formatNumber(totalWinnings)}__** Coins\n-# Wow, you're really lucky! <a:93964noellehappy:1491130797917212693>.`
                });

            } else {

                                const freshItems = store.getItems(userId);

                delete freshItems.chicken;

                store.setItems(userId, freshItems);

                delete activeCockfight[userId];

                await interaction.editReply({
                    content:
    `<:dead:1491130396489027636> | *Your chicken lost the cockfight and died...*\nYou lost **<:acoin:1508147096631513188>__${formatNumber(betAmount)}__** Coins\n-# Buy a new chicken from </shop:1491118301277847760> to fight again. <:69814baddrawnsasukethinking:1491131977791836374>`
                });
            }

        }, 4000);
    }
    if (interaction.isCommand() && interaction.commandName === 'rob') {
        const userId = interaction.user.id;
        const targetId = interaction.options.getUser('target').id;
        if (userId === targetId) {
            return interaction.reply({
                content: `-# <:flork_hmmm31:1491903354786545714> You can't rob yourself, that doesn't even make sense.`,
                flags: MessageFlags.Ephemeral,
            });
        }
        const _robCd = store.getCooldown(userId, 'rob');
        if (_robCd > Date.now()) {
            const timeLeft = formatCooldown(_robCd - Date.now());
            await interaction.reply({
                content: `-# <:flork_hmmm31:1491903354786545714> *Lay low for now, the cops are still looking for you...* Try again in **${timeLeft}**.`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const userItemsRobber = store.getItems(userId);
        let targetItems = store.getItems(targetId);
        if (targetItems.agimat && targetItems.agimat.expiresAt > Date.now()) {
                        let monkeyAgimatNote = '';
            if (targetItems.monkey && Math.random() < 0.75) {
                const robberCoins = store.getCoins(userId) || 0;
                const monkeySteal = Math.floor(robberCoins * 0.10);
                if (monkeySteal > 0) {
                    store.addCoins(userId, -monkeySteal);
                    store.addCoins(targetId, monkeySteal);
                    monkeyAgimatNote = `\n<a:Monkey:1514250117677584435> Their Monkey also snatched **${monkeySteal.toLocaleString()}** <:acoin:1508147096631513188> from you as punishment!`;
                    try {
                        await interaction.options.getUser('target').send({
                            content: `<a:Monkey:1514250117677584435> Your Monkey counter-stole **${monkeySteal.toLocaleString()}** <:acoin:1508147096631513188> from **${userItemsRobber.mask ? '*hidden*' : interaction.user.tag}** who tried to rob you!`,
                        });
                    } catch { /* DMs closed */ }
                }
            }
            await interaction.reply({
                content: `-# <:agimat:1491119820358553600> | You can't rob **${interaction.options.getUser('target').tag}**, They have an active shield.` + monkeyAgimatNote,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        let successChance = 0.7;
        if (userItemsRobber.ak) successChance += 0.2;
        const success = Math.random() < successChance;
        if (!success) {
            const userPointsRobber = store.getCoins(userId) || 0;
            const penaltyAmount = Math.floor(userPointsRobber * 0.10);
            store.setCoins(userId, Math.max(0, userPointsRobber - penaltyAmount));

            await interaction.reply({
                content: `<a:791504k:1505813465149866004> | You tried to rob but failed! Oh, you\'e been caught! Better luck next time, robbiii! You lost **${penaltyAmount}** <:acoin:1508147096631513188>.`,
            });
            return;
        }
        const targetPoints = store.getCoins(targetId) || 0;
        let amountToRob = Math.floor(targetPoints * 0.08);
        if (userItemsRobber.bag) amountToRob = Math.floor(amountToRob * 1.1);

        if (amountToRob <= 0) {
            await interaction.reply({
                content: `-# <:49933hamstersad:1491131447246065774> | **${interaction.options.getUser('target').tag}** has no <:acoin:1508147096631513188> **Coins** to rob.`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        store.addCoins(targetId, -amountToRob);
        store.addCoins(userId, amountToRob);

                let monkeyNote = '';
        const targetItemsForMonkey = store.getItems(targetId);
        const targetHasActiveAgimat = targetItemsForMonkey?.agimat && targetItemsForMonkey.agimat.expiresAt > Date.now();
        if (targetItemsForMonkey?.monkey && targetHasActiveAgimat && Math.random() < 0.75) {
            const robberCoins = store.getCoins(userId) || 0;
            const monkeySteal = Math.floor(robberCoins * 0.10);
            if (monkeySteal > 0) {
                store.addCoins(userId, -monkeySteal);
                store.addCoins(targetId, monkeySteal);
                monkeyNote = `\n<a:Monkey:1514250117677584435> | **${interaction.options.getUser('target').tag}**'s Monkey snatched back **${monkeySteal.toLocaleString()}** <:acoin:1508147096631513188> from you!`;
                try {
                    await interaction.options.getUser('target').send({
                        content: `<a:Monkey:1514250117677584435> Your Monkey counter-stole **${monkeySteal.toLocaleString()}** <:acoin:1508147096631513188> back from **${userItemsRobber.mask ? '*hidden*' : interaction.user.tag}** who just robbed you!`,
                    });
                } catch { /* DMs closed */ }
            }
        }

        store.setCooldown(userId, 'rob', Date.now() + 25 * 60 * 1000);
        let itemsOwned = [];
        if (userItemsRobber.ak) itemsOwned.push(`${emojiIap['ak']}`);
        if (userItemsRobber.bag) itemsOwned.push(`${emojiIap['Bag']}`);
        if (userItemsRobber.mask) itemsOwned.push(`${emojiIap['mask']}`);
        await interaction.reply({
            content: `${itemsOwned.length > 0 ? itemsOwned.join('') : ''}` +
                `<:7567robbed:1491135799486316747>| Successfully robbed **${amountToRob}** <:acoin:1508147096631513188> from **${interaction.options.getUser('target').tag}** you're good at snatching, huh.\n\n` +
                monkeyNote,
        });
        const targetUser = interaction.options.getUser('target');
        try {
            const robberName = userItemsRobber.mask ? '*hidden*' : interaction.user.tag;
            const robbedContainer = new ContainerBuilder()
                .setAccentColor(0xed4245)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `## <:7567robbed:1491135799486316747> You got robbed!`
                    )
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `**Amount Stolen:** **_${amountToRob}_** <:acoin:1508147096631513188>\n` +
                        `**Robber:** ${robberName}`
                    )
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `-# Protect your <:acoin:1508147096631513188> **Coins**! Buy **agimat** so you won't get robbed again.`
                    )
                )
                .addActionRowComponents(
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('rob_buy_agimat')
                            .setLabel('Buy Agimat')
                            .setEmoji({ id: '1491119820358553600', name: 'agimat' })
                            .setStyle(ButtonStyle.Secondary)
                    )
                );
            await targetUser.send({
                components: [robbedContainer],
                flags: MessageFlags.IsComponentsV2,
            });
        } catch {
        }
    }
    try {
        if (!interaction.isCommand()) return;
        const userId = interaction.user.id;
        const cooldownKey = `cmd_${userId}`;
        const cooldownTime = 5000;
        const now = Date.now();
        if (cmdCooldowns.has(userId) && now - cmdCooldowns.get(userId) < cooldownTime) {
            const remaining = Math.ceil((cooldownTime - (now - cmdCooldowns.get(userId))) / 1000);
            return interaction.reply({
                content: `-# you must wait **${remaining}** more seconds before using this command again.`,
                flags: MessageFlags.Ephemeral
            });
        }
        cmdCooldowns.set(userId, now);
        setTimeout(() => cmdCooldowns.delete(userId), cooldownTime);
        const formatNumber = (num) => num.toLocaleString();
                        if (interaction.isCommand() && interaction.commandName === 'leaderboard') {
            if (!interaction.guild) {
                return interaction.reply({ content: '-# This command can only be used in a server where I\'m a member..', flags: MessageFlags.Ephemeral });
            }
            await interaction.deferReply();
            const guildMembers = await getCachedMembers(interaction.guild);
            const medals = ['<a:94814firstplacetrophy:1506958107060998224>','<a:30646secondplacetrophy:1506958102065578034>','<a:22955thirdplacetrophy:1506958097191800962>'];
            const lbPages = ['coins', 'aura'];
            let lbPage = 0;

            const buildLbContainer = (tab, disabled = false) => {
                const container = new ContainerBuilder().setAccentColor(0x5A5A5C);

                if (tab === 'coins') {
                    const topUsers = store.getTopCoins(5000).filter(u => guildMembers.has(String(u.user_id))).slice(0, 10);
                    if (!topUsers.length) return null;
                    const desc = topUsers.map((u, i) => {
                        const m = guildMembers.get(String(u.user_id));
                        const name = m?.user?.globalName || m?.user?.username || 'Unknown User';
                        return `${medals[i] || '<a:50534diamond:1506958646183985265>'} ${i+1}. **${name}** — <:acoin:1508147096631513188> \`${Number(u.coins).toLocaleString()}\``;
                    }).join('\n');

                    const guildIcon = interaction.guild.iconURL();
                    if (guildIcon) {
                        const titleSection = new SectionBuilder()
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(`## <a:161979trophy:1506958112081313903> ${interaction.guild.name} Leaderboard`)
                            )
                            .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: guildIcon } }));
                        container.addSectionComponents(titleSection);
                    } else {
                        container.addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`## <a:161979trophy:1506958112081313903> ${interaction.guild.name} Leaderboard`)
                        );
                    }
                    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
                    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(desc));

                } else {
                    const topUsers = store.getTopAura(5000).filter(u => guildMembers.has(String(u.user_id))).slice(0, 10);
                    if (!topUsers.length) return null;
                    const desc = topUsers.map((u, i) => {
                        const m = guildMembers.get(String(u.user_id));
                        const name = m?.user?.globalName || m?.user?.username || 'Unknown User';
                        return `${medals[i] || '<a:50534diamond:1506958646183985265>'} ${i+1}. **${name}** — <a:flame:1491148060217180282> \`${Number(u.aura).toLocaleString()}\``;
                    }).join('\n');

                    const guildIconAura = interaction.guild.iconURL();
                    if (guildIconAura) {
                        const titleSection = new SectionBuilder()
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(`## <a:73946aura:1506964443215691806> ${interaction.guild.name} Aura Leaderboard`)
                            )
                            .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: guildIconAura } }));
                        container.addSectionComponents(titleSection);
                    } else {
                        container.addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`## <a:73946aura:1506964443215691806> ${interaction.guild.name} Aura Leaderboard`)
                        );
                    }
                    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
                    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(desc));
                }

                container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
                container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Page ${lbPage + 1}/${lbPages.length} • Keep grinding to reach #1.`));
                container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));
                container.addActionRowComponents(
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('lb_back').setEmoji({ id: '1511035172064198707' }).setStyle(ButtonStyle.Secondary).setDisabled(disabled),
                        new ButtonBuilder().setCustomId('lb_page').setLabel(`${lbPage + 1}/${lbPages.length}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
                        new ButtonBuilder().setCustomId('lb_next').setEmoji({ id: '1511035189751713803' }).setStyle(ButtonStyle.Secondary).setDisabled(disabled)
                    )
                );

                return container;
            };

            const firstContainer = buildLbContainer(lbPages[lbPage]);
            if (!firstContainer) return interaction.editReply({ content: '-# no leaderboard data available yet.' });

            const lbMsg = await interaction.editReply({
                components: [firstContainer],
                flags: MessageFlags.IsComponentsV2,
                fetchReply: true
            });

            const lbCollector = lbMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 120000 });

            lbCollector.on('collect', async i => {
                if (i.user.id !== interaction.user.id) return i.reply({ content: '-# This menu is not yours.', flags: MessageFlags.Ephemeral });
                if (i.customId === 'lb_next') lbPage = (lbPage + 1) % lbPages.length;
                if (i.customId === 'lb_back') lbPage = (lbPage - 1 + lbPages.length) % lbPages.length;
                const container = buildLbContainer(lbPages[lbPage]);
                try {
                    await i.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
                } catch (err) { if (err.code === 10062) return; throw err; }
            });

            lbCollector.on('end', async () => {
                try {
                    await lbMsg.edit({
                        components: [buildLbContainer(lbPages[lbPage], true)],
                        flags: MessageFlags.IsComponentsV2
                    });
                } catch {}
            });
        }
        if (interaction.commandName === 'colorgame') {
            const betColor = interaction.options.getString('color');
            const bet = interaction.options.getInteger('bet');
            if (bet <= 0) {
                return interaction.reply({ content: '-# Invalid amount.', flags: MessageFlags.Ephemeral });
            }
            if (bet > 50000) {
                return interaction.reply({ content: '-# the maximum bet is **__50,000__** **Coins**', flags: MessageFlags.Ephemeral });
            }
            if (!store.getCoins(userId) || store.getCoins(userId) < bet) {
                return interaction.reply({
                    content: '-# you do not have enough <:acoin:1508147096631513188> **Coins** for this bet.',
                    flags: MessageFlags.Ephemeral
                });
            }
            await interaction.reply('<a:rolling_dice_orange:1491115789250596864><a:rolling_dice_green:1491115484127695051><a:rolling_dice:1491114986754412654>');
            store.addCoins(userId, -bet);

            setTimeout(() => {
                const rolls = Array.from({ length: 3 }, () =>
                    colors[Math.floor(Math.random() * colors.length)]
                );
                const matches = rolls.filter(color => color.name.toLowerCase() === betColor).length;
                let payoutMultiplier = 0;
                switch (matches) {
                    case 1:
                        payoutMultiplier = 1;
                        break;
                    case 2:
                        payoutMultiplier = 2;
                        break;
                    case 3:
                        payoutMultiplier = 4;
                        break;
                    default:
                        payoutMultiplier = 0;
                }
                const totalWinnings = bet * payoutMultiplier + (payoutMultiplier > 0 ? bet : 0);
                if (payoutMultiplier > 0) {
                    store.addCoins(userId, totalWinnings);
                }
                const rollResult = rolls.map(color => `${color.emoji} ${color.name}`).join(', ');
                const resultMessage = payoutMultiplier > 0
                    ? `You won **<:acoin:1508147096631513188>__${formatNumber(totalWinnings)}__** **Coins** \n-# Wow, you're really lucky! <a:93964noellehappy:1491130797917212693>`
                    : `You lost **<:acoin:1508147096631513188>__${formatNumber(bet)}__** **Coins** \n-# It's okay! <:69814baddrawnsasukethinking:1491131977791836374>`;
                interaction.editReply(`*Diced Rolled: ${rollResult}.\n${resultMessage}*`);
            }, 4000);
        }
        if (interaction.commandName === 'coins') {
            const points = store.getCoins(userId) || 0;
            await interaction.reply(`**${interaction.user}**, you currently have **<:acoin:1508147096631513188> __${formatNumber(points)}__** **Coins**.\n-# you can earn **Coins** by staying in Voice Calls.<a:54748coffeesparkles:1511032334613479504>`);
        }
        if (interaction.commandName === 'give') {
            const target = interaction.options.getUser('user');
            const type = interaction.options.getString('type');
            const amount = interaction.options.getInteger('amount');
            if (amount <= 0) {
                return interaction.reply({ content: '-# Invalid amount.', flags: MessageFlags.Ephemeral });
            }
            if (target.id === interaction.user.id) {
                return interaction.reply({ content: '-# You can\'t give yourself this.', flags: MessageFlags.Ephemeral });
            }
            const userId = interaction.user.id;
            let userItem = store.getItems(userId);
            let targetItems = store.getItems(target.id);
            if (type === 'gift') {
                const senderGift = userItem.gift?.quantity || 0;
                if (senderGift < amount) {
                    return interaction.reply({
                        content: '-# You don\'t have enough gifts! Use </rewards:1512861685453685033> for extra rewards!',
                        flags: MessageFlags.Ephemeral
                    });
                }
                userItem.gift.quantity -= amount;
                if (userItem.gift.quantity <= 0) {
                    delete userItem.gift;
                }
                if (!targetItems.gift) {
                    targetItems.gift = { quantity: 0 };
                }
                targetItems.gift.quantity += amount;
                store.setItems(userId, userItem);
                store.setItems(target.id, targetItems);

                return interaction.reply(
                    `You gave *${amount}x <:gift:1502999386467336312> Gift* to <@${target.id}>`
                );
            }
            if (type === 'coins') {
                if (amount < 1000) {
                    return interaction.reply({
                        content: 'Minimum transfer amount is **1,000 Coins**.',
                        flags: MessageFlags.Ephemeral
                    });
                }
                if (store.getCoins(userId) < amount) {
                    return interaction.reply({
                        content: 'You don\'t have enough coins! Use </rewards:1512861685453685033> for extra rewards!',
                        flags: MessageFlags.Ephemeral
                    });
                }
                const isMarried = store.isMarried(userId);
                const taxRate = isMarried ? 0.15 : 0.25;
                const taxPercent = isMarried ? 15 : 25;
                const tax = Math.floor(amount * taxRate);
                const finalAmount = amount - tax;
                store.addCoins(userId, -amount);
                store.addCoins(target.id, finalAmount);

                return interaction.reply(
                    `<a:64000stitchpats:1491131081552953486> **|** You gave **<:acoin:1508147096631513188> __${formatNumber(finalAmount)}__** Coins to <@${target.id}>!\n` +
                    `-# Transfer fee deducted: **${formatNumber(tax)}** Coins (${taxPercent}%)` +
                    `${isMarried ? '\n-# <:ring:1502977846488989808> Marriage Benefit Applied: **-10% tax reduction**' : ''}`
                );
            }
            if (type === 'cocaine') {
                const senderCocaine = userItem.cocaine?.quantity || 0;

                if (senderCocaine < amount) {
                    return interaction.reply({
                        content: '-# You don\'t have enough Coke! use </rewards:1512861685453685033> for extra rewards!',
                        flags: MessageFlags.Ephemeral
                    });
                }
                userItem.cocaine.quantity -= amount;

                if (!targetItems.cocaine) {
                    targetItems.cocaine = { quantity: 0 };
                }
                targetItems.cocaine.quantity += amount;
                store.setItems(userId, userItem);
                store.setItems(target.id, targetItems);

                return interaction.reply(
                    `You gave **${amount}g <:cocaine:1491119792910897272> Coke** to <@${target.id}>`
                );
            }
            if (type === 'marijuana') {
                const senderWeed = userItem.marijuana?.quantity || 0;

                if (senderWeed < amount) {
                    return interaction.reply({
                        content: '-# You don\'t have enough Weed! use </rewards:1512861685453685033> for extra rewards!',
                        flags: MessageFlags.Ephemeral
                    });
                }
                userItem.marijuana.quantity -= amount;
                if (!targetItems.marijuana) {
                    targetItems.marijuana = { quantity: 0 };
                }
                targetItems.marijuana.quantity += amount;
                store.setItems(userId, userItem);
                store.setItems(target.id, targetItems);

                return interaction.reply(
                    `You gave **${amount}g <:jointtttt:1514466300485832894> Weed** to <@${target.id}>`
                );
            }
            if (type === 'token') {
                if (amount < 1) {
                    return interaction.reply({
                        content: 'Minimum transfer amount is **1 Token**.',
                        flags: MessageFlags.Ephemeral
                    });
                }
                const senderTokens = store.getTokens(userId);
                if (senderTokens < amount) {
                    return interaction.reply({
                        content: '-# You don\'t have enough Tokens! Use </rewards:1512861685453685033> for extra rewards!',
                        flags: MessageFlags.Ephemeral
                    });
                }
                store.addTokens(userId, -amount);
                store.addTokens(target.id, amount);

                return interaction.reply(
                    `<a:64000stitchpats:1491131081552953486> **|** You gave **<:470609wishpiece:1513187268506943538> __${formatNumber(amount)}__ Token${amount !== 1 ? 's' : ''}** to <@${target.id}>!`
                );
            }
        }
        if (interaction.commandName === 'coinflip') {
            const userId = interaction.user.id;
            const betSide = interaction.options.getString('side');
            const bet = interaction.options.getInteger('bet');
            if (bet <= 0) {
                return interaction.reply({ content: '-# Invalid amount.', flags: MessageFlags.Ephemeral });
            }
            if (bet > 50000) {
                return interaction.reply({
                    content: '-# The maximum bet is **__50,000__** **Coins**.',
                    flags: MessageFlags.Ephemeral
                });
            }
            if (!store.getCoins(userId) || store.getCoins(userId) < bet) {
                return interaction.reply({
                    content: '-# You do not have enough **Coins** for this bet.',
                    flags: MessageFlags.Ephemeral
                });
            }
            const now = Date.now();
            const resetTime = 2 * 60 * 60 * 1000;
            let luckData = store.getLuck(userId);
            if (now - luckData.lastReset >= resetTime) {
                luckData = { betsUsed: 0, lastReset: now };
            }
            await interaction.reply('<a:coin_flip_circle:1491122157667750111>');
            store.addCoins(userId, -bet);

            setTimeout(() => {
                const userItem = store.getItems(userId);
                const hasHamster = userItem.hamster !== undefined;
                let winChance = 0.48;
                let luckMessage = '';
                if (hasHamster && luckData.betsUsed < 15) {
                    winChance = 0.59;
                    luckData.betsUsed++;
                    luckMessage =
                        `\n-# **<a:hmster:1506538001088643153> Hamster 8.5x Luck Active <a:clover:1498859002484883578>** ` +
                        `(${15 - luckData.betsUsed}/15 bets left)`;
                    if (luckData.betsUsed >= 15) {
                        luckMessage += `\n-# <a:clover:1498859002484883578> **Luck exhausted**. Resets in **2 hours**.`;
                    }
                }
                store.setLuck(userId, luckData);
                const isWin = Math.random() < winChance;
                const outcome = isWin
                    ? betSide
                    : (betSide === 'heads' ? 'tails' : 'heads');
                const outcomeEmoji = coinEmojis[outcome];

                if (isWin) {
                    const winnings = bet * 2;
                    store.addCoins(userId, winnings);
                    interaction.editReply(
                        `**${outcome.toUpperCase()}** ${outcomeEmoji}! ` +
                        `You won **<:acoin:1508147096631513188>__${formatNumber(winnings)}__** **Coins**` +
                        `${luckMessage}\n-# Wow, you're really lucky! <a:93964noellehappy:1491130797917212693>`
                    );
                } else {
                    interaction.editReply(
                        `**${outcome.toUpperCase()}** ${outcomeEmoji}. ` +
                        `You lost **<:acoin:1508147096631513188>__${formatNumber(bet)}__** **Coins**` +
                        `${luckMessage}\n-# It\'s okay! <:69814baddrawnsasukethinking:1491131977791836374>`
                    );
                }
            }, 4000);
        }
    } catch (error) {
        console.error(`Error handling interaction: ${error}`);
        await interaction.reply({
            content: '-# There was an error processing your request. Please try again later!',
            flags: MessageFlags.Ephemeral,
        });
    }
});
}

module.exports = { registerInteractionHandlers, resumeGameSessions };