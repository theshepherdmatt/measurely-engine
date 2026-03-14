/**
 * fileLoader.js — Measurely Engine
 *
 * Loads a REW impulse response WAV file and derives the frequency/magnitude
 * response directly from it using FFT (matching sweep.py's mag_response logic).
 *
 * Only impulse.wav is required.
 * An optional CSV/TXT file can be provided as a calibration/reference overlay
 * but is never a blocker for the analysis.
 *
 * Usage:
 *   const session = await MeasurelyFileLoader.loadSession(wavFile, csvFile);
 *   // session = { ir, fs, freq, mag, calibrationCurve, label }
 *   const result = MeasurelyAnalyse.analyse(session.ir, session.fs, session.freq, session.mag, room);
 */

'use strict';

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isWav(file) {
    return file && (file.name.toLowerCase().endsWith('.wav') ||
                    file.type === 'audio/wav' ||
                    file.type === 'audio/x-wav');
}

function isCsv(file) {
    if (!file) return false;
    const name = file.name.toLowerCase();
    return name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.mdat');
}

// ---------------------------------------------------------------------------
// WAV loader — uses Web Audio API decodeAudioData
// ---------------------------------------------------------------------------

/**
 * Decode a WAV file into a mono Float32Array impulse response.
 * Equivalent to io.py load_ir(path).
 *
 * @param {File|Blob} wavFile
 * @returns {Promise<{ ir: Float32Array, fs: number }>}
 */
async function loadIr(wavFile) {
    const arrayBuf = await wavFile.arrayBuffer();

    // iOS Safari requires AudioContext to be created inside a user-gesture handler.
    // The upload modal pre-creates a context on the button click and stores it at
    // window.__mlyAudioCtx. We reuse it here; fall back to a fresh one elsewhere.
    let ctx = window.__mlyAudioCtx;
    let ownsCtx = false;

    if (!ctx || ctx.state === 'closed') {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        ownsCtx = true;
    }

    // Resume in case iOS suspended it
    if (ctx.state === 'suspended') {
        try { await ctx.resume(); } catch (_) {}
    }

    let audioBuffer;
    try {
        audioBuffer = await ctx.decodeAudioData(arrayBuf);
    } finally {
        // Only close if we created it ourselves
        if (ownsCtx) ctx.close();
    }

    // Take first channel (mono or L of stereo), sanitise NaN/Inf
    const raw = audioBuffer.getChannelData(0);
    const ir  = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
        ir[i] = isFinite(raw[i]) ? raw[i] : 0.0;
    }

    return { ir, fs: audioBuffer.sampleRate };
}

// ---------------------------------------------------------------------------
// IR → freq/mag  (equivalent to sweep.py mag_response)
// ---------------------------------------------------------------------------

/**
 * Compute a magnitude frequency response from an impulse response via FFT.
 * Equivalent to sweep.py mag_response(ir, fs).
 *
 * Requires MeasurelyFFT (fft.js) to be loaded first.
 *
 * @param {Float32Array|number[]} ir
 * @param {number} fs - sample rate
 * @returns {{ freq: number[], mag: number[] }}
 */
function irToFreqMag(ir, fs) {
    const FFT = (typeof MeasurelyFFT !== 'undefined') ? MeasurelyFFT
              : (typeof module !== 'undefined') ? require('./fft.js') : null;

    if (!FFT) throw new Error('MeasurelyFFT not loaded — ensure fft.js is included before fileLoader.js.');

    const L = ir.length;
    if (L < 8) return { freq: [], mag: [] };

    // Next power of 2, matching sweep.py: n = 1 << (L-1).bit_length()
    const n      = FFT.nextPow2(L);
    const padded = FFT.zeroPad(ir, n);
    const F      = FFT.rfft(padded); // Complex[], length n/2 + 1

    const freq = [];
    const mag  = [];

    // Skip DC (k=0); iterate k=1 … n/2
    for (let k = 1; k < F.length; k++) {
        const A = Math.sqrt(F[k].re ** 2 + F[k].im ** 2);
        freq.push(k * fs / n);
        mag.push(20 * Math.log10(Math.max(A, 1e-12)));
    }

    return { freq, mag };
}

