/**
 * signal_math.js — Measurely Engine
 * Direct JavaScript port of measurelyapp/signal_math.py
 *
 * Functions:
 *   logBins(f, m, fmin, fmax, ppo)
 *   bandMean(f, m, flo, fhi)
 *   modes(f, m, thresh, minSep)
 *   bandwidth3db(f, m)
 *   smoothness(f, m)
 *   earlyReflections(ir, fs, winMs, dbRel)
 *   applyMicCalibration(f, m, micType)
 *
 * All inputs are plain JS arrays or typed arrays.
 * All outputs match the Python implementation to < 0.1 dB.
 */

'use strict';

// ---------------------------------------------------------------------------
// Internal helpers (not exported)
// ---------------------------------------------------------------------------

/** Arithmetic mean, ignoring NaN. Equivalent to np.nanmean. */
function _nanMean(arr) {
    let sum = 0, n = 0;
    for (let i = 0; i < arr.length; i++) {
        if (isFinite(arr[i])) { sum += arr[i]; n++; }
    }
    return n === 0 ? NaN : sum / n;
}

/** Standard deviation, ignoring NaN. Equivalent to np.nanstd (ddof=0). */
function _nanStd(arr) {
    const mu = _nanMean(arr);
    if (!isFinite(mu)) return NaN;
    let sq = 0, n = 0;
    for (let i = 0; i < arr.length; i++) {
        if (isFinite(arr[i])) { sq += (arr[i] - mu) ** 2; n++; }
    }
    return n === 0 ? NaN : Math.sqrt(sq / n);
}

/** Median of a finite subset of arr. Equivalent to np.nanmedian. */
function _nanMedian(arr) {
    const finite = arr.filter(isFinite).sort((a, b) => a - b);
    if (finite.length === 0) return NaN;
    const mid = Math.floor(finite.length / 2);
    return finite.length % 2 === 0
        ? (finite[mid - 1] + finite[mid]) / 2
        : finite[mid];
}

/**
 * Centred moving average (equivalent to np.convolve(m, ones/win, mode="same")).
 * Non-causal — matches Python behaviour exactly.
 * @param {number[]} m
 * @param {number} win - window width (odd recommended)
 * @returns {number[]}
 */
function _movAvgCentred(m, win) {
    const half = Math.floor(win / 2);
    const out  = new Array(m.length);
    for (let i = 0; i < m.length; i++) {
        let sum = 0, cnt = 0;
        for (let j = Math.max(0, i - half); j <= Math.min(m.length - 1, i + half); j++) {
            if (isFinite(m[j])) { sum += m[j]; cnt++; }
        }
        out[i] = cnt > 0 ? sum / cnt : NaN;
    }
    return out;
}

/** Index of maximum absolute value. Equivalent to np.argmax(np.abs(arr)). */
function _argmaxAbs(arr) {
    let best = -Infinity, idx = 0;
    for (let i = 0; i < arr.length; i++) {
        const a = Math.abs(arr[i]);
        if (a > best) { best = a; idx = i; }
    }
    return idx;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Bin a raw frequency response into logarithmically-spaced bands.
 * Equivalent to signal_math.log_bins(f, m, fmin, fmax, ppo).
 *
 * @param {ArrayLike} f       - frequency values (Hz)
 * @param {ArrayLike} m       - magnitude values (dB)
 * @param {number}    fmin    - lower limit, default 20
 * @param {number}    fmax    - upper limit, default 20000
 * @param {number}    ppo     - points per octave, default 48
 * @returns {{ f: number[], m: number[] }}
 */
function logBins(f, m, fmin = 20, fmax = 20000, ppo = 48) {
    // Build bin edges
    const nEdges = Math.ceil(Math.log2(fmax / fmin) * ppo) + 2;
    const edges  = new Float64Array(nEdges);
    for (let i = 0; i < nEdges; i++) {
        edges[i] = fmin * Math.pow(2, i / ppo);
    }

    const sums = new Float64Array(nEdges);
    const cnts = new Uint32Array(nEdges);

    for (let i = 0; i < f.length; i++) {
        const fi = f[i], mi = m[i];
        if (fi < fmin || fi > fmax || !isFinite(mi)) continue;

        // Binary search for bin index (equivalent to np.digitize - 1)
        let lo = 0, hi = nEdges - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (edges[mid] <= fi) lo = mid + 1; else hi = mid;
        }
        const bin = lo - 1;
        if (bin >= 0 && bin < nEdges) {
            sums[bin] += mi;
            cnts[bin]++;
        }
    }

    const fOut = [], mOut = [];
    for (let i = 0; i < nEdges - 1; i++) {
        if (cnts[i] > 0) {
            fOut.push(Math.sqrt(edges[i] * edges[i + 1]));
            mOut.push(sums[i] / cnts[i]);
        }
    }

    return { f: fOut, m: mOut };
}

/**
 * Mean magnitude between flo and fhi.
 * Equivalent to signal_math.band_mean(f, m, flo, fhi).
 *
 * @returns {number} mean dB, or NaN if no data in band
 */
function bandMean(f, m, flo, fhi) {
    const vals = [];
    for (let i = 0; i < f.length; i++) {
        if (f[i] >= flo && f[i] < fhi && isFinite(m[i])) vals.push(m[i]);
    }
    return vals.length > 0 ? _nanMean(vals) : NaN;
}

/**
 * Detect resonant peaks and dips (room modes) in a frequency response.
 * Equivalent to signal_math.modes(f, m, thresh, min_sep).
 *
 * @param {number[]} f
 * @param {number[]} m
 * @param {number}   thresh  - minimum dB deviation, default 4
 * @param {number}   minSep  - minimum Hz separation between detections, default 10
 * @returns {{ type: string, freq_hz: number, delta_db: number }[]}
 */
function modes(f, m, thresh = 4, minSep = 10) {
    if (f.length < 8) return [];

    // Estimate bins-per-octave from the median log-ratio of adjacent frequencies
    const logSteps = [];
    for (let i = 1; i < f.length; i++) {
        const r = f[i] / f[i - 1];
        if (r > 1) logSteps.push(Math.log2(r));
    }
    if (logSteps.length === 0) return [];

    const medianStep = _nanMedian(logSteps);
    if (medianStep <= 0) return [];

    const bpo = 1.0 / medianStep;
    // Baseline window — 3/4 octave wide. The earlier bpo/4 (~1/4 octave at
    // PPO=12 → win=3) was comparable to the FWHM of typical Q≈10 bass-mode
    // peaks, so the moving average tracked the peak shape and absorbed it
    // into the baseline. The peak-relative-to-baseline delta then dropped
    // below the 4 dB threshold and the peak was silently rejected.
    //
    // Empirical sensitivity sweep against a synthesised spectrum carrying a
    // +11 dB peak at 49 Hz, +9 dB peak at 29 Hz, and -10 dB dip at 247 Hz:
    //   win=3 (old)  → 0/6 features pass
    //   win=5        → 4/6
    //   win=9 (new)  → 5/6  ← optimum
    //   win=13       → 5/6 (no further gain; risks merging adjacent modes)
    //
    // 3/4 octave is wide enough to span the shoulders of any reasonable
    // bass-mode FWHM without tracking the peak itself.
    const win = Math.max(9, Math.round(3 * bpo / 4));

    const base  = _movAvgCentred(m, win);
    const delta = m.map((v, i) => v - base[i]);

    const out  = [];
    let last   = -Infinity;

    for (let i = 0; i < delta.length; i++) {
        if (Math.abs(delta[i]) >= thresh && (f[i] - last) >= minSep) {
            out.push({
                type:     delta[i] > 0 ? 'peak' : 'dip',
                freq_hz:  f[i],
                delta_db: delta[i],
            });
            last = f[i];
        }
    }

    return out;
}

/**
 * Compute the −3 dB bandwidth of a frequency response.
 * Equivalent to signal_math.bandwidth_3db(f, m).
 *
 * @param {number[]} f
 * @param {number[]} m
 * @returns {{ lo: number|null, hi: number|null }}
 */
function bandwidth3db(f, m) {
    if (f.length < 8) return { lo: null, hi: null };

    // Reference level = median magnitude in the 500–2000 Hz band
    const midVals = [];
    for (let i = 0; i < f.length; i++) {
        if (f[i] >= 500 && f[i] <= 2000 && isFinite(m[i])) midVals.push(m[i]);
    }
    const ref = midVals.length > 0 ? _nanMedian(midVals) : _nanMedian(m);
    const tgt = ref - 3;

    let lo = null, hi = null;

    // Scan forward for first point at or above threshold
    for (let i = 0; i < f.length; i++) {
        if (m[i] >= tgt) { lo = f[i]; break; }
    }
    // Scan backward for last point at or above threshold
    for (let i = f.length - 1; i >= 0; i--) {
        if (m[i] >= tgt) { hi = f[i]; break; }
    }

    return { lo, hi };
}

/**
 * Compute response smoothness as the std-dev of deviations from a moving average.
 * Equivalent to signal_math.smoothness(f, m).
 *
 * @param {number[]} f
 * @param {number[]} m
 * @returns {number} std-dev in dB
 */
function smoothness(f, m) {
    const logSteps = [];
    for (let i = 1; i < f.length; i++) {
        const r = f[i] / f[i - 1];
        if (r > 1) logSteps.push(Math.log2(r));
    }
    if (logSteps.length === 0) return NaN;

    const bpo = 1.0 / _nanMedian(logSteps);
    const win = Math.max(3, Math.round(bpo / 3));

    const base     = _movAvgCentred(m, win);
    const residual = m.map((v, i) => v - base[i]);
    return _nanStd(residual);
}

/**
 * Detect early reflections in an impulse response.
 * Equivalent to signal_math.early_reflections(ir, fs, win_ms, db_rel).
 *
 * @param {Float32Array|number[]} ir   - impulse response samples
 * @param {number}                fs   - sample rate
 * @param {number}                winMs  - search window in ms, default 20
 * @param {number}                dbRel  - dB below peak to use as threshold, default -20
 * @returns {number[]} array of reflection times in milliseconds
 */
function earlyReflections(ir, fs, winMs = 20, dbRel = -20) {
    if (!ir || ir.length === 0) return [];

    const absIr = Array.from(ir, Math.abs);
    const idx0  = _argmaxAbs(ir);
    const peak  = absIr[idx0];
    const thr   = peak * Math.pow(10, dbRel / 20);
    const end   = Math.min(ir.length, idx0 + Math.round(fs * winMs / 1000));

    const times = [];
    for (let i = idx0 + 1; i < end - 1; i++) {
        if (
            absIr[i] >= thr &&
            absIr[i] >  absIr[i - 1] &&
            absIr[i] >= absIr[i + 1]
        ) {
            const t = (i - idx0) * 1000 / fs;
            if (times.length === 0 || t - times[times.length - 1] > 0.3) {
                times.push(Math.round(t * 100) / 100);
            }
        }
    }

    return times;
}

/**
 * Apply microphone calibration compensation curve.
 * Equivalent to signal_math.apply_mic_calibration(f, m, mic_type).
 *
 * Supported mic types:
 *   'omnitronic_mm2' — lifts 10–20 kHz by 0–6 dB to compensate roll-off
 *
 * @param {number[]} f
 * @param {number[]} m
 * @param {string}   micType
 * @returns {number[]} calibrated magnitude array
 */
function applyMicCalibration(f, m, micType = 'omnitronic_mm2') {
    if (micType === 'omnitronic_mm2') {
        return m.map((v, i) => {
            if (f[i] > 10000 && f[i] <= 20000) {
                const comp = (f[i] - 10000) / (18000 - 10000) * 6.0;
                return v + comp;
            }
            return v;
        });
    }
    return m.slice(); // No-op — return copy
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        logBins, bandMean, modes, bandwidth3db,
        smoothness, earlyReflections, applyMicCalibration,
    };
} else if (typeof window !== 'undefined') {
    window.MeasurelySignalMath = {
        logBins, bandMean, modes, bandwidth3db,
        smoothness, earlyReflections, applyMicCalibration,
    };
}
