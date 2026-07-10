'use strict';

function registerVoiceEvents(client, { getQueue, disableNowPlayingControls }) {
    client.on('voiceStateUpdate', (oldState, newState) => {
    const oldMember = oldState.member;
    const newMember = newState.member;
    if (newState.channel && !oldState.channel) {
        if (!newMember.user.bot) {
            console.log(`${newMember.user.tag} has joined a voice channel.`);
        }
    }
    if (!newState.channel && oldState.channel) {
        if (!oldMember.user.bot) {
            console.log(`${oldMember.user.tag} has left a voice channel.`);
        }
    }

    if (
        oldState.member?.id === client.user.id &&
        oldState.channel &&
        !newState.channel
    ) {
        const guildId = oldState.guild.id;
        const queue = getQueue(guildId);
        if (queue) queue.delete();
        disableNowPlayingControls(guildId, '⏹  Bot was disconnected.');
    }
});
}

module.exports = { registerVoiceEvents };
