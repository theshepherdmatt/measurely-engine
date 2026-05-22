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
// absorptionDb is the attenuation a panel applies to the modal ripple —
// the deviation of the response from a broad, continuous baseline. The
// shrink is MULTIPLICATIVE in the linear (pressure) domain:
// shrinkFactor = 10^(absorptionDb / 20). A −3 dB value scales each
// deviation by ≈0.71, a −2 dB value by ≈0.79.
//
// Both peaks (positive deviation) and dips (negative deviation) shrink
// proportionally — physically, broadband absorption reduces reflected-wave
// magnitude, which lowers constructive peaks AND fills destructive nulls.
//
// The absorptionBands below are CONTROL POINTS, not hard-edged blocks.
// Absorption is interpolated smoothly (in log-frequency) between band
// centres, and every sample is shrunk toward a single continuous baseline.
// Both the absorption amount and the shrink target therefore vary
// continuously across frequency, so no step forms at a band boundary.
//
// History:
//  - An early version used a SUBTRACTIVE shrink (|dev| − shrinkDb), which
//    snapped small deviations to zero and flattened sections into plateaus.
//  - Its replacement shrank each band toward its OWN per-band mean. That is
//    multiplicative and continuous WITHIN a band, but because real rooms
//    have different mean levels per band it left a cliff at every band
//    boundary. signal_math.modes() read each cliff as a phantom peak/dip,
//    and peaks_dips (a max-of-|delta| metric) FELL when traps were enabled.
//  - Current model: continuous interpolated absorption + a single
//    continuous baseline. No boundary cliff, so a treatment can no longer
//    manufacture a peak/dip artifact.
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
 * Smoothstep ease — C1-continuous 0→1 ramp. Interpolates the absorption
 * amount between band control points with no slope kink at a control point.
 */
function _smoothstep(t) {
    const x = Math.max(0, Math.min(1, t));
    return x * x * (3 - 2 * x);
}

/**
 * Continuous baseline of a magnitude curve — a centred moving average over
 * a ~1-octave window. Slowly varying, so (mag − baseline) is the modal
 * ripple. Treatments shrink that ripple toward this single continuous
 * target; using one continuous baseline (rather than per-band block means)
 * is what keeps the treated curve cliff-free at band boundaries.
 */
function _broadBaseline(freq, mag) {
    const EDGE = Math.pow(2, 0.5);   // window spans f/√2 .. f·√2 → one octave
    const out  = new Array(mag.length);
    for (let i = 0; i < mag.length; i++) {
        const lo = freq[i] / EDGE, hi = freq[i] * EDGE;
        let sum = 0, n = 0;
        for (let j = 0; j < mag.length; j++) {
            if (freq[j] >= lo && freq[j] <= hi && isFinite(mag[j])) { sum += mag[j]; n++; }
        }
        out[i] = n > 0 ? sum / n : mag[i];
    }
    return out;
}

/**
 * Interpolate a profile's absorptionDb at one frequency.
 *
 * absorptionBands are treated as control points anchored at each band's
 * geometric centre. Between centres the value is interpolated in log-
 * frequency with a smoothstep ease — continuous in value AND slope, so no
 * step forms at any band boundary. Below the lowest centre / above the
 * highest the end value is held flat (no extrapolation past the range).
 *
 * @param {number} fHz
 * @param {{ centreHz:number, absorptionDb:number }[]} points - sorted by centreHz
 * @returns {number} absorptionDb at fHz
 */
function _interpAbsorptionDb(fHz, points) {
    if (points.length === 0) return 0;
    if (fHz <= points[0].centreHz) return points[0].absorptionDb;
    const last = points[points.length - 1];
    if (fHz >= last.centreHz) return last.absorptionDb;
    for (let k = 0; k < points.length - 1; k++) {
        const a = points[k], b = points[k + 1];
        if (fHz >= a.centreHz && fHz < b.centreHz) {
            const t = (Math.log2(fHz) - Math.log2(a.centreHz)) /
                      (Math.log2(b.centreHz) - Math.log2(a.centreHz));
            return a.absorptionDb + (b.absorptionDb - a.absorptionDb) * _smoothstep(t);
        }
    }
    return last.absorptionDb;   // defensive — unreachable given the guards above
}

/**
 * Apply one treatment profile's absorption to a magnitude array, in place.
 *
 * Predictive model: not a physical measurement.
 *
 * Continuous-absorption model. Each band is a control point; the absorption
 * amount is interpolated smoothly across frequency between control points
 * (see _interpAbsorptionDb), and every sample inside the profile's range is
 * shrunk toward a single continuous baseline (see _broadBaseline) by
 * 10^(absorptionDb / 20). Peaks come down and dips fill exactly as before,
 * but because both the absorption amount and the shrink target vary
 * continuously, no step discontinuity forms at a band boundary — the
 * artifact that previously manufactured a phantom peak/dip and drove
 * peaks_dips DOWN when traps were enabled.
 *
 * Frequencies outside [lowest freqLo, highest freqHi) are left untouched,
 * matching the prior model's range behaviour.
 */
