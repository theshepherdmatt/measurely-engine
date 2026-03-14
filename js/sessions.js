/**
 * sessions.js — Measurely Session Storage
 *
 * Dual-mode: reads from localStorage (GitHub Pages / offline) with a
 * transparent fallback to /api/sweephistory (when running on the Pi).
 *
 * Storage key: 'measurely_sessions'  → Array of session objects
 * Max entries kept: SESSIONS_MAX
 *
 * Session object shape (written by the upload modal, consumed by dashboard):
 * {
 *   id:          string,   // 'upload_<timestamp>'
 *   label:       string,   // WAV filename without extension
 *   timestamp:   string,   // ISO 8601
 *   overall_score: number, // 0–10
 *   peaks_dips:  number,
 *   reflections: number,
 *   bandwidth:   number,
 *   balance:     number,
 *   smoothness:  number,
 *   clarity:     number,
 *   has_analysis: boolean,
 *   note:        string,
 *   analysis:    object,   // full analysis payload (not sent to /api/sweephistory shape)
 *   reportCurve: object,
 * }
 */

'use strict';

const SESSIONS_KEY  = 'measurely_sessions';
const SESSIONS_MAX  = 20;

// ---------------------------------------------------------------------------
//  localStorage helpers
// ---------------------------------------------------------------------------

function lsRead() {
    try {
        return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]');
    } catch (e) {
        console.warn('[sessions] localStorage parse error:', e);
        return [];
    }
}

function lsWrite(sessions) {
    try {
        localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.slice(0, SESSIONS_MAX)));
    } catch (e) {
        console.warn('[sessions] localStorage write error:', e);
    }
}

// ---------------------------------------------------------------------------
//  Save a new session record (called by the upload modal)
// ---------------------------------------------------------------------------

/**
 * Save a completed analysis session to localStorage.
 * @param {object} opts
 * @param {string}  opts.id            - unique session ID ('upload_<ts>')
 * @param {string}  opts.label         - display label
 * @param {string}  opts.timestamp     - ISO 8601
 * @param {object}  opts.ai            - AI / scores object from analyse.js
 * @param {object}  opts.analysis      - full analysis object
 * @param {object}  opts.reportCurve   - freq/mag curve for the report
 */
function saveSession({ id, label, timestamp, ai, analysis, reportCurve }) {
    const scores = ai?.scores || {};

    const record = {
        id,
        label:         label || id,
        timestamp:     timestamp || new Date().toISOString(),
        has_analysis:  true,
        overall_score: scores.overall     ?? null,
        peaks_dips:    scores.peaks_dips  ?? null,
        reflections:   scores.reflections ?? null,
        bandwidth:     scores.bandwidth   ?? null,
        balance:       scores.balance     ?? null,
        smoothness:    scores.smoothness  ?? null,
        clarity:       scores.clarity     ?? null,
        note:          '',
        analysis,
        reportCurve,
    };

    const existing = lsRead();
    // Deduplicate by id, then prepend newest
    const filtered = existing.filter(s => s.id !== id);
    lsWrite([record, ...filtered]);

    console.log('[sessions] saved:', id);
    return record;
}

// ---------------------------------------------------------------------------
//  Update a session note
// ---------------------------------------------------------------------------

function updateNote(id, note) {
    const sessions = lsRead();
    const idx = sessions.findIndex(s => s.id === id);
    if (idx !== -1) {
        sessions[idx].note = note;
        lsWrite(sessions);
    }
}

// ---------------------------------------------------------------------------
//  Delete a session
// ---------------------------------------------------------------------------

function deleteSession(id) {
    lsWrite(lsRead().filter(s => s.id !== id));
    console.log('[sessions] deleted:', id);
}

// ---------------------------------------------------------------------------
//  Load session list
//  — tries localStorage first
//  — falls back to /api/sweephistory (Pi mode) if localStorage is empty
//  — merges both if both have entries
// ---------------------------------------------------------------------------

/**
 * Returns an array of session objects in descending timestamp order.
 * @returns {Promise<object[]>}
 */
async function loadSessions() {
    const local = lsRead();

    // Always try the server in the background; merge results
    let server = [];
    try {
        const res = await fetch('/api/sweephistory');
        if (res.ok) {
            const json = await res.json();
            server = Array.isArray(json?.sweeps) ? json.sweeps : [];
        }
    } catch (_) {
        // Offline or GitHub Pages — server not available, that's fine
    }

    // Merge: local entries take priority (same id → prefer local for note etc.)
    const localIds  = new Set(local.map(s => s.id));
    const serverOnly = server.filter(s => !localIds.has(s.id));
    const merged    = [...local, ...serverOnly];

    // Sort newest first — supports 'upload_YYMMDDHHmmss', timestamp, and uploads1/2/... IDs
    merged.sort((a, b) => {
        const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return tb - ta;
    });

    return merged;
}

// ---------------------------------------------------------------------------
//  Get a single session's full analysis payload from localStorage
//  (server sessions won't have the full payload locally)
// ---------------------------------------------------------------------------

function getSessionById(id) {
    return lsRead().find(s => s.id === id) || null;
}

// ---------------------------------------------------------------------------
//  Clear all localStorage sessions
// ---------------------------------------------------------------------------

function clearAllSessions() {
    if (!confirm('Delete all local measurement history? This cannot be undone.')) return false;
    localStorage.removeItem(SESSIONS_KEY);
    console.log('[sessions] cleared all local sessions');
    return true;
}

// ---------------------------------------------------------------------------
//  Exports
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { saveSession, updateNote, deleteSession, loadSessions, getSessionById, clearAllSessions };
} else if (typeof window !== 'undefined') {
    window.MeasurelySessions = { saveSession, updateNote, deleteSession, loadSessions, getSessionById, clearAllSessions };
}