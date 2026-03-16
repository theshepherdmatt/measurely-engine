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
    const PB_URL = 'https://api.measurely.uk';

    // ── State ───────────────────────────────────────────────────────────────
    let _pb        = null;
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

    // ── Default room seed — "Pro Studio" starter layout ─────────────────────
    // Seeded for new OAuth users who have no cloud room record.
    // Furniture + treatment give a visually rich first experience so the
    // 3D room is never a blank void on first sign-in.
    const _DEFAULT_ROOM = {
        room_type: 'home',
        geometry: {
            width_m: 4.2, length_m: 5.5, height_m: 2.6,
            ceiling_type: 'flat', ceiling_height_secondary_m: 2.0,
            ceiling_slant_direction: 'left_to_right', ceiling_gable_axis: 'depth'
        },
        setup: {
            speaker_type: 'standmount', spk_spacing_m: 2.2, spk_front_m: 0.6,
            tweeter_height_m: 0.95, toe_in_deg: 10, listener_front_m: 2.8,
            listener_offset_m: 0, subwoofer: false
        },
        environment: {
            floor_material: 'hard',
            furniture: { opt_area_rug: true, opt_sofa: true, opt_coffee_table: false },
            treatment: { wall_panel_mode: 'front', side_panel_mode: 'both',
                         bass_trap_mode: 'corners', ceiling_panel_mode: 'none' }
        }
    };

    // ── Post-login handshake — shared by all sign-in paths ──────────────────
    async function _postLoginHandshake(isNewUser = false) {
        window.toast?.('Syncing your room…', 'info');

        const roomData = await window.MeasurelySync?.pullRoom();
        await window.MeasurelySync?.pullProfile();

        if (!roomData || isNewUser) {
            // New user or empty room record — seed Pro Studio defaults
            try { localStorage.setItem('measurely_room', JSON.stringify(_DEFAULT_ROOM)); } catch (_) {}
            // Signal Room3D so it rebuilds with the seeded layout immediately
            window.dispatchEvent(new CustomEvent('measurely:data-ready', { detail: { room: _DEFAULT_ROOM } }));
            await window.MeasurelySync?.pushRoom();
        }

        await window.MeasurelySync?.pushLocalData();
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

        <!-- Google — primary CTA -->
        <button type="button" class="mly-auth-btn-google" id="mlyGoogleSignInBtn" aria-label="Sign in with Google">
            <svg class="mly-google-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Sign in with Google
        </button>

        <div class="mly-auth-divider"><span>or sign in with email</span></div>

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

        <!-- Google — primary CTA -->
        <button type="button" class="mly-auth-btn-google" id="mlyGoogleSignUpBtn" aria-label="Sign up with Google">
            <svg class="mly-google-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
        </button>

        <div class="mly-auth-divider"><span>or sign up with email</span></div>

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

        // Wire up interactions
        document.getElementById('mlyAuthBackdrop').addEventListener('click', function(e) {
            if (e.target === this) _closeModal();
        });
        document.getElementById('mlySkipBtn').addEventListener('click', _closeModal);
        document.getElementById('mlySkipBtn2').addEventListener('click', _closeModal);
        document.getElementById('mlyGoSignUp').addEventListener('click', () => _switchPanel('signup'));
        document.getElementById('mlyGoSignIn').addEventListener('click', () => _switchPanel('signin'));
        document.getElementById('mlySignInForm').addEventListener('submit', _handleSignIn);
        document.getElementById('mlySignUpForm').addEventListener('submit', _handleSignUp);
        document.getElementById('mlyGoogleSignInBtn').addEventListener('click', () => _handleGoogleSignIn('mlyGoogleSignInBtn'));
        document.getElementById('mlyGoogleSignUpBtn').addEventListener('click', () => _handleGoogleSignIn('mlyGoogleSignUpBtn'));

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
        // Focus the Google button as the primary action
        setTimeout(() => document.getElementById('mlyGoogleSignInBtn')?.focus(), 50);
    }

    function _closeModal() {
        const backdrop = document.getElementById('mlyAuthBackdrop');
        backdrop?.classList.remove('open');
        document.body.classList.remove('mly-auth-open');
    }

    // ── Google OAuth2 handler ────────────────────────────────────────────────
    //
    // Redirect URL registered in Google Cloud Console (and in PocketBase OAuth2
    // settings) must be exactly:  https://api.measurely.uk/api/oauth2-redirect
    // The PocketBase SDK builds this URL automatically from PB_URL — no need to
    // pass it manually.  Just make sure the Google Console entry matches.
    //
    async function _handleGoogleSignIn(btnId) {
        if (!_pb) return;
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.disabled = true;
            btn.classList.add('mly-auth-btn-google--loading');
        }

        try {
            const authData = await _pb.collection('users').authWithOAuth2({
                provider: 'google',
                urlCallback: (url) => {
                    window.location.href = url;
                },
            });

            const record = authData.record;
            const meta   = authData.meta ?? {};

            // ── Explicit auth persistence ─────────────────────────────────────
            try {
                if (_pb.authStore.token) {
                    _pb.authStore.save(_pb.authStore.token, _pb.authStore.model);
                    // Export to cookie so session persists across dashboard/treatment pages
                    document.cookie = _pb.authStore.exportToCookie({ httpOnly: false });
                }
            } catch (_) {}

            // ── Profile sync — map Google name + avatar to PocketBase record ──
            const patch = {};
            if (meta.name      && !record.name)      patch.name      = meta.name;
            if (meta.avatarUrl && !record.avatarUrl) patch.avatarUrl = meta.avatarUrl;
            if (Object.keys(patch).length) {
                await _pb.collection('users').update(record.id, patch, { requestKey: null }).catch(() => {});
                Object.assign(_pb.authStore.model, patch);
            }

            _closeModal();
            _updateNav(_pb.authStore.model);
            _notify(_pb.authStore.model);

            const isNewUser = !!authData.meta?.isNew;
            await _postLoginHandshake(isNewUser);

            window.toast?.('Signed in with Google ✓', 'success');

            if (!window.location.pathname.includes('app.html')) {
                window.location.replace('app.html');
                return;
            }
            window.dashboard?.loadLatestSession?.();

        } catch (err) {
            if (btn) {
                btn.disabled = false;
                btn.classList.remove('mly-auth-btn-google--loading');
            }

            // User dismissed the flow — silent, not an error
            if (err?.isAbort || /cancel|popup|close|user.*denied/i.test(err?.message ?? '')) return;

            console.error('Manual Auth Error Detail:', err);
            window.toast?.(_friendlyError(err), 'error');
        }
    }

    // ── Sign in handler ──────────────────────────────────────────────────────
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
            if (!window.location.pathname.includes('app.html')) {
                window.location.replace('app.html');
                return;
            }
            await window.MeasurelySync?.pullAll();
            await window.MeasurelySync?.pushLocalData();
        } catch (err) {
            errEl.textContent = _friendlyError(err);
            btn.disabled = false;
            btn.textContent = 'Sign in';
        }
    }

    // ── Sign up handler ──────────────────────────────────────────────────────
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
                email, password, passwordConfirm: confirm,
            });
            await _pb.collection('users').authWithPassword(email, password);
            _closeModal();
            _updateNav(_pb.authStore.model);
            _notify(_pb.authStore.model);
            if (!window.location.pathname.includes('app.html')) {
                window.location.replace('app.html');
                return;
            }
            await window.MeasurelySync?.pullAll();
            await window.MeasurelySync?.pushLocalData();
        } catch (err) {
            errEl.textContent = _friendlyError(err);
            btn.disabled = false;
            btn.textContent = 'Create account';
        }
    }

    // ── User menu in header ──────────────────────────────────────────────────
    function _updateNav(user) {
        document.querySelectorAll('#auth-user-slot').forEach(slot => {
            if (!user) {
                slot.innerHTML = `
                    <button class="mly-auth-nav-btn" id="mlyNavSignIn" type="button">Sign in</button>`;
                slot.querySelector('#mlyNavSignIn')?.addEventListener('click', () => _openModal('signin'));
            } else {
                // Prefer Google avatar URL (OAuth2) then fall back to PB file, then initial
                const avatarUrl = user.avatar
                    ? `${PB_URL}/api/files/users/${user.id}/${user.avatar}`
                    : (user.avatarUrl || null);

                // Display name: prefer Google name, fall back to email prefix
                const displayName = user.name || user.email || user.username || '?';
                const initial     = displayName[0].toUpperCase();

                const avatarInner = avatarUrl
                    ? `<img src="${avatarUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" referrerpolicy="no-referrer">`
                    : initial;

                slot.innerHTML = `
                    <div class="mly-auth-avatar-wrap">
                        <button class="mly-auth-avatar" id="mlyNavAvatar" type="button"
                                aria-label="Account menu" aria-expanded="false" aria-haspopup="true"
                                style="${avatarUrl ? 'padding:0;overflow:hidden;' : ''}">
                            ${avatarInner}
                        </button>
                        <div class="mly-auth-dropdown" id="mlyNavDropdown" hidden>
                            <p class="mly-auth-dropdown-email">${user.email || user.username}</p>
                            <button class="mly-auth-dropdown-item-profile" id="mlyNavProfile" type="button">Hi-Fi Profile</button>
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

                document.addEventListener('click', function handler(ev) {
                    if (!slot.contains(ev.target)) {
                        dropdown.hidden = true;
                        avatar.setAttribute('aria-expanded', 'false');
                        document.removeEventListener('click', handler);
                    }
                });

                slot.querySelector('#mlyNavProfile')?.addEventListener('click', () => {
                    dropdown.hidden = true;
                    window.MeasurelyProfile?.openModal();
                });

                slot.querySelector('#mlyNavSignOut')?.addEventListener('click', () => {
                    MeasurelyAuth.signOut();
                });
            }
        });
    }

    // ── Error message helper ─────────────────────────────────────────────────
    function _friendlyError(err) {
        const msg = err?.message || err?.data?.message || String(err);
        if (/invalid.*credentials|password|not found/i.test(msg)) return 'Incorrect email or password.';
        if (/already exists|duplicate/i.test(msg))                 return 'An account with that email already exists.';
        if (/network|fetch|failed to fetch/i.test(msg))            return 'Cannot reach the server. Check your connection.';
        return msg || 'Something went wrong. Please try again.';
    }

    // ── Public API ───────────────────────────────────────────────────────────
    const MeasurelyAuth = {
        async init() {
            _pb = _createClient();
            if (!_pb) return;

            if (_pb.authStore.isValid) {
                _updateNav(_pb.authStore.model);
                _notify(_pb.authStore.model);
                window.MeasurelySync?.pullAll().catch(() => {});
            } else {
                _updateNav(null);
            }

            _pb.authStore.onChange(() => {
                _updateNav(_pb.authStore.isValid ? _pb.authStore.model : null);
                _notify(_pb.authStore.isValid ? _pb.authStore.model : null);
            });
        },

        async signInWithGoogle() {
            return _handleGoogleSignIn('mlyGoogleSignInBtn');
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
            try { localStorage.removeItem('mly_pending_profile'); } catch (_) {}
            _updateNav(null);
            _notify(null);
            window.location.replace('index.html');
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
    window._pb = () => _pb;

})();
