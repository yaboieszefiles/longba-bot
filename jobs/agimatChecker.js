'use strict';

const store = require('../db/store');

function startAgimatChecker(client) {
    const notifiedExpiredAgimat = {};

setInterval(async () => {
    try {
        const now = Date.now();
        const allItemsMap = store.getAllItemsMap();
        const dogOwners = Object.entries(allItemsMap).filter(([, items]) => items?.dog);
        for (const userId in notifiedExpiredAgimat) {
            if (!allItemsMap[userId]?.dog) delete notifiedExpiredAgimat[userId];
        }
        const AGIMAT_DM_STALE_MS = 3 * 24 * 60 * 60 * 1000;         for (const [userId, userItem] of dogOwners) {
            const agimat = userItem.agimat;
            if (!agimat?.expiresAt) continue;
            if (now > agimat.expiresAt) {
                if (notifiedExpiredAgimat[userId]) continue;
                                                if (now - agimat.expiresAt > AGIMAT_DM_STALE_MS) {
                    notifiedExpiredAgimat[userId] = true;
                    continue;
                }
                try {
                    const user = await client.users.fetch(userId);
                    await user.send(
                        '<a:dog:1496797720432742421> Woof woof! Your **Agimat** has expired. Buy a new one from the shop now to stay safe from robberies! </shop:1491118301277847760>'
                    );
                    console.log(`Sent agimat expiry DM to ${user.tag}`);
                } catch {
                }
                notifiedExpiredAgimat[userId] = true;
            } else {
                delete notifiedExpiredAgimat[userId];
            }
        }
    } catch (error) {
        console.error('Agimat checker error:', error);
    }
}, 60 * 1000);
}

module.exports = { startAgimatChecker };
