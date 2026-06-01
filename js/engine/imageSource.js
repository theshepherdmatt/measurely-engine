/**
 * imageSource.js — first-order image-source method for a rectangular room.
 *
 * Image-source method: for each of the six bounding surfaces, mirror the
 * source position across that surface; the line from the mirror image to
 * the listener crosses the surface at the geometric bounce point. If the
 * bounce point lies within the surface bounds, the reflection is valid.
 *
 * The five flat surfaces (floor + four walls) use the simple axis-aligned
 * mirror. The CEILING is special-cased: for slanted / gable / vaulted rooms
 * the ceiling is one or more tilted facet planes, not a flat plane at room
 * height, so it is reflected across the ACTUAL facet plane(s) — see
 * _ceilingBounce(). The facet geometry is re-derived from the same room
 * fields (ridge/eave heights, slope direction, gable axis) that drive
 * room3d.js's ceilingYAt() wireframe, so the bounce always lands on the
 * real roofline rather than passing through it.
 *
 * Limitations:
 *   - First-order only (no multi-bounce / late-tail paths)
 *   - Walls assumed rectangular and axis-aligned (no non-orthogonal walls,
 *     no diffusion); the ceiling may be flat, slanted, or gabled
 *   - Does not account for furniture, absorbers, or speaker dispersion —
 *     those are downstream visual concerns; the surface itself is treated
 *     as a perfect mirror here
 *
 * Coordinate system matches room3d.js:
 *   - Room centred on origin
 *   - x = width  (left ↔ right),    range -w/2 .. +w/2
 *   - y = height (floor ↔ ceiling), range -h/2 .. +h/2
 *   - z = length (front ↔ back),    range -l/2 .. +l/2
 *
 * Used by:
 *   - room3d.js Reflections overlay (animated speaker→wall→listener pulses)
 */

'use strict';

const SPEED_OF_SOUND_M_S = 343;

// Ordered so visualisations can stagger surfaces in a predictable rhythm.
// axis = which spatial axis the surface is perpendicular to.
// sign = which side of origin the surface sits on (-1 or +1).
const _SURFACES = [
    { id: 'floor',   axis: 'y', sign: -1 },
    { id: 'ceiling', axis: 'y', sign:  1 },
    { id: 'front',   axis: 'z', sign: -1 },
    { id: 'back',    axis: 'z', sign:  1 },
    { id: 'left',    axis: 'x', sign: -1 },
    { id: 'right',   axis: 'x', sign:  1 },
];

function _vec(p) {
    return { x: p.x ?? 0, y: p.y ?? 0, z: p.z ?? 0 };
}

function _dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ── Ceiling geometry (slanted / gable aware) ────────────────────────────────
// Authoritative ceiling-height + facet model for the image-source method.
// EXACT mirror of room3d.js rebuild()'s ceilingYAt() — same fields, same
// formulas — so the reflection plane coincides with the rendered roofline.
// Recognised room fields (all optional; default to a flat ceiling):
//   ceilingType : 'flat' | 'slanted' | 'gable'
//   ceilingLowH : eave / low-edge height in metres (sloped ceilings only)
//   slantDir    : 'left_to_right' | 'right_to_left' | 'front_to_back' | 'back_to_front'
//   gableAxis   : 'depth' (ridge runs along z) | 'width' (ridge runs along x)
function _ceilingYAt(room, x, z) {
    const halfW = room.w / 2;
    const halfL = room.l / 2;
    const highY = room.h / 2;
    const type = room.ceilingType || 'flat';
    if (type !== 'slanted' && type !== 'gable') return highY;

    const lowH = Math.min(room.ceilingLowH != null ? room.ceilingLowH : room.h, room.h);
    const lowY = -room.h / 2 + lowH;

    if (type === 'slanted') {
        const dir = room.slantDir || 'left_to_right';
        let t;
        switch (dir) {
            case 'left_to_right': t = (x + halfW) / room.w; break;
            case 'right_to_left': t = 1 - (x + halfW) / room.w; break;
            case 'front_to_back': t = 1 - (z + halfL) / room.l; break;
            case 'back_to_front': t = (z + halfL) / room.l; break;
            default:              t = (x + halfW) / room.w;
        }
        return lowY + t * (highY - lowY);
    }

    // gable: peak at the ridge (x=0 or z=0), eaves at the side walls
    const gableAxis = room.gableAxis || 'depth';
    const distRatio = gableAxis === 'depth' ? Math.abs(x) / halfW : Math.abs(z) / halfL;
    return highY - distRatio * (highY - lowY);
}

