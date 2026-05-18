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
// absorptionDb is the per-band attenuation a panel applies to deviations
// from the local band mean. The shrink is MULTIPLICATIVE in the linear
// (pressure) domain: shrinkFactor = 10^(absorptionDb / 20). A −3 dB band
// scales each deviation by ≈0.71, a −2 dB band by ≈0.79.
//
// Both peaks (positive deviation) and dips (negative deviation) shrink
// proportionally — physically, broadband absorption reduces reflected-wave
// magnitude, which lowers constructive peaks AND fills destructive nulls.
//
// History: an earlier version used a SUBTRACTIVE shrink (|dev| − shrinkDb).
// That snapped any deviation smaller than shrinkDb to exactly zero, which
// flattened sections of the curve into plateaus and surfaced as new modes
// at band boundaries. The multiplicative model is continuous and physically
// correct (energy absorption ↔ dB attenuation of reflected level).
//
// scoreBoosts apply directly to time-domain scores. primary effect = +1.5;
// secondary = +0.9 (60% of primary, per spec). They stack additively across
// treatments, then the final score is clamped to [0, 10].

const PRIMARY_BOOST   = 1.5;
const SECONDARY_BOOST = 0.9;

// materialId on each archetype is a reference into js/engine/materials/.
// The score path still reads absorptionBands; materialId is unused by
// scoring today and is here so a later prompt can swap the dB bands for
// octave-band Sabine α drawn from a real, mounted, provenance-tagged
// product entry.
const TREATMENT_PROFILES = {
    bass_trap: {
        name: 'Bass traps',
        materialId: 'gik-244-flexrange-full-range',
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
        materialId: 'primacoustic-broadway-2in-amount',
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
        materialId: 'primacoustic-broadway-2in-amount',
        affects: { reflections: 'primary', clarity: 'secondary' },
        absorptionBands: [
            { freqLo:  500, freqHi: 2000, absorptionDb: -2.5 },
            { freqLo: 2000, freqHi: 8000, absorptionDb: -2.0 },
        ],
        scoreBoosts: { reflections: PRIMARY_BOOST, clarity: SECONDARY_BOOST },
    },
    ceiling_panel: {
        name: 'Ceiling cloud',
        materialId: 'acoustic-ceiling-tile-typical-e400',
        affects: { reflections: 'primary', smoothness: 'secondary' },
        absorptionBands: [
            { freqLo: 1000, freqHi:  4000, absorptionDb: -2.0 },
            { freqLo: 4000, freqHi: 10000, absorptionDb: -1.5 },
        ],
        scoreBoosts: { reflections: PRIMARY_BOOST, clarity: 0 },
    },
};

// Resolve the materials module in either Node (require) or browser
// (window.MeasurelyMaterials, if a consumer has loaded it). Returns null
// when unavailable so getTreatmentMaterial degrades gracefully.
function _materialsModule() {
    if (typeof require !== 'undefined') {
        try { return require('./materials/index.js'); }
        catch (_) { /* fall through to browser path */ }
    }
    if (typeof window !== 'undefined' && window.MeasurelyMaterials) {
        return window.MeasurelyMaterials;
    }
    return null;
}

function getTreatmentMaterial(treatmentType) {
    const profile = TREATMENT_PROFILES[treatmentType];
    if (!profile || typeof profile.materialId !== 'string') return null;
    const mod = _materialsModule();
    if (!mod || typeof mod.getMaterial !== 'function') return null;
    return mod.getMaterial(profile.materialId) || null;
}

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
 * Computes the band's mean from the current (already partially treated)
 * mag, then shrinks each sample's deviation from that mean by a factor
 * of 10^(absorptionDb / 20). Peaks shrink toward the mean and dips fill
 * toward the mean by the same proportion — physically, a broadband
 * absorber reduces reflected-wave magnitude, lowering peaks and filling
 * nulls. Band mean is preserved.
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

    const bandMean     = sum / indices.length;
    // 10^(absorptionDb / 20) — same exponent as a voltage/pressure ratio.
    // absorptionDb is negative (energy loss): −3 dB ≈ 0.708×, −2 dB ≈ 0.794×.
    const shrinkFactor = Math.pow(10, band.absorptionDb / 20);

    for (const i of indices) {
        mag[i] = bandMean + (mag[i] - bandMean) * shrinkFactor;
    }
}

