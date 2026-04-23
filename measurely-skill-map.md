# Measurely Autonomous Skill Map
> For AI agents (Claude, Gemini, etc.) making changes to Measurely.
> Updated: 2026-04-22

---

## 1. The Golden Rules

| Rule | Detail |
|---|---|
| **Monochrome controls** | All sidebar UI is white/zinc. Color exists ONLY in the 3D viewport. |
| **No raw HTML in satellites** | Use `SCL.renderXxxSection()`. Never write `<input>` or `<button>` by hand in app code. |
| **Engine is side-effect free** | `acoustics.js`, `analyse.js`, etc. never touch the DOM. |
| **REW is the source of truth** | All hardware strings, sample rate, and measurement data come from `http://localhost:4735`. |
| **Typography** | DM Sans / Inter via `var(--mly-font-family)`. Monospace only for data readouts. |

---

## 2. File → Responsibility Map

```
measurely-web/engine/
├── js/engine/
│   ├── acoustics.js          ← ALL physics math (SBIR null Hz, room modes, Schroeder)
│   ├── analyse.js            ← Pipeline: Float32Array → scores object
│   ├── score.js              ← Normalises raw metrics to 0–10
│   ├── fft.js                ← Cooley-Tukey FFT (do not modify)
│   ├── signal_math.js        ← 1/3-oct smoothing, frequency binning
│   └── fileLoader.js         ← WAV ArrayBuffer → Float32Array
│
├── js/room3d.js              ← THREE.js 3D engine — SBIR shader, overlays, wave rings
├── js/sidebar-component-library.js  ← SCL — generates all sidebar controls
└── js/speakers.js            ← Speaker catalogue and profiles
```

**Satellite app:**
```
measurely-web/demo.html       ← Single source of truth for the demo UI
  └── <script type="module"> ← All wiring lives here (demoState, SCL calls, update3D)
```

---

## 3. The REW Bridge → Visual Pipeline

### Step 1: Handshake
```
GET http://localhost:4735/application/version
→ { version: "5.40.0" }   ← 200 OK = REW is live
```

### Step 2: Hardware Recognition
```
GET http://localhost:4735/audio/settings
→ { inputDeviceName, outputDeviceName, sampleRate, bitDepth }
```
Map directly to UI:
- `inputDeviceName`  → mic chip label
- `outputDeviceName` → output chip label
- `sampleRate`       → shown in sweep settings

### Step 3: Trigger Sweep
```
POST http://localhost:4735/measure/sweep
Body: { startFreq: 20, endFreq: 20000, level: -12 }

POST http://localhost:4735/measure/stop   ← abort if needed
```

### Step 4: Ingest Measurements
```
GET http://localhost:4735/measurements
→ [ { title, uuid, spls: [ { hz, db } ] }, ... ]
```
The `spls` array is the frequency response. Pass it into the engine:
```js
// Float32Array path is for WAV files.
// For REW JSON, use the acoustic math directly:
import { computeSbir, computeRoomModes } from './engine/js/engine/acoustics.js';

const sbir  = computeSbir(demoState.geometry);   // → { front_wall: { null_hz, distance_m } }
const modes = computeRoomModes(demoState.geometry); // → [ { freq, type, axes }, ... ]
```

### Step 5: Autonomously Trigger 3D Visuals
```js
// SBIR visual — always driven by spk_front_m, NOT by REW data
// The shader computes k = π / (2 × spk_front_m) internally in room3d.js.
// You only need to activate the overlay:
demo3D.focusIssue('sbir', 5);   // activates SBIR overlay + 5-sec camera focus

// If REW shows a massive peak at e.g. 70 Hz → check if it matches a room mode:
const nullHz = 340 / (4 * demoState.setup.spk_front_m);  // first SBIR null
if (Math.abs(rewPeakHz - nullHz) < 10) {
    demo3D.focusIssue('sbir', 8);
    // The engine spawns a Teal "treated" or Pink "untreated" null indicator automatically
}

// Bass modes → bandwidth overlay
demo3D.focusIssue('bandwidth', 5);

// Side reflections
demo3D.focusIssue('side_reflections', 5);
```

---

## 4. Physics Cheat Sheet

| Formula | What it means | Lives in |
|---|---|---|
| `k = π / (2 × d)` | Wave number for SBIR null at distance `d` | `room3d.js` SBIR shader (`uK`) |
| `f₀ = 340 / (4 × d)` | First SBIR null frequency in Hz | `acoustics.js → computeSbir()` |
| `fₙ = (n × 340) / (2 × L)` | Axial room mode `n` along dimension `L` | `acoustics.js → computeRoomModes()` |
| `fₛ = 2000 × √(T60 / V)` | Schroeder transition frequency | `acoustics.js → computeRoomGeometry()` |

**SBIR severity thresholds (used by room3d.js to pick pink vs teal):**
- `spk_front_m < 0.35 m` → severe (effectiveScore < 5 → Pink `#FF107A`)
- `spk_front_m > 0.55 m` → mild (effectiveScore ≥ 5 → Teal `#00F5FF`)
- `hasFrontPanels || hasBassTraps` → `sbirTreated = true` → `+1.8` score boost → rings turn cyan

---

## 5. SCL Control API

The Sidebar Component Library (SCL) renders all controls. **Never write raw HTML controls.**

