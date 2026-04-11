# Measurely Engine — CLAUDE.md

> Shared rules (no branches, Three.js philosophy, browser load order, module exports, CSS load order, copy rules) live in the root `CLAUDE.md`.

## What This Repo Is

The shared acoustic analysis engine and 3D room visualiser for the entire Measurely product family. Not a deployable app — a git submodule consumed by measurely-web and measurely-retail.

---

## What Lives Here

```
css/index.css                   ← Barrel import — one line for satellites to get everything
css/measurely-core.css          ← Design tokens — source of truth for all satellites (--mly-*)
css/components/buttons.css      ← Canonical .mly-btn-* button system
css/components/sliders.css      ← Canonical .measurely-slider, .measurely-switch, select.measurely-select

js/engine/
  fft.js                        ← Cooley-Tukey FFT
  signal_math.js                ← Frequency binning, smoothing, windowing
  acoustics.js                  ← Room modes, SBIR, Schroeder frequency (SOURCE OF TRUTH)
  fileLoader.js                 ← WAV → Float32Array
  analyse.js                    ← Master pipeline orchestrator
  score.js                      ← 6-metric scoring (0–10)
  signalIntegrityCard.js        ← Signal quality diagnostics UI card

js/room3d.js                    ← Three.js 3D room visualiser (ESM)
js/vendor/three/                ← Three.js UMD + OrbitControls + DragControls
js/speakers.js                  ← Static speaker catalogue (satellites can inject live SKUs)
index.js                        ← Node.js entry point
```

## What Does NOT Live Here

No HTML. No application CSS. No dashboard. No auth. No PocketBase. No Cloudflare Functions. All of those are satellite concerns.

---

## room3d.js Public API

```js
import { initRoom3D } from './engine/js/room3d.js';

const room3d = initRoom3D({
    mountId:     'canvasElementId',
    getRoomData: () => roomStateObject,
    mode:        'setup'  // 'setup' | 'locked' | 'analysing' | 'final'
});

room3d.update()
room3d.setStage(stage)        // 'speakers' | 'furnishings' | 'treatment'
room3d.focusIssue(type, secs) // 'sbir' | 'bandwidth' | 'side_reflections' etc.
room3d.startAutoSpin() / stopAutoSpin()
room3d.setWaves(bool)
```

Supports two room types via `room_type` in the data object: `'home'` and `'studio'`.

---

## Coding Standards

- Vanilla JS only. No frameworks, no bundler, no build step.
- Engine modules must be side-effect free — no DOM access inside core analysis logic.
- `room3d.js` may access the DOM (needs a canvas) but must remain self-contained.
- All modules use UMD — work in both Node.js (`module.exports`) and browser (`window.MeasurelyXXX`).
