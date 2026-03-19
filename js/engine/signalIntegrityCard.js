/**
 * signalIntegrityCard.js — Measurely Engine UI
 *
 * Renders the Signal Integrity score card into any container element.
 * Mirrors the analysis-block pattern used throughout dashboard.js.
 *
 * Signal Integrity data comes from:
 *   MeasurelyScore.computeSignalIntegrity(ir)   → engine/score.js
 *   surfaced via MeasurelyAnalyse.analyse(…)    → engine/analyse.js
 *   as result.analysis.signal_integrity
 *
 * Shape of signalIntegrity object:
 *   {
 *     score:       number        — 0–10, rounded to 1 dp
 *     snr_db:      number|null   — SNR in dB; null when peak < 1e-4
 *     peak:        number        — highest IR amplitude (scaled ×1e6 in score.js)
 *     noise_floor: number|null   — median IR tail amplitude; null when peak < 1e-4
 *   }
 *
 * Gating logic (from analyse.js, lines 222–228):
 *   score <= 0   → hard fail:  overall score set to NaN
 *   score < 5    → soft fail:  overall score capped at 6.5
 *   score >= 6.5 → clean:      overall score unaffected
 *
 * Usage:
 *   import { renderSignalIntegrityCard } from './engine/signalIntegrityCard.js';
 *   renderSignalIntegrityCard(document.getElementById('siCard'), analysis.signal_integrity);
 *
 *   // Or update an existing card when new data arrives:
 *   renderSignalIntegrityCard(el, newSignalIntegrity);
 */

'use strict';

// ─── Threshold constants (mirrors analyse.js) ─────────────────────────────────

const HARD_FAIL  = 0.0;
const SOFT_MIN   = 5.0;
const SOFT_CAP   = 6.5;

// ─── Status tier helpers ──────────────────────────────────────────────────────

/**
 * Derive the named status tier from a signal integrity score.
 * @param {number} score
 * @returns {'hard_fail'|'soft_fail'|'marginal'|'clean'}
 */
function _getStatus(score) {
    if (!Number.isFinite(score) || score <= HARD_FAIL) return 'hard_fail';
    if (score < SOFT_MIN)                               return 'soft_fail';
    if (score < SOFT_CAP)                               return 'marginal';
    return 'clean';
}

const STATUS_META = {
    hard_fail: {
        label:       'No Signal',
        description: 'No usable signal detected. The overall room score cannot be calculated.',
        cssClass:    'si-status--fail',
    },
    soft_fail: {
        label:       'Weak Signal',
        description: 'Signal too weak for reliable scoring. The overall room score is capped at 6.5.',
        cssClass:    'si-status--warn',
    },
    marginal: {
        label:       'Acceptable',
        description: 'Signal quality is acceptable but not ideal. Scores may be slightly less accurate.',
        cssClass:    'si-status--marginal',
    },
    clean: {
        label:       'Clean',
        description: 'Signal quality is good. Scores are unaffected.',
        cssClass:    'si-status--clean',
    },
};

// ─── Formatting helpers ───────────────────────────────────────────────────────

function _fmtScore(score) {
    return Number.isFinite(score) ? score.toFixed(1) : '—';
}

function _fmtDb(val) {
    return val != null && Number.isFinite(val) ? `${val.toFixed(1)} dB` : '—';
}

function _fmtAmp(val) {
    return val != null && Number.isFinite(val) ? val.toFixed(6) : '—';
}

// ─── HTML builder ─────────────────────────────────────────────────────────────

