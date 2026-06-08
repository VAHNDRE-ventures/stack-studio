/**
 * Shared utilities
 * Loaded before every other script. Keep this dependency-free.
 */

/**
 * Escape a value for safe insertion into HTML text or an attribute value.
 * Real-world stack data (descriptions, responsibilities, names) routinely
 * contains quotes, angle brackets, backticks and ampersands. Injecting those
 * raw into innerHTML/template literals corrupts the markup or opens XSS.
 *
 * @param {*} value - any value; coerced to string. null/undefined -> ''
 * @returns {string} escaped string safe for both text nodes and "..."/'...' attributes
 */
function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/`/g, '&#96;');
}

/**
 * Escape a value for safe insertion into a single-quoted inline JS handler
 * argument (e.g. onclick="doThing('${escapeJsString(id)}')"). Prevents quote
 * breakouts in generated handlers. Prefer addEventListener where practical.
 *
 * @param {*} value
 * @returns {string}
 */
function escapeJsString(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
}

/**
 * Normalize a single connection entry to the canonical object form.
 * The app standardizes on { targetId, type } objects (the format real
 * exports such as sample-saas.json use). Older numeric/array forms are coerced.
 *
 * @param {(number|string|{targetId:*,type?:string})} conn
 * @returns {{targetId:*, type:string}}
 */
function normalizeConnection(conn) {
    if (conn && typeof conn === 'object') {
        return { targetId: conn.targetId, type: conn.type || 'HTTP' };
    }
    return { targetId: conn, type: 'HTTP' };
}

/**
 * Get a layer's connections as canonical { targetId, type } objects.
 * Tolerates the legacy parallel-array form (connections:[ids] +
 * connectionTypes:{id:type}) if it is ever encountered.
 *
 * @param {Object} layer
 * @returns {Array<{targetId:*, type:string}>}
 */
function getConnections(layer) {
    if (!layer || !layer.connections) return [];
    return layer.connections.map(conn => {
        const normalized = normalizeConnection(conn);
        // Honor a legacy connectionTypes map if the entry was a bare id.
        if ((conn === null || typeof conn !== 'object') &&
            layer.connectionTypes && layer.connectionTypes[conn]) {
            normalized.type = layer.connectionTypes[conn];
        }
        return normalized;
    });
}

/**
 * Currency symbol for a currency code, falling back to the code itself.
 * @param {string} currency
 * @returns {string}
 */
function currencySymbol(currency) {
    switch (currency) {
        case 'USD': return '$';
        case 'EUR': return '\u20AC';
        case 'GBP': return '\u00A3';
        case 'JPY': return '\u00A5';
        default: return currency || '$';
    }
}

// Expose for any module/test that prefers explicit access.
if (typeof window !== 'undefined') {
    window.escapeHtml = escapeHtml;
    window.escapeJsString = escapeJsString;
    window.normalizeConnection = normalizeConnection;
    window.getConnections = getConnections;
    window.currencySymbol = currencySymbol;
}
