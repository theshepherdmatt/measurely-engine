# @measurely/engine — Architecture Reference

> Updated: 2026-04-10 | Branch: `main`

---

## 1. Overview

`measurely-engine` is the **core mathematical and 3D visualization engine** (The Mothership) for the Measurely ecosystem. It is intended to be purely functional and client-side, exported as standard Javascript for consumption by multiple satellite projects (e.g. `measurely-web` and `measurely-retail`).

**Core Doctrine:**
- **No UI Side-Effects:** The engine must never render custom DOM elements, touch `document.body` or read from URLs, unless explicitly passed to it.
- **No Third-Party Bloat:** It relies strictly on `Three.js` for room visualization and pure Javascript for FFT arrays.
- **Single Source of Truth:** `acoustics.js` and `signal_math.js` define how room measurements are calculated. This prevents formulas drifting between the different app endpoints.

---

## 2. Module Map

```
js/
├── engine/                     ← Pure signal-processing pipeline
│   ├── fileLoader.js           — WAV parsing → Float32Array (Left Channel)
│   ├── fft.js                  — Fast Fourier Transform implementation
│   ├── signal_math.js          — Smoothing, logarithmic frequency binning
│   ├── acoustics.js            — SOURCE OF TRUTH: Room mode, Schroeder, SBIR math
│   ├── analyse.js              — Master pipeline wrapper (WAV array → scores)
│   ├── score.js                — Value normalisation (0–10 scale)
│   └── signalIntegrityCard.js  — Optional diagnostic output object generator
│
├── room3d.js                   ← Three.js 3D room engine (ESM, reusable)
├── speakers.js                 ← Base speaker catalog and profile definitions
│
└── vendor/
    └── three/                  ← Self-hosted core 3D dependencies
        ├── three.min.js        
        ├── three.module.js     
        ├── OrbitControls.js    
        └── DragControls.js     
```

---

## 3. Core Mechanics

### A. The Signal Pipeline (`analyze.js`)
When a satellite application receives audio from a user (or from the `measurely-remote` physical mic), it passes the pure `ArrayBuffer` into the engine:
1. `fileLoader.js`: Decodes the data into a standard `Float32Array`.
2. `fft.js`: Converts time-domain to complex frequency spectrum magnitudes.
3. `signal_math.js`: Cleans the spectrum (1/3 octave smoothing, noise trim).
4. `acoustics.js`: Cross-references signals with real-world dimensions (Modes, SBIR nulls).
5. `score.js`: Grades the result on a standardized 0-10 scale.

### B. The 3D Room Visualizer (`room3d.js`)
A headless Three.js wrapper that draws the room, places speakers, and paints acoustic overlays. The satellite application provides a mounting div and raw parameters:
```javascript
import { initRoom3D } from '@measurely/engine/room3d';

const api = initRoom3D({
  mountId: 'canvas-container-id', 
  getRoomData: () => myRoomState,  // Invoked on scene rebuild
  mode: 'setup' 
});
```

---

## 4. Usage Requirements

The engine expects to be consumed dynamically.
- In **Node environments**, `require('@measurely/engine')` pulls the whole suite via `index.js`.
- In **Browser environments**, scripts are loaded sequentially or via ES module imports (`import { analyse } from ...`).

### Example Integration
```javascript
// A satellite app (like measurely-web) passes generic data to the engine.
import { analyse } from '@measurely/engine/engine/analyse';
import { schroederFrequency } from '@measurely/engine/engine/acoustics';

const result = analyse(myFloat32Array, sampleRate);
const transitionHz = schroederFrequency(roomVolume, rt60);
```
