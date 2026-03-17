/**
 * score.js — Measurely Engine
 * Direct JavaScript port of measurelyapp/score.py
 *
 * Scoring functions take pre-computed analysis values and return
 * a score on a 0–10 scale. NaN is returned for missing/invalid inputs.
 *
 * Functions match Python output to < 0.05 points.
 */

'use strict';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True if value is missing or not a finite number. */
function _isInvalid(x) {
    return x === null || x === undefined || (typeof x === 'number' && !isFinite(x));
}

/**
 * Linear interpolation, clamped to [0,1].
 * Equivalent to score.py linmap().
 */
function linmap(x, x0, x1, y0, y1) {
    if (x0 === x1) return (y0 + y1) / 2;
    const t = Math.max(0, Math.min(1, (x - x0) / (x1 - x0)));
    return y0 + t * (y1 - y0);
}

// ---------------------------------------------------------------------------
// 1. BANDWIDTH
// ---------------------------------------------------------------------------

/**
 * Score the low-frequency extension and high-frequency reach of the response.
 * Equivalent to score.py score_bandwidth(lo, hi).
 *
 * @param {number|null} lo - lower −3 dB frequency (Hz)
 * @param {number|null} hi - upper −3 dB frequency (Hz)
 * @returns {number} 0–10 score
 */
function scoreBandwidth(lo, hi) {
    if (_isInvalid(lo) || _isInvalid(hi)) return NaN;

    // Low-end sub-score
    let slo;
    if      (lo < 40)  slo = 10;
    else if (lo < 60)  slo = 10  - (lo -  40) * 0.08;
    else if (lo < 80)  slo = 8.4 - (lo -  60) * 0.10;
    else if (lo < 100) slo = 6.4 - (lo -  80) * 0.10;
    else if (lo < 150) slo = 4.4 - (lo - 100) * 0.03;
    else               slo = 1.0;

    // High-end sub-score
    let shi;
    if      (hi > 18000) shi = 10;
    else if (hi > 16000) shi = 8 + (hi - 16000) / 2000 * 2;
    else if (hi > 14000) shi = 6 + (hi - 14000) / 2000 * 2;
    else if (hi > 12000) shi = 4 + (hi - 12000) / 2000 * 2;
    else                 shi = Math.max(1, hi / 12000 * 4);

    return Math.round((slo + shi) / 2 * 10) / 10;
}

// ---------------------------------------------------------------------------
// 2. BALANCE
// ---------------------------------------------------------------------------

/**
 * Score spectral balance across bass / mid / treble / air bands.
 * Equivalent to score.py score_balance(bands, target).
 *
 * @param {{ bass_20_200: number, mid_200_2k: number, treble_2k_10k: number, air_10k_20k: number }} bands
 * @param {Function|null} target - optional target curve function (centre_hz) → dB
 * @returns {number} 0–10 score
 */
function scoreBalance(bands, target = null) {
    if (!bands) return NaN;
    const vals = Object.values(bands);
    if (vals.some(_isInvalid)) return NaN;

    let workingVals;

    if (target) {
        // Apply target curve correction per band
        workingVals = [];
        for (const [band, val] of Object.entries(bands)) {
            try {
                // Band keys are like 'bass_20_200', 'mid_200_2k', etc.
                const parts = band.split('_');
                const loStr = parts[1], hiStr = parts[2];
                const parseHz = s => parseFloat(s.replace('k', '')) * (s.includes('k') ? 1000 : 1);
                const loHz  = parseHz(loStr);
                const hiHz  = parseHz(hiStr);
                const centre = Math.sqrt(loHz * hiHz);
                workingVals.push(val - target(centre));
            } catch {
                return NaN;
            }
        }
    } else {
        workingVals = vals;
    }

    const spread = Math.max(...workingVals) - Math.min(...workingVals);
    if (!isFinite(spread)) return NaN;
    if (spread <= 2) return 10.0;

    return Math.round(linmap(Math.min(spread, 8), 2, 8, 9, 4) * 10) / 10;
}

// ---------------------------------------------------------------------------
// 3. MODES (PEAKS & DIPS)
// ---------------------------------------------------------------------------

/**
 * Score the severity of peaks and dips (room modes).
 * Equivalent to score.py score_modes(modes).
 *
 * @param {{ type: string, freq_hz: number, delta_db: number }[]|null} modeList
 * @returns {number} 0–10 score
 */
function scoreModes(modeList) {
    if (modeList === null || modeList === undefined) return NaN;
    if (modeList.length === 0) return 10.0;

    let maxDev;
    try {
        maxDev = Math.max(...modeList.map(m => Math.abs(m.delta_db || 0)));
    } catch {
        return NaN;
    }

    if      (maxDev < 2)  return 10.0;
    else if (maxDev < 3)  return 9.0;
    else if (maxDev < 4)  return 8.0;
    else if (maxDev < 5)  return 7.0;
    else if (maxDev < 6)  return 6.0;
    else if (maxDev < 7)  return 5.0;
    else if (maxDev < 8)  return 4.0;
    else if (maxDev < 10) return 3.0;
    else if (maxDev < 12) return 2.0;
    else                  return 1.0;
}

// ---------------------------------------------------------------------------
// 4. SMOOTHNESS
// ---------------------------------------------------------------------------

