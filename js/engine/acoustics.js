/**
 * acoustics.js — Measurely Engine
 * Direct JavaScript port of measurelyapp/acoustics.py
 *
 * Room geometry and predictions — purely arithmetic.
 * No signal processing; no FFT dependency.
 *
 * Produces identical output to the Python module to < 0.01 Hz.
 *
 * Public API:
 *   analyseRoom(room)  →  full room context object
 *
 *   Lower-level helpers are also exported for the simulate-mode UI:
 *   computeRoomGeometry, computeRoomModes, computeSbir,
 *   computeTriangle, computeRoomGain, computeCeilingReflection
 */

'use strict';

const C = 343.0; // Speed of sound (m/s)

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Deep-search a room settings object for a key, checking the top level first,
 * then common sub-objects. Equivalent to Python _get().
 */
function _get(room, key, defaultVal = 0.0) {
    if (room && key in room) return room[key];
    for (const sub of ['geometry', 'setup', 'environment']) {
        if (room && typeof room[sub] === 'object' && room[sub] !== null && key in room[sub]) {
            return room[sub][key];
        }
    }
    return defaultVal;
}

// ---------------------------------------------------------------------------
// 1. ROOM GEOMETRY
// ---------------------------------------------------------------------------

/**
 * Compute room dimensions, volume, surface area, and Schroeder frequency.
 * Equivalent to acoustics.py compute_room_geometry(room).
 *
 * @param {object} room - room settings object
 * @returns {{ L, W, H, H_eff, volume, surface_area, schroeder_hz }}
 */
function computeRoomGeometry(room) {
    const L = parseFloat(_get(room, 'length_m', 0));
    const W = parseFloat(_get(room, 'width_m',  0));
    const H = parseFloat(_get(room, 'height_m', 0));
    const cType = _get(room, 'ceiling_type', 'flat');

    let H_eff, vol, area;

    if (cType === 'slanted') {
        const H_sec = parseFloat(_get(room, 'ceiling_height_secondary_m', H));
        H_eff = (H + H_sec) / 2.0;
        vol   = L * W * H_eff;

        const dir = _get(room, 'ceiling_slant_direction', 'left_to_right');
        const run   = (dir === 'front_to_back' || dir === 'back_to_front') ? L : W;
        const cross = (dir === 'front_to_back' || dir === 'back_to_front') ? W : L;

        const hyp          = Math.sqrt(run ** 2 + (H - H_sec) ** 2);
        const ceilingArea  = hyp * cross;
        const floorArea    = L * W;
        const trapArea     = 2 * (run * H_eff);
        const rectArea     = cross * H + cross * H_sec;
        area = floorArea + ceilingArea + trapArea + rectArea;

    } else if (cType === 'gabled') {
        // Gabled (pitched) ceiling — average height equals peak/2
        const H_peak = parseFloat(_get(room, 'ceiling_height_secondary_m', H));
        H_eff = (H + H_peak) / 2.0;
        vol   = L * W * H_eff;
        // Surface area approximation: floor + two slanted roof panels + two rectangular walls + two trapezoidal gable ends
        const axis     = _get(room, 'ceiling_gable_axis', 'width');
        const run      = axis === 'width' ? W / 2 : L / 2;
        const ridgeLen = axis === 'width' ? L     : W;
        const slopeLen = Math.sqrt(run ** 2 + (H_peak - H) ** 2);
        area  = L * W                       // floor
              + 2 * slopeLen * ridgeLen      // two roof panels
              + 2 * L * H + 2 * W * H;      // walls (approximate base level)
    } else {
        H_eff = H;
        vol   = L * W * H;
        area  = 2.0 * (L * W + L * H + W * H);
    }

    // Schroeder frequency — Schroeder (1962): f_sch = 2000 * sqrt(T60 / V)
    // T60 estimated from room type and floor material rather than a fixed 0.4s:
    //   studio / treated  → ~0.20 s   hard bare room → ~0.60 s
    //   carpeted home     → ~0.30 s   furnished home → ~0.40 s (default)
    const _roomType  = _get(room, 'room_type',      'home');
    const _floorMat  = _get(room, 'floor_material', 'mixed');
    const T60_est = (_roomType === 'studio')   ? 0.20
                  : (_floorMat === 'hard')     ? 0.60
                  : (_floorMat === 'carpet')   ? 0.30
                  :                             0.40;
    const f_sch = 2000.0 * Math.sqrt(T60_est / Math.max(vol, 1e-6));

    return { L, W, H, H_eff, volume: vol, surface_area: area, schroeder_hz: f_sch };
}

