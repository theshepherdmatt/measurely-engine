/**
 * placement.js — Measurely Engine
 *
 * Placement-based score prediction. GUIDELINE LAYER — NOT a measurement.
 *
 * Predictive model: not a physical measurement.
 *
 * Where treatments.js models broadband absorption derived from the user's
 * actual measurement, this module does something different and more
 * conservative: it predicts how moving a speaker / listener would shift
 * scores, based on general acoustic best-practice heuristics. Bell curves
 * around an OPTIMAL slider value give a small per-metric delta that peaks
 * at the optimum and falls off either side.
 *
 * Honest framing matters. Treatment simulation is "simulation"; placement
 * is "guideline". The HUD must label them differently — see app.html.
 *
 * Stacking with treatments is additive: predicted = baseline +
 * treatment_delta + placement_delta, then clamped to [0, 10].
 *
 * Dependencies (must be loaded before this file):
 *   engine/treatments.js   → window.MeasurelyTreatments  (used as the
 *                            baseline + treated re-score pipeline)
 */

'use strict';

// ---------------------------------------------------------------------------
// Heuristics — bell-curve score deltas around an optimum slider position
// ---------------------------------------------------------------------------
//
// maxDelta values for "secondary" effects are already set at ~60% of the
// "primary" effect (e.g. peaks_dips: 2.0 → balance: 0.8 for the same
// slider). This matches treatments.js's PRIMARY_BOOST / SECONDARY_BOOST
// convention (1.5 / 0.9, ~60%).
//
// optimalFromRoom() resolves a dynamic optimum from room geometry. If
// roomDims is not provided, the static `optimal` fallback is used.

const PLACEMENT_HEURISTICS = {
    speakers_from_wall: {
        name:    'Speakers from wall',
        unit:    'm',
        optimal: 1.2,                       // metres — null shifts below 71 Hz
        range:   [0.1, 2.0],
        affects: {
            peaks_dips: { maxDelta: 2.0, falloffWidth: 0.8 },   // primary
            balance:    { maxDelta: 0.8, falloffWidth: 0.8 },   // secondary
        },
    },
    speaker_width: {
        name:    'Speaker width',
        unit:    'm',
        optimal: 2.2,
        range:   [1.0, 3.5],
        affects: {
            reflections: { maxDelta: 1.0, falloffWidth: 0.7 },  // primary
            clarity:     { maxDelta: 0.6, falloffWidth: 0.7 },  // secondary
        },
    },
    listening_position: {
        name:    'Listening position',
        unit:    'm',
        optimal: 2.8,                       // static fallback
        // Dynamic optimum: ~38% of room length avoids worst axial mode peaks
        optimalFromRoom: (roomDims) => {
            const L = roomDims && roomDims.length;
            return (typeof L === 'number' && isFinite(L) && L > 0) ? L * 0.38 : null;
        },
        range:   [1.5, 4.5],
        affects: {
            peaks_dips: { maxDelta: 1.2, falloffWidth: 1.0 },   // primary
            smoothness: { maxDelta: 0.6, falloffWidth: 1.0 },   // secondary
        },
    },
};

// ---------------------------------------------------------------------------
// Bell curve
// ---------------------------------------------------------------------------

/**
 * Score-delta bell around an optimal slider position. Always non-negative.
 *
 * delta(value) = maxDelta * exp( -(value - optimal)^2 / (2 * sigma^2) )
 * with sigma = falloffWidth / 2.
 *
 * The bell never produces a negative delta — we only show improvements,
 * not penalties for being far from optimum. The user's measured baseline
 * is their reality; we don't punish placements we can't directly measure.
 */
