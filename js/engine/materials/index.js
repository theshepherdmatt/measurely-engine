// ---------------------------------------------------------------------------
// Materials — read-only API over the seed acoustic materials database.
//
// Coefficients are stored verbatim as published (including values > 1.0,
// which are real and common — see ISO 354:2003 §3 on edge diffraction).
// Clamping happens at query time only, never at storage time.
//
// Frequency convention: 1/1-octave centres at 63 / 125 / 250 / 500 / 1000 /
// 2000 / 4000 / 8000 Hz. Missing outer bands fall back per Odeon:
// 63 Hz → 125 Hz, 8 kHz → 4 kHz.
//
// Standalone module — no overlays or simulation code consume this yet.
// Integration is a later prompt.
// ---------------------------------------------------------------------------

const OCTAVE_BANDS = [63, 125, 250, 500, 1000, 2000, 4000, 8000];
const ALPHA_CLAMP_MAX = 0.99;

let _database = null;

function _loadDatabase() {
    if (_database !== null) return _database;
    if (typeof require !== 'undefined') {
        _database = require('./database.json');
    } else if (typeof window !== 'undefined' && window.MeasurelyMaterialsDB) {
        _database = window.MeasurelyMaterialsDB;
    } else {
        _database = [];
    }
    return _database;
}

function getMaterial(id) {
    const db = _loadDatabase();
    for (const m of db) {
        if (m.id === id) return m;
    }
    return null;
}

function listMaterials(filter = {}) {
    const db = _loadDatabase();
    const { category, manufacturer, provenance } = filter;
    return db.filter((m) => {
        if (category    && m.category    !== category)    return false;
        if (manufacturer && m.manufacturer !== manufacturer) return false;
        if (provenance  && m.provenance  !== provenance)  return false;
        return true;
    });
}

// Resolve the effective coefficient at an octave-band centre, applying the
// Odeon outer-band fallback. Returns null if no usable value can be found.
function _coefficientAtBand(coeffs, band) {
    if (!coeffs) return null;
    const raw = coeffs[String(band)];
    if (raw !== undefined && raw !== null && Number.isFinite(raw)) return raw;
    if (band === 63) {
        const fb = coeffs['125'];
        return (fb !== undefined && fb !== null && Number.isFinite(fb)) ? fb : null;
    }
    if (band === 8000) {
        const fb = coeffs['4000'];
        return (fb !== undefined && fb !== null && Number.isFinite(fb)) ? fb : null;
    }
    return null;
}

function alphaAt(material, frequencyHz, opts = {}) {
    const clamp = opts.clamp !== false;
    if (!material || !material.absorption || !material.absorption.coefficients) {
        return null;
    }
    const coeffs = material.absorption.coefficients;

    // Clamp to nearest endpoint outside [63, 8000] Hz.
    let f = frequencyHz;
    if (!Number.isFinite(f)) return null;
    if (f <= OCTAVE_BANDS[0])                 f = OCTAVE_BANDS[0];
    if (f >= OCTAVE_BANDS[OCTAVE_BANDS.length - 1]) f = OCTAVE_BANDS[OCTAVE_BANDS.length - 1];

    // Find bracketing octave bands.
    let loBand = OCTAVE_BANDS[0];
    let hiBand = OCTAVE_BANDS[OCTAVE_BANDS.length - 1];
    for (let i = 0; i < OCTAVE_BANDS.length - 1; i++) {
        if (f >= OCTAVE_BANDS[i] && f <= OCTAVE_BANDS[i + 1]) {
            loBand = OCTAVE_BANDS[i];
            hiBand = OCTAVE_BANDS[i + 1];
            break;
        }
    }

    const aLo = _coefficientAtBand(coeffs, loBand);
    const aHi = _coefficientAtBand(coeffs, hiBand);

    let alpha;
    if (aLo === null && aHi === null) return null;
    if (aLo === null)      alpha = aHi;
    else if (aHi === null) alpha = aLo;
    else if (loBand === hiBand || f === loBand) alpha = aLo;
    else if (f === hiBand) alpha = aHi;
    else {
        // Log-linear interpolation in frequency.
        const t = (Math.log(f) - Math.log(loBand)) / (Math.log(hiBand) - Math.log(loBand));
        alpha = aLo + (aHi - aLo) * t;
    }

    if (clamp) {
        if (alpha < 0)              alpha = 0;
        if (alpha > ALPHA_CLAMP_MAX) alpha = ALPHA_CLAMP_MAX;
    }
    return alpha;
}

function reflectionMagnitude(material, frequencyHz) {
    const alpha = alphaAt(material, frequencyHz, { clamp: true });
    if (alpha === null) return null;
    const oneMinus = 1 - alpha;
    return Math.sqrt(oneMinus > 0 ? oneMinus : 0);
}

