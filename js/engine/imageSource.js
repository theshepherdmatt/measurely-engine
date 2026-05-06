/**
 * imageSource.js — first-order image-source method for a rectangular room.
 *
 * Image-source method: for each of the six bounding surfaces, mirror the
 * source position across that surface; the line from the mirror image to
 * the listener crosses the surface at the geometric bounce point. If the
 * bounce point lies within the surface bounds, the reflection is valid.
 *
 * Limitations:
 *   - First-order only (no multi-bounce / late-tail paths)
 *   - Assumes a rectangular, axis-aligned room (no slanted ceilings,
 *     no non-orthogonal walls, no diffusion)
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
    module.exports = { firstOrderBounces };
} else if (typeof window !== 'undefined') {
    window.MeasurelyImageSource = { firstOrderBounces };
}
