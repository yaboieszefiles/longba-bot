'use strict';
const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../lib/constants');

function buildCommands() {
    return [
    new SlashCommandBuilder()
        .setName('play')
        .setDescription('Spin a track or drop a Spotify link, DJ.')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Song name, or a Spotify link')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('profile')
        .setDescription('Pull up somebody\'s file — see what they\'re working with.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to view the profile of')
                .setRequired(false)
        ),
    new SlashCommandBuilder()
        .setName('rewards')
        .setDescription('Put in the work, collect your cut — free Gifts waiting.'),
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Rundown of everything this outfit\'s got.'),
    new SlashCommandBuilder()
        .setName('serverhop')
        .setDescription('Scope out other turfs where the crew\'s operating.'),
    new SlashCommandBuilder()
        .setName('marry')
        .setDescription('Put a ring on it — make it official.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to marry')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('blackjack')
        .setDescription('Sit at the table — Blackjack, 50,000 Coins max on the line.')
        .addIntegerOption(option =>
            option.setName('bet')
                .setDescription('Amount to bet')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(50000)
        ),
    new SlashCommandBuilder()
        .setName('mines')
        .setDescription('Step through the minefield and cash out before you get blown up.')
        .addIntegerOption(option =>
            option.setName('bet')
                .setDescription('Amount to bet')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(50000)
        )
        .addIntegerOption(option =>
            option.setName('bombs')
                .setDescription('Number of bombs on the 4x4 board (1-15)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(15)
        ),
    new SlashCommandBuilder()
    .setName('divorce')
    .setDescription('Cut ties with your partner — walk away clean.'),
    new SlashCommandBuilder()
        .setName('pet')
        .setDescription('Send your pet out to work.')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Choose your pet')
                .setRequired(true)
                .addChoices(
                    { name: 'Cat', value: 'cat' },
                    { name: 'Hamster', value: 'hamster' },
                    { name: 'Dog', value: 'dog' },
                    { name: 'Fox', value: 'fox' },
                    { name: 'Crow', value: 'crow' },
                    { name: 'Kitsune', value: 'kitsune' },
                    { name: 'Owl', value: 'owl' },
                    { name: 'Rabbit', value: 'rabbit' },
                    { name: 'Rat', value: 'rat' },
                    { name: 'Raccoon', value: 'raccoon' },
                    { name: 'Octopus', value: 'octopus' },
                    { name: 'Monkey', value: 'monkey' }
                )
        )
        .addUserOption(option =>
            option.setName('target')
                .setDescription('Target user')
                .setRequired(false)
        ),
    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('See who\'s really running this town — the top earners.'),
    new SlashCommandBuilder()
        .setName('baccarat')
        .setDescription('Take a seat for Baccarat — high stakes, no mercy.')
        .addIntegerOption(option =>
            option
                .setName('amount')
                .setDescription('Bet amount per click (max 50,000)')
                .setRequired(true)
                .setMinValue(1000)
                .setMaxValue(50000)
        ),
    new SlashCommandBuilder()
        .setName('craft')
        .setDescription('Cook up product in the back room (need an AK, Mask, and Bag).')
        .addStringOption(option =>
            option.setName('item')
                .setDescription('Item to craft')
                .setRequired(true)
                .addChoices(
                    { name: 'Coke', value: 'cocaine' },
                    { name: 'Weed', value: 'marijuana' }
                )),
    new SlashCommandBuilder()
        .setName('rob')
        .setDescription('Run up on somebody and try to take their Coins.')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user you want to rob')
                .setRequired(true)
        ),
        new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Collect your daily cut — 5,000 Coins, no questions asked.'),
    new SlashCommandBuilder()
        .setName('shop')
        .setDescription('Check what\'s moving in the black market.'),
    new SlashCommandBuilder()
        .setName('colorgame')
        .setDescription('Put your Coins on a color and let the dice decide your fate.')
        .addStringOption(option =>
            option.setName('color')
                .setDescription('The color you want to bet on')
                .setRequired(true)
                .addChoices(
                    colors.map(color => ({ name: color.name, value: color.name.toLowerCase() })))
        )
        .addIntegerOption(option =>
            option.setName('bet')
                .setDescription('The amount of Coins to bet')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('coins')
        .setDescription('Count your stash — check your Coins balance.'),
    new SlashCommandBuilder()
        .setName('give')
        .setDescription('Pass off Coins or product to one of your own.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to give to')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('type')
                .setDescription('What do you want to give?')
                .setRequired(true)
                .addChoices(
                    { name: 'Coins', value: 'coins' },
                    { name: 'Coke', value: 'cocaine' },
                    { name: 'Weed', value: 'marijuana' },
                    { name: 'Gift', value: 'gift' },
                    { name: 'Token', value: 'token' }

                ))
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Amount to give')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('coinflip')
        .setDescription('Call it in the air — heads or tails, Coins on the line.')
        .addStringOption(option =>
            option.setName('side')
                .setDescription('Heads or tails?')
                .setRequired(true)
                .addChoices(
                    { name: 'Heads', value: 'heads' },
                    { name: 'Tails', value: 'tails' }
                ))
        .addIntegerOption(option =>
            option.setName('bet')
                .setDescription('The amount of Coins to bet')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('cockfight')
        .setDescription('Throw your chicken in the ring and bet on the win.')
        .addIntegerOption(option =>
            option.setName('bet')
                .setDescription('The amount of Coins to bet')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('sell')
        .setDescription('Offload product to the buyer and cash in.')
        .addStringOption(option =>
            option.setName('item')
                .setDescription('The item you want to sell (e.g., Coke, Weed)')
                .setRequired(true)
                .addChoices(
                    { name: 'Coke', value: 'cocaine' },
                    { name: 'Weed', value: 'marijuana' }
                )),
    new SlashCommandBuilder()
        .setName('use')
        .setDescription('Use whatever you got on hand.')
        .addStringOption(option =>
            option.setName('item')
                .setDescription('The item you want to use (e.g., Coke, Weed, Gift)')
                .setRequired(true)
                .addChoices(
                    { name: 'Coke', value: 'cocaine' },
                    { name: 'Weed', value: 'marijuana' },
                    { name: 'Gift', value: 'gift' }
                )),
    new SlashCommandBuilder()
        .setName('smoke')
        .setDescription('Light one up and let the Aura hit different.'),
    ];
}

module.exports = { buildCommands };