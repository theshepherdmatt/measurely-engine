/**
 * sync.js — Measurely cloud sync (FINAL STABLE VERSION)
 */
(function () {
    'use strict';
    const LS_ROOM = 'measurely_room', LS_SESSIONS = 'measurely_sessions', LS_SPEAKER = 'mly.speaker.key', LS_ONBOARD = 'measurely_onboarded', LS_PENDING_PROFILE = 'mly_pending_profile';
    const NO_CANCEL = { requestKey: null };

    function _pb() { const g = window._pb; return (typeof g === 'function') ? g() : null; }
    function _authenticated() { return _pb()?.authStore?.isValid === true; }
    function _userId() { return _pb()?.authStore?.model?.id ?? null; }
    function _delay(ms) { return new Promise(r => setTimeout(r, ms)); }
    function _num(v) { return (Number.isFinite(v) ? v : null); }

    // THE MAGIC HELPER: Ensures spacing and single-quotes
    function _f(...p) {
        const parts = [];
        for (let i = 0; i < p.length; i += 2) { parts.push(p[i] + " = '" + p[i+1] + "'"); }
        return parts.join(' and ');
    }

    function _parseJson(v, f) {
        if (Array.isArray(v) || (v && typeof v === 'object')) return v;
        try { return v ? JSON.parse(v) : f; } catch (_) { return f; }
    }

    // -------------------------------------------------------------------------
    // Sync status — dispatches custom events so any page can show indicators
    // -------------------------------------------------------------------------

    // Possible states: 'idle' | 'syncing' | 'ok' | 'error'
    let _syncState = 'idle';
    let _syncErrorTimer = null;

    function _setState(state, detail) {
        _syncState = state;
        window.dispatchEvent(new CustomEvent('measurely:sync', { detail: { state, ...detail } }));

        // Auto-reset error badge to idle after 6 s so it doesn't stay red forever
        if (state === 'error') {
            clearTimeout(_syncErrorTimer);
            _syncErrorTimer = setTimeout(() => _setState('idle'), 6000);
        }
        if (state === 'ok') {
            // Reset to idle after a brief success flash
            clearTimeout(_syncErrorTimer);
            _syncErrorTimer = setTimeout(() => _setState('idle'), 3000);
        }
    }

    function _syncFail(context, err) {
        console.warn(`[sync] ${context} failed:`, err?.message ?? err);
        _setState('error', { context, message: err?.message ?? String(err) });
        // Surface a toast if the function is available
        if (typeof window.toast === 'function') {
            window.toast(`Cloud sync failed — changes saved locally.`, 'error');
        }
    }

    // -------------------------------------------------------------------------
    // Room
    // -------------------------------------------------------------------------

    async function pushRoom() {
        if (!_authenticated()) return;
        const raw = localStorage.getItem(LS_ROOM);
        if (!raw) return;
        let payload = JSON.parse(raw);
        const pb = _pb(), userId = _userId();
        const record = { user: userId, dimensions: payload.geometry ?? payload, speaker_pos: payload.setup ?? {}, treatment: payload.environment ?? {} };
        _setState('syncing', { op: 'pushRoom' });
        try {
            const existing = await pb.collection('rooms').getFirstListItem(_f('user', userId), NO_CANCEL).catch(() => null);
            if (existing) { await pb.collection('rooms').update(existing.id, record, NO_CANCEL); }
            else { await pb.collection('rooms').create(record, NO_CANCEL); }
            _setState('ok', { op: 'pushRoom' });
        } catch (err) { _syncFail('pushRoom', err); }
    }

    async function pullRoom() {
        if (!_authenticated()) return null;
        const pb = _pb(), userId = _userId();
        try {
            const record = await pb.collection('rooms').getFirstListItem(_f('user', userId), NO_CANCEL).catch(() => null);
            if (!record) return null;
            const normalised = { geometry: record.dimensions ?? {}, setup: record.speaker_pos ?? {}, environment: record.treatment ?? {}, room_type: record.dimensions?.room_type ?? 'home', saved_at: record.updated };
            localStorage.setItem(LS_ROOM, JSON.stringify(normalised));
            return normalised;
        } catch (err) { _syncFail('pullRoom', err); return null; }
    }

    // -------------------------------------------------------------------------
    // Sessions
    // -------------------------------------------------------------------------

    async function pushSession(session) {
        if (!session?.id || !_authenticated()) return;
        await _delay(500);
        const pb = _pb(), userId = _userId();
        const ai = (session.ai && typeof session.ai === 'object') ? session.ai : {};
        const payload = {
            user: userId, session_id: session.id, label: session.label ?? '', timestamp: session.timestamp ?? new Date().toISOString(),
            overall_score: _num(ai.overall_score ?? session.overall_score), peaks_dips: _num(ai.peaks_dips ?? session.peaks_dips),
            reflections: _num(ai.reflections ?? session.reflections), bandwidth: _num(ai.bandwidth ?? session.bandwidth),
            balance: _num(ai.balance ?? session.balance), smoothness: _num(ai.smoothness ?? session.smoothness),
            clarity: _num(ai.clarity ?? session.clarity), has_analysis: session.has_analysis ?? true,
            analysis: session.analysis ?? null, report_curve: session.reportCurve ?? null,
            room_modes: session.room_modes ? JSON.stringify(session.room_modes) : null,
            schroeder_freq: _num(session.schroeder_freq), sbir_null: _num(session.sbir_null),
            scores: session.scores ? JSON.stringify(session.scores) : null
        };
        _setState('syncing', { op: 'pushSession', id: session.id });
        try {
            const existing = await pb.collection('sessions').getFirstListItem(_f('user', userId, 'session_id', session.id), NO_CANCEL).catch(() => null);
            if (existing) { await pb.collection('sessions').update(existing.id, payload, NO_CANCEL); }
            else { await pb.collection('sessions').create(payload, NO_CANCEL); }
            _setState('ok', { op: 'pushSession', id: session.id });
        } catch (err) { _syncFail('pushSession', err); }
    }

    async function pullAll() {
        if (!_authenticated()) return;
        const pb = _pb(), userId = _userId();
        _setState('syncing', { op: 'pullAll' });
        try {
            await pullRoom();
            const sessionRecords = await pb.collection('sessions').getList(1, 50, { filter: _f('user', userId), sort: '-timestamp', ...NO_CANCEL }).catch(() => null);
            if (sessionRecords?.items?.length) {
                const cloudSessions = sessionRecords.items.map(r => ({
                    id: r.session_id, label: r.label, timestamp: r.timestamp, overall_score: r.overall_score,
                    analysis: r.analysis ?? null, reportCurve: r.report_curve ?? null,
                    room_modes: r.room_modes ? _parseJson(r.room_modes, null) : null,
                    _cloud_updated: r.updated
                }));
                localStorage.setItem(LS_SESSIONS, JSON.stringify(cloudSessions.slice(0, 20)));
            }
            await pullProfile();
            _setState('ok', { op: 'pullAll' });
        } catch (err) { _syncFail('pullAll', err); }
    }

    // -------------------------------------------------------------------------
    // Profile
    // -------------------------------------------------------------------------

    async function pushProfile(data, avatarFile) {
        if (!_authenticated()) return;
        const pb = _pb(), userId = _userId();
        const form = new FormData();
        form.append('gear_list', JSON.stringify(data.gear_list ?? []));
        form.append('genres', JSON.stringify(data.genres ?? []));
        form.append('public_profile', data.public_profile ? 'true' : 'false');
        if (avatarFile instanceof File) form.append('avatar', avatarFile);
        _setState('syncing', { op: 'pushProfile' });
        try {
            await pb.collection('users').update(userId, form, NO_CANCEL);
            _setState('ok', { op: 'pushProfile' });
        } catch (err) { _syncFail('pushProfile', err); }
    }

    async function pullProfile() {
        if (!_authenticated()) return null;
        const pb = _pb(), userId = _userId();
        try {
            const record = await pb.collection('users').getOne(userId, NO_CANCEL);
            const profile = { gear_list: _parseJson(record.gear_list, []), genres: _parseJson(record.genres, []), avatar: record.avatar ?? '' };
            window.__MLY_PROFILE__ = profile;
            return profile;
        } catch (err) { _syncFail('pullProfile', err); return null; }
    }

    async function pushLocalData() {
        if (!_authenticated()) return;
        await pushRoom();
        const raw = localStorage.getItem(LS_SESSIONS);
        const sessions = raw ? JSON.parse(raw) : [];
        for (const s of sessions) await pushSession(s);
    }

    window.MeasurelySync = { pushRoom, pullRoom, pushSession, pullAll, pushLocalData, pushProfile, pullProfile, hasPendingData: () => false, getSyncState: () => _syncState };
})();