function _applyAbsorptionProfile(freq, mag, bands) {
    if (!Array.isArray(bands) || bands.length === 0) return;

    // Control points — one per band, anchored at the band's geometric centre.
    const points = bands
        .map(b => ({
            centreHz:     Math.sqrt(b.freqLo * b.freqHi),
            absorptionDb: b.absorptionDb,
        }))
        .sort((a, b) => a.centreHz - b.centreHz);

    // Treated range — the union span of all bands. Outside it, untouched.
    const rangeLo = Math.min(...bands.map(b => b.freqLo));
    const rangeHi = Math.max(...bands.map(b => b.freqHi));

    // Single continuous shrink target for the whole curve.
    const baseline = _broadBaseline(freq, mag);

    for (let i = 0; i < freq.length; i++) {
        const f = freq[i];
        if (f < rangeLo || f >= rangeHi || !isFinite(mag[i])) continue;
        // 10^(absorptionDb / 20) — pressure-ratio shrink, same exponent as
        // before. absorptionDb is negative: −3 dB ≈ 0.708×, −1.5 dB ≈ 0.841×.
        const shrink = Math.pow(10, _interpAbsorptionDb(f, points) / 20);
        mag[i] = baseline[i] + (mag[i] - baseline[i]) * shrink;
    }
}

// ---------------------------------------------------------------------------
// Regression test (run with `node engine/js/engine/treatments.js`)
//
// Guards the bug that bit us: applying any treatment to a synthetic
// measurement with both peaks AND dips must make scoreModes() rise (or
// stay equal), never fall.
//
// The synthetic input uses a SLOPED baseline (elevated bass tapering to
// flat by the upper mids), representative of a real room. This matters: an
// earlier version of this test used a FLAT baseline, which gave every
// absorption band an identical mean — so the per-band mean-shrink cliff
// never formed and the test stayed green while real sloped rooms regressed
// (toggling Bass Traps dropped peaks_dips, e.g. 2 → 1, from a phantom
// peak/dip manufactured at a band boundary).
// ---------------------------------------------------------------------------
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    /* eslint-disable */
    const SM = require('./signal_math.js');
    const SC = require('./score.js');
    global.MeasurelySignalMath = SM;
    global.MeasurelyScore      = SC;

    // Synthesise directly at PPO 12 (the resolution scoring uses) — narrow
    // single-bin spikes over a SLOPED baseline. The slope is the point: a
    // real room has elevated bass tapering through the mids, so each
    // absorption band sits at a different mean level. A flat baseline
    // (m = 0 everywhere) gave every band an identical mean, so the per-band
    // mean-shrink cliff never formed and this test stayed falsely green.
    const ppo = 12;
    const f = [], m = [];
    // Sloped baseline — 6 dB @ 40 Hz tapering log-linearly to 0 dB @ 400 Hz,
    // held flat outside that span. Bands then sit at distinct mean levels.
    const slopedBase = (fHz) =>
        fHz <= 40  ? 6.0 :
        fHz >= 400 ? 0.0 :
        6.0 * (1 - Math.log2(fHz / 40) / Math.log2(400 / 40));
    for (let i = 0; ; i++) {
        const fi = 20 * Math.pow(2, i / ppo);
        if (fi > 20000) break;
        f.push(fi);
        m.push(slopedBase(fi));
    }
    for (let i = 0; i < f.length; i++) {
        const fi = f[i];
        if (Math.abs(fi - 50)  < 3)  m[i] += 8;   // bass-mode peak
        if (Math.abs(fi - 90)  < 5)  m[i] -= 10;  // SBIR null — this dip must NOT deepen
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

    // Explicit guard for the band-boundary cliff bug: on a SLOPED room
    // (bands at different mean levels) enabling bass traps must NOT drop
    // peaks_dips. Pre-fix this fell (e.g. 2.0 → 1.0) from a phantom peak/dip
    // manufactured where one absorption band stepped to the next.
    {
        const bt = applyTreatments(analysis, ['bass_trap']);
        if (bt.peaks_dips < baseline.peaks_dips) {
            console.error(`[FAIL] bass_trap on sloped room dropped peaks_dips ` +
                          `${baseline.peaks_dips} → ${bt.peaks_dips} (band-boundary cliff)`);
            failures++;
        } else {
            console.log(`[pass] bass_trap sloped-room continuity: peaks_dips ` +
                        `${baseline.peaks_dips} → ${bt.peaks_dips} (no boundary cliff) ✓`);
        }
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
        _applyAbsorptionProfile(freq, mag, TREATMENT_PROFILES[key].absorptionBands);
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
