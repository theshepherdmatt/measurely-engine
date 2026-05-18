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
    const out = {
        floor:     FLOOR_ID,
        ceiling:   DRYWALL_ID,
        frontWall: DRYWALL_ID,
        backWall:  DRYWALL_ID,
        leftWall:  DRYWALL_ID,
        rightWall: DRYWALL_ID,
    };

    const T = _treatmentsModule();
    const profiles = (T && T.TREATMENT_PROFILES) || {};
    const wallId = profiles.wall_panel    && profiles.wall_panel.materialId    || null;
    const sideId = profiles.side_panel    && profiles.side_panel.materialId    || null;
    const ceilId = profiles.ceiling_panel && profiles.ceiling_panel.materialId || null;

    const t = _extractTreatment(demoState);

    if (wallId) {
        if (t.wall_panel_mode === 'front' || t.wall_panel_mode === 'both') out.frontWall = wallId;
        if (t.wall_panel_mode === 'rear'  || t.wall_panel_mode === 'both') out.backWall  = wallId;
    }
    if (sideId) {
        if (t.side_panel_mode === 'left'  || t.side_panel_mode === 'both') out.leftWall  = sideId;
        if (t.side_panel_mode === 'right' || t.side_panel_mode === 'both') out.rightWall = sideId;
    }
    if (ceilId) {
        // TODO: 'cloud' is acoustically an air-gap mount (≈ ASTM E-mount)
        // and 'flush' is a direct-attach mount (≈ A/B). They should resolve
        // to different mounted variants of the same product. For this first
        // cut both collapse to the same ceiling-panel materialId.
        if (t.ceiling_panel_mode === 'cloud' || t.ceiling_panel_mode === 'flush') {
            out.ceiling = ceilId;
        }
    }
    // TODO: bass_trap_mode is intentionally ignored in this first cut.
    // Corner bass traps add absorption area beyond a flat-surface S·α model
    // (a "J-mount" Sabin-per-unit term), which predictRT60 does not yet
    // expose. The retail UI also hides this toggle today.

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
        if (a.floor     !== 'hardwood-floor')   fail('(1) floor = '     + a.floor);
        if (a.ceiling   !== 'painted-drywall')  fail('(1) ceiling = '   + a.ceiling);
        if (a.frontWall !== 'painted-drywall')  fail('(1) frontWall = ' + a.frontWall);
        if (a.backWall  !== 'painted-drywall')  fail('(1) backWall = '  + a.backWall);
        if (a.leftWall  !== 'painted-drywall')  fail('(1) leftWall = '  + a.leftWall);
        if (a.rightWall !== 'painted-drywall')  fail('(1) rightWall = ' + a.rightWall);
        if (failures === 0) pass('(1) untreated demoState → drywall walls+ceiling, hardwood floor');
    }

    // (2) wall_panel_mode 'both' → frontWall + backWall = WALL_ID; sides + ceiling untouched.
    {
        const before = failures;
        const b = getRoomSurfaceMaterials({
            ...baseDemo,
            environment: { treatment: { ...untreatedTreat, wall_panel_mode: 'both' } },
        });
        if (b.frontWall !== WALL_ID)           fail('(2) frontWall = ' + b.frontWall + ' (expected ' + WALL_ID + ')');
        if (b.backWall  !== WALL_ID)           fail('(2) backWall = '  + b.backWall  + ' (expected ' + WALL_ID + ')');
        if (b.leftWall  !== 'painted-drywall') fail('(2) leftWall = '  + b.leftWall);
        if (b.rightWall !== 'painted-drywall') fail('(2) rightWall = ' + b.rightWall);
        if (b.ceiling   !== 'painted-drywall') fail('(2) ceiling = '   + b.ceiling);
        if (failures === before) pass('(2) wall_panel_mode=both → front+back = ' + WALL_ID + '; sides+ceiling untouched');
    }

    // (3) side_panel_mode 'left' → leftWall = SIDE_ID; rightWall stays drywall.
    {
        const before = failures;
        const c = getRoomSurfaceMaterials({
            ...baseDemo,
            environment: { treatment: { ...untreatedTreat, side_panel_mode: 'left' } },
        });
        if (c.leftWall  !== SIDE_ID)           fail('(3) leftWall = '  + c.leftWall + ' (expected ' + SIDE_ID + ')');
        if (c.rightWall !== 'painted-drywall') fail('(3) rightWall = ' + c.rightWall);
        if (failures === before) pass('(3) side_panel_mode=left → leftWall = ' + SIDE_ID + '; rightWall stays drywall');
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