/**
 * Build the inner HTML for the Signal Integrity card.
 *
 * Accessibility notes:
 *   • The card uses <article> with a clear accessible name via aria-labelledby.
 *   • The caller must ensure the card's `cardId` is unique on the page — the
 *     default 'si-card' is fine for pages with one card, but pass a distinct id
 *     (e.g. `'si-card-session-3'`) when rendering multiple cards simultaneously
 *     to avoid duplicate-id violations (WCAG 4.1.1).
 *   • Score colour is never the only means of conveying status (WCAG 1.4.1) —
 *     the status label text is always rendered visibly inside the chip.
 *   • <dl> + <div> wrappers around <dt>/<dd> pairs is valid HTML5 and gives
 *     screen readers native label-to-value pairing.
 *   • Heading level is <h3>. Place this card in a context where that level
 *     fits your page's heading hierarchy.
 *
 * @param {{ score:number, snr_db:number|null, peak:number, noise_floor:number|null }|null} si
 * @param {string} [cardId='si-card'] - Unique id prefix; used for aria-labelledby.
 * @returns {string} HTML string safe to assign to element.innerHTML
 */
function _buildHTML(si, cardId = 'si-card') {
    const headingId = `${cardId}-heading`;
    // ── No data yet state ────────────────────────────────────────────────────
    if (!si) {
        return `
        <article class="si-card glass-panel" aria-labelledby="${headingId}">
            <h3 class="si-card__heading" id="${headingId}">Signal Integrity</h3>
            <p class="si-card__empty">No measurement loaded yet.</p>
        </article>`;
    }

    const { score, snr_db, peak, noise_floor } = si;
    const status = _getStatus(score);
    const meta   = STATUS_META[status];

    const scoreDisplay = _fmtScore(score);

    // Full human-readable label used in the heading and as the aria-label of the
    // score numeral row so all the information is in one coherent sentence.
    const fullLabel = `Signal Integrity: ${scoreDisplay} out of 10 — ${meta.label}`;

    return `
    <article class="si-card glass-panel" aria-labelledby="${headingId}">

        <h3 class="si-card__heading" id="${headingId}">Signal Integrity</h3>

        <!-- Score display + status chip ─────────────────────────────────── -->
        <div class="si-card__score-row" aria-label="${fullLabel}">
            <span class="si-card__score-num" aria-hidden="true">${scoreDisplay}</span>
            <span class="si-card__score-denom" aria-hidden="true">/10</span>
            <span class="si-card__status-chip ${meta.cssClass}">${meta.label}</span>
        </div>

        <!-- Plain-text explanation of what this status means for scoring ── -->
        <p class="si-card__description">${meta.description}</p>

        <!-- Diagnostic detail ───────────────────────────────────────────── -->
        <dl class="si-card__meta" aria-label="Signal integrity diagnostic detail">
            <div class="si-card__meta-item">
                <dt class="si-card__meta-label">SNR</dt>
                <dd class="si-card__meta-value">${_fmtDb(snr_db)}</dd>
            </div>
            <div class="si-card__meta-item">
                <dt class="si-card__meta-label">Peak level</dt>
                <dd class="si-card__meta-value">${_fmtAmp(peak)}</dd>
            </div>
            <div class="si-card__meta-item">
                <dt class="si-card__meta-label">Noise floor</dt>
                <dd class="si-card__meta-value">${_fmtAmp(noise_floor)}</dd>
            </div>
        </dl>

    </article>`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Render (or re-render) the Signal Integrity card into `containerEl`.
 *
 * @param {HTMLElement} containerEl - Element to render into.
 * @param {{ score:number, snr_db:number|null, peak:number, noise_floor:number|null }|null} si
 *   Pass `null` to show the "no data" state.
 * @param {string} [cardId='si-card'] - Unique id prefix for aria-labelledby.
 *   Must be unique on the page; use a distinct value when rendering multiple cards.
 */
function renderSignalIntegrityCard(containerEl, si, cardId = 'si-card') {
    if (!containerEl) return;
    containerEl.innerHTML = _buildHTML(si, cardId);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { renderSignalIntegrityCard };
} else if (typeof window !== 'undefined') {
    window.MeasurelySignalIntegrityCard = { renderSignalIntegrityCard };
}
