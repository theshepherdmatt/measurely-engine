/**
 * fft.js — Measurely Engine
 * Radix-2 Cooley-Tukey FFT for real-valued input signals.
 *
 * Public API:
 *   rfft(realArray)          → Complex[] of length N/2+1
 *   irfft(complexArray, N)   → Float64Array of length N   (real output)
 *   fftConvolve(a, b)        → Float64Array (linear convolution)
 *   nextPow2(n)              → smallest power-of-2 >= n
 *
 * All input arrays should be plain JS arrays or Float32/Float64Arrays.
 * Complex numbers are plain objects { re, im }.
 */

'use strict';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the smallest power of 2 >= n. */
function nextPow2(n) {
    if (n <= 1) return 1;
    return 1 << Math.ceil(Math.log2(n));
}

/** Zero-pad array to length len, returning a new Float64Array. */
function zeroPad(arr, len) {
    const out = new Float64Array(len);
    const src = arr instanceof Float64Array ? arr : Float64Array.from(arr);
    out.set(src.subarray(0, Math.min(src.length, len)));
    return out;
}

// ---------------------------------------------------------------------------
// Core in-place Complex FFT (Cooley-Tukey, radix-2, DIT)
// ---------------------------------------------------------------------------

/**
 * In-place bit-reversal permutation.
 * @param {Float64Array} re - real parts (length N)
 * @param {Float64Array} im - imaginary parts (length N)
 */
function _bitReverse(re, im) {
    const N = re.length;
    let j = 0;
    for (let i = 1; i < N; i++) {
        let bit = N >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
        }
    }
}

/**
 * In-place radix-2 DIT FFT.
 * @param {Float64Array} re
 * @param {Float64Array} im
 * @param {boolean} inverse - if true, computes IFFT (unscaled)
 */
function _fftInPlace(re, im, inverse = false) {
    const N = re.length;
    _bitReverse(re, im);
    const sign = inverse ? 1 : -1;

    for (let len = 2; len <= N; len <<= 1) {
        const half = len >> 1;
        const wRe = Math.cos((2 * Math.PI) / len);
        const wIm = sign * Math.sin((2 * Math.PI) / len);

        for (let i = 0; i < N; i += len) {
            let uRe = 1, uIm = 0;
            for (let k = 0; k < half; k++) {
                const evenRe = re[i + k];
                const evenIm = im[i + k];
                const oddRe  = uRe * re[i + k + half] - uIm * im[i + k + half];
                const oddIm  = uRe * im[i + k + half] + uIm * re[i + k + half];

                re[i + k]        = evenRe + oddRe;
                im[i + k]        = evenIm + oddIm;
                re[i + k + half] = evenRe - oddRe;
                im[i + k + half] = evenIm - oddIm;

                // Rotate twiddle factor
                const newURe = uRe * wRe - uIm * wIm;
                uIm = uRe * wIm + uIm * wRe;
                uRe = newURe;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Real-input FFT.
 * Returns an array of {re, im} complex numbers of length (N/2 + 1).
 * Input is padded to the next power of 2.
 *
 * @param {ArrayLike} signal - real-valued input samples
 * @returns {{ re: number, im: number }[]}
 */
function rfft(signal) {
    const N  = nextPow2(signal.length);
    const re = zeroPad(signal, N);
    const im = new Float64Array(N);
    _fftInPlace(re, im, false);
    // Return only the non-redundant half (DC … Nyquist inclusive)
    const out = new Array(N / 2 + 1);
    for (let k = 0; k <= N / 2; k++) {
        out[k] = { re: re[k], im: im[k] };
    }
    return out;
}

/**
 * Inverse real FFT.
 * Takes the output of rfft() (length N/2+1) and returns a Float64Array of
 * length N (scaled by 1/N).
 *
 * @param {{ re: number, im: number }[]} spectrum
 * @param {number} N - original (full) FFT length (must be power of 2)
 * @returns {Float64Array}
 */
function irfft(spectrum, N) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);

    // Rebuild full conjugate-symmetric spectrum
    for (let k = 0; k < spectrum.length; k++) {
        re[k] = spectrum[k].re;
        im[k] = spectrum[k].im;
    }
    for (let k = 1; k < N / 2; k++) {
        re[N - k] =  spectrum[k].re;
        im[N - k] = -spectrum[k].im;
    }

    _fftInPlace(re, im, true); // inverse=true

    // Scale by 1/N
    const scale = 1 / N;
    const out = new Float64Array(N);
    for (let i = 0; i < N; i++) out[i] = re[i] * scale;
    return out;
}

/**
 * Linear convolution via FFT (zero-padded to avoid circular wrap-around).
 * Equivalent to Python's scipy.signal.fftconvolve(a, b, mode="full").
 *
 * @param {ArrayLike} a
 * @param {ArrayLike} b
 * @returns {Float64Array} length = a.length + b.length - 1
 */
function fftConvolve(a, b) {
    const outLen = a.length + b.length - 1;
    const N      = nextPow2(outLen);

    const A = rfft(zeroPad(a, N));
    const B = rfft(zeroPad(b, N));

    // Pointwise complex multiply
    const C = A.map((Ak, k) => ({
        re: Ak.re * B[k].re - Ak.im * B[k].im,
        im: Ak.re * B[k].im + Ak.im * B[k].re,
    }));

    const result = irfft(C, N);
    return result.subarray(0, outLen);
}

// ---------------------------------------------------------------------------
// Exports (ES Module + fallback global)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { rfft, irfft, fftConvolve, nextPow2, zeroPad };
} else if (typeof window !== 'undefined') {
    window.MeasurelyFFT = { rfft, irfft, fftConvolve, nextPow2, zeroPad };
}
