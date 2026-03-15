/**
 * auth.js — Measurely account system
 *
 * Depends on:  PocketBase UMD CDN (window.PocketBase)
 * Exposes:     window.MeasurelyAuth, window._pb
 *
 * Usage (each page):
 *   <script src="…/pocketbase.umd.js"></script>
 *   <script src="js/sync.js"></script>
 *   <script src="js/auth.js"></script>
 *   <script>document.addEventListener('DOMContentLoaded', () => window.MeasurelyAuth.init());</script>
 */

(function () {
    'use strict';

    // ── Config ──────────────────────────────────────────────────────────────
    // Replace with your Cloudflare Tunnel URL once PocketBase is running.
    const PB_URL = 'https://api.measurely.uk';

    // ── State ───────────────────────────────────────────────────────────────
    let _pb       = null;
    let _listeners = [];

    // ── Initialise PocketBase client ────────────────────────────────────────
    function _createClient() {
        if (!window.PocketBase) {
            console.warn('[auth] PocketBase SDK not loaded — auth disabled');
            return null;
        }
        return new window.PocketBase(PB_URL);
    }

    // ── Notify listeners ────────────────────────────────────────────────────
    function _notify(user) {
        _listeners.forEach(cb => { try { cb(user); } catch (e) { console.error(e); } });
    }

    // ── Modal HTML ──────────────────────────────────────────────────────────
    function _renderModal() {
        const root = document.getElementById('auth-root');
        if (!root) return;

        root.innerHTML = `
<div class="mly-auth-backdrop" id="mlyAuthBackdrop" aria-hidden="true">
<div class="mly-auth-modal" id="mlyAuthModal" role="dialog" aria-modal="true" aria-labelledby="mlyAuthTitle">

    <!-- Sign-in panel -->
    <div class="mly-auth-panel" id="mlySignInPanel">
        <h2 class="mly-auth-title" id="mlyAuthTitle">Sign in to Measurely</h2>
        <p class="mly-auth-sub">Your room config and measurements sync across devices.</p>
        <form id="mlySignInForm" novalidate>
            <label class="mly-auth-label">
                Email
                <input type="email" id="mlyEmail" class="mly-auth-input" placeholder="you@example.com" autocomplete="email" required>
            </label>
            <label class="mly-auth-label">
                Password
                <input type="password" id="mlyPassword" class="mly-auth-input" placeholder="••••••••" autocomplete="current-password" required>
            </label>
            <div class="mly-auth-error" id="mlySignInError" role="alert" aria-live="polite"></div>
            <button type="submit" class="mly-auth-btn-primary" id="mlySignInBtn">Sign in</button>
        </form>
        <p class="mly-auth-switch">
            Don't have an account?
            <button type="button" class="mly-auth-link" id="mlyGoSignUp">Create one</button>
        </p>
        <div class="mly-auth-divider"><span>or</span></div>
        <button type="button" class="mly-auth-btn-ghost" id="mlySkipBtn">Continue without signing in →</button>
    </div>

    <!-- Sign-up panel -->
    <div class="mly-auth-panel" id="mlySignUpPanel" hidden>
        <h2 class="mly-auth-title">Create an account</h2>
        <p class="mly-auth-sub">Free. No credit card. Your data stays on your own Pi.</p>
        <form id="mlySignUpForm" novalidate>
            <label class="mly-auth-label">
                Email
                <input type="email" id="mlyEmailUp" class="mly-auth-input" placeholder="you@example.com" autocomplete="email" required>
            </label>
            <label class="mly-auth-label">
                Password
                <input type="password" id="mlyPasswordUp" class="mly-auth-input" placeholder="••••••••" autocomplete="new-password" required minlength="8">
            </label>
            <label class="mly-auth-label">
                Confirm password
                <input type="password" id="mlyPasswordUpConfirm" class="mly-auth-input" placeholder="••••••••" autocomplete="new-password" required>
            </label>
            <div class="mly-auth-error" id="mlySignUpError" role="alert" aria-live="polite"></div>
            <button type="submit" class="mly-auth-btn-primary" id="mlySignUpBtn">Create account</button>
        </form>
        <p class="mly-auth-switch">
            Already have an account?
            <button type="button" class="mly-auth-link" id="mlyGoSignIn">Sign in</button>
        </p>
        <div class="mly-auth-divider"><span>or</span></div>
        <button type="button" class="mly-auth-btn-ghost" id="mlySkipBtn2">Continue without signing in →</button>
    </div>

</div>
</div>`;

        // Wire up interactions — close only when clicking the backdrop itself, not the modal inside
        document.getElementById('mlyAuthBackdrop').addEventListener('click', function(e) {
            if (e.target === this) _closeModal();
        });
        document.getElementById('mlySkipBtn').addEventListener('click', _closeModal);
        document.getElementById('mlySkipBtn2').addEventListener('click', _closeModal);
        document.getElementById('mlyGoSignUp').addEventListener('click', () => _switchPanel('signup'));
        document.getElementById('mlyGoSignIn').addEventListener('click', () => _switchPanel('signin'));
        document.getElementById('mlySignInForm').addEventListener('submit', _handleSignIn);
        document.getElementById('mlySignUpForm').addEventListener('submit', _handleSignUp);

        // Keyboard close
        document.addEventListener('keydown', function onKey(e) {
            if (e.key === 'Escape') { _closeModal(); document.removeEventListener('keydown', onKey); }
        });
    }

    function _switchPanel(mode) {
        const signIn = document.getElementById('mlySignInPanel');
        const signUp = document.getElementById('mlySignUpPanel');
        if (!signIn || !signUp) return;
        if (mode === 'signup') {
            signIn.hidden = true; signUp.hidden = false;
            signUp.querySelector('input')?.focus();
        } else {
            signUp.hidden = true; signIn.hidden = false;
            signIn.querySelector('input')?.focus();
        }
    }

    function _openModal(mode = 'signin') {
        _renderModal();
        const backdrop = document.getElementById('mlyAuthBackdrop');
        if (!backdrop) return;
        if (mode === 'signup') _switchPanel('signup');
        backdrop.classList.add('open');
        document.body.classList.add('mly-auth-open');
        backdrop.querySelector('input')?.focus();
    }

    function _closeModal() {
        const backdrop = document.getElementById('mlyAuthBackdrop');
        backdrop?.classList.remove('open');
        document.body.classList.remove('mly-auth-open');
    }

    // ── Sign in handler ─────────────────────────────────────────────────────
    async function _handleSignIn(e) {
        e.preventDefault();
        if (!_pb) return;
        const email    = document.getElementById('mlyEmail').value.trim();
        const password = document.getElementById('mlyPassword').value;
        const errEl    = document.getElementById('mlySignInError');
        const btn      = document.getElementById('mlySignInBtn');

        errEl.textContent = '';
        btn.disabled = true;
        btn.textContent = 'Signing in…';

        try {
            await _pb.collection('users').authWithPassword(email, password);
            _closeModal();
            _updateNav(_pb.authStore.model);
            _notify(_pb.authStore.model);
            // Pull cloud data, then push any local-only data
            await window.MeasurelySync?.pullAll();
            await window.MeasurelySync?.pushLocalData();
        } catch (err) {
            errEl.textContent = _friendlyError(err);
            btn.disabled = false;
            btn.textContent = 'Sign in';
        }
    }

    // ── Sign up handler ─────────────────────────────────────────────────────
    async function _handleSignUp(e) {
        e.preventDefault();
        if (!_pb) return;
        const email    = document.getElementById('mlyEmailUp').value.trim();
        const password = document.getElementById('mlyPasswordUp').value;
        const confirm  = document.getElementById('mlyPasswordUpConfirm').value;
        const errEl    = document.getElementById('mlySignUpError');
        const btn      = document.getElementById('mlySignUpBtn');

        errEl.textContent = '';

        if (password !== confirm) {
            errEl.textContent = 'Passwords do not match.';
            return;
        }
        if (password.length < 8) {
            errEl.textContent = 'Password must be at least 8 characters.';
            return;
        }

        btn.disabled = true;
        btn.textContent = 'Creating account…';

        try {
            await _pb.collection('users').create({
                email,
                password,
                passwordConfirm: confirm,
            });
            // Auto-sign in after successful sign up
            await _pb.collection('users').authWithPassword(email, password);
            _closeModal();
            _updateNav(_pb.authStore.model);
            _notify(_pb.authStore.model);
            await window.MeasurelySync?.pullAll();
            await window.MeasurelySync?.pushLocalData();
        } catch (err) {
            errEl.textContent = _friendlyError(err);
            btn.disabled = false;
            btn.textContent = 'Create account';
        }
    }

    // ── User menu in header ─────────────────────────────────────────────────
    function _updateNav(user) {
        // Populate every #auth-user-slot on the page
        document.querySelectorAll('#auth-user-slot').forEach(slot => {
            if (!user) {
                slot.innerHTML = `
                    <button class="mly-auth-nav-btn" id="mlyNavSignIn" type="button">Sign in</button>`;
                slot.querySelector('#mlyNavSignIn')?.addEventListener('click', () => _openModal('signin'));
            } else {
                const initial = (user.email || user.username || '?')[0].toUpperCase();
                slot.innerHTML = `
                    <div class="mly-auth-avatar-wrap">
                        <button class="mly-auth-avatar" id="mlyNavAvatar" type="button"
                                aria-label="Account menu" aria-expanded="false" aria-haspopup="true">
                            ${initial}
                        </button>
                        <div class="mly-auth-dropdown" id="mlyNavDropdown" hidden>
                            <p class="mly-auth-dropdown-email">${user.email || user.username}</p>
                            <button class="mly-auth-dropdown-item" id="mlyNavSignOut" type="button">Sign out</button>
                        </div>
                    </div>`;

                const avatar   = slot.querySelector('#mlyNavAvatar');
                const dropdown = slot.querySelector('#mlyNavDropdown');

                avatar.addEventListener('click', () => {
                    const isOpen = !dropdown.hidden;
                    dropdown.hidden = isOpen;
                    avatar.setAttribute('aria-expanded', String(!isOpen));
                });

                // Close on outside click
                document.addEventListener('click', function handler(ev) {
                    if (!slot.contains(ev.target)) {
                        dropdown.hidden = true;
                        avatar.setAttribute('aria-expanded', 'false');
                        document.removeEventListener('click', handler);
                    }
                });

                slot.querySelector('#mlyNavSignOut')?.addEventListener('click', () => {
                    MeasurelyAuth.signOut();
                });
            }
        });
    }

    // ── Error message helper ────────────────────────────────────────────────
    function _friendlyError(err) {
        const msg = err?.message || err?.data?.message || String(err);
        if (/invalid.*credentials|password|not found/i.test(msg)) return 'Incorrect email or password.';
        if (/already exists|duplicate/i.test(msg))                 return 'An account with that email already exists.';
        if (/network|fetch|failed to fetch/i.test(msg))            return 'Cannot reach the server. Check your connection.';
        return msg || 'Something went wrong. Please try again.';
    }

    // ── Public API ──────────────────────────────────────────────────────────
    const MeasurelyAuth = {
        async init() {
            _pb = _createClient();
            if (!_pb) return;

            // PocketBase auto-restores token from localStorage — just wire the UI
            if (_pb.authStore.isValid) {
                _updateNav(_pb.authStore.model);
                _notify(_pb.authStore.model);
                // Background sync: pull any cloud changes into localStorage
                window.MeasurelySync?.pullAll().catch(() => {});
            } else {
                _updateNav(null);
            }

            // Reactively update nav on token expiry / external logout
            _pb.authStore.onChange(() => {
                _updateNav(_pb.authStore.isValid ? _pb.authStore.model : null);
                _notify(_pb.authStore.isValid ? _pb.authStore.model : null);
            });
        },

        async signIn(email, password) {
            if (!_pb) return;
            const authData = await _pb.collection('users').authWithPassword(email, password);
            _updateNav(authData.record);
            _notify(authData.record);
            await window.MeasurelySync?.pullAll();
            await window.MeasurelySync?.pushLocalData();
            return authData;
        },

        async signUp(email, password) {
            if (!_pb) return;
            await _pb.collection('users').create({
                email, password, passwordConfirm: password,
            });
            return MeasurelyAuth.signIn(email, password);
        },

        async signOut() {
            if (!_pb) return;
            _pb.authStore.clear();
            _updateNav(null);
            _notify(null);
        },

        getUser() {
            return _pb?.authStore.isValid ? _pb.authStore.model : null;
        },

        openModal(mode = 'signin') {
            _openModal(mode);
        },

        onAuthChange(cb) {
            if (typeof cb === 'function') _listeners.push(cb);
        },
    };

    // Expose globally
    window.MeasurelyAuth = MeasurelyAuth;
    window._pb = () => _pb;   // accessor for sync.js (avoids closure issues)

})();
