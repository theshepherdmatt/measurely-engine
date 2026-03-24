// Copyright (c) 2024–2026 Measurely. All Rights Reserved. Proprietary and confidential.
/**
 * sync.js — Measurely cloud sync (FINAL STABLE VERSION)
 */
(function () {
    'use strict';
    const LS_ROOM = 'measurely_room', LS_SESSIONS = 'measurely_sessions', LS_TREATMENT = 'measurely_treatment', LS_SPEAKER = 'mly.speaker.key', LS_ONBOARD = 'measurely_onboarded', LS_PENDING_PROFILE = 'mly_pending_profile';
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
            window.dispatchEvent(new CustomEvent('measurely:data-ready', { detail: { room: normalised } }));
            return normalised;
        } catch (err) { _syncFail('pullRoom', err); return null; }
    }

    // -------------------------------------------------------------------------
    // Sessions
    // -------------------------------------------------------------------------

    const _pendingSessionPushes = {};
    let _activeSessionSyncs = new Set();

    async function pushSession(session) {
        if (!session?.id || !_authenticated()) return;
        
        // Keep the latest payload
        _pendingSessionPushes[session.id] = session;

        // If already actively syncing this ID, rely on the ongoing sync to catch our payload update 
        // or we just delay and try later. The delay handles typical keystroke bursts.
        if (_activeSessionSyncs.has(session.id)) return;
        
        _activeSessionSyncs.add(session.id);
        
        // Wait to allow rapid repeated calls (e.g. typing notes) to bundle into one network request
        await _delay(800);

        const latestSession = _pendingSessionPushes[session.id];
        delete _pendingSessionPushes[session.id];
        
        if (!latestSession) {
            _activeSessionSyncs.delete(session.id);
            return; // Was deleted or already dispatched
        }

        const pb = _pb(), userId = _userId();
        const ai = (latestSession.ai && typeof latestSession.ai === 'object') ? latestSession.ai : {};
        const aiScores = ai.scores || {};
        const sc = latestSession.scores || {};
        const payload = {
            user: userId, session_id: latestSession.id, label: latestSession.label ?? '', timestamp: latestSession.timestamp ?? new Date().toISOString(),
            overall_score: _num(sc.overall ?? aiScores.overall ?? latestSession.overall_score),
            has_analysis: latestSession.has_analysis ?? true,
            analysis: latestSession.analysis ?? null, report_curve: latestSession.reportCurve ?? null,
            room_modes: latestSession.room_modes ? JSON.stringify(latestSession.room_modes) : null,
            schroeder_freq: _num(latestSession.schroeder_freq), sbir_null: _num(latestSession.sbir_null),
            scores: Object.keys(sc).length ? sc : (Object.keys(aiScores).length ? aiScores : null)
        };
        _setState('syncing', { op: 'pushSession', id: latestSession.id });
        try {
            // Find ALL existing records for this session to self-heal duplicates while pushing
            const records = await pb.collection('sessions').getFullList({ filter: _f('user', userId, 'session_id', latestSession.id) }).catch(() => []);
            
            if (records.length > 0) {
                // Update the first one, delete all the redundant ones
                await pb.collection('sessions').update(records[0].id, payload, NO_CANCEL);
                for (let i = 1; i < records.length; i++) {
                    await pb.collection('sessions').delete(records[i].id).catch(() => null);
                }
            } else { 
                await pb.collection('sessions').create(payload, NO_CANCEL); 
            }
            _setState('ok', { op: 'pushSession', id: latestSession.id });
        } catch (err) { _syncFail('pushSession', err); }
        
        _activeSessionSyncs.delete(latestSession.id);
    }

    async function deleteSession(id) {
        // Cancel any pending pushes from keystrokes
        delete _pendingSessionPushes[id];

        if (!_authenticated()) return;
        const pb = _pb(), userId = _userId();
        
        _setState('syncing', { op: 'deleteSession', id });
        try {
            const records = await pb.collection('sessions').getFullList({ filter: _f('user', userId, 'session_id', id) }).catch(() => []);
            for (const r of records) {
                await pb.collection('sessions').delete(r.id);
            }
            _setState('ok', { op: 'deleteSession', id });
        } catch (err) { _syncFail('deleteSession', err); }
    }

    async function pullAll() {
        if (!_authenticated()) return;
        const pb = _pb(), userId = _userId();
        _setState('syncing', { op: 'pullAll' });
        try {
            await pullRoom();
            const sessionRecords = await pb.collection('sessions').getList(1, 50, { filter: _f('user', userId), sort: '-created', ...NO_CANCEL }).catch(() => null);
            if (sessionRecords?.items?.length) {
                // Self-Heal duplicates: if there are multiple records for the same session_id, keep the newest and proactively clean the rest
                const cloudSessions = [];
                const seenIds = new Set();
                
                for (const r of sessionRecords.items) {
                    if (seenIds.has(r.session_id)) {
                        pb.collection('sessions').delete(r.id).catch(() => null);
                        continue;
                    }
                    seenIds.add(r.session_id);
                    cloudSessions.push({
                        id: r.session_id, label: r.label, timestamp: r.timestamp, overall_score: r.overall_score,
                        has_analysis: r.has_analysis ?? false,
                        scores: r.scores ?? null,
                        analysis: r.analysis ?? null, reportCurve: r.report_curve ?? null,
                        room_modes: r.room_modes ? _parseJson(r.room_modes, null) : null,
                        _cloud_updated: r.updated
                    });
                }
                // Merge: local sessions take priority for full analysis payloads.
                // However, backfill any fields the local copy is missing (e.g. scores
                // added after the original pull) so stale cache never hides cloud data.
                const localRaw = localStorage.getItem(LS_SESSIONS);
                const localSessions = localRaw ? JSON.parse(localRaw) : [];
                const cloudById = Object.fromEntries(cloudSessions.map(c => [c.id, c]));
                const localIds = new Set(localSessions.map(s => s.id));
                const updatedLocal = localSessions.map(local => {
                    const cloud = cloudById[local.id];
                    if (!cloud) return local;
                    return {
                        ...local,
                        scores:   local.scores   ?? cloud.scores,   // backfill if missing
                        analysis: local.analysis ?? cloud.analysis, // keep local if richer
                    };
                });
                const newFromCloud = cloudSessions.filter(s => !localIds.has(s.id));
                const merged = [...updatedLocal, ...newFromCloud];
                merged.sort((a, b) => {
                    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                    return tb - ta;
                });
                localStorage.setItem(LS_SESSIONS, JSON.stringify(merged.slice(0, 20)));
                // Signal dashboard to reload — it likely initialised before this fetch completed.
                window.dispatchEvent(new CustomEvent('mly:syncComplete', { detail: { sessions: merged.length } }));
            }
            await pullProfile();
            _setState('ok', { op: 'pullAll' });
        } catch (err) { _syncFail('pullAll', err); }
    }

    // -------------------------------------------------------------------------
    // Profile
    // -------------------------------------------------------------------------

    async function pushProfile(data) {
        if (!_authenticated()) return;
        const pb = _pb(), userId = _userId();
        const form = new FormData();
        form.append('gear_list', JSON.stringify(data.gear_list ?? []));
        form.append('genres', JSON.stringify(data.genres ?? []));
        form.append('public_profile', data.public_profile ? 'true' : 'false');
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

    // -------------------------------------------------------------------------
    // Treatments (Fix My Room plans)
    // -------------------------------------------------------------------------

    async function pushTreatment(data) {
        // Always persist to localStorage first so it survives page navigation without auth.
        const localPlan = {
            budget: data.budget ?? 0,
            shopping_list: data.shopping_list ?? [],
            layout_config: data.layout_config ?? {},
            status: data.status ?? 'saved'
        };
        try { localStorage.setItem(LS_TREATMENT, JSON.stringify(localPlan)); } catch (_) {}

        if (!_authenticated()) return;
        const pb = _pb(), userId = _userId();
        const roomRecord = await pb.collection('rooms').getFirstListItem(_f('user', userId), NO_CANCEL).catch(() => null);
        const payload = { user: userId, room: roomRecord?.id ?? null, ...localPlan };
        _setState('syncing', { op: 'pushTreatment' });
        try {
            const existing = await pb.collection('treatments').getFirstListItem(_f('user', userId), NO_CANCEL).catch(() => null);
            if (existing) { await pb.collection('treatments').update(existing.id, payload, NO_CANCEL); }
            else { await pb.collection('treatments').create(payload, NO_CANCEL); }
            _setState('ok', { op: 'pushTreatment' });
        } catch (err) { _syncFail('pushTreatment', err); }
    }

    async function pullTreatment() {
        // localStorage first — instant, works offline and for unauthenticated users.
        let localPlan = null;
        try {
            const raw = localStorage.getItem(LS_TREATMENT);
            if (raw) localPlan = JSON.parse(raw);
        } catch (_) {}

        if (!_authenticated()) return localPlan;

        // Try PocketBase; on success cache result locally and return it.
        const pb = _pb(), userId = _userId();
        try {
            const record = await pb.collection('treatments').getFirstListItem(_f('user', userId), NO_CANCEL).catch(() => null);
            if (!record) return localPlan;
            const plan = {
                budget: record.budget ?? 0,
                shopping_list: _parseJson(record.shopping_list, []),
                layout_config: _parseJson(record.layout_config, {}),
                status: record.status ?? 'saved'
            };
            try { localStorage.setItem(LS_TREATMENT, JSON.stringify(plan)); } catch (_) {}
            return plan;
        } catch (err) { _syncFail('pullTreatment', err); return localPlan; }
    }

    window.MeasurelySync = { pushRoom, pullRoom, pushSession, deleteSession, pullAll, pushLocalData, pushProfile, pullProfile, pushTreatment, pullTreatment, hasPendingData: () => false, getSyncState: () => _syncState };
})();