// ---------------------------------------------------------------------------
// Regression test (run with `node engine/js/engine/treatments.js`)
//
// Guards the bug that bit us: applying any treatment to a synthetic
// measurement with both peaks AND dips must make scoreModes() rise (or
// stay equal), never fall. The earlier subtractive shrink + PPO-48
// scoring path made it fall — toggling Bass Traps on the demo dropped
// peaks_dips from 5 to 2.
// ---------------------------------------------------------------------------
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    /* eslint-disable */
    const SM = require('./signal_math.js');
    const SC = require('./score.js');
    global.MeasurelySignalMath = SM;
    global.MeasurelyScore      = SC;

    // Synthesise directly at PPO 12 (the resolution scoring uses) — narrow
    // single-bin spikes that survive log-binning and the modes() moving-avg.
    const ppo = 12;
    const f = [], m = [];
    for (let i = 0; ; i++) {
        const fi = 20 * Math.pow(2, i / ppo);
        if (fi > 20000) break;
        f.push(fi);
        m.push(0);
    }
    for (let i = 0; i < f.length; i++) {
        const fi = f[i];
        if (Math.abs(fi - 50)  < 3)  m[i] += 8;   // bass-mode peak
        if (Math.abs(fi - 90)  < 5)  m[i] -= 10;  // SBIR null — this is the dip that must NOT deepen
        if (Math.abs(fi - 250) < 8)  m[i] += 7;   // mid-mode peak
    }
    const analysis = { freq: f, mag: m, reflections_ms: [1.5, 4.0, 8.0] };
    const baseline = SC.reScoreFromMagnitude(f, m, { refs: analysis.reflections_ms });

    let failures = 0;
    for (const key of Object.keys(TREATMENT_PROFILES)) {
        const r = applyTreatments(analysis, [key]);
        const drop = r.peaks_dips < baseline.peaks_dips;
        const tag  = drop ? 'FAIL' : 'pass';
        console.log(`[${tag}] ${key.padEnd(15)} pd: ${baseline.peaks_dips} → ${r.peaks_dips}` +
                    `  sm: ${baseline.smoothness} → ${r.smoothness}` +
                    `  ov: ${baseline.bandwidth ? '' : ''}${r.overall}`);
        if (drop) failures++;
    }

    // -- Material link regressions (additive; no score path involved) ------
    // (a) every profile has a string materialId
    for (const key of Object.keys(TREATMENT_PROFILES)) {
        const id = TREATMENT_PROFILES[key].materialId;
        if (typeof id !== 'string' || id.length === 0) {
            console.error(`[FAIL] ${key}: materialId is not a non-empty string (got ${JSON.stringify(id)})`);
            failures++;
        }
    }
    // (b) getTreatmentMaterial resolves a non-null material for every type
    // (c) each resolved material exposes absorption.coefficients
    for (const key of Object.keys(TREATMENT_PROFILES)) {
        const mat = getTreatmentMaterial(key);
        if (!mat) {
            console.error(`[FAIL] ${key}: getTreatmentMaterial returned null`);
            failures++;
            continue;
        }
        if (!mat.absorption || typeof mat.absorption.coefficients !== 'object' || mat.absorption.coefficients === null) {
            console.error(`[FAIL] ${key} -> ${mat.id}: missing absorption.coefficients`);
            failures++;
            continue;
        }
        console.log(`[pass] ${key.padEnd(15)} -> ${mat.id}`);
    }

    if (failures > 0) {
        console.error(`\n${failures} regression failure(s)`);
        process.exit(1);
    } else {
        console.log('\nAll treatments raise (or hold) peaks_dips ✓');
        console.log('All archetypes link to a resolvable material ✓');
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
    module.exports = { applyTreatments, getTreatmentMaterial, TREATMENT_PROFILES };
} else if (typeof window !== 'undefined') {
    window.MeasurelyTreatments = { applyTreatments, getTreatmentMaterial, TREATMENT_PROFILES };
}