// ---------------------------------------------------------------------------
// Regression test (run with `node js/engine/materials/index.js`)
// ---------------------------------------------------------------------------
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    /* eslint-disable */
    const db = _loadDatabase();
    let failures = 0;
    const fail = (msg) => { console.error(`[FAIL] ${msg}`); failures++; };
    const pass = (msg) => { console.log (`[pass] ${msg}`); };

    // (a) Every entry has the required structural fields.
    const REQUIRED = ['id', 'name', 'category', 'provenance', 'source'];
    for (const m of db) {
        for (const k of REQUIRED) {
            if (m[k] === undefined || m[k] === null || m[k] === '') {
                fail(`entry missing '${k}': ${m.id || '(unknown)'}`);
            }
        }
        if (!m.absorption || !m.absorption.mounting) {
            fail(`entry missing absorption.mounting: ${m.id}`);
        }
        if (!m.absorption || !m.absorption.coefficients) {
            fail(`entry missing absorption.coefficients: ${m.id}`);
        }
    }
    if (failures === 0) pass(`(a) ${db.length} entries have id/name/category/mounting/coefficients/provenance/source`);

    // (b) Every coefficient is null or a finite number ≥ 0.
    const beforeB = failures;
    for (const m of db) {
        const coeffs = m.absorption && m.absorption.coefficients;
        if (!coeffs) continue;
        for (const band of OCTAVE_BANDS) {
            const v = coeffs[String(band)];
            if (v === undefined) continue;
            if (v === null) continue;
            if (!Number.isFinite(v) || v < 0) {
                fail(`${m.id} @ ${band} Hz is not (null | finite ≥ 0): ${v}`);
            }
        }
    }
    if (failures === beforeB) pass('(b) every coefficient is null or finite ≥ 0');

    // (c) alphaAt clamps a raw 1.25 coefficient to 0.99.
    const auralex4 = getMaterial('auralex-studiofoam-wedge-4in-amount');
    if (!auralex4) {
        fail('(c) cannot find auralex-studiofoam-wedge-4in-amount');
    } else {
        const raw500 = auralex4.absorption.coefficients['500']; // 1.25
        if (raw500 !== 1.25) {
            fail(`(c) expected raw α(500) = 1.25, got ${raw500}`);
        }
        const clamped = alphaAt(auralex4, 500, { clamp: true });
        if (Math.abs(clamped - ALPHA_CLAMP_MAX) > 1e-9) {
            fail(`(c) expected clamped α(500) = ${ALPHA_CLAMP_MAX}, got ${clamped}`);
        } else {
            pass(`(c) raw 1.25 clamps to ${ALPHA_CLAMP_MAX}`);
        }
        const unclamped = alphaAt(auralex4, 500, { clamp: false });
        if (Math.abs(unclamped - 1.25) > 1e-9) {
            fail(`(c) expected unclamped α(500) = 1.25, got ${unclamped}`);
        }
    }

    // (d) reflectionMagnitude is in [0, 1] for every entry at 500 Hz.
    const beforeD = failures;
    for (const m of db) {
        const r = reflectionMagnitude(m, 500);
        if (r === null) {
            fail(`(d) reflectionMagnitude null at 500 Hz: ${m.id}`);
            continue;
        }
        if (!(r >= 0 && r <= 1)) {
            fail(`(d) ${m.id}: reflectionMagnitude(500) = ${r} outside [0, 1]`);
        }
    }
    if (failures === beforeD) pass('(d) reflectionMagnitude in [0,1] @ 500 Hz for every entry');

    // (e) getMaterial('oc-703-2in-amount') returns NRC 1.00.
    const oc703 = getMaterial('oc-703-2in-amount');
    if (!oc703) {
        fail('(e) getMaterial returned null for oc-703-2in-amount');
    } else if (oc703.absorption.nrc !== 1.00) {
        fail(`(e) expected NRC 1.00, got ${oc703.absorption.nrc}`);
    } else {
        pass('(e) getMaterial(\'oc-703-2in-amount\').absorption.nrc === 1.00');
    }

    if (failures > 0) {
        console.error(`\n${failures} regression failure(s)`);
        process.exit(1);
    } else {
        console.log('\nAll material database regressions pass ✓');
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
if (typeof module !== 'undefined') {
    module.exports = {
        getMaterial,
        listMaterials,
        alphaAt,
        reflectionMagnitude,
        OCTAVE_BANDS,
        ALPHA_CLAMP_MAX,
    };
}

if (typeof window !== 'undefined') {
    window.MeasurelyMaterials = {
        getMaterial,
        listMaterials,
        alphaAt,
        reflectionMagnitude,
        OCTAVE_BANDS,
        ALPHA_CLAMP_MAX,
    };
}
