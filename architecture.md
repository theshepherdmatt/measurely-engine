# Measurely — Architecture Reference

> Generated: 2026-03-16 | Branch: `gh-pages`

---

## 1. Overview

Measurely is a **fully client-side, static web app** deployed on GitHub Pages. There is no server-side processing. All acoustic analysis runs in the browser. Optional cloud sync (rooms + sessions) is handled by a hosted PocketBase instance.

---

## 2. Page Map

| Page | Purpose |
|---|---|
| `index.html` | Marketing landing page + spinning 3D preview |
| `app.html` | Main upload + analysis dashboard |
| `onboarding.html` | First-run room setup wizard |
| `myroom.html` | Edit existing room configuration |
| `demo.html` | Fully interactive 3D sandbox demo |
| `simulate.html` | Acoustic simulation / prediction tool |
| `diagnose.html` | Diagnostic / debug page |
| `report-template.html` | Shareable analysis report layout |

---

## 3. JavaScript Module Map

```
js/
├── engine/                     ← Pure signal-processing (no DOM)
│   ├── fileLoader.js           — WAV parsing → Float32Array
│   ├── fft.js                  — FFT implementation
│   ├── signal_math.js          — Smoothing, octave binning, SBIR maths
│   ├── acoustics.js            — Room mode, Schroeder, SBIR calculations
│   ├── analyse.js              — Master analysis pipeline (WAV → scores)
│   └── score.js                — Score normalisation (0–10)
│
├── room3d.js                   ← Three.js 3D room engine (ESM, reusable)
├── dashboard.js                ← App page: file upload, chart render, session history
├── sync.js                     ← PocketBase cloud sync (IIFE, window.MeasurelySync)
├── auth.js                     ← PocketBase auth (login/register/logout)
├── profile.js                  ← Profile page (gear list, genres, avatar)
├── sessions.js                 ← Session history management
├── uiController.js             ← Shared UI state helpers
├── UIFactory.js                ← Card / panel component builders
├── davePhraseEngine.js         ← Co-Pilot plain-English commentary generator
├── cinematicEngine.js          ← Cinematic camera fly-through sequences
├── room.js                     ← Room data read/write helpers
├── speakers.js                 ← Speaker profile definitions (standmount, floorstander, etc.)
├── toast.js                    ← Toast notification utility
├── share-report.js             ← Report sharing logic
│
├── dashboard-tour.js           ← Intro.js guided tour for dashboard
├── dashboard-guide.js          ← Contextual guide hints for dashboard
├── onboarding-tour.js          ← Intro.js guided tour for onboarding
├── onboarding-guide.js         ← Contextual guide hints for onboarding
├── section-intro.js            ← Section header intro animations
├── tour.js                     ← Base tour utilities
│
└── vendor/
    └── three/
        ├── three.min.js        — Three.js UMD (script tag, legacy fallback)
        ├── three.module.js     — ESM bridge re-exporting globalThis.THREE
        ├── OrbitControls.js    — Camera orbit (appended to THREE namespace)
        └── DragControls.js     — Drag interaction (speakers in setup mode)
```

---

## 4. Data Flow: WAV Upload → Score

```
User drops WAV
      │
      ▼
engine/fileLoader.js
  └─ Reads ArrayBuffer → decodes to Float32Array (left channel)
      │
      ▼
engine/fft.js
  └─ FFT → complex spectrum → magnitude array
      │
      ▼
engine/signal_math.js
  └─ Log-frequency binning, 1/3 octave smoothing, noise floor trim
      │
      ▼
engine/acoustics.js
  └─ Room modes (from localStorage room geometry)
     SBIR prediction (speaker-to-front-wall distance)
     Schroeder frequency (2000 × √(0.161/V))
      │
      ▼
engine/analyse.js
  └─ Combines signal + acoustics context
     Builds report object: { freqs[], mags[], peaks, dips, room_modes, sbir_null, schroeder_freq }
      │
      ▼
engine/score.js
  └─ Converts analysis → 6 scores (1–10): peaks_dips, reflections, bandwidth, balance, smoothness, clarity
      │
      ▼
dashboard.js
  ├─ Renders Plotly frequency-response chart (lazy-loaded, 3.5 MB)
  ├─ Renders score cards (1–10)
  ├─ Calls davePhraseEngine.js → plain-English Co-Pilot commentary
  ├─ Stores session to localStorage (measurely_sessions)
  └─ If authenticated → sync.js pushSession() → PocketBase
```

---

## 5. 3D Room Engine (`room3d.js`)

### Instantiation
```js
const api = initRoom3D({
  mountId:     'canvas-container-id',
  getRoomData: () => roomStateObject,   // called on every rebuild()
  mode:        'setup' | 'locked' | 'analysing' | 'final'
});
```

### Render Stages (progressive disclosure)
| Stage | What's visible |
|---|---|
| `room` | Wireframe shell only |
| `speakers` | + Speaker meshes + beam lines |
| `furnishings` | + Furniture (rug, sofa, coffee table / desk, chair) |
| `treatment` | + Acoustic treatment panels |