// Footprint partition of the ceiling into planar facets. Flat & slanted are a
// single facet spanning the whole footprint; a gable is two opposing facets
// split at the ridge (x=0 for a depth ridge, z=0 for a width ridge).
function _ceilingFacets(room) {
    const halfW = room.w / 2;
    const halfL = room.l / 2;
    if ((room.ceilingType || 'flat') === 'gable') {
        const axis = room.gableAxis || 'depth';
        if (axis === 'depth') {
            // ridge along z at x=0 → left and right pitched faces
            return [
                { xMin: -halfW, xMax: 0,     zMin: -halfL, zMax: halfL },
                { xMin: 0,      xMax: halfW, zMin: -halfL, zMax: halfL },
            ];
        }
        // ridge along x at z=0 → front and back pitched faces
        return [
            { xMin: -halfW, xMax: halfW, zMin: -halfL, zMax: 0     },
            { xMin: -halfW, xMax: halfW, zMin: 0,      zMax: halfL },
        ];
    }
    return [{ xMin: -halfW, xMax: halfW, zMin: -halfL, zMax: halfL }];
}

// Plane of one facet as a point A + unit normal n, derived from three corner
// samples of _ceilingYAt() so it cannot drift from the rendered ceiling.
function _facetPlane(room, f) {
    const p1 = { x: f.xMin, y: _ceilingYAt(room, f.xMin, f.zMin), z: f.zMin };
    const p2 = { x: f.xMax, y: _ceilingYAt(room, f.xMax, f.zMin), z: f.zMin };
    const p3 = { x: f.xMin, y: _ceilingYAt(room, f.xMin, f.zMax), z: f.zMax };
    const ux = p2.x - p1.x, uy = p2.y - p1.y, uz = p2.z - p1.z;
    const vx = p3.x - p1.x, vy = p3.y - p1.y, vz = p3.z - p1.z;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    return { A: p1, n: { x: nx / len, y: ny / len, z: nz / len } };
}

// General reflection of point P across the plane through A with unit normal n:
// P' = P - 2·((P-A)·n)·n.
function _reflectAcrossPlane(P, A, n) {
    const d = (P.x - A.x) * n.x + (P.y - A.y) * n.y + (P.z - A.z) * n.z;
    return { x: P.x - 2 * d * n.x, y: P.y - 2 * d * n.y, z: P.z - 2 * d * n.z };
}

/**
 * First-order ceiling reflection for a single source/listener pair, reflecting
 * across the ACTUAL ceiling facet plane(s). For a gable the two facets are
 * tried independently and the bounce is kept only on the facet whose own
 * footprint contains the reflection point (i.e. the facet the speaker→listener
 * path actually crosses); if the point falls past the ridge on one facet the
 * adjacent facet is used, and if neither yields a valid in-bounds hit the
 * ceiling bounce is dropped. Returns the bounce object or null.
 *
 * This is the SINGLE source of truth for the ceiling reflection point — any
 * future ceiling first-reflection marker should call it rather than assuming a
 * flat ceiling at room height.
 */
function ceilingBounce(speaker, listener, room) {
    const s = _vec(speaker);
    const l = _vec(listener);
    const halfW = room.w / 2;
    const halfL = room.l / 2;
    const directPathM = _dist(s, l);
    const eps = 1e-6;
    let best = null;

    for (const f of _ceilingFacets(room)) {
        const { A, n } = _facetPlane(room, f);
        // Mirror the source across this facet, then intersect the mirror→listener
        // line with the facet plane: P(t) = m + t·(l − m), solve (P − A)·n = 0.
        const m = _reflectAcrossPlane(s, A, n);
        const denom = (l.x - m.x) * n.x + (l.y - m.y) * n.y + (l.z - m.z) * n.z;
        if (Math.abs(denom) < 1e-12) continue;
        const t = ((A.x - m.x) * n.x + (A.y - m.y) * n.y + (A.z - m.z) * n.z) / denom;
        if (!isFinite(t) || t < 0 || t > 1) continue;

        const B = {
            x: m.x + t * (l.x - m.x),
            y: m.y + t * (l.y - m.y),
            z: m.z + t * (l.z - m.z),
        };
        // Bounce must land within THIS facet's footprint (and the room).
        if (B.x < f.xMin - eps || B.x > f.xMax + eps) continue;
        if (B.z < f.zMin - eps || B.z > f.zMax + eps) continue;
        if (Math.abs(B.x) > halfW + eps || Math.abs(B.z) > halfL + eps) continue;

        const totalPathM = _dist(s, B) + _dist(B, l);
        if (!best || totalPathM < best.totalPathM) {
            best = {
                surface: 'ceiling',
                bouncePoint: B,
                totalPathM,
                delayMs: ((totalPathM - directPathM) / SPEED_OF_SOUND_M_S) * 1000,
            };
        }
    }
    return best;
}