// ---------------------------------------------------------------------------
// Optional CSV loader — calibration/reference overlay only
// ---------------------------------------------------------------------------

/**
 * Parse a REW frequency-response CSV/TXT export.
 * Returns null (without throwing) on any parse failure.
 * Supports comma/tab-separated two-column files and REW .mdat format.
 *
 * @param {File|Blob} csvFile
 * @returns {Promise<{ freq: number[], mag: number[] }|null>}
 */
async function loadResponseCsv(csvFile) {
    if (!csvFile) return null;

    try {
        const text = await csvFile.text();
        const freq = [], mag = [];

        for (const line of text.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || /^[*;#]/.test(trimmed) || /^freq/i.test(trimmed)) continue;

            const cols = trimmed.split(/[\t,]+/);
            if (cols.length < 2) continue;

            const f = parseFloat(cols[0]);
            const m = parseFloat(cols[1]);
            if (isFinite(f) && isFinite(m) && f > 0) {
                freq.push(f);
                mag.push(m);
            }
        }

        return freq.length > 0 ? { freq, mag } : null;
    } catch (e) {
        console.warn('[fileLoader] CSV parse failed (ignored):', e.message);
        return null;
    }
}

// ---------------------------------------------------------------------------
// Combined session loader
// ---------------------------------------------------------------------------

/**
 * Load a complete session from a WAV file (required) and optional CSV.
 *
 * - freq/mag are always derived from the IR via FFT.
 * - If a CSV is provided and parses successfully, it is attached as
 *   session.calibrationCurve. The CSV does NOT replace the FFT-derived
 *   response used for scoring — it is available as a reference overlay only.
 *
 * @param {File}      wavFile  - impulse response WAV (required)
 * @param {File|null} csvFile  - REW frequency response export (optional)
 * @returns {Promise<{ ir, fs, freq, mag, calibrationCurve, label }>}
 */
async function loadSession(wavFile, csvFile = null) {
    // 1. Decode WAV → IR
    const { ir, fs } = await loadIr(wavFile);

    // 2. Derive freq/mag via FFT (always — no CSV dependency)
    const { freq, mag } = irToFreqMag(ir, fs);

    // 3. Parse optional CSV as calibration overlay
    const calibrationCurve = csvFile ? await loadResponseCsv(csvFile) : null;
    if (csvFile && !calibrationCurve) {
        console.warn('[fileLoader] CSV provided but could not be parsed — proceeding without it.');
    }

    return {
        ir,
        fs,
        freq,
        mag,
        calibrationCurve,                              // null if not provided / failed to parse
        label: wavFile.name.replace(/\.[^.]+$/, ''),   // filename without extension as label
    };
}

// ---------------------------------------------------------------------------
// Validation — only WAV is required
// ---------------------------------------------------------------------------

/**
 * Pre-flight validation for selected files.
 * WAV is required; CSV is optional (only validated if the user selected one).
 *
 * @returns {{ ok: boolean, error?: string }}
 */
function validateFiles(wavFile, csvFile = null) {
    if (!wavFile) return { ok: false, error: 'Please select an impulse response WAV file.' };
    if (!isWav(wavFile)) return { ok: false, error: `"${wavFile.name}" doesn't look like a WAV file.` };

    if (csvFile && !isCsv(csvFile)) {
        return { ok: false, error: `"${csvFile.name}" doesn't look like a CSV or TXT file.` };
    }

    return { ok: true };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { loadSession, loadIr, irToFreqMag, loadResponseCsv, validateFiles, isWav, isCsv };
} else if (typeof window !== 'undefined') {
    window.MeasurelyFileLoader = { loadSession, loadIr, irToFreqMag, loadResponseCsv, validateFiles, isWav, isCsv };
}