### Ceiling Types
`flat` · `slanted` (4 directions) · `gable` (depth or width axis)

### Acoustic Overlays
Each overlay is toggled via `api.setOverlay(id, true/false)` and renders colour-coded geometry on top of the base scene:

| Overlay ID | Visual | Acoustic meaning |
|---|---|---|
| `sbir` | Coloured arc from speaker to front wall | SBIR cancellation prediction |
| `side_reflections` | Ray lines from speakers to side walls | First reflection points |
| `floor_reflection` | Ray to floor | Floor bounce path |
| `rear_energy` | Ray to rear wall | Rear-wall energy accumulation |
| `coffee_table` | Highlight on table geometry | Diffraction / secondary reflection |
| `bandwidth` | Floor-level plane | Sub-Schroeder modal region |
| `clarity` | Radial glow at listener | RT60 / clarity indicator |
| `balance` | Gradient fill | Tonal tilt visualisation |
| `smoothness` | Particle scatter | Roughness / comb filtering |

### Modes
| Mode | Behaviour |
|---|---|
| `setup` | Speakers are draggable; auto-toe-in tracks listener sphere in real time |
| `locked` | All interaction disabled; low-opacity display |
| `analysing` | Pulsing colour state; overlays animate |
| `final` | High-opacity, full-colour result state |

### Device Adaptation
- **Desktop**: `LineSegments` + `LineBasicMaterial` (fast, GPU-accelerated)
- **Tablet/Mobile** (`< 900 px`): mesh tube geometry per edge (reliable pixel-width at high DPR)
- Pixel ratio capped at `2×` to protect mobile GPU budget

### Auto-Toe-In
Every animation frame, both speaker meshes are rotated to face the listener sphere using `atan2(dx, dz)`. The dashed beam geometry endpoint is updated live in the same pass.

---

## 6. Cloud Sync (`sync.js`)

All sync is **opt-in** (requires authenticated PocketBase session). The module is an IIFE that exposes `window.MeasurelySync`.

### PocketBase Collections
| Collection | Fields | Notes |
|---|---|---|
| `rooms` | `user`, `dimensions`, `speaker_pos`, `treatment` | One record per user; upserted on push |
| `sessions` | `user`, `session_id`, `label`, `timestamp`, scores (×7), `analysis`, `report_curve`, `room_modes`, `schroeder_freq`, `sbir_null`, `scores` | Up to 50 cloud, 20 hydrated to localStorage |
| `users` | `gear_list`, `genres`, `public_profile`, `avatar` | PocketBase native users collection |

### Sync Protocol
- **Filter syntax**: `_f('user', userId)` → `user = 'id'` (PocketBase single-quote, space-padded — critical for query compatibility)
- **`requestKey: null`** on all queries to disable PocketBase auto-cancellation
- **pushRoom**: upsert single room record
- **pullRoom**: fetch → normalise → write to `localStorage`
- **pushSession**: 500 ms debounce delay, upsert by `session_id`
- **pullAll**: pullRoom + last 50 sessions + pullProfile (called at login)
- **pushLocalData**: bulk-push all localStorage sessions on first login

---

## 7. Auth Flow

1. On `index.html` load, `<head>` inline script checks `localStorage['pocketbase_auth']`
2. If JWT is valid and not expired → inject full-screen loading overlay immediately (zero FOUC)
3. After `MeasurelyAuth.init()` confirms session → `window.location.replace('app.html')`
4. If no valid session → remove overlay, show landing page normally

---

## 8. LocalStorage Keys

| Key | Contents |
|---|---|
| `pocketbase_auth` | PocketBase JWT token + model |
| `measurely_room` | Room configuration JSON |
| `measurely_sessions` | Array of up to 20 session objects |
| `mly.speaker.key` | Last selected speaker profile |
| `measurely_onboarded` | Boolean flag |
| `mly_pending_profile` | Queued profile update (pre-auth) |

---

## 9. CSS Architecture

All CSS lives inline in each page's `<style>` block, with two shared linked stylesheets:

| File | Purpose |
|---|---|
| `css/global/auth.css` | Auth modal overlay, login/register form |
| `css/global/profile.css` | Profile panel, avatar, gear list |

Design tokens (CSS custom properties) defined in `:root` on `index.html`:
- `--bg-dark`, `--bg-elevated`, `--purple-400/500`, `--gradient-purple`
- `--text-primary/secondary/muted`, `--border-soft/strong`, `--glass`
- `--shadow-md`, `--shadow-lg`

---

## 10. External Dependencies

| Dependency | How loaded | Size | Purpose |
|---|---|---|---|
| PocketBase SDK | CDN `<script>` | ~80 KB | Auth + database |
| Three.js | Local vendor | ~580 KB | 3D room engine |
| OrbitControls | Local vendor | — | Camera orbit |
| DragControls | Local vendor | — | Speaker drag in setup mode |
| Plotly.js | Local, lazy `<script>` inject | ~3.5 MB | Frequency response chart |
| Google Fonts (Outfit) | CDN `<link>` | — | Typography |
| Material Icons | CDN `<link>` | — | UI icons |