/**
 * Compute first-order reflection bounces for a single source/listener pair
 * inside a rectangular room.
 *
 * @param {{x:number,y:number,z:number}} speaker  – source position (m)
 * @param {{x:number,y:number,z:number}} listener – listener position (m)
 * @param {{w:number,l:number,h:number}} room     – room dimensions (m):
 *        w = width (x extent), l = length (z extent), h = height (y extent)
 *
 * @returns {Array<{
 *   surface:    'floor'|'ceiling'|'front'|'back'|'left'|'right',
 *   bouncePoint:{x:number,y:number,z:number},
 *   totalPathM: number,    // speaker → bouncePoint → listener distance
 *   delayMs:    number,    // (totalPathM - directPathM) / 343 * 1000
 * }>}
 *
 * Surfaces whose mirror→listener line crosses outside the room footprint
 * are excluded — those geometries don't produce a valid first-order bounce.
 * Result preserves the canonical surface order (floor, ceiling, front,
 * back, left, right) so callers can stagger them deterministically.
 */
function firstOrderBounces(speaker, listener, room) {
    const s = _vec(speaker);
    const l = _vec(listener);
    const halfW = room.w / 2;
    const halfL = room.l / 2;
    const halfH = room.h / 2;
    const directPathM = _dist(s, l);
    const out = [];

    for (const surf of _SURFACES) {
        // Ceiling: reflect across the real facet plane(s), which may be tilted
        // (slanted) or split at a ridge (gable). For a flat ceiling this returns
        // exactly the same point as the axis-aligned mirror below would.
        if (surf.id === 'ceiling') {
            const cb = ceilingBounce(s, l, room);
            if (cb) out.push(cb);
            continue;
        }

        const m = { x: s.x, y: s.y, z: s.z };
        let plane;

        // Mirror source across this surface; record the surface plane value.
        if (surf.axis === 'x') {
            plane = surf.sign * halfW;
            m.x = 2 * plane - s.x;
        } else if (surf.axis === 'y') {
            plane = surf.sign * halfH;
            m.y = 2 * plane - s.y;
        } else {
            plane = surf.sign * halfL;
            m.z = 2 * plane - s.z;
        }

        // Parametric line m → l: P(t) = m + t·(l − m).
        // Find t such that P hits the surface plane along its perpendicular axis.
        let t;
        if (surf.axis === 'x') t = (plane - m.x) / (l.x - m.x);
        else if (surf.axis === 'y') t = (plane - m.y) / (l.y - m.y);
        else t = (plane - m.z) / (l.z - m.z);

        // t outside [0, 1] means the surface is behind the listener relative
        // to the mirror image — no valid bounce.
        if (!isFinite(t) || t < 0 || t > 1) continue;

        const bx = m.x + t * (l.x - m.x);
        const by = m.y + t * (l.y - m.y);
        const bz = m.z + t * (l.z - m.z);

        // Bounce point must lie within the surface's planar bounds (i.e.
        // actually on the wall, not floating outside the room footprint).
        // The axis we mirrored across collapses to `plane` exactly; the
        // other two axes are checked against half-extents with epsilon.
        const eps = 1e-6;
        const inX = Math.abs(bx) <= halfW + eps;
        const inY = Math.abs(by) <= halfH + eps;
        const inZ = Math.abs(bz) <= halfL + eps;
        if (!inX || !inY || !inZ) continue;

        const bouncePoint = { x: bx, y: by, z: bz };
        const totalPathM = _dist(s, bouncePoint) + _dist(bouncePoint, l);
        const delayMs = ((totalPathM - directPathM) / SPEED_OF_SOUND_M_S) * 1000;

        out.push({ surface: surf.id, bouncePoint, totalPathM, delayMs });
    }

    return out;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { firstOrderBounces, ceilingBounce, ceilingYAt: _ceilingYAt };
} else if (typeof window !== 'undefined') {
    window.MeasurelyImageSource = { firstOrderBounces, ceilingBounce, ceilingYAt: _ceilingYAt };
}
