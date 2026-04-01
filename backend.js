// Consolidated backend helpers and feature glue (keeps visuals from main but restores backend behavior)
(function () {
    // Re-use API_BASE and storage helpers from config.js which is expected to be loaded first.
    // The branch put many functions inline; we centralize them here and export minimal globals.

    function getStoredJwt() { return window.getStoredJwt && window.getStoredJwt(); }
    function setStoredJwt(t) { if (window.setStoredJwt) window.setStoredJwt(t); }
    function clearStoredJwt() { if (window.clearStoredJwt) window.clearStoredJwt(); }
    function authHeaders() { return window.authHeaders ? window.authHeaders() : {}; }
    function consumeJwtFromUrlHash() { if (window.consumeJwtFromUrlHash) window.consumeJwtFromUrlHash(); }

    // Expose some helpers used by the pages
    window.getStoredJwt = window.getStoredJwt || getStoredJwt;
    window.setStoredJwt = window.setStoredJwt || setStoredJwt;
    window.clearStoredJwt = window.clearStoredJwt || clearStoredJwt;
    window.authHeaders = window.authHeaders || authHeaders;
    window.consumeJwtFromUrlHash = window.consumeJwtFromUrlHash || consumeJwtFromUrlHash;

    // Login page behavior
    function wireLogin(formId, opts) {
        opts = opts || {};
        var form = document.getElementById(formId);
        if (!form) return;
        var submitBtn = form.querySelector('button[type="submit"]');
        var errorEl = document.getElementById(opts.errorId || 'loginError');

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var username = document.getElementById('username').value.trim();
            var password = document.getElementById('password').value;
            if (!username || !password) { showError('Please enter both username and password'); return; }
            if (!API_BASE || API_BASE === 'https://your-backend-url') { showError('Configure API_BASE in config.js'); return; }

            setLoading(true); hideError();
            fetch(API_BASE + '/authenticate', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                body: JSON.stringify({ username: username, password: password })
            }).then(function (res) {
                if (!res.ok) return res.text().then(function (text) { throw new Error(text || 'Login failed'); });
                var hdrToken = res.headers.get('X-JWT-Token') || res.headers.get('x-jwt-token');
                function finishLogin(token) {
                    if (!token) { setLoading(false); showError('Login succeeded on the server but the browser did not receive a token. Hard-refresh and try again.'); return; }
                    setStoredJwt(token);
                    window.location.href = 'test.html#asl_token=' + encodeURIComponent(token);
                }
                return res.clone().json().then(function (data) { var token = hdrToken || (data && (data.token || data.access_token)); finishLogin(token); }).catch(function () { return res.text().then(function (text) { var token = hdrToken; try { var data = JSON.parse(text); if (data && data.token) token = data.token; } catch (e) {} var m = text && text.match(/"token"\s*:\s*"([^\"]+)"/); if (m) token = m[1]; finishLogin(token); }); });
            }).catch(function (err) {
                setLoading(false);
                if (err && err.message && (err.message.toLowerCase().indexOf('invalid') !== -1 || err.message.indexOf('credentials') !== -1)) { showError('Invalid username or password'); }
                else if (err && err.message && (err.message.toLowerCase().indexOf('fetch') !== -1 || err.message.toLowerCase().indexOf('load') !== -1 || err.message === 'Failed to fetch')) { showError('Cannot reach server. Check config.js and that the backend is running at ' + API_BASE + '.'); }
                else { showError('Login failed. Please try again.'); }
            });

            function setLoading(loading) { if (submitBtn) { submitBtn.disabled = loading; submitBtn.textContent = loading ? 'Logging in…' : 'Login'; } }
            function showError(msg) { if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; } }
            function hideError() { if (errorEl) { errorEl.textContent = ''; errorEl.style.display = 'none'; } }
        });
    }

    // Register page behavior
    function wireRegister(formId, opts) {
        opts = opts || {};
        var form = document.getElementById(formId);
        if (!form) return;
        var submitBtn = form.querySelector('button[type="submit"]');
        var errorEl = document.getElementById(opts.errorId || 'registerError');

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var password = document.getElementById('password').value;
            var confirmPassword = document.getElementById('confirmPassword').value;
            if (password !== confirmPassword) { showError('Passwords do not match.'); return; }
            if (!API_BASE || API_BASE === 'https://your-backend-url') { showError('Configure API_BASE in config.js'); return; }
            var name = document.getElementById('name').value.trim();
            var email = document.getElementById('email').value.trim();
            var username = document.getElementById('username').value.trim();
            var dobInput = document.getElementById('dob').value;
            if (!name || !email || !username || !password || !dobInput) { showError('Please fill in all fields.'); return; }
            var dobParts = dobInput.split('-'); var dobStr = dobParts[1] + '-' + dobParts[2] + '-' + dobParts[0];
            setLoading(true); hideError();
            var params = new URLSearchParams({ email: email, password: password, name: name, username: username, dob: dobStr });
            fetch(API_BASE + '/api/person/post?' + params.toString(), { method: 'POST', credentials: 'include' })
                .then(function (res) { if (res.ok) { window.location.href = 'index.html'; } else { return res.text().then(function (text) { throw new Error(text || 'Registration failed'); }); } })
                .catch(function (err) { setLoading(false); var msg = err && err.message ? err.message : ''; if (msg.toLowerCase().indexOf('fetch') !== -1 || msg.toLowerCase().indexOf('load') !== -1 || msg === 'Failed to fetch') { showError('Cannot reach server. Is the backend running at ' + API_BASE + '? Check config.js.'); } else { showError(msg || 'Registration failed. Please try again.'); } });

            function setLoading(loading) { if (submitBtn) { submitBtn.disabled = loading; submitBtn.textContent = loading ? 'Creating account…' : 'Create account'; } }
            function showError(msg) { if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; } }
            function hideError() { if (errorEl) { errorEl.textContent = ''; errorEl.style.display = 'none'; } }
        });
    }

    // Public wiring functions for pages to call if they want the enhanced behavior
    window.backendWire = window.backendWire || { wireLogin: wireLogin, wireRegister: wireRegister };

    // Auto-wire known forms if present
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
    function init() {
        if (document.getElementById('loginForm')) wireLogin('loginForm');
        if (document.getElementById('registerForm')) wireRegister('registerForm');
    }
})();
