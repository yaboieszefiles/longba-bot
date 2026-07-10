'use strict';
const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const store = require('../db/store');

const CARD_EMOJIS = {
    'A♠': '<:AS:1515678194085265540>', '2♠': '<:2S:1515678118726078555>', '3♠': '<:3S:1515678127572123810>', '4♠': '<:4S:1515678135503421540>',
    '5♠': '<:5S:1515678143745228850>', '6♠': '<:6S:1515678152947531806>', '7♠': '<:7F:1515678156877725716>', '8♠': '<:8S:1515678168852201473>',
    '9♠': '<:9S:1515678177224167556>', '10♠': '<:10S:1515678186199978154>', 'J♠': '<:JS:1515678199076356186>', 'Q♠': '<:QS:1515678203631370280>', 'K♠': '<:KS:1515678201257394267>',
    'A♥': '<:AH:1515678191921004685>', '2♥': '<:2H:1515678116763406376>', '3♥': '<:3H:1515678125365792778>', '4♥': '<:4H:1515678132974391347>',
    '5♥': '<:5H:1515678141450813590>', '6♥': '<:6H:1515678150498189392>', '7♥': '<:7H:1515678158710509700>', '8♥': '<:8H:1515678167350771843>',
    '9♥': '<:9H:1515678174464180335>', '10♥': '<:10H:1515678183926796369>', 'J♥': '<:JS:1515678199076356186>', 'Q♥': '<:QS:1515678203631370280>', 'K♥': '<:KS:1515678201257394267>',
    'A♦': '<:AD:1515678188141809835>', '2♦': '<:2D:1515678112392806470>', '3♦': '<:3D:1515678121377009757>', '4♦': '<:4D:1515678129723539626>',
    '5♦': '<:5D:1515678137579737210>', '6♦': '<:6D:1515678145888649411>', '7♦': '<:7D:1515678154973511710>', '8♦': '<:8D:1515678163315851356>',
    '9♦': '<:9D:1515678171314262127>', '10♦': '<:10D:1515678179854123158>', 'J♦': '<:JS:1515678199076356186>', 'Q♦': '<:QS:1515678203631370280>', 'K♦': '<:KS:1515678201257394267>',
    'A♣': '<:AF:1515678189966458951>', '2♣': '<:2F:1515678114594951260>', '3♣': '<:3F:1515678123373625435>', '4♣': '<:4F:1515678131477020773>',
    '5♣': '<:5F:1515678139718565938>', '6♣': '<:6F:1515678147754983524>', '7♣': '<:7F:1515678156877725716>', '8♣': '<:8F:1515678165324922900>',
    '9♣': '<:9F:1515678173151625216>', '10♣': '<:10F:1515678181850353785>', 'J♣': '<:JS:1515678199076356186>', 'Q♣': '<:QS:1515678203631370280>', 'K♣': '<:KS:1515678201257394267>',
    'BACK': '<:BACK:1515678196534612151>',
};

const activeBJGames = new Map();

function bjCreateDeck() {
    const suits = ['\u2660', '\u2665', '\u2666', '\u2663'];
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const deck = [];
    for (const suit of suits) for (const rank of ranks) deck.push(rank + suit);
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function bjCardValue(card) {
    const rank = card.slice(0, -1);
    if (['J', 'Q', 'K'].includes(rank)) return 10;
    if (rank === 'A') return 11;
    return parseInt(rank);
}

function bjCalcHand(hand) {
    let total = 0, aces = 0;
    for (const card of hand) { total += bjCardValue(card); if (card.startsWith('A')) aces++; }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return total;
}

function bjCardEmoji(card) { return CARD_EMOJIS[card] || card; }

function bjRenderHand(hand, hideSecond = false) {
    return hand.map((card, i) => hideSecond && i === 1 ? bjCardEmoji('BACK') : bjCardEmoji(card)).join(' ');
}

function bjBuildContainer(game, status = 'playing') {
    const playerTotal = bjCalcHand(game.playerHand);
    const dealerTotal = status === 'playing' ? bjCalcHand([game.dealerHand[0]]) : bjCalcHand(game.dealerHand);
    const accentColor = status === 'win' || status === 'blackjack' ? 0x2ecc71
        : status === 'lose' || status === 'bust' ? 0xed4245
        : status === 'push' ? 0xf1c40f : 0x2c2f33;

    const statusLine = status === 'win' ? `\n### You Win! <:acoin:1508147096631513188> ${(game.bet * 2).toLocaleString()}`
        : status === 'blackjack' ? `\n### <:acoin:1508147096631513188> Blackjack! ${(game.bet + Math.floor(game.bet * 1.5)).toLocaleString()}`
        : status === 'lose' ? `\n### <:69814baddrawnsasukethinking:1491131977791836374> You Lose! <:acoin:1508147096631513188>${game.bet.toLocaleString()}`
        : status === 'bust' ? `\n### 💥 Bust! <:acoin:1508147096631513188>${game.bet.toLocaleString()} lost`
        : status === 'push' ? `\n### 🤝 Tie <:acoin:1508147096631513188>${game.bet.toLocaleString()} returned` : '';

    const dealerDisplay = status === 'playing'
        ? `${bjCardEmoji(game.dealerHand[0])} ${bjCardEmoji('BACK')}  •  **${dealerTotal}**`
        : `${bjRenderHand(game.dealerHand)}  •  **${dealerTotal}**`;

    const container = new ContainerBuilder()
        .setAccentColor(accentColor)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## 🃏 Blackjack (BETA)\n-# Bet: <:acoin:1508147096631513188>${game.bet.toLocaleString()}${statusLine}`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `**Dealer** — ${dealerDisplay}\n**You** — ${bjRenderHand(game.playerHand)}  •  **${playerTotal}**`
            )
        );

    if (status === 'playing') {
        const canDouble = game.playerHand.length === 2 && store.getCoins(game.userId) >= game.bet;
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
        container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('bj_hit').setLabel('Hit').setEmoji({ name: '👊' }).setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('bj_stand').setLabel('Stand').setEmoji({ name: '✋' }).setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('bj_double').setLabel('Double Down').setEmoji('<:acoin:1508147096631513188>').setStyle(ButtonStyle.Secondary).setDisabled(!canDouble)
            )
        );
    }
    return container;
}

function bjDealerPlay(game) {
    while (bjCalcHand(game.dealerHand) < 17) game.dealerHand.push(game.deck.pop());
}

function bjResolve(game) {
    const p = bjCalcHand(game.playerHand);
    const d = bjCalcHand(game.dealerHand);
    return d > 21 || p > d ? 'win' : p === d ? 'push' : 'lose';
}

function bjSerialize(game) {
    return {
        userId: game.userId,
        bet: game.bet,
        deck: game.deck,
        playerHand: game.playerHand,
        dealerHand: game.dealerHand
    };
}

function bjDeserialize(state) {
    return {
        userId: state.userId,
        bet: state.bet,
        deck: state.deck,
        playerHand: state.playerHand,
        dealerHand: state.dealerHand
    };
}

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
    bjSerialize,
    bjDeserialize,
};