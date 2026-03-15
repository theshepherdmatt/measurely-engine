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
 */

(function () {
    'use strict';

    const LS_ROOM            = 'measurely_room';
    const LS_SESSIONS        = 'measurely_sessions';
    const LS_SPEAKER         = 'mly.speaker.key';
    const LS_ONBOARD         = 'measurely_onboarded';
    const LS_PENDING_PROFILE = 'mly_pending_profile';

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

    // ── Pending-profile helpers ──────────────────────────────────────────────
    // Profile data entered while not logged in is persisted here so it isn't
    // lost, and gets pushed to PocketBase on the next sign-in.

    function _cachePendingProfile(data) {
        try {
            const existing = getPendingProfile() ?? {};
            localStorage.setItem(LS_PENDING_PROFILE, JSON.stringify({ ...existing, ...data }));
        } catch (_) {}
    }

    /** Returns the locally-cached pending profile, or null. */
    function getPendingProfile() {
        try {
            const raw = localStorage.getItem(LS_PENDING_PROFILE);
            return raw ? JSON.parse(raw) : null;
        } catch (_) { return null; }
    }

    /**
     * Returns true when there is any local data not yet confirmed as synced to
     * the cloud (either pending sessions or a pending profile).
     */
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
                .getFirstListItem('user = "' + userId + '"')
                .catch(() => null);

            if (existing) {
                await pb.collection('rooms').update(existing.id, record);
            } else {
                await pb.collection('rooms').create(record);
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
                .getFirstListItem('user = "' + userId + '"')
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
    async function pushSession(session) {
        if (!session?.id) return;

        // Normalise scores: handle both nested-ai and flat shapes
        const ai = (session.ai && typeof session.ai === 'object') ? session.ai : {};

        if (!_authenticated()) {
            // Sessions already live in localStorage — just signal pending data
            window.dispatchEvent(new CustomEvent('mly:pendingdata', { detail: { type: 'session' } }));
            return;
        }

        const pb     = _pb();
        const userId = _userId();

        const payload = {
            user:          userId,
            session_id:    session.id,
            label:         session.label              ?? '',
            timestamp:     session.timestamp           ?? new Date().toISOString(),
            // Scores — try nested ai first, then flat fields
            overall_score: ai.overall_score  ?? session.overall_score  ?? null,
            peaks_dips:    ai.peaks_dips     ?? session.peaks_dips     ?? null,
            reflections:   ai.reflections    ?? session.reflections    ?? null,
            bandwidth:     ai.bandwidth      ?? session.bandwidth      ?? null,
            balance:       ai.balance        ?? session.balance        ?? null,
            smoothness:    ai.smoothness     ?? session.smoothness     ?? null,
            clarity:       ai.clarity        ?? session.clarity        ?? null,
            has_analysis:  session.has_analysis
                           ?? (Object.keys(ai).length > 0 || !!session.analysis),
            note:          session.note           ?? '',
            analysis:      session.analysis       ?? null,
            report_curve:  session.reportCurve    ?? null,
            // Acoustic Scientist metadata (new fields)
            room_modes:     session.room_modes    != null
                            ? JSON.stringify(session.room_modes)    : null,
            schroeder_freq: session.schroeder_freq ?? null,
            sbir_null:      session.sbir_null      ?? null,
            scores:         session.scores         != null
                            ? JSON.stringify(session.scores)        : null,
        };

        try {
            const existing = await pb.collection('sessions')
                .getFirstListItem('user = "' + userId + '" && session_id = "' + session.id + '"')
                .catch(() => null);

            if (existing) {
                await pb.collection('sessions').update(existing.id, payload);
            } else {
                await pb.collection('sessions').create(payload);
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
            await pb.collection('users').update(userId, { speaker_key, onboarded });
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
                .getFirstListItem('user = "' + userId + '"')
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
                .getList(1, 50, { filter: 'user = "' + userId + '"', sort: '-timestamp' })
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
                    analysis:       r.analysis       ?? null,
                    reportCurve:    r.report_curve   ?? null,
                    // Acoustic Scientist metadata
                    room_modes:     r.room_modes     ? _parseJson(r.room_modes, null)  : null,
                    schroeder_freq: r.schroeder_freq ?? null,
                    sbir_null:      r.sbir_null      ?? null,
                    scores:         r.scores         ? _parseJson(r.scores, null)      : null,
                    _cloud_updated: r.updated,
                }));

                const localRaw  = localStorage.getItem(LS_SESSIONS);
                const localSess = localRaw ? JSON.parse(localRaw) : [];
                const merged    = _mergeSessions(localSess, cloudSessions);
                localStorage.setItem(LS_SESSIONS, JSON.stringify(merged.slice(0, 20)));
            }

            // Pull prefs
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

        // Flush any profile data that was entered while not authenticated
        const pending = getPendingProfile();
        if (pending) {
            try {
                await pushProfile(pending, null);
                // pushProfile clears LS_PENDING_PROFILE on success
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
                .getFirstListItem('user = "' + userId + '" && session_id = "' + id + '"')
                .catch(() => null);
            if (record) await pb.collection('sessions').delete(record.id);
        } catch (err) {
            console.warn('[sync] deleteSession failed:', err?.message);
        }
    }

    // ── Module-level profile cache ────────────────────────────────────────────
    let _cachedProfile = null;

    // ── Push Hi-Fi profile to the users collection ────────────────────────────
    // When unauthenticated: caches to localStorage and fires 'mly:pendingdata'.
    // When authenticated:   saves via FormData (required for the avatar file field).
    async function pushProfile(data, avatarFile) {
        // Always persist locally first — data survives page reloads & auth changes
        _cachePendingProfile(data);

        if (!_authenticated()) {
            window.dispatchEvent(new CustomEvent('mly:pendingdata', { detail: { type: 'profile' } }));
            return; // caller interprets no-throw as "saved locally — ok"
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
            await pb.collection('users').update(userId, form);
            _cachedProfile         = { ...(_cachedProfile || {}), ...data };
            window.__MLY_PROFILE__ = _cachedProfile;
            // Clear pending cache now that it's safely in the cloud
            localStorage.removeItem(LS_PENDING_PROFILE);
        } catch (err) {
            console.warn('[sync] pushProfile failed:', err?.message);
            throw err; // re-throw so profile.js can show the error
        }
    }

    // ── Pull Hi-Fi profile fields from the users record ───────────────────────
    async function pullProfile() {
        if (!_authenticated()) return null;
        const pb     = _pb();
        const userId = _userId();

        try {
            const record = await pb.collection('users').getOne(userId);

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

    /** Returns the in-memory profile cache without hitting the network. */
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