function bellAroundOptimal(value, optimal, maxDelta, falloffWidth) {
    if (!isFinite(value) || !isFinite(optimal) || !isFinite(maxDelta)) return 0;
    const sigma = Math.max(0.05, (falloffWidth || 1) / 2);
    const z     = value - optimal;
    return maxDelta * Math.exp(-(z * z) / (2 * sigma * sigma));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PILLARS = [
    'bandwidth', 'balance', 'peaks_dips', 'smoothness', 'reflections', 'clarity',
];

function _clamp(v, lo, hi) {
    if (!isFinite(v)) return v;
    return Math.max(lo, Math.min(hi, v));
}

function _round1(v) {
    return isFinite(v) ? Math.round(v * 10) / 10 : v;
}

function _resolveOptimal(profile, roomDims) {
    if (typeof profile.optimalFromRoom === 'function') {
        const dyn = profile.optimalFromRoom(roomDims);
        if (typeof dyn === 'number' && isFinite(dyn) && dyn > 0) return dyn;
    }
    return profile.optimal;
}

// ---------------------------------------------------------------------------
// Per-metric placement delta computation
// ---------------------------------------------------------------------------

/**
 * Compute per-metric placement deltas from current slider values.
 *
 * Predictive model: not a physical measurement.
 *
 * If `baselineSliderValues` is provided, deltas are anchored relative to
 * that placement: delta = max(0, bell(current) - bell(baseline)). This
 * means "no slider movement" → zero delta → predicted matches NOW. It
 * also keeps sliders that move AWAY from the optimum from producing a
 * negative delta (we never punish a placement we haven't measured).
 *
 * If `baselineSliderValues` is omitted, the absolute bell value is used
 * (the literal heuristic — treats the slider's current position as
 * already-deserved improvement over an implicit pessimal placement).
 *
 * @returns {object} { peaks_dips, balance, reflections, clarity, smoothness, bandwidth }
 */
function computePlacementDeltas(sliderValues, roomDims, baselineSliderValues) {
    // Predictive model: not a physical measurement
    const sliders = sliderValues || {};
    const anchor  = baselineSliderValues || null;
    const out = {
        bandwidth:   0, balance:    0, peaks_dips: 0,
        smoothness:  0, reflections: 0, clarity:   0,
    };

    for (const sliderKey of Object.keys(PLACEMENT_HEURISTICS)) {
        const profile = PLACEMENT_HEURISTICS[sliderKey];
        const value   = sliders[sliderKey];
        if (!isFinite(value)) continue;

        const optimal     = _resolveOptimal(profile, roomDims);
        const baselineVal = (anchor && isFinite(anchor[sliderKey])) ? anchor[sliderKey] : null;

        for (const metricKey of Object.keys(profile.affects)) {
            const cfg = profile.affects[metricKey];
            const bellNow = bellAroundOptimal(value, optimal, cfg.maxDelta, cfg.falloffWidth);
            let delta;
            if (baselineVal != null) {
                const bellBase = bellAroundOptimal(baselineVal, optimal, cfg.maxDelta, cfg.falloffWidth);
                delta = Math.max(0, bellNow - bellBase);
            } else {
                delta = Math.max(0, bellNow);
            }
            out[metricKey] = (out[metricKey] || 0) + delta;
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Public API — placement-only predicted scores
// ---------------------------------------------------------------------------

/**
 * Apply placement heuristics to a baseline score object.
 *
 * Predictive model: not a physical measurement.
 *
 * @param {object} baselineScores            - measured/baseline pillar scores
 * @param {object} sliderValues              - { speakers_from_wall, speaker_width, listening_position }
 * @param {object} [roomDims]                - { length, width, height } in metres
 * @param {object} [baselineSliderValues]    - same shape as sliderValues; anchor for relative delta
 * @returns {object} predicted scores + { source: 'placement' } metadata
 */
function applyPlacement(baselineScores, sliderValues, roomDims, baselineSliderValues) {
    // Predictive model: not a physical measurement
    if (!baselineScores) return null;
    const deltas = computePlacementDeltas(sliderValues, roomDims, baselineSliderValues);
    const out = { ...baselineScores };

    for (const k of PILLARS) {
        const base = (out[k] != null && isFinite(out[k])) ? parseFloat(out[k]) : null;
        if (base == null) continue;
        out[k] = _round1(_clamp(base + (deltas[k] || 0), 0, 10));
    }

    const finite = PILLARS.map(k => out[k]).filter(v => v != null && isFinite(v));
    out.overall = finite.length
        ? _round1(finite.reduce((a, b) => a + parseFloat(b), 0) / finite.length)
        : NaN;

    out.predicted = true;
    out.source    = 'placement';
    return out;
}

// ---------------------------------------------------------------------------
// Orchestrator — stack treatments + placement onto the same baseline
// ---------------------------------------------------------------------------

/**
 * Apply both treatment simulation and placement heuristics to a measured
 * analysis. Deltas are summed against the baseline, then clamped — never
 * multiplied. Both deltas are computed from the SAME baseline so they
 * cannot double-count when both affect the same metric.
 *
 * Predictive model: not a physical measurement.
 *
 * @param {object}   analysis             - MeasurelyAnalyse.analyse() result
 * @param {string[]} treatmentKeys        - active treatments (e.g. ['bass_trap'])
 * @param {object}   sliderValues         - placement slider values
 * @param {object}   [roomDims]           - { length, width, height } in metres
 * @param {object}   [options]
 * @param {boolean}  [options.isStudio]
 * @param {boolean}  [options.hasCoffeeTable]
 * @param {object}   [options.baselineSliderValues] - anchor for placement deltas
 * @returns {object} predicted scores with { sources: { treatments, placement } }
 */
function applyAllPredictions(analysis, treatmentKeys, sliderValues, roomDims, options = {}) {
    // Predictive model: not a physical measurement
    const TR = (typeof MeasurelyTreatments !== 'undefined') ? MeasurelyTreatments : null;
    if (!TR || typeof TR.applyTreatments !== 'function') {
        console.warn('[placement] MeasurelyTreatments.applyTreatments not available');
        return null;
    }
    if (!analysis) return null;

    const trOptions = {
        isStudio:       !!options.isStudio,
        hasCoffeeTable: !!options.hasCoffeeTable,
    };

    // Baseline = applyTreatments with empty keys → re-scored from the raw
    // measured magnitude, no boosts. This is the same path treatments.js
    // takes, so the diff is meaningful (treated and baseline use the same
    // score functions).
    const baseline = TR.applyTreatments(analysis, [], trOptions);
    if (!baseline) return null;

    const activeTreatments = (Array.isArray(treatmentKeys) ? treatmentKeys : [])
        .filter(k => TR.TREATMENT_PROFILES && TR.TREATMENT_PROFILES[k]);
    const hasTreatments = activeTreatments.length > 0;

    // Treatment delta (per pillar) — diff treated against baseline
    const treated   = hasTreatments ? TR.applyTreatments(analysis, activeTreatments, trOptions) : null;
    const treatDelta = {};
    for (const k of PILLARS) {
        if (treated && isFinite(treated[k]) && isFinite(baseline[k])) {
            treatDelta[k] = treated[k] - baseline[k];
        } else {
            treatDelta[k] = 0;
        }
    }

    // Placement delta — relative to baseline slider values when supplied
    const placeDelta = computePlacementDeltas(sliderValues, roomDims, options.baselineSliderValues);
    const hasPlacement = PILLARS.some(k => isFinite(placeDelta[k]) && placeDelta[k] > 0.05);

    // Sum deltas onto baseline, clamp per pillar
    const out = {};
    for (const k of PILLARS) {
        const sum = (parseFloat(baseline[k]) || 0)
                  + (treatDelta[k] || 0)
                  + (placeDelta[k] || 0);
        out[k] = _round1(_clamp(sum, 0, 10));
    }

    const finite = PILLARS.map(k => out[k]).filter(isFinite);
    out.overall = finite.length
        ? _round1(finite.reduce((a, b) => a + b, 0) / finite.length)
        : NaN;

    out.predicted = true;
    out.applied   = activeTreatments.slice();
    out.sources   = { treatments: hasTreatments, placement: hasPlacement };
    return out;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        applyPlacement, applyAllPredictions,
        bellAroundOptimal, computePlacementDeltas,
        PLACEMENT_HEURISTICS,
    };
} else if (typeof window !== 'undefined') {
    window.MeasurelyPlacement = {
        applyPlacement, applyAllPredictions,
        bellAroundOptimal, computePlacementDeltas,
        PLACEMENT_HEURISTICS,
    };
}
