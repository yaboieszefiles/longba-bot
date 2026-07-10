'use strict';
const {
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, MediaGalleryBuilder, MediaGalleryItemBuilder,
    ComponentType, MessageFlags,
} = require('discord.js');
const store = require('../db/store');

const WAITING_GIF = "https://cdn.discordapp.com/attachments/1506606461935943761/1506606627934048276/waiting.gif?ex=6a0ee043&is=6a0d8ec3&hm=6681534f4215b488b3d7883114a99c3bdee7e9e7992cab0488567ba78b405f4c&";

const bankerGifs = [
"https://cdn.discordapp.com/attachments/1506606461935943761/1506606586280280104/banker1.gif?ex=6a0ee039&is=6a0d8eb9&hm=8573dd8b423f8882126d8e38239404c08d7287874c879b8a205c7e06517a3677&",
"https://cdn.discordapp.com/attachments/1506606461935943761/1506606586934853783/banker2.gif?ex=6a0ee039&is=6a0d8eb9&hm=5763a435c6e0b164e0ec972863548f5724fe4d270e1c7ff141e046a9ab2c0060&",
"https://cdn.discordapp.com/attachments/1506606461935943761/1506606588444545055/banker3.gif?ex=6a0ee03a&is=6a0d8eba&hm=687ff28c4961fde466b004d7fcb4590c9aa5d0dd62c0daf0496ab82394a1540f&"];

const playerGifs = [
"https://cdn.discordapp.com/attachments/1506606461935943761/1506606612322844722/player1.gif?ex=6a0ee03f&is=6a0d8ebf&hm=16ea42af4ee0bd99a4b03dc3617d67e1277585d3506f6d3084972adb5da00ed5&",
"https://cdn.discordapp.com/attachments/1506606461935943761/1506606612763381780/player2.gif?ex=6a0ee03f&is=6a0d8ebf&hm=970ef37d9c3fa91678dd768512a0fde52306ef3c1f9f9788733533893bb32928&",
"https://cdn.discordapp.com/attachments/1506606461935943761/1506606613161836604/player3.gif?ex=6a0ee03f&is=6a0d8ebf&hm=6a011a5d9da7dd844bb7c2e391e64920a638eb436db1d2f5ca63b50d7b75e0af&"];

async function startBaccaratRound(interaction, betAmount, emptyRounds = 0) {
    let bets = {};
    let bettingOpen = true;

        async function editReply(data) {
        try {
            await interaction.editReply(data);
        } catch (err) {
            console.error('[Baccarat] editReply failed:', err.message);
        }
    }

        function buildBettingContainer(disabled = false) {
        const container = new ContainerBuilder().setAccentColor(0xED4245);

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## <:1450goodnewseveryone:1491902883602628668> BACCARAT — LIVE`
            ),
            new TextDisplayBuilder().setContent(
                `-# <:acoin:1508147096631513188> **${betAmount.toLocaleString()} Coins** per click  ·  Betting ${disabled ? 'closed <:flork_hmmm31:1491903354786545714>' : 'open <a:a50b8244bb4234868aacc4abf0b8fc96:1511723371677614120>'}`
            )
        );

        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(WAITING_GIF)
            )
        );

        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

        container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('baccarat_player')
                    .setLabel('Player')
                    .setEmoji({ name: '🔵' })
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(disabled),
                new ButtonBuilder()
                    .setCustomId('baccarat_banker')
                    .setLabel('Banker')
                    .setEmoji({ name: '🔴' })
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(disabled)
            )
        );

        return container;
    }

        function buildResultContainer(result, gif, winnersText) {
        const isPlayer = result === 'player';
        const container = new ContainerBuilder()
            .setAccentColor(isPlayer ? 0x5865F2 : 0xED4245);

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## ${isPlayer ? '🔵' : '🔴'} Result: ||${result.toUpperCase()}||`
            ),
            new TextDisplayBuilder().setContent(
                `-# ${winnersText || 'No one won this round.'}`
            )
        );

        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(gif)
            )
        );

        return container;
    }

        await editReply({
        components: [buildBettingContainer()],
        flags: MessageFlags.IsComponentsV2,
        embeds: []
    });

        let msg;
    try {
        msg = await interaction.fetchReply();
    } catch (err) {
        console.error('[Baccarat] fetchReply failed:', err.message);
        return;
    }

    const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i => i.customId === 'baccarat_player' || i.customId === 'baccarat_banker',
        time: 7000
    });

    collector.on('collect', async i => {
        const userId = i.user.id;
        const side = i.customId === 'baccarat_player' ? 'player' : 'banker';

        if (!bettingOpen) {
            return i.reply({ content: '-# Betting is now closed!', flags: MessageFlags.Ephemeral });
        }

        if (store.getCoins(userId) < betAmount) {
            return i.reply({
                content: `-# Not enough coins! Need **${betAmount.toLocaleString()}** <:acoin:1508147096631513188>. Use </rewards:1512861685453685033> for free rewards!`,
                flags: MessageFlags.Ephemeral
            });
        }

        if (!bets[userId]) {
            bets[userId] = { side, amount: betAmount };
        } else {
            if (bets[userId].side !== side) {
                return i.reply({ content: '-# You can no longer change your bet!', flags: MessageFlags.Ephemeral });
            }
            bets[userId].amount += betAmount;
        }
        store.addCoins(userId, -betAmount);

        return i.reply({
            content: `-# Bet +${betAmount.toLocaleString()} <:acoin:1508147096631513188> on **${side}** | Total: **${bets[userId].amount.toLocaleString()}** <:acoin:1508147096631513188>`,
            flags: MessageFlags.Ephemeral
        });
    });

    collector.on('end', async () => {
        bettingOpen = false;

        const result = Math.random() < 0.5 ? 'player' : 'banker';
        const gif = result === 'player'
            ? playerGifs[Math.floor(Math.random() * playerGifs.length)]
            : bankerGifs[Math.floor(Math.random() * bankerGifs.length)];

        await editReply({
            components: [buildBettingContainer(true)],
            flags: MessageFlags.IsComponentsV2,
            embeds: []
        });

        setTimeout(async () => {
            let winnersLines = [];
            for (let userId in bets) {
                if (bets[userId].side === result) {
                    const winAmount = bets[userId].amount * 2;
                    store.addCoins(userId, winAmount);
                    winnersLines.push(`<@${userId}> won **${winAmount.toLocaleString()}** <:acoin:1508147096631513188>`);
                }
            }
            const winnersText = winnersLines.join('\n') || null;

            const nobodyBet = Object.keys(bets).length === 0;
            const newEmptyRounds = nobodyBet ? emptyRounds + 1 : 0;

            await editReply({
                components: [buildResultContainer(result, gif, winnersText)],
                flags: MessageFlags.IsComponentsV2,
                embeds: []
            });

            if (newEmptyRounds >= 20) {
                setTimeout(async () => {
                    const closedContainer = new ContainerBuilder()
                        .setAccentColor(0x808080)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent('## 🎰 Baccarat Closed'),
                            new TextDisplayBuilder().setContent('-# No one bet for 20 rounds. Session ended.')
                        );
                    await editReply({
                        components: [closedContainer],
                        flags: MessageFlags.IsComponentsV2,
                        embeds: []
                    });
                }, 7000);
                return;
            }

            setTimeout(() => {
                startBaccaratRound(interaction, betAmount, newEmptyRounds);
            }, 7000);
        }, 3000);
    });
}

module.exports = { startBaccaratRound, WAITING_GIF, bankerGifs, playerGifs };