/**
 * Score response smoothness from the std-dev of deviations.
 * Equivalent to score.py score_smooth(std).
 *
 * @param {number} std - standard deviation in dB (from signal_math.smoothness)
 * @returns {number} 0–10 score
 */
function scoreSmooth(std) {
    if (_isInvalid(std)) return NaN;
    return Math.round(linmap(Math.min(std, 8), 0, 8, 10, 0) * 10) / 10;
}

// ---------------------------------------------------------------------------
// 5. REFLECTIONS
// ---------------------------------------------------------------------------

/**
 * Score the earliest reflection time.
 * Equivalent to score.py score_ref(refs).
 *
 * @param {number[]} refs - sorted array of reflection times in ms
 * @returns {number} 0–10 score
 */
function scoreRef(refs) {
    if (!refs || refs.length === 0) return NaN;
    const earliest = Math.min(...refs);
    if (earliest < 1) return 4.0;
    if (earliest < 5) return 6.5;
    return 9.0;
}

// ---------------------------------------------------------------------------
// 6. CLARITY (Reflections + Smoothness composite)
// ---------------------------------------------------------------------------

/**
 * Composite clarity score (reflections + smoothness penalty).
 * Equivalent to analyse.py score_clarity(refs, smoothness_std, hasCoffeeTable).
 *
 * @param {number[]} refs
 * @param {number}   smoothnessStd
 * @param {boolean}  hasCoffeeTable
 * @returns {number} 0–10 score
 */
function scoreClarity(refs, smoothnessStd, hasCoffeeTable = false) {
    let score = 10.0;

    if (refs && refs.length > 0) {
        const first = refs[0];
        if (first >= 0.6 && first <= 0.9 && hasCoffeeTable) {
            score -= 0.5;
        } else if (first < 1.5) {
            score -= 2.0;
        } else if (first < 3.0) {
            score -= 1.0;
        }

        // Reflection density penalty (first 5 ms)
        const early = refs.filter(r => r <= 5.0).length;
        if      (early > 12) score -= 3;
        else if (early > 8)  score -= 2;
        else if (early > 4)  score -= 1;
    }

    // Smoothness penalty
    if (smoothnessStd > 4.0)      score -= 3;
    else if (smoothnessStd > 3.0) score -= 2;
    else if (smoothnessStd > 2.0) score -= 1;

    return Math.round(Math.max(0, Math.min(10, score)) * 10) / 10;
}

// ---------------------------------------------------------------------------
// 7. SIGNAL INTEGRITY
// ---------------------------------------------------------------------------

// Constants matching analyse.py
const SIGINT_SNR_MIN_DB  = 10.0;
const SIGINT_SNR_GOOD_DB = 25.0;
const SIGINT_PEAK_SOFT_MIN = 5e-4;
const SWEEP_PEAK_MIN     = 1e-4;

/**
 * Compute signal integrity from an impulse response array.
 * Equivalent to analyse.py compute_signal_integrity(ir).
 *
 * @param {Float32Array|number[]} ir
 * @returns {{ score: number, snr_db: number|null, peak: number, noise_floor: number|null }}
 */
function computeSignalIntegrity(ir) {
    if (!ir || ir.length === 0) {
        return { score: 0.0, snr_db: null, peak: 0.0, noise_floor: null };
    }

    // Use a loop instead of Math.max(...absIr) — spreading large typed arrays
    // blows the call stack on 48kHz/96kHz files (>65k elements).
    let peak = 0;
    const absIr = new Float32Array(ir.length);
    for (let i = 0; i < ir.length; i++) {
        absIr[i] = Math.abs(ir[i]);
        if (absIr[i] > peak) peak = absIr[i];
    }

    if (peak < SWEEP_PEAK_MIN) {
        return { score: 0.0, snr_db: null, peak, noise_floor: null };
    }

    // Noise floor = median of the last 20% of the IR
    const tailStart = Math.floor(absIr.length * 0.8);
    const tail      = absIr.slice(tailStart).filter(isFinite).sort((a, b) => a - b);
    const mid       = Math.floor(tail.length / 2);
    const noise     = (tail.length % 2 === 0
        ? (tail[mid - 1] + tail[mid]) / 2
        : tail[mid]) + 1e-12;

    const snr = 20.0 * Math.log10(peak / noise);

    let score;
    if (snr <= 0) {
        score = 0.0;
    } else {
        score = 3.0 + (snr - SIGINT_SNR_MIN_DB) *
            (7.0 / (SIGINT_SNR_GOOD_DB - SIGINT_SNR_MIN_DB));
        score = Math.max(0.0, Math.min(10.0, score));
        if (peak < SIGINT_PEAK_SOFT_MIN) score = Math.min(score, 5.0);
    }

    return {
        score:       Math.round(score * 10) / 10,
        snr_db:      Math.round(snr   * 10) / 10,
        peak:        Math.round(peak  * 1e6) / 1e6,
        noise_floor: Math.round(noise * 1e6) / 1e6,
    };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        scoreBandwidth, scoreBalance, scoreModes,
        scoreSmooth, scoreRef, scoreClarity,
        computeSignalIntegrity, linmap,
    };
} else if (typeof window !== 'undefined') {
    window.MeasurelyScore = {
        scoreBandwidth, scoreBalance, scoreModes,
        scoreSmooth, scoreRef, scoreClarity,
        computeSignalIntegrity, linmap,
    };
}
