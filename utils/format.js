'use strict';

function formatCooldown(ms) {
    const totalSeconds = Math.ceil(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
    return parts.join(' ');
}

const emojiIap = {
    'anting2': '<:anting2:1491119853854261308>',
    'agimat': '<:agimat:1491119820358553600>',
    'Chicken': '<a:chicken:1491117598417490032>',
    'ak': '<:ak47:1491119777635106887>',
    'Bag': '<:bag:1491120194670821426>',
    'mask': '<:mask:1491119765027029124>',
    'Coke': '<:cocaine:1491119792910897272>',
    'Weed': '<:jointtttt:1514466300485832894>',
    'Marlboro': '<:cigg:1514467639400071328>',
    'Hamster' : '<a:hmster:1506538001088643153>',
    'Cat' : '<a:cat:1496798083823046696>',
    'Dog' : '<a:dog:1496797720432742421>'
};

function getRoleForAura(aura) {
    if (aura >= 100000) return '+100000 Aura (Lv. 100)';
    if (aura >= 75000) return '+75000 Aura (Lv. 75)';
    if (aura >= 50000) return '+50000 Aura (Lv. 50)';
    if (aura >= 25000) return '+25000 Aura (Lv. 25)';
    if (aura >= 10000) return '+10000 Aura (Lv. 10)';
    if (aura >= 1000) return '+1000 Aura (Lv. 5)';
    return 'smoker';
}

module.exports = { formatCooldown, getRoleForAura };
