'use strict';
const { REST, Routes } = require('discord.js');

function registerCommands(commands, token) {
    const rest = new REST({ version: '10' }).setToken(token);
    (async () => {
        try {
            console.log('Started refreshing application (/) commands.');
            await rest.put(
                Routes.applicationCommands('1498281564214263818'),
                { body: commands }
            );
            console.log('Successfully reloaded application (/) commands.');
        } catch (error) {
            console.error('Error reloading commands:', error);
        }
    })();
}

module.exports = { registerCommands };
