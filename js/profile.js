/**
 * profile.js — Measurely Hi-Fi Profile editor
 *
 * Depends on: auth.js (window.MeasurelyAuth, window._pb), sync.js (window.MeasurelySync)
 * Exposes:    window.MeasurelyProfile = { openModal, closeModal, getProfile }
 *
 * Loads lazily: the modal DOM is only injected into the page on first openModal() call.
 * Caches the user's profile data in module scope and in window.__MLY_PROFILE__ so
 * the Acoustic Co-Pilot (davePhraseEngine / dashboard analysis) can reference it.
 */

(function () {
    'use strict';

    const PB_URL = 'https://api.measurely.uk';

    const GENRES = [
        'Classical', 'Jazz', 'Electronic', 'Rock', 'Pop',
        'Hip-Hop', 'Folk / Acoustic', 'Metal', 'R&B / Soul',
        'World Music', 'Film Score', 'Ambient',
    ];

    const LEVELS = [
        { key: 'casual',       label: 'Casual',       hint: 'Background listening, convenience first' },
        { key: 'enthusiast',   label: 'Enthusiast',   hint: 'Dedicated space, quality matters' },
        { key: 'audiophile',   label: 'Audiophile',   hint: 'High-end system, critical listening' },
        { key: 'professional', label: 'Professional', hint: 'Studio, mastering or recording' },
    ];

    // ── Module state ────────────────────────────────────────────────────────
    let _backdrop       = null;
    let _profile        = {};
    let _gearItems      = [];   // working copy while the editor is open
    let _avatarFile     = null; // unused — avatar upload disabled
    let _device         = null; // paired Measurely Remote device record
    let _sweepPollTimer = null;

    // ── DOM injection ────────────────────────────────────────────────────────
    function _inject() {
        if (document.getElementById('mlyProfileBackdrop')) {
            _backdrop = document.getElementById('mlyProfileBackdrop');
            return;
        }

        const el = document.createElement('div');
        el.id = 'mlyProfileBackdrop';
        el.className = 'mly-profile-backdrop';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        el.setAttribute('aria-labelledby', 'mlyProfileTitle');
        el.innerHTML = `
<div id="mlyProfileModal" class="mly-profile-modal">

    <div class="mly-profile-head">
        <h2 class="mly-profile-title" id="mlyProfileTitle">Hi-Fi Profile</h2>
        <button class="mly-profile-close" id="mlyProfileClose" type="button" aria-label="Close">&times;</button>
    </div>

    <div class="mly-profile-body">

        <!-- Avatar -->
        <div class="mly-profile-avatar-section">
            <div class="mly-profile-avatar-circle" id="mlyProfileAvatarCircle">
                <img id="mlyProfileAvatarImg" src="" alt="" style="display:none">
                <span id="mlyProfileAvatarInitial">?</span>
            </div>
        </div>

        <!-- Favourite Genres -->
        <div class="mly-profile-section">
            <h3 class="mly-profile-section-title">Favourite Genres</h3>
            <div class="mly-genre-grid" id="mlyGenreGrid"></div>
        </div>

        <!-- Gear List -->
        <div class="mly-profile-section">
            <h3 class="mly-profile-section-title">Your Gear</h3>
            <p class="mly-profile-hint">Speakers, amp, DAC — the kit you listen through.</p>
            <div class="mly-gear-chips" id="mlyGearChips"></div>
            <div class="mly-gear-input-row">
                <input type="text" id="mlyGearInput" class="mly-profile-input"
                       placeholder="e.g. Harbeth M30.2" maxlength="80" autocomplete="off">
                <button type="button" id="mlyGearAdd" class="mly-gear-add-btn">Add</button>
            </div>
        </div>

        <!-- Listening Level -->
        <div class="mly-profile-section">
            <h3 class="mly-profile-section-title">Listening Level</h3>
            <div class="mly-level-grid" id="mlyLevelGrid"></div>
        </div>

        <!-- Measurely Remote — nav row -->
        <button type="button" class="mly-remote-nav-row" id="mlyRemoteNavBtn" style="display:none">
            <div class="mly-remote-nav-left">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>
                </svg>
                <div>
                    <div class="mly-remote-nav-title">Measurely Remote</div>
                    <div class="mly-remote-nav-sub" id="mlyRemoteNavSub">Pair a device or run a sweep</div>
                </div>
            </div>
            <svg class="mly-remote-nav-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </button>

        <!-- Privacy -->
        <div class="mly-profile-section mly-privacy-section">
            <div class="mly-privacy-row">
                <div class="mly-privacy-text">
                    <h3 class="mly-profile-section-title" style="margin:0 0 5px">Public Profile</h3>
                    <p class="mly-profile-hint" style="margin:0">When off, your gear and genre data is only
                    used for anonymous aggregate research — never attributed to you or shared publicly.</p>
                </div>
                <label class="mly-toggle" aria-label="Public profile">
                    <input type="checkbox" id="mlyPublicToggle">
                    <span class="mly-toggle-track"><span class="mly-toggle-thumb"></span></span>
                </label>
            </div>
        </div>

    </div>

    <div class="mly-profile-footer">
        <span class="mly-profile-save-status" id="mlyProfileStatus" aria-live="polite"></span>
        <button type="button" class="mly-auth-btn-primary mly-profile-save-btn" id="mlyProfileSave">Save Profile</button>
    </div>

</div>`;

        document.body.appendChild(el);
        _backdrop = el;

        // ── Remote modal (separate) ──────────────────────────────────────
        if (!document.getElementById('mlyRemoteBackdrop')) {
            const rem = document.createElement('div');
            rem.id = 'mlyRemoteBackdrop';
            rem.className = 'mly-profile-backdrop mly-remote-backdrop';
            rem.setAttribute('role', 'dialog');
            rem.setAttribute('aria-modal', 'true');
            rem.setAttribute('aria-labelledby', 'mlyRemoteTitle');
            rem.innerHTML = `
<div class="mly-profile-modal">
    <div class="mly-profile-head">
        <div style="display:flex;align-items:center;gap:10px">
            <button class="mly-profile-close" id="mlyRemoteBack" type="button" aria-label="Back" style="font-size:1rem">&#8592;</button>
            <h2 class="mly-profile-title" id="mlyRemoteTitle">Measurely Remote</h2>
        </div>
        <button class="mly-profile-close" id="mlyRemoteClose" type="button" aria-label="Close">&times;</button>
    </div>

    <div class="mly-profile-body" style="gap:20px;min-height:200px">

        <!-- Loading -->
        <div id="mlyRmtLoading" style="text-align:center;padding:24px 0;color:var(--c-text-muted);font-size:0.85rem">
            Loading…
        </div>

        <!-- No device: pair UI -->
        <div id="mlyRmtPairUI" style="display:none">
            <p class="mly-profile-hint" style="margin-bottom:14px">
                Generate a 6-digit code and enter it on your Measurely Remote device during Wi-Fi setup.
            </p>
            <button type="button" class="mly-remote-pair-btn" id="mlyRmtGenCode">Generate Pairing Code</button>
            <div id="mlyRmtCodeDisplay" style="display:none;margin-top:16px;text-align:center">
                <div class="mly-remote-code" id="mlyRmtCode"></div>
                <p class="mly-profile-hint" style="margin-top:8px">Enter this on your device during setup.<br>Valid for one use only.</p>
            </div>
        </div>

        <!-- Device paired -->
        <div id="mlyRmtDeviceUI" style="display:none">

            <!-- Device card -->
            <div class="mly-remote-device-card">
                <div class="mly-remote-device-header">
                    <span class="mly-remote-status-dot" id="mlyRmtStatusDot"></span>
                    <span class="mly-remote-device-name" id="mlyRmtDeviceName">Measurely Device</span>
                    <span class="mly-remote-last-seen" id="mlyRmtLastSeen"></span>
                </div>
                <div class="mly-remote-hw-row">
                    <span class="mly-remote-hw-chip" id="mlyRmtMicChip">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                        Microphone
                    </span>
                    <span class="mly-remote-hw-chip" id="mlyRmtDacChip">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                        DAC / Digi+
                    </span>
                </div>
            </div>

            <!-- Sweep -->
            <div class="mly-remote-sweep-panel">
                <div class="mly-remote-sweep-panel-info">
                    <div class="mly-remote-sweep-panel-title">Room Sweep</div>
                    <div class="mly-remote-sweep-panel-hint">Plays a test tone through both speakers and captures the impulse response.</div>
                </div>
                <button type="button" class="mly-remote-sweep-btn" id="mlyRmtSweepBtn">Run Sweep</button>
                <div class="mly-remote-sweep-status" id="mlyRmtSweepStatus"></div>
            </div>

            <!-- Unpair -->
            <button type="button" class="mly-remote-unpair-btn" id="mlyRmtUnpairBtn">Unpair device</button>
        </div>

    </div>
</div>`;
            document.body.appendChild(rem);
        }

        _buildGenreGrid();
        _buildLevelGrid();
        _bindEvents();
    }

    // ── Genre pill grid ──────────────────────────────────────────────────────
    function _buildGenreGrid() {
        const grid = document.getElementById('mlyGenreGrid');
        if (!grid) return;
        grid.innerHTML = GENRES.map(g =>
            `<button type="button" class="mly-genre-pill" data-genre="${g}">${g}</button>`
        ).join('');
        grid.addEventListener('click', e => {
            const pill = e.target.closest('.mly-genre-pill');
            if (pill) pill.classList.toggle('selected');
        });
    }

    // ── Listening level tiles ────────────────────────────────────────────────
    function _buildLevelGrid() {
        const grid = document.getElementById('mlyLevelGrid');
        if (!grid) return;
        grid.innerHTML = LEVELS.map(l =>
            `<button type="button" class="mly-level-tile" data-level="${l.key}">
                <span class="mly-level-label">${l.label}</span>
                <span class="mly-level-hint">${l.hint}</span>
            </button>`
        ).join('');
        grid.addEventListener('click', e => {
            const tile = e.target.closest('.mly-level-tile');
            if (!tile) return;
            grid.querySelectorAll('.mly-level-tile').forEach(t => t.classList.remove('selected'));
            tile.classList.add('selected');
        });
    }

    // ── Gear chip management ─────────────────────────────────────────────────
    function _renderGearChips() {
        const container = document.getElementById('mlyGearChips');
        if (!container) return;
        container.innerHTML = _gearItems.map((item, i) =>
            `<span class="mly-gear-chip">
                ${item}
                <button type="button" class="mly-gear-chip-remove" data-idx="${i}"
                        aria-label="Remove ${item}">&times;</button>
            </span>`
        ).join('');
        container.addEventListener('click', e => {
            const btn = e.target.closest('.mly-gear-chip-remove');
            if (!btn) return;
            _gearItems.splice(parseInt(btn.dataset.idx), 1);
            _renderGearChips();
        }, { once: true });
    }

    function _addGearItem() {
        const input = document.getElementById('mlyGearInput');
        if (!input) return;
        const val = input.value.trim();
        if (!val || _gearItems.includes(val)) { input.value = ''; return; }
        _gearItems.push(val);
        input.value = '';
        _renderGearChips();
    }


    // ── Measurely Remote modal ────────────────────────────────────────────────

    function _openRemoteModal() {
        const rem = document.getElementById('mlyRemoteBackdrop');
        if (!rem) return;
        rem.classList.add('open');
        _loadRemoteDevice();
    }

    function _closeRemoteModal() {
        document.getElementById('mlyRemoteBackdrop')?.classList.remove('open');
        clearTimeout(_sweepPollTimer);
    }

    async function _loadRemoteDevice() {
        const user = window.MeasurelyAuth?.getUser();
        // Show nav button only when authenticated
        const navBtn = document.getElementById('mlyRemoteNavBtn');
        if (navBtn) navBtn.style.display = user ? '' : 'none';
        if (!user) return;

        document.getElementById('mlyRmtLoading').style.display   = '';
        document.getElementById('mlyRmtPairUI').style.display    = 'none';
        document.getElementById('mlyRmtDeviceUI').style.display  = 'none';

        try {
            const result = await window._pb.collection('devices').getList(1, 1, {
                filter: `owner='${user.id}'`,
                sort: '-created',
            });

            document.getElementById('mlyRmtLoading').style.display = 'none';

            if (result.items.length > 0) {
                _device = result.items[0];
                _renderDevice(_device);
                // Update nav row subtitle
                const sub = document.getElementById('mlyRemoteNavSub');
                if (sub) sub.textContent = _device.status === 'online' ? 'Online' : 'Offline';
            } else {
                _device = null;
                document.getElementById('mlyRmtPairUI').style.display = '';
                const sub = document.getElementById('mlyRemoteNavSub');
                if (sub) sub.textContent = 'No device paired';
            }
        } catch (e) {
            console.error('[profile] load device:', e);
            document.getElementById('mlyRmtLoading').style.display  = 'none';
            document.getElementById('mlyRmtPairUI').style.display   = '';
        }
    }

    function _renderDevice(device) {
        document.getElementById('mlyRmtDeviceUI').style.display = '';

        const online = device.status === 'online';
        const dot = document.getElementById('mlyRmtStatusDot');
        dot.className = 'mly-remote-status-dot ' + (online ? 'online' : 'offline');

        document.getElementById('mlyRmtDeviceName').textContent = device.name || 'Measurely Device';

        const ls = document.getElementById('mlyRmtLastSeen');
        if (ls && device.last_seen) ls.textContent = _timeAgo(new Date(device.last_seen));

        _setHwChip('mlyRmtMicChip', device.mic_connected);
        _setHwChip('mlyRmtDacChip', device.dac_connected);
    }

    function _setHwChip(id, connected) {
        const chip = document.getElementById(id);
        if (!chip) return;
        if (connected === true)       { chip.classList.add('connected');    chip.classList.remove('disconnected'); }
        else if (connected === false) { chip.classList.add('disconnected'); chip.classList.remove('connected'); }
    }

    function _timeAgo(date) {
        const s = Math.floor((Date.now() - date) / 1000);
        if (s < 60)    return 'just now';
        if (s < 3600)  return Math.floor(s / 60) + 'm ago';
        if (s < 86400) return Math.floor(s / 3600) + 'h ago';
        return Math.floor(s / 86400) + 'd ago';
    }

    async function _generatePairingCode() {
        const user = window.MeasurelyAuth?.getUser();
        if (!user) return;

        const btn = document.getElementById('mlyRmtGenCode');
        btn.disabled = true;
        btn.textContent = 'Generating…';

        const code = String(Math.floor(100000 + Math.random() * 900000));

        try {
            await window._pb.collection('pairing_codes').create({ code, owner: user.id, used: false });
            document.getElementById('mlyRmtCode').textContent = code;
            document.getElementById('mlyRmtCodeDisplay').style.display = '';
        } catch (e) {
            console.error('[profile] generate code:', e);
        }

        btn.disabled = false;
        btn.textContent = 'Generate New Code';
    }

    async function _runSweep() {
        if (!_device) return;

        const btn    = document.getElementById('mlyRmtSweepBtn');
        const status = document.getElementById('mlyRmtSweepStatus');

        btn.disabled = true;
        _setSweepStatus(status, 'waiting', 'Sending command…');

        try {
            const cmd = await window._pb.collection('sweep_commands').create({
                device: _device.id, status: 'pending',
                channel: 'both', dur: 9.0, level_dbfs: -12.0,
            });
            _pollSweep(cmd.id, btn, status);
        } catch (e) {
            _setSweepStatus(status, 'error', 'Failed to send command');
            btn.disabled = false;
        }
    }

    function _pollSweep(cmdId, btn, status) {
        let attempts = 0;
        clearTimeout(_sweepPollTimer);

        const tick = async () => {
            if (++attempts > 80) {
                _setSweepStatus(status, 'error', 'Timed out — check device');
                btn.disabled = false;
                return;
            }
            try {
                const cmd = await window._pb.collection('sweep_commands').getOne(cmdId);
                if (cmd.status === 'done') {
                    _setSweepStatus(status, 'ok', 'Sweep complete ✓');
                    btn.disabled = false;
                    setTimeout(() => _setSweepStatus(status, '', ''), 4000);
                } else if (cmd.status === 'error') {
                    _setSweepStatus(status, 'error', cmd.error_message || 'Sweep failed');
                    btn.disabled = false;
                } else {
                    _setSweepStatus(status, 'waiting', cmd.status === 'running' ? 'Sweeping…' : 'Waiting for device…');
                    _sweepPollTimer = setTimeout(tick, 3000);
                }
            } catch (e) {
                _sweepPollTimer = setTimeout(tick, 3000);
            }
        };

        _sweepPollTimer = setTimeout(tick, 2000);
    }

    function _setSweepStatus(el, state, text) {
        if (!el) return;
        el.textContent = text;
        el.className = 'mly-remote-sweep-status' + (state ? ' ' + state : '');
    }

    // ── Event wiring ─────────────────────────────────────────────────────────
    function _bindEvents() {
        document.getElementById('mlyProfileClose')?.addEventListener('click', closeModal);
        _backdrop?.addEventListener('click', e => { if (e.target === _backdrop) closeModal(); });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && _backdrop?.classList.contains('open')) closeModal();
        });
        document.getElementById('mlyGearAdd')?.addEventListener('click', _addGearItem);
        document.getElementById('mlyGearInput')?.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); _addGearItem(); }
        });
        document.getElementById('mlyProfileSave')?.addEventListener('click', _save);
        document.getElementById('mlyRemoteNavBtn')?.addEventListener('click', _openRemoteModal);
        // Remote modal buttons (injected at same time)
        document.getElementById('mlyRemoteBack')?.addEventListener('click',  _closeRemoteModal);
        document.getElementById('mlyRemoteClose')?.addEventListener('click', _closeRemoteModal);
        document.getElementById('mlyRmtGenCode')?.addEventListener('click',  _generatePairingCode);
        document.getElementById('mlyRmtSweepBtn')?.addEventListener('click', _runSweep);
        document.getElementById('mlyRmtUnpairBtn')?.addEventListener('click', async () => {
            if (!_device || !confirm('Unpair this device?')) return;
            try { await window._pb.collection('devices').delete(_device.id); } catch (_) {}
            _device = null;
            await _loadRemoteDevice();
        });
        document.getElementById('mlyRemoteBackdrop')?.addEventListener('click', e => {
            if (e.target === document.getElementById('mlyRemoteBackdrop')) _closeRemoteModal();
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && document.getElementById('mlyRemoteBackdrop')?.classList.contains('open')) {
                _closeRemoteModal();
            }
        });
    }

    // ── Populate form from a profile object ──────────────────────────────────
    function _populate(profile) {
        if (!profile) return;

        // Avatar — show image if user has one, otherwise show initial
        const user = window.MeasurelyAuth?.getUser();
        const img  = document.getElementById('mlyProfileAvatarImg');
        const ini  = document.getElementById('mlyProfileAvatarInitial');
        if (user) {
            const initial = (user.email || user.username || '?')[0].toUpperCase();
            if (ini) ini.textContent = initial;
            if (user.avatar) {
                const avatarUrl = `${PB_URL}/api/files/users/${user.id}/${user.avatar}`;
                if (img) { img.src = avatarUrl; img.style.display = 'block'; }
                if (ini) ini.style.display = 'none';
            } else {
                if (img) img.style.display = 'none';
                if (ini) ini.style.display = '';
            }
        }

        // Genres
        const genres = Array.isArray(profile.genres) ? profile.genres : [];
        document.querySelectorAll('.mly-genre-pill').forEach(btn =>
            btn.classList.toggle('selected', genres.includes(btn.dataset.genre))
        );

        // Gear
        _gearItems = Array.isArray(profile.gear_list) ? [...profile.gear_list] : [];
        _renderGearChips();

        // Listening level
        document.querySelectorAll('.mly-level-tile').forEach(btn =>
            btn.classList.toggle('selected', btn.dataset.level === profile.listening_level)
        );

        // Privacy toggle
        const tog = document.getElementById('mlyPublicToggle');
        if (tog) tog.checked = !!profile.public_profile;
    }

    // ── Read current form state ───────────────────────────────────────────────
    function _readForm() {
        const genres = [...document.querySelectorAll('.mly-genre-pill.selected')]
            .map(b => b.dataset.genre);
        const listening_level = document.querySelector('.mly-level-tile.selected')?.dataset.level ?? '';
        const public_profile  = document.getElementById('mlyPublicToggle')?.checked ?? false;
        return { genres, gear_list: [..._gearItems], listening_level, public_profile };
    }

    // ── Save handler ──────────────────────────────────────────────────────────
    async function _save() {
        const btn    = document.getElementById('mlyProfileSave');
        const status = document.getElementById('mlyProfileStatus');
        if (!btn) return;

        btn.disabled    = true;
        btn.textContent = 'Saving…';
        if (status) { status.textContent = ''; status.className = 'mly-profile-save-status'; }

        const formData = _readForm();
        const isAuth   = !!window.MeasurelyAuth?.getUser();

        try {
            // pushProfile caches locally first; if not authenticated it returns
            // without throwing (data is in localStorage).
            await window.MeasurelySync?.pushProfile(formData);
        } catch (err) {
            console.error('[profile] save failed:', err);
            if (status) { status.textContent = 'Save failed — please try again'; status.classList.add('err'); }
            btn.disabled    = false;
            btn.textContent = 'Save Profile';
            return;
        }

        // Always update the in-memory cache
        _profile               = { ..._profile, ...formData };
        window.__MLY_PROFILE__ = _profile;

        if (!isAuth) {
            // Show "saved locally" message; leave modal open so user can sign in
            if (status) {
                status.textContent = 'Saved locally — sign in to back up to cloud';
                status.classList.add('ok');
            }
            btn.disabled    = false;
            btn.textContent = 'Save Profile';
            return;
        }

if (status) { status.textContent = 'Saved ✓'; status.classList.add('ok'); }
        btn.disabled    = false;
        btn.textContent = 'Save Profile';
        setTimeout(() => {
            if (status) status.textContent = '';
            closeModal();
        }, 950);
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Open the profile editor modal.
     * Pulls the latest data from PocketBase first (if authenticated).
     */
    async function openModal() {
        _inject();

        // Try cloud first (authenticated), then fall back to locally-cached pending profile
        const cloud = await window.MeasurelySync?.pullProfile().catch(() => null);
        if (cloud) {
            _profile = cloud;
        } else {
            const pending = window.MeasurelySync?.getPendingProfile();
            if (pending) _profile = pending;
        }

        _populate(_profile);
        _backdrop.classList.add('open');
        document.body.classList.add('mly-auth-open'); // borrow body-scroll-lock
        document.getElementById('mlyGearInput')?.focus();
        // Show Remote nav row only for authenticated users
        const navBtn = document.getElementById('mlyRemoteNavBtn');
        if (navBtn) navBtn.style.display = window.MeasurelyAuth?.getUser() ? '' : 'none';
    }

    function closeModal() {
        _backdrop?.classList.remove('open');
        document.body.classList.remove('mly-auth-open');
    }

    /** Returns the cached profile (populated after sign-in or openModal). */
    function getProfile() { return _profile; }

    // ── Auto-pull profile on sign-in ──────────────────────────────────────────
    // Populates window.__MLY_PROFILE__ so the Co-Pilot can reference it
    // without the user having to open the profile modal first.
    window.addEventListener('DOMContentLoaded', () => {
        window.MeasurelyAuth?.onAuthChange(async user => {
            if (!user) {
                _profile = {};
                window.__MLY_PROFILE__ = null;
                return;
            }
            // On sign-in: cloud data wins; pending local profile was already flushed
            // by MeasurelySync.pushLocalData() which auth.js calls after sign-in.
            const cloud = await window.MeasurelySync?.pullProfile().catch(() => null);
            if (cloud) {
                _profile               = cloud;
                window.__MLY_PROFILE__ = cloud;
            }
        });
    });

    window.MeasurelyProfile = { openModal, closeModal, getProfile };

})();