// ---------------------------------------------------------------------------
// 2. AXIAL ROOM MODES
// ---------------------------------------------------------------------------

/**
 * Compute axial room modes along all three axes.
 * Equivalent to acoustics.py compute_room_modes(room, max_modes).
 *
 * @param {object} room
 * @param {number} maxModes - modes per axis, default 15
 * @returns {{ axis: string, order: number, freq_hz: number }[]}
 */
function computeRoomModes(room, maxModes = 15) {
    const cType = _get(room, 'ceiling_type', 'flat');
    const H     = parseFloat(_get(room, 'height_m', 0));
    let H_eff;
    if (cType === 'slanted' || cType === 'gabled') {
        const H_sec = parseFloat(_get(room, 'ceiling_height_secondary_m', H));
        H_eff = (H + H_sec) / 2.0;
    } else {
        H_eff = H;
    }

    const dims = {
        length: parseFloat(_get(room, 'length_m', 0)),
        width:  parseFloat(_get(room, 'width_m',  0)),
        height: H_eff,
    };

    const modeList = [];
    const _L = dims.length, _W = dims.width, _H = dims.height;
    if (_L > 0 && _W > 0 && _H > 0) {
        for (let p = 0; p <= maxModes; p++) {
            for (let q = 0; q <= maxModes; q++) {
                for (let r = 0; r <= maxModes; r++) {
                    if (p === 0 && q === 0 && r === 0) continue;
                    
                    const freq = (C / 2.0) * Math.sqrt(
                        Math.pow(p / _L, 2) + Math.pow(q / _W, 2) + Math.pow(r / _H, 2)
                    );
                    
                    // Categorise mode type
                    const nonZeroCount = (p > 0 ? 1 : 0) + (q > 0 ? 1 : 0) + (r > 0 ? 1 : 0);
                    let type = 'oblique';
                    if (nonZeroCount === 1) type = 'axial';
                    else if (nonZeroCount === 2) type = 'tangential';

                    // For backwards compatibility/UI mapping, assign an axis label to early axials
                    let axisLabel = type;
                    if (type === 'axial') {
                        if (p > 0) axisLabel = 'length';
                        else if (q > 0) axisLabel = 'width';
                        else axisLabel = 'height';
                    }

                    modeList.push({ axis: axisLabel, type, p, q, r, order: Math.max(p, q, r), freq_hz: freq });
                }
            }
        }
    }

    modeList.sort((a, b) => a.freq_hz - b.freq_hz);
    return modeList;
}

// ---------------------------------------------------------------------------
// 3. SBIR (Speaker Boundary Interference)
// ---------------------------------------------------------------------------

/**
 * Compute SBIR null frequencies for the front wall and ceiling.
 * Equivalent to acoustics.py compute_sbir(room).
 *
 * @param {object} room
 * @returns {{ front_wall: object, ceiling: object }}
 */
