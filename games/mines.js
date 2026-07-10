'use strict';
const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const activeMinesGames = new Map();
const MINES_GRID_SIZE = 16; const MINES_HOUSE_EDGE = 0.97;
function minesMultiplier(mineCount, revealed) {
    const safeTiles = MINES_GRID_SIZE - mineCount;
    let mult = 1;
    for (let i = 0; i < revealed; i++) {
        mult *= (MINES_GRID_SIZE - i) / (safeTiles - i);
    }
    return mult * MINES_HOUSE_EDGE;
}

function minesFormatShort(num) {
    if (num >= 1e9) return (num / 1e9).toFixed(2).replace(/\.00$/, '') + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2).replace(/\.00$/, '') + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(2).replace(/\.00$/, '') + 'K';
    return num.toLocaleString();
}

function minesGenerateMines(mineCount) {
    const indices = Array.from({ length: MINES_GRID_SIZE }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return new Set(indices.slice(0, mineCount));
}

function minesSerialize(game) {
    return {
        userId: game.userId,
        bet: game.bet,
        mineCount: game.mineCount,
        mines: Array.from(game.mines),
        revealed: Array.from(game.revealed)
    };
}

function minesDeserialize(state) {
    return {
        userId: state.userId,
        bet: state.bet,
        mineCount: state.mineCount,
        mines: new Set(state.mines),
        revealed: new Set(state.revealed)
    };
}

function minesBuildContainer(game, status = 'playing') {
    const revealedCount = game.revealed.size;
    const currentMult = revealedCount > 0 ? minesMultiplier(game.mineCount, revealedCount) : 1;
    const currentPayout = Math.floor(game.bet * currentMult);
    const safeTiles = MINES_GRID_SIZE - game.mineCount;

    const accentColor = status === 'cashout' || status === 'win' ? 0x2ecc71
        : status === 'lose' ? 0xed4245 : 0x2c2f33;

    let statusLine = '';
    if (status === 'lose') {
        statusLine = `\n### 💥 Boom! You hit a bomb! <:acoin:1508147096631513188>${game.bet.toLocaleString()} lost`;
    } else if (status === 'cashout') {
        statusLine = `\n### <:acoin:1508147096631513188> Cashed Out! Won ${currentPayout.toLocaleString()} (${currentMult.toFixed(2)}x)`;
    } else if (status === 'win') {
        statusLine = `\n### <:acoin:1508147096631513188> Cleared the board! Won ${currentPayout.toLocaleString()} (${currentMult.toFixed(2)}x)`;
    }

        const hudLine = `<:acoin:1508147096631513188> Potential Win: **${minesFormatShort(currentPayout)}**\u2003•\u2003<a:bomb:1524009290590060634> Bombs: **${game.mineCount}**`;

        let ladderLine = '';
    if (status === 'playing') {
        const ladder = [];
        const startAt = Math.max(revealedCount, 1);
        for (let k = startAt; k <= safeTiles && ladder.length < 6; k++) {
            ladder.push(`\`${minesMultiplier(game.mineCount, k).toFixed(2)}x\``);
        }
        ladderLine = `\n-# ${ladder.join(' ')}`;
    }

    const container = new ContainerBuilder()
        .setAccentColor(accentColor)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## Mines (BETA)\n-# Bet: <:acoin:1508147096631513188>${game.bet.toLocaleString()} • Safe tiles: ${safeTiles}${statusLine}`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`${hudLine}${ladderLine}`)
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    for (let row = 0; row < 4; row++) {
        const rowButtons = [];
        for (let col = 0; col < 4; col++) {
            const idx = row * 4 + col;
            const isMine = game.mines.has(idx);
            const isRevealed = game.revealed.has(idx);
            let btn = new ButtonBuilder().setCustomId(`mines_${idx}`);

            if (status !== 'playing') {
                                if (isMine) {
                    btn.setEmoji('<a:bomb:1524009290590060634>').setStyle(ButtonStyle.Danger).setDisabled(true);
                } else if (isRevealed) {
                    btn.setEmoji('<:acoin:1508147096631513188>').setStyle(ButtonStyle.Success).setDisabled(true);
                } else {
                    btn.setEmoji('<:acoin:1508147096631513188>').setStyle(ButtonStyle.Secondary).setDisabled(true);
                }
            } else {
                if (isRevealed) {
                    btn.setEmoji('<:acoin:1508147096631513188>').setStyle(ButtonStyle.Success).setDisabled(true);
                } else {
                    btn.setEmoji('<:9049goldenbootychest:1521444446284025956>').setStyle(ButtonStyle.Secondary).setDisabled(false);
                }
            }
            rowButtons.push(btn);
        }
        container.addActionRowComponents(new ActionRowBuilder().addComponents(...rowButtons));
    }

    const cashOutDisabled = status !== 'playing' || revealedCount === 0;
    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('mines_cashout')
                .setLabel(revealedCount > 0 ? `Cash Out: ${minesFormatShort(currentPayout)}` : 'Cash Out')
                .setEmoji('<:acoin:1508147096631513188>')
                .setStyle(ButtonStyle.Success)
                .setDisabled(cashOutDisabled)
        )
    );

    return container;
}

module.exports = {
    activeMinesGames,
    MINES_GRID_SIZE,
    MINES_HOUSE_EDGE,
    minesMultiplier,
    minesFormatShort,
    minesGenerateMines,
    minesBuildContainer,
    minesSerialize,
    minesDeserialize,
};