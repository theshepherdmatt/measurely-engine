/**
 * analyse.js — Measurely Engine
 * Orchestrates the full analysis pipeline from pre-loaded audio data.
 *
 * This is the JS equivalent of measurelyapp/analyse.py.
 * It does NOT record audio or generate sweeps — it expects:
 *   - A pre-decoded impulse response (Float32Array from a WAV file)
 *   - A pre-parsed frequency/magnitude response (from a REW CSV file)
 *   - A room settings object (same schema as room.json)
 *
 * Dependencies (must be loaded before this file):
 *   engine/fft.js          → window.MeasurelyFFT
 *   engine/signal_math.js  → window.MeasurelySignalMath
 *   engine/score.js        → window.MeasurelyScore
 *   engine/acoustics.js    → window.MeasurelyAcoustics
 *
 * Usage (browser):
 *   const result = await MeasurelyAnalyse.analyse(ir, fs, freq, mag, room, options);
 *
 * Usage (ES module):
 *   import { analyse } from './engine/analyse.js';
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants (matching analyse.py)
// ---------------------------------------------------------------------------

const MAX_F_REPORT    = 18000;
const SIGINT_HARD_FAIL = 0.0;
const SIGINT_SOFT_MIN  = 5.0;
const SIGINT_SOFT_CAP  = 6.5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simple windowed moving average for smoothing the report curve.
 * Equivalent to analyse.py smooth_curve(y, window=9).
 */
function _smoothCurve(y, window = 9) {
    if (window < 3) return y.slice();
    const half = Math.floor(window / 2);
    return y.map((_, i) => {
        let sum = 0, cnt = 0;
        for (let j = Math.max(0, i - half); j <= Math.min(y.length - 1, i + half); j++) {
            if (isFinite(y[j])) { sum += y[j]; cnt++; }
        }
        return cnt > 0 ? sum / cnt : NaN;
    });
}

/**
 * Check that the impulse response contains a usable signal.
 * Equivalent to analyse.py assess_sweep_validity(ir, fs).
 *
 * @returns {{ valid: boolean, reason: string|null }}
 */
function assessValidity(ir, fs) {
    if (!ir || ir.length === 0) return { valid: false, reason: 'empty_impulse_response' };

    const absIr = Array.from(ir, Math.abs);
    const peak  = Math.max(...absIr);

    if (peak < 1e-4) return { valid: false, reason: 'no_signal_detected' };

    // Noise floor = median of last 20% of IR
    const tailStart = Math.floor(absIr.length * 0.8);
    const tail      = absIr.slice(tailStart).sort((a, b) => a - b);
    const mid       = Math.floor(tail.length / 2);
    const noise     = (tail.length % 2 === 0
        ? (tail[mid - 1] + tail[mid]) / 2
        : tail[mid]) + 1e-12;

    const snr = 20.0 * Math.log10(peak / noise);
    if (snr < 10.0) return { valid: false, reason: 'insufficient_snr' };

    return { valid: true, reason: null };
}

// ---------------------------------------------------------------------------
// Main analysis function
// ---------------------------------------------------------------------------

/**
 * Run the full Measurely analysis pipeline.
 *
 * @param {Float32Array} ir         - Impulse response (from decoded WAV)
 * @param {number}       fs         - Sample rate (Hz)
 * @param {number[]}     freq       - Frequency array (Hz), from REW CSV
 * @param {number[]}     mag        - Magnitude array (dB), from REW CSV
 * @param {object}       room       - Room settings object (room.json schema)
 * @param {object}       [options]
 * @param {number}       [options.ppo=48]           - Points per octave for UI curve
 * @param {string|null}  [options.speakerKey=null]  - Speaker profile key
 * @param {string}       [options.micType='omnitronic_mm2'] - Mic calibration type
 * @param {boolean}      [options.hasCoffeeTable=false]
 *
 * @returns {object} analysis result matching the analysis.json / analysis_ai.json schema
 */
function analyse(ir, fs, freq, mag, room = {}, options = {}) {
    const {
        ppo          = 48,
        speakerKey   = null,
        micType      = 'omnitronic_mm2',
        hasCoffeeTable = room.opt_coffee_table ?? false,
    } = options;

    // Room context flags used for acoustic adjustments
    const isStudio = (room.room_type === 'studio');
    const hasDesk  = !!(room.opt_desk ?? room.environment?.furniture?.opt_desk);

    // Resolve engine modules (supports both ES modules and global script tags)
    const SM  = (typeof MeasurelySignalMath  !== 'undefined') ? MeasurelySignalMath
              : (typeof module !== 'undefined') ? require('./signal_math.js') : null;
    const SC  = (typeof MeasurelyScore       !== 'undefined') ? MeasurelyScore
              : (typeof module !== 'undefined') ? require('./score.js') : null;
    const AC  = (typeof MeasurelyAcoustics   !== 'undefined') ? MeasurelyAcoustics
              : (typeof module !== 'undefined') ? require('./acoustics.js') : null;

    if (!SM || !SC || !AC) {
        throw new Error('Measurely engine modules not loaded. ' +
            'Ensure fft.js, signal_math.js, score.js, and acoustics.js are loaded first.');
    }

    // ------------------------------------------------------------------
    // 1. Signal integrity
    // ------------------------------------------------------------------
    const { valid: sweepValid, reason: invalidReason } = assessValidity(ir, fs);
    const signalIntegrity = SC.computeSignalIntegrity(ir);

    // ------------------------------------------------------------------
    // 2. Frequency response — log-binned and calibrated
    // ------------------------------------------------------------------

    // UI curve: full PPO resolution
    const uiBins = SM.logBins(freq, mag, 20, 20000, ppo);
    const freqUi = uiBins.f;
    const magUiRaw = SM.applyMicCalibration(freqUi, uiBins.m, micType);

    // Analysis curve: coarser resolution for scoring (matches Python ppo_raw = min(ppo,12))
    const ppoRaw = Math.min(ppo, 12);
    const rawBins = SM.logBins(freq, mag, 20, 20000, ppoRaw);
    const freqRaw = rawBins.f;
    const magRaw  = SM.applyMicCalibration(freqRaw, rawBins.m, micType);

    // ------------------------------------------------------------------
    // 3. Measurements
    // ------------------------------------------------------------------
    const bw          = SM.bandwidth3db(freqRaw, magRaw);
    const lo3         = bw.lo;
    const hi3         = bw.hi;
    const modeList    = SM.modes(freqRaw, magRaw).filter(m => m.freq_hz <= 1000);
    const sm          = SM.smoothness(freqRaw, magRaw);
    const rawRefs     = SM.earlyReflections(ir, fs);
    const refs        = rawRefs.filter(r => r > 0.5);

    const bands = {
        bass_20_200:    SM.bandMean(freqRaw, magRaw, 20,    200),
        mid_200_2k:     SM.bandMean(freqRaw, magRaw, 200,   2000),
        treble_2k_10k:  SM.bandMean(freqRaw, magRaw, 2000,  10000),
        air_10k_20k:    SM.bandMean(freqRaw, magRaw, 10000, 20000),
    };

    // ------------------------------------------------------------------
    // 4. Report curve (smoothed, capped at MAX_F_REPORT)
    // ------------------------------------------------------------------
    const reportFreqs = freqUi.filter(f => f <= MAX_F_REPORT);
    const reportMag   = _smoothCurve(
        magUiRaw.slice(0, reportFreqs.length), 9
    );

    // ------------------------------------------------------------------
    // 5. Scores
    // ------------------------------------------------------------------

    // ── Target curve for balance scoring ────────────────────────────────
    // Studio: flat reference (null = no tilt correction).
    // Hi-Fi:  Harman 2020 approximation — gentle bass shelf + HF roll-off.
    const harmanTarget = isStudio ? null : (centreHz) => {
        // +3 dB shelf below 80 Hz, linear transition 80–400 Hz, -1 dB/oct above 2 kHz
        let offset = 0;
        if (centreHz < 80)       offset = 3.0;
        else if (centreHz < 400) offset = 3.0 - (Math.log10(centreHz / 80) / Math.log10(400 / 80)) * 3.0;
        if (centreHz > 2000)     offset -= Math.log2(centreHz / 2000) * 1.0;
        return offset;
    };

    const clarity = SC.scoreClarity(refs, sm, hasCoffeeTable);

    const scores = {
        bandwidth:   SC.scoreBandwidth(lo3, hi3),
        balance:     SC.scoreBalance(bands, harmanTarget),
        peaks_dips:  SC.scoreModes(modeList),
        smoothness:  SC.scoreSmooth(sm),
        reflections: SC.scoreRef(refs),
        clarity,
    };

    // ── Desk-reflection penalty (studio setups) ─────────────────────────
    // A desk surface between speakers and listener creates early reflections
    // in the 0.8–2 ms range that degrade both reflections and clarity scores.
    if (isStudio && hasDesk) {
        scores.reflections = Math.round(Math.max(0, scores.reflections - 1.5) * 10) / 10;
        scores.clarity     = Math.round(Math.max(0, scores.clarity     - 1.0) * 10) / 10;
    }

    // overall is computed from the (potentially penalised) per-metric scores
    const baseScores = Object.values(scores).filter(s => isFinite(s));
    const baseOverall = baseScores.length > 0
        ? baseScores.reduce((a, b) => a + b, 0) / baseScores.length
        : NaN;

    // Apply signal integrity gates (matching analyse.py logic)
    if (signalIntegrity.score <= SIGINT_HARD_FAIL) {
        scores.overall = NaN;
    } else if (signalIntegrity.score < SIGINT_SOFT_MIN) {
        scores.overall = Math.round(Math.min(baseOverall, SIGINT_SOFT_CAP) * 10) / 10;
    } else {
        scores.overall = Math.round(baseOverall * 10) / 10;
    }

    // ------------------------------------------------------------------
    // 6. Room acoustics context
    // ------------------------------------------------------------------
    let acousticsContext = null;
    try {
        acousticsContext = AC.analyseRoom(room);
    } catch (e) {
        console.warn('[analyse] Room acoustics failed:', e.message);
    }

    // ------------------------------------------------------------------
    // 7. Build result objects (matching analysis.json + analysis_ai.json schema)
    // ------------------------------------------------------------------

    // Invalid sweep short-circuit
    if (!sweepValid) {
        const invalidExport = {
            label: 'browser',
            fs,
            freq: freqUi,
            mag:  magUiRaw,
            scores: {
                bandwidth:       NaN,
                balance:         NaN,
                peaks_dips:      NaN,
                smoothness:      NaN,
                reflections:     NaN,
                signal_integrity: signalIntegrity.score,
                overall:         NaN,
            },
            analysis_meta: {
                engine:        'measurely-js',
                version:       '1.0',
                valid_sweep:   false,
                invalid_reason: invalidReason,
            },
        };
        return { analysis: invalidExport, ai: invalidExport, reportCurve: null };
    }

    const analysis = {
        label:                'browser',
        fs,
        freq:                  freqUi,
        mag:                   magUiRaw,
        band_levels_db:        bands,
        bandwidth_lo_3db_hz:   lo3,
        bandwidth_hi_3db_hz:   hi3,
        smoothness_std_db:     sm,
        modes:                 modeList,
        reflections_ms:        refs,
        signal_integrity:      signalIntegrity,
        scores,
        speaker_profile:       speakerKey,
        analysis_meta: {
            engine:       'measurely-js',
            version:      '1.0',
            valid_sweep:  true,
            signal_integrity: {
                score:     signalIntegrity.score,
                hard_fail: signalIntegrity.score <= SIGINT_HARD_FAIL,
                soft_fail: signalIntegrity.score < SIGINT_SOFT_MIN,
            },
        },
    };

    const ai = {
        label:             'browser',
        scores,
        band_levels_db:    bands,
        bandwidth_3db_hz:  { low: lo3, high: hi3 },
        smoothness_std_db: sm,
        reflections_ms:    refs.slice(0, 5),
        signal_integrity:  signalIntegrity,
        room_context:      acousticsContext,
        room_type:         room.room_type ?? null,
        is_studio:         isStudio,
        desk_penalty_applied: isStudio && hasDesk,
    };

    const reportCurve = {
        freqs: reportFreqs,
        mag:   reportMag,
    };

    return { analysis, ai, reportCurve };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { analyse, assessValidity };
} else if (typeof window !== 'undefined') {
    window.MeasurelyAnalyse = { analyse, assessValidity };
}