function computeSbir(room) {
    const d_front = parseFloat(_get(room, 'spk_front_m', 0));
    const result  = {
        front_wall: { distance_m: null, nulls_hz: [] },
        ceiling:    { distance_m: null, nulls_hz: [] },
    };

    // Front wall
    if (d_front > 0) {
        const f0Front   = C / (4.0 * d_front);
        const nullsFront = Array.from({ length: 6 }, (_, k) => f0Front * (2 * k + 1));
        result.front_wall = { distance_m: d_front, nulls_hz: nullsFront };
    }

    // Ceiling SBIR
    const cType    = _get(room, 'ceiling_type', 'flat');
    const H        = parseFloat(_get(room, 'height_m', 0));
    const H_tweeter = parseFloat(_get(room, 'tweeter_height_m', 0));

    let d_ceil;

    if (cType === 'slanted') {
        const H_sec  = parseFloat(_get(room, 'ceiling_height_secondary_m', H));
        const dir    = _get(room, 'ceiling_slant_direction', 'left_to_right');
        const L      = parseFloat(_get(room, 'length_m', 1));
        const W      = parseFloat(_get(room, 'width_m',  1));

        // Calculate local ceiling height at speaker position
        const spk_z = L / 2.0 - d_front;
        const spk_w = parseFloat(_get(room, 'spk_spacing_m', 0));
        const spk_x = -spk_w / 2.0;

        let t;
        if      (dir === 'left_to_right')  t = (spk_x + W / 2) / W;
        else if (dir === 'right_to_left')  t = 1 - (spk_x + W / 2) / W;
        else if (dir === 'front_to_back')  t = 1 - (spk_z + L / 2) / L;
        else if (dir === 'back_to_front')  t = (spk_z + L / 2) / L;
        else                               t = (spk_x + W / 2) / W;

        const H_local = H_sec + t * (H - H_sec);
        const run     = (dir === 'front_to_back' || dir === 'back_to_front') ? L : W;
        const theta   = Math.atan2(Math.abs(H - H_sec), run);
        d_ceil = (H_local - H_tweeter) * Math.cos(theta);

    } else {
        d_ceil = H - H_tweeter;
    }

    if (d_ceil > 0) {
        let pathDiff = 0;
        const d_list = parseFloat(_get(room, 'listener_front_m', 0));
        const spk_x = parseFloat(_get(room, 'spk_spacing_m', 0)) / 2;
        const list_x = parseFloat(_get(room, 'listener_offset_m', 0));
        const D_horiz = Math.hypot(spk_x - list_x, Math.abs(d_list - d_front));
        const H_list = 1.2; // Seated ear height per ITU-R BS.1116-3
        
        if (D_horiz > 0) {
            const d_dir = Math.hypot(D_horiz, H_tweeter - H_list);
            const d_refl = Math.hypot(D_horiz, 2 * d_ceil + (H_tweeter - H_list)); 
            pathDiff = d_refl - d_dir;
        } else {
            pathDiff = 2 * d_ceil;
        }

        if (pathDiff > 0) {
            const f0Ceil   = C / (2.0 * pathDiff);
            const nullsCeil = Array.from({ length: 6 }, (_, k) => f0Ceil * (2 * k + 1));
            result.ceiling = { distance_m: d_ceil, nulls_hz: nullsCeil };
        }
    }

    return result;
}

// ---------------------------------------------------------------------------
// 4. STEREO LISTENING TRIANGLE
// ---------------------------------------------------------------------------

/**
 * Evaluate the equilateral triangle ratio of the stereo setup.
 * Equivalent to acoustics.py compute_triangle(room).
 *
 * @param {object} room
 * @returns {{ ideal: boolean, ratio: number|null, penalty: number }}
 */
function computeTriangle(room) {
    const spacing  = parseFloat(_get(room, 'spk_spacing_m', 0));
    const listener_front = parseFloat(_get(room, 'listener_front_m', 0));
    const spk_front = parseFloat(_get(room, 'spk_front_m', 0));
    
    // Triangle depth is the orthogonal distance from listener to speaker baseline
    const depth = listener_front - spk_front;

    if (spacing <= 0 || depth <= 0) {
        return { ideal: false, ratio: null, penalty: 2 };
    }

    // Ideal ratio for an equilateral triangle is sqrt(3)/2 ≈ 0.866
    const ratio = depth / spacing;
    let penalty;
    if      (ratio >= 0.76 && ratio <= 0.96) penalty = 0; // +/- 0.1 from 0.866
    else if (ratio >= 0.65 && ratio <= 1.10) penalty = 1;
    else                                     penalty = 2;

    return { ideal: penalty === 0, ratio, penalty };
}

// ---------------------------------------------------------------------------
// 5. ROOM GAIN
// ---------------------------------------------------------------------------

/**
 * Estimate room gain onset frequency and magnitude.
 * Equivalent to acoustics.py compute_room_gain(room).
 *
 * @param {object} room
 * @returns {{ gain_hz: number|null, gain_db: number|null }}
 */
