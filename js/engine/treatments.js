/**
 * treatments.js — Measurely Engine
 *
 * Acoustic treatment simulation layer.
 *
 * Predictive model: not a physical measurement.
 *
 * Takes a measured analysis result (from MeasurelyAnalyse.analyse) and a
 * list of active treatment keys, applies a conservative absorption model
 * to the measured frequency response, and re-runs the relevant scoring
 * functions to produce PREDICTED scores that the user can compare against
 * their MEASURED baseline.
 *
 * Frequency-domain treatments (peaks_dips / smoothness / balance / bandwidth)
 * emerge from re-scoring the attenuated mag array. Time-domain scores
 * (reflections / clarity) are reached via direct score boosts because
 * those scores derive from the impulse response, not the magnitude curve.
 *
 * Effects are independent and additive across treatments. Final scores
 * are clamped to [0, 10].
 *
 * Dependencies (must be loaded before this file):
 *   engine/signal_math.js  → window.MeasurelySignalMath
 *   engine/score.js        → window.MeasurelyScore  (incl. reScoreFromMagnitude)
 *
 * Browser:
 *   const predicted = MeasurelyTreatments.applyTreatments(analysis, ['bass_trap','side_panel']);
 */

'use strict';

// ---------------------------------------------------------------------------
// Treatment profiles — conservative absorption model
// ---------------------------------------------------------------------------
//
// absorptionDb is the dB amount by which deviations from the local band
// baseline are shrunk toward the baseline. Both peaks (positive deviation)
// and dips (negative deviation) shrink — physically, panel absorption
// reduces the reflected wave magnitude, which lowers peak heights and
// fills nulls.
//
// scoreBoosts apply directly to time-domain scores. primary effect = +1.5;
// secondary = +0.9 (60% of primary, per spec). They stack additively across
// treatments, then the final score is clamped to [0, 10].

const PRIMARY_BOOST   = 1.5;
const SECONDARY_BOOST = 0.9;

