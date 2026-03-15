/**
 * sync.js — Measurely cloud sync
 *
 * Depends on: auth.js (window._pb accessor) loaded before this.
 * Exposes:    window.MeasurelySync
 *
 * All methods are no-ops when the user is not authenticated.
 * Safe to call unconditionally from room.js / sessions.js / speakers.js.
 */

(function () {
    'use strict';

    const LS_ROOM     = 'measurely_room';
    const LS_SESSIONS = 'measurely_sessions';
    const LS_SPEAKER  = 'mly.speaker.key';
    const LS_ONBOARD  = 'measurely_onboarded';

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

    // ── Push room config ─────────────────────────────────────────────────────
    // Maps the localStorage nested format → PocketBase collection fields:
    //   payload.geometry    → dimensions
    //   payload.setup       → speaker_pos
    //   payload.environment → treatment
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
                .getFirstListItem(`user="${userId}"`)
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
    // Returns the normalised room object (same shape as localStorage payload)
    // or null if the user has no cloud record yet.
    // Also writes the result to localStorage when the cloud record is newer.
    async function pullRoom() {
        if (!_authenticated()) return null;
        const pb     = _pb();
        const userId = _userId();

        try {
            const record = await pb.collection('rooms')
                .getFirstListItem(`user="${userId}"`)
                .catch(() => null);

            if (!record) return null;

            // Re-assemble into the shape myroom.html expects
            const normalised = {
                geometry:    record.dimensions  ?? {},
                setup:       record.speaker_pos ?? {},
                environment: record.treatment   ?? {},
                room_type:   record.dimensions?.room_type ?? record.room_type ?? 'home',
                saved_at:    record.updated,
            };

            // Persist locally — prefer cloud when we have a valid record
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

    // ── Push a single session ────────────────────────────────────────────────
    async function pushSession(session) {
        if (!_authenticated() || !session?.id) return;
        const pb     = _pb();
        const userId = _userId();

        const payload = {
            user:          userId,
            session_id:    session.id,
            label:         session.label         ?? '',
            timestamp:     session.timestamp      ?? new Date().toISOString(),
            overall_score: session.overall_score  ?? null,
            peaks_dips:    session.peaks_dips     ?? null,
            reflections:   session.reflections    ?? null,
            bandwidth:     session.bandwidth      ?? null,
            balance:       session.balance        ?? null,
            smoothness:    session.smoothness     ?? null,
            clarity:       session.clarity        ?? null,
            has_analysis:  session.has_analysis   ?? false,
            note:          session.note           ?? '',
            analysis:      session.analysis       ?? null,
            report_curve:  session.reportCurve    ?? null,
        };

        try {
            const existing = await pb.collection('sessions')
                .getFirstListItem(`user="${userId}" && session_id="${session.id}"`)
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

    // ── Push speaker preference + onboarded flag ─────────────────────────────
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

    // ── Pull all cloud data into localStorage ────────────────────────────────
    async function pullAll() {
        if (!_authenticated()) return;
        const pb     = _pb();
        const userId = _userId();

        try {
            // Pull room
            const roomRecord = await pb.collection('rooms')
                .getFirstListItem(`user="${userId}"`)
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
                    filter:  `user="${userId}"`,
                    sort:    '-timestamp',
                })
                .catch(() => null);

            if (sessionRecords?.items?.length) {
                const cloudSessions = sessionRecords.items.map(r => ({
                    id:            r.session_id,
                    label:         r.label,
                    timestamp:     r.timestamp,
                    overall_score: r.overall_score,
                    peaks_dips:    r.peaks_dips,
                    reflections:   r.reflections,
                    bandwidth:     r.bandwidth,
                    balance:       r.balance,
                    smoothness:    r.smoothness,
                    clarity:       r.clarity,
                    has_analysis:  r.has_analysis,
                    note:          r.note,
                    analysis:      r.analysis ?? null,
                    reportCurve:   r.report_curve ?? null,
                    _cloud_updated: r.updated,
                }));

                const localRaw  = localStorage.getItem(LS_SESSIONS);
                const localSess = localRaw ? JSON.parse(localRaw) : [];

                const merged = _mergeSessions(localSess, cloudSessions);
                localStorage.setItem(LS_SESSIONS, JSON.stringify(merged.slice(0, 20)));
            }

            // Pull prefs
            const user = pb.authStore.model;
            if (user?.speaker_key) {
                localStorage.setItem(LS_SPEAKER, user.speaker_key);
            }
            if (user?.onboarded) {
                localStorage.setItem(LS_ONBOARD, 'true');
            }

        } catch (err) {
            console.warn('[sync] pullAll failed:', err?.message);
        }
    }

    // ── On first login: push all existing localStorage data up ───────────────
    async function pushLocalData() {
        if (!_authenticated()) return;

        // Push room
        await pushRoom();

        // Push all sessions
        const raw = localStorage.getItem(LS_SESSIONS);
        const sessions = raw ? JSON.parse(raw) : [];
        for (const s of sessions) {
            await pushSession(s);
        }

        // Push prefs
        await pushPrefs();
    }

    // ── Delete a session from cloud ──────────────────────────────────────────
    async function deleteSession(id) {
        if (!_authenticated() || !id) return;
        const pb     = _pb();
        const userId = _userId();

        try {
            const record = await pb.collection('sessions')
                .getFirstListItem(`user="${userId}" && session_id="${id}"`)
                .catch(() => null);

            if (record) await pb.collection('sessions').delete(record.id);
        } catch (err) {
            console.warn('[sync] deleteSession failed:', err?.message);
        }
    }

    // ── Merge helper ─────────────────────────────────────────────────────────
    // Deduplicates by session.id, keeping the newer record (by _cloud_updated > timestamp).
    function _mergeSessions(local, cloud) {
        const map = new Map();

        // Index local sessions
        local.forEach(s => map.set(s.id, s));

        // Merge cloud sessions — cloud wins on conflict if it was updated more recently
        cloud.forEach(cs => {
            const existing = map.get(cs.id);
            if (!existing) {
                map.set(cs.id, cs);
                return;
            }
            const cloudT = cs._cloud_updated ? new Date(cs._cloud_updated).getTime() : 0;
            const localT = existing.timestamp ? new Date(existing.timestamp).getTime() : 0;
            if (cloudT > localT) map.set(cs.id, { ...existing, ...cs });
        });

        // Sort newest first
        return Array.from(map.values()).sort((a, b) =>
            new Date(b.timestamp || 0) - new Date(a.timestamp || 0)
        );
    }

    // ── Expose ───────────────────────────────────────────────────────────────
    window.MeasurelySync = {
        pushRoom,
        pullRoom,
        pushSession,
        pushPrefs,
        pullAll,
        pushLocalData,
        deleteSession,
    };

})();