function computeRoomGain(room) {
    const L = parseFloat(_get(room, 'length_m', 0));
    const W = parseFloat(_get(room, 'width_m',  0));
    const H = parseFloat(_get(room, 'height_m', 0));

    if (Math.min(L, W, H) <= 0) {
        return { gain_hz: null, gain_db: null };
    }

    const dim_max  = Math.max(L, W, H);
    const gain_hz  = C / (4.0 * dim_max); // quarter-wave onset of longest dimension
    const gain_db  = 3.0 + Math.max(0.0, 20.0 - dim_max) * 0.1;

    return { gain_hz, gain_db };
}

// ---------------------------------------------------------------------------
// 6. CEILING FIRST REFLECTION
// ---------------------------------------------------------------------------

/**
 * Estimate the ceiling first-reflection geometry.
 * Equivalent to acoustics.py compute_ceiling_reflection(room).
 *
 * @param {object} room
 * @returns {{ distance_from_speaker_m: number, slope_angle_rad: number }}
 */
function computeCeilingReflection(room) {
    const cType    = _get(room, 'ceiling_type', 'flat');
    const H        = parseFloat(_get(room, 'height_m', 0));
    const H_sec    = parseFloat(_get(room, 'ceiling_height_secondary_m', H));
    const d_spk    = parseFloat(_get(room, 'spk_front_m', 0));
    const d_list   = parseFloat(_get(room, 'listener_front_m', 0));
    const z_dist   = d_list - d_spk;

    let theta = 0;
    if (cType === 'slanted') {
        const dir = _get(room, 'ceiling_slant_direction', 'left_to_right');
        const L   = parseFloat(_get(room, 'length_m', 1));
        const W   = parseFloat(_get(room, 'width_m',  1));
        const run = (dir === 'front_to_back' || dir === 'back_to_front') ? L : W;
        theta = Math.atan2(Math.abs(H - H_sec), run);
    }

    return {
        distance_from_speaker_m: z_dist / 2.0,
        slope_angle_rad: theta,
    };
}

// ---------------------------------------------------------------------------
// MASTER: analyse_room
// ---------------------------------------------------------------------------

/**
 * Full room acoustic prediction model.
 * Equivalent to acoustics.py analyse_room(room).
 *
 * @param {object} room - room settings object (same schema as room.json)
 * @returns {object} full room context (geometry, modes, sbir, triangle, etc.)
 */
function analyseRoom(room) {
    const geometry   = computeRoomGeometry(room);
    const modeList   = computeRoomModes(room);
    const sbir       = computeSbir(room);
    const triangle   = computeTriangle(room);
    const gain       = computeRoomGain(room);
    const ceilingRef = computeCeilingReflection(room);

    const sch = geometry.schroeder_hz;

    // Severity factors
    const lowModes     = modeList.filter(m => m.freq_hz < sch);
    const modalSeverity = Math.min(lowModes.length / 10.0, 1.0);

    const d_front = sbir.front_wall?.distance_m ?? null;
    let sbirSeverity;
    if      (d_front === null)  sbirSeverity = 0.15;
    else if (d_front < 0.35)   sbirSeverity = 0.30;
    else if (d_front < 0.55)   sbirSeverity = 0.15;
    else                       sbirSeverity = 0.05;

    const combined    = modalSeverity * 0.6 + sbirSeverity * 0.4;
    const roomFactor  = Math.max(0.85, Math.min(1.15, 1.15 - combined * 0.30));
    const stereoFactor = triangle.penalty === 0 ? 1.10
                       : triangle.penalty === 1 ? 1.00
                       : 0.90;

    // Trim modes below Schroeder frequency for AI / UI (max 12 to capture tangentials)
    const trimmedModes = modeList
        .filter(m => m.freq_hz < sch)
        .slice(0, 12)
        .map(m => ({ axis: m.axis, type: m.type, p: m.p, q: m.q, r: m.r, freq_hz: Math.round(m.freq_hz * 10) / 10 }));

    // Frequency-dependent Sabine RT60, opt-in additive output. Null when
    // dimensions or the materials bridge are unusable. No existing field
    // is removed or changed; this is purely additive.
    let rt60 = null;
    const surfaces = _surfacesModule();
    if (surfaces && typeof surfaces.getRoomSurfaceMaterials === 'function') {
        const surfaceMaterials = surfaces.getRoomSurfaceMaterials(room);
        rt60 = predictRT60(
            { length: geometry.L, width: geometry.W, height: geometry.H_eff },
            surfaceMaterials
        );
    }

    return {
        geometry,
        modes:              trimmedModes,
        sbir,
        triangle,
        room_gain:          gain,
        ceiling_reflection: ceilingRef,
        room_factor:        roomFactor,
        stereo_factor:      stereoFactor,
        rt60,
    };
}

