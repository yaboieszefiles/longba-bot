'use strict';

const { createCanvas, loadImage } = require('@napi-rs/canvas');

const RANK_COLORS = {
    1: '#FFD54A',
    2: '#C7CDD1',
    3: '#E08A4B',
};
const DEFAULT_RANK_COLOR = '#8B93A1';

const TAB_LABELS = {
    coins: 'coins',
    aura: 'aura',
};

const MIN_CARD_WIDTH = 260;
const MAX_CARD_WIDTH = 700;
const PADDING = 16;
const ROW_HEIGHT = 54;
const ROW_GAP = 8;
const AVATAR_SIZE = 40;
const END_SPACE = 24; // "onting space sa dulo" after the longest row's text

function drawRoundedRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
}

function fallbackAvatar(ctx, cx, cy, size, seedText) {
    const colors = ['#5865F2', '#EB459E', '#57F287', '#FEE75C', '#ED4245'];
    const idx = Math.abs([...String(seedText || '?')].reduce((a, c) => a + c.charCodeAt(0), 0)) % colors.length;
    ctx.save();
    drawRoundedRect(ctx, cx - size / 2, cy - size / 2, size, size, size * 0.18);
    ctx.fillStyle = colors[idx];
    ctx.fill();
    ctx.fillStyle = '#111214';
    ctx.font = `bold ${Math.floor(size * 0.45)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((seedText || '?').charAt(0).toUpperCase(), cx, cy + 1);
    ctx.restore();
}

async function drawAvatar(ctx, url, cx, cy, size, seedText) {
    ctx.save();
    drawRoundedRect(ctx, cx - size / 2, cy - size / 2, size, size, size * 0.18);
    ctx.clip();
    try {
        if (!url) throw new Error('no avatar url');
        const img = await loadImage(url);
        ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
        ctx.restore();
    } catch {
        ctx.restore();
        fallbackAvatar(ctx, cx, cy, size, seedText);
    }
}

// Draws (or, if measureOnly, just measures) the "#rank • name • value label" line.
// Returns the total width consumed, so callers can figure out the widest row.
function drawRowText(ctx, entry, label, rowColor, textX, textY, measureOnly) {
    const startX = textX;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const segments = [
        { text: `#${entry.rank}`, font: 'bold 15px sans-serif', color: rowColor, gapAfter: 8 },
        { text: '•', font: 'bold 15px sans-serif', color: '#5a5d63', gapAfter: 8 },
        { text: entry.username, font: '600 15px sans-serif', color: '#ffffff', gapAfter: 8 },
        { text: '•', font: 'bold 15px sans-serif', color: '#5a5d63', gapAfter: 8 },
        { text: Number(entry.value).toLocaleString(), font: 'bold 15px sans-serif', color: '#ffffff', gapAfter: 5 },
        { text: label, font: '13px sans-serif', color: '#9a9ea5', gapAfter: 0 },
    ];

    for (const seg of segments) {
        ctx.font = seg.font;
        if (!measureOnly) {
            ctx.fillStyle = seg.color;
            ctx.fillText(seg.text, textX, textY);
        }
        textX += ctx.measureText(seg.text).width + seg.gapAfter;
    }

    return textX - startX;
}

/**
 * Renders ONLY the rows (avatar, rank, name, value) — no header, footer, or bars.
 * Card width auto-fits to the widest row's content (plus a bit of end padding),
 * instead of always stretching to a fixed width.
 * Server name / tab title / page number are meant to be shown separately via
 * Discord Components V2 text around this image.
 *
 * @param {Object} opts
 * @param {'coins'|'aura'} opts.tab
 * @param {Array<{rank:number, userId:string, username:string, avatarURL:string|null, value:number}>} opts.entries
 * @returns {Promise<Buffer>} PNG buffer
 */
async function buildLeaderboardImage({ tab, entries }) {
    const label = TAB_LABELS[tab] || 'points';
    const rowCount = entries.length || 1;
    const height = PADDING * 2 + rowCount * ROW_HEIGHT + Math.max(0, rowCount - 1) * ROW_GAP;

    const textStartX = PADDING + 30 + AVATAR_SIZE / 2 + 16; // avatar center + gap to text

    // --- measuring pass: find the widest row so the card can shrink/fit to it ---
    const measureCanvas = createCanvas(10, 10);
    const measureCtx = measureCanvas.getContext('2d');
    let maxTextWidth = 0;
    for (const entry of entries) {
        const w = drawRowText(measureCtx, entry, label, '#000000', 0, 0, true);
        if (w > maxTextWidth) maxTextWidth = w;
    }

    const cardWidth = entries.length
        ? Math.min(MAX_CARD_WIDTH, Math.max(MIN_CARD_WIDTH, Math.ceil(textStartX + maxTextWidth + END_SPACE + PADDING)))
        : MIN_CARD_WIDTH;

    // --- draw pass ---
    const canvas = createCanvas(cardWidth, height);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#111114';
    drawRoundedRect(ctx, 0, 0, cardWidth, height, 16);
    ctx.fill();

    if (!entries.length) {
        ctx.fillStyle = '#9a9ea5';
        ctx.font = '15px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No leaderboard data available yet.', cardWidth / 2, height / 2);
        return canvas.toBuffer('image/png');
    }

    let y = PADDING;
    for (const entry of entries) {
        const rowColor = RANK_COLORS[entry.rank] || DEFAULT_RANK_COLOR;

        ctx.fillStyle = entry.rank <= 3 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.03)';
        drawRoundedRect(ctx, PADDING, y, cardWidth - PADDING * 2, ROW_HEIGHT, 10);
        ctx.fill();

        if (entry.rank <= 3) {
            ctx.fillStyle = rowColor;
            drawRoundedRect(ctx, PADDING, y, 4, ROW_HEIGHT, 2);
            ctx.fill();
        }

        const cx = PADDING + 30;
        const cy = y + ROW_HEIGHT / 2;
        await drawAvatar(ctx, entry.avatarURL, cx, cy, AVATAR_SIZE, entry.username);

        drawRowText(ctx, entry, label, rowColor, textStartX, cy, false);

        y += ROW_HEIGHT + ROW_GAP;
    }

    return canvas.toBuffer('image/png');
}

module.exports = { buildLeaderboardImage };