```js
import SCL from './engine/js/sidebar-component-library.js';

// Room dimensions + type
SCL.renderRoomSection('mountId', { state, onChange });
SCL.renderCeilingSection('mountId', { state, onChange });

// Speakers, furniture, floor
SCL.renderSpeakersSection('mountId', { state, roomType: 'home'|'studio', onChange });
SCL.renderFurnitureSection('mountId', { state, roomType, onChange });
SCL.renderFloorSection('mountId', { state, onChange });

// Treatment (types + colour picker)
SCL.renderTreatmentSection('mountId', {
    types: ['bass_trap','wall_panel','side_panel','ceiling_panel'],
    state: { bass_trap_mode: 'none', ... },
    defaultColour: '#1A1714',
    onTreatmentChange(newState) { update3D(); },
    onColourChange(hex) { demoState.panel_color = hex; update3D(); },
});

// Analysis overlay toggles
SCL.renderAnalysisOverlaySection('mountId', { overlays, onOverlayChange });
```

Each `onChange` receives the updated state slice. Merge into `demoState` and call `update3D()`.

---

## 6. room3d.js Public API

```js
import { initRoom3D } from './engine/js/room3d.js';

const demo3D = initRoom3D({
    mountId:     'canvasId',
    getRoomData: () => demoState,   // called on every rebuild
    mode:        'setup',            // 'setup' | 'locked' | 'analysing' | 'final'
});

demo3D.update()                  // Rebuild the scene from getRoomData()
demo3D.focusIssue(type, secs)   // 'sbir' | 'bandwidth' | 'side_reflections' | 'ceiling'
demo3D.setStage(stage)           // 'speakers' | 'furnishings' | 'treatment'
demo3D.setWaves(bool)            // Show/hide acoustic wave rings
demo3D.setSbirField(bool)        // Show/hide SBIR heatmap independently of rings
demo3D.startAutoSpin()
demo3D.stopAutoSpin()
```

**getRoomData() must return this shape (minimum):**
```js
{
    // Geometry
    width_m, length_m, height_m,
    ceiling_type,                  // 'flat' | 'slanted' | 'gable'

    // Speaker setup
    speaker_type,                  // 'standmount' | 'floorstander' | 'statement' | 'panel'
    spk_front_m,                   // distance from front wall → drives SBIR shader uK
    spk_spacing_m,
    tweeter_height_m,
    toe_in_deg,
    listener_front_m,
    listener_offset_m,
    subwoofer: bool,
    subwoofer_dual: bool,

    // Treatment — each drives real geometry + overlay absorption
    bass_trap_mode:     'none' | 'front' | 'rear' | 'all',
    wall_panel_mode:    'none' | 'front' | 'rear' | 'both',
    side_panel_mode:    'none' | 'left'  | 'right' | 'both',
    ceiling_panel_mode: 'none' | 'full',
    panel_color:        '#hexstring',

    // Furniture
    opt_sofa, opt_area_rug, opt_coffee_table,   // booleans
    opt_ottoman, opt_display, opt_mic,           // booleans

    // Overlay state
    activeOverlay: 'sbir' | 'bandwidth' | 'side_reflections' | 'none',
    simulatePanels: bool,          // Preview-All ghost mode
}
```

---

## 7. Colour System (Viewport Only)

| Colour | Hex | When used |
|---|---|---|
| Neon Pink | `#FF107A` | SBIR interference nodes (untreated), wave rings (untreated) |
| Teal / Cyan | `#0D9488` / `#00F5FF` | Treated state, wave rings (treated), active UI toggles |
| Purple | `#7C3AED` | Analysis/Insight section headers, listening position slider |
| Amber | `#B45309` | Treatment tab accent |
| Front-wall glow | `#00B8A9` | Wall glow in SBIR overlay |
| Reflection paths | `#d4950f` | Side reflection path lines |
| Ceiling reflection | `#6366f1` | Untreated ceiling bounce path |

---

## 8. Autonomous Visual Trigger Map

Given a REW measurement, this is how to map findings to visual outputs:

| REW finding | Physics check | 3D trigger |
|---|---|---|
| Big peak at ~70 Hz | `f₀ = 340/(4×d)` — matches SBIR null? | `demo3D.focusIssue('sbir', 8)` |
| Peaks at 2× and 3× of same base freq | Room mode (axial) | `demo3D.focusIssue('bandwidth', 5)` |
| Comb-filter notch above 500 Hz | Early reflection — check `listener_front_m` | `demo3D.focusIssue('side_reflections', 5)` |
| Flutter decay (RT60 spiky) | Parallel surfaces — ceiling/floor | `demo3D.focusIssue('ceiling', 5)` |
| Flat response (score > 7) | All good | No overlay — stay in `'none'` mode |

---

## 9. demoState Shape (demo.html source of truth)

```js
const demoState = {
    room_type: 'home' | 'studio',
    geometry:  { width_m, length_m, height_m, ceiling_type, ... },
    setup:     { speaker_type, spk_front_m, spk_spacing_m, ... },
    environment: {
        furniture: { opt_sofa, opt_area_rug, ... },
        treatment: { bass_trap_mode, wall_panel_mode, ... },
        floor:     { material: 'hardwood' | 'carpet' | ... },
    },
    panel_color:     '#1A1714',
    sweetSpotFactor: 0.0–1.0,   // computed by computeConstructivePhase()
};
```

Any change → `update3D()` → scene rebuilds via `getRoomData = () => demoState`.
