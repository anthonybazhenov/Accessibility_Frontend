// Backend base URL (match Accessibility_Backend server.port, default 8085).
var API_BASE = 'http://localhost:8085';

/** Optional: ?api=http://127.0.0.1:8085 */
(function () {
    try {
        var q = new URLSearchParams(window.location.search);
        var api = q.get('api');
        if (api) {
            API_BASE = api.replace(/\/$/, '');
        }
    } catch (e) {}
})();

// JWT from login (needed when frontend and API are on different origins/ports)
var JWT_KEY = 'asl_jwt';

// In-memory fallback if both storages fail (still works for current tab after login-via-hash)
var jwtMemoryFallback = null;

function getStoredJwt() {
    if (jwtMemoryFallback) return jwtMemoryFallback;
    try {
        return sessionStorage.getItem(JWT_KEY) || localStorage.getItem(JWT_KEY);
    } catch (e) {
        return null;
    }
}

function setStoredJwt(token) {
    jwtMemoryFallback = token || null;
    try {
        sessionStorage.setItem(JWT_KEY, token);
    } catch (e) {}
    try {
        localStorage.setItem(JWT_KEY, token);
    } catch (e) {}
}

var ASL_USERNAME_KEY = 'asl_username';

function clearStoredJwt() {
    jwtMemoryFallback = null;
    try {
        sessionStorage.removeItem(JWT_KEY);
        localStorage.removeItem(JWT_KEY);
        localStorage.removeItem(ASL_USERNAME_KEY);
    } catch (e) {}
}

/** Read username from JWT payload (subject) when the profile API is unavailable. */
function usernameFromJwtToken(token) {
    if (!token || typeof token !== 'string') return '';
    try {
        var parts = token.split('.');
        if (parts.length < 2) return '';
        var json = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        var pad = json.length % 4;
        if (pad) json += new Array(5 - pad).join('=');
        var payload = JSON.parse(atob(json));
        var sub = payload.sub || payload.username || '';
        return typeof sub === 'string' ? sub : '';
    } catch (e) {
        return '';
    }
}

function authHeaders() {
    var h = {};
    var t = getStoredJwt();
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
}

/** Call on dashboard pages after login — reads #asl_token=... and saves it, then clears the hash. */
function consumeJwtFromUrlHash() {
    try {
        var h = window.location.hash;
        if (!h || h.indexOf('asl_token=') === -1) return;
        var m = h.match(/asl_token=([^&]+)/);
        if (!m || !m[1]) return;
        var token = decodeURIComponent(m[1]);
        if (token) {
            setStoredJwt(token);
        }
        if (window.history && window.history.replaceState) {
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
    } catch (e) {}
}
