// ---------------------------------------------------------------------------
// Surface-materials bridge — maps room treatment state to a per-surface
// material assignment usable by predictRT60.
//
// Predictive model: not a physical measurement.
//
// The retail / web treatment state is grouped-zone (wall_panel_mode =
// 'front'|'rear'|'both', side_panel_mode = 'left'|'right'|'both', etc.),
// not free per-surface. This module collapses that grouped state into the
// six-surface schema { floor, ceiling, frontWall, backWall, leftWall,
// rightWall } that predictRT60 consumes, using the materialId currently
// pinned on each TREATMENT_PROFILES archetype.
//
// This module lives between treatments.js and acoustics.js. It keeps
// materials/index.js pure (DB-only); the treatment ↔ surface ↔ material
// graph is reified here.
// ---------------------------------------------------------------------------

'use strict';

const DRYWALL_ID = 'painted-drywall';
const FLOOR_ID   = 'hardwood-floor';
// TODO: floor material should be room-type / floor_material-aware once a
// floor selector exists in either UI (retail or web). Today there is no
// such selector and hardwood is the canonical "home listening room" default.

// Lazy-resolve the treatments module — Node via require, browser via
// window.MeasurelyTreatments. Same pattern as
// treatments.js _materialsModule() and acoustics.js _materialsModule().
let _treatmentsCached = null;
function _treatmentsModule() {
    if (_treatmentsCached) return _treatmentsCached;
    if (typeof require !== 'undefined') {
        try {
            _treatmentsCached = require('../treatments.js');
            return _treatmentsCached;
        } catch (_) { /* fall through to browser path */ }
    }
    if (typeof window !== 'undefined' && window.MeasurelyTreatments) {
        _treatmentsCached = window.MeasurelyTreatments;
        return _treatmentsCached;
    }
    return null;
}

// The retail demoState nests treatment under environment; the engine's
// internal room shape (and some test fixtures) puts it at top-level.
// Both shapes are accepted.
function _extractTreatment(demoState) {
    if (!demoState) return {};
    if (demoState.environment && typeof demoState.environment === 'object'
        && demoState.environment.treatment) {
        return demoState.environment.treatment;
    }
    if (demoState.treatment && typeof demoState.treatment === 'object') {
        return demoState.treatment;
    }
    return demoState; // assume keys are at top level
}