// ---------------------------------------------------------------------------
// 7. SABINE RT60 PREDICTION (frequency-dependent, additive, opt-in)
// ---------------------------------------------------------------------------
//
// Predictive model: not a physical measurement.
//
// Per-octave-band Sabine reverberation time computed from per-surface
// material IDs in the materials database (js/engine/materials/). This is
// a parallel, opt-in API — the hardcoded broadband T60_est inside
// computeRoomGeometry (used only for the Schroeder frequency) is
// untouched, and no overlay consumes this yet.
//
// Sabine's classic equation:  T60 = 0.161 · V / A_total
//   V       = room volume (m³)
//   A_total = Σ S_i · α_i   (m² Sabines)   per frequency band
//
// Air absorption (the 4·m·V term in the full Sabine equation) is
// intentionally omitted in this first cut. It is non-negligible above
// ~2 kHz at low humidity and is future work.

const DEFAULT_RT60_FREQS    = [125, 250, 500, 1000, 2000, 4000];
const DEFAULT_RT60_FALLBACK = 'painted-drywall';

// Resolve the materials module — Node via require, browser via
// window.MeasurelyMaterials if a consumer has loaded it. Match
// treatments.js getTreatmentMaterial's lazy-load pattern.
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

// Resolve the surface-materials bridge (state → six-surface map). Same
// lazy-load pattern; null when unavailable so analyseRoom can degrade
// rt60 to null rather than throw.
function _surfacesModule() {
    if (typeof require !== 'undefined') {
        try { return require('./materials/surfaces.js'); }
        catch (_) { /* fall through to browser path */ }
    }
    if (typeof window !== 'undefined' && window.MeasurelySurfaces) {
        return window.MeasurelySurfaces;
    }
    return null;
}

/**
 * Predict octave-band Sabine RT60 from per-surface materials.
 *
 * Predictive model: not a physical measurement.
 *
 * @param {{length:number, width:number, height:number}} dimensions  metres
 * @param {object} surfaceMaterials  { floor, ceiling, frontWall, backWall,
 *                                     leftWall, rightWall: materialId|null }
 * @param {object} [options]
 * @param {number[]} [options.frequencies=[125,250,500,1000,2000,4000]]
 * @param {string}   [options.fallbackMaterial='painted-drywall']
 * @returns {Object<string, number|null> | null}
 *          map of frequency → T60 seconds, or null per band if degenerate,
 *          or null overall if dimensions/materials module are unusable.
 */
