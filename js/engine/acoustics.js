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

    // Schroeder frequency (geometry-only placeholder)
    const f_sch = 2000.0 / Math.max(Math.sqrt(vol), 1e-6);

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
    for (const [axis, dim] of Object.entries(dims)) {
        if (dim <= 0) continue;
        for (let n = 1; n <= maxModes; n++) {
            modeList.push({ axis, order: n, freq_hz: (C / 2.0) * (n / dim) });
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
        const f0Ceil   = C / (4.0 * d_ceil);
        const nullsCeil = Array.from({ length: 6 }, (_, k) => f0Ceil * (2 * k + 1));
        result.ceiling = { distance_m: d_ceil, nulls_hz: nullsCeil };
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
    const listener = parseFloat(_get(room, 'listener_front_m', 0));

    if (spacing <= 0 || listener <= 0) {
        return { ideal: false, ratio: null, penalty: 2 };
    }

    const ratio = listener / spacing;
    let penalty;
    if      (ratio >= 0.9 && ratio <= 1.1)  penalty = 0;
    else if (ratio >= 0.75 && ratio <= 1.25) penalty = 1;
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

    const dim_min  = Math.min(L, W, H);
    const gain_hz  = C / (2.0 * dim_min);
    const gain_db  = 3.0 + Math.max(0.0, 20.0 - dim_min) * 0.1;

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

    // Trim modes below Schroeder frequency for AI / UI (max 8)
    const trimmedModes = modeList
        .filter(m => m.freq_hz < sch)
        .slice(0, 8)
        .map(m => ({ axis: m.axis, freq_hz: Math.round(m.freq_hz * 10) / 10 }));

    return {
        geometry,
        modes:              trimmedModes,
        sbir,
        triangle,
        room_gain:          gain,
        ceiling_reflection: ceilingRef,
        room_factor:        roomFactor,
        stereo_factor:      stereoFactor,
    };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        analyseRoom,
        computeRoomGeometry, computeRoomModes, computeSbir,
        computeTriangle, computeRoomGain, computeCeilingReflection,
    };
} else if (typeof window !== 'undefined') {
    window.MeasurelyAcoustics = {
        analyseRoom,
        computeRoomGeometry, computeRoomModes, computeSbir,
        computeTriangle, computeRoomGain, computeCeilingReflection,
    };
}