function getRoomSurfaceMaterials(demoState) {
    const T = _treatmentsModule();
    const profiles = (T && T.TREATMENT_PROFILES) || {};
    const wallId = profiles.wall_panel    && profiles.wall_panel.materialId    || null;
    const sideId = profiles.side_panel    && profiles.side_panel.materialId    || null;
    const ceilId = profiles.ceiling_panel && profiles.ceiling_panel.materialId || null;
    const bassId = profiles.bass_trap     && profiles.bass_trap.materialId     || null;

    const t = _extractTreatment(demoState);

    const L = (demoState && demoState.geometry && demoState.geometry.length_m) || 5;
    const W = (demoState && demoState.geometry && demoState.geometry.width_m) || 4;
    const H = (demoState && demoState.geometry && demoState.geometry.height_m) || 3;
    const spkSpacing = (demoState && demoState.setup && demoState.setup.spk_spacing_m) || 1.2;

    const out = {
        floor:     [{ id: FLOOR_ID, area: L * W }],
        ceiling:   [{ id: DRYWALL_ID, area: L * W }],
        frontWall: [{ id: DRYWALL_ID, area: W * H }],
        backWall:  [{ id: DRYWALL_ID, area: W * H }],
        leftWall:  [{ id: DRYWALL_ID, area: L * H }],
        rightWall: [{ id: DRYWALL_ID, area: L * H }],
    };

    function addTreatment(surface, id, area) {
        if (!id) return;
        let base = out[surface].find(p => p.id === DRYWALL_ID);
        if (base) {
            base.area = Math.max(0, base.area - area);
        }
        out[surface].push({ id, area });
    }

    // Front Wall / Rear Wall
    if (wallId) {
        const legacyWall = t.wall_panel_mode && t.wall_panel_mode !== 'none';
        const fwOn = (t.front_wall_mode === 'on') || (legacyWall && (t.wall_panel_mode === 'front' || t.wall_panel_mode === 'both'));
        const rwOn = (t.rear_wall_mode === 'on') || (legacyWall && (t.wall_panel_mode === 'rear' || t.wall_panel_mode === 'both'));

        if (fwOn) {
            const count = t.front_wall_count || t.wall_panel_count || 4;
            addTreatment('frontWall', wallId, count * (0.6 * 1.2));
        }
        if (rwOn) {
            const count = t.rear_wall_count || t.wall_panel_count || 4;
            addTreatment('backWall', wallId, count * (0.6 * 1.2));
        }
    }

    // Side Walls
    if (sideId) {
        const legacySide = t.side_panel_mode && t.side_panel_mode !== 'none';
        const lOn = (t.side_wall_mode === 'left' || t.side_wall_mode === 'both') || (legacySide && (t.side_panel_mode === 'left' || t.side_panel_mode === 'both'));
        const rOn = (t.side_wall_mode === 'right' || t.side_wall_mode === 'both') || (legacySide && (t.side_panel_mode === 'right' || t.side_panel_mode === 'both'));
        const countPerSide = t.side_wall_count || 1;
        const area = countPerSide * (0.6 * 1.2);
        
        if (lOn) addTreatment('leftWall', sideId, area);
        if (rOn) addTreatment('rightWall', sideId, area);
    }

    // Ceiling
    if (ceilId) {
        const cOn = (t.ceiling_mode === 'cloud' || t.ceiling_mode === 'flush' || t.ceiling_mode === 'on') || 
                    (t.ceiling_panel_mode === 'cloud' || t.ceiling_panel_mode === 'flush');
        if (cOn) {
            const cpW = Math.min(spkSpacing * 1.6, W * 0.8);
            const cpL = L * 0.28;
            addTreatment('ceiling', ceilId, cpW * cpL);
        }
    }

    // Bass Traps
    if (bassId) {
        const legacyBass = t.bass_trap_mode && t.bass_trap_mode !== 'none';
        const frontBassOn = (t.front_corners_mode && t.front_corners_mode !== 'none') || (legacyBass && (t.bass_trap_mode === 'front' || t.bass_trap_mode === 'all'));
        const rearBassOn = (t.rear_corners_mode && t.rear_corners_mode !== 'none') || (legacyBass && (t.bass_trap_mode === 'rear' || t.bass_trap_mode === 'all'));
        
        const hypotenuse = Math.sqrt(0.42 * 0.42 + 0.42 * 0.42);
        const trapHeight = H * 0.75;
        const areaPerTrap = hypotenuse * trapHeight;
        
        if (frontBassOn) addTreatment('frontWall', bassId, areaPerTrap * 2);
        if (rearBassOn)  addTreatment('backWall', bassId, areaPerTrap * 2);
    }

    return out;
}

// ---------------------------------------------------------------------------
// Exports — placed BEFORE the inline regression so that when the regression
// block requires acoustics.js (whose analyseRoom lazy-requires THIS module
// back), the cached exports are already populated and the cycle resolves.
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getRoomSurfaceMaterials };
} else if (typeof window !== 'undefined') {
    window.MeasurelySurfaces = { getRoomSurfaceMaterials };
}

// ---------------------------------------------------------------------------
// Inline regression (run with `node js/engine/materials/surfaces.js`)
// ---------------------------------------------------------------------------
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    /* eslint-disable */
    let failures = 0;
    const fail = (m) => { console.error('[FAIL] ' + m); failures++; };
    const pass = (m) => { console.log ('[pass] ' + m); };

    const T = require('../treatments.js');
    const WALL_ID = T.TREATMENT_PROFILES.wall_panel.materialId;
    const SIDE_ID = T.TREATMENT_PROFILES.side_panel.materialId;
    const CEIL_ID = T.TREATMENT_PROFILES.ceiling_panel.materialId;

    const untreatedTreat = {
        wall_panel_mode: 'none', side_panel_mode: 'none',
        bass_trap_mode:  'none', ceiling_panel_mode: 'none',
    };
    const baseDemo = {
        room_type: 'home',
        geometry: { length_m: 5, width_m: 4, height_m: 3, ceiling_type: 'flat' },
        setup:    {},
        environment: { treatment: { ...untreatedTreat } },
    };

    // (1) Untreated demoState → drywall walls/ceiling, hardwood floor.
    {
        const a = getRoomSurfaceMaterials(baseDemo);
        if (a.floor[0].id     !== 'hardwood-floor')   fail('(1) floor = '     + a.floor[0].id);
        if (a.ceiling[0].id   !== 'painted-drywall')  fail('(1) ceiling = '   + a.ceiling[0].id);
        if (a.frontWall[0].id !== 'painted-drywall')  fail('(1) frontWall = ' + a.frontWall[0].id);
        if (a.backWall[0].id  !== 'painted-drywall')  fail('(1) backWall = '  + a.backWall[0].id);
        if (a.leftWall[0].id  !== 'painted-drywall')  fail('(1) leftWall = '  + a.leftWall[0].id);
        if (a.rightWall[0].id !== 'painted-drywall')  fail('(1) rightWall = ' + a.rightWall[0].id);
        if (failures === 0) pass('(1) untreated demoState → drywall walls+ceiling, hardwood floor');
    }

    // (2) wall_panel_mode 'both' → frontWall + backWall = WALL_ID; sides + ceiling untouched.
    {
        const before = failures;
        const b = getRoomSurfaceMaterials({
            ...baseDemo,
            environment: { treatment: { ...untreatedTreat, wall_panel_mode: 'both', wall_panel_count: 4 } },
        });
        if (!b.frontWall.find(p => p.id === WALL_ID)) fail('(2) frontWall missing ' + WALL_ID);
        if (!b.backWall.find(p => p.id === WALL_ID))  fail('(2) backWall missing ' + WALL_ID);
        if (b.leftWall[0].id  !== 'painted-drywall') fail('(2) leftWall = '  + b.leftWall[0].id);
        if (b.rightWall[0].id !== 'painted-drywall') fail('(2) rightWall = ' + b.rightWall[0].id);
        if (b.ceiling[0].id   !== 'painted-drywall') fail('(2) ceiling = '   + b.ceiling[0].id);
        if (failures === before) pass('(2) wall_panel_mode=both → front+back has ' + WALL_ID + '; sides+ceiling untouched');
    }

    // (3) side_panel_mode 'left' → leftWall has SIDE_ID; rightWall stays drywall.
    {
        const before = failures;
        const c = getRoomSurfaceMaterials({
            ...baseDemo,
            environment: { treatment: { ...untreatedTreat, side_panel_mode: 'left' } },
        });
        if (!c.leftWall.find(p => p.id === SIDE_ID))   fail('(3) leftWall missing ' + SIDE_ID);
        if (c.rightWall[0].id !== 'painted-drywall') fail('(3) rightWall = ' + c.rightWall[0].id);
        if (failures === before) pass('(3) side_panel_mode=left → leftWall has ' + SIDE_ID + '; rightWall stays drywall');
    }

    // (4) analyseRoom on untreated 5×4×3 → rt60 with all six bands finite > 0.
    const A = require('../acoustics.js');
    const r1 = A.analyseRoom(baseDemo);
    {
        const before = failures;
        if (!r1.rt60) {
            fail('(4) analyseRoom() returned no rt60 field on untreated room');
        } else {
            for (const f of [125, 250, 500, 1000, 2000, 4000]) {
                const v = r1.rt60[String(f)];
                if (!(Number.isFinite(v) && v > 0)) {
                    fail('(4) rt60[' + f + '] = ' + v + ' (expected finite > 0)');
                }
            }
        }
        if (failures === before) pass('(4) analyseRoom untreated 5×4×3 → rt60 has 6 bands, all finite > 0');
    }

    // (5) wall_panel_mode 'both' → rt60(1 kHz) < untreated rt60(1 kHz).
    const r2 = A.analyseRoom({
        ...baseDemo,
        environment: { treatment: { ...untreatedTreat, wall_panel_mode: 'both' } },
    });
    {
        if (!r1.rt60 || !r2.rt60) {
            fail('(5) rt60 missing on one of the two analyses');
        } else {
            const tU = r1.rt60['1000'];
            const tT = r2.rt60['1000'];
            if (!(Number.isFinite(tU) && Number.isFinite(tT) && tT < tU)) {
                fail('(5) wall_panel=both did not lower rt60(1000 Hz): untreated ' + tU + ' → treated ' + tT);
            } else {
                pass('(5) rt60(1000) untreated ' + tU.toFixed(3) + 's → wall_panel=both ' + tT.toFixed(3) + 's');
            }
        }
    }

    if (failures > 0) {
        console.error('\n' + failures + ' regression failure(s)');
        process.exit(1);
    } else {
        console.log('\nSurface-materials bridge + analyseRoom rt60 integration ✓');
    }
}