function predictRT60(dimensions, surfaceMaterials, options = {}) {
    const length = dimensions ? Number(dimensions.length) : NaN;
    const width  = dimensions ? Number(dimensions.width)  : NaN;
    const height = dimensions ? Number(dimensions.height) : NaN;
    if (!(length > 0 && width > 0 && height > 0)) return null;

    const mats = _materialsModule();
    if (!mats || typeof mats.alphaAt !== 'function' || typeof mats.getMaterial !== 'function') {
        return null;
    }

    const freqs = (Array.isArray(options.frequencies) && options.frequencies.length)
        ? options.frequencies.slice()
        : DEFAULT_RT60_FREQS.slice();
    const fallbackId = (typeof options.fallbackMaterial === 'string' && options.fallbackMaterial)
        ? options.fallbackMaterial
        : DEFAULT_RT60_FALLBACK;
    const fallbackMat = mats.getMaterial(fallbackId);

    // length = depth: front/back walls are width × height; left/right are length × height.
    const areas = {
        floor:     length * width,
        ceiling:   length * width,
        frontWall: width  * height,
        backWall:  width  * height,
        leftWall:  length * height,
        rightWall: length * height,
    };
    const V = length * width * height;

    // Resolve a material object per surface, with fallback for null/unresolved IDs.
    const resolved = {};
    for (const key of Object.keys(areas)) {
        const id = surfaceMaterials ? surfaceMaterials[key] : null;
        let mat = null;
        if (typeof id === 'string' && id.length) mat = mats.getMaterial(id) || null;
        if (!mat) mat = fallbackMat || null;
        resolved[key] = mat;
    }

    const out = {};
    for (const f of freqs) {
        let A = 0;
        let degenerate = false;
        for (const key of Object.keys(areas)) {
            const mat = resolved[key];
            if (!mat) { degenerate = true; break; }
            const alpha = mats.alphaAt(mat, f, { clamp: true });
            if (alpha === null || !Number.isFinite(alpha)) { degenerate = true; break; }
            A += areas[key] * alpha;
        }
        out[String(f)] = (degenerate || !(A > 0)) ? null : (0.161 * V / A);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Regression test (run with `node js/engine/acoustics.js`)
// ---------------------------------------------------------------------------
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    /* eslint-disable */
    let failures = 0;
    const fail = (msg) => { console.error(`[FAIL] ${msg}`); failures++; };
    const pass = (msg) => { console.log (`[pass] ${msg}`); };

    const dims = { length: 5, width: 4, height: 3 };
    const REQUESTED = [125, 250, 500, 1000, 2000, 4000];

    function allSurfaces(id) {
        return {
            floor: id, ceiling: id,
            frontWall: id, backWall: id,
            leftWall: id, rightWall: id,
        };
    }

    // Untreated concrete: T60(500) ∈ [2, 10] and every requested band finite > 0
    const rConcrete = predictRT60(dims, allSurfaces('rough-concrete'));
    if (!rConcrete) {
        fail('predictRT60 returned null for concrete room');
    } else {
        for (const f of REQUESTED) {
            const v = rConcrete[String(f)];
            if (!(Number.isFinite(v) && v > 0)) {
                fail(`concrete: T60 at ${f} Hz is not finite > 0 (got ${v})`);
            }
        }
        const t500 = rConcrete['500'];
        if (!(t500 >= 2 && t500 <= 10)) {
            fail(`concrete: T60(500) = ${t500} not in [2, 10]`);
        } else {
            pass(`concrete  T60(500) = ${t500.toFixed(2)} s   (∈ [2,10])`);
        }
    }

    // Fully absorbing: T60(500) < 0.4 and every requested band finite > 0
    const rAbs = predictRT60(dims, allSurfaces('oc-703-2in-amount'));
    if (!rAbs) {
        fail('predictRT60 returned null for OC 703 room');
    } else {
        for (const f of REQUESTED) {
            const v = rAbs[String(f)];
            if (!(Number.isFinite(v) && v > 0)) {
                fail(`OC 703: T60 at ${f} Hz is not finite > 0 (got ${v})`);
            }
        }
        const t500 = rAbs['500'];
        if (!(t500 < 0.4)) {
            fail(`OC 703: T60(500) = ${t500} not < 0.4`);
        } else {
            pass(`oc-703    T60(500) = ${t500.toFixed(3)} s   (< 0.4)`);
        }
    }

    if (rConcrete && rAbs) {
        console.log('\nfreq   concrete (s)   oc-703 2" (s)');
        for (const f of REQUESTED) {
            const c = rConcrete[String(f)];
            const a = rAbs[String(f)];
            console.log(
                String(f).padStart(4) + '   ' +
                (Number.isFinite(c) ? c.toFixed(3) : String(c)).padStart(12) + '   ' +
                (Number.isFinite(a) ? a.toFixed(3) : String(a)).padStart(13)
            );
        }
    }

    if (failures > 0) {
        console.error(`\n${failures} regression failure(s)`);
        process.exit(1);
    } else {
        console.log('\nSabine RT60 prediction regressions pass ✓');
    }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        analyseRoom,
        computeRoomGeometry, computeRoomModes, computeSbir,
        computeTriangle, computeRoomGain, computeCeilingReflection,
        predictRT60,
    };
} else if (typeof window !== 'undefined') {
    window.MeasurelyAcoustics = {
        analyseRoom,
        computeRoomGeometry, computeRoomModes, computeSbir,
        computeTriangle, computeRoomGain, computeCeilingReflection,
        predictRT60,
    };
}
