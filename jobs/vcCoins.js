'use strict';
const {
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SectionBuilder,
    ThumbnailBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ComponentType, MessageFlags,
} = require('discord.js');
const store = require('../db/store');

function startVcCoinJob(client) {
    let activeUsersInVC = new Set();

setInterval(() => {
    client.guilds.cache.forEach(guild => {
        guild.channels.cache
            .filter(channel => channel.isVoiceBased())
            .forEach(channel => {
                const membersInVC = [...channel.members.values()].filter(m => !m.user.bot);
                if (membersInVC.length === 0) return;

                const now = Date.now();
                const earnedList = [];
                let totalCoins = 0;

                membersInVC.forEach(member => {
                    const userId = member.user.id;
                    if (activeUsersInVC.has(userId)) return;
                    activeUsersInVC.add(userId);

                    const userItem = store.getItems(userId);
                    const hascat = userItem.cat !== undefined;
                    const hasAnting2 = userItem.anting2 && userItem.anting2.expiresAt > now;
                    let bonus = 2000;
                    if (hasAnting2) bonus += 500;
                    if (hascat) bonus += 3500;

                    store.addCoins(userId, bonus);
                    totalCoins += bonus;
                    earnedList.push({ member, bonus, hascat, hasAnting2 });
                });

                                if (earnedList.length === 0 || !channel.isTextBased()) return;

                                const container = new ContainerBuilder().setAccentColor(0x5A5A5C);

                                container.addSectionComponents(
                    new SectionBuilder()
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(
                                `## <a:54748coffeesparkles:1511032334613479504> VC Coin Drop`
                            ),
                            new TextDisplayBuilder().setContent(
                                `-# ${guild.name} · <:acoin:1508147096631513188> **${totalCoins.toLocaleString()} Coins** distributed`
                            )
                        )
                        .setThumbnailAccessory(
                            new ThumbnailBuilder().setURL(
                                guild.iconURL({ dynamic: true }) ?? client.user.displayAvatarURL()
                            )
                        )
                );
                container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
                const earnerLines = earnedList.map(({ member, bonus, hascat, hasAnting2 }) => {
                    const perks = [];
                    if (hasAnting2) perks.push('<:anting2:1491119853854261308>');
                    if (hascat) perks.push('<a:cat:1496798083823046696>');
                    const perkStr = perks.length > 0 ? ` ${perks.join('')}` : '';
                    return `<@${member.user.id}>${perkStr} — <:acoin:1508147096631513188> **+${bonus.toLocaleString()}**`;
                }).join('\n');
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(earnerLines)
                );
                container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
                container.addActionRowComponents(
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('vc_coins_info')
                            .setLabel('How does this work?')
                            .setEmoji({ id: '1513425502608818357', name: 'penguhmmmath', animated: true })
                            .setStyle(ButtonStyle.Secondary)
                    )
                );
                channel.send({
                    components: [container],
                    flags: MessageFlags.IsComponentsV2,
                    allowedMentions: { parse: [] }
                }).then(sentMsg => {
                    const vcCollector = sentMsg.createMessageComponentCollector({
                        componentType: ComponentType.Button,
                        filter: i => i.customId === 'vc_coins_info',
                        time: 30 * 60 * 1000
                    });
                    vcCollector.on('collect', async i => {
                        const infoContainer = new ContainerBuilder().setAccentColor(0x5A5A5C)
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent('## <a:62594penguhmmmath:1513425502608818357> How VC Coins Work')
                            )
                            .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(
                                    '<:acoin:1508147096631513188> **Base Reward** — +2,000 Coins every 30 minutes in VC\n' +
                                    '<:anting2:1491119853854261308> **Anting-anting** — +500 bonus while active\n' +
                                    '<a:cat:1496798083823046696> **Cat** — +3,500 bonus while owned\n\n' +
                                    '-# Coins are given to everyone in the VC at the time of each drop.\n' +
                                    '-# Buy items from </shop:1491118301277847760> to boost your earnings!'
                                )
                            );
                        await i.reply({
                            components: [infoContainer],
                            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                        }).catch(() => {});
                    });
                    vcCollector.on('end', () => {
                        const expiredContainer = new ContainerBuilder().setAccentColor(0x5A5A5C);
                        expiredContainer.addSectionComponents(
                            new SectionBuilder()
                                .addTextDisplayComponents(
                                    new TextDisplayBuilder().setContent(
                                        `## <a:54748coffeesparkles:1511032334613479504> VC Coin Drop`
                                    ),
                                    new TextDisplayBuilder().setContent(
                                        `-# ${guild.name} · <:acoin:1508147096631513188> **${totalCoins.toLocaleString()} Coins** distributed`
                                    )
                                )
                                .setThumbnailAccessory(
                                    new ThumbnailBuilder().setURL(
                                        guild.iconURL({ dynamic: true }) ?? client.user.displayAvatarURL()
                                    )
                                )
                        );
                        expiredContainer.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
                        expiredContainer.addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(earnerLines)
                        );
                        expiredContainer.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
                        expiredContainer.addActionRowComponents(
                            new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId('vc_coins_info')
                                    .setLabel('How does this work?')
                                    .setEmoji({ id: '1513425502608818357', name: 'penguhmmmath', animated: true })
                                    .setStyle(ButtonStyle.Secondary)
                                    .setDisabled(true)
                            )
                        );
                        sentMsg.edit({
                            components: [expiredContainer],
                            flags: MessageFlags.IsComponentsV2
                        }).catch(() => {});
                    });
                }).catch(() => {});
            });
    });

    activeUsersInVC.clear();
}, 30 * 60 * 1000);

    return activeUsersInVC;
}

module.exports = { startVcCoinJob };
