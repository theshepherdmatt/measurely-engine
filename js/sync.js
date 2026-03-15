/**
 * sync.js — Measurely cloud sync
 *
 * Depends on: auth.js (window._pb accessor) loaded before this.
 * Exposes:    window.MeasurelySync
 *
 * When the user is authenticated every push goes straight to PocketBase.
 * When the user is NOT authenticated data is cached in localStorage and a
 * 'mly:pendingdata' CustomEvent is dispatched so the UI can surface a
 * "Save to Cloud" prompt. On next sign-in pushLocalData() flushes it all.
 *
 * All PocketBase API calls use { requestKey: null } to opt out of the SDK's
 * auto-cancellation, which would otherwise abort duplicate in-flight requests
 * (e.g. pushSession from Acoustic Scientist + pushLocalData racing each other,
 * or pullAll + profile auth-change listener both calling pullProfile).
 */

(function () {
    'use strict';

    const LS_ROOM            = 'measurely_room';
    const LS_SESSIONS        = 'measurely_sessions';
    const LS_SPEAKER         = 'mly.speaker.key';
    const LS_ONBOARD         = 'measurely_onboarded';
    const LS_PENDING_PROFILE = 'mly_pending_profile';

    // No-cancel option — applied to every PocketBase call so rapid duplicate
    // requests don't abort each other.
    const NO_CANCEL = { requestKey: null };

    // PocketBase filter builder — always uses single quotes and 'and' operator.
    // e.g. _f('user', id)                  → "user = 'id'"
    // e.g. _f('user', id, 'session_id', s) → "user = 'id' and session_id = 's'"
    function _f(...pairs) {
        const parts = [];
        for (let i = 0; i < pairs.length; i += 2) {
            parts.push(pairs[i] + " = '" + pairs[i + 1] + "'");
        }
        return parts.join(' and ');
    }

    // ── Helper: get authenticated PocketBase instance ───────────────────────
    function _pb() {
        const getter = window._pb;
        return (typeof getter === 'function') ? getter() : null;
    }

    function _authenticated() {
        const pb = _pb();
        return pb?.authStore?.isValid === true;
    }

    function _userId() {
        return _pb()?.authStore?.model?.id ?? null;
    }

    function _delay(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ── Pending-profile helpers ──────────────────────────────────────────────
    function _cachePendingProfile(data) {
        try {
            const existing = getPendingProfile() ?? {};
            localStorage.setItem(LS_PENDING_PROFILE, JSON.stringify({ ...existing, ...data }));
        } catch (_) {}
    }

    function getPendingProfile() {
        try {
            const raw = localStorage.getItem(LS_PENDING_PROFILE);
            return raw ? JSON.parse(raw) : null;
        } catch (_) { return null; }
    }

    function hasPendingData() {
        if (localStorage.getItem(LS_PENDING_PROFILE)) return true;
        try {
            const sessions = JSON.parse(localStorage.getItem(LS_SESSIONS) || '[]');
            return sessions.length > 0;
        } catch (_) { return false; }
    }

    // ── Push room config ─────────────────────────────────────────────────────
    async function pushRoom() {
        if (!_authenticated()) return;
        const raw = localStorage.getItem(LS_ROOM);
        if (!raw) return;
        let payload;
        try { payload = JSON.parse(raw); } catch (_) { return; }

        const pb     = _pb();
        const userId = _userId();

        const record = {
            user:        userId,
            dimensions:  payload.geometry    ?? payload,
            speaker_pos: payload.setup       ?? {},
            treatment:   payload.environment ?? {},
        };

        try {
            const existing = await pb.collection('rooms')
                .getFirstListItem(_f('user', userId), NO_CANCEL)
                .catch(() => null);

            if (existing) {
                await pb.collection('rooms').update(existing.id, record, NO_CANCEL);
            } else {
                await pb.collection('rooms').create(record, NO_CANCEL);
            }
        } catch (err) {
            console.warn('[sync] pushRoom failed:', err?.message);
        }
    }

    // ── Pull room config from cloud ───────────────────────────────────────────
    async function pullRoom() {
        if (!_authenticated()) return null;
        const pb     = _pb();
        const userId = _userId();

        try {
            const record = await pb.collection('rooms')
                .getFirstListItem(_f('user', userId), NO_CANCEL)
                .catch(() => null);

            if (!record) return null;

            const normalised = {
                geometry:    record.dimensions  ?? {},
                setup:       record.speaker_pos ?? {},
                environment: record.treatment   ?? {},
                room_type:   record.dimensions?.room_type ?? record.room_type ?? 'home',
                saved_at:    record.updated,
            };

            const localRaw = localStorage.getItem(LS_ROOM);
            const localTs  = localRaw ? (JSON.parse(localRaw)?.saved_at ?? 0) : 0;
            const cloudTs  = record.updated ?? 0;

            if (!localTs || new Date(cloudTs) >= new Date(localTs)) {
                localStorage.setItem(LS_ROOM, JSON.stringify(normalised));
            }

            return normalised;
        } catch (err) {
            console.warn('[sync] pullRoom failed:', err?.message);
            return null;
        }
    }

    // ── Push a single session ─────────────────────────────────────────────────
    // Accepts two session shapes:
    //   A) From app.html Acoustic Scientist:
    //      { id, label, timestamp, ai: {overall_score,…}, analysis, reportCurve,
    //        room_modes, schroeder_freq, sbir_null, scores }
    //   B) From localStorage (via MeasurelySessions.saveSession):
    //      { id, label, timestamp, overall_score,…, analysis, reportCurve }
    //
    // A 500 ms delay is applied before the API call to let any in-flight
    // pushLocalData() loop finish first and avoid races.
    async function pushSession(session) {
        if (!session?.id) return;

        // Normalise scores: handle both nested-ai and flat shapes
        const ai = (session.ai && typeof session.ai === 'object') ? session.ai : {};

        if (!_authenticated()) {
            window.dispatchEvent(new CustomEvent('mly:pendingdata', { detail: { type: 'session' } }));
            return;
        }

        // Small delay — prevents auto-cancellation when pushSession is called
        // immediately after pushLocalData (which already pushed all local sessions).
        await _delay(500);

        // Re-check auth in case the session expired during the delay
        if (!_authenticated()) return;

        const pb     = _pb();
        const userId = _userId();

        // Sanitise numeric fields — replace NaN/undefined with null
        const _num = v => (Number.isFinite(v) ? v : null);

        const payload = {
            user:          userId,
            session_id:    session.id,
            label:         session.label     ?? '',
            timestamp:     session.timestamp ?? new Date().toISOString(),
            // Scores — try nested ai first, then flat fields
            overall_score: _num(ai.overall_score  ?? session.overall_score),
            peaks_dips:    _num(ai.peaks_dips     ?? session.peaks_dips),
            reflections:   _num(ai.reflections    ?? session.reflections),
            bandwidth:     _num(ai.bandwidth      ?? session.bandwidth),
            balance:       _num(ai.balance        ?? session.balance),
            smoothness:    _num(ai.smoothness     ?? session.smoothness),
            clarity:       _num(ai.clarity        ?? session.clarity),
            has_analysis:  session.has_analysis
                           ?? (Object.keys(ai).length > 0 || !!session.analysis),
            note:          session.note      ?? '',
            analysis:      session.analysis  ?? null,
            report_curve:  session.reportCurve ?? null,
            // Acoustic Scientist metadata
            room_modes:     session.room_modes    != null
                            ? JSON.stringify(session.room_modes)  : null,
            schroeder_freq: _num(session.schroeder_freq),
            sbir_null:      _num(session.sbir_null),
            scores:         session.scores != null
                            ? JSON.stringify(session.scores)      : null,
        };

        try {
            const existing = await pb.collection('sessions')
                .getFirstListItem(
                    _f('user', userId, 'session_id', session.id),
                    NO_CANCEL
                )
                .catch(() => null);

            if (existing) {
                await pb.collection('sessions').update(existing.id, payload, NO_CANCEL);
            } else {
                await pb.collection('sessions').create(payload, NO_CANCEL);
            }
        } catch (err) {
            console.warn('[sync] pushSession failed:', err?.message);
        }
    }

    // ── Push speaker preference + onboarded flag ──────────────────────────────
    async function pushPrefs() {
        if (!_authenticated()) return;
        const pb     = _pb();
        const userId = _userId();

        const speaker_key = localStorage.getItem(LS_SPEAKER) ?? '';
        const onboarded   = !!localStorage.getItem(LS_ONBOARD);

        try {
            await pb.collection('users').update(userId, { speaker_key, onboarded }, NO_CANCEL);
        } catch (err) {
            console.warn('[sync] pushPrefs failed:', err?.message);
        }
    }

    // ── Pull all cloud data into localStorage ─────────────────────────────────
    async function pullAll() {
        if (!_authenticated()) return;
        const pb     = _pb();
        const userId = _userId();

        try {
            // Pull room
            const roomRecord = await pb.collection('rooms')
                .getFirstListItem(_f('user', userId), NO_CANCEL)
                .catch(() => null);

            if (roomRecord) {
                const normalised = {
                    geometry:    roomRecord.dimensions  ?? {},
                    setup:       roomRecord.speaker_pos ?? {},
                    environment: roomRecord.treatment   ?? {},
                    room_type:   roomRecord.dimensions?.room_type ?? 'home',
                    saved_at:    roomRecord.updated,
                };
                const localRaw = localStorage.getItem(LS_ROOM);
                const localTs  = localRaw ? (JSON.parse(localRaw)?.saved_at ?? 0) : 0;
                const cloudTs  = roomRecord.updated ?? 0;
                if (!localTs || new Date(cloudTs) >= new Date(localTs)) {
                    localStorage.setItem(LS_ROOM, JSON.stringify(normalised));
                }
            }

            // Pull sessions
            const sessionRecords = await pb.collection('sessions')
                .getList(1, 50, {
                    filter: _f('user', userId),
                    sort:   '-timestamp',
                    ...NO_CANCEL,
                })
                .catch(() => null);

            if (sessionRecords?.items?.length) {
                const cloudSessions = sessionRecords.items.map(r => ({
                    id:             r.session_id,
                    label:          r.label,
                    timestamp:      r.timestamp,
                    overall_score:  r.overall_score,
                    peaks_dips:     r.peaks_dips,
                    reflections:    r.reflections,
                    bandwidth:      r.bandwidth,
                    balance:        r.balance,
                    smoothness:     r.smoothness,
                    clarity:        r.clarity,
                    has_analysis:   r.has_analysis,
                    note:           r.note,
                    analysis:       r.analysis    ?? null,
                    reportCurve:    r.report_curve ?? null,
                    room_modes:     r.room_modes   ? _parseJson(r.room_modes, null) : null,
                    schroeder_freq: r.schroeder_freq ?? null,
                    sbir_null:      r.sbir_null      ?? null,
                    scores:         r.scores         ? _parseJson(r.scores, null)  : null,
                    _cloud_updated: r.updated,
                }));

                const localRaw  = localStorage.getItem(LS_SESSIONS);
                const localSess = localRaw ? JSON.parse(localRaw) : [];
                const merged    = _mergeSessions(localSess, cloudSessions);
                localStorage.setItem(LS_SESSIONS, JSON.stringify(merged.slice(0, 20)));
            }

            // Pull prefs from auth model
            const user = pb.authStore.model;
            if (user?.speaker_key) localStorage.setItem(LS_SPEAKER, user.speaker_key);
            if (user?.onboarded)   localStorage.setItem(LS_ONBOARD, 'true');

            // Pull Hi-Fi profile into cache
            await pullProfile().catch(() => {});

        } catch (err) {
            console.warn('[sync] pullAll failed:', err?.message);
        }
    }

    // ── On login: push all local-only data up to PocketBase ───────────────────
    async function pushLocalData() {
        if (!_authenticated()) return;

        await pushRoom();

        const raw      = localStorage.getItem(LS_SESSIONS);
        const sessions = raw ? JSON.parse(raw) : [];
        for (const s of sessions) await pushSession(s);

        await pushPrefs();

        const pending = getPendingProfile();
        if (pending) {
            try {
                await pushProfile(pending, null);
            } catch (err) {
                console.warn('[sync] pushLocalData: pending profile flush failed:', err?.message);
            }
        }
    }

    // ── Delete a session from cloud ───────────────────────────────────────────
    async function deleteSession(id) {
        if (!_authenticated() || !id) return;
        const pb     = _pb();
        const userId = _userId();

        try {
            const record = await pb.collection('sessions')
                .getFirstListItem(
                    _f('user', userId, 'session_id', id),
                    NO_CANCEL
                )
                .catch(() => null);
            if (record) await pb.collection('sessions').delete(record.id, NO_CANCEL);
        } catch (err) {
            console.warn('[sync] deleteSession failed:', err?.message);
        }
    }

    // ── Module-level profile cache ────────────────────────────────────────────
    let _cachedProfile = null;

    // ── Push Hi-Fi profile to the users collection ────────────────────────────
    async function pushProfile(data, avatarFile) {
        _cachePendingProfile(data);

        if (!_authenticated()) {
            window.dispatchEvent(new CustomEvent('mly:pendingdata', { detail: { type: 'profile' } }));
            return;
        }

        const pb     = _pb();
        const userId = _userId();

        const form = new FormData();
        form.append('gear_list',       JSON.stringify(data.gear_list       ?? []));
        form.append('genres',          JSON.stringify(data.genres          ?? []));
        form.append('listening_level', data.listening_level ?? '');
        form.append('public_profile',  data.public_profile ? 'true' : 'false');
        if (avatarFile instanceof File) form.append('avatar', avatarFile);

        try {
            await pb.collection('users').update(userId, form, NO_CANCEL);
            _cachedProfile         = { ...(_cachedProfile || {}), ...data };
            window.__MLY_PROFILE__ = _cachedProfile;
            localStorage.removeItem(LS_PENDING_PROFILE);
        } catch (err) {
            console.warn('[sync] pushProfile failed:', err?.message);
            throw err;
        }
    }

    // ── Pull Hi-Fi profile fields from the users record ───────────────────────
    async function pullProfile() {
        if (!_authenticated()) return null;
        const pb     = _pb();
        const userId = _userId();

        try {
            const record = await pb.collection('users').getOne(userId, NO_CANCEL);

            _cachedProfile = {
                gear_list:       _parseJson(record.gear_list, []),
                genres:          _parseJson(record.genres,    []),
                listening_level: record.listening_level ?? '',
                public_profile:  !!record.public_profile,
                avatar:          record.avatar ?? '',
            };
            window.__MLY_PROFILE__ = _cachedProfile;
            return _cachedProfile;
        } catch (err) {
            console.warn('[sync] pullProfile failed:', err?.message);
            return null;
        }
    }

    function getProfile() { return _cachedProfile; }

    // ── Internal helpers ──────────────────────────────────────────────────────

    function _parseJson(v, fallback) {
        if (Array.isArray(v) || (v && typeof v === 'object')) return v;
        try { return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; }
    }

    function _mergeSessions(local, cloud) {
        const map = new Map();
        local.forEach(s => map.set(s.id, s));
        cloud.forEach(cs => {
            const existing = map.get(cs.id);
            if (!existing) { map.set(cs.id, cs); return; }
            const cloudT = cs._cloud_updated ? new Date(cs._cloud_updated).getTime() : 0;
            const localT = existing.timestamp ? new Date(existing.timestamp).getTime() : 0;
            if (cloudT > localT) map.set(cs.id, { ...existing, ...cs });
        });
        return Array.from(map.values()).sort((a, b) =>
            new Date(b.timestamp || 0) - new Date(a.timestamp || 0)
        );
    }

    // ── Expose ────────────────────────────────────────────────────────────────
    window.MeasurelySync = {
        pushRoom,
        pullRoom,
        pushSession,
        pushPrefs,
        pullAll,
        pushLocalData,
        deleteSession,
        pushProfile,
        pullProfile,
        getProfile,
        getPendingProfile,
        hasPendingData,
    };

})();
