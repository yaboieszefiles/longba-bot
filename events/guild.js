'use strict';
const {
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SectionBuilder,
    ThumbnailBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const store = require('../db/store');
const { clearGuildMusicState } = require('../music/state');

function registerGuildEvents(client, { memberCache, seedGuildMemberCache }) {
    client.on('guildDelete', guild => {
    memberCache.delete(guild.id);
    store.clearGuildMembers(guild.id);
    clearGuildMusicState(guild.id);
});

    client.on('guildCreate', guild => {
    seedGuildMemberCache(guild).catch(err => {
        console.error(`[Cache] Failed to seed new guild ${guild.name}:`, err.message);
    });
});

    client.on('guildMemberRemove', member => {
    store.removeGuildMember(member.guild.id, member.id);
    memberCache.get(member.guild.id)?.delete(member.id);
});

    client.on('guildMemberUpdate', (oldMember, newMember) => {
    if (
        oldMember.user.username === newMember.user.username &&
        oldMember.user.globalName === newMember.user.globalName
    ) return;
    store.upsertGuildMember(newMember.guild.id, newMember.id, newMember.user.username, newMember.user.globalName);
    memberCache.get(newMember.guild.id)?.set(newMember.id, {
        user: { username: newMember.user.username, globalName: newMember.user.globalName }
    });
});

    client.on('guildMemberAdd', async member => {
    store.upsertGuildMember(member.guild.id, member.id, member.user.username, member.user.globalName);
    memberCache.get(member.guild.id)?.set(member.id, {
        user: { username: member.user.username, globalName: member.user.globalName }
    });

    if (member.guild.id === '1508725053204856862') return;
    try {
        const container = new ContainerBuilder().setAccentColor(0x5A5A5C);

        const serverIcon = member.guild.iconURL({ size: 256 }) || client.user.displayAvatarURL();

        const headerSection = new SectionBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## Welcome to **${member.guild.name}**!`),
                new TextDisplayBuilder().setContent(
                    `Hey ${member.user.username}, glad you're here.\n` +
                    `Love the bot? Add **Longba** to your own server too.`
                )
            )
            .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: serverIcon } }));

        container.addSectionComponents(headerSection);
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# Use </help:1491118301277847762> to see all available commands.`)
        );

        const joinBtn = new ButtonBuilder()
            .setLabel('Add to Your Server')
            .setStyle(ButtonStyle.Link)
            .setURL('https://discord.com/oauth2/authorize?client_id=1491110943873044640')
            .setEmoji('<a:chicken:1491117598417490032>');

        container.addActionRowComponents(
            new ActionRowBuilder().addComponents(joinBtn)
        );

        await member.send({
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });
    } catch (err) {
        console.log(`Could not DM ${member.user.tag}`);
    }
});
}

module.exports = { registerGuildEvents };