const TREATMENT_PROFILES = {
    bass_trap: {
        name: 'Bass traps',
        affects: { peaks_dips: 'primary', smoothness: 'secondary' },
        absorptionBands: [
            { freqLo:  40, freqHi:  100, absorptionDb: -3.0 },
            { freqLo: 100, freqHi:  200, absorptionDb: -2.5 },
            { freqLo: 200, freqHi:  400, absorptionDb: -1.5 },
        ],
        scoreBoosts: { reflections: 0, clarity: 0 },
    },
    wall_panel: {
        name: 'Front wall panels',
        affects: { peaks_dips: 'primary', reflections: 'secondary' },
        absorptionBands: [
            { freqLo:  200, freqHi:  500, absorptionDb: -2.0 },
            { freqLo:  500, freqHi: 2000, absorptionDb: -1.5 },
            { freqLo: 2000, freqHi: 5000, absorptionDb: -1.0 },
        ],
        scoreBoosts: { reflections: SECONDARY_BOOST, clarity: 0 },
    },
    side_panel: {
        name: 'Side panels',
        affects: { reflections: 'primary', clarity: 'secondary' },
        absorptionBands: [
            { freqLo:  500, freqHi: 2000, absorptionDb: -2.5 },
            { freqLo: 2000, freqHi: 8000, absorptionDb: -2.0 },
        ],
        scoreBoosts: { reflections: PRIMARY_BOOST, clarity: SECONDARY_BOOST },
    },
    ceiling_panel: {
        name: 'Ceiling cloud',
        affects: { reflections: 'primary', smoothness: 'secondary' },
        absorptionBands: [
            { freqLo: 1000, freqHi:  4000, absorptionDb: -2.0 },
            { freqLo: 4000, freqHi: 10000, absorptionDb: -1.5 },
        ],
        scoreBoosts: { reflections: PRIMARY_BOOST, clarity: 0 },
    },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _clamp(v, lo, hi) {
    if (!isFinite(v)) return v;
    return Math.max(lo, Math.min(hi, v));
}

function _round1(v) {
    return isFinite(v) ? Math.round(v * 10) / 10 : v;
}

/**
 * Apply one absorption band to a magnitude array, in place.
 *
 * Predictive model: not a physical measurement.
 *
 * Within the band, compute the band's mean as a baseline, then shrink
 * each sample's deviation from the baseline toward zero by |absorptionDb|.
 * Peaks become smaller, dips become shallower, mean is preserved — which
 * is what a broadband absorber does in the room (it reduces reflection
 * magnitude, collapsing both constructive peaks and destructive nulls).
 */
function _applyAbsorptionBand(freq, mag, band) {
    const indices = [];
    let sum = 0;
    for (let i = 0; i < freq.length; i++) {
        if (freq[i] >= band.freqLo && freq[i] < band.freqHi && isFinite(mag[i])) {
            indices.push(i);
            sum += mag[i];
        }
    }
    if (indices.length === 0) return;

    const baseline = sum / indices.length;
    const shrinkDb = Math.abs(band.absorptionDb);

    for (const i of indices) {
        const dev    = mag[i] - baseline;
        const newDev = Math.sign(dev) * Math.max(0, Math.abs(dev) - shrinkDb);
        mag[i] = baseline + newDev;
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Apply a set of treatments to a measured analysis and return predicted scores.
 *
 * Predictive model: not a physical measurement.
 *
 * @param {object}   analysis        - result from MeasurelyAnalyse.analyse() — the .analysis sub-object
 * @param {string[]} treatmentKeys   - active treatments (e.g. ['bass_trap', 'side_panel'])
 * @param {object}   [options]
 * @param {boolean}  [options.isStudio=false]      - studio room → flat target curve
 * @param {boolean}  [options.hasCoffeeTable=false]
 * @returns {{ bandwidth:number, balance:number, peaks_dips:number, smoothness:number,
 *            reflections:number, clarity:number, overall:number, predicted:true,
 *            applied:string[] } | null}
 */
function applyTreatments(analysis, treatmentKeys, options = {}) {
    if (!analysis || !Array.isArray(analysis.freq) || !Array.isArray(analysis.mag)) {
        return null;
    }

    const SC = (typeof MeasurelyScore !== 'undefined') ? MeasurelyScore : null;
    if (!SC || typeof SC.reScoreFromMagnitude !== 'function') {
        console.warn('[treatments] MeasurelyScore.reScoreFromMagnitude not available');
        return null;
    }

    const activeKeys = (Array.isArray(treatmentKeys) ? treatmentKeys : [])
        .filter(k => TREATMENT_PROFILES[k]);

    // Copy mag so we never mutate the measured analysis
    const freq = analysis.freq;
    const mag  = analysis.mag.slice();

    // Apply each active treatment's absorption bands to the working mag
    for (const key of activeKeys) {
        const profile = TREATMENT_PROFILES[key];
        for (const band of profile.absorptionBands) {
            _applyAbsorptionBand(freq, mag, band);
        }
    }

    // Re-score the attenuated frequency response. Reflection time-stamps and
    // signal-integrity flags are passthrough — treatments don't modify the IR
    // itself, only its frequency content.
    const isStudio       = !!options.isStudio;
    const hasCoffeeTable = !!options.hasCoffeeTable;
    const refs           = Array.isArray(analysis.reflections_ms) ? analysis.reflections_ms : [];

    const reScored = SC.reScoreFromMagnitude(freq, mag, {
        refs,
        hasCoffeeTable,
        isStudio,
    });

    // Apply direct boosts for time-domain scores. Frequency-domain absorption
    // can't change reflections/clarity (those derive from the IR), so each
    // treatment that affects them adds a bounded boost — primary +1.5,
    // secondary +0.9 — and the result is clamped to [0, 10].
    let reflections = reScored.reflections;
    let clarity     = reScored.clarity;
    for (const key of activeKeys) {
        const boosts = TREATMENT_PROFILES[key].scoreBoosts || {};
        if (isFinite(reflections)) reflections += boosts.reflections || 0;
        if (isFinite(clarity))     clarity     += boosts.clarity     || 0;
    }

    const out = {
        bandwidth:   _round1(_clamp(reScored.bandwidth,  0, 10)),
        balance:     _round1(_clamp(reScored.balance,    0, 10)),
        peaks_dips:  _round1(_clamp(reScored.peaks_dips, 0, 10)),
        smoothness:  _round1(_clamp(reScored.smoothness, 0, 10)),
        reflections: _round1(_clamp(reflections,         0, 10)),
        clarity:     _round1(_clamp(clarity,             0, 10)),
    };

    const finite = Object.values(out).filter(isFinite);
    out.overall = finite.length > 0
        ? _round1(finite.reduce((a, b) => a + b, 0) / finite.length)
        : NaN;

    out.predicted = true;
    out.applied   = activeKeys.slice();

    return out;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { applyTreatments, TREATMENT_PROFILES };
} else if (typeof window !== 'undefined') {
    window.MeasurelyTreatments = { applyTreatments, TREATMENT_PROFILES };
}
