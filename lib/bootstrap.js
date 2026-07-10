const originalWarn = console.warn;
console.warn = (...args) => {
    if (typeof args[0] === 'string' && args[0].includes('[YOUTUBEJS]')) return;
    originalWarn(...args);
};

const originalError = console.error;
console.error = (...args) => {
    if (typeof args[0] === 'string' && args[0].includes('[YOUTUBEJS]')) return;
    originalError(...args);
};
const _origFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
    const res = await _origFetch(...args);
    if (!res.ok) console.trace('[fetch error]', args[0], res.status);
    return res;
};
