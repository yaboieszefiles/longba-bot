'use strict';

const WATCHADS_GIFTS = 3;
const pendingKeys = new Map();

async function getLinkvertiseLink(discordId) {
    try {
        // Generate unique key para sa user
        const key = require('crypto').randomBytes(8).toString('hex');
        pendingKeys.set(key, { discordId, createdAt: Date.now() });

        // Clean up expired keys (24 hours)
        for (const [k, v] of pendingKeys.entries()) {
            if (Date.now() - v.createdAt > 24 * 60 * 60 * 1000) pendingKeys.delete(k);
        }

        const redeemUrl = `https://longba-bot.github.io/main/redeem.html?k=${key}`;

        const userId = process.env.LINKVERTISE_USER_ID;
        const randomNum = Math.random() * 1000;
        const encoded = Buffer.from(encodeURI(redeemUrl), 'binary').toString('base64');

        return `https://link-to.net/${userId}/${randomNum}/dynamic?r=${encoded}`;
    } catch (err) {
        console.error('[Linkvertise] GetLink error:', err.message);
    }
    return null;
}

module.exports = { WATCHADS_GIFTS, pendingKeys, getLinkvertiseLink };
