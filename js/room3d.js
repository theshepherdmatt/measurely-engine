// Copyright (c) 2024–2026 Measurely. All Rights Reserved. Proprietary and confidential.
/* ==========================================================
   Measurely 3D Room Engine (Reusable)
   ==========================================================
   THREE is imported via the "three" importmap specifier which
   resolves to js/vendor/three/three.module.js — an ESM bridge
   that re-exports the UMD globalThis.THREE namespace.
   See: web/js/vendor/three/three.module.js for the upgrade path
   to the true Three.js ESM build (enables tree-shaking with Vite).
   ========================================================== */
import THREE from 'three';

// Production studio desk: height of the back riser (desk surface → riser top).
// Shared by the desk builder (_buildDesk) and the monitor Y placement so the
// near-field monitors sit exactly on the riser top and can never drift apart.
const RISER_H = 0.20;
// How far the two speaker posts rise ABOVE the riser top. The monitors perch on
// the post tops, so the speaker loop lifts them by RISER_H + POST_RISE. Shared
// with _buildDesk so the posts and the speakers can never drift apart.
const POST_RISE = 0.12;

/* ----------------------------------------------------------
   DEBUG LOGGING
   Engine info-level logs are silenced by default. To enable
   them at runtime, set either:
     window.MEASURELY_DEBUG = true          (per-session)
     localStorage.measurely_debug = '1'     (persistent)
   Errors and warnings are NEVER gated — they always print.
---------------------------------------------------------- */
const _debugEnabled = () => {
  try {
    if (typeof window !== 'undefined' && window.MEASURELY_DEBUG) return true;
    if (typeof localStorage !== 'undefined' && localStorage.getItem('measurely_debug') === '1') return true;
  } catch (_) { /* localStorage may throw in privacy-strict contexts */ }
  return false;
};
const _dbg = (...args) => { if (_debugEnabled()) console.log(...args); };

/* ----------------------------------------------------------
   SHARED CAMERA DEFAULT
   Single source of truth for the starting viewpoint used on
   every page.  All calls to initRoom3D() and focusOn() that
   need the "home" position reference this object.
---------------------------------------------------------- */
export const DEFAULT_CAMERA = {
  fov: 70,
  near: 0.1,
  far: 1000,
  pos: { x: 5.0, y: 3.5, z: 6.0 },
  target: { x: 0, y: 0, z: 0 }
};

/* ----------------------------------------------------------
   OVERLAY COLOUR PALETTE
   Single source of truth for every colour rendered by an
   acoustic-overlay mesh in this engine. Consumers (the legend
   chips in app.html, future overlays, the test harness) MUST
   import and reuse these tokens — duplicating a hex literal
   anywhere overlay-related re-introduces the legend/scene
   drift bug we fixed when this palette was introduced.

   Non-overlay UI (room shell, furniture base colours, lighting,
   setup-wizard highlights, treatment panel default colours,
   greyscale shader bases) intentionally keeps its own literals
   — those aren't legend-tracked.
---------------------------------------------------------- */
export const OVERLAY_COLOURS = {
  // Pressure / problem indicators
  PRESSURE_PEAK:     '#FF107A',  // neon pink — SBIR confirmed null + bass-mode
                                 // antinode/boom + non-modal peak (the "hot" end
                                 // of the resonance ramp)
  RESONANCE_PURPLE:  '#7C3AED',  // bass-mode standing waves — the baked field +
                                 // particle cloud ramp through this (void → purple
                                 // → pink → white-hot) by pressure magnitude
  RESONANCE_HOT:     '#FFD9F2',  // white-hot antinode core — the top of the
                                 // resonance pressure ramp (matches the shader)
  RESONANCE_VOID:    '#0A0A32',  // zero-pressure deep (shader literal)
  MODE_PREDICTED:    '#475569',  // muted slate — predicted / unconfirmed scaffolding
                                 // (SBIR "Predicted only" chip). Neutral, not a
                                 // sound-energy colour.
  // (The amber/orange/red MODE_* SEVERITY gradient — MILD/MODERATE/SEVERE — was
  //  retired in the Bass Modes overhaul: the field now carries pressure in hue and
  //  measured severity is shown by the focused-mode dB labels, so colour means one
  //  thing. MODE_PREDICTED is kept — it's the neutral scaffolding tone, not severity.)

  // Direct / clean indicators
  DIRECT_SIGNAL:     '#00B8A9',  // teal — direct path
  SWEET_SPOT_TEAL:   '#0d9488',  // sweet-spot / centred
  TREATED_CYAN:      '#00F5FF',  // cyan — treated-state / SBIR ring

  // Severity / wall reflections
  REFLECTION_ORANGE: '#FF6B35',  // worst-wall reflection path

  // Smoothness gradient
  SMOOTH_TEAL:       '#0f766e',  // smooth baseline
  SMOOTH_AMBER:      '#d97706',  // rough
  SMOOTH_RED:        '#ff3b3b',  // very rough / off-axis / problem path

  // Other accents
  REAR_AMBER:        '#f59e0b',  // rear-energy slab + animation lerp anchor
  CEILING_INDIGO:    '#6366f1',  // ceiling reflection (no cloud)
};

// Numeric mirror — Three.js takes hex numbers (0x...) for material colours.
// Generated once at module load so the palette object stays the source of
// truth (edit a hex above, both forms update).
const OC = Object.fromEntries(
  Object.entries(OVERLAY_COLOURS).map(([k, v]) => [k, parseInt(v.slice(1), 16)])
);

/* ----------------------------------------------------------
   OVERLAY_META — single source of truth for overlay labels,
   short descriptions, and icons. Consumed by web's sidebar,
   retail's inline overlay row, and any future satellite that
   renders overlay buttons.

   Renaming an overlay or swapping its icon happens here once
   and propagates everywhere on next submodule bump.

   Keys mirror the closure-scoped OVERLAYS enum literal values
   inside initRoom3D() (floor_reflection / sbir / side_reflections
   / rear_energy / coffee_table / bandwidth). Keep them in sync.

   Labels, descriptions, and SVG icons for sbir / bandwidth /
   side_reflections are taken verbatim from web/app.html's
   .ws-overlay-row blocks (the previous home of these strings).
   floor_reflection / rear_energy / coffee_table aren't shown
   in any visible row today but are included for completeness so
   any consumer can render any subset.
---------------------------------------------------------- */
export const OVERLAY_META = {
  crowd: {
    label: 'Dance floor crowd',
    shortDescription: 'Audience rendering & acoustic footprint',
    icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7" r="4"/><path d="M5.5 21v-2a4 4 0 0 1 4-4h5a4 4 0 0 1 4 4v2"/></svg>',
    whatItShows: 'Instanced crowd visualisation dynamically mapped to the acoustic engine levels. Provides an audience footprint for RT60 absorption.',
    howToRead: 'Teal = quietest, Pink = loudest based on inverse-square falloff from the speakers.',
    caveats: ['Level mapping is currently an inverse-square mock.'],
    legend: [
      { color: OVERLAY_COLOURS.PRESSURE_PEAK, label: 'High SPL' },
      { color: '#ffd166', label: 'Mid SPL' },
      { color: '#22d3c5', label: 'Low SPL' }
    ]
  },
  sbir: {
    label: 'Speaker placement',
    shortDescription: 'Boundary nulls · distance & stacking',
    icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
    whatItShows: 'Energy streams flow from each speaker out to its near boundaries — front wall, nearest side wall, floor — and back, the quarter-wave round trip (f = c/4d) that causes a cancellation. Where the returning energy collides out of phase it gets devoured in a throbbing suckout; in phase it pops as a bright flare. When two boundary nulls land at similar frequencies they STACK into one violent vortex — the deep suckout to fix. Everything recomputes live as you move the speakers or the seat.',
    howToRead: 'Watch where the streams get eaten: a throbbing pink vortex is a cancellation. Pull a speaker away from a boundary and its null slides down in frequency; line two boundaries up at the same distance and their vortices merge into one violent suckout — separate them and it tears apart. Treating a boundary calms its stream to teal and closes the hole. The vortex at the seat, with the "Boundary dip" readout, is the dip you actually hear.',
    caveats: [
      'Boundaries are modelled as rigid reflectors; heavy treatment or an open space behind the speakers reduces the cancellation depth in practice.',
      'Only nulls in the audible boundary band (~40-200 Hz) are shown; nulls outside it are dropped to keep the view readable.',
      'Floor treatment is approximate — a rug helps less at these low frequencies than panels on a wall.',
    ],
    // Legend chips — colours reference OVERLAY_COLOURS so they can never drift
    // from what the scene paints. Pink/teal only — no severity warm palette.
    legend: [
      { color: OVERLAY_COLOURS.PRESSURE_PEAK, label: 'Reinforcement flare' },
      { ramp: [OVERLAY_COLOURS.PRESSURE_PEAK, OVERLAY_COLOURS.RESONANCE_HOT], label: 'Cancellation suckout · your dip' },
      { color: OVERLAY_COLOURS.DIRECT_SIGNAL, label: 'Treated · healed' },
    ],
  },
  bandwidth: {
    label: 'Bass Modes',
    shortDescription: 'Standing waves · room resonances',
    icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
    whatItShows: 'Standing-wave resonances between opposing room boundaries — the modes that make some bass notes louder or quieter than others. The pattern is predicted from your room dimensions and speaker placement, and confirmed against your measurement once one is loaded.',
    howToRead: 'The room surfaces glow with standing-wave pressure: deep purple where the field is quiet, through pink to a white-hot core at the antinodes where bass piles up against the boundaries. A cloud of points fills the room — it vibrates hardest at the antinodes and falls still on the nulls. A glow at your listening seat reads hot pink when the seat sits on an antinode (a boom) and cool purple when it sits in a null. With a measurement loaded, each confirmed mode is labelled with its frequency and measured level in dB.',
    caveats: [
      'Without a loaded measurement the field is predictive — computed from room geometry and speaker placement, and labelled as predicted.',
      'Axial modes (length, width, height) appear most prominently; tangential and oblique modes are included at reduced intensity, reflecting their typically weaker effect at the listening position.',
      'Colour shows resonance pressure, not perceived loudness; the measured level of each confirmed mode is carried by its dB label, not by the field\'s hue.',
    ],
    // Legend chips — colours reference OVERLAY_COLOURS so they can never drift
    // from what the scene paints. The pressure ramp and listener rows use a
    // gradient swatch (ramp = ordered colour stops); the renderer builds the
    // gradient. Purple/pink only on this overlay, per the visual tenet.
    legend: [
      { ramp: [OVERLAY_COLOURS.RESONANCE_PURPLE, OVERLAY_COLOURS.PRESSURE_PEAK, OVERLAY_COLOURS.RESONANCE_HOT], label: 'Resonance pressure · low → antinode' },
      { ramp: [OVERLAY_COLOURS.RESONANCE_PURPLE, OVERLAY_COLOURS.PRESSURE_PEAK], label: 'Your seat · null → boom' },
      { color: OVERLAY_COLOURS.PRESSURE_PEAK, label: 'Non-modal peak' },
    ],
  },
  side_reflections: {
    label: 'Reflections',
    shortDescription: 'Behavioural simulation · speaker → wall → listener',
    icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/></svg>',
    whatItShows: 'A behavioural simulation of the speaker → wall → listener path. Animated pulses show how energy leaves the speakers, strikes a side or rear wall, and returns to the listening position. The simulation updates live as you move the speakers, the listening seat, or toggle wall treatment.',
    howToRead: 'Teal pulses are the outgoing signal; pink flashes mark where an untreated wall reflects energy back at the listener. Toggle treatment on a wall and the pink flashes dim to cyan as the wall absorbs the bounce. Moving the speakers or listener changes which walls the pulses strike and where they impact.',
    caveats: [
      'First-order bounces only — second and later reflections are not modelled.',
      'Treatment is applied as a uniform reduction; frequency-dependent absorption is not modelled.',
    ],
    legend: [
      { color: OVERLAY_COLOURS.DIRECT_SIGNAL, label: 'Outgoing pulse' },
      { color: OVERLAY_COLOURS.PRESSURE_PEAK, label: 'Wall reflection' },
      { color: OVERLAY_COLOURS.TREATED_CYAN,  label: 'Treated wall' },
    ],
  },
  peaks_dips: {
    label: 'Peaks & dips',
    shortDescription: 'Modal pressure · sweep the bass',
    icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h3l3 7 4-14 3 7h5"/></svg>',
    whatItShows: 'A translucent slab of the modal pressure field, stacked through the height band from the floor to the top of the speaker cabinets. At a chosen frequency, bass energy build-ups (antinodes) glow as solid purple blobs floating in the listening zone, while cancellations (nulls) are fully transparent — you literally see through the dips. Same room modes as Bass Modes, shown as a volume you scrub rather than an oscillating cloud.',
    howToRead: 'Drag the frequency slider (20–240 Hz) and the whole volume re-forms: where the slab is solid purple, that frequency piles up; where it is transparent teal or empty, that frequency cancels. Move the slider to a frequency you find boomy or thin and look at the listening seat — if it sits in a purple blob the note is reinforced there, if it sits in a clear gap the note is sucked out.',
    caveats: [
      'Steady-state prediction from room geometry + speaker placement; furniture, absorption, and speaker dispersion are not modelled.',
      'The slab covers the floor-to-cabinet height band, not the full room volume, so it reads as the energy in the listening zone.',
      'Modes are capped to the audible bass band; very high or very low modes are omitted.',
    ],
    // Teal (dip/low) → purple (peak/antinode). No pink, no amber.
    legend: [
      { color: OVERLAY_COLOURS.DIRECT_SIGNAL,    label: 'Dip · low pressure' },
      { color: OVERLAY_COLOURS.RESONANCE_PURPLE, label: 'Peak · antinode' },
    ],
  },
  floor_reflection: {
    label: 'Floor reflection',
    shortDescription: 'Floor bounce · auto-enabled',
    icon: '',
  },
  rear_energy: {
    label: 'Rear wall',
    shortDescription: 'Rear-wall bass build-up',
    icon: '',
  },
  coffee_table: {
    label: 'Coffee table',
    shortDescription: 'Coffee-table reflection',
    icon: '',
  },
};

/* Browser global — exposes OVERLAY_META to non-module consumers
   (retail's inline classic <script> overlay row) without forcing
   them to switch to ES modules. Mirrors the UMD pattern used by
   acoustics.js, treatment-registry.js, etc. (per engine/CLAUDE.md). */
if (typeof window !== 'undefined') {
  window.MeasurelyOverlayMeta = OVERLAY_META;
}

export function initRoom3D({
  mountId,
  getRoomData,
  mode = "setup",
  showLabels = true,
}) {
  _dbg("[Room3D] initRoom3D() called with mode:", mode);

  // In-scene text visibility (wall compass + overlay annotation strings).
  // Default true preserves existing behaviour for web/dashboards. Satellites
  // like retail pass false to keep the room shell uncluttered while still
  // benefiting from 'final'-mode opacity. Toggle at runtime via setShowLabels.
  let _showLabels = showLabels;

  const container = document.getElementById(mountId);
  if (!container) {
    console.error("[Room3D] ❌ mountId not found:", mountId);
    return;
  }

  const VISIBILITY = {
    roomShell: true,
    grid: true,
    furniture: {
      sofa: true,
      coffeeTable: true,
      rug: true,
      desk: true
    }
  };

  const OVERLAYS = {
    FLOOR_REFLECTION: "floor_reflection",
    SBIR: "sbir",
    SIDE_REFLECTIONS: "side_reflections",
    REAR_ENERGY: "rear_energy",
    COFFEE_TABLE: "coffee_table",
    BANDWIDTH: "bandwidth",
    PEAKS_DIPS: "peaks_dips",
    CROWD: "crowd"
  };

  /* ------------------------------------------
     ENGINE INTEGRATION HOOK
  ------------------------------------------ */
  // Mock level lookup: inverse-square falloff summed from each speaker position
  function getLevelAtPosition(x, y, z, room) {
    if (!room) return -60;
    const _effTweeterY = room.room_type === 'club' ? (room.pa_mount_height_m || 3.0) : (room.tweeter_height_m || 0.95);
    const fTweeterY = -room.height_m / 2 + _effTweeterY;
    const offsetX = room.listener_offset_m || 0;
    const spkZ = -room.length_m / 2 + (room.spk_front_m || 0.5);
    
    let totalLevel = 0;
    const count = room.bass_bin_count || 2;
    for (let i = 0; i < count; i++) {
      // rough spacing for mono centre-stack or spaced
      const spkX = offsetX + ((i - (count-1)/2) * (room.spk_spacing_m || 1.5) / Math.max(1, count-1));
      
      const dx = x - spkX;
      const dy = y - fTweeterY;
      const dz = z - spkZ;
      const distSq = dx*dx + dy*dy + dz*dz;
      const dist = Math.sqrt(distSq);
      
      // Inverse square falloff (avoid div by zero, base 0 at 1m is 100dB arbitrary)
      const level = 100 - 20 * Math.log10(Math.max(dist, 1));
      // Convert dB to linear energy to sum
      totalLevel += Math.pow(10, level / 10);
    }
    // Convert back to dB
    return 10 * Math.log10(totalLevel);
  }

  /* ------------------------------------------
     MODE STATE
  ------------------------------------------ */
  let currentMode = mode;
  let analysisStart = null;
  let analysisPulse = 0;
  // In 'setup' mode speakers must be draggable immediately — start in 'speakers'
  // stage so real speaker meshes (with userData.draggable) are built on first
  // rebuild(). Other modes keep 'room' as the starting placeholder stage.
  let renderStage = (mode === "setup") ? "speakers" : "room";
  const activeOverlays = new Set();
  let focusedOverlay = null;
  let _pingEpoch     = performance.now() * 0.001; // kept for backward compat (unused now)
  const _splashRings = [];   // active arrival splash rings [ { mesh, startMs } ]
  let activeScore = 10;
  let simulatePanels = false;
  let flyAnim = null;

  // When pullRoom() completes after auth, it dispatches 'measurely:data-ready'
  // with the fresh cloud data.  We store it here so rebuild() can use it in
  // place of the caller's (potentially stale) getRoomData() for one cycle.
  let _freshRoomOverride = null;

  // Dynamic room-size overrides set via setRoomWidth() / setRoomLength().
  // Applied on top of whatever getRoomData() returns so the geometry
  // updates live when UI sliders change.
  let _roomWidthOverride = null;
  let _roomLengthOverride = null;
  let _roomHeightOverride = null;
  // Flipped on `webglcontextlost`, cleared on `webglcontextrestored`.
  // While true, animate() keeps rAF-ing but skips renderer.render().
  let _animationPaused = false;

  function overlayEnabled(id) {
    return activeOverlays.has(id);
  }

  /* ------------------------------------------
     COLOUR STATES (Refined for Glow)
  ------------------------------------------ */
  const ROOM_COLOURS = {
    idle: {
      room: 0x1a1714,     // Measurely dark charcoal
      accent: 0x1a1714,   // Dark charcoal — scene is monochrome on light bg
      furniture: 0x3d3530 // Warm dark for furniture
    },
    active: {
      room: 0x0f766e,
      accent: 0xffffff,   // White glow for analysis
      furniture: 0x0f766e
    },
    success: {
      room: 0x22c55e,
      accent: 0x4ade80,
      furniture: 0x166534
    }
  };

  const WIREFRAME_STRENGTH = {
    room: 1.0,
    grid: 0.85,
    objects: 0.95,
    listener: 1.0
  };

  let colourState = "idle";
  let highlightTarget = null; // 'speakers' | 'listener' | 'wall_length' | 'wall_width' | 'wall_height' | null


  const isDesktop = window.innerWidth >= 900;
  const isTablet = window.innerWidth < 900;

  const baseScale = isDesktop ? 1.1 : 1;

  // WebGL lineWidth is capped at 1px on most GPUs (it's a spec limitation).
  // On high-DPR mobile (2–3×) that becomes visually sub-pixel.
  // On tablet/mobile we replace LineSegments with thin mesh tube geometry so
  // the wireframe is reliably visible regardless of device pixel ratio.
  // EDGE_TUBE_T: tube cross-section in metres (negligible in 3D, visible on screen).
  const EDGE_TUBE_T = isTablet ? 0.038 : 0.016;
  const useFatEdges = isTablet;   // desktop keeps fast LineSegments path

  /**
   * Build a single thin mesh tube between two Vector3 points.
   * BoxGeometry(t, len, t) with Y-axis aligned to the edge direction.
   */
  function _edgeTube(v1, v2, t, mat) {
    const dir = new THREE.Vector3().subVectors(v2, v1);
    const len = dir.length();
    if (len < 1e-4) return null;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(t, len, t), mat);
    mesh.position.set((v1.x + v2.x) / 2, (v1.y + v2.y) / 2, (v1.z + v2.z) / 2);
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.normalize()
    );
    mesh.renderOrder = 1000;
    return mesh;
  }

  /**
   * Build a Group of fat mesh tubes for an arbitrary edge list.
   * @param {THREE.Vector3[]} verts
   * @param {[number,number][]} pairs  — index pairs into verts
   * @param {number} t                — tube cross-section in metres
   * @param {THREE.Material} mat
   */
  function _fatEdgeGroup(verts, pairs, t, mat) {
    const g = new THREE.Group();
    g.renderOrder = 1000;
    pairs.forEach(([a, b]) => {
      const tube = _edgeTube(verts[a], verts[b], t, mat);
      if (tube) g.add(tube);
    });
    return g;
  }


  _dbg("[Room3D] baseScale =", baseScale);


  const ANALYSIS_DURATION = 15000; // ms

  /* ------------------------------------------
     SCENE SETUP
  ------------------------------------------ */
  const scene = new THREE.Scene();
  const roomGroup = new THREE.Group();
  roomGroup.scale.set(baseScale, baseScale, baseScale);

  // 👇 ADD HERE
  //const ROOM_YAW = -Math.PI * 0.2;
  //roomGroup.rotation.y = ROOM_YAW;

  scene.add(roomGroup);

  /* ------------------------------------------
    LIGHTING (Required for Standard Materials)
  ------------------------------------------ */
  const ambientLight = new THREE.AmbientLight(0xffffff, 1.35);
  scene.add(ambientLight);

  const topLight = new THREE.PointLight(0xffffff, 1.6);
  topLight.position.set(0, 5, 0);
  scene.add(topLight);

  const camera = new THREE.PerspectiveCamera(
    DEFAULT_CAMERA.fov,
    container.clientWidth / container.clientHeight,
    DEFAULT_CAMERA.near,
    DEFAULT_CAMERA.far
  );

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true
  });

  renderer.setSize(container.clientWidth, container.clientHeight);
  // Per-material clipping planes (Material.clippingPlanes) require this flag.
  // Used only by the Sound Waves rings to contain them inside the room walls;
  // no other material in the scene sets clippingPlanes.
  renderer.localClippingEnabled = true;
  // Cap DPR at 1.5 on small viewports — halves framebuffer cost on mobile
  // retina screens where the GPU runs out of headroom much faster than the
  // visual gain at 2x DPR is worth.
  const _dprCap = window.matchMedia('(max-width: 640px)').matches ? 1.5 : 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, _dprCap));
  renderer.setClearColor(0xc8c8c8, 1); // Light grey — neutral studio-cyc backdrop
  renderer.domElement.style.touchAction = 'none'; // prevent iOS/iPad scroll hijack
  container.appendChild(renderer.domElement);

  // WebGL context-loss recovery. On mobile, sustained GPU pressure (e.g. a
  // long room-slider drag) can prompt the browser to drop the context.
  // Without these listeners the canvas just goes black silently and the
  // render loop spams errors against a dead context. preventDefault() opts
  // us in to the matching `webglcontextrestored` event.
  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    _animationPaused = true;
    console.warn('[Room3D] WebGL context lost — pausing render loop');
  }, false);
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    _dbg('[Room3D] WebGL context restored — rebuilding scene');
    _animationPaused = false;
    rebuild();
  }, false);

  _dbg("[Room3D] Renderer + camera initialised");

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.enableZoom = true;

  // Auto-spin state — controlled via startAutoSpin() / stopAutoSpin().
  // autoRotateSpeed: Three.js formula is 2π/3600 * speed per frame at 60fps,
  // so speed=4 → 2π/900 rad/frame → 360° in 15 seconds.
  controls.autoRotateSpeed = 4;

  // Stop spin on any pointer interaction with the canvas.
  renderer.domElement.addEventListener('pointerdown', () => {
    controls.autoRotate = false;
  }, { passive: true });

  // Raycasting for CROWD overlay inspection
  const _clickRay = new THREE.Raycaster();
  const _clickMouse = new THREE.Vector2();
  renderer.domElement.addEventListener('click', (e) => {
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    _clickMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _clickMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    _clickRay.setFromCamera(_clickMouse, camera);
    
    const crowdMeshes = [];
    scene.traverse(obj => {
      if (obj.userData?.isCrowd && obj.isInstancedMesh) crowdMeshes.push(obj);
    });
    
    if (crowdMeshes.length > 0) {
      const intersects = _clickRay.intersectObjects(crowdMeshes, false);
      if (intersects.length > 0) {
        const hit = intersects[0];
        const instId = hit.instanceId;
        const instances = hit.object.userData.instances;
        if (instances && instId !== undefined && instances[instId]) {
          const inst = instances[instId];
          const room = getRoomData ? getRoomData() : null;
          const db = getLevelAtPosition(inst.x, (hit.object.userData.floorY || 0) + 1.0, inst.z, room);
          console.log(`[Room3D] Crowd instanceId: ${instId}, Level: ${db.toFixed(1)} dB`);
        }
      }
    }
  });

  // Apply the shared default — also set controls.target so OrbitControls
  // orbits around the same point the camera is aimed at (prevents snap-on-drag).
  camera.position.set(
    DEFAULT_CAMERA.pos.x,
    DEFAULT_CAMERA.pos.y,
    DEFAULT_CAMERA.pos.z
  );
  controls.target.set(
    DEFAULT_CAMERA.target.x,
    DEFAULT_CAMERA.target.y,
    DEFAULT_CAMERA.target.z
  );
  controls.update();

  /* ------------------------------------------
     RESIZE HANDLING
  ------------------------------------------ */
  // Phone-landscape viewport check — gated on viewport width, not
  // canvas width, so the camera config does not re-zoom when the
  // edge-arrow drawers slide in/out (drawers are translateX overlays
  // that don't resize the canvas, but we cross-check viewport here
  // for safety so the user gets a stable framing in landscape).
  const _mqPhoneLandscape = (typeof window !== 'undefined' && window.matchMedia)
    ? window.matchMedia('(orientation: landscape) and (max-width: 899px)')
    : null;

  function _onContainerResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;

    // Portrait viewport (mobile) — pull camera back so the full room
    // (including ceiling) is visible, then shift the rendered slice
    // down within the virtual frame to raise the room a touch above
    // centre, leaving breathing room for the bottom sheet at peek
    // (~92px) + the 48px tab bar. Recalibrated 2026-05-05 from
    // zoom 1.30 / oy +10% to zoom 1.45 / oy +17% — the prior pass
    // pulled the framing too far down (~80px of empty grey above
    // the ceiling) and pressed the front edge against the sheet
    // peek. Desktop and landscape unaffected.
    if (h > w) {
      const zoom = 1.45;
      const fw = w * zoom;
      const fh = h * zoom;
      const ox = (fw - w) / 2;
      const oy = (fh - h) / 2 + h * 0.17;
      camera.setViewOffset(fw, fh, ox, oy, w, h);
    } else if (_mqPhoneLandscape && _mqPhoneLandscape.matches) {
      // Landscape phone — the panoramic shape can hold more of the room
      // than the default desktop framing leaves visible. Crop the central
      // slice of a 1.18x virtual frame so the room fills ~75% of the
      // canvas with comfortable margins, instead of sitting as a small
      // object in a sea of grey. Vertical offset stays centred (oy at
      // exact mid-frame); horizontal stays centred so the room remains
      // dead-centre with drawers closed. Drawer overlays don't resize
      // the canvas, so this framing holds steady when a drawer opens.
      const zoom = 1.18;
      const fw = w * zoom;
      const fh = h * zoom;
      const ox = (fw - w) / 2;
      const oy = (fh - h) / 2;
      camera.setViewOffset(fw, fh, ox, oy, w, h);
    } else {
      camera.clearViewOffset();
    }

    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  // ResizeObserver catches container changes on mobile (address bar
  // show/hide, orientation change, layout settling) more reliably than
  // window "resize" alone.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(_onContainerResize).observe(container);
  } else {
    window.addEventListener("resize", _onContainerResize);
  }

  // Deferred initial resize — lets the browser finish layout before
  // we lock in the canvas dimensions (fixes the "must refresh" bug on mobile).
  requestAnimationFrame(_onContainerResize);

  // ── Live object refs (repopulated every rebuild) ─────────

  // ── Live object refs (repopulated every rebuild) ─────────
  let _spkMeshL = null;  // Left  speaker mesh (for auto-toe)
  let _spkMeshR = null;  // Right speaker mesh (for auto-toe)
  let _beamGeoL = null;  // Left  beam BufferGeometry (for live endpoint update)
  let _beamGeoR = null;  // Right beam BufferGeometry
  let _listenStation = null;  // Group: sphere + rug + sofa + coffee table
  let _autoToe = false; // Auto-toe disabled by default; use toe_in_deg from room data
  let _autoToeAngle = 0;     // Last computed angle (radians) — readable via API
  let _waveRings = [];       // Expanding wave ring Meshes, repopulated on rebuild
  // Four side-wall clipping planes that contain the Sound Waves rings inside
  // the room. Created once (lazily) and reused across rebuilds — only their
  // .constant is updated when room dimensions change. THREE clipping planes are
  // WORLD-space; the room shell lives at ±width/2 / ±length/2 in roomGroup-local
  // space and roomGroup applies a uniform `baseScale`, so the constants bake in
  // baseScale. Inward-facing normals (interior is the kept half-space). No top/
  // bottom planes — rings sit at a fixed Y well inside the room height.
  let _waveClipPlanes = null;
  // SBIR energy-stream FX (in roomGroup → freed by the rebuild traverse).
  let _sbirParticles = null;  // InstancedMesh — glowing stream particles
  let _sbirTrails    = null;  // InstancedMesh — comet trails (desktop tier only)
  let _sbirTrailLen  = 0;
  let _sbirPool      = [];    // particle descriptors { sIdx, phase0, speed, radius, ox/oy/oz, swirl }
  let _sbirStreams   = [];    // stream defs { a, b, treated, color, suck:Vector3|null, throbW }
  let _sbirVortices  = [];    // { ring, severity, throbW, seat }
  let _sbirFlares    = [];    // { mesh, throbW, treated }
  const _sbirM     = new THREE.Matrix4();
  const _sbirPos   = new THREE.Vector3();
  const _sbirPos2  = new THREE.Vector3();
  const _sbirQuat  = new THREE.Quaternion();
  const _sbirScale = new THREE.Vector3();
  const _sbirCol   = new THREE.Color();
  const _sbirV     = new THREE.Vector3();
  const _sbirUpY   = new THREE.Vector3(0, 1, 0);
  const _sbirRightX = new THREE.Vector3(1, 0, 0);

  // ── Peaks & dips — volumetric modal pressure SLAB ─────────────────────────
  // A separate lens on the same room modes: ~10 stacked horizontal layers from
  // floor to speaker-cabinet top, per-vertex modal pressure baked into an
  // aPressure attribute. Colour teal→purple + alpha by pressure → a translucent
  // volume you SCRUB by frequency (re-baked on slider change, never per frame).
  let _peaksLayers = [];      // [{ mesh, geom, pos:Float32Array(xyz), aPress:BufferAttribute }]
  let _peaksMat    = null;    // shared raw-GLSL ShaderMaterial
  let _peaksModes  = [];      // cached { p, q, r, f, coupling } for the current room
  let _peaksSeat   = null;    // seat marker mesh (peak/dip indicator)
  let _peaksDims   = null;    // { W, H, L } the modes/coupling were computed for
  let _peaksFreq   = 50;      // swept frequency (Hz), 20–240, driven by the slider
  let _peaksHalos  = [];      // additive halo Sprites at the antinode cores (self-glow)
  let _peaksHaloTex = null;   // cached soft-gaussian halo texture (shared by all halos)
  // Vertex shader — pass the baked per-vertex pressure to the fragment.
  const _PEAKS_VERT = `
    attribute float aPressure;
    varying float vP;
    void main() {
      vP = aPressure;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`;
  // Fragment — teal (dip/low) → purple (peak/antinode); alpha from pressure so
  // nulls vanish (you see through the dips) and antinodes read solid + bright
  // enough to feed the shared bloom. High contrast keeps dips as real voids.
  const _PEAKS_FRAG = `
    precision mediump float;
    varying float vP;
    uniform float uContrast;
    uniform float uNull;
    uniform float uOpacity;
    void main() {
      float p  = clamp(vP, 0.0, 1.0);
      float pc = pow(p, uContrast);
      // LOW-GREEN ramp. The wash came from teal (green 0.76): additively summing
      // ~10 high-green layers drives green+blue → 1 = cyan-white. So teal shows
      // ONLY at near-transparent dips; the visible mid/high route through
      // electric blue → purple → hot magenta, all low-green, so a summed antinode
      // column reads as a saturated purple/magenta core, never white.
      vec3 teal = vec3(0.000, 0.757, 0.698);   // #00C1B2 — dip (barely visible, low alpha)
      vec3 blue = vec3(0.106, 0.247, 1.000);   // electric blue — low green
      vec3 purp = vec3(0.486, 0.227, 0.929);   // #7C3AED — peak
      vec3 mag  = vec3(0.835, 0.157, 1.000);   // hot magenta-purple — top-antinode punch
      vec3 col = mix(teal, blue, smoothstep(0.00, 0.32, pc));
      col = mix(col, purp,      smoothstep(0.32, 0.70, pc));
      col = mix(col, mag,       smoothstep(0.70, 1.00, pc));
      // Boost chroma so it glows COLOURED (push away from grey before bloom).
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = clamp(mix(vec3(luma), col, 1.35), 0.0, 1.0);
      // Dips fully transparent; antinodes reach solid sooner → bold blobs, not haze.
      float alpha = smoothstep(uNull, 0.85, p);
      if (alpha < 0.01) discard;
      // Hue-preserving brightness (scales the colour, never adds white).
      gl_FragColor = vec4(col * (0.60 + 0.70 * pc), alpha * uOpacity);
    }`;
  // Shared Sound Waves propagation constants — single source of truth so the
  // Reflections pulses move at the SAME on-screen speed as the rings. The rings
  // expand to (max(L,W)·WAVE_EXTENT_FACTOR) over WAVE_CYCLE_S, an implied
  // V_VIS ≈ 1.5 m/s in a typical room — deliberately slowed for visual rhythm,
  // NOT 343 m/s. Both the ring animator and the Reflections scheduler read these.
  const WAVE_CYCLE_S       = 2.8;   // seconds for a ring to reach its max radius
  const WAVE_EXTENT_FACTOR = 0.85;  // ring max radius = max(L,W) · this
  let _reflCyclePeriod = 6.0;       // Reflections loop period (s); set per-rebuild from the longest active path so far bounces aren't clipped. Read by animate()'s pulse loop.
  // ── Reflections frequency-banded pulse clusters ───────────────────────────
  // Each reflection path emits a cluster of return balls — one per frequency
  // band — all riding ONE trajectory at ONE speed (V_VIS, the ring speed).
  // Band → SIZE (low freq large), surface absorption → BRIGHTNESS. Rendered as
  // a single InstancedMesh (one draw call) so iPad Safari stays smooth.
  const REFL_BAND_SETS = { 4: [125, 500, 2000, 8000], 3: [125, 1000, 6000], 2: [160, 4000] };
  // Per-surface absorption seam — local porous-panel α curve. This is the
  // SINGLE place to later swap in the materials DB's alphaAt(material, f); the
  // DB is parked (not browser-reachable), so we read the binary treated flag +
  // this table for now. Untreated reflects almost everything; a treated porous
  // panel passes the bass and eats the treble.
  const REFL_UNTREATED_ALPHA = 0.04;
  const REFL_TREATED_ALPHA = [[125, 0.10], [500, 0.55], [2000, 0.85], [8000, 0.80]];
  const REFL_MAX_BALLS = 192;        // hard instance cap — iPad budget guard
  // Reused scratch objects — the animation loop mutates these in place so it
  // never allocates per frame (InstancedMesh hot path).
  const _reflM     = new THREE.Matrix4();
  const _reflPos   = new THREE.Vector3();
  const _reflQuat  = new THREE.Quaternion();   // identity — never mutated
  const _reflScale = new THREE.Vector3();
  const _reflCol   = new THREE.Color();
  // ── Sound Burst showpiece (separate from the analytical overlays) ─────────
  // A triggered explosion of frequency-coloured balls from both speakers that
  // bounce off the six room planes with energy loss (treated walls eat the
  // treble) and ping the listener. Own SPECTRAL palette — deliberately distinct
  // from the three analytical neons (pink #FF107A, purple #7C3AED, teal
  // #00C1B2): a warm→cool fire-spark ramp so it never reads as an overlay.
  // [centreHz, radius×roomK, spawnWeight, decay/s, bounceLoss, treatedLoss, hex]
  // Bass: big, few, slow-dying, panels barely touch it. Treble: tiny, dense,
  // fast-dying, panels eat it on contact. Speed is IDENTICAL across classes.
  const BURST_CLASSES = [
    { hz: 125,  rK: 0.115, w: 1, decay: 0.10, bounce: 0.05, treat: 0.10, hex: '#FF4D2E' }, // bass — warm red
    { hz: 500,  rK: 0.085, w: 2, decay: 0.20, bounce: 0.11, treat: 0.45, hex: '#FF9F0A' }, // low-mid — amber
    { hz: 2000, rK: 0.060, w: 4, decay: 0.34, bounce: 0.18, treat: 0.80, hex: '#67E66A' }, // mid — green
    { hz: 8000, rK: 0.040, w: 8, decay: 0.58, bounce: 0.28, treat: 0.92, hex: '#CDEFFF' }, // treble — icy white
  ];
  const _BURST_DIE     = 0.045;     // energy floor — recycle a ball below this
  const _BURST_FLASH_R = 0.55;      // listener-ping proximity radius (m)
  let _lastRoom    = null;          // latest built room snapshot — read by the burst on fire
  let _burstBalls  = null;          // InstancedMesh swarm (one draw call)
  let _burstTrails = null;          // InstancedMesh trails (one draw call)
  let _burstHalo   = null;          // listener ping marker (single Mesh)
  let _burstPool   = [];            // pooled particle descriptors — no per-frame alloc
  let _burstTrailLen = 0;
  let _burstRunning  = false;
  let _burstLastT    = 0;
  let _burstHaloE    = 0;           // listener flash energy (decays)
  const _burstCtx = { listener: new THREE.Vector3(), halfW: 0, halfH: 0, halfL: 0, treated: {}, colors: [] };
  const _burstScratchV = new THREE.Vector3();
  // ── Shared surface-impact + heat-map system ───────────────────────────────
  // Additive layer fed by BOTH ball systems (the Impulse swarm and the
  // Reflections overlay). On every ball-surface hit, impactAt(surfaceKey,
  // localPoint, energy) does two things:
  //   Layer 1 — spawns a transient pink ripple "splash" at the impact point
  //             (treated surfaces get a cooler/softer ripple; untreated a
  //             brighter one).
  //   Layer 2 — deposits a blob into a persistent GPU accumulation atlas
  //             (one 8-bit render target, one UV cell per room surface) that
  //             a six-plane "heat shell" samples through a pink ramp. Energy
  //             concentration grows hot patches; treated surfaces (rug,
  //             panels) deposit little and stay cool, so the map doubles as
  //             treatment guidance: hot = treat here, cool rug = rug working.
  // Purely additive: it never touches ball motion, bounce geometry, the
  // analytical overlays' core logic, or the existing GLSL bloom plane. The
  // accumulation target lives off-screen; the shell + splash meshes live in
  // roomGroup so the rebuild() disposal traverse frees them for free.
  const _HEAT_SURF_INDEX = { floor: 0, ceiling: 1, front: 2, back: 3, left: 4, right: 5 };
  let _heatRT         = null;   // persistent 8-bit accumulation atlas (render target)
  let _heatRtScene    = null;   // off-screen scene: decay quad + deposit splats
  let _heatRtCam      = null;   // ortho cam mapping [0,1]² → the atlas
  let _heatDecayQuad  = null;   // fullscreen quad, multiply-blend → in-place decay
  let _heatSplatMesh  = null;   // InstancedMesh of additive deposit blobs
  let _heatRingTex    = null;   // ripple annulus texture (Layer 1 splash)
  let _heatTier       = null;   // device-tier scalar snapshot (res / rate / caps)
  let _heatPending    = [];     // deposits queued since last RT update {u,v,deposit}
  let _heatSplatCap   = 0;      // _heatSplatMesh instance count
  let _heatPlanes     = [];     // the six heat-shell display planes (in roomGroup)
  let _heatSplashMesh = null;   // Layer-1 ripple pool InstancedMesh (in roomGroup)
  let _heatSplashPool = [];     // ripple descriptors (pooled — no per-frame alloc)
  let _heatSplashCap  = 0;
  let _heatSplashCursor = 0;    // round-robin spawn cursor (O(1), no slot scan)
  let _heatReady      = false;  // shell built this rebuild → impactAt is live
  let _heatActive     = false;  // any heat present → run the RT pass + draw planes
  let _heatFailed     = false;  // a heat op threw (bad GPU / RT / shader) → disable, never retry
  let _heatLastImpactMs = 0;
  let _heatLastUpdateMs = 0;
  let _heatSplashPrevMs = 0;
  const _heatSurfLastMs = {};   // surfaceKey → last-impact ms (per-plane visibility gate)
  const _impactRoom    = { hW: 2, hH: 1.3, hL: 2.5 };   // half-dims this rebuild (local m)
  const _impactTreated = {};                            // surfaceKey → bool (this rebuild)
  const _heatSurfQuat  = {};                            // surfaceKey → THREE.Quaternion (splash orient)
  const _heatScratchV  = new THREE.Vector3();           // dedicated scratch — never clobbers _refl*
  const _heatScratchM  = new THREE.Matrix4();
  const _heatScratchQ  = new THREE.Quaternion();
  const _heatScratchS  = new THREE.Vector3();
  const _heatScratchC  = new THREE.Color();
  // Reflections per-cycle impact events — populated by renderAnalysisOverlays
  // when the overlay is active, consumed by animate()'s cycle-crossing detector
  // so each bounce fires impactAt once as the pulse reaches its wall.
  let _reflImpactEvents   = [];
  let _reflImpactPrevCycle = 0;
  // Heat-shell display shader — samples this surface's atlas cell and maps it
  // through the pink heat ramp (faint translucent magenta → #FF107A → near-
  // white hot core), output additively. UV is derived from the vertex's
  // roomGroup-LOCAL position via the SAME formula impactAt() uses, so deposit
  // and display always agree (scale/rotation invariant — local space never
  // goes through roomGroup's world transform). Declared HERE (not next to
  // _buildHeatShell) because the first rebuild() runs inside initRoom3D before
  // execution reaches that later point — a const there is in the temporal
  // dead zone (ReferenceError on init, which the fail-safe then latches off).
  const _HEAT_VERT = `
    varying vec3 vLocal;
    void main() {
      vLocal = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`;
  const _HEAT_FRAG = `
    varying vec3 vLocal;
    uniform sampler2D uHeat;
    uniform vec3  uHalf;     // hW, hH, hL (local metres)
    uniform float uSurf;     // 0 floor 1 ceiling 2 front 3 back 4 left 5 right
    uniform vec4  uCell;     // cx, cy, cw, ch (atlas cell rect)
    uniform float uOpacity;
    void main() {
      float u, v;
      if (uSurf < 1.5)        { u = (vLocal.x + uHalf.x) / (2.0 * uHalf.x); v = (vLocal.z + uHalf.z) / (2.0 * uHalf.z); } // floor / ceiling
      else if (uSurf < 3.5)   { u = (vLocal.x + uHalf.x) / (2.0 * uHalf.x); v = (vLocal.y + uHalf.y) / (2.0 * uHalf.y); } // front / back
      else                    { u = (vLocal.z + uHalf.z) / (2.0 * uHalf.z); v = (vLocal.y + uHalf.y) / (2.0 * uHalf.y); } // left / right
      vec2 atlasUv = uCell.xy + clamp(vec2(u, v), 0.0, 1.0) * uCell.zw;
      float h = clamp(texture2D(uHeat, atlasUv).r, 0.0, 1.0);
      vec3 faint = vec3(0.55, 0.05, 0.30);     // faint translucent magenta
      vec3 pink  = vec3(1.0, 0.063, 0.478);    // #FF107A
      vec3 hot   = vec3(1.0, 0.82, 0.92);      // near-white hot core
      vec3 col = mix(faint, pink, smoothstep(0.0, 0.45, h));
      col = mix(col, hot, smoothstep(0.55, 1.0, h));
      float intensity = smoothstep(0.015, 0.55, h);
      if (intensity <= 0.002) discard;          // no heat → contribute nothing
      gl_FragColor = vec4(col * intensity * uOpacity, 1.0);
    }`;

  // ── Bass Modes (Resonance) — baked modal-pressure field ───────────────────
  // The old overlay ran the 8-mode standing-wave cos() loop per fragment, per
  // frame, across a full-room BackSide box — the iPad hotspot. This subsystem
  // instead BAKES the summed modal pressure into an off-screen atlas ONCE per
  // rebuild (same six-surface 3×2 cell layout as the impact heat shell) and
  // displays it on six boundary planes that just sample the texture. Per-frame
  // cost on the surfaces is then a single texture lookup. It runs on its OWN
  // render target and planes — NOT the shared impact atlas — so the impact
  // decay/splat path and the modal field never corrupt each other. Motion lives
  // in the interior particle cloud, not the field. Mirrors the heat-shell
  // patterns: device-tiered atlas res, _HEAT_SURF_INDEX cell layout, local→UV
  // mapping, and a one-shot fail-safe that can never break rebuild()/the scene.
  // Per the visual tenet: only the sound (this purple field + particles) carries
  // colour, light, and motion; the room shell stays neutral wireframe.
  let _bwRT          = null;   // dedicated modal-field atlas (separate from _heatRT)
  let _bwRtScene     = null;   // off-screen bake scene: six per-surface quads
  let _bwRtCam       = null;   // ortho cam mapping [0,1]² → the atlas
  let _bwBakeQuads   = [];     // the six bake quads (uniforms updated per rebuild)
  let _bwPlanes      = [];     // six display planes (in roomGroup → auto-disposed)
  let _bwParticles   = null;   // interior standing-wave particle cloud (InstancedMesh)
  let _bwListenerHalo = null;  // sound-layer glow at the listening seat (in roomGroup)
  let _bwTier        = null;   // device-tier snapshot (atlas res / particle count)
  let _bwFailed      = false;  // a bake/particle op threw → disable, never retry
  let _bwOscRate     = 0;      // dominant-mode breathing rate (rad-ish/s) for particles
  let _bwReduced     = false;  // prefers-reduced-motion snapshot — freezes particle motion
  let _bwParticleN   = 0;      // particle slot count this rebuild
  let _bwParticleBase = null;  // Float32Array xyz×N — static base positions
  let _bwParticleAmp  = null;  // Float32Array N — signed normalised modal amplitude
  let _bwParticleSize = null;  // Float32Array N — per-particle base radius (0 = hidden)
  const _bwScratchM  = new THREE.Matrix4();
  const _bwScratchV  = new THREE.Vector3();
  const _bwScratchQ  = new THREE.Quaternion();
  const _bwScratchS  = new THREE.Vector3();
  // Pointer-pressure "delight" layer (polish only — the modal positions/
  // oscillation are untouched; this is a purely additive hover response). One
  // ray from the pointer through the camera is fed to the particle shader as
  // uniforms; the shader does the per-dot proximity in GLSL (no per-instance
  // raycast). Listener added on Bass Modes activate, removed on dispose.
  let _bwHoverRay     = null;            // THREE.Raycaster (lazy)
  let _bwHoverHandler = null;            // bound pointermove handler
  let _bwHoverOn      = false;           // listener attached?
  const _bwPointerNDC = new THREE.Vector2();
  // Particle material — raw-GLSL ShaderMaterial on the InstancedMesh. instanceMatrix
  // carries the (CPU-oscillated) position + base scale; instanceColor carries the
  // static base ramp colour. The hover aura swells/brightens/recolours each dot by
  // its distance to the pointer ray, fading via uHover (bumped on pointermove,
  // decayed each frame). Additive → feeds the (additive) glow; no bloom pass exists.
  const _BW_PARTICLE_VERT = `
    uniform vec3 uRayO;
    uniform vec3 uRayD;
    uniform float uHover;
    uniform float uRadius;
    uniform float uSwell;
    varying vec3 vBaseCol;
    varying float vInfl;
    void main() {
      vec4 centre = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      vec3 toC = centre.xyz - uRayO;
      float along = dot(toC, uRayD);
      vec3 perp = toC - uRayD * max(along, 0.0);
      float dist = length(perp);
      float infl = uHover * smoothstep(uRadius, 0.0, dist) * step(0.0, along);
      vInfl = infl;
      #ifdef USE_INSTANCING_COLOR
        vBaseCol = instanceColor;
      #else
        vBaseCol = vec3(0.5);
      #endif
      vec3 p = position * (1.0 + infl * uSwell);                 // swell toward the pointer
      vec4 worldP = modelMatrix * instanceMatrix * vec4(p, 1.0);
      vec3 pushDir = (dist > 1e-4) ? (perp / dist) : vec3(0.0);
      worldP.xyz += pushDir * infl * uRadius * 0.18;             // subtle outward pressure
      gl_Position = projectionMatrix * viewMatrix * worldP;
    }`;
  const _BW_PARTICLE_FRAG = `
    precision mediump float;
    uniform float uBaseScale;
    varying vec3 vBaseCol;
    varying float vInfl;
    void main() {
      vec3 hotPink = vec3(1.0, 0.063, 0.478);   // #FF107A — hover accent (bass/pink family, no cyan)
      vec3 col = vBaseCol * uBaseScale;
      col = mix(col, hotPink, clamp(vInfl * 1.3, 0.0, 1.0));
      col = mix(col, vec3(1.0), clamp((vInfl - 0.55) * 1.8, 0.0, 1.0));  // white core under the pointer
      float bright = 1.0 + vInfl * 1.6;                                  // brighten to glow
      gl_FragColor = vec4(col * bright, 1.0);
    }`;

  // Bake vertex — pass the quad's uv (= this surface's local 0..1 coords).
  const _BW_BAKE_VERT = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`;
  // Bake fragment — reconstruct the normalised room coords (nx,ny,nz) for this
  // surface, sum the 8 modes' standing-wave pressure (SAME equation as the old
  // box shader), apply the per-wall bass-trap cooling, and write the scalar
  // pressure to the R channel. Runs six times total (once per surface quad) per
  // rebuild — never per frame.
  const _BW_BAKE_FRAG = `
    #define PI 3.14159265359
    varying vec2 vUv;
    uniform float uSurf;          // 0 floor 1 ceiling 2 front 3 back 4 left 5 right
    uniform vec4  uModes[8];      // (p, q, r, weight)
    uniform float uBassTrapsF;
    uniform float uBassTrapsR;
    uniform float uBtSide;
    uniform float uCeilType;      // 0 flat, 1 slanted, 2 gable
    uniform float uSlantDir;      // 0 L→R, 1 R→L, 2 front→back, 3 back→front
    uniform float uGableDepth;    // 1 = ridge runs along depth (Z), 0 = along width (X)
    uniform float uLowFrac;       // low ceiling height / room height (0..1)

    // Normalised ceiling height at (nx,nz) — mirrors room3d's ceilingYAt() so the
    // field's ceiling sits on the real roofline. Returns 1.0 for a flat ceiling.
    float nyCeiling(float nx, float nz) {
      if (uCeilType < 0.5) return 1.0;
      if (uCeilType < 1.5) {                       // slanted
        float t;
        if      (uSlantDir < 0.5) t = nx;
        else if (uSlantDir < 1.5) t = 1.0 - nx;
        else if (uSlantDir < 2.5) t = 1.0 - nz;
        else                      t = nz;
        return uLowFrac + t * (1.0 - uLowFrac);
      }
      float distRatio = (uGableDepth > 0.5) ? abs(2.0 * nx - 1.0) : abs(2.0 * nz - 1.0);
      return 1.0 - distRatio * (1.0 - uLowFrac);   // gable: 1.0 at ridge, uLowFrac at eaves
    }

    void main() {
      // Map this surface's local (u,v) → normalised room coords. The fixed axis
      // is pinned to its wall (0 or 1); matches the display plane's UV mapping.
      // The ceiling pins ny to the sloped roofline so its baked pressure is
      // sampled at the true (lower) ceiling height, not a flat ny = 1.
      float nx, ny, nz;
      if (uSurf < 1.5)        { nx = vUv.x; nz = vUv.y; ny = (uSurf < 0.5) ? 0.0 : nyCeiling(nx, nz); } // floor / ceiling
      else if (uSurf < 3.5)   { nx = vUv.x; ny = vUv.y; nz = (uSurf < 2.5) ? 0.0 : 1.0; } // front / back
      else                    { nz = vUv.x; ny = vUv.y; nx = (uSurf < 4.5) ? 0.0 : 1.0; } // left / right

      // Predictive model: not a physical measurement
      float pressure = 0.0;
      float totalWeight = 0.001;
      for (int i = 0; i < 8; i++) {
        vec4 m = uModes[i];
        if (m.w > 0.0) {
          float pL = cos(m.x * PI * nz);
          float pW = cos(m.y * PI * nx);
          float pH = cos(m.z * PI * ny);
          pressure    += m.w * abs(pL * pW * pH);
          totalWeight += m.w;
        }
      }
      pressure /= totalWeight;

      // Per-wall bass-trap cooling — proximity-blended, same model as before.
      float frontProx = smoothstep(0.5, 0.0, nz);
      float rearProx  = smoothstep(0.5, 1.0, nz);
      float leftProx  = smoothstep(0.5, 0.0, nx);
      float rightProx = smoothstep(0.5, 1.0, nx);
      float localTraps = max(max(frontProx * uBassTrapsF, rearProx * uBassTrapsR),
                             (leftProx + rightProx) * uBtSide);
      pressure *= (1.0 - localTraps * 0.35);

      gl_FragColor = vec4(clamp(pressure, 0.0, 1.0), 0.0, 0.0, 1.0);
    }`;
  // Display vertex — identical to the heat shell: pass roomGroup-LOCAL position.
  const _BW_FIELD_VERT = `
    varying vec3 vLocal;
    void main() {
      vLocal = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`;
  // Display fragment — sample this surface's atlas cell and ramp the baked
  // pressure through the on-brand resonance gradient: near-black void → purple
  // (#7C3AED) → pink (#FF107A) → white-hot core. Hue carries pressure magnitude
  // ONLY; measured severity lives in the focused-mode labels, not the colour.
  const _BW_FIELD_FRAG = `
    varying vec3 vLocal;
    uniform sampler2D uField;
    uniform vec3  uHalf;     // hW, hH, hL (local metres)
    uniform float uSurf;
    uniform vec4  uCell;     // cx, cy, cw, ch (atlas cell rect)
    uniform float uOpacity;
    uniform float uCeilType; // 0 flat, 1 slanted, 2 gable
    uniform float uSlantDir;
    uniform float uGableDepth;
    uniform float uLowFrac;

    float nyCeiling(float nx, float nz) {
      if (uCeilType < 0.5) return 1.0;
      if (uCeilType < 1.5) {
        float t;
        if      (uSlantDir < 0.5) t = nx;
        else if (uSlantDir < 1.5) t = 1.0 - nx;
        else if (uSlantDir < 2.5) t = 1.0 - nz;
        else                      t = nz;
        return uLowFrac + t * (1.0 - uLowFrac);
      }
      float distRatio = (uGableDepth > 0.5) ? abs(2.0 * nx - 1.0) : abs(2.0 * nz - 1.0);
      return 1.0 - distRatio * (1.0 - uLowFrac);
    }

    void main() {
      // Clip anything above the actual sloped ceiling — trims the wall planes to
      // the room silhouette under a slanted/gable roof. The ceiling plane sits
      // ON the slope (inset just below), so the small epsilon keeps it visible.
      float nxC = (vLocal.x + uHalf.x) / (2.0 * uHalf.x);
      float nzC = (vLocal.z + uHalf.z) / (2.0 * uHalf.z);
      float ceilY = -uHalf.y + nyCeiling(nxC, nzC) * (2.0 * uHalf.y);
      if (vLocal.y > ceilY + 0.05) discard;

      float u, v;
      if (uSurf < 1.5)        { u = (vLocal.x + uHalf.x) / (2.0 * uHalf.x); v = (vLocal.z + uHalf.z) / (2.0 * uHalf.z); }
      else if (uSurf < 3.5)   { u = (vLocal.x + uHalf.x) / (2.0 * uHalf.x); v = (vLocal.y + uHalf.y) / (2.0 * uHalf.y); }
      else                    { u = (vLocal.z + uHalf.z) / (2.0 * uHalf.z); v = (vLocal.y + uHalf.y) / (2.0 * uHalf.y); }
      vec2 atlasUv = uCell.xy + clamp(vec2(u, v), 0.0, 1.0) * uCell.zw;
      float p = clamp(texture2D(uField, atlasUv).r, 0.0, 1.0);
      vec3 voidC  = vec3(0.020, 0.010, 0.050);   // near-black resting tone
      vec3 purple = vec3(0.486, 0.227, 0.929);   // #7C3AED
      vec3 pink   = vec3(1.000, 0.063, 0.478);   // #FF107A
      vec3 hot    = vec3(1.000, 0.720, 0.880);   // pink-white antinode core (pulled off pure white)
      vec3 col = mix(voidC, purple, smoothstep(0.00, 0.28, p));
      col = mix(col, pink, smoothstep(0.28, 0.62, p));
      // Narrow the white-hot band to the very peak so big high-pressure areas
      // stay PINK rather than washing the ceiling/upper walls to flat white.
      col = mix(col, hot,  smoothstep(0.78, 1.00, p));
      // Low/mid intensity curve (and the discard) are unchanged — only the bright
      // end is capped, so peak antinodes read as a contained core and feed far
      // less into the shared bloom pass (which we must NOT lower; it's shared).
      float intensity = smoothstep(0.03, 0.55, p);
      if (intensity <= 0.002) discard;
      intensity = min(intensity, 0.62);
      gl_FragColor = vec4(col * intensity * uOpacity, 1.0);
    }`;

  let _interferenceIndicator = null;        // Flat disc at MLP; pulses on constructive interference. Gated by _wavesEnabled — same toggle as the rings.
  const _mlpLocalPos      = new THREE.Vector3();   // Stashed at indicator build; read by animate's interference calc.
  const _spkLeftLocalPos  = new THREE.Vector3();
  const _spkRightLocalPos = new THREE.Vector3();
  let _wavesEnabled = false;  // Off by default; toggled via api.setWaves()
  // Independent per-group visibility, additive on top of _wavesEnabled --
  // club's sidebar splits the single Waves toggle into "Tops" (L/R rings,
  // blue) and "Bass" (SUB rings, pink) buttons via setTopWaves/setSubWaves.
  // setWaves() (the original API, used by other Measurely products) still
  // sets both together for backward compatibility.
  let _topsWavesOn = true;
  let _subWavesOn = true;
  let _mirrorBall = null;
  let _discoEnabled = false;
  let _crowdEnabled = true;   // On by default; toggled via api.setCrowd()
  let _sbirFieldVisible = true; // SBIR heatmap field on by default; toggled via api.setSbirField()
  // ── REW live measurement data ─────────────────────────────────────────────
  // Set by api.setWaves(freqs, mags). Null = no measurement loaded (simulation mode).
  let _rewFreqs = null;       // Float32[] Hz axis from REW
  let _rewMags  = null;       // Float32[] dBFS magnitudes from REW

  // ── Measurement context (full analyse() output snapshot) ──────────────────
  // Set by api.setMeasurementContext(analysis). Foundation for measurement-
  // driven overlays — stores a defensively-copied snapshot of the fields
  // overlay renderers need (modes, reflections, bandLevels, scores, etc.).
  // Null = no measurement loaded. No overlay consumes this yet; this is
  // plumbing only. See setMeasurementContext / getMeasurementContext below.
  let _measurement = null;
  let _cableGroupL = null;  // Left  speaker → rack cable mesh (TubeGeometry)
  let _cableGroupR = null;  // Right speaker → rack cable mesh (TubeGeometry)

  // ── REW band-energy helper ────────────────────────────────────────────────
  // Returns mean dBFS across loHz..hiHz from the loaded REW measurement.
  // Falls back to `fallback` (default -20 dBFS) when no data is present.
  // Used by SIDE_REFLECTIONS, SBIR, and any future data-driven overlays.
  function _rewBandEnergy(loHz, hiHz, fallback = -20) {
    if (!_rewFreqs || !_rewMags || _rewFreqs.length === 0) return fallback;
    let sum = 0, count = 0;
    for (let i = 0; i < _rewFreqs.length; i++) {
      if (_rewFreqs[i] >= loHz && _rewFreqs[i] <= hiHz) {
        sum += _rewMags[i];
        count++;
      }
    }
    return count > 0 ? sum / count : fallback;
  }

  // ── Room-geometry refs (for live resize without full rebuild) ─
  let _roomShell = null;  // LineSegments of the flat-ceiling wireframe box
  let _roomFloor = null;  // Floor plane mesh
  let _roomGrid = null;  // GridHelper


  // ── Auto Toe-In ───────────────────────────────────────────
  // Rotates both speaker meshes to face the listener sphere using the
  // sphere's actual world position (via getWorldPosition) so that the
  // calculation is correct even when the station group is scaled/parented.
  const _tmpSphereWorld = new THREE.Vector3();
  const _tmpSpkWorld = new THREE.Vector3();

  function _applyAutoToe() {
    if (!_autoToe || !_spkMeshL || !_spkMeshR) return;

    // World XZ of the sphere — derived from the station group's world position.
    // The sphere's local XZ within the group is always (0, *, 0), so the group
    // world position equals the sphere's world XZ anchor point.
    if (_listenStation) {
      _listenStation.getWorldPosition(_tmpSphereWorld);
    } else {
      const d = getRoomData() || {};
      const g = d.geometry || d;
      const s = d.setup || d;
      _tmpSphereWorld.set(
        s.listener_offset_m || 0,
        0,
        -(g.length_m || 5) / 2 + (s.listener_front_m || 2.8)
      );
    }

    for (const [spk, bGeo] of [[_spkMeshL, _beamGeoL], [_spkMeshR, _beamGeoR]]) {
      if (!spk) continue;

      // Speaker world position
      spk.getWorldPosition(_tmpSpkWorld);

      const dx = _tmpSphereWorld.x - _tmpSpkWorld.x;
      const dz = _tmpSphereWorld.z - _tmpSpkWorld.z;

      // atan2(dx, dz): angle to rotate a +Z-facing mesh toward (dx, dz)
      spk.rotation.y = Math.atan2(dx, dz);

      // Beam endpoint in speaker-local space — distance in roomGroup units
      if (bGeo) {
        // World distance ÷ roomGroup uniform scale = local-space distance
        const worldDist = Math.sqrt(dx * dx + dz * dz);
        const localDist = worldDist / (roomGroup.scale.x || 1);
        const pos = bGeo.attributes.position;
        const beamY = pos.getY(0); // preserve tweeter Y offset from start point
        pos.setXYZ(1, 0, beamY, localDist);
        pos.needsUpdate = true;
        const lineObj = spk.children.find(c => c.isLine);
        if (lineObj) lineObj.computeLineDistances();
      }
    }
    _autoToeAngle = _spkMeshL.rotation.y;
  }



  /* ------------------------------------------
     REBUILD SCENE (GEOMETRY ONLY)
  ------------------------------------------ */
  function rebuild() {
    if (typeof ambientLight !== 'undefined') ambientLight.intensity = _discoEnabled ? 0.15 : 1.35;
    // renderStage is set externally via setStage() — never override here.
    _dbg("[Room3D] 🔧 rebuild() | stage:", renderStage, "| mode:", currentMode);

    // Dispose GPU resources before clearing — Group.clear() detaches children
    // but leaves their geometries/materials resident on the GPU. On the
    // slider-drag hot path that leaks ~60 geometries + ~60 materials per
    // second of dragging, eventually exhausting mobile GPU memory and
    // triggering a context-loss event. No textures in this scene (every
    // material is colour-only) so we don't walk .map / .alphaMap / etc.
    roomGroup.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
      // InstancedMesh keeps its instanceMatrix/instanceColor buffers separate
      // from geometry — dispose() frees them so the Reflections ball/trail
      // fields don't leak GPU buffers on the slider-drag rebuild hot path.
      if (obj.isInstancedMesh && typeof obj.dispose === 'function') obj.dispose();
    });
    roomGroup.clear();
    _waveRings = [];
    _teardownSbirStreams();   // SBIR FX live in roomGroup → freed by the traverse; drop refs so the animator no-ops until SBIR rebuilds them.
    _teardownPeaksSlab();     // Peaks & dips slab layers + seat marker live in roomGroup → freed by the traverse; drop refs.
    // Sound Burst meshes live in roomGroup → already disposed by the traverse
    // above; just drop the refs so a fresh fire rebuilds them (a mid-flight
    // burst ends cleanly when the room geometry changes).
    _burstBalls = _burstTrails = _burstHalo = null;
    _burstPool = []; _burstRunning = false; _burstHaloE = 0;
    // Heat-shell planes + ripple pool live in roomGroup → freed by the traverse
    // above; drop refs so impactAt() no-ops until _buildHeatShell() runs at the
    // end of rebuild. Reflections impact events are repopulated by the overlay.
    _teardownHeatShell();
    _teardownBassField();            // Bass Modes planes/particles/halo live in roomGroup → freed by the traverse; drop refs so animate no-ops until the overlay rebuilds them.
    _reflImpactEvents = [];
    _interferenceIndicator = null;   // GPU resources freed by the traverse above; just drop the closure ref.
    colourState = "idle";

    // Merge whatever getRoomData() returns over safe defaults so that
    // missing or null configuration never prevents speakers from spawning.
    const FALLBACK = {
      geometry: {
        length_m: 5, width_m: 4, height_m: 2.6,
        ceiling_type: 'flat', ceiling_slant_direction: 'left_to_right',
        ceiling_gable_axis: 'depth', ceiling_height_secondary_m: 2.0
      },
      setup: {
        speaker_type: 'standmount', spk_spacing_m: 2.0, spk_front_m: 0.45,
        tweeter_height_m: 0.95, toe_in_deg: 12, listener_front_m: 2.8,
        listener_offset_m: 0, subwoofer: false, spk_inset_m: 0.20
      },
      environment: {
        room_type: 'home', floor_material: 'hard',
        furniture: {
          opt_area_rug: true, opt_sofa: true,
          opt_coffee_table: false, opt_desk: false, opt_chair: false,
          seating_type: 'sofa', opt_display: true, opt_mic: false,
          opt_keyboard: false, opt_client_seating: false,
          client_seating_type: 'sofa', desk_width_m: 1.6, desk_depth_m: 0.7,
          desk_style: 'plain'
        },
        treatment: {
          wall_panel_mode: 'none', side_panel_mode: 'none',
          bass_trap_mode: 'none', ceiling_panel_mode: 'none',
          wall_panel_count: 4
        }
      }
    };

    // Use cloud override if one was queued by the 'measurely:data-ready' listener,
    // then fall back to the normal caller-supplied getter.
    const raw = _freshRoomOverride || getRoomData() || {};
    _freshRoomOverride = null;
    const data = {
      ...FALLBACK,
      ...raw,
      geometry: { ...FALLBACK.geometry, ...(raw.geometry || {}) },
      setup: { ...FALLBACK.setup, ...(raw.setup || {}) },
      environment: {
        ...FALLBACK.environment, ...(raw.environment || {}),
        furniture: {
          ...FALLBACK.environment.furniture,
          ...((raw.environment || {}).furniture || {})
        },
        treatment: {
          ...FALLBACK.environment.treatment,
          ...((raw.environment || {}).treatment || {})
        }
      }
    };

    window.__MEASURELY_ROOM__ = data;

    // 1. UNPACKING
    const geo = data.geometry || data;
    const setup = data.setup || data;
    const env = data.environment || data;

    // Apply live overrides (from setRoomWidth / setRoomLength API calls)
    if (_roomWidthOverride !== null) geo.width_m = _roomWidthOverride;
    if (_roomLengthOverride !== null) geo.length_m = _roomLengthOverride;
    if (_roomHeightOverride !== null) geo.height_m = _roomHeightOverride;

    // Check for furniture and treatment sub-objects
    const furn = (env.furniture) ? env.furniture : env;
    const treat = (env.treatment) ? env.treatment : env;

    const room = {
      length_m: geo.length_m,
      width_m: geo.width_m,
      height_m: geo.height_m,
      ceiling_type: geo.ceiling_type || "flat",
      ceiling_slant_direction: geo.ceiling_slant_direction || "left_to_right",
      ceiling_gable_axis: geo.ceiling_gable_axis || "depth",
      ceiling_height_secondary_m: geo.ceiling_height_secondary_m || 2.0,

      speaker_type: setup.speaker_type,
      // Studio-only: 'vertical' | 'horizontal' monitor orientation. Was
      // missing from this merge entirely — app.js set state.setup.speaker_
      // orientation and the UI toggled it, but room.speaker_orientation
      // (what the speaker-build check at ~line 2131 actually reads) was
      // always undefined, so the horizontal monitor variant never rendered.
      speaker_orientation: setup.speaker_orientation ?? 'vertical',
      // Cinema TV/screen mount — geometry only, never read by acoustics/analysis.
      screen_type: setup.screen_type ?? 'stand',
      // Cinema theatre-row seat count (3–5) — geometry only, not read by acoustics/analysis.
      cinema_seat_count: setup.cinema_seat_count ?? 3,
      // Cinema elevated theatre-row count (1–4) — geometry only, recliner row only.
      // Analysis stays on the front/money seat; rows are never read by acoustics.
      cinema_row_count: setup.cinema_row_count ?? 1,
      // Cinema surround layout ('5_1' | '7_2' | '7_2_4', extends to 'soundbar') —
      // geometry/coverage only; drives surrounds + subs + Atmos heights, never
      // read by acoustics.
      speaker_layout: setup.speaker_layout ?? '5_1',
      // Cinema seating type ('recliner_row' | 'corner_l' | 'corner_r') — geometry only.
      // Separate from the home seating_type to avoid cross-mode coupling.
      cinema_seating_type: setup.cinema_seating_type ?? 'recliner_row',
      // Cinema front-stage placement ('box' | 'inwall') — geometry only, never
      // read by acoustics/analysis. 'inwall' replaces the box L/C/R with flush
      // wireframe panels on the front wall (see the cinema prop block).
      front_placement: setup.front_placement ?? 'box',
      // Cinema in-wall "at screen" flag — geometry only, never read by
      // acoustics/analysis. When true (and the screen is a projector) the in-wall
      // panels tuck behind the acoustically-transparent projector screen.
      at_screen: setup.at_screen ?? false,
      // Cinema surround placement ('box' | 'inwall') — geometry only, never read
      // by acoustics/analysis. 'inwall' replaces the stand-mounted box surrounds
      // with flush wireframe panels on the wall each surround belongs to.
      surround_placement: setup.surround_placement ?? 'box',
      spk_placement: setup.spk_placement || 'desk',
      spk_spacing_m: setup.spk_spacing_m,
      // Studio-only: how far each speaker sits inward from its desk edge.
      // `?? 0.20` migrates saved studio sessions that predate this field.
      spk_inset_m: setup.spk_inset_m ?? 0.20,
      spk_front_m: setup.spk_front_m,
      tweeter_height_m: setup.tweeter_height_m,
      toe_in_deg: setup.toe_in_deg,
      // Clamp listener_front_m so the listener never leaves the room.
      // Max = room length - 0.2m clearance from back wall.
      listener_front_m: Math.min(
        setup.listener_front_m ?? 2.8,
        (geo.length_m ?? 4) - 0.20
      ),
      listener_offset_m: setup.listener_offset_m,
      subwoofer:      setup.subwoofer,
      subwoofer_dual: setup.subwoofer_dual ?? false,
      // Club only: mono bass_bin centre-stack count (2-4). See the
      // BASS BIN STACK render block for why this is a separate path from
      // the home hi-fi subwoofer fields above.
      bass_bin_count: data.bass_bin_count ?? 2,
      // Club only: DJ booth distance from the front wall (cable-run
      // clearance). Same merge pattern as bass_bin_count above.
      booth_front_m: data.booth_front_m ?? 0.75,
      // Club only: booth left/right offset from room centre. Moves the
      // booth and (in 'centre' bass_bin_placement) the bins under it; the
      // wall-mounted pa_top rig stays fixed regardless.
      booth_offset_m: data.booth_offset_m ?? 0,
      // Club only: pa_top wall-bracket mount height (off the floor) —
      // permanent install, not a floor stand or pole-on-sub. Tilt is
      // derived automatically (aimed at ear height on the dance floor
      // centre), not a user field — see the isWallMount bracket block.
      pa_mount_height_m: data.pa_mount_height_m ?? 3.0,
      // Club only: adds RearL/RearR pa_top speakers at the back wall
      // (4-speaker layout) — read by the speakerSides branch below.
      rear_pa: data.rear_pa ?? false,
      // Club only: 'centre' (under the booth) or 'corners' (flanking each
      // front corner) -- read by the BASS BIN STACK render block.
      bass_bin_placement: data.bass_bin_placement ?? 'centre',
      // Club only: 'turntables' (2), 'cdj' (2), or 'both' (4, the standard
      // mixed layout) -- read by _buildDJBooth()'s deck-building calls.
      deck_config: data.deck_config ?? 'both',
      dj_riser_enabled: data.dj_riser_enabled ?? true,
      // Club only: caps the crowd instance count -- read directly by the
      // CROWD block in renderAnalysisOverlays. Was missing from this merge
      // entirely (same class of bug as rear_pa/deck_config before it), so
      // room.crowd_limit was always undefined and the slider had no effect
      // on the actual crowd shown.
      crowd_limit: data.crowd_limit ?? 200,

      room_type: data.room_type || env.room_type || "home",
      opt_area_rug: furn.opt_area_rug ?? env.opt_area_rug ?? data.opt_area_rug,
      opt_sofa: furn.opt_sofa ?? env.opt_sofa ?? data.opt_sofa,
      opt_coffee_table: furn.opt_coffee_table ?? env.opt_coffee_table ?? data.opt_coffee_table,
      opt_ottoman: furn.opt_ottoman ?? env.opt_ottoman ?? data.opt_ottoman ?? false,
      opt_desk: furn.opt_desk ?? env.opt_desk ?? data.opt_desk,
      opt_chair: furn.opt_chair ?? env.opt_chair ?? data.opt_chair,
      seating_type: furn.seating_type ?? env.seating_type ?? data.seating_type ?? 'sofa',
      sofa_width_m: furn.sofa_width_m ?? env.sofa_width_m ?? data.sofa_width_m ?? 2.1,
      opt_display: furn.opt_display ?? env.opt_display ?? data.opt_display ?? true,
      opt_mic: furn.opt_mic ?? env.opt_mic ?? data.opt_mic ?? false,
      opt_keyboard: furn.opt_keyboard ?? env.opt_keyboard ?? data.opt_keyboard ?? false,
      opt_client_seating: furn.opt_client_seating ?? env.opt_client_seating ?? data.opt_client_seating ?? false,
      client_seating_type: furn.client_seating_type ?? env.client_seating_type ?? data.client_seating_type ?? 'sofa',
      desk_width_m: furn.desk_width_m ?? env.desk_width_m ?? data.desk_width_m ?? 1.6,
      desk_depth_m: furn.desk_depth_m ?? env.desk_depth_m ?? data.desk_depth_m ?? 0.7,
      desk_style: furn.desk_style ?? env.desk_style ?? data.desk_style ?? 'plain',

      // TREATMENT: Digging into data.environment.treatment
      front_wall_mode: treat.front_wall_mode ?? env.front_wall_mode ?? "none",
      front_wall_style: treat.front_wall_style ?? env.front_wall_style ?? "broadband_pro",
      front_wall_count: treat.front_wall_count ?? env.front_wall_count ?? 4,

      rear_wall_mode: treat.rear_wall_mode ?? env.rear_wall_mode ?? "none",
      rear_wall_style: treat.rear_wall_style ?? env.rear_wall_style ?? "broadband_pro",
      rear_wall_count: treat.rear_wall_count ?? env.rear_wall_count ?? 4,

      side_wall_mode: treat.side_wall_mode ?? env.side_wall_mode ?? "none",
      side_wall_style: treat.side_wall_style ?? env.side_wall_style ?? "fusion_slim",
      side_wall_count: treat.side_wall_count ?? env.side_wall_count ?? null,

      ceiling_mode: treat.ceiling_mode ?? env.ceiling_mode ?? "none",
      ceiling_style: treat.ceiling_style ?? env.ceiling_style ?? "cloud",
      ceiling_count: treat.ceiling_count ?? env.ceiling_count ?? 1,
      ceiling_size: treat.ceiling_size ?? env.ceiling_size ?? "mini",
      ceiling_drop_m: treat.ceiling_drop_m ?? env.ceiling_drop_m ?? 0.4,
      ceiling_direction: treat.ceiling_direction ?? env.ceiling_direction ?? "landscape",

      front_corners_mode: treat.front_corners_mode ?? env.front_corners_mode ?? "none",
      front_corners_shape: treat.front_corners_shape ?? env.front_corners_shape ?? 'triangle',

      rear_corners_mode: treat.rear_corners_mode ?? env.rear_corners_mode ?? "none",
      rear_corners_shape: treat.rear_corners_shape ?? env.rear_corners_shape ?? 'triangle',

      front_wall_color: treat.front_wall_color ?? data.front_wall_color ?? null,
      rear_wall_color: treat.rear_wall_color ?? data.rear_wall_color ?? null,
      side_wall_color: treat.side_wall_color ?? data.side_wall_color ?? null,
      ceiling_color: treat.ceiling_color ?? data.ceiling_color ?? null,
      front_corners_color: treat.front_corners_color ?? data.front_corners_color ?? null,
      rear_corners_color: treat.rear_corners_color ?? data.rear_corners_color ?? null,

      // FLOOR: read from env (data.environment.floor_material) with hard fallback
      floor_material: env.floor_material ?? data.floor_material ?? 'hard',
    };
    // Snapshot for the Sound Burst showpiece — it fires on user trigger (outside
    // rebuild) and reads the current geometry + treatment from here.
    _lastRoom = room;

    // 2. DEFINE MISSING VARIABLES (Prevents the ReferenceError crash)
    const isLocked = (currentMode === "locked");
    const isStudio = (room.room_type === "studio");
    const offsetX = room.listener_offset_m || 0;
    // Raise all floor-based speakers + rack by rug thickness so they sit ON the rug,
    // not flush with the floor beneath it. Zero in studio mode (no rug).
    const rugRaise = (!isStudio && (room.opt_area_rug ?? true)) ? 0.02 : 0;

    // ── Studio rig anchoring ──────────────────────────────────────────────
    // In studio mode the desk + monitors + speakers + mic + keys move as a
    // single unit driven by spk_front_m. The chair/listener position is
    // NOT part of that unit — it's independently user-controlled via the
    // Listening Position slider (setup.listener_front_m), same as Hi-Fi
    // mode. (Previously this block force-derived listener_front_m as
    // spk_front_m + a fixed 1.0 m offset on every rebuild, which silently
    // discarded whatever the Listening Position slider — and the Acoustics
    // tab's Bass Modes corrective slider, which writes the same field —
    // had set. The default state already happens to start at 1.45 m
    // (0.45 + 1.0), so dropping the override doesn't move the initial
    // render; it just stops re-clobbering the value on every rebuild.)
    //
    // One `room` mutation happens here, before speaker placement
    // (line ~1457) and the overlay code that reads it:
    //
    //   room.spk_spacing_m → desk_width_m - 2*SPEAKER_X_INSET
    //      - 2*spk_inset_m. Speakers start just inside the desk edges
    //      (SPEAKER_X_INSET, a fixed 10 cm structural margin) and the
    //      "Speaker inset" slider (spk_inset_m) moves each speaker
    //      further INWARD from there. spk_spacing_m therefore stays the
    //      TRUE geometric spacing, so every downstream reader (wall/
    //      ceiling panels, reflection overlays) stays correct with no
    //      branching. The Math.max floor stops the speakers crossing
    //      over on a narrow desk.
    //
    // The Block B slider in studio drives spk_inset_m ("Speaker inset"),
    // not spk_spacing_m — inset is desk-relative, so it never needs to
    // change when the desk is resized. The user's stored slider values
    // are preserved on `setup` (not mutated upstream), so switching back
    // to a non-studio room type restores them.
    if (isStudio) {
      if (room.spk_placement === 'stands') room.spk_placement = 'desk_stands';

      const SPEAKER_X_INSET = 0.10; // m — fixed structural margin, speaker centre to desk edge

      // Let the user's "Speaker spacing" slider drive the width of the desk,
      // rather than locking the speakers to a fixed desk width.
      room.desk_width_m = (room.spk_spacing_m ?? 2.0) + 2 * SPEAKER_X_INSET + 2 * (room.spk_inset_m ?? 0.20);

      if (room.desk_style === 'production') {
        room.desk_width_m = Math.max(room.desk_width_m, 2.4);
      }
    }

    // 3. MASTER SWITCHES
    VISIBILITY.furniture = { sofa: true, coffeeTable: true, rug: true, desk: true, chair: true };

    if (room.length_m == null || room.width_m == null || room.height_m == null) {
      console.error("[Room3D] ❌ Invalid room data", data);
      return;
    }

    _dbg("[Room3D] Mapped Room (Checking Panels):", {
      wall: room.wall_panel_mode,
      side: room.side_panel_mode,
      traps: room.bass_trap_mode,
      ceiling: room.ceiling_panel_mode
    });


    const isAnalysing = currentMode === "analysing";
    const isFinal = currentMode === "final";

    const hasFocus = Boolean(focusedOverlay);
    const DIM_FACTOR = hasFocus ? 0.12 : 1.0;

    /* ------------------------------------------
      COLOUR STATE RESOLUTION
    ------------------------------------------ */
    const colors = ROOM_COLOURS[colourState] || ROOM_COLOURS.idle;

    const OP_WIRE = (isLocked ? 0.25 : (isFinal ? 0.85 : 0.65)) * DIM_FACTOR;
    const OP_OBJ = (isLocked ? 0.15 : (isFinal ? 0.6 : 0.25)) * DIM_FACTOR;
    // Furniture recedes: always lower than acoustic elements (R4)
    const OP_FURN = (isLocked ? 0.10 : 0.18) * DIM_FACTOR;

    /* ------------------------------------------
       ROOM SHELL — flat box or slanted wireframe
    ------------------------------------------ */
    const isSlanted = room.ceiling_type === "slanted";
    const isGable = room.ceiling_type === "gable";
    const hasSlopedCeiling = isSlanted || isGable;
    const lowH = hasSlopedCeiling
      ? Math.min(room.ceiling_height_secondary_m, room.height_m)
      : room.height_m;
    const slantDir = room.ceiling_slant_direction || "left_to_right";
    const gableAxis = room.ceiling_gable_axis || "depth";

    const floorY = -room.height_m / 2;
    const highY = room.height_m / 2;
    const lowY = floorY + lowH;
    const hW = room.width_m / 2;
    const hL = room.length_m / 2;

    function ceilingYAt(x, z) {
      if (!hasSlopedCeiling) return highY;

      if (isSlanted) {
        let t;
        switch (slantDir) {
          case "left_to_right": t = (x + hW) / room.width_m; break;
          case "right_to_left": t = 1 - (x + hW) / room.width_m; break;
          case "front_to_back": t = 1 - (z + hL) / room.length_m; break;
          case "back_to_front": t = (z + hL) / room.length_m; break;
          default: t = (x + hW) / room.width_m;
        }
        return lowY + t * (highY - lowY);
      }

      if (isGable) {
        let distRatio; // 0 at ridge, 1 at wall
        if (gableAxis === "depth") {
          distRatio = Math.abs(x) / hW;
        } else {
          distRatio = Math.abs(z) / hL;
        }
        return highY - distRatio * (highY - lowY);
      }

      return highY;
    }

    // Reset room-geometry live refs; will be set for flat ceiling below
    _roomShell = null; _roomFloor = null; _roomGrid = null;

    if (VISIBILITY.roomShell) {
      // Solid "Architectural Cage" beams — BoxGeometry stretched into thin rods.
      // Using _fatEdgeGroup on ALL platforms (desktop + mobile) so the frame has
      // physical heft at every DPR. Live-resize falls back to rebuild() since
      // _roomShell stays null, which is acceptable.
      const SHELL_BEAM_T = 0.015; // metres — thicker for high-contrast "cage" look
      // Always solid — no transparency. depthTest:false means the cage renders
      // on top of interior geometry so it's never occluded by walls.
      const shellMat = new THREE.MeshBasicMaterial({
        color: 0x1a1714, // Dark charcoal — pops against light background
        transparent: false,
        opacity: 1.0,
        depthTest: false,
        depthWrite: false,
      });

      if (!isSlanted && !isGable) {
        const bverts = [
          new THREE.Vector3(-hW, floorY, -hL),
          new THREE.Vector3(hW, floorY, -hL),
          new THREE.Vector3(hW, floorY, hL),
          new THREE.Vector3(-hW, floorY, hL),
          new THREE.Vector3(-hW, floorY + room.height_m, -hL),
          new THREE.Vector3(hW, floorY + room.height_m, -hL),
          new THREE.Vector3(hW, floorY + room.height_m, hL),
          new THREE.Vector3(-hW, floorY + room.height_m, hL),
        ];
        const bpairs = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
        roomGroup.add(_fatEdgeGroup(bverts, bpairs, SHELL_BEAM_T, shellMat));
      } else if (isSlanted) {
        const v = [
          new THREE.Vector3(-hW, floorY, -hL),
          new THREE.Vector3(hW, floorY, -hL),
          new THREE.Vector3(hW, floorY, hL),
          new THREE.Vector3(-hW, floorY, hL),
          new THREE.Vector3(-hW, ceilingYAt(-hW, -hL), -hL),
          new THREE.Vector3(hW, ceilingYAt(hW, -hL), -hL),
          new THREE.Vector3(hW, ceilingYAt(hW, hL), hL),
          new THREE.Vector3(-hW, ceilingYAt(-hW, hL), hL),
        ];
        const edgePairs = [
          [0, 1], [1, 2], [2, 3], [3, 0],
          [4, 5], [5, 6], [6, 7], [7, 4],
          [0, 4], [1, 5], [2, 6], [3, 7]
        ];
        roomGroup.add(_fatEdgeGroup(v, edgePairs, SHELL_BEAM_T, shellMat));
      } else if (isGable) {
        const eavesY = lowY;
        const peakY = highY;

        if (gableAxis === "depth") {
          const v = [
            new THREE.Vector3(-hW, floorY, -hL), // 0
            new THREE.Vector3(hW, floorY, -hL), // 1
            new THREE.Vector3(hW, floorY, hL), // 2
            new THREE.Vector3(-hW, floorY, hL), // 3
            new THREE.Vector3(-hW, eavesY, -hL), // 4 eave front-left
            new THREE.Vector3(hW, eavesY, -hL), // 5 eave front-right
            new THREE.Vector3(hW, eavesY, hL), // 6 eave back-right
            new THREE.Vector3(-hW, eavesY, hL), // 7 eave back-left
            new THREE.Vector3(0, peakY, -hL), // 8 ridge front
            new THREE.Vector3(0, peakY, hL), // 9 ridge back
          ];
          const edgePairs = [
            [0, 1], [1, 2], [2, 3], [3, 0],
            [0, 4], [1, 5], [2, 6], [3, 7],
            [4, 7], [5, 6],
            [8, 9],
            [4, 8], [8, 5], [7, 9], [9, 6],
          ];
          roomGroup.add(_fatEdgeGroup(v, edgePairs, SHELL_BEAM_T, shellMat));
        } else {
          const v = [
            new THREE.Vector3(-hW, floorY, -hL), // 0
            new THREE.Vector3(hW, floorY, -hL), // 1
            new THREE.Vector3(hW, floorY, hL), // 2
            new THREE.Vector3(-hW, floorY, hL), // 3
            new THREE.Vector3(-hW, eavesY, -hL), // 4 eave front-left
            new THREE.Vector3(hW, eavesY, -hL), // 5 eave front-right
            new THREE.Vector3(hW, eavesY, hL), // 6 eave back-right
            new THREE.Vector3(-hW, eavesY, hL), // 7 eave back-left
            new THREE.Vector3(-hW, peakY, 0), // 8 ridge left
            new THREE.Vector3(hW, peakY, 0), // 9 ridge right
          ];
          const edgePairs = [
            [0, 1], [1, 2], [2, 3], [3, 0],
            [0, 4], [1, 5], [2, 6], [3, 7],
            [4, 5], [6, 7],
            [8, 9],
            [4, 8], [8, 7], [5, 9], [9, 6],
          ];
          roomGroup.add(_fatEdgeGroup(v, edgePairs, SHELL_BEAM_T, shellMat));
        }
      }
    }

    // Unit plane: scale.x = width, scale.y = length (plane local-Y maps to world-Z
    // after the -90° X rotation). Stored for live resize.
    // floor_material drives the visual — hard floor = neutral cool grey matte surface,
    // carpet = darker charcoal, fully matte. No warm/cream tones — engine spec forbids them.
    const isCarpet = room.floor_material === 'carpet';
    const floorMat = new THREE.MeshStandardMaterial({
      color: isCarpet ? 0x3a3a3a : 0x8a8a8a,   // dark charcoal vs. neutral cool grey
      roughness: isCarpet ? 0.97 : 0.85,        // both matte — no metallic specular
      metalness: 0.0,                           // zero metalness on both — kills warm specular tint
      transparent: true,
      opacity: isCarpet ? 0.85 : 0.72,        // carpet reads solid, hard floor subtle
      depthWrite: false
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.scale.set(room.width_m, room.length_m, 1);
    floor.position.y = -room.height_m / 2 - 0.01;
    roomGroup.add(floor);
    _roomFloor = floor;

    /* ------------------------------------------
       GRID
    ------------------------------------------ */
    if (VISIBILITY.grid) {
      // GridHelper(size, divisions) — unit size scaled to room dimensions so
      // setRoomWidth/Length can update scale.x / scale.z without rebuilding.
      // Fewer divisions on mobile so lines are further apart and more legible.
      const gridDivisions = isTablet ? 10 : 20;
      const grid = new THREE.GridHelper(1, gridDivisions, colors.room, 0x707070);
      grid.scale.set(room.width_m, 1, room.length_m);
      grid.position.y = -room.height_m / 2;

      const gridMats = Array.isArray(grid.material) ? grid.material : [grid.material];
      gridMats.forEach(m => {
        m.transparent = true;
        m.opacity = focusedOverlay ? 0.12 : 0.30;
        m.depthTest = false;
        m.depthWrite = false;
      });

      grid.renderOrder = 3; // render after floor heatmap planes so it's never buried
      roomGroup.add(grid);
      _roomGrid = grid; // stored for live resize
    }

    /* ------------------------------------------
    PLACEHOLDER SOURCE BOXES (ROOM STAGE)
    ------------------------------------------ */
    if (renderStage === "room") {

      _dbg("[Room3D] Rendering placeholder sources");

      const srcMat = new THREE.MeshBasicMaterial({
        color: colors.room,
        wireframe: true,
        transparent: true,
        opacity: 0.35
      });

      ["L", "R"].forEach(side => {
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(0.30, 0.50, 0.25),
          srcMat
        );

        const spacing = room.width_m * 0.4; // visual only, not data-driven

        const x = offsetX + (side === "L" ? -1 : 1) * spacing / 2;

        box.position.set(
          x,
          -room.height_m / 2 + room.height_m * 0.4, // neutral vertical reference
          -room.length_m / 2 + 0.15                // speaker wall
        );

        roomGroup.add(box);
      });

    }

    /* ------------------------------------------------------------------
       CONE DRIVER RENDERER  (shared — called by all non-panel builders)
       Returns an array of Line objects to add to a speaker group.
  
       Woofer / midrange: outer surround → cone-edge ring → 6 radial spokes → dust cap
       Tweeter:           faceplate rim → dome surround → dome cap (no spokes)
  
       cx/cy  : driver centre in the speaker group's local XY space
       faceZ  : Z position of the baffle face (slightly adds zOffset per layer)
       outerR : full driver radius
    ------------------------------------------------------------------ */
    function _makeConeDriver(cx, cy, faceZ, outerR, isTweeter, color, opacity) {
      const objs = [];
      const ringMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: opacity * 0.65 });
      const spokeMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: opacity * 0.38 });

      function _arc(r, zOff) {
        const SEG = 32, pts = [];
        for (let i = 0; i <= SEG; i++) {
          const a = (i / SEG) * Math.PI * 2;
          pts.push(new THREE.Vector3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, faceZ + zOff));
        }
        return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ringMat);
      }

      if (isTweeter) {
        objs.push(_arc(outerR, 0.000));  // faceplate rim
        objs.push(_arc(outerR * 0.52, 0.002));  // dome surround
        objs.push(_arc(outerR * 0.20, 0.004));  // dome cap
      } else {
        objs.push(_arc(outerR, 0.000));  // outer surround ring
        objs.push(_arc(outerR * 0.76, 0.003));  // cone outer edge
        objs.push(_arc(outerR * 0.16, 0.007));  // dust cap
        // 6 radial spokes from cone edge to dust cap
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const spokePoints = [
            new THREE.Vector3(cx + Math.cos(a) * outerR * 0.76, cy + Math.sin(a) * outerR * 0.76, faceZ + 0.003),
            new THREE.Vector3(cx + Math.cos(a) * outerR * 0.16, cy + Math.sin(a) * outerR * 0.16, faceZ + 0.007),
          ];
          objs.push(new THREE.Line(new THREE.BufferGeometry().setFromPoints(spokePoints), spokeMat));
        }
      }
      return objs;
    }

    function getSpeakerProfile(type) {
      switch (type) {

        case "floorstander":
          return {
            w: 0.24,
            h: 1.18,
            d: 0.42,
            color: 0x2a2a28,
            tweeterPos: 0.805, // tweeter at ~0.95 m when cabinet bottom sits on floor
            detailed: true,
            // Built-in plinth height inside _buildDetailedSpeaker. The cabinet
            // y-position adds this so the plinth sits ON the rug (not piercing
            // through it down to the floor). Match _buildDetailedSpeaker's pH.
            plinthH: 0.035,
          };

        case "statement":
          return {
            w: 0.46,
            h: 1.44,
            d: 0.50,
            color: 0x2a2a28,
            tweeterPos: 0.82,
            floorStand: true,   // floor-standing flagship — bottom sits on floor
            isStatement: true,
            plinthH: 0.04,      // matches _buildStatementSpeaker pH
          };

        case "panel":
          return {
            w: 0.55,
            h: 1.55,
            d: 0.06,
            color: 0x1a1714,
            floorStand: true, // sits on floor, not tweeter-height positioned
            tweeterPos: 0.50, // acoustic centre at mid-panel
            isPanel: true,
            plinthH: 0.06,    // matches _buildElectrostaticSpeaker plH
          };

        case "standmount":
        default:
          return {
            w: 0.22,
            h: 0.34,
            d: 0.25,
            color: colors.accent,
            tweeterPos: 0.82 // tweeter near top of cabinet
          };

        case "pa_top":
          return {
            w: 0.45,
            h: 0.65,
            d: 0.45,
            color: 0x2a2a28,
            tweeterPos: 0.75,
            isWallMount: true, // permanent install: wall bracket at height, aimed down — not floor/pole-mounted
          };

        case "bass_bin":
          return {
            w: 0.60,
            h: 0.60,
            d: 0.65,
            color: 0x2a2a28,
            tweeterPos: 0.50,
            floorStand: true,
            isBassBin: true,
          };

        case "monitor":
          return {
            w: 0.20, // 20cm wide
            h: 0.32, // 32cm high
            d: 0.24, // 24cm deep
            color: colors.accent,
            tweeterPos: 0.8,
            onDesk: true // Custom flag for positioning
          };
      }
    }

    /* ------------------------------------------
       DETAILED SPEAKER BUILDER
       Multi-part wireframe: plinth + lower/upper cabinet + driver rings.
       Self-contained — creates its own edge material so it can be called
       before furnEdgeMat is defined later in rebuild().
    ------------------------------------------ */
    function _buildDetailedSpeaker(W, H, D, color, opacity) {
      const grp = new THREE.Group();

      const edgeMat = useFatEdges
        ? new THREE.MeshBasicMaterial({ color, transparent: true, opacity })
        : new THREE.LineBasicMaterial({ color, transparent: true, opacity });

      // Edge-only box (no diagonal fill lines)
      function _ebox(w, h, d) {
        const geo = new THREE.BoxGeometry(w, h, d);
        const g = new THREE.Group();
        if (useFatEdges) {
          const hw = w / 2, hh = h / 2, hd = d / 2;
          const v = [
            new THREE.Vector3(-hw, -hh, -hd), new THREE.Vector3(hw, -hh, -hd),
            new THREE.Vector3(hw, -hh, hd), new THREE.Vector3(-hw, -hh, hd),
            new THREE.Vector3(-hw, hh, -hd), new THREE.Vector3(hw, hh, -hd),
            new THREE.Vector3(hw, hh, hd), new THREE.Vector3(-hw, hh, hd),
          ];
          const pairs = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
          g.add(_fatEdgeGroup(v, pairs, EDGE_TUBE_T * 0.55, edgeMat));
        } else {
          g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat));
        }
        return g;
      }

      // Circle arc for driver cone indicators
      function _ring(cx, cy, cz, r) {
        const SEG = 28;
        const pts = [];
        for (let i = 0; i <= SEG; i++) {
          const a = (i / SEG) * Math.PI * 2;
          pts.push(new THREE.Vector3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz));
        }
        const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: opacity * 0.65 });
        return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
      }

      // ── Plinth ────────────────────────────────────────────────────────────
      const pH = 0.035;
      const plinth = _ebox(W + 0.05, pH, D + 0.03);
      plinth.position.y = -H / 2 - pH / 2;
      grp.add(plinth);

      // ── Single upright cabinet ─────────────────────────────────────────────
      const cab = _ebox(W, H, D);
      grp.add(cab);

      // ── Drivers on front face ──────────────────────────────────────────────
      const front = D / 2 + 0.002;
      // Woofer 1 (low), Woofer 2 (mid-low), Midrange, Tweeter
      _makeConeDriver(0, -H * 0.28, front, W * 0.20, false, color, opacity).forEach(o => grp.add(o));
      _makeConeDriver(0, -H * 0.08, front, W * 0.20, false, color, opacity).forEach(o => grp.add(o));
      _makeConeDriver(0, H * 0.22, front, W * 0.14, false, color, opacity).forEach(o => grp.add(o));
      _makeConeDriver(0, H * 0.38, front, W * 0.06, true, color, opacity).forEach(o => grp.add(o));

      return grp;
    }

    function _buildStandmountSpeaker(W, H, D, color, opacity) {
      const grp = new THREE.Group();
      const edgeMat = useFatEdges
        ? new THREE.MeshBasicMaterial({ color, transparent: true, opacity })
        : new THREE.LineBasicMaterial({ color, transparent: true, opacity });

      function _ebox(w, h, d) {
        const g = new THREE.Group();
        if (useFatEdges) {
          const hw = w / 2, hh = h / 2, hd = d / 2;
          const v = [
            new THREE.Vector3(-hw, -hh, -hd), new THREE.Vector3(hw, -hh, -hd),
            new THREE.Vector3(hw, -hh, hd), new THREE.Vector3(-hw, -hh, hd),
            new THREE.Vector3(-hw, hh, -hd), new THREE.Vector3(hw, hh, -hd),
            new THREE.Vector3(hw, hh, hd), new THREE.Vector3(-hw, hh, hd),
          ];
          const pairs = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
          g.add(_fatEdgeGroup(v, pairs, EDGE_TUBE_T * 0.55, edgeMat));
        } else {
          g.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), edgeMat));
        }
        return g;
      }

      function _ring(cx, cy, cz, r) {
        const SEG = 28, pts = [];
        for (let i = 0; i <= SEG; i++) {
          const a = (i / SEG) * Math.PI * 2;
          pts.push(new THREE.Vector3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz));
        }
        return new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color, transparent: true, opacity: opacity * 0.65 })
        );
      }

      grp.add(_ebox(W, H, D));
      const front = D / 2 + 0.002;
      _makeConeDriver(0, -H * 0.18, front, W * 0.28, false, color, opacity).forEach(o => grp.add(o));
      _makeConeDriver(0, H * 0.28, front, W * 0.08, true, color, opacity).forEach(o => grp.add(o));

      return grp;
    }

    /* ------------------------------------------
       BASS BIN BUILDER
       Near-cube cabinet, single large low-frequency driver — no tweeter
       ring (subs run mono, full-range tops carry the top end).
    ------------------------------------------ */
    function _buildBassBinSpeaker(W, H, D, color, opacity) {
      const grp = new THREE.Group();
      const edgeMat = useFatEdges
        ? new THREE.MeshBasicMaterial({ color, transparent: true, opacity })
        : new THREE.LineBasicMaterial({ color, transparent: true, opacity });

      function _ebox(w, h, d) {
        const g = new THREE.Group();
        if (useFatEdges) {
          const hw = w / 2, hh = h / 2, hd = d / 2;
          const v = [
            new THREE.Vector3(-hw, -hh, -hd), new THREE.Vector3(hw, -hh, -hd),
            new THREE.Vector3(hw, -hh, hd), new THREE.Vector3(-hw, -hh, hd),
            new THREE.Vector3(-hw, hh, -hd), new THREE.Vector3(hw, hh, -hd),
            new THREE.Vector3(hw, hh, hd), new THREE.Vector3(-hw, hh, hd),
          ];
          const pairs = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
          g.add(_fatEdgeGroup(v, pairs, EDGE_TUBE_T * 0.55, edgeMat));
        } else {
          g.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), edgeMat));
        }
        return g;
      }

      grp.add(_ebox(W, H, D));
      const front = D / 2 + 0.002;
      _makeConeDriver(0, 0, front, W * 0.38, false, color, opacity).forEach(o => grp.add(o));

      return grp;
    }

    /* ------------------------------------------
       HORIZONTAL STUDIO MONITOR BUILDER
       Wide box, dual woofers, center tweeter.
    ------------------------------------------ */
    function _buildHorizontalStudioMonitor(W, H, D, color, opacity) {
      const grp = new THREE.Group();
      const edgeMat = useFatEdges
        ? new THREE.MeshBasicMaterial({ color, transparent: true, opacity })
        : new THREE.LineBasicMaterial({ color, transparent: true, opacity });

      function _ebox(w, h, d) {
        const g = new THREE.Group();
        if (useFatEdges) {
          const hw = w / 2, hh = h / 2, hd = d / 2;
          const v = [
            new THREE.Vector3(-hw, -hh, -hd), new THREE.Vector3(hw, -hh, -hd),
            new THREE.Vector3(hw, -hh, hd), new THREE.Vector3(-hw, -hh, hd),
            new THREE.Vector3(-hw, hh, -hd), new THREE.Vector3(hw, hh, -hd),
            new THREE.Vector3(hw, hh, hd), new THREE.Vector3(-hw, hh, hd),
          ];
          const pairs = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
          g.add(_fatEdgeGroup(v, pairs, EDGE_TUBE_T * 0.55, edgeMat));
        } else {
          g.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), edgeMat));
        }
        return g;
      }

      grp.add(_ebox(W, H, D));
      const front = D / 2 + 0.002;
      
      const wooferR = H * 0.35;
      const tweeterR = H * 0.15;
      _makeConeDriver(-W * 0.28, 0, front, wooferR, false, color, opacity).forEach(o => grp.add(o));
      _makeConeDriver( W * 0.28, 0, front, wooferR, false, color, opacity).forEach(o => grp.add(o));
      _makeConeDriver( 0,        0, front, tweeterR, true,  color, opacity).forEach(o => grp.add(o));

      return grp;
    }

    /* ------------------------------------------
       STATEMENT SPEAKER BUILDER
       Tapered monolith: wide at base, narrows toward top, front baffle
       angled back for time-alignment. Chamfered front corners. Wilson-style.
    ------------------------------------------ */
    function _buildStatementSpeaker(W, H, D, color, opacity) {
      const grp = new THREE.Group();
      const edgeMat = useFatEdges
        ? new THREE.MeshBasicMaterial({ color, transparent: true, opacity })
        : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
      const T = EDGE_TUBE_T * 0.55;

      function edges(verts, pairs) {
        return _fatEdgeGroup(verts, pairs, T, edgeMat);
      }

      const yB = -H / 2;
      const yT = H / 2;

      // Base footprint (wide)
      const hw_b = W / 2;
      const hd_b = D / 2;
      const ch_b = W * 0.09;    // front-corner chamfer at base

      // Top footprint (significantly narrower; front face pulled back = slant)
      const hw_t = W * 0.30;
      const hd_t = D * 0.42;
      const ch_t = W * 0.06;
      const slant = D * 0.38;   // top-front pulled toward rear vs bottom-front

      // +Z = front of speaker (faces listener)
      // 12 vertices: 6 bottom (0-5) + 6 top (6-11)
      const v = [
        // ── bottom ring ──
        new THREE.Vector3(-hw_b + ch_b, yB, hd_b),  // 0 front-left
        new THREE.Vector3(hw_b - ch_b, yB, hd_b),  // 1 front-right
        new THREE.Vector3(hw_b, yB, hd_b - ch_b),  // 2 right-front chamfer
        new THREE.Vector3(hw_b, yB, -hd_b),  // 3 rear-right
        new THREE.Vector3(-hw_b, yB, -hd_b),  // 4 rear-left
        new THREE.Vector3(-hw_b, yB, hd_b - ch_b),  // 5 left-front chamfer
        // ── top ring (slanted: front pulled back) ──
        new THREE.Vector3(-hw_t + ch_t, yT, hd_t - slant),  // 6 front-left
        new THREE.Vector3(hw_t - ch_t, yT, hd_t - slant),  // 7 front-right
        new THREE.Vector3(hw_t, yT, hd_t - ch_t - slant),  // 8 right-front chamfer
        new THREE.Vector3(hw_t, yT, -hd_t),  // 9 rear-right
        new THREE.Vector3(-hw_t, yT, -hd_t),  // 10 rear-left
        new THREE.Vector3(-hw_t, yT, hd_t - ch_t - slant),  // 11 left-front chamfer
      ];

      const pairs = [
        [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0],       // bottom ring
        [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 6],    // top ring
        [0, 6], [1, 7], [2, 8], [3, 9], [4, 10], [5, 11],      // verticals
      ];

      grp.add(edges(v, pairs));

      // ── Plinth ──
      const pH = 0.04;
      const phw = hw_b + 0.03;
      const phd = hd_b + 0.02;
      const py = yB - pH;
      const BOX_PAIRS = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
      const pv = [
        new THREE.Vector3(-phw, py, -phd), new THREE.Vector3(phw, py, -phd),
        new THREE.Vector3(phw, py, phd), new THREE.Vector3(-phw, py, phd),
        new THREE.Vector3(-phw, py + pH, -phd), new THREE.Vector3(phw, py + pH, -phd),
        new THREE.Vector3(phw, py + pH, phd), new THREE.Vector3(-phw, py + pH, phd),
      ];
      grp.add(edges(pv, BOX_PAIRS));

      // ── Driver cones on the slanted front baffle ──
      // baffleZ() interpolates the baffle face Z at each driver height so cones
      // sit correctly on the angled front face of the statement cabinet.
      function baffleZ(cy) {
        const t = (cy - yB) / H;
        return hd_b + (hd_t - slant - hd_b) * t + 0.005;
      }

      [
        { y: yB + H * 0.15, r: W * 0.17, isTweeter: false },  // woofer 1
        { y: yB + H * 0.35, r: W * 0.17, isTweeter: false },  // woofer 2
        { y: yB + H * 0.60, r: W * 0.12, isTweeter: false },  // midrange
        { y: yB + H * 0.78, r: W * 0.055, isTweeter: true },  // tweeter
      ].forEach(({ y, r, isTweeter }) => {
        _makeConeDriver(0, y, baffleZ(y), r, isTweeter, color, opacity).forEach(o => grp.add(o));
      });

      return grp;
    }

    /* ------------------------------------------
       ELECTROSTATIC / PANEL SPEAKER BUILDER
       Tall thin membrane panel: outer frame, horizontal braces, plinth,
       rear transformer box. Dipole — no driver rings, no cabinet depth.
    ------------------------------------------ */
    function _buildElectrostaticSpeaker(W, H, D, color, opacity) {
      const grp = new THREE.Group();
      const edgeMat = useFatEdges
        ? new THREE.MeshBasicMaterial({ color, transparent: true, opacity })
        : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
      const dimMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: opacity * 0.45 });
      const T = EDGE_TUBE_T * 0.55;

      function edges(verts, pairs) {
        return _fatEdgeGroup(verts, pairs, T, edgeMat);
      }
      function dimEdges(verts, pairs) {
        return _fatEdgeGroup(verts, pairs, T * 0.5, dimMat);
      }

      const yB = -H / 2;
      const yT = H / 2;
      const hw = W / 2;
      const hd = D / 2;

      // ── Outer panel frame (the membrane boundary) ──
      const BOX_PAIRS = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
      const frameVerts = [
        new THREE.Vector3(-hw, yB, -hd), new THREE.Vector3(hw, yB, -hd),
        new THREE.Vector3(hw, yB, hd), new THREE.Vector3(-hw, yB, hd),
        new THREE.Vector3(-hw, yT, -hd), new THREE.Vector3(hw, yT, -hd),
        new THREE.Vector3(hw, yT, hd), new THREE.Vector3(-hw, yT, hd),
      ];
      grp.add(edges(frameVerts, BOX_PAIRS));

      // ── Horizontal braces across the membrane face (front) ──
      const braceZ = hd + 0.003;
      const braceFractions = [0.20, 0.40, 0.60, 0.80];
      braceFractions.forEach(f => {
        const by = yB + H * f;
        const bv = [
          new THREE.Vector3(-hw, by, braceZ), new THREE.Vector3(hw, by, braceZ),
        ];
        const bg = new THREE.BufferGeometry().setFromPoints(bv);
        grp.add(new THREE.Line(bg, dimMat));
      });

      // ── Plinth ──
      const plH = 0.06;
      const plHW = hw + 0.04;
      const plHD = hd + 0.06;
      const plY = yB - plH;
      const plVerts = [
        new THREE.Vector3(-plHW, plY, -plHD), new THREE.Vector3(plHW, plY, -plHD),
        new THREE.Vector3(plHW, plY, plHD), new THREE.Vector3(-plHW, plY, plHD),
        new THREE.Vector3(-plHW, plY + plH, -plHD), new THREE.Vector3(plHW, plY + plH, -plHD),
        new THREE.Vector3(plHW, plY + plH, plHD), new THREE.Vector3(-plHW, plY + plH, plHD),
      ];
      grp.add(dimEdges(plVerts, BOX_PAIRS));

      // ── Rear transformer box (sits behind panel at the base) ──
      const tbW = W * 0.35;
      const tbH = H * 0.14;
      const tbD = D * 2.2;
      const tbHW = tbW / 2;
      const tbHH = tbH / 2;
      const tbHD = tbD / 2;
      const tbY = yB + tbH / 2;
      const tbZ = -hd - tbHD;
      const tbVerts = [
        new THREE.Vector3(-tbHW, tbY - tbHH, tbZ - tbHD), new THREE.Vector3(tbHW, tbY - tbHH, tbZ - tbHD),
        new THREE.Vector3(tbHW, tbY - tbHH, tbZ + tbHD), new THREE.Vector3(-tbHW, tbY - tbHH, tbZ + tbHD),
        new THREE.Vector3(-tbHW, tbY + tbHH, tbZ - tbHD), new THREE.Vector3(tbHW, tbY + tbHH, tbZ - tbHD),
        new THREE.Vector3(tbHW, tbY + tbHH, tbZ + tbHD), new THREE.Vector3(-tbHW, tbY + tbHH, tbZ + tbHD),
      ];
      grp.add(dimEdges(tbVerts, BOX_PAIRS));

      return grp;
    }

    /* ------------------------------------------
            SPEAKERS + BEAMS (LEVEL AXIS LOCK)
        ------------------------------------------ */
    // Reset speaker refs — will be set below when speakers are built
    _spkMeshL = null; _spkMeshR = null;
    _beamGeoL = null; _beamGeoR = null;
    _cableGroupL = null; _cableGroupR = null;

    if (renderStage === "speakers" || renderStage === "furnishings") {
      const toeRad = (room.toe_in_deg || 0) * Math.PI / 180;
      const baseY = -room.height_m / 2;

      const speakerSides = (room.room_type === 'club' && room.rear_pa) ? ["L", "R", "RearL", "RearR"] : ["L", "R"];
      speakerSides.forEach(side => {
        const isRear = side.startsWith("Rear");
        const logicalSide = isRear ? side.slice(4) : side;
        // Cinema in-wall front stage: the L/C/R are redrawn as flush wireframe
        // panels on the front wall (in the cinema prop block below), so the shared
        // box front pair is suppressed here. Cinema-gated — hi-fi, studio and
        // treatment never carry front_placement 'inwall', so their path is
        // unchanged. Refs left null are tolerated by every consumer (auto-toe,
        // cables, slider) via their existing null guards.
        if (room.room_type === 'cinema' && room.front_placement === 'inwall') return;
        const profile = getSpeakerProfile(room.speaker_type);
        const isSpkHighlit = highlightTarget === 'speakers';

        const spkColor = isSpkHighlit ? 0x0f766e : profile.color;
        const spkOpacity = isSpkHighlit ? 0.9 : Math.max(OP_OBJ, 0.80);

        const speaker = (room.room_type === 'studio' && room.speaker_orientation === 'horizontal')
          ? _buildHorizontalStudioMonitor(0.64, 0.26, 0.32, spkColor, spkOpacity)
          : profile.isStatement
            ? _buildStatementSpeaker(profile.w, profile.h, profile.d, spkColor, spkOpacity)
            : profile.isPanel
              ? _buildElectrostaticSpeaker(profile.w, profile.h, profile.d, spkColor, spkOpacity)
              : profile.isBassBin
                ? _buildBassBinSpeaker(profile.w, profile.h, profile.d, spkColor, spkOpacity)
                : profile.detailed
                  ? _buildDetailedSpeaker(profile.w, profile.h, profile.d, spkColor, spkOpacity)
                  : _buildStandmountSpeaker(profile.w, profile.h, profile.d, spkColor, spkOpacity);

        // X position — every speaker sits at ±spk_spacing_m/2 from
        // offsetX. In studio mode room.spk_spacing_m is overridden
        // upstream (~line 770, Option B) to derive from desk_width_m,
        // so speakers track the desk edges at 10 cm inset. In Hi-Fi
        // mode room.spk_spacing_m is the user's slider value.
        const x = offsetX + (logicalSide === "L" ? -1 : 1) * room.spk_spacing_m / 2;

        // Z anchor — every placement honours spk_front_m so the visible
        // speakers sit at the same Z the overlay code assumes
        // (-halfL + spk_front_m for SBIR speaker sources, side_reflections
        // speakerPositions, wave-ring waveZ). Studio meshes stay in
        // world space (not parented under rigGroup) — same world Z
        // gets the same visual co-location as parenting would, with
        // zero churn to the toe-rotation / beam / cable code below.
        const speakerZ = isRear ? (room.length_m / 2 - 0.35) : (-room.length_m / 2 + room.spk_front_m);

        let y, z;
        if (profile.onDesk && room.spk_placement === 'stands') {
          // Nearfield monitors on floor stands — tweeter height driven by slider
          const standTweeterH = room.tweeter_height_m || 1.1;
          const tweeterOffsetFromCenter = (profile.h / 2) - (profile.h * (profile.tweeterPos || 0.5));
          y = baseY + standTweeterH + tweeterOffsetFromCenter;
          z = speakerZ;
        } else if (profile.onDesk && room.spk_placement === 'desk_stands') {
          // Short isolation stands on the desk surface — raises monitor ~7 cm.
          // Production desk style lifts the whole stand onto the back riser so
          // the isolation pad rests on the platform top (same RISER_H as 'desk').
          const riserH = 0.07;
          const prodLift = (room.desk_style === 'production') ? (RISER_H + POST_RISE) : 0;
          const deskSurface = baseY + 0.775 + prodLift;
          y = deskSurface + riserH + profile.h / 2;
          z = speakerZ;
        } else if (profile.onDesk) {
          // Desk monitors: snap to desk surface (desk top at 0.775 m above floor).
          // Production desk style raises them onto the back riser; RISER_H is the
          // same constant the desk builder uses so monitor and riser never drift.
          const deskSurface = baseY + 0.775;
          const riserLift = (room.desk_style === 'production') ? (RISER_H + POST_RISE) : 0;
          y = deskSurface + riserLift + profile.h / 2;
          z = speakerZ;
        } else if (profile.isWallMount) {
          // Club pa_top: wall bracket at height, small standoff from the
          // front wall for the bracket arm — not floor-anchored, not a
          // pole/hi-fi stand. Rear pair (rear_pa) mounts on the back wall
          // instead — was hardcoded to the front wall for every pa_top,
          // which put RearL/RearR at the exact same position as L/R
          // (invisible overlap, not actually missing).
          y = baseY + (room.pa_mount_height_m ?? 3.0);
          z = isRear ? (room.length_m / 2 - 0.35) : (-room.length_m / 2 + 0.35);
        } else if (profile.floorStand) {
          // Floor-standing panels / statement: plinth bottom sits on rug
          // surface, cabinet bottom sits on top of plinth.
          y = baseY + rugRaise + (profile.plinthH ?? 0) + profile.h / 2;
          z = -room.length_m / 2 + room.spk_front_m;
        } else {
          // Standmounts & floorstanders: cabinet stays fixed, only beam moves.
          // Floorstanders: built-in plinth sits on rug. Standmounts: fixed
          // 0.64 m external stand (post + base plate) — no plinth.
          const isFloorstander = profile.detailed; // detailed build = floorstander
          if (isFloorstander) {
            y = baseY + rugRaise + (profile.plinthH ?? 0) + profile.h / 2;
          } else {
            const fixedStandH = 0.64;               // standard 24" stand
            y = baseY + rugRaise + fixedStandH + profile.h / 2;
          }
          z = -room.length_m / 2 + room.spk_front_m;
        }

        // True world-space tweeter height, derived the same way for every
        // mounting branch above: cabinet bottom (y - h/2) + cabinet height
        // × the archetype's tweeterPos fraction. The wave rings below use
        // this instead of the raw tweeter_height_m slider value — that
        // value only matches reality for the 'onDesk + stands' branch
        // (which solves for y FROM the slider); desk-surface, floorstander,
        // statement and panel mounts all derive y from the desk height, a
        // plinth, or a fixed stand height, so the slider alone silently put
        // the rings at the wrong height for those configs (e.g. every
        // Studio desk-mounted monitor).
        const tweeterY = (y - profile.h / 2) + profile.h * (profile.tweeterPos ?? 0.5);

        // Wrap cabinet (+ optional stand) in a group so toe rotation is shared
        const spkGroup = new THREE.Group();
        spkGroup.position.set(x, y, z);
        spkGroup.add(speaker); // cabinet sits at group origin (= cabinet centre)

        // Riser block for desk stands
        if (profile.onDesk && room.spk_placement === 'desk_stands') {
          const riserH = 0.07;
          const deskSurface = baseY + 0.775;
          const riserMat = new THREE.LineBasicMaterial({
            color: spkColor, transparent: true, opacity: spkOpacity * 0.55
          });
          const riser = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(profile.w + 0.04, riserH, profile.d + 0.02)), riserMat
          );
          riser.position.y = -(profile.h / 2) - riserH / 2;
          spkGroup.add(riser);
        }

        // Stand for monitors on floor stands
        if (profile.onDesk && room.spk_placement === 'stands') {
          // Stand spans rug-top → cabinet-bottom; subtract rugRaise so the
          // post sits ON the rug instead of piercing it down to the floor.
          const standHeight = (y - profile.h / 2) - baseY - rugRaise;
          const standMat = new THREE.LineBasicMaterial({
            color: spkColor, transparent: true, opacity: spkOpacity * 0.65
          });
          const post = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(0.04, standHeight, 0.04)), standMat
          );
          post.position.y = -(profile.h / 2) - standHeight / 2;
          spkGroup.add(post);
          const base = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(0.28, 0.02, 0.24)), standMat
          );
          base.position.y = -(profile.h / 2) - standHeight + 0.01;
          spkGroup.add(base);
        }

        // Stand for standmounts: thin post + base plate
        if (!profile.onDesk && !profile.floorStand && !profile.detailed && !profile.isWallMount) {
          // Stand spans rug-top → cabinet-bottom; subtract rugRaise so the
          // post sits ON the rug instead of piercing it down to the floor.
          const standHeight = (y - profile.h / 2) - baseY - rugRaise;
          const standMat = new THREE.LineBasicMaterial({
            color: spkColor, transparent: true, opacity: spkOpacity * 0.65
          });
          const post = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(0.05, standHeight, 0.05)), standMat
          );
          post.position.y = -(profile.h / 2) - standHeight / 2;
          spkGroup.add(post);
          const base = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(0.32, 0.03, 0.28)), standMat
          );
          base.position.y = -(profile.h / 2) - standHeight + 0.015;
          spkGroup.add(base);
        }

        // Initial toe-in (may be overridden by _applyAutoToe after rebuild).
        // Rear pair needs the toe SIGN negated: adding the +π yaw flip
        // below (needed so it faces into the room from the back wall
        // instead of firing into it) also reverses which sign of yaw
        // points the forward vector inward vs outward — same composition
        // quirk as the tilt fix above. Without this, rear toes out while
        // front toes in.
        spkGroup.rotation.y = (logicalSide === "L" ? 1 : -1) * toeRad * (isRear ? -1 : 1);
        // Rear pair mounts on the back wall facing the opposite direction
        // from the front pair (into the room from the other end) — without
        // this flip they'd face into the back wall, firing away from the
        // floor entirely. The bracket below is a child of spkGroup, so it
        // inherits this flip and points at the correct (rear) wall too.
        if (profile.isWallMount && isRear) spkGroup.rotation.y += Math.PI;

        // Wall bracket: plate flush to the front wall + a diagonal arm to
        // the cabinet back, plus the downward tilt a permanent install
        // aims into the room. Geometry only, no animation.
        if (profile.isWallMount) {
          // Aim at ear height on the dance floor centre, not an arbitrary
          // fixed angle — the tilt is *derived* from mount height and the
          // distance to that point, so raising/lowering the bracket (or
          // resizing the room) keeps the aim correct automatically.
          const EAR_HEIGHT_M = 1.7;
          const targetY = baseY + EAR_HEIGHT_M;
          const targetZ = -room.length_m / 2 + (room.listener_front_m || room.length_m / 2);
          // Rear pair faces the opposite way (180° yaw above), so its local
          // forward distance to the target runs the other direction —
          // without this the atan2 below picks up the wrong quadrant
          // entirely (an ~164° rotation instead of ~15°), not just a sign flip.
          const forwardDist = isRear ? (z - targetZ) : (targetZ - z);
          const tiltRad = Math.atan2(y - targetY, forwardDist);
          // +tiltRad tips the forward axis (local +Z) downward for the
          // front pair (no yaw). For the rear pair, THREE's Euler 'XYZ'
          // composes as Rx * Ry * Rz applied to the local vector -- i.e.
          // the 180° yaw (rotation.y, set above) is applied to the vector
          // BEFORE the tilt, not after. That reverses which sign of
          // rotation.x reads as "down" once the yaw has flipped the local
          // forward axis, so the rear pair needs the negated angle here,
          // not the same sign as front. (Verified against THREE's actual
          // Matrix4.makeRotationFromEuler formula, not assumed.)
          spkGroup.rotation.x = isRear ? -tiltRad : tiltRad;

          const bracketMat = new THREE.LineBasicMaterial({
            color: spkColor, transparent: true, opacity: spkOpacity * 0.65
          });
          const plate = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(0.18, 0.24, 0.03)), bracketMat
          );
          plate.position.set(0, 0, -(profile.d / 2) - 0.16);
          spkGroup.add(plate);
          const arm = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(0.05, 0.05, 0.28)), bracketMat
          );
          arm.position.set(0, 0, -(profile.d / 2) - 0.14);
          spkGroup.add(arm);
        }

        // --- BEAMS ---
        // Beam is in speaker-local space. We want its world Y at tweeter
        // height above the rug surface (or above the rug + plinth on floor-
        // standing speakers, so the beam stays aligned with the cabinet's
        // tweeter after the plinth-aware lift).
        // pa_top has no "tweeter height" concept — it's wall-bracket mounted
        // and already aimed via the cabinet's own pivot rotation, so the
        // beam should originate at the cabinet centre (local 0), not the
        // tweeter-height offset the hi-fi archetypes use.
        const targetBeamWorldY = baseY + rugRaise + (profile.plinthH ?? 0) + (room.tweeter_height_m || 0.95);
        const beamLocalY = profile.isWallMount ? 0 : targetBeamWorldY - y;  // y is spkGroup world Y
        // pa_top: stop the beam exactly at the ear-height aim point instead
        // of running the full room length — the beam is drawn in the
        // cabinet's own (already-tilted) local space, so a length equal to
        // the straight-line distance to the target lands the far end
        // precisely there once rotation.x carries it down. The full-room-
        // length line used everywhere else massively overshot the target,
        // which visually read as "barely tilted" over a 10m+ line even
        // once the actual angle was correct.
        const beamZ = profile.isWallMount
          ? Math.hypot(y - (baseY + 1.7), Math.abs(z - (-room.length_m / 2 + (room.listener_front_m || room.length_m / 2))) || 0.01)
          : room.length_m;
        const beamGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, beamLocalY, 0),
          new THREE.Vector3(0, beamLocalY, beamZ)
        ]);
        const beam = new THREE.Line(
          beamGeo,
          new THREE.LineDashedMaterial({
            color: spkColor,
            dashSize: 0.25,
            gapSize: 0.15,
            transparent: true,
            opacity: isSpkHighlit ? 0.85 : 0.45
          })
        );
        beam.computeLineDistances();
        beam.userData.isSpeakerBeam = true;
        // Beam shows the speaker's aim axis — most useful when adjusting
        // toe-in. Always visible: previously suppressed when any overlay
        // was focused, but that hid the beams from the SETUP tab too once
        // the user had ever picked an overlay (focusedOverlay persists
        // across tab switches).

        speaker.add(beam);
        roomGroup.add(spkGroup);

        // ── Wave rings — expanding circles at tweeter height ──────────────
        // When REW data is loaded (_rewFreqs/_rewMags), each ring samples the
        // measured magnitude at one octave of the SBIR null frequency so colour
        // and peak opacity reflect actual acoustic energy, not simulation.
        if (_wavesEnabled && _topsWavesOn) {
          const NUM_RINGS = 5;
          const maxR = Math.max(room.length_m, room.width_m) * WAVE_EXTENT_FACTOR;
          const waveY = tweeterY;

          // ── Side-wall clipping planes — contain the rings inside the room ──
          // World-space planes matching the room shell's side walls (±width/2,
          // ±length/2 in roomGroup-local, scaled by baseScale into world space).
          // The shell is centred at local x=0/z=0 (offsetX shifts only the
          // speakers/listener, never the shell — see shell verts at ~hW/hL), so
          // the planes are too. Created once and reused; only .constant changes
          // when dimensions change, so no per-rebuild allocation. The maxR cap
          // above is left as a generous outer limit; these planes do the real
          // containment. This block runs once per side (L/R) — updating the
          // shared constants twice is harmless and allocates nothing.
          const clipHalfW = (room.width_m / 2) * baseScale;
          const clipHalfL = (room.length_m / 2) * baseScale;
          if (!_waveClipPlanes) {
            _waveClipPlanes = [
              new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0), // +X wall
              new THREE.Plane(new THREE.Vector3( 1, 0, 0), 0), // -X wall
              new THREE.Plane(new THREE.Vector3(0, 0, -1), 0), // +Z wall
              new THREE.Plane(new THREE.Vector3(0, 0,  1), 0), // -Z wall
            ];
          }
          _waveClipPlanes[0].constant = clipHalfW;
          _waveClipPlanes[1].constant = clipHalfW;
          _waveClipPlanes[2].constant = clipHalfL;
          _waveClipPlanes[3].constant = clipHalfL;
          const waveZ = -room.length_m / 2 + room.spk_front_m;
          // logicalSide (not raw side) so RearL/RearR mirror the same way
          // as L/R instead of both landing on the +X side.
          const waveX = offsetX + (logicalSide === 'L' ? -1 : 1) * room.spk_spacing_m / 2;

          // ── Per-ring amplitude from REW mags (0..1) ───────────────────────
          // Geometric SBIR null: f₀ = c / (4d), then one octave per ring.
          // dBFS range clamped to -60..0; deeper null → lower amp → dimmer/cooler ring.
          const sbirNullHz = 343 / (4 * Math.max(room.spk_front_m, 0.2));
          const ringAmps   = [];
          if (_rewFreqs && _rewMags && _rewFreqs.length > 0) {
            for (let ri = 0; ri < NUM_RINGS; ri++) {
              const targetHz = sbirNullHz * Math.pow(2, ri);
              // Binary search nearest frequency bin
              let lo = 0, hi = _rewFreqs.length - 1;
              while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (_rewFreqs[mid] < targetHz) lo = mid + 1; else hi = mid;
              }
              const dBFS = _rewMags[lo] ?? -60;
              // Map -60..0 dBFS → 0..1 (0=deep null, 1=full energy)
              ringAmps.push(Math.max(0, Math.min(1, (dBFS + 60) / 60)));
            }
          } else {
            // Simulation mode — full amplitude on all rings
            for (let ri = 0; ri < NUM_RINGS; ri++) ringAmps.push(1.0);
          }

          // Unit-circle tube geometry, shared across the 5 rings for this
          // speaker. WebGL ignores LineBasicMaterial.linewidth, so a real
          // tube primitive is the only way to get a tuneable stroke width.
          // The mesh is then non-uniformly scaled (r,1,r) per frame to
          // expand the ring outward — radial tube thickness scales with r,
          // vertical thickness stays constant.
          const circleCurvePts = [];
          const CIRCLE_SEG = 72;
          for (let j = 0; j < CIRCLE_SEG; j++) {
            const a = (j / CIRCLE_SEG) * Math.PI * 2;
            circleCurvePts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
          }
          const ringCurve = new THREE.CatmullRomCurve3(circleCurvePts, true);
          const ringGeo   = new THREE.TubeGeometry(ringCurve, 72, 0.02, 8, true);

          for (let ri = 0; ri < NUM_RINGS; ri++) {
            const amp = ringAmps[ri];
            // Colour: cyan (HSL 0.50) at full energy → magenta (HSL 0.83) at deep null.
            const ringColor = new THREE.Color().setHSL(
              0.50 + (1 - amp) * 0.33,   // 0.50=cyan → 0.83=magenta
              0.90,
              0.55
            );
            const ringMat = new THREE.MeshBasicMaterial({
              color: ringColor,
              transparent: true,
              opacity: 0,
              depthWrite: false,
              // Contain the expanding ring at the room's side walls. Shared,
              // reused Plane objects — see _waveClipPlanes. Only this material
              // type carries clippingPlanes in the whole scene.
              clippingPlanes: _waveClipPlanes,
            });
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.position.set(waveX, waveY, waveZ);
            ring.rotation.copy(spkGroup.rotation);
            ring.userData.wavePhase   = ri / NUM_RINGS;
            ring.userData.waveMaxR    = maxR;
            ring.userData.waveAmp     = amp;   // animate() uses this to scale peak opacity
            ring.userData.speakerSide = side;  // 'L'|'R' — animate's interference calc buckets by this
            roomGroup.add(ring);
            _waveRings.push(ring);
          }

          // Stash this speaker's tweeter position for the per-frame
          // interference calc in animate(). Build the MLP indicator once
          // per rebuild, gated to the L pass so it doesn't double-spawn.
          if (side === 'L' && !isRear) {
            _spkLeftLocalPos.set(waveX, waveY, waveZ);

            // MLP math inlined from the side-reflections overlay
            // (~line 3794). effectiveHeadHeight isn't in scope here yet —
            // it's declared further down in the listen-station block — so
            // the studio/sofa ear height is recomputed locally.
            const _seatType = room.seating_type || 'sofa';
            const _effHead  = isStudio ? 1.22 : 0.82;
            const _sphereZ  = isStudio ? 0.20    : (_seatType === 'lounge' ? 0.38 : 0.28);
            const _sphereY  = room.room_type === 'club' ? 1.7 : (isStudio ? _effHead : (_seatType === 'lounge' ? 1.00 : 0.96));
            const _halfH    = room.height_m / 2;
            const _halfL    = room.length_m / 2;
            _mlpLocalPos.set(
              offsetX + (room.listener_offset_m || 0),
              -_halfH + _sphereY,
              -_halfL + room.listener_front_m + _sphereZ
            );

            // Visualises the CONCEPT of constructive interference at the
            // listening position. The wave-rings system propagates at
            // ~1.5 m/s for visual rhythm, not 343 m/s, so this is NOT an
            // audio-rate interference simulation — the SBIR shader plane
            // remains the measured-energy layer.
            const INDICATOR_COLOUR = 0xFFD466;   // warm mid-yellow, dedicated — not OC.TREATED_CYAN / PRESSURE_PEAK.
            _interferenceIndicator = new THREE.Mesh(
              new THREE.RingGeometry(0, 0.35, 64),
              new THREE.MeshBasicMaterial({
                color:       INDICATOR_COLOUR,
                transparent: true,
                opacity:     0,
                depthWrite:  false,
                blending:    THREE.AdditiveBlending,
                side:        THREE.DoubleSide,
              })
            );
            _interferenceIndicator.rotation.x = -Math.PI / 2;          // lay flat on XZ
            _interferenceIndicator.position.set(
              _mlpLocalPos.x,
              -_halfH + 0.005,                                          // 5 mm above floor, dodges z-fighting
              _mlpLocalPos.z
            );
            roomGroup.add(_interferenceIndicator);
          } else {
            _spkRightLocalPos.set(waveX, waveY, waveZ);
          }
        }

        // Store refs for live auto-toe updates (Group supports .rotation.y same as Mesh)
        if (side === 'L') { _spkMeshL = spkGroup; _beamGeoL = beamGeo; }
        else { _spkMeshR = spkGroup; _beamGeoR = beamGeo; }
      });

    }

    /* ------------------------------------------
      LISTEN STATION GROUP
      Sphere + rug + sofa + coffee table anchored at the listen position.
    ------------------------------------------ */

    const listenerZ = -room.length_m / 2 + room.listener_front_m;
    const effectiveHeadHeight = isStudio
      ? 1.22  // seated ear height at a desk (~desk surface 0.75m + ~0.47m seated posture)
      : 0.82; // seated ear height on a sofa — sofa back tops at ~0.80m

    // Dark charcoal outline so edges pop clearly against the light background.
    const furnEdgeMat = useFatEdges
      ? new THREE.MeshBasicMaterial({
        color: 0x1a1714, // Dark charcoal
        transparent: false,
        depthTest: true,
        depthWrite: true
      })
      : new THREE.LineBasicMaterial({
        color: 0x1a1714, // Dark charcoal
        transparent: false,
        depthTest: true,
        depthWrite: true
      });

    // Returns a Group containing edge outlines only — no fill mesh so there are
    // no triangle diagonals bleeding through on top of the edge lines.
    function _ghostBox(w, h, d) {
      const geo = new THREE.BoxGeometry(w, h, d);
      const grp = new THREE.Group();
      if (useFatEdges) {
        const hw = w / 2, hh = h / 2, hd = d / 2;
        const v = [
          new THREE.Vector3(-hw, -hh, -hd), new THREE.Vector3(hw, -hh, -hd),
          new THREE.Vector3(hw, -hh, hd), new THREE.Vector3(-hw, -hh, hd),
          new THREE.Vector3(-hw, hh, -hd), new THREE.Vector3(hw, hh, -hd),
          new THREE.Vector3(hw, hh, hd), new THREE.Vector3(-hw, hh, hd),
        ];
        const pairs = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
        grp.add(_fatEdgeGroup(v, pairs, EDGE_TUBE_T * 0.36, furnEdgeMat));
      } else {
        grp.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), furnEdgeMat));
      }
      return grp;
    }

    /* ------------------------------------------
       HI-FI RACK + SUBWOOFER (home room only)
       Rack sits centre against the front wall.
       Sub sits to the right of the rack when enabled.
       Gated to 'home' explicitly — excluded for studio (as before) and for
       cinema (a blank shell inherits no home furniture).
    ------------------------------------------ */
    if (room.room_type === 'home' && (renderStage === 'speakers' || renderStage === 'furnishings')) {
      const floorY = -room.height_m / 2;

      // ── Hi-Fi rack — "High-End Stealth" aesthetic ──────────────────────────
      // Table frame: dark charcoal wireframe (consistent with room cage).          
      // Stacked components (amp, integrated, streamer, DAC): solid MeshStandardMaterial
      // — reads as real black boxes under the ambient + point lighting.
      const rackW = 0.62, rackD = 0.44;
      const rackWallZ = -room.length_m / 2 + rackD / 2 + 0.05;
      const legH = 0.34, legT = 0.045;
      const topH = 0.045;
      const tableTopY = legH + topH / 2;

      // Solid fill material for stacked electronics — charcoal, brushed-metal look.
      // Lightened from 0x111111 (near-black) to 0x2a2a2a so the four components
      // read as a stack of separate boxes against the cream canvas instead of
      // dissolving into a single dark blob.
      const _compMat = new THREE.MeshStandardMaterial({
        color: 0x2a2a2a,  // Medium charcoal — visible component separation
        roughness: 0.45,
        metalness: 0.45,
      });
      // Edge highlight — bumped from 0x2e2e2e → 0x666666 so the gaps between
      // stacked components are legible.
      const _compEdgeMat = new THREE.LineBasicMaterial({
        color: 0x666666, transparent: true, opacity: 0.70,
      });
      function _stealthComp(w, h, d) {
        const grp = new THREE.Group();
        // Solid body
        grp.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), _compMat));
        // Fine edge overlay so geometry reads clearly
        grp.add(new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), _compEdgeMat
        ));
        return grp;
      }

      const rack = new THREE.Group();

      // Table top (wireframe, same as other furniture)
      const rTop = _ghostBox(rackW, topH, rackD);
      rTop.position.y = tableTopY;
      rack.add(rTop);

      // 4 legs
      const lx = rackW / 2 - 0.05, lz = rackD / 2 - 0.05;
      [[-lx, legH / 2, -lz], [lx, legH / 2, -lz],
      [-lx, legH / 2, lz], [lx, legH / 2, lz]].forEach(([px, py, pz]) => {
        const leg = _ghostBox(legT, legH, legT);
        leg.position.set(px, py, pz);
        rack.add(leg);
      });

      // Stacked components — mono block pair (larger), integrated, streamer, DAC
      const compW = rackW - 0.06, compD = rackD - 0.06, compGap = 0.016;
      const compHeights = [0.12, 0.12, 0.07, 0.06];
      let _curCompY = legH + topH;
      compHeights.forEach(h => {
        const comp = _stealthComp(compW, h, compD);
        comp.position.y = _curCompY + h / 2;
        rack.add(comp);
        _curCompY += h + compGap;
      });

      rack.position.set(offsetX, floorY + rugRaise, rackWallZ);
      roomGroup.add(rack);

      // ── Speaker cables ─────────────────────────────────────────────────────
      // CatmullRomCurve3 cable from each speaker back → floor → Hi-Fi rack.
      // Automatically rebuilt whenever rebuild() runs (roomGroup.clear() wipes old
      // cables) so they track speaker moves from sliders and 3D drag, and reset
      // correctly when the Reset button fires.
      if (_spkMeshL && _spkMeshR) {
        const _profile = getSpeakerProfile(room.speaker_type);
        // Standmount: no floorStand, no onDesk, not a detailed/statement/panel build
        const _isStandmount = !_profile.onDesk && !_profile.floorStand &&
          !_profile.detailed && !_profile.isStatement && !_profile.isPanel;

        const _cblMat = new THREE.MeshBasicMaterial({
          color: 0x1a1714,
          transparent: true,
          opacity: 0.78,
          depthWrite: false,
        });

        // Per-side binding post targets — L cable terminates left of rack centre,
        // R cable right of rack centre, separated by ~28% of component width.
        const _bpOffset = (rackW - 0.06) * 0.28;  // ≈ 13.7 cm from centre
        const _rackBaseZ = rackWallZ - rackD / 2;   // rear face of rack
        const _rackBaseY = floorY + rugRaise + 0.40;
        const _rackTargetL = new THREE.Vector3(offsetX - _bpOffset, _rackBaseY, _rackBaseZ);
        const _rackTargetR = new THREE.Vector3(offsetX + _bpOffset, _rackBaseY, _rackBaseZ);

        [['L', _spkMeshL], ['R', _spkMeshR]].forEach(([side, spkGrp]) => {
          // Each cable uses its own rack target so they enter at different X positions
          const _rackTarget = side === 'L' ? _rackTargetL : _rackTargetR;
          const rearZ = spkGrp.position.z - _profile.d / 2;
          const spkX = spkGrp.position.x;

          let cablePoints;
          if (_isStandmount) {
            // Standmount: cable exits binding posts at bottom-rear of cabinet,
            // drops down the stand post to floor level, then runs to the rack.
            const bindingY = spkGrp.position.y - _profile.h * 0.35;  // near bottom of cabinet
            const standBaseY = floorY + rugRaise + 0.025;               // just above rug surface
            cablePoints = [
              new THREE.Vector3(spkX, bindingY, rearZ),               // binding post on cabinet back
              new THREE.Vector3(spkX, standBaseY, rearZ + 0.05),        // base of stand (rug top when active)
              new THREE.Vector3(spkX + (_rackTarget.x - spkX) * 0.28, floorY + rugRaise + 0.018, rearZ + (_rackTarget.z - rearZ) * 0.15),
              new THREE.Vector3(spkX + (_rackTarget.x - spkX) * 0.68, floorY + rugRaise + 0.010, rearZ + (_rackTarget.z - rearZ) * 0.72),
              _rackTarget.clone(),
            ];
          } else {
            // Floorstanders / floor-panels: exit near base of cabinet above
            // the plinth. Anchor to spkGrp.position.y so the exit follows the
            // plinth-aware lift; floor-running points stay at rug top + small
            // offset (they drape on the rug, not on the plinth).
            const cabinetBottomY = spkGrp.position.y - _profile.h / 2;
            const cableExitY = cabinetBottomY + Math.min(_profile.h * 0.10, 0.13);
            cablePoints = [
              new THREE.Vector3(spkX, cableExitY, rearZ),
              new THREE.Vector3(spkX + (_rackTarget.x - spkX) * 0.28, floorY + rugRaise + 0.018, rearZ + (_rackTarget.z - rearZ) * 0.15),
              new THREE.Vector3(spkX + (_rackTarget.x - spkX) * 0.68, floorY + rugRaise + 0.010, rearZ + (_rackTarget.z - rearZ) * 0.72),
              _rackTarget.clone(),
            ];
          }

          const curve = new THREE.CatmullRomCurve3(cablePoints);
          const tubeGeo = new THREE.TubeGeometry(curve, 32, 0.007, 4, false);
          const cable = new THREE.Mesh(tubeGeo, _cblMat);
          cable.userData.isSpeakerCable = true;
          cable.renderOrder = 2;
          roomGroup.add(cable);

          if (side === 'L') _cableGroupL = cable;
          else _cableGroupR = cable;
        });
      }

      // -- Subwoofer(s) --------------------------------------------------
      if (room.subwoofer) {
        const subColor = 0x3a3a3a;  // dark charcoal — readable against white scene
        const subW = 0.38, subH = 0.38, subD = 0.38;

        const subBodyMat = new THREE.MeshStandardMaterial({
          color: subColor, roughness: 0.55, metalness: 0.20,
          transparent: true, opacity: Math.max(OP_OBJ, 0.82),
        });
        const subEdgeMat = new THREE.LineBasicMaterial({
          color: 0x666666, transparent: true, opacity: 0.70,
        });
        const subDriverMat = new THREE.LineBasicMaterial({
          color: 0x888888, transparent: true, opacity: 0.55,
        });

        function _buildSub() {
          const grp = new THREE.Group();
          grp.add(new THREE.Mesh(new THREE.BoxGeometry(subW, subH, subD), subBodyMat));
          grp.add(new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(subW, subH, subD)), subEdgeMat
          ));
          const driverR = subW * 0.34;
          const dpts = [];
          for (let i = 0; i <= 36; i++) {
            const a = (i / 36) * Math.PI * 2;
            dpts.push(new THREE.Vector3(Math.cos(a) * driverR, Math.sin(a) * driverR, subD / 2 + 0.003));
          }
          grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(dpts), subDriverMat));
          const capR = driverR * 0.42;
          const cpts = [];
          for (let i = 0; i <= 24; i++) {
            const a = (i / 24) * Math.PI * 2;
            cpts.push(new THREE.Vector3(Math.cos(a) * capR, Math.sin(a) * capR, subD / 2 + 0.003));
          }
          grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(cpts), subDriverMat));
          return grp;
        }

        const _subCblMat = new THREE.MeshBasicMaterial({
          color: 0x2a2a2a, transparent: true, opacity: 0.70, depthWrite: false,
        });

        function _addSubCable(fromX, fromZ, toTarget) {
          const fY = -room.height_m / 2;
          // Sub body lifts by rugRaise so its cable exit + run-points lift to match.
          const exitY = fY + rugRaise + subH * 0.12;
          const pts = [
            new THREE.Vector3(fromX, exitY, fromZ - subD / 2),
            new THREE.Vector3(fromX + (toTarget.x - fromX) * 0.25, fY + rugRaise + 0.016, fromZ + (toTarget.z - fromZ) * 0.18),
            new THREE.Vector3(fromX + (toTarget.x - fromX) * 0.65, fY + rugRaise + 0.010, fromZ + (toTarget.z - fromZ) * 0.70),
            toTarget.clone(),
          ];
          const cable = new THREE.Mesh(
            new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.006, 4, false),
            _subCblMat
          );
          cable.renderOrder = 2;
          roomGroup.add(cable);
        }

        const _ampTarget = new THREE.Vector3(
          offsetX, floorY + rugRaise + 0.35, rackWallZ - rackD / 2
        );

        if (!room.subwoofer_dual) {
          // Single sub — right of rack
          const sg = _buildSub();
          sg.position.set(offsetX + rackW / 2 + 0.06 + subW / 2, floorY + rugRaise + subH / 2, rackWallZ);
          roomGroup.add(sg);
          _addSubCable(sg.position.x, sg.position.z, _ampTarget);
        } else {
          // Dual subs — side walls at 1/4 room depth (Welti/Harman optimal)
          // Avoids front corners (reserved for bass traps) and rear corners.
          const hW       = room.width_m / 2;
          const cm       = 0.04;
          const sideSubZ = -room.length_m / 2 + room.length_m * 0.25;

          [['L', -(hW - subW / 2 - cm)], ['R', (hW - subW / 2 - cm)]].forEach(([side, sx]) => {
            const sg = _buildSub();
            sg.position.set(sx, floorY + rugRaise + subH / 2, sideSubZ);
            sg.rotation.y = side === 'L' ? -Math.PI / 2 : Math.PI / 2;
            roomGroup.add(sg);

            const ampTgt = new THREE.Vector3(
              offsetX + (side === 'L' ? -0.08 : 0.08),
              floorY + rugRaise + 0.35,
              rackWallZ - rackD / 2
            );
            _addSubCable(sx, sideSubZ, ampTgt);
          });
        }
      }

    }

    /* ------------------------------------------
       DJ BOOTH (club room only)
       Table top + facade on legs, two turntables (plinth, platter rim,
       vinyl rim, groove circles, label, tonearm, headshell, pitch fader,
       start/stop button) and a centre mixer (channel faders, crossfader,
       EQ knobs, VU meter LEDs). Geometry only — no spin/pulse animation
       (the platters, tonearms and VU meters are all static), matching the
       engine's "no fake animations driven by time alone" rule. Colour
       lockdown: charcoal (furnEdgeMat) for structure, a single restrained
       teal accent for the "active" controls (labels, faders, buttons) —
       no per-channel neon colour-coding.
       Predictive model: not a physical measurement. Furniture only —
       never read by acoustics/analysis.
    ------------------------------------------ */
    function _buildDJBooth() {
      const grp = new THREE.Group();
      const accentMat = new THREE.LineBasicMaterial({ color: colors.accent });
      // Desk shrinks to the 2-deck footprint when only turntables or only
      // CDJs are selected -- no need for the wide 4-deck table when half
      // the deck slots are empty.
      const deckConfig = room.deck_config || 'both';
      const deskW = deckConfig === 'both' ? 7.6 : 4.4;

      function _edges(geo) {
        return new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), furnEdgeMat);
      }
      // Accent-colour parts are still defined (material/geometry untouched)
      // but not rendered in the 3D room — hidden via .visible rather than
      // removed, so re-enabling the accent look later is a one-line flip.
      function _accentEdges(geo) {
        const m = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), accentMat);
        m.visible = false;
        return m;
      }
      function _circle(r, y, mat, segs = 40) {
        const pts = [];
        for (let i = 0; i <= segs; i++) {
          const a = (i / segs) * Math.PI * 2;
          pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
        }
        return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
      }

      // Riser platform under the whole desk (standard for a 4-deck booth —
      // DJ needs somewhere to stand that isn't the bare floor). deskGroup
      // wraps every desk element (table, facade, legs, decks, mixer) so
      // raising the platform is one offset instead of editing every
      // individual y position by hand.
      // Toggleable: off means the desk sits flush on the floor (no
      // elevation, no visible platform), not just a hidden box at the old
      // height -- RISER_H itself drops to 0 so deskGroup's offset and the
      // riser mesh agree.
      const RISER_H = room.dj_riser_enabled !== false ? 0.15 : 0;
      if (RISER_H > 0) {
        // Riser footprint tracks deskW (+0.8 generous overhang) so it
        // shrinks with a 2-deck booth instead of always being sized for
        // the widest (4-deck) layout.
        const riser = _ghostBox(deskW + 0.8, RISER_H, 3.6);
        riser.position.set(0, RISER_H / 2, 0); // centred, generous depth covers both the table area and DJ standing room behind on either side of the 180° flip
        grp.add(riser);
      }

      const deskGroup = new THREE.Group();
      deskGroup.position.y = RISER_H;
      grp.add(deskGroup);

      // Table widened for the 4-deck layout (was 4.4/1.6, fit only 2
      // decks) -- symmetric deck-deck-mixer-deck-deck, standard club
      // booth convention. deskW shrinks back to 4.4 for a 2-deck booth.
      const tableTop = _ghostBox(deskW, 0.12, 1.6);
      tableTop.position.y = 1.0;
      deskGroup.add(tableTop);

      const facade = _ghostBox(deskW, 1.0, 0.08);
      facade.position.set(0, 0.5, 0.76);
      deskGroup.add(facade);

      // Leg layout: 4-deck's wider span needs the extra inner support
      // pair; the 2-deck desk reuses the original 4-leg layout.
      const legPositions = deckConfig === 'both'
        ? [[-3.6, -0.65], [3.6, -0.65], [-3.6, 0.6], [3.6, 0.6],
           [-1.5, -0.65], [1.5, -0.65], [-1.5, 0.6], [1.5, 0.6]]
        : [[-2.0, -0.65], [2.0, -0.65], [-2.0, 0.6], [2.0, 0.6]];
      legPositions.forEach(([x, z]) => {
        const leg = _ghostBox(0.12, 1.0, 0.12);
        leg.position.set(x, 0.5, z);
        deskGroup.add(leg);
      });

      function _makeTurntable(x, hasTonearm = true) {
        const g = new THREE.Group();
        g.position.set(x, 1.06, 0);
        deskGroup.add(g);

        const plinth = _ghostBox(1.35, 0.07, 1.1);
        plinth.position.y = 0.035;
        g.add(plinth);

        const platter = new THREE.Group();
        platter.position.set(-0.12, 0.08, 0);
        g.add(platter);

        platter.add(_edges(new THREE.CylinderGeometry(0.44, 0.44, 0.04, 40)));

        const vinyl = _edges(new THREE.CylinderGeometry(0.42, 0.42, 0.015, 40));
        vinyl.position.y = 0.03;
        platter.add(vinyl);

        [0.2, 0.32].forEach(r => platter.add(_circle(r, 0.04, furnEdgeMat)));

        const label = _accentEdges(new THREE.CylinderGeometry(0.13, 0.13, 0.017, 24));
        label.position.y = 0.031;
        platter.add(label);

        const spoke = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-0.4, 0.045, 0), new THREE.Vector3(0.4, 0.045, 0),
          ]),
          accentMat
        );
        spoke.visible = false; // accent colour kept in code, hidden in the room — see _accentEdges
        platter.add(spoke);

        // Tonearm — turntables only. The two outer decks are CDJs (digital
        // media players): no tonearm, everything else about the unit is
        // shared since a CDJ's plinth/jog-wheel silhouette reads close
        // enough to a turntable's plinth/platter at this level of detail.
        if (hasTonearm) {
          const armPivot = new THREE.Group();
          armPivot.position.set(0.5, 0.19, -0.38);
          g.add(armPivot);

          armPivot.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(0.1, 0, -0.05), new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.52, -0.03, 0.22),
            ]),
            furnEdgeMat
          ));

          const head = _ghostBox(0.07, 0.03, 0.04);
          head.position.set(-0.56, -0.03, 0.24);
          armPivot.add(head);

          const armBase = _edges(new THREE.CylinderGeometry(0.07, 0.08, 0.1, 16));
          armBase.position.set(0.5, 0.12, -0.38);
          g.add(armBase);
        }

        const pitchKnob = _accentEdges(new THREE.BoxGeometry(0.06, 0.03, 0.05));
        pitchKnob.position.set(0.55, 0.09, 0.1);
        g.add(pitchKnob);

        const btn = _accentEdges(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 16));
        btn.position.set(-0.55, 0.08, 0.42);
        g.add(btn);
      }
      // deck_config: 'both' is the standard 4-deck mixed layout (two
      // turntables flanking the mixer, two CDJs further out) --
      // 'turntables'/'cdj' keep the same inner deck slots (±1.35) but
      // only build two, matching what installers actually quote rather
      // than always showing a fixed 4-deck rig. (deckConfig itself is
      // declared once, at the top of this function, since deskW also
      // depends on it.)
      if (deckConfig === 'both') {
        _makeTurntable(-1.35);
        _makeTurntable(1.35);
        _makeTurntable(-2.75, false);
        _makeTurntable(2.75, false);
      } else if (deckConfig === 'turntables') {
        _makeTurntable(-1.35);
        _makeTurntable(1.35);
      } else { // 'cdj'
        _makeTurntable(-1.35, false);
        _makeTurntable(1.35, false);
      }

      const mixer = new THREE.Group();
      mixer.position.set(0, 1.06, 0.05);
      deskGroup.add(mixer);

      const mixerBody = _ghostBox(0.9, 0.07, 1.0);
      mixerBody.position.y = 0.035;
      mixer.add(mixerBody);

      [-0.18, 0.18].forEach((x, i) => {
        const fader = _accentEdges(new THREE.BoxGeometry(0.06, 0.035, 0.045));
        fader.position.set(x, 0.09, 0.22 + i * 0.1);
        mixer.add(fader);
      });

      const xFader = _ghostBox(0.05, 0.035, 0.06);
      xFader.position.set(0, 0.09, 0.42);
      mixer.add(xFader);

      const knobGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.035, 12);
      for (let row = 0; row < 3; row++) {
        [-0.18, 0.18].forEach(x => {
          const k = _edges(knobGeo);
          k.position.set(x, 0.085, -0.05 - row * 0.14);
          mixer.add(k);
        });
      }

      [-0.36, 0.36].forEach(x => {
        for (let i = 0; i < 6; i++) {
          const led = _edges(new THREE.BoxGeometry(0.03, 0.012, 0.03));
          led.position.set(x, 0.075, 0.05 - i * 0.055);
          mixer.add(led);
        }
      });

      return grp;
    }

    if (room.room_type === 'club' && (renderStage === 'speakers' || renderStage === 'furnishings')) {
      const boothFloorY = -room.height_m / 2;
      // BOOTH_FOOTPRINT_SCALE: _buildDJBooth()'s footprint (table 4.4m wide)
      // was authored for a tight demo close-up, not real-world scale — a
      // real two-deck DJ table/booth is ~1.5-2m wide. Scaling X/Z only
      // (not Y) shrinks the footprint to ~1.85m wide while leaving every
      // height (table height, turntable height off the floor) at its
      // already-realistic value. X and Z share one factor so the platter/
      // vinyl circles stay circular rather than becoming ellipses.
      const BOOTH_FOOTPRINT_SCALE = 0.42;
      const boothZ = -room.length_m / 2 + (room.booth_front_m ?? 0.75) * BOOTH_FOOTPRINT_SCALE;
      // Booth left/right offset -- moves the booth (and, when bass bins are
      // in 'centre' mode, the bins underneath it) independently of the
      // wall-mounted PA tops, which stay put: they're fixed for room
      // coverage and don't need to track the booth's position.
      const boothX = offsetX + (room.booth_offset_m ?? 0);
      const booth = _buildDJBooth();
      booth.scale.set(BOOTH_FOOTPRINT_SCALE, 1, BOOTH_FOOTPRINT_SCALE);
      // _buildDJBooth() authors the facade (crowd-facing side) at local
      // +Z, but the booth sits at the FRONT wall where the crowd is on
      // the +Z side of the room too — same direction, so the booth was
      // facing itself into the wall instead of out at the floor. 180°
      // flip puts the facade/turntables/mixer/monitors all facing +Z
      // (into the room) as a unit.
      booth.rotation.y = Math.PI;
      booth.position.set(boothX, boothFloorY + rugRaise, boothZ);
      roomGroup.add(booth);

      // DJ monitors — pole-mounted at each outer corner of the table (DJ
      // side, opposite the crowd-facing facade), angled inward toward the
      // DJ. Built directly in world space, not nested inside the booth
      // group: booth.scale is non-uniform (BOOTH_FOOTPRINT_SCALE, 0.42 on
      // X/Z, 1 on Y), and a circle drawn in a child's local XY plane comes
      // out squashed into an ellipse under that transform (X compressed,
      // Y untouched) — that's what happened when these were built inside
      // _buildDJBooth(). World-space placement sidesteps the distortion
      // entirely, same approach as the DJ figure below. Position/yaw are
      // boothX/boothZ plus the same local-offset-then-180°-flip math the
      // booth itself goes through, worked out by hand since there's no
      // shared transform helper for it.
      const MONITOR_YAW = 0.55; // ~31°, inward toward table centre
      const monCabW = 0.20, monCabD = 0.20, monCabH = 0.24;
      const monPoleH = 0.16, monPoleFootprint = 0.04;
      // Matches _buildDJBooth()'s RISER_H -- duplicated for the same
      // reason BOOTH_FOOTPRINT_SCALE is: that constant lives in the other
      // function's scope. Must track the same dj_riser_enabled toggle.
      const monRiserH = room.dj_riser_enabled !== false ? 0.15 : 0;
      const monCabMat = new THREE.LineBasicMaterial({ color: 0x2a2a28, transparent: true, opacity: Math.max(OP_OBJ, 0.80) });
      // Matches _buildDJBooth()'s deskW-dependent outer leg position --
      // 3.6 for the 7.6m-wide 4-deck desk, 2.0 for the 4.4m-wide 2-deck
      // desk (same ratio: leg inset 0.2 from the table edge).
      const monOuterX = (room.deck_config || 'both') === 'both' ? 3.6 : 2.0;
      [-1, 1].forEach(sign => {
        const localX = sign * monOuterX, localZ = -0.65;
        const worldX = boothX - localX * BOOTH_FOOTPRINT_SCALE; // Ry(pi) flips the sign
        const worldZ = boothZ + (-localZ) * BOOTH_FOOTPRINT_SCALE;

        const monGroup = new THREE.Group();
        monGroup.position.set(worldX, boothFloorY + rugRaise + monRiserH + 1.06, worldZ);
        monGroup.rotation.y = Math.PI - sign * MONITOR_YAW; // booth's 180° flip + inward toe
        roomGroup.add(monGroup);

        const pole = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(monPoleFootprint, monPoleH, monPoleFootprint)),
          monCabMat
        );
        pole.position.y = monPoleH / 2;
        monGroup.add(pole);

        const cabinet = new THREE.Group();
        cabinet.position.y = monPoleH + monCabH / 2;
        cabinet.add(new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(monCabW, monCabH, monCabD)), monCabMat
        ));
        // Single small driver, not the wall speaker's woofer+tweeter pair
        // — a nearfield monitor this size reads as one full-range unit.
        _makeConeDriver(0, 0, monCabD / 2 + 0.002, monCabW * 0.16, false, 0x2a2a28, Math.max(OP_OBJ, 0.80))
          .forEach(o => cabinet.add(o));
        monGroup.add(cabinet);
      });

      // DJ Avatar
      const djHeadGeo = new THREE.SphereGeometry(0.15, 10, 8);
      const djBodyGeo = new THREE.CylinderGeometry(0.2, 0.25, 1.4, 8);
      djBodyGeo.translate(0, 0.7, 0); // anchor at feet
      const djMat = new THREE.MeshBasicMaterial({ color: 0x666666 });

      const djGroup = new THREE.Group();
      const djBody = new THREE.Mesh(djBodyGeo, djMat);
      const djHead = new THREE.Mesh(djHeadGeo, djMat);
      djHead.position.set(0, 1.55, 0);

      djGroup.add(djBody);
      djGroup.add(djHead);

      // Headphones — band arcs ear-to-ear over the top of the head, two
      // cups on the sides. Darker than djMat so they read as a distinct
      // accessory against the figure, not just a texture. Parented to
      // djHead (not djGroup), with positions relative to djHead's own
      // origin (not the +1.55 world-ish offset djHead itself sits at) —
      // djHead gets a per-frame Y bob in the animate loop keyed off
      // userData.isDJHead, and a child inherits its parent's transform
      // automatically, so this is the simplest way to have the
      // headphones bounce with the head rather than duplicating that
      // animation logic onto separate objects.
      const hpMat = new THREE.MeshBasicMaterial({ color: 0x2a2a28 });
      const bandPts = [];
      for (let i = 0; i <= 20; i++) {
        const a = Math.PI - (i / 20) * Math.PI; // left ear, over the top, to right ear
        bandPts.push(new THREE.Vector3(Math.cos(a) * 0.16, Math.sin(a) * 0.16, 0));
      }
      djHead.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(bandPts),
        new THREE.LineBasicMaterial({ color: 0x2a2a28 })
      ));
      [-1, 1].forEach(side => {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 12), hpMat);
        cup.rotation.z = Math.PI / 2;
        cup.position.set(side * 0.155, 0, 0);
        djHead.add(cup);
      });

      // Stand 0.5m behind the booth, on top of the riser platform (+
      // monRiserH — boothX (not offsetX) so the DJ follows the booth's
      // left/right offset slider instead of always sitting at room centre
      // regardless of where the booth actually is.
      djGroup.position.set(boothX, boothFloorY + rugRaise + monRiserH, boothZ - 0.5);

      // Animation flags
      const phase = Math.random() * Math.PI * 2;
      djGroup.userData.isDJGroup = true;
      djGroup.userData.baseX = boothX;
      djGroup.userData.phase = phase;
      
      djHead.userData.isDJHead = true;
      djHead.userData.bpm = room.crowd_bpm || 126;
      djHead.userData.baseY = 1.55;
      djHead.userData.phase = phase;
      
      roomGroup.add(djGroup);

      // --- MIRROR BALL ---
      if (_discoEnabled) {
        const mballRadius = 0.3;
        const mballGeo = new THREE.SphereGeometry(mballRadius, 16, 12);
        const mballMat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.1,
          metalness: 0.9,
          flatShading: true
        });
        _mirrorBall = new THREE.Mesh(mballGeo, mballMat);
        const ceilY = room.height_m / 2;
        _mirrorBall.position.set(0, ceilY - mballRadius - 0.2, 0);
        const mstringGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.2);
        const mstringMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
        const mstring = new THREE.Mesh(mstringGeo, mstringMat);
        mstring.position.set(0, mballRadius + 0.1, 0);
        _mirrorBall.add(mstring);
        
        // LASERS
        const laserCount = 60;
        const pts = [];
        const colors = [];
        const c1 = new THREE.Color(0x00ffff);
        const c2 = new THREE.Color(0xff00ff);
        const c3 = new THREE.Color(0x00ff00);
        for(let i=0; i<laserCount; i++) {
          pts.push(new THREE.Vector3(0,0,0));
          const u = Math.random(); const v = Math.random();
          const theta = u * 2.0 * Math.PI; const phi = Math.acos(2.0 * v - 1.0);
          const r = 8.0;
          pts.push(new THREE.Vector3(r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi)));
          const col = Math.random() < 0.33 ? c1 : (Math.random() < 0.5 ? c2 : c3);
          colors.push(col.r, col.g, col.b, col.r, col.g, col.b);
        }
        const laserGeo = new THREE.BufferGeometry().setFromPoints(pts);
        laserGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        const clipHalfW = (room.width_m / 2) * baseScale;
        const clipHalfL = (room.length_m / 2) * baseScale;
        const clipHalfH = (room.height_m / 2) * baseScale;
        const _discoClipPlanes = [
          new THREE.Plane(new THREE.Vector3(-1, 0, 0), clipHalfW),
          new THREE.Plane(new THREE.Vector3( 1, 0, 0), clipHalfW),
          new THREE.Plane(new THREE.Vector3(0, 0, -1), clipHalfL),
          new THREE.Plane(new THREE.Vector3(0, 0,  1), clipHalfL),
          new THREE.Plane(new THREE.Vector3(0, -1, 0), clipHalfH),
          new THREE.Plane(new THREE.Vector3(0,  1, 0), clipHalfH)
        ];
        const laserMat = new THREE.LineBasicMaterial({ 
          vertexColors: true, 
          transparent: true, 
          opacity: 0.6, 
          depthWrite: false,
          clippingPlanes: _discoClipPlanes
        });
        const laserLines = new THREE.LineSegments(laserGeo, laserMat);
        _mirrorBall.add(laserLines);
        roomGroup.add(_mirrorBall);
      } else {
        _mirrorBall = null;
      }
    }

    /* ------------------------------------------
       BASS BIN STACK (club room only)
       Mono centre-stack under the DJ booth — 2-4 bass_bin cabinets stacked
       vertically at room centre (x = offsetX), same Z as the flanking PA
       tops. Deliberately separate from the home hi-fi subwoofer block
       above: that path models one small cabled sub next to a rack, which
       doesn't fit a club's stacked-mono pattern. Centre-stacking (not L/R
       spaced pairs) avoids power-alley cancellation across the floor —
       see README.md roadmap.
       Predictive model: not a physical measurement.
    ------------------------------------------ */
    if (room.room_type === 'club' && (renderStage === 'speakers' || renderStage === 'furnishings')) {
      const stackCount = Math.max(0, Math.min(4, room.bass_bin_count ?? 2));
      // 'centre' (default): one mono stack under the booth, at room centre.
      // 'corners': two mono stacks (same stackCount each), one flanking
      // each front corner instead — a common alternative for wider floors
      // where a single centre stack can't cover the corners evenly.
      const placement = room.bass_bin_placement === 'corners' ? 'corners' : 'centre';

      if (stackCount > 0) {
        const binProfile = getSpeakerProfile('bass_bin');
        const binColor = binProfile.color;
        const binOpacity = Math.max(OP_OBJ, 0.80);
        const stackZ = -room.length_m / 2 + room.spk_front_m;
        const floorY = -room.height_m / 2;

        const maxCols = 4;
        const cols = Math.min(stackCount, maxCols);
        const totalW = cols * binProfile.w;

        // Centre stack lies on its side, spread horizontally (existing
        // layout). Corner stacks stand upright instead, stacked vertically
        // in a single column — a floor-standing tower reads correctly
        // tucked into a corner, whereas the wide horizontal row doesn't
        // fit the tighter corner footprint.
        function _buildStackAt(centerX, vertical) {
          if (vertical) {
            for (let i = 0; i < stackCount; i++) {
              const bin = _buildBassBinSpeaker(binProfile.w, binProfile.h, binProfile.d, binColor, binOpacity);
              bin.position.set(
                centerX,
                floorY + rugRaise + binProfile.h / 2 + i * binProfile.h,
                stackZ
              );
              roomGroup.add(bin);
            }
            return;
          }
          const startX = centerX - totalW / 2 + binProfile.w / 2;
          for (let i = 0; i < stackCount; i++) {
            const row = Math.floor(i / cols);
            const col = i % cols;
            const bin = _buildBassBinSpeaker(binProfile.w, binProfile.h, binProfile.d, binColor, binOpacity);
            bin.rotation.z = Math.PI / 2;
            bin.position.set(
              startX + col * binProfile.h,
              floorY + rugRaise + binProfile.w / 2 + row * binProfile.w,
              stackZ
            );
            roomGroup.add(bin);
          }
        }

        const stackCentres = [];
        const isCorners = placement === 'corners';
        if (isCorners) {
          const cornerInset = binProfile.w / 2 + 0.2; // clearance off the side wall, upright footprint
          const halfW = room.width_m / 2;
          stackCentres.push(-(halfW - cornerInset), (halfW - cornerInset));
        } else {
          // Centre stack sits under the booth, so it follows the booth's
          // left/right offset too. Corners mode (above) is anchored to the
          // room's side walls instead and ignores this.
          stackCentres.push(offsetX + (room.booth_offset_m ?? 0));
        }
        stackCentres.forEach(cx => _buildStackAt(cx, isCorners));

        if (_wavesEnabled && _subWavesOn) {
          const NUM_RINGS = 10;
          const maxR = Math.max(room.length_m, room.width_m) * 1.5;
          const circleCurvePts = [];
          const CIRCLE_SEG = 72;
          for (let j = 0; j < CIRCLE_SEG; j++) {
            const a = (j / CIRCLE_SEG) * Math.PI * 2;
            circleCurvePts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
          }
          const ringCurve = new THREE.CatmullRomCurve3(circleCurvePts, true);
          const ringGeo   = new THREE.TubeGeometry(ringCurve, 72, 0.04, 8, true);

          stackCentres.forEach(centerX => {
            for (let ri = 0; ri < NUM_RINGS; ri++) {
              const ringMat = new THREE.MeshBasicMaterial({
                color: new THREE.Color(0xff2d78),
                transparent: true,
                opacity: 0,
                depthWrite: false,
                clippingPlanes: _waveClipPlanes,
              });
              const ring = new THREE.Mesh(ringGeo, ringMat);
              ring.position.set(centerX, floorY + rugRaise + (stackCount * binProfile.h) / 2, stackZ);
              ring.userData.wavePhase   = ri / NUM_RINGS;
              ring.userData.waveMaxR    = maxR;
              ring.userData.waveAmp     = 1.0;
              ring.userData.speakerSide = 'SUB';
              roomGroup.add(ring);
              _waveRings.push(ring);
            }
          });
        }
      }
    }

    /* ------------------------------------------
       CINEMA TV / SCREEN (cinema room only)
       Front-wall-anchored display with three mount variants driven by
       room.screen_type ('stand' | 'wall' | 'projector'). Built from _ghostBox
       wireframe frames (charcoal furnEdgeMat) + a low-opacity fill plane for
       the screen face — same plane treatment as the rug fill. Reuses only the
       existing charcoal palette.
       Predictive model: not a physical measurement. Geometry only — never read
       by acoustics/analysis, so it cannot affect the simulation.
    ------------------------------------------ */
    if (room.room_type === 'cinema' && (renderStage === 'speakers' || renderStage === 'furnishings')) {
      const floorY     = -room.height_m / 2;
      const frontWallZ = -room.length_m / 2;
      const screenType = room.screen_type || 'stand';

      // Cinema front-stage placement (geometry only). 'inwall' replaces the box
      // L/R pair (suppressed in the speaker block above) and the box centre below
      // with flush wireframe panels on the front wall. "At screen" tucks them
      // behind the screen — only valid for the projector, whose 0.15-opacity fill
      // reads through; any other screen type falls back to the on-wall layout.
      const isInwallFront = room.front_placement === 'inwall';
      const atScreenFront = isInwallFront && room.at_screen === true && screenType === 'projector';
      // Captured by each screen branch below so the in-wall panels can anchor to
      // the screen's centre Y / bottom edge / width without recomputing them.
      let screenCenterY = 0, screenWidth = 0, screenHeight = 0;

      // Screen face — charcoal wireframe bezel + a fill plane facing into the
      // room (+z), mirroring the rug-fill pattern so the screen reads as a
      // surface, not a hollow box. Fill colour/opacity default to the dark TV
      // tone; the projector passes white (0xffffff) at low opacity for a lit look.
      function _screenFace(w, h, fillColor = 0x2a2a2a, fillOpacity = 0.85) {
        const grp = new THREE.Group();
        grp.add(_ghostBox(w, h, 0.04));
        const fill = new THREE.Mesh(
          new THREE.PlaneGeometry(w * 0.96, h * 0.92),
          new THREE.MeshBasicMaterial({ color: fillColor, transparent: true, opacity: fillOpacity, depthWrite: false })
        );
        fill.position.z = 0.021;  // just in front of the bezel, facing into the room
        grp.add(fill);
        return grp;
      }

      // ── Shared media cabinet (used by the stand and wall variants) ─────────
      // Wireframe body on four legs, front face split into two doors with
      // handles. Narrowed to 1.7 m so the floorstanders at ±1.1 m flank it
      // rather than clip it (cabinet half-extent 0.85 m vs speaker inner edge
      // ~0.98 m). All charcoal _ghostBox outlines — no solids, no new colours.
      const CAB_W = 1.7, CAB_H = 0.5, CAB_D = 0.42;
      const CAB_LEG_H = 0.12, CAB_LEG_W = 0.08, CAB_LEG_D = 0.08;
      const cabZ    = frontWallZ + CAB_D / 2 + 0.05;   // small gap off the wall, like the rack
      const cabTopY = floorY + CAB_LEG_H + CAB_H;       // world Y of the cabinet top surface

      // Returns the cabinet as a Group in local coords (y = 0 at the floor,
      // x = 0 centre, z = 0 cabinet centre); the caller places it at
      // (offsetX, floorY, cabZ).
      function _buildCabinet() {
        const grp = new THREE.Group();

        // Body — raised onto the legs.
        const body = _ghostBox(CAB_W, CAB_H, CAB_D);
        body.position.set(0, CAB_LEG_H + CAB_H / 2, 0);
        grp.add(body);

        // Four legs under the corners (slightly inset), like the rack/desk legs.
        const legX = CAB_W / 2 - CAB_LEG_W / 2 - 0.04;
        const legZ = CAB_D / 2 - CAB_LEG_D / 2 - 0.04;
        [[-legX, -legZ], [legX, -legZ], [-legX, legZ], [legX, legZ]].forEach(([lx, lz]) => {
          const leg = _ghostBox(CAB_LEG_W, CAB_LEG_H, CAB_LEG_D);
          leg.position.set(lx, CAB_LEG_H / 2, lz);
          grp.add(leg);
        });

        // Two door panels dividing the front face — thin wireframe outlines
        // (NOT solids), with a small vertical handle bar near each inner edge.
        const doorW = CAB_W / 2 - 0.04;
        const doorH = CAB_H - 0.06;
        const doorY = CAB_LEG_H + CAB_H / 2;
        const doorZ = CAB_D / 2 - 0.011;  // thin door box front flush with the body front
        [-1, 1].forEach(sx => {
          const door = _ghostBox(doorW, doorH, 0.02);
          door.position.set(sx * CAB_W / 4, doorY, doorZ);
          grp.add(door);

          const handle = _ghostBox(0.02, 0.12, 0.03);
          handle.position.set(sx * 0.05, doorY, CAB_D / 2 + 0.015);  // just proud of the front
          grp.add(handle);
        });

        return grp;
      }

      if (screenType === 'stand') {
        // Media cabinet on the floor against the front wall, TV on small feet
        // on the cabinet top.
        const cabinet = _buildCabinet();
        cabinet.position.set(offsetX, floorY, cabZ);
        roomGroup.add(cabinet);

        const scrW = 1.5, scrH = 0.85;
        const FOOT_H = 0.06, FOOT_W = 0.05, FOOT_D = 0.10;
        // TV base rests at cabinet-top + foot height; centre is half above that.
        const screen = _screenFace(scrW, scrH);
        screen.position.set(offsetX, cabTopY + FOOT_H + scrH / 2, cabZ);
        roomGroup.add(screen);
        screenCenterY = screen.position.y; screenWidth = scrW; screenHeight = scrH;

        // Two small feet under the TV, standing on the cabinet top.
        [-1, 1].forEach(sx => {
          const foot = _ghostBox(FOOT_W, FOOT_H, FOOT_D);
          foot.position.set(offsetX + sx * scrW * 0.28, cabTopY + FOOT_H / 2, cabZ);
          roomGroup.add(foot);
        });

      } else if (screenType === 'wall') {
        // Same cabinet below + TV mounted flush on the front wall, clearing it.
        const cabinet = _buildCabinet();
        cabinet.position.set(offsetX, floorY, cabZ);
        roomGroup.add(cabinet);

        const scrW = 1.5, scrH = 0.85;
        const screen = _screenFace(scrW, scrH);
        screen.position.set(offsetX, floorY + 1.3, frontWallZ + 0.03);  // ~1.3 m up, clears the cabinet (top ~0.62 m)
        roomGroup.add(screen);
        screenCenterY = screen.position.y; screenWidth = scrW; screenHeight = scrH;

      } else {
        // Projector: larger LIT screen (white fill, low opacity) flush near the
        // front wall + a small projector box mounted high toward the room
        // centre. No cabinet.
        const scrW = 2.1, scrH = 1.2;
        const screen = _screenFace(scrW, scrH, 0xffffff, 0.15);
        screen.position.set(offsetX, floorY + 1.4, frontWallZ + 0.03);
        roomGroup.add(screen);
        screenCenterY = screen.position.y; screenWidth = scrW; screenHeight = scrH;

        const projW = 0.3, projH = 0.15, projD = 0.3;
        const projector = _ghostBox(projW, projH, projD);
        const projY = (room.height_m / 2) - 0.3;            // ~0.3 m below the ceiling
        const projZ = frontWallZ + room.length_m * 0.45;     // high, toward room centre
        projector.position.set(offsetX, projY, projZ);
        roomGroup.add(projector);
      }

      // ── Centre channel (cinema only) — horizontal speaker under the screen ──
      // A wide, short speaker box on the centre axis (offsetX, same as the screen)
      // coplanar with the shared L/R front pair (Z = frontWallZ + spk_front_m,
      // read here — not hardcoded) and facing straight into the room toward the
      // listener, like the front pair. Built with the same speaker builder and
      // profile colour as the L/R pair so it reads as a speaker, not charcoal
      // furniture. Additive and geometry-only: never read by acoustics/analysis,
      // and it touches neither the shared pair nor any spk_* placement. Disposed
      // on rebuild via the standard roomGroup traverse, like the screen props.
      // Predictive model: not a physical measurement.
      // Suppressed when the front stage is in-wall — the centre is then one of
      // the flush wireframe panels built below.
      if (!isInwallFront) {
        const cProfile = getSpeakerProfile(room.speaker_type);
        const cColor   = cProfile.color;
        const cOpacity = Math.max(OP_OBJ, 0.80);
        const centre   = _buildStandmountSpeaker(0.5, 0.18, 0.25, cColor, cOpacity);
        const centreZ  = frontWallZ + (room.spk_front_m ?? 0.3);  // same front plane as the L/R pair
        centre.position.set(offsetX, floorY + 0.5, centreZ);      // ~0.5 m up, below the screen
        roomGroup.add(centre);
      }

      // ── In-wall front stage (cinema only) — flush wireframe L/C/R panels ──────
      // Replaces the suppressed box L/R pair + box centre with thin-box wireframe
      // rectangles on the front wall (EdgesGeometry → LineSegments, speaker-profile
      // colour like the box fronts). Rectangles only — no fills, no driver detail.
      // X reads spk_spacing_m for the on-wall L/R only; nothing is written back, and
      // none of this is read by acoustics/analysis. Added to roomGroup so the
      // standard rebuild() disposal traverse frees it. Geometry only.
      // Predictive model: not a physical measurement.
      if (isInwallFront) {
        const inwallProfile = getSpeakerProfile(room.speaker_type);
        const inwallColor   = inwallProfile.color;
        const inwallOpacity = Math.max(OP_OBJ, 0.80);
        const inwallMat = new THREE.LineBasicMaterial({
          color: inwallColor, transparent: true, opacity: inwallOpacity,
        });
        const inwallZ = frontWallZ + 0.01;  // flush on the front wall; +0.01 clears z-fighting
        // Thin-box wireframe rectangle facing into the room (depth 0.02 m).
        const _inwallPanel = (panelWidth, panelHeight) => new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(panelWidth, panelHeight, 0.02)),
          inwallMat
        );

        if (atScreenFront) {
          // Behind the projector screen (its 0.15-opacity fill reads through):
          // three vertical panels — L/R behind the screen's edges, centre behind
          // its middle — all vertically centred on the screen centre.
          const screenEdgeX = screenWidth / 2;
          [-screenEdgeX, 0, screenEdgeX].forEach(panelDX => {
            const panel = _inwallPanel(0.30, 1.00);
            panel.position.set(offsetX + panelDX, screenCenterY, inwallZ);
            roomGroup.add(panel);
          });
        } else {
          // On the front wall, screen unobstructed. L/R vertical panels at the box
          // pair's X positions; centre horizontal panel just below the screen's
          // bottom edge with a 0.10 m gap.
          const panelRailY = floorY + 1.2;  // vertical centre of the L/R panels
          [-1, 1].forEach(sideSign => {
            const panel = _inwallPanel(0.30, 1.00);
            panel.position.set(offsetX + sideSign * room.spk_spacing_m / 2, panelRailY, inwallZ);
            roomGroup.add(panel);
          });
          const screenBottomY = screenCenterY - screenHeight / 2;
          const centrePanel = _inwallPanel(0.60, 0.20);
          centrePanel.position.set(offsetX, screenBottomY - 0.10 - 0.20 / 2, inwallZ);
          roomGroup.add(centrePanel);
        }
      }

      // ── Surround speakers + subwoofers (cinema only) — driven by speaker_layout ──
      // Floor-level surrounds placed by bearing angle from the listener (0° faces
      // the screen, angles open toward the rear), symmetric L/R, all equidistant
      // from the listener at ear height, each yawed to face the listener. The
      // front L / C / R (shared pair + the centre above) stay present in every
      // layout; this only adds the surrounds + subs. Additive, geometry/coverage
      // only: never read by acoustics/analysis, and it touches neither the shared
      // pair nor any spk_* placement. Disposed on rebuild via the roomGroup traverse.
      // Predictive model: not a physical measurement.
      {
        const layout   = room.speaker_layout || '5_1';
        // 7.2.4 (Atmos) reuses the 7.2 floor layer wholesale and adds 4 ceiling
        // height speakers on top — so the floor layer keys off floorLayout, and
        // the height block below keys off the raw layout.
        const floorLayout = layout === '7_2_4' ? '7_2' : layout;
        const sProfile = getSpeakerProfile(room.speaker_type);
        const sColor   = sProfile.color;
        const sOpacity = Math.max(OP_OBJ, 0.80);

        const listX = offsetX + (room.listener_offset_m || 0);  // matches the listener station's X
        const listZ = listenerZ;
        const earY  = floorY + 1.05;                            // ~ear height, seated

        const hW        = room.width_m / 2;
        const backWallZ = room.length_m / 2;
        const WALL_GAP  = 0.30;                                 // keep boxes off the walls
        // Common (equidistant) radius — reaches toward the nearer of the side or
        // rear wall; the per-axis clamp below keeps each box inside the room.
        const r = Math.max(1.4, Math.min(hW, backWallZ - listZ));

        // Surround bearings (deg) per layout, each placed symmetrically L + R.
        //   5.1   → one pair at ~110° (just behind, to the side)
        //   7.2   → side pair at ~100°, rear pair at ~140°
        //   7.2.4 → same floor surrounds as 7.2 (heights added separately below)
        const SURR_BEARINGS = floorLayout === '7_2' ? [100, 140] : [110];

        // Cinema surround placement. 'inwall' replaces the stand-mounted box
        // surrounds with a flush wireframe rectangle per surround, on whichever
        // wall the surround's bearing ray meets first (side wall or rear wall).
        // Same thin-box EdgesGeometry → LineSegments pattern, colour and opacity
        // as the front in-wall panels. Geometry only — surround_placement is read
        // here, never written, and never reaches acoustics/analysis.
        const isInwallSurround = room.surround_placement === 'inwall';
        const surrInwallMat = new THREE.LineBasicMaterial({
          color: sColor, transparent: true, opacity: sOpacity,
        });
        const _surrPanel = (panelWidth, panelHeight) => new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(panelWidth, panelHeight, 0.02)),
          surrInwallMat
        );
        const SURR_PANEL_W = 0.30, SURR_PANEL_H = 0.50;
        const surrPanelY   = floorY + 1.40;  // vertical centre, 1.40 m off the floor
        const SURR_WALL_OFFSET = 0.01;        // off the wall surface, clears z-fighting

        SURR_BEARINGS.forEach(deg => {
          const a = deg * Math.PI / 180;
          [-1, 1].forEach(sideSign => {
            // Bearing → offset from the listener: +X is right, −Z is toward the screen.

            // In-wall surround: cast the bearing ray from the listener station to
            // the first wall it meets — the side wall on this surround's side
            // (x = ±hW) or the rear wall (z = +backWallZ), whichever has the
            // smaller positive ray parameter t — and lay a flush panel there.
            if (isInwallSurround) {
              const dirX = sideSign * Math.sin(a);   // ray direction, X
              const dirZ = -Math.cos(a);             // ray direction, Z (toward back for ≥90°)
              const tSide = (sideSign * hW - listX) / dirX;   // hits x = ±hW
              const tRear = (backWallZ - listZ) / dirZ;       // hits z = +backWallZ
              const panel = _surrPanel(SURR_PANEL_W, SURR_PANEL_H);
              if (tSide <= tRear) {
                // Flat against the side wall — rotate 90° so the thin axis is X.
                const wz = listZ + tSide * dirZ;
                panel.rotation.y = Math.PI / 2;
                panel.position.set(sideSign * (hW - SURR_WALL_OFFSET), surrPanelY, wz);
              } else {
                // Flat against the rear wall — default orientation (thin axis Z).
                const wx = listX + tRear * dirX;
                panel.position.set(wx, surrPanelY, backWallZ - SURR_WALL_OFFSET);
              }
              roomGroup.add(panel);
              return;  // skip the stand-mounted box build for this surround
            }

            let sx = listX + sideSign * r * Math.sin(a);
            let sz = listZ - r * Math.cos(a);
            // Clamp inside the room (graceful — may slightly break equidistance for
            // a speaker that would otherwise breach a wall).
            sx = Math.max(-(hW - WALL_GAP), Math.min(hW - WALL_GAP, sx));
            sz = Math.max(frontWallZ + WALL_GAP, Math.min(backWallZ - WALL_GAP, sz));

            // Wrap the speaker + its stand in a group placed at ear height and
            // yawed to face the listener — the cabinet sits at the group origin
            // (unchanged ear-height position/facing), the stand drops to the floor.
            const surrH = 0.28;
            const grp = new THREE.Group();
            grp.position.set(sx, earY, sz);
            grp.rotation.y = Math.atan2(listX - sx, listZ - sz);  // face the listener

            const surr = _buildStandmountSpeaker(0.22, surrH, 0.20, sColor, sOpacity);
            grp.add(surr);  // cabinet centred at the group origin (= ear height)

            // Speaker stand — thin post + base plate down to the floor. These
            // dealer surrounds are off-the-shelf standmounts on stands, not a
            // custom in-wall install, so they get the same stand as the front
            // standmount archetype (same box dims, material, opacity).
            const standHeight = (earY - surrH / 2) - floorY;  // cabinet bottom → floor
            const standMat = new THREE.LineBasicMaterial({
              color: sColor, transparent: true, opacity: sOpacity * 0.65,
            });
            const post = new THREE.LineSegments(
              new THREE.EdgesGeometry(new THREE.BoxGeometry(0.05, standHeight, 0.05)), standMat
            );
            post.position.y = -(surrH / 2) - standHeight / 2;
            grp.add(post);
            const base = new THREE.LineSegments(
              new THREE.EdgesGeometry(new THREE.BoxGeometry(0.32, 0.03, 0.28)), standMat
            );
            base.position.y = -(surrH / 2) - standHeight + 0.015;
            grp.add(base);

            roomGroup.add(grp);
          });
        });

        // Subwoofers — front corners, count by layout. Self-contained box mirroring
        // the home dual-sub style (body + edge outline + driver ring). Decorative,
        // geometry-only — never read by acoustics/analysis.
        // Predictive model: not a physical measurement.
        const subW = 0.38, subH = 0.38, subD = 0.38;
        const subBodyMat = new THREE.MeshStandardMaterial({
          color: 0x3a3a3a, roughness: 0.55, metalness: 0.20,
          transparent: true, opacity: Math.max(OP_OBJ, 0.82),
        });
        const subEdgeMat   = new THREE.LineBasicMaterial({ color: 0x666666, transparent: true, opacity: 0.70 });
        const subDriverMat = new THREE.LineBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.55 });
        const _buildCinemaSub = () => {
          const grp = new THREE.Group();
          grp.add(new THREE.Mesh(new THREE.BoxGeometry(subW, subH, subD), subBodyMat));
          grp.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(subW, subH, subD)), subEdgeMat));
          const driverR = subW * 0.34, dpts = [];
          for (let i = 0; i <= 36; i++) {
            const ang = (i / 36) * Math.PI * 2;
            dpts.push(new THREE.Vector3(Math.cos(ang) * driverR, Math.sin(ang) * driverR, subD / 2 + 0.003));
          }
          grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(dpts), subDriverMat));
          return grp;
        };

        const subX = hW - subW / 2 - WALL_GAP;
        const subZ = frontWallZ + subD / 2 + WALL_GAP;
        // 5.1 → one sub in the front-right corner; 7.2 / 7.2.4 → both front corners.
        const subSides = floorLayout === '7_2' ? [-1, 1] : [1];
        subSides.forEach(sideSign => {
          const sub = _buildCinemaSub();
          sub.position.set(sideSign * subX, floorY + subH / 2, subZ);
          roomGroup.add(sub);
        });

        // ── Atmos height layer (7.2.4 only) — 4 ceiling speakers at ~45° elevation ──
        // Four small ceiling-mounted speakers (no stands), anchored to the listener
        // so they track the seating-position slider like the surrounds. Front pair
        // forward of the seat aligned over the front L/R x; rear pair behind aligned
        // over the side-surround x (~100°). Each is placed a horizontal run
        // hd = (ceiling − ear) from the seat so the seat→speaker line is ~45°, and
        // angled down to face the listener. Geometry/coverage only — never read by
        // acoustics/analysis.
        // Predictive model: not a physical measurement.
        if (layout === '7_2_4') {
          const ceilingY = floorY + room.height_m - 0.05;   // just below the ceiling
          const hd       = ceilingY - earY;                 // horizontal run → ~45° elevation
          const clampX = v => Math.max(-(hW - WALL_GAP), Math.min(hW - WALL_GAP, v));
          const clampZ = v => Math.max(frontWallZ + WALL_GAP, Math.min(backWallZ - WALL_GAP, v));

          const sideSurrDX = r * Math.sin(100 * Math.PI / 180);  // side-surround lateral offset
          const HEIGHTS = [
            { z: listZ - hd, dx: (room.spk_spacing_m ?? 2.2) / 2, xBase: offsetX },  // front pair, over front L/R
            { z: listZ + hd, dx: sideSurrDX,                       xBase: listX   },  // rear pair, over side surrounds
          ];

          // Flush in-ceiling Atmos units — round wireframe discs (outer bezel +
          // inner driver ring) lying flat in the ceiling plane, like recessed
          // in-wall speakers. No box, no stand, no aiming: they sit flush and
          // fire straight down. Same speaker-profile colour/opacity as the
          // surrounds. Geometry/coverage only — never read by acoustics/analysis.
          // Predictive model: not a physical measurement.
          const _buildCeilingDisc = (discRadius) => {
            const grp = new THREE.Group();
            const discMat = new THREE.LineBasicMaterial({ color: sColor, transparent: true, opacity: sOpacity });
            const _ring = (ringRadius) => {
              const pts = [];
              for (let i = 0; i <= 48; i++) {
                const ang = (i / 48) * Math.PI * 2;
                pts.push(new THREE.Vector3(Math.cos(ang) * ringRadius, 0, Math.sin(ang) * ringRadius));  // flat in XZ → faces down
              }
              return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), discMat);
            };
            grp.add(_ring(discRadius));         // outer bezel
            grp.add(_ring(discRadius * 0.6));   // inner driver ring
            return grp;
          };

          HEIGHTS.forEach(({ z, dx, xBase }) => {
            [-1, 1].forEach(sideSign => {
              const hx = clampX(xBase + sideSign * dx);
              const hz = clampZ(z);
              const disc = _buildCeilingDisc(0.16);
              disc.position.set(hx, ceilingY, hz);  // flush in the ceiling plane
              roomGroup.add(disc);
            });
          });
        }
      }
    }

    {
      const station = new THREE.Group();
      station.position.set(offsetX + (room.listener_offset_m || 0), -room.height_m / 2, listenerZ);

      // ── Listener sphere (always visible) ──
      const isListHighlit = highlightTarget === 'listener';
      // Dark charcoal (matches furnEdgeMat, the cabinet/booth colour) --
      // was bright cyan (indistinguishable from the crowd heatmap's teal
      // "low SPL" end), then light grey (too washed out against the light
      // floor/background).
      const sphereColor = isListHighlit ? 0x0f766e : 0x1a1714;
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(isListHighlit ? 0.22 : 0.18, 24, 24),
        new THREE.MeshBasicMaterial({
          color: sphereColor,
          wireframe: true,
          transparent: true,
          opacity: isListHighlit ? 0.95 : 0.55
        })
      );
      // Home: shift sphere into seat. Studio: shift sphere back to match reclined backrest.
      const _seatType = room.seating_type || 'sofa';
      const _sphereZ = isStudio ? 0.20 : (_seatType === 'lounge' ? 0.38 : 0.28);
      const _sphereY = room.room_type === 'club' ? 1.7 : (isStudio ? effectiveHeadHeight : (_seatType === 'lounge' ? 1.00 : 0.96));
      sphere.position.set(0, _sphereY, _sphereZ);
      station.add(sphere);

      // ── Rug ──
      // Studio: small rug in station local coords (clamped from front wall).
      // Hi-Fi: rug added to roomGroup in world coords (speaker-anchored, grows with listener).
      // Dark fill slab + edge outline so the rug is visible as an actual rug, not a hollow box.
      if (isStudio && VISIBILITY.furniture.rug && room.opt_area_rug) {
        const rugW = room.width_m * 0.45;
        // Depth is anchored to the chair, not just scaled off room length.
        // The office chair (built later, in the rigGroup block) always sits
        // exactly at this station's local (0,0) — its 5-star caster base
        // reaches out to a ~0.35 m radius (0.32 m arm + half the 0.055 m
        // caster box). The old rugD/centre (room.length_m*0.35, centre
        // -0.80) was sized off room length alone with no reference to that
        // footprint, so on most rooms the rug's rear edge landed well short
        // of local Z=0 and the chair's back half rendered hanging off the
        // rug (only the front casters touched it). Rear edge is now pinned
        // CHAIR_CLEAR_Z beyond the chair centre regardless of room size;
        // front reach keeps the old room-length scaling so it still reads
        // as "under the desk" in bigger rooms.
        const CHAIR_CLEAR_Z = 0.50; // chair footprint radius (~0.35 m) + margin
        const rugFrontReach = room.length_m * 0.35;
        const rugFrontZ = -rugFrontReach;
        const rugRearZ  = CHAIR_CLEAR_Z;
        const rugD = rugRearZ - rugFrontZ;
        const rug = _ghostBox(rugW, 0.02, rugD);
        const rugFill = new THREE.Mesh(
          new THREE.PlaneGeometry(rugW, rugD),
          new THREE.MeshBasicMaterial({ color: 0x2a2a2a, transparent: true, opacity: 0.85, depthWrite: false })
        );
        rugFill.rotation.x = -Math.PI / 2;
        rugFill.position.y = 0.011;
        rug.add(rugFill);
        const rugHalfD = rugD / 2;
        const rawCenterZ = (rugFrontZ + rugRearZ) / 2;
        const minLocalZ = (-room.length_m / 2) - listenerZ + rugHalfD + 0.06;
        // Clamp only ever pushes the rug *toward* the chair (rawCenterZ is
        // already as far forward as the desk-reach wants it), so chair
        // clearance holds even when a short room forces the clamp to win.
        const rugLocalZ = Math.max(rawCenterZ, minLocalZ);
        rug.position.set(0, 0.01, rugLocalZ);
        station.add(rug);
      }


      // ── Seating (home mode only) — driven by room.seating_type ('sofa' | 'lounge') ──
      // In station-local coords: +Z is toward the back wall.
      if (VISIBILITY.furniture.sofa && !isStudio && room.opt_sofa) {
        const seatingGroup = new THREE.Group();
        const seatingStyle = room.seating_type || 'sofa';

        if (seatingStyle === 'sofa') {
          // ── Sofa — width driven by room.sofa_width_m (1.4–2.8 m) ────────────
          const sw = Math.max(1.4, Math.min(2.8, room.sofa_width_m ?? 2.1));
          const halfArm = 0.1;

          const base = _ghostBox(sw, 0.4, 0.9);
          base.position.y = 0.2;
          seatingGroup.add(base);

          const back = _ghostBox(sw, 0.5, 0.2);
          back.position.set(0, 0.55, 0.35);
          seatingGroup.add(back);

          const lArm = _ghostBox(halfArm * 2, 0.35, 0.9); lArm.position.set(-(sw / 2 - halfArm), 0.4, 0);
          const rArm = _ghostBox(halfArm * 2, 0.35, 0.9); rArm.position.set((sw / 2 - halfArm), 0.4, 0);
          seatingGroup.add(lArm, rArm);

          // ── Footstool (optional) — in front of sofa ──────────────────────────
          if (room.opt_ottoman) {
            const stool = _ghostBox(0.6, 0.36, 0.5);
            stool.position.set(0, 0.18, -0.75);
            seatingGroup.add(stool);
          }

        } else {
          // ── Eames 670 Lounge Chair + 671 Ottoman ─────────────────────────────
          // Line material for 5-star pedestal arms
          const starLineMat = new THREE.LineBasicMaterial({
            color: furnEdgeMat.color, transparent: false, depthTest: true
          });

          // 5 radial arms radiating from origin
          function _fiveStar(radius, y) {
            const pts = [];
            for (let i = 0; i < 5; i++) {
              const a = (i / 5) * Math.PI * 2 + Math.PI / 10;
              pts.push(
                new THREE.Vector3(0, y, 0),
                new THREE.Vector3(Math.sin(a) * radius, y, Math.cos(a) * radius)
              );
            }
            return new THREE.LineSegments(
              new THREE.BufferGeometry().setFromPoints(pts), starLineMat
            );
          }

          // ── CHAIR ──
          const eamesChair = new THREE.Group();

          eamesChair.add(_fiveStar(0.30, 0.025));
          const col = _ghostBox(0.045, 0.28, 0.045);
          col.position.y = 0.16;
          eamesChair.add(col);

          // Seat: reclined
          const seat = _ghostBox(0.58, 0.09, 0.52);
          seat.rotation.x = +0.28;
          seat.position.set(0, 0.33, -0.12);
          eamesChair.add(seat);

          // Back: Eames signature lean
          const chairBack = _ghostBox(0.50, 0.52, 0.09);
          chairBack.rotation.x = 0.38;
          chairBack.position.set(0, 0.60, 0.22);
          eamesChair.add(chairBack);

          // Headrest
          const head = _ghostBox(0.42, 0.19, 0.09);
          head.rotation.x = 0.30;
          head.position.set(0, 0.88, 0.28);
          eamesChair.add(head);

          // Arm rests
          const lArm = _ghostBox(0.07, 0.05, 0.42); lArm.position.set(-0.31, 0.46, 0.0);
          const rArm = _ghostBox(0.07, 0.05, 0.42); rArm.position.set(0.31, 0.46, 0.0);
          eamesChair.add(lArm, rArm);

          seatingGroup.add(eamesChair);

          // ── OTTOMAN (671) ──
          const eamesOttoman = new THREE.Group();

          eamesOttoman.add(_fiveStar(0.22, 0.022));
          const ottCol = _ghostBox(0.04, 0.20, 0.04);
          ottCol.position.y = 0.12;
          eamesOttoman.add(ottCol);

          const ottTop = _ghostBox(0.56, 0.09, 0.50);
          ottTop.position.y = 0.26;
          eamesOttoman.add(ottTop);

          // Ottoman sits ~0.75 m in front of the chair (toward speakers)
          eamesOttoman.position.set(0, 0, -0.75);
          seatingGroup.add(eamesOttoman);
        }

        // Both sit behind the listener — clamp so the sofa back never breaches the back wall.
        // Sofa's furthest geometry point is 0.80m behind the seating group origin.
        // Cap: group Z ≤ (back_wall_world - listenerZ - 0.80m - 0.05m clearance)
        // Y = rugRaise so the sofa/lounge sits ON the rug when the rug is active
        // — speakers, stands, and rack already lift via rugRaise; this matches.
        // The hi-fi rug always overlaps the seating area (rear edge clamps to
        // sofaRearZ + 0.25), so the lift applies whenever rug is on.
        const _sofaBackExtent = 0.80;  // base back face + back panel back face
        const _sofaMaxLocalZ = (room.length_m / 2) - listenerZ - _sofaBackExtent - 0.05;
        seatingGroup.position.set(0, rugRaise, Math.min(0.35, Math.max(0, _sofaMaxLocalZ)));
        station.add(seatingGroup);
      }

      // ── Cinema seating (cinema room only) — type via cinema_seating_type ───
      //   'corner_l' / 'corner_r' → L-shaped sectional couch (this branch);
      //   'recliner_row' (default) → the parametric N-seat theatre row below.
      // All charcoal _ghostBox, station-local (+Z toward the back wall, same
      // convention as the sofa), parented to the listener station, same back-wall
      // clamp. Geometry only; never read by acoustics/analysis.
      if (room.room_type === 'cinema' &&
          (room.cinema_seating_type === 'corner_l' || room.cinema_seating_type === 'corner_r')) {
        // L-shaped sectional: a main run along the rear (centred on the listener)
        // plus a perpendicular return extending forward (−Z) on one side.
        // corner_l → return on the left (−X); corner_r → mirror (+X). Composed
        // from the listener-sofa modules. cinema_seat_count does NOT apply here.
        const seatingGroup = new THREE.Group();
        const side = room.cinema_seating_type === 'corner_r' ? +1 : -1;

        // Main run along the rear wall (back panel at +Z), centred on x=0.
        const mainBase = _ghostBox(2.4, 0.4, 0.9); mainBase.position.set(0, 0.2, 0);     seatingGroup.add(mainBase);
        const mainBack = _ghostBox(2.4, 0.5, 0.2); mainBack.position.set(0, 0.55, 0.35); seatingGroup.add(mainBack);

        // Perpendicular return extending forward on `side`, outer edge flush with
        // the main-run end; its backrest runs along the side wall.
        const retBase  = _ghostBox(0.9, 0.4, 1.6); retBase.position.set(side * 0.75, 0.2, -0.35);   seatingGroup.add(retBase);
        const sideBack = _ghostBox(0.2, 0.5, 1.6); sideBack.position.set(side * 1.1, 0.55, -0.35);  seatingGroup.add(sideBack);

        // Arms: one at the main-run open end (opposite the return), one at the
        // return's forward tip.
        const openArm = _ghostBox(0.2, 0.35, 0.9); openArm.position.set(-side * 1.1, 0.4, 0);     seatingGroup.add(openArm);
        const retArm  = _ghostBox(0.9, 0.35, 0.2); retArm.position.set(side * 0.75, 0.4, -1.05);  seatingGroup.add(retArm);

        // Same station-local placement + back-wall clamp as the recliner row.
        const _cornerBackExtent = 0.55;
        const _cornerMaxLocalZ = (room.length_m / 2) - listenerZ - _cornerBackExtent - 0.05;
        seatingGroup.position.set(0, 0, Math.min(0.35, Math.max(0, _cornerMaxLocalZ)));
        station.add(seatingGroup);

      } else if (room.room_type === 'cinema') {
        // ── recliner_row (default) — parametric N-seat theatre row(s) ──
        // Up to 4 rows (cinema_row_count). The front row (row 0) sits exactly
        // where the original single row sat — aligned to the listener/money seat
        // at y=0. Each row behind is stepped back +Z by a fixed pitch and lifted
        // +Y onto a riser, the way a tiered home cinema steps up. Geometry only:
        // analysis stays on the front seat (no per-row scoring); the listener
        // never moves back. The corner-couch branch above is unaffected.
        const reclinerRow = new THREE.Group();

        const seatW = 0.55, armW = 0.12;
        // Parametric, symmetric about x=0. Seat-centre pitch = seatW + armW, so
        // armrests sit exactly between adjacent seats and at both ends. Odd N
        // puts a seat at x=0 (on the listener); even N straddles the centre.
        const N = Math.max(3, Math.min(5, Math.round(room.cinema_seat_count ?? 3)));
        const seatPitch = seatW + armW;  // 0.67 — seat centre to seat centre
        const seatXs = [];
        for (let i = 0; i < N; i++) seatXs.push((i - (N - 1) / 2) * seatPitch);
        const armXs = [];
        for (let j = 0; j <= N; j++) armXs.push((j - N / 2) * seatPitch);

        // Build one parametric N-seat row at a local Z offset (toward the back
        // wall) and Y lift (riser height). Identical seat modules to the original
        // single row, just translated by (zOff, yLift).
        const _buildReclinerSeatRow = (zOff, yLift) => {
          seatXs.forEach(sx => {
            // Seat cushion / base.
            const base = _ghostBox(seatW, 0.4, 0.85);
            base.position.set(sx, 0.2 + yLift, zOff);
            reclinerRow.add(base);

            // Reclined back — tilted rearward, at the rear (+Z) of the base.
            const back = _ghostBox(seatW, 0.55, 0.18);
            back.rotation.x = +0.22;
            back.position.set(sx, 0.55 + yLift, 0.33 + zOff);
            reclinerRow.add(back);

            // Headrest — small block above the back, sharing its lean.
            const head = _ghostBox(0.5, 0.16, 0.12);
            head.rotation.x = +0.22;
            head.position.set(sx, 0.92 + yLift, 0.40 + zOff);
            reclinerRow.add(head);
          });

          // Chunky armrests: between each seat and at both ends.
          armXs.forEach(ax => {
            const arm = _ghostBox(armW, 0.42, 0.85);
            arm.position.set(ax, 0.21 + yLift, zOff);
            reclinerRow.add(arm);
          });
        };

        // Front-row placement: same station-local +Z offset and back-wall clamp
        // as the original single row, so row 0 is pixel-identical to before.
        // Y = 0 (cinema has no rug, so no rugRaise lift).
        const _reclinerBackExtent = 0.55;  // furthest rear face behind a row's local origin
        const _reclinerMaxLocalZ = (room.length_m / 2) - listenerZ - _reclinerBackExtent - 0.05;
        const _reclinerGroupZ = Math.min(0.35, Math.max(0, _reclinerMaxLocalZ));

        // Tiered rows: stepped back ROW_PITCH and up RISER_H each. Build front to
        // back and stop at the first row whose rear face would breach the back
        // wall — short rooms simply show fewer rows. Pitch is never compressed to
        // force the count, and no row is allowed through the back wall.
        const ROW_PITCH = 1.4;   // m — row-to-row depth (recliners need the reach)
        const RISER_H   = 0.30;  // m — riser lift per row (row r → r × 0.30)
        const R = Math.max(1, Math.min(4, Math.round(room.cinema_row_count ?? 1)));
        // A row's rear face, in station-local Z, must clear the back wall.
        const _maxRowRearLocal = (room.length_m / 2) - listenerZ - 0.05;
        for (let r = 0; r < R; r++) {
          const rowZ = r * ROW_PITCH;
          // Row 0 always renders (the money seat); a rear row only if it fits.
          if (r > 0 && _reclinerGroupZ + rowZ + _reclinerBackExtent > _maxRowRearLocal) break;
          const yLift = r * RISER_H;
          // Riser step under each elevated row so it reads tiered, not floating.
          // Spans the row width/depth, fills floor → seat base (top at yLift).
          if (r > 0) {
            const riser = _ghostBox(N * seatPitch + 0.2, yLift, 1.0);
            riser.position.set(0, yLift / 2, rowZ);
            reclinerRow.add(riser);
          }
          _buildReclinerSeatRow(rowZ, yLift);
        }

        reclinerRow.position.set(0, 0, _reclinerGroupZ);
        station.add(reclinerRow);
      }

      // ── Coffee table — anchored to listener station, in front of sofa ──
      if (VISIBILITY.furniture.coffeeTable && !isStudio && room.opt_coffee_table) {
        const ctGroup = new THREE.Group();

        const tTop = _ghostBox(1.0, 0.05, 0.6);
        tTop.position.y = 0.4;
        ctGroup.add(tTop);

        [[-0.45, 0.2, -0.3], [0.45, 0.2, -0.3],
        [-0.45, 0.2, 0.3], [0.45, 0.2, 0.3]].forEach(([lx, ly, lz]) => {
          const leg = _ghostBox(0.04, 0.4, 0.04);
          leg.position.set(lx, ly, lz);
          ctGroup.add(leg);
        });

        // -0.9 m in front of the listener (toward speakers)
        // Y = rugRaise so the coffee table sits ON the rug, matching the
        // sofa lift and the speaker/stand/rack rugRaise pattern. The hi-fi
        // rug always extends to ~spk_front - 0.35, well past the coffee
        // table's footprint at -0.9, so the lift applies whenever rug is on.
        ctGroup.position.set(0, rugRaise, -0.9);
        station.add(ctGroup);
      }

      // ── Studio: rigGroup (desk + display + mic + keys + chair) ──────────
      // The rig is a single parent THREE.Group whose origin sits at the
      // speaker plane (world Z = -halfL + spk_front_m). Every part is
      // positioned with local-Z offsets measured from that plane:
      //
      //   speaker plane   →  local z = 0    (speakers are world-space siblings,
      //                                       not parented — see room3d.js
      //                                       speaker-placement block)
      //   desk back edge  →  local z = -0.05 (5 cm behind speakers, toward wall)
      //   desk centre     →  local z = -0.05 + deskD/2
      //   desk front edge →  local z = -0.05 + deskD
      //   chair           →  local z = listenerZ - rigZ
      //                     (equilateral-triangle distance from spk plane,
      //                      already baked into room.listener_front_m at
      //                      the studio override block near line 750)
      //
      // Moving spk_front_m re-translates the whole rigGroup as a unit;
      // every part stays correctly placed relative to the speaker plane.
      if (isStudio) {
        const deskW = room.desk_width_m ?? 1.6;
        const deskD = room.desk_depth_m ?? 0.7;
        const halfW = deskW / 2;

        // Desk back edge: seat the monitor cabinet on the desk rather
        // than letting it overhang. Monitor profile depth is 0.24 m
        // (cabinet centre at rig local Z = 0 → back panel at -0.12);
        // pull the desk back another 5 cm so a visible strip of desk
        // surface sits behind the speaker. Clamped so the desk never
        // punches through the front wall at low spk_front_m: when
        // spk_front_m < 0.19, the desk back rides 2 cm off the wall
        // and the speaker overhang re-emerges — acceptable corner
        // case per audit (better than rendering through the wall).
        const RIG_DESK_BACK_LZ   = Math.max(-0.17, -room.spk_front_m + 0.02);
        const RIG_DESK_CENTRE_LZ = RIG_DESK_BACK_LZ + deskD / 2;
        const RIG_DESK_FRONT_LZ  = RIG_DESK_BACK_LZ + deskD;

        const rigZ = -room.length_m / 2 + room.spk_front_m;
        const rigGroup = new THREE.Group();
        rigGroup.position.set(offsetX, -room.height_m / 2, rigZ);

        // ── Desk (parametric; 'plain' = the original build, 'production'
        //    adds a back riser + 19" rack bay + open shelf + pull-out
        //    keyboard tray) ──
        // _buildDesk works in desk-centre-local coordinates (origin = desk
        // centre at floor level). The returned group is positioned at
        // RIG_DESK_CENTRE_LZ so every part keeps the EXACT rig-local Z it had
        // before this refactor:
        //   desk-local z = -deskD/2  ⇄  RIG_DESK_BACK_LZ
        //   desk-local z =  0        ⇄  RIG_DESK_CENTRE_LZ
        //   desk-local z = +deskD/2  ⇄  RIG_DESK_FRONT_LZ
        // Every WIDTH and left-right position derives from deskW / halfW;
        // heights, depths and the rack-unit count are literals.
        // spacing       = studio speaker spacing (= room.spk_spacing_m, already
        //                 desk-width-derived upstream); uprights + monitors share it.
        // monitorLocalZ = the monitors' Z expressed in desk-local coords, so the
        //                 production riser can be centred under them front-to-back.
        function _buildDesk(baseDeskW, baseDeskD, style, spacing, monitorLocalZ) {
          const group = new THREE.Group();
          const isProduction = style === 'production';
          
          if (!isProduction) {
            // ── Standard Plain Desk ──
            const deskW = baseDeskW;
            const deskD = baseDeskD;
            const halfW = deskW / 2;
            
            const deskTop = _ghostBox(deskW, 0.05, deskD);
            deskTop.position.y = 0.775;
            group.add(deskTop);
            [[-halfW + 0.04, 0.375, -deskD / 2 + 0.04], [halfW - 0.04, 0.375, -deskD / 2 + 0.04],
            [-halfW + 0.04, 0.375, deskD / 2 - 0.04], [halfW - 0.04, 0.375, deskD / 2 - 0.04]]
              .forEach(p => { const l = _ghostBox(0.04, 0.775, 0.04); l.position.set(...p); group.add(l); });

            let dispGroup = null;
            if (room.opt_display !== false) {
              dispGroup = new THREE.Group();
              const standBase = _ghostBox(0.22, 0.04, 0.18);
              standBase.position.y = 0.795;
              dispGroup.add(standBase);
              const standPole = _ghostBox(0.04, 0.22, 0.04);
              standPole.position.set(0, 0.915, 0.02);
              dispGroup.add(standPole);
              const monitor = _ghostBox(Math.min(deskW * 0.70, 0.68), 0.38, 0.032);
              monitor.position.set(0, 1.10, 0.01);
              dispGroup.add(monitor);
            }
            if (dispGroup) {
              dispGroup.position.set(0, 0, -deskD / 2 + 0.12);
              group.add(dispGroup);
            }
            if (room.opt_keyboard) {
              const kb = _ghostBox(Math.min(deskW * 0.30, 0.44), 0.02, 0.16);
              kb.position.set(0, 0.795, deskD / 2 - 0.12);
              group.add(kb);
            }
            return group;
          }

          // ── High-End Studio Production Desk ──
          const rackW = 0.64; // Massive 19" rack bay with thick wooden trim
          // Make the desk dynamically wide enough to support the speaker racks near the edges
          const deskW = Math.max(baseDeskW, spacing + rackW + 0.10); 
          const deskD = Math.max(baseDeskD, 0.9);
          const halfW = deskW / 2;
          const riserBotY = 0.775;
          const THICK = 0.04;

          // 1. Z-Frame Wooden Legs (built from 3 ghost boxes per side)
          const legZLength = deskD - 0.1;
          [-halfW + 0.06, halfW - 0.06].forEach(lx => {
            const legTop = _ghostBox(THICK, THICK, legZLength);
            legTop.position.set(lx, riserBotY - THICK/2, 0);
            group.add(legTop);

            const legBot = _ghostBox(THICK, THICK, legZLength + 0.1);
            legBot.position.set(lx, THICK/2, 0.05);
            group.add(legBot);

            const legPillar = _ghostBox(THICK, riserBotY - THICK, 0.2);
            legPillar.position.set(lx, riserBotY/2, 0);
            legPillar.rotation.x = Math.PI / 12; // Forward tilt for Z shape
            group.add(legPillar);
          });

          // 2. Thick, deep curved main desktop
          const deskTop = _ghostBox(deskW, THICK, deskD);
          deskTop.position.set(0, riserBotY, 0);
          group.add(deskTop);

          // 3. Dual Angled Rack Bays & Speaker Posts
          // Lift speakers by exactly RISER_H + POST_RISE above the desk surface (0.775)
          const postH = RISER_H + POST_RISE; // 0.25 total lift
          const rackD = 0.40;
          const rackCY = riserBotY + postH/2 + THICK/2;
          const rackCZ = monitorLocalZ;

          [-spacing/2, spacing/2].forEach(rx => {
            // Flat rack box
            const rackBox = _ghostBox(rackW, postH, rackD);
            rackBox.position.set(rx, rackCY, rackCZ);
            group.add(rackBox);

            // Rack rails on the front face of the angled rack
            for(let i=0; i<3; i++) {
              const rail = _ghostBox(rackW - 0.06, 0.02, 0.02);
              const rYLocal = (i - 1) * 0.06;
              rail.position.set(0, rYLocal, rackD/2);
              rackBox.add(rail);
            }
            
            // Speaker pad exactly at the required height so the visualizer speakers don't float/sink
            const speakerPad = _ghostBox(rackW - 0.04, 0.02, rackD - 0.04);
            speakerPad.position.set(rx, riserBotY + postH - 0.01 + THICK/2, rackCZ);
            group.add(speakerPad);
          });

          // 4. Center Monitor
          if (room.opt_display !== false) {
            const uwGroup = new THREE.Group();
            const standBase = _ghostBox(0.30, 0.02, 0.20);
            standBase.position.y = riserBotY + THICK/2 + 0.01;
            uwGroup.add(standBase);
            const standPole = _ghostBox(0.04, 0.40, 0.04);
            standPole.position.set(0, riserBotY + THICK/2 + 0.20, -0.05);
            uwGroup.add(standPole);
            
            // Calculate max width for monitor so it doesn't clip into the racks
            // The available gap is 'spacing' minus the width of one full rack (since racks are at +/- spacing/2)
            const availableGap = spacing - rackW;
            const safeMonitorW = Math.max(0.4, Math.min(1.10, availableGap - 0.1));
            
            const uwMonitor = _ghostBox(safeMonitorW, 0.38, 0.03); 
            uwMonitor.position.set(0, riserBotY + THICK/2 + 0.45, 0.0);
            uwMonitor.rotation.x = -Math.PI / 32; // tilted up slightly
            uwGroup.add(uwMonitor);
            
            uwGroup.position.set(0, 0, rackCZ - 0.05);
            group.add(uwGroup);

            // Secondary Vertical Monitor (left of main display)
            const vertMonW = 0.26;
            const vertMonH = 0.45;
            // Only add if there is enough space between the racks
            if (safeMonitorW + vertMonW + 0.05 < availableGap) {
                const vertMonGroup = new THREE.Group();
                const vertStand = _ghostBox(0.18, 0.02, 0.15);
                vertStand.position.y = riserBotY + THICK/2 + 0.01;
                vertMonGroup.add(vertStand);
                
                const vertPole = _ghostBox(0.04, 0.25, 0.04);
                vertPole.position.set(0, riserBotY + THICK/2 + 0.13, -0.02);
                vertMonGroup.add(vertPole);

                const vertScreen = _ghostBox(vertMonW, vertMonH, 0.03);
                vertScreen.position.set(0, riserBotY + THICK/2 + 0.25, 0.02);
                vertScreen.rotation.y = Math.PI / 12; // Angle inward toward producer
                vertMonGroup.add(vertScreen);

                vertMonGroup.position.set(-safeMonitorW/2 - vertMonW/2 - 0.05, 0, rackCZ - 0.05);
                group.add(vertMonGroup);
            }
          }

          // 5. Desktop Accessories (Mixer + Laptop)
          // Angled Mixing Console / Fader Bank in the center of the desk
          const mixer = _ghostBox(0.60, 0.06, 0.30);
          mixer.position.set(0, riserBotY + THICK/2 + 0.03, 0.05);
          mixer.rotation.x = Math.PI / 24; // Angle up towards the user
          group.add(mixer);

          // Laptop on a chunky stand on the right side
          const laptopGroup = new THREE.Group();
          const laptopStand = _ghostBox(0.20, 0.12, 0.20);
          laptopStand.position.set(0, riserBotY + THICK/2 + 0.06, 0);
          laptopStand.rotation.x = Math.PI / 12; // Angled stand
          laptopGroup.add(laptopStand);
          
          const laptopBase = _ghostBox(0.32, 0.02, 0.22);
          laptopBase.position.set(0, riserBotY + THICK/2 + 0.13, 0.02);
          laptopBase.rotation.x = Math.PI / 12;
          laptopGroup.add(laptopBase);

          const laptopScreen = _ghostBox(0.32, 0.22, 0.02);
          laptopScreen.position.set(0, riserBotY + THICK/2 + 0.23, -0.08);
          laptopScreen.rotation.x = -Math.PI / 16; // Open screen
          laptopGroup.add(laptopScreen);
          
          // Position laptop group on the right side of the desk surface
          laptopGroup.position.set(halfW - 0.40, 0, 0.35);
          laptopGroup.rotation.y = -Math.PI / 8; // Point slightly inwards
          group.add(laptopGroup);

          // 6. Pull-out Keyboard Tray & MIDI Keyboard
          const trayW = deskW - 0.20;
          const trayD = 0.35;
          const trayY = riserBotY - 0.12; 
          const trayZ = deskD/2 - 0.05;
          
          const tray = _ghostBox(trayW, 0.02, trayD);
          tray.position.set(0, trayY, trayZ);
          group.add(tray);

          if (room.opt_keyboard) {
            const pcKb = _ghostBox(0.44, 0.02, 0.16);
            pcKb.position.set(-0.15, riserBotY + THICK/2 + 0.01, deskD/2 - 0.10);
            group.add(pcKb);
            
            const mouse = _ghostBox(0.06, 0.02, 0.10);
            mouse.position.set(0.15, riserBotY + THICK/2 + 0.01, deskD/2 - 0.10);
            group.add(mouse);

            const midiKb = _ghostBox(1.35, 0.06, 0.26); // Large 88-key controller
            midiKb.position.set(0, trayY + 0.04, trayZ);
            group.add(midiKb);
          }

          return group;
        }

        const deskGroup = _buildDesk(deskW, deskD, room.desk_style, room.spk_spacing_m, -RIG_DESK_CENTRE_LZ);
        deskGroup.position.set(0, 0, RIG_DESK_CENTRE_LZ);
        rigGroup.add(deskGroup);

        // ── Mic on boom stand (outside left edge of desk) ──
        if (room.opt_mic) {
          const micGroup = new THREE.Group();
          const pole = _ghostBox(0.025, 1.55, 0.025);
          pole.position.y = 0.775;
          micGroup.add(pole);
          const boom = _ghostBox(0.55, 0.02, 0.02);
          boom.position.set(0.275, 1.50, 0);
          micGroup.add(boom);
          const capsule = _ghostBox(0.04, 0.13, 0.04);
          capsule.position.set(0.55, 1.50, 0);
          micGroup.add(capsule);
          micGroup.position.set(-halfW - 0.1, 0, RIG_DESK_CENTRE_LZ);
          rigGroup.add(micGroup);
        }

        // ── Office chair v1.2 — 5-star base, casters, armrests, backrest ──
        const chairGroup = new THREE.Group();
        const _chairStarMat = new THREE.LineBasicMaterial({ color: furnEdgeMat.color, transparent: false });
        (function _chairStar() {
          const pts = [];
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2;
            pts.push(
              new THREE.Vector3(0, 0.02, 0),
              new THREE.Vector3(Math.sin(a) * 0.32, 0.02, Math.cos(a) * 0.32)
            );
          }
          chairGroup.add(new THREE.LineSegments(
            new THREE.BufferGeometry().setFromPoints(pts), _chairStarMat
          ));
        })();
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          const caster = _ghostBox(0.055, 0.055, 0.055);
          caster.position.set(Math.sin(a) * 0.32, 0.028, Math.cos(a) * 0.32);
          chairGroup.add(caster);
        }
        const chairStem = _ghostBox(0.07, 0.38, 0.07); chairStem.position.y = 0.21; chairGroup.add(chairStem);
        const chairSeat = _ghostBox(0.50, 0.07, 0.48); chairSeat.position.y = 0.44; chairGroup.add(chairSeat);
        // Backrest support pole — angled back; chairBk (panel) inherits the tilt
        const chairSup = _ghostBox(0.06, 0.42, 0.05);
        chairSup.position.set(0, 0.65, 0.20); chairSup.rotation.x = +0.32; // lean back away from desk
        chairGroup.add(chairSup);
        const chairLA = _ghostBox(0.06, 0.05, 0.24); chairLA.position.set(-0.27, 0.53, 0.0); chairGroup.add(chairLA);
        const chairRA = _ghostBox(0.06, 0.05, 0.24); chairRA.position.set(0.27, 0.53, 0.0); chairGroup.add(chairRA);
        const chairBk = new THREE.Group();
        chairBk.add(_ghostBox(0.44, 0.40, 0.06));
        chairBk.position.set(0, 0.17, -0.05);
        chairSup.add(chairBk);
        // Chair local Z: distance from speaker plane to the listening
        // position. listenerZ was set from the overridden
        // room.listener_front_m at line ~1701, so this lines the chair
        // up exactly with the listen-station sphere (which is also at
        // listenerZ in world space).
        chairGroup.position.set(0, 0, listenerZ - rigZ);
        // No whole-group tilt — feet and stem stay flat, only backrest angled
        rigGroup.add(chairGroup);

        roomGroup.add(rigGroup);
      }

      roomGroup.add(station);
      _listenStation = station; // stored for auto-toe
    }

    // ── Hi-Fi rug: world-space, speaker-anchored front, sofa-tracking rear ──
    // Front edge sits just in front of the speakers; rear grows with the listener.
    if (!isStudio && VISIBILITY.furniture.rug && room.opt_area_rug) {
      const hL = room.length_m / 2;
      const hW = room.width_m / 2;
      const spkZ = -hL + (room.spk_front_m ?? 0.45);
      const sofaZ = listenerZ + 0.35;
      const sofaRearZ = sofaZ + 0.50;

      // Clamp all extents to room interior (5 cm margin from every wall)
      const rugFrontZ = Math.max(spkZ - 0.35, -hL + 0.05);
      const rugRearZ = Math.min(sofaRearZ + 0.25, hL - 0.05);
      const rugDepth = Math.max(0.6, rugRearZ - rugFrontZ);
      const rugCenterZ = rugFrontZ + rugDepth / 2;

      // Width: clamped so the rug never pierces side walls regardless of spacing
      const rugWidthRaw = Math.max((room.spk_spacing_m ?? 2.0) * 1.50, room.width_m * 0.48);
      const rugWidth = Math.min(rugWidthRaw, room.width_m - 0.10);

      // X centre: keep rug inside side walls even when listener offset is large
      const rugCenterX = Math.max(-hW + rugWidth / 2 + 0.05,
        Math.min(hW - rugWidth / 2 - 0.05, offsetX));

      // Dark monochrome fabric fill — engine spec forbids warm/cream tones in the scene.
      // Reads as a textile slab against the matte grey floor without any warm cast.
      const rugGeo = new THREE.BoxGeometry(rugWidth, 0.02, rugDepth);
      const rugMat = new THREE.MeshStandardMaterial({
        color:       0x2a2a2a,   // Dark charcoal fabric
        roughness:   0.95,       // Fully matte
        metalness:   0.0,
        transparent: true,
        opacity:     0.88,
      });
      const hiRug = new THREE.Mesh(rugGeo, rugMat);
      hiRug.position.set(rugCenterX, -room.height_m / 2 + 0.01, rugCenterZ);
      roomGroup.add(hiRug);
    }

    /* ------------------------------------------
       CLIENT SEATING — rear wall (home + studio)
       Sofa or Eames lounge chair pushed against the back wall.
       Rotated 180° so it faces the listener / speakers.
    ------------------------------------------ */
    if (room.opt_client_seating && isStudio) {
      const clientGroup = new THREE.Group();
      const clientStyle = room.client_seating_type || 'sofa';
      const rearWallZ = room.length_m / 2;

      if (clientStyle === 'sofa') {
        const sw = Math.max(1.4, Math.min(2.8, room.sofa_width_m ?? 2.1));
        const halfArm = 0.1;
        const csBase = _ghostBox(sw, 0.4, 0.9); csBase.position.y = 0.2; clientGroup.add(csBase);
        const csBack = _ghostBox(sw, 0.5, 0.2); csBack.position.set(0, 0.55, -0.35); clientGroup.add(csBack);
        const csLA = _ghostBox(halfArm * 2, 0.35, 0.9); csLA.position.set(-(sw / 2 - halfArm), 0.4, 0); clientGroup.add(csLA);
        const csRA = _ghostBox(halfArm * 2, 0.35, 0.9); csRA.position.set((sw / 2 - halfArm), 0.4, 0); clientGroup.add(csRA);
      } else {
        // Eames 670 lounge chair at rear — geometry mirrors primary seating
        const csStarMat = new THREE.LineBasicMaterial({ color: furnEdgeMat.color, transparent: false, depthTest: true });
        const _csStar = (radius, y) => {
          const pts = [];
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2 + Math.PI / 10;
            pts.push(new THREE.Vector3(0, y, 0), new THREE.Vector3(Math.sin(a) * radius, y, Math.cos(a) * radius));
          }
          return new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), csStarMat);
        };
        const csChair = new THREE.Group();
        csChair.add(_csStar(0.30, 0.025));
        const csCol = _ghostBox(0.045, 0.28, 0.045); csCol.position.y = 0.16; csChair.add(csCol);
        const csSeat = _ghostBox(0.58, 0.09, 0.52); csSeat.rotation.x = -0.15; csSeat.position.set(0, 0.33, 0.12); csChair.add(csSeat);
        // With parent rotation.y=PI, local -rotation.x leans top toward rear wall (correct)
        const csChBk = _ghostBox(0.50, 0.52, 0.09); csChBk.rotation.x = -0.38; csChBk.position.set(0, 0.60, -0.22); csChair.add(csChBk);
        const csHead = _ghostBox(0.42, 0.19, 0.09); csHead.rotation.x = -0.30; csHead.position.set(0, 0.88, -0.28); csChair.add(csHead);
        const csLA2 = _ghostBox(0.07, 0.05, 0.42); csLA2.position.set(-0.31, 0.46, 0); csChair.add(csLA2);
        const csRA2 = _ghostBox(0.07, 0.05, 0.42); csRA2.position.set(0.31, 0.46, 0); csChair.add(csRA2);
        // Ottoman (671) in front of chair (toward listeners, -Z in post-rotation space)
        const csOtt = new THREE.Group();
        csOtt.add(_csStar(0.22, 0.022));
        const csOttCol = _ghostBox(0.04, 0.20, 0.04); csOttCol.position.y = 0.12; csOtt.add(csOttCol);
        const csOttTop = _ghostBox(0.56, 0.09, 0.50); csOttTop.position.y = 0.26; csOtt.add(csOttTop);
        // Ottoman sits toward the listener (local +Z → world -Z after PI rotation)
        csOtt.position.set(0, 0, +0.75);
        csChair.add(csOtt);
        clientGroup.add(csChair);
      }

      // Rotate to face listener, place against rear wall
      clientGroup.rotation.y = Math.PI;
      clientGroup.position.set(offsetX, -room.height_m / 2, rearWallZ - 0.50);
      roomGroup.add(clientGroup);
    }

    /* ------------------------------------------
       ACOUSTIC TREATMENT PANELS
    ------------------------------------------ */
    const _panelHex = room.panel_color
      ? parseInt(room.panel_color.replace('#', ''), 16)
      : 0x0f766e;


    // Phase 1 panel-aware reflection flash: every treatment panel gets a
    // sibling cyan overlay tagged with userData.isPanelCyanFlash. The
    // reflection overlay block in renderAnalysisOverlays() finds these
    // tags and assigns the matching surface's flash events, so the
    // animator at room3d.js:3064-3083 pulses them in sync with the
    // (always-pink) wall flash. Geometry is shared with the panel; a
    // 1% scale-up + renderOrder=1 keeps the cyan visibly on top of
    // the panel face without coplanar z-fighting (both materials have
    // depthWrite=false, so we rely on render order, not depth tests).
    // Added directly to roomGroup — the animator iterates roomGroup
    // children non-recursively and would skip anything nested inside
    // panelGroup (gable flush ceiling case).
    const _addPanelCyanFlash = (obj, surface) => {
      const targetMesh = obj.isGroup ? obj.userData.flashTarget : obj;
      const flash = new THREE.Mesh(
        targetMesh.geometry,
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(0x22c55e).multiplyScalar(3.0),
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      if (obj.isGroup) {
        flash.position.copy(obj.position).add(targetMesh.position);
        flash.rotation.copy(obj.rotation);
        flash.scale.copy(obj.scale).multiplyScalar(1.01);
      } else {
        flash.position.copy(obj.position);
        flash.rotation.copy(obj.rotation);
        flash.scale.copy(obj.scale).multiplyScalar(1.01);
      }
      flash.renderOrder = 1;
      flash.userData.isPanelCyanFlash = { surface };
      roomGroup.add(flash);
      return flash;
    };

    // Helper: panel mesh + edge outline for embed mode

    // --- PROCEDURAL PANEL GENERATOR ---
    const _materialCache = {};
    function getPanelMat(hexColor) {
      const colorStr = hexColor || '#1A1A1A';
      if (!_materialCache[colorStr]) {
        _materialCache[colorStr] = new THREE.MeshBasicMaterial({ 
          color: colorStr,
          transparent: true,
          opacity: 0.85
        });
      }
      return _materialCache[colorStr];
    }

    const _textureCache = {};

    function _getPanelTexture(style, hexColor) {
      const cacheKey = style + '_' + (hexColor || 'default');
      if (_textureCache[cacheKey]) return _textureCache[cacheKey];

      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 1024;
      const ctx = canvas.getContext('2d');

      if (style === 'fusion_slim') {
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = '#000000';
        
        const cols = 4;
        const rows = 8;
        const cellW = canvas.width / cols;
        const cellH = canvas.height / rows;

        let seed = 42;
        function rand() {
          seed = (seed * 9301 + 49297) % 233280;
          return seed / 233280;
        }

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const x = c * cellW + cellW / 2 + (rand() - 0.5) * cellW * 0.5;
            const y = r * cellH + cellH / 2 + (rand() - 0.5) * cellH * 0.5;
            const radius = 15 + rand() * 35;
            
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else if (style === 'fusion_pro') {
        const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        grad.addColorStop(0, '#d2a679');
        grad.addColorStop(0.5, '#c69c6d');
        grad.addColorStop(1, '#b58b5c');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = '#000000';

        const slotWidths = [16, 32, 12, 48, 20, 12, 28, 16, 36, 12];
        let x = 32;
        for (let i = 0; i < slotWidths.length; i++) {
          const sw = slotWidths[i];
          ctx.fillRect(x, 64, sw, canvas.height - 128);
          ctx.clearRect(0, canvas.height / 2 - 20, canvas.width, 40);
          x += sw + 24;
          if (x > canvas.width - 32) break;
        }
      }

      const tex = new THREE.CanvasTexture(canvas);
      if (renderer) tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      _textureCache[cacheKey] = tex;
      return tex;
    }

    function createPanelGroup(style, width, height, thickness, hexColor) {
      const group = new THREE.Group();
      
      const isBroadband = style.startsWith('broadband');

      if (isBroadband) {
        const geo = new THREE.BoxGeometry(width, height, thickness);
        const mesh = new THREE.Mesh(geo, getPanelMat(hexColor));
        mesh.userData.isFace = true;
        group.add(mesh);
        group.userData.flashTarget = mesh;
        return group;
      }

      const isWood = style === 'fusion_pro';
      const foamColor = isWood ? 0x111111 : 0xdddddd;
      
      const foamMat = new THREE.MeshStandardMaterial({ 
        color: foamColor, 
        roughness: 0.9, 
        metalness: 0.1,
        transparent: true,
        opacity: 0.85
      });
      const foamGeo = new THREE.BoxGeometry(width, height, thickness - 0.005);
      const foamMesh = new THREE.Mesh(foamGeo, foamMat);
      foamMesh.position.z = -0.0025;
      group.add(foamMesh);

      const tex = _getPanelTexture(style, hexColor);
      const faceMat = new THREE.MeshStandardMaterial({ 
        map: tex, 
        transparent: true, 
        opacity: 0.85,
        alphaTest: 0.5,
        roughness: 0.8,
        metalness: 0.1,
        side: THREE.DoubleSide
      });

      const faceGeo = new THREE.PlaneGeometry(width, height);
      const faceMesh = new THREE.Mesh(faceGeo, faceMat);
      faceMesh.position.z = thickness / 2;
      group.add(faceMesh);

      group.userData.isProceduralPanel = true;
      group.userData.flashTarget = faceMesh;

      return group;
    }

    // --- WALL PANELS (front & rear walls) ---
    // Canonical geometry from treatment-registry.js — individual standard-size panels.
    // Identical rendering on all pages regardless of embed_mode.
    const wpGeo = window.MeasurelyTreatment?.GEOMETRY?.wall_panel;
    const wpW = wpGeo?.panelWidth ?? 0.60;
    const wpH = wpGeo?.panelHeight ?? 1.20;
    const wpGap = wpGeo?.panelGap ?? 0.02;
    const wpThickness = wpGeo?.thickness ?? 0.06;

    const buildWallPanels = (mode, count, style, hexColor, wallZ, facingDir, panelH = wpH, panelCenterY = null) => {
      if (mode === "none") return;
      let c = count ?? 4;
      
      const isFront = wallZ < 0;
      const trapLeg = window.MeasurelyTreatment?.GEOMETRY?.bass_trap?.legSize ?? 0.42;
      const hasTraps = isFront 
        ? (room.front_corners_mode && room.front_corners_mode !== 'none') || room.bass_trap_mode === 'front' || room.bass_trap_mode === 'all'
        : (room.rear_corners_mode && room.rear_corners_mode !== 'none') || room.bass_trap_mode === 'rear' || room.bass_trap_mode === 'all';
      const availableW = room.width_m - (hasTraps ? trapLeg * 2 : 0) - 0.1; // 10cm padding total
      
      // Reduce panel count until they fit without overlapping
      while (c > 1 && (c * wpW + (c - 1) * wpGap) > availableW) {
        c--;
      }

      const maxOffset = (availableW - wpW) / 2;

      let panelOffsetsX;
      if (c === 2) {
        const offset = Math.min(room.spk_spacing_m / 2, maxOffset);
        const minOffset = (wpW + wpGap) / 2;
        const finalOffset = Math.max(offset, minOffset);
        panelOffsetsX = [-finalOffset, finalOffset];
      } else {
        const totalSpan = c * wpW + (c - 1) * wpGap;
        panelOffsetsX = Array.from({ length: c }, (_, i) => {
          return -totalSpan / 2 + wpW / 2 + i * (wpW + wpGap);
        });
      }
          
      const floorInWorld = -room.height_m / 2;
      const pY = panelCenterY !== null ? panelCenterY : (floorInWorld + (room.tweeter_height_m ?? 0.95));

      const surface = isFront ? 'front' : 'back';
      for (const dx of panelOffsetsX) {
        const px = offsetX + dx;
        const panelGroup = createPanelGroup(style, wpW, panelH, wpThickness, hexColor);
        panelGroup.position.set(px, pY, wallZ + facingDir * wpThickness / 2);
        
        // Ensure child meshes are rotated 180 degrees if facing forward (wallZ > 0)
        if (facingDir === -1) {
          panelGroup.rotation.y = Math.PI;
        }

        roomGroup.add(panelGroup);
        _addPanelCyanFlash(panelGroup, surface);
      }
    };

    buildWallPanels(room.front_wall_mode, room.front_wall_count, room.front_wall_style, room.front_wall_color, -room.length_m / 2, 1);

    // When a client sofa is at the rear wall, raise panels above the sofa back
    // (sofa back top ≈ 0.80 m from floor; panels sit just above it).
    const hasSofaAtRear = room.opt_client_seating && (room.client_seating_type || 'sofa') === 'sofa';
    const rearH = hasSofaAtRear ? 0.72 : wpH;
    const floorInWorld = -room.height_m / 2;
    const rearCentreY = hasSofaAtRear
      ? floorInWorld + 0.80 + rearH / 2 + 0.05
      : null;
    buildWallPanels(room.rear_wall_mode, room.rear_wall_count, room.rear_wall_style, room.rear_wall_color, room.length_m / 2, -1, rearH, rearCentreY);

    // --- BASS TRAPS — right-angle triangular corner prisms ---
    // Canonical geometry params from treatment-registry.js; fallback matches registry defaults.
    if (room.bass_trap_mode !== "none") {

      const trapLeg = window.MeasurelyTreatment?.GEOMETRY?.bass_trap?.legSize ?? 0.3;
      const trapHFr = window.MeasurelyTreatment?.GEOMETRY?.bass_trap?.heightFraction ?? 0.75;
      const halfW = room.width_m / 2;
      const halfL = room.length_m / 2;

      // Build a right-angle triangular prism: right angle at origin, legs along +X and +Z,
      // height along +Y. Rotate Y per corner so legs always point toward room centre.
      function _makeCornerTrapGeo(leg, height) {
        const positions = new Float32Array([
          0, 0, 0, leg, 0, 0, 0, 0, leg,      // bottom face
          0, height, 0, leg, height, 0, 0, height, leg, // top face
        ]);
        const indices = [
          0, 2, 1,              // bottom (facing down)
          3, 4, 5,              // top (facing up)
          0, 1, 4, 0, 4, 3,   // front face (z = 0)
          0, 3, 5, 0, 5, 2,   // side face (x = 0)
          1, 2, 5, 1, 5, 4,   // hypotenuse face
        ];
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setIndex(indices);
        geo.computeVertexNormals();
        return geo;
      }

      // Each corner: position = wall corner vertex; rotateY so legs point inward.
      // front = z < 0, rear = z > 0
      const cornerDefs = [
        { cx: -halfW, cz: -halfL, rotY: 0 }, // front-left
        { cx: halfW, cz: -halfL, rotY: -Math.PI / 2 }, // front-right
        { cx: halfW, cz: halfL, rotY: Math.PI }, // rear-right
        { cx: -halfW, cz: halfL, rotY: Math.PI / 2 }, // rear-left
      ];

      cornerDefs.forEach(({ cx, cz, rotY }) => {
        const isFront = cz < 0;
        const mode = isFront ? room.front_corners_mode : room.rear_corners_mode;
        if (mode === "none") return;

        let trapShape = isFront ? room.front_corners_shape : room.rear_corners_shape;
        const hexColor = isFront ? room.front_corners_color : room.rear_corners_color;

        const isHalf = trapShape === 'triangle_half' || trapShape === 'square_half';
        const isSquare = trapShape === 'two_towers' || trapShape === 'square_half';

        // Height: half-traps are ~1.2m, full traps scale to ceiling
        const rawTrapH = isHalf ? 1.2 : room.height_m * trapHFr;
        let localCeilH = rawTrapH;
        
        if (!isHalf && hasSlopedCeiling) {
          const localCeilY = ceilingYAt(cx, cz);
          const localHeight = localCeilY - floorY;
          localCeilH = Math.max(0.1, localHeight * trapHFr);
        }
        
        if (isHalf) {
          localCeilH = Math.min(localCeilH, room.height_m * 0.95);
        } else {
          const maxSafeH = Math.max(0.1, hasSlopedCeiling
            ? ceilingYAt(cx, cz) - floorY
            : room.height_m);
          localCeilH = Math.min(localCeilH, maxSafeH * 0.95); // 5% clearance from ceiling
        }

        let geo;
        if (isSquare) {
          // Square column: ~0.3m x 0.3m footprint
          geo = new THREE.BoxGeometry(0.3, localCeilH, 0.3);
        } else {
          geo = _makeCornerTrapGeo(trapLeg, localCeilH);
        }

        const mesh = new THREE.Mesh(geo, getPanelMat(hexColor));
        if (!isSquare) {
          // Triangle sits exactly at the wall corner; no box-centre offset needed
          mesh.position.set(offsetX + cx, floorY, cz);
          mesh.rotation.y = rotY;
        } else {
          // Square BoxGeometry is centre-origin
          const inset = 0.3 / 2;
          const cxIn = cx - Math.sign(cx) * inset;
          const czIn = cz - Math.sign(cz) * inset;
          mesh.position.set(offsetX + cxIn, floorY + localCeilH / 2, czIn);
        }
        roomGroup.add(mesh);
        // Bass traps straddle two walls + the floor. Phase 1 picks one
        // primary surface per trap, aligned with bass_trap_mode semantics:
        // front-corners → 'front', rear-corners → 'back'. Known limitation:
        // the side wall and the floor under the trap still flash pink.
        _addPanelCyanFlash(mesh, isFront ? 'front' : 'back');
      });

    }

    // --- CEILING PANELS ---
    if (room.ceiling_mode === "cloud" || room.ceiling_mode === "flush") {

      let cpW, cpL, thickness;
      if (room.ceiling_size === 'mini') {
        cpW = 1.04;
        cpL = 0.64;
        thickness = 0.12;
      } else {
        // standard
        cpW = 1.52;
        cpL = 1.08;
        thickness = 0.14;
      }

      if (room.ceiling_direction === 'portrait') {
        const temp = cpW;
        cpW = cpL;
        cpL = temp;
      }

      const spkZ = -room.length_m / 2 + (room.spk_front_m ?? 0.45);
      const midZ = (spkZ + listenerZ) / 2;

      // Industry standard: 300–460mm air gap when hanging (400mm = 16" midpoint)
      const isFlush = room.ceiling_mode === 'flush';
      const dropGap = isFlush ? 0 : 0.40;

      const cCount = room.ceiling_count || 1;
      const cGap = 0.2;
      let startZ, startX, stepZ, stepX;
      
      const frontClearance = 0.05;
      const rearClearance = 0.05;

      if (room.ceiling_direction === 'portrait') {
        const cTotalW = cCount * cpW + (cCount - 1) * cGap;
        const minZ = -room.length_m / 2 + cpL / 2 + frontClearance;
        const maxZ =  room.length_m / 2 - cpL / 2 - rearClearance;
        const groupCenterZ = (minZ > maxZ) ? 0 : Math.max(minZ, Math.min(maxZ, midZ));
        
        startZ = groupCenterZ;
        startX = offsetX - cTotalW / 2 + cpW / 2;
        stepZ = 0;
        stepX = cpW + cGap;
      } else {
        const cTotalL = cCount * cpL + (cCount - 1) * cGap;
        const minZ = -room.length_m / 2 + cTotalL / 2 + frontClearance;
        const maxZ =  room.length_m / 2 - cTotalL / 2 - rearClearance;
        const groupCenterZ = (minZ > maxZ) ? 0 : Math.max(minZ, Math.min(maxZ, midZ));
        
        startZ = groupCenterZ - cTotalL / 2 + cpL / 2;
        startX = offsetX;
        stepZ = cpL + cGap;
        stepX = 0;
      }

      for (let i = 0; i < cCount; i++) {
        const pZ = startZ + i * stepZ;
        const pX = startX + i * stepX;

        if (isFlush) {
          // ── FLUSH: panels follow the ceiling surface ──────────────────────────
          if (isGable) {
            // Two angled panels, one on each pitched face
            const panelGroup = new THREE.Group();
            if (gableAxis === "depth") {
              const slopeAngle = Math.atan2(room.height_m - lowH, room.width_m / 2);
              const halfWidth = cpW / 2;
              const leftX = pX - halfWidth / 2;
              const rightX = pX + halfWidth / 2;
              const lp = new THREE.Mesh(new THREE.BoxGeometry(halfWidth - 0.05, thickness, cpL), getPanelMat(room.ceiling_color));
              lp.position.set(leftX, ceilingYAt(leftX, pZ) - thickness / 2, pZ);
              lp.rotation.z = slopeAngle;
              const rp = new THREE.Mesh(new THREE.BoxGeometry(halfWidth - 0.05, thickness, cpL), getPanelMat(room.ceiling_color));
              rp.position.set(rightX, ceilingYAt(rightX, pZ) - thickness / 2, pZ);
              rp.rotation.z = -slopeAngle;
              panelGroup.add(lp, rp);
              _addPanelCyanFlash(lp, 'ceiling');
              _addPanelCyanFlash(rp, 'ceiling');
            } else {
              const slopeAngle = Math.atan2(room.height_m - lowH, room.length_m / 2);
              const halfLength = cpL / 2;
              const frontZ = pZ - halfLength / 2;
              const backZ = pZ + halfLength / 2;
              const fp = new THREE.Mesh(new THREE.BoxGeometry(cpW, thickness, halfLength - 0.05), getPanelMat(room.ceiling_color));
              fp.position.set(pX, ceilingYAt(pX, frontZ) - thickness / 2, frontZ);
              fp.rotation.x = -slopeAngle;
              const bp = new THREE.Mesh(new THREE.BoxGeometry(cpW, thickness, halfLength - 0.05), getPanelMat(room.ceiling_color));
              bp.position.set(pX, ceilingYAt(pX, backZ) - thickness / 2, backZ);
              bp.rotation.x = slopeAngle;
              panelGroup.add(fp, bp);
              _addPanelCyanFlash(fp, 'ceiling');
              _addPanelCyanFlash(bp, 'ceiling');
            }
            roomGroup.add(panelGroup);

          } else if (isSlanted) {
            // Single panel tilted to follow the slope
            const panelCeilY = ceilingYAt(pX, pZ);
            const panel = new THREE.Mesh(new THREE.BoxGeometry(cpW, thickness, cpL), getPanelMat(room.ceiling_color));
            panel.position.set(pX, panelCeilY - thickness / 2, pZ);
            const isZSlant = slantDir === "front_to_back" || slantDir === "back_to_front";
            const span = isZSlant ? room.length_m : room.width_m;
            const slopeAngle = Math.atan2(room.height_m - lowH, span);
            if (isZSlant) panel.rotation.x = (slantDir === "back_to_front" ? -1 : 1) * slopeAngle;
            else panel.rotation.z = (slantDir === "left_to_right" ? 1 : -1) * slopeAngle;
            roomGroup.add(panel);
            _addPanelCyanFlash(panel, 'ceiling');

          } else {
            // Flat: horizontal panel pressed against ceiling
            const panel = new THREE.Mesh(new THREE.BoxGeometry(cpW, thickness, cpL), getPanelMat(room.ceiling_color));
            panel.position.set(pX, room.height_m / 2 - thickness / 2, pZ);
            roomGroup.add(panel);
            _addPanelCyanFlash(panel, 'ceiling');
          }

        } else {
          // ── HANGING (cloud): always a single HORIZONTAL panel ────────────────
          const footprintCeilMin = Math.min(
            ceilingYAt(pX - cpW / 2, pZ - cpL / 2),
            ceilingYAt(pX + cpW / 2, pZ - cpL / 2),
            ceilingYAt(pX - cpW / 2, pZ + cpL / 2),
            ceilingYAt(pX + cpW / 2, pZ + cpL / 2)
          );
          const drop = room.ceiling_drop_m || 0.4;
          const cloudY = footprintCeilMin - drop - thickness / 2;

          const panel = new THREE.Mesh(new THREE.BoxGeometry(cpW, thickness, cpL), getPanelMat(room.ceiling_color));
          panel.rotation.set(0, 0, 0);
          panel.position.set(pX, cloudY, pZ);
          roomGroup.add(panel);
          _addPanelCyanFlash(panel, 'ceiling');

          const wireMat = new THREE.LineBasicMaterial({ color: 0x999999, transparent: true, opacity: 0.55 });
          const panelTopY = cloudY + thickness / 2;
          const hW2 = cpW / 2, hL2 = cpL / 2;
          [
            [pX - hW2, pZ - hL2],
            [pX + hW2, pZ - hL2],
            [pX - hW2, pZ + hL2],
            [pX + hW2, pZ + hL2],
          ].forEach(([wx, wz]) => {
            const wireTop = ceilingYAt(wx, wz);
            if (wireTop <= panelTopY) return;
            roomGroup.add(new THREE.LineSegments(
              new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(wx, panelTopY, wz),
                new THREE.Vector3(wx, wireTop, wz),
              ]),
              wireMat
            ));
          });
        }
      }
    }

    // --- SIDE PANELS ---
    if (room.side_wall_mode !== "none" || simulatePanels) {

      const wallX = room.width_m / 2;
      const earY = -(room.height_m / 2) + (room.tweeter_height_m ?? 0.9);

      const listenerPos = new THREE.Vector3(
        offsetX,
        earY,
        listenerZ
      );

      for (const side of [-1, 1]) {

        if (!simulatePanels) {
          if (room.side_wall_mode === "left" && side === 1) continue;
          if (room.side_wall_mode === "right" && side === -1) continue;
          if (room.side_wall_mode === "none") continue;
        }

        const spkZ = -room.length_m / 2 + room.spk_front_m;
        const speakerPos = new THREE.Vector3(
          offsetX + side * room.spk_spacing_m / 2,
          earY,
          spkZ
        );

        const mirrorSpeaker = speakerPos.clone();
        mirrorSpeaker.x = side * wallX + (side * wallX - speakerPos.x);

        const dir = new THREE.Vector3().subVectors(mirrorSpeaker, listenerPos);
        const t = (side * wallX - listenerPos.x) / dir.x;

        const bouncePoint = listenerPos.clone().add(dir.multiplyScalar(t));

        // Canonical individual panels from treatment-registry.js — same on all pages.
        // Side panels are portrait orientation, centred on the first-reflection bounce point.
        const spGeo = window.MeasurelyTreatment?.GEOMETRY?.side_panel;
        const spW = spGeo?.panelWidth ?? 0.60;
        const spH_panel = spGeo?.panelHeight ?? 1.20;
        const spGap = spGeo?.panelGap ?? 0.04;
        const spThickness = spGeo?.thickness ?? 0.06;
        const spBaseLen = spGeo?.length ?? 0.90;
        
        const spLength = Math.min(
          spBaseLen * Math.max(1, room.length_m / 4.0),
          room.length_m * 0.45
        );

        const spCount = (room.side_wall_count != null)
          ? Math.max(1, Math.floor(room.side_wall_count))
          : Math.max(1, Math.floor((spLength + spGap) / (spW + spGap)));
        const spTotalSpan = spCount * spW + (spCount - 1) * spGap;

        // Clamp the group center so panels don't clip through the front or rear walls,
        // or through the bass traps if they are present in the corners.
        const trapLeg = window.MeasurelyTreatment?.GEOMETRY?.bass_trap?.legSize ?? 0.42;
        const hasFrontTraps = (room.front_corners_mode && room.front_corners_mode !== 'none') || room.bass_trap_mode === 'front' || room.bass_trap_mode === 'all';
        const hasRearTraps = (room.rear_corners_mode && room.rear_corners_mode !== 'none') || room.bass_trap_mode === 'rear' || room.bass_trap_mode === 'all';
        const frontClearance = hasFrontTraps ? trapLeg + 0.05 : 0.05;
        const rearClearance = hasRearTraps ? trapLeg + 0.05 : 0.05;

        const minZ = -room.length_m / 2 + spTotalSpan / 2 + frontClearance;
        const maxZ =  room.length_m / 2 - spTotalSpan / 2 - rearClearance;
        
        // If the span is longer than the entire room, center it to minimise clipping.
        const groupCenterZ = (minZ > maxZ) 
          ? 0 
          : Math.max(minZ, Math.min(maxZ, bouncePoint.z));

        for (let i = 0; i < spCount; i++) {
          const pz = groupCenterZ - spTotalSpan / 2 + spW / 2 + i * (spW + spGap);

          const wallCeilY = ceilingYAt(side * (wallX - spThickness / 2), pz);
          const spFloor = -room.height_m / 2;
          const spCentreY = spFloor + (room.tweeter_height_m ?? 0.95);
          const panelBot = spCentreY - spH_panel / 2;
          const panelTop = Math.min(spCentreY + spH_panel / 2, wallCeilY - 0.04);
          const effH = Math.max(0.10, panelTop - panelBot);

          const panelGroup = createPanelGroup(room.side_wall_style, spW, effH, spThickness, room.side_wall_color);
          panelGroup.position.set(side * (wallX - spThickness / 2), panelBot + effH / 2, pz);
          
          // Left wall faces +X (Math.PI/2), Right wall faces -X (-Math.PI/2)
          panelGroup.rotation.y = side === -1 ? Math.PI / 2 : -Math.PI / 2;

          roomGroup.add(panelGroup);
          _addPanelCyanFlash(panelGroup, side === -1 ? 'left' : 'right');
        }
      }

    }

    renderHighlightOverlays(room);
    renderAnalysisOverlays(room);
    renderWallLabels(room);

    // Shared surface-impact + heat-map shell. Built after the overlays so it
    // can read the same treatment state; lives in roomGroup so the next
    // rebuild's disposal traverse frees it. Stays invisible (and idle) until a
    // ball strikes a surface and impactAt() deposits the first heat.
    _buildHeatShell(room);

    // Auto-toe: snap speakers to face the sphere after every full rebuild
    _applyAutoToe();

    // Smoothness overlay was removed in May 2026: the volumetric standing-
    // wave field duplicated information Bass Modes already shows (measured
    // peaks/dips with severity colour) and the focused node-plane labels
    // were a Bass-Modes-style migration of the same predicted/measured
    // correlation. A future Smoothness focused-view (likely a 2D frequency
    // response chart) may return when findings primary lands.
    // The Smoothness SCORE is preserved (scoreSmooth in score.js, surfaced
    // through the HUD pillar breakdown).

  }

  /* ------------------------------------------
    ANIMATION LOOP
  ------------------------------------------ */
  function animate() {
    requestAnimationFrame(animate);

    if (_mirrorBall && _discoEnabled) {
      _mirrorBall.rotation.y -= 0.005;
    }

    let scale = baseScale;

    // ANALYSIS PULSE
    if (currentMode === "analysing") {
      const now = performance.now();
      const elapsed = analysisStart ? now - analysisStart : 0;

      analysisPulse += 0.01;
      scale = baseScale * (1 + Math.sin(analysisPulse) * 0.01);

      if (elapsed >= ANALYSIS_DURATION) {
        currentMode = "final";
        analysisStart = null;
        analysisPulse = 0;
        rebuild();
      }
    }

    // DASHED LINE ENERGY MOTION — skip invisible speaker beams
    scene.traverse(obj => {
      if (obj.isLine && obj.material?.type === 'LineDashedMaterial' && obj.visible) {
        obj.material.dashOffset -= 0.01;
      }
    });

    // CROWD ANIMATION
    const _nowT = performance.now() * 0.001;
    const _dummy = new THREE.Object3D();
    scene.traverse(obj => {
      if (obj.userData?.isCrowd && obj.geometry.type === 'CylinderGeometry') {
        const bodyMesh = obj;
        // Find head mesh (same parent, same geometry but sphere)
        const headMesh = bodyMesh.parent.children.find(c => c.userData?.isCrowd && c.geometry.type === 'SphereGeometry');
        const instances = bodyMesh.userData.instances;
        if (!instances || !headMesh) return;
        
        const bpm = bodyMesh.userData.bpm || 126;
        const beatRate = bpm / 60; // 120 bpm = 2 bps
        const floorY = bodyMesh.userData.floorY || 0;
        
        for (let i = 0; i < instances.length; i++) {
          const inst = instances[i];
          const sway = Math.sin(_nowT * 2 + inst.phase) * 0.05;
          const bob = Math.abs(Math.sin(_nowT * beatRate * Math.PI + inst.phase)) * 0.09;
          
          _dummy.position.set(inst.x + sway, floorY, inst.z);
          _dummy.scale.set(1, inst.hScale, 1);
          _dummy.rotation.y = inst.yRot;
          _dummy.updateMatrix();
          bodyMesh.setMatrixAt(i, _dummy.matrix);
          
          _dummy.position.set(inst.x + sway, floorY + 1.4 * inst.hScale + 0.15 + bob, inst.z);
          _dummy.scale.setScalar(inst.hScale);
          _dummy.updateMatrix();
          headMesh.setMatrixAt(i, _dummy.matrix);
        }
        
        bodyMesh.instanceMatrix.needsUpdate = true;
        headMesh.instanceMatrix.needsUpdate = true;
      } else if (obj.userData?.isDJGroup) {
        const sway = Math.sin(_nowT * 2 + obj.userData.phase) * 0.05;
        obj.position.x = obj.userData.baseX + sway;
      } else if (obj.userData?.isDJHead) {
        const bpm = obj.userData.bpm || 126;
        const beatRate = bpm / 60;
        const bob = Math.abs(Math.sin(_nowT * beatRate * Math.PI + obj.userData.phase)) * 0.09;
        obj.position.y = obj.userData.baseY + bob;
      }
    });

    // PULSE DOTS at reflection bounce points
    const _pt = performance.now() * 0.003;
    scene.traverse(obj => {
      if (obj.userData?.isPulseDot) {
        const s = 1 + 0.4 * Math.sin(_pt);
        obj.scale.setScalar(s);
      }
    });

    // TRAVELLING PINGS — heartbeat model (all pings launch at T=0 of each 2 s cycle)
    {
      const SOUND_SPEED  = 343;       // m/s
      const VISUAL_SCALE = 0.065;     // visual compression factor
      const HEARTBEAT_MS = 2000;      // ms — one full cycle
      const nowMs  = performance.now();
      const syncT  = (nowMs % HEARTBEAT_MS) / 1000; // 0 → 2.0 s, resets every 2 s

      // Colour target from activeScore: pink → amber → cyan
      const _colPink  = new THREE.Color(OC.PRESSURE_PEAK);
      const _colAmber = new THREE.Color(OC.REAR_AMBER);
      const _colCyan  = new THREE.Color(0x00FFFF);
      const scoreFrac = Math.min(Math.max((activeScore - 3) / 7, 0), 1);
      const targetPingColor = scoreFrac < 0.5
        ? _colPink.clone().lerp(_colAmber, scoreFrac * 2)
        : _colAmber.clone().lerp(_colCyan, (scoreFrac - 0.5) * 2);

      scene.traverse(obj => {
        if (!obj.userData?.isTravelDot) return;
        const { path, pathLen, leg1Frac, baseColor, absorption = 0 } = obj.userData.isTravelDot;
        if (!pathLen) return;

        const travelTime = pathLen / (SOUND_SPEED * VISUAL_SCALE);
        const progress   = syncT / travelTime;

        if (progress >= 1.0) {
          if (obj.visible) {
            obj.visible = false;
            if (obj.children[0]) obj.children[0].visible = false;
            // Spawn arrival splash ring at listener position (path[2])
            const splashGeo = new THREE.RingGeometry(0, 0.001, 24);
            const splashMat = new THREE.MeshBasicMaterial({
              color: obj.material.color.getHex(),
              transparent: true, opacity: 0.9,
              side: THREE.DoubleSide, depthTest: false, depthWrite: false,
            });
            const splash = new THREE.Mesh(splashGeo, splashMat);
            splash.position.copy(path[2]);
            splash.rotation.x = -Math.PI / 2;
            splash.renderOrder = 16;
            roomGroup.add(splash);
            _splashRings.push({ mesh: splash, startMs: nowMs });
          }
          return;
        }

        obj.visible = true;
        if (obj.children[0]) obj.children[0].visible = true;

        const split = leg1Frac;
        const postBounce = progress > split; // past the wall reflection point
        if (progress < split) {
          obj.position.lerpVectors(path[0], path[1], progress / split);
        } else {
          obj.position.lerpVectors(path[1], path[2], (progress - split) / (1 - split));
        }

        // ─ Colour: snap directly to baseColor (instant treatment toggle response) ─
        obj.material.color.copy(baseColor);

        // ─ Absorption: post-bounce ping is shrunken & dimmed when panels are active ─
        const absorbScale   = postBounce ? (1 - absorption * 0.60) : 1.0;
        const absorbOpacCap = postBounce ? Math.max(0.30, 1 - absorption * 0.70) : 1.0;
        obj.scale.setScalar(absorbScale);

        // Opacity envelope — fade in/out at journey ends, then clamp by absorption
        const fadeWindow = 0.12;
        const rawOpacity = progress < fadeWindow
          ? (progress / fadeWindow) * 0.92
          : progress > (1 - fadeWindow)
            ? ((1 - progress) / fadeWindow) * 0.92
            : 0.92;
        const pingOpacity = rawOpacity * absorbOpacCap;
        obj.material.opacity = pingOpacity;

        if (obj.children[0]) {
          obj.children[0].material.opacity = Math.min(pingOpacity * 1.15, 1);
        }
      });

      // COMET TRAILS — ring-buffer position history
      scene.traverse(obj => {
        if (!obj.userData?.isCometTrail) return;
        const { dot, pts } = obj.userData.isCometTrail;
        if (!dot.visible) { obj.material.opacity = 0; return; }
        pts.unshift(dot.position.clone());
        pts.pop();
        obj.geometry.setFromPoints(pts);
        obj.geometry.computeBoundingSphere();
        obj.material.opacity = (dot.material.opacity ?? 0) * 0.40;
        obj.material.color.copy(dot.material.color);
      });

      // ARRIVAL SPLASH RINGS — scale up and fade over 200 ms
      for (let si = _splashRings.length - 1; si >= 0; si--) {
        const sr      = _splashRings[si];
        const elapsed = nowMs - sr.startMs;          // ms since spawn
        const SPLASH_DUR = 220;                       // ms
        if (elapsed >= SPLASH_DUR) {
          roomGroup.remove(sr.mesh);
          sr.mesh.geometry.dispose();
          sr.mesh.material.dispose();
          _splashRings.splice(si, 1);
        } else {
          const t = elapsed / SPLASH_DUR;             // 0 → 1
          const r = t * 0.20;                         // 0 → 0.20 m radius
          sr.mesh.scale.setScalar(r < 0.001 ? 0.001 : r);
          sr.mesh.material.opacity = (1 - t) * 0.85;
        }
      }
    }

    // WAVE RINGS — expanding circles from each speaker at tweeter height,
    // plus an interference indicator at the listening position.
    // The interference calc visualises the CONCEPT of constructive
    // interference at the MLP — the wave-rings propagate at ~1.5 m/s for
    // visual rhythm, not 343 m/s, so this is NOT audio-rate physics. The
    // SBIR shader plane remains the measured-energy layer.
    if (_waveRings.length > 0) {
      // Reduced-motion: freeze the rings at phase 0 (no expansion) — matches the
      // field/overlay freeze behaviour. _wt held constant when motion is reduced.
      const _ringsReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const _wt = _ringsReduced ? 0 : performance.now() * 0.001;
      const WAVE_CYCLE = WAVE_CYCLE_S; // seconds per full cycle (shared with Reflections)

      // Per-frame distances from each speaker to the MLP — invariant across
      // all 10 rings, so compute once. Speaker / MLP positions are stashed
      // by rebuild() in _spk*LocalPos / _mlpLocalPos.
      const _dL = _spkLeftLocalPos.distanceTo(_mlpLocalPos);
      const _dR = _spkRightLocalPos.distanceTo(_mlpLocalPos);
      const INTERFERENCE_SIGMA = 0.15;
      const _TWO_SIGMA_SQ = 2 * INTERFERENCE_SIGMA * INTERFERENCE_SIGMA;
      let _mlpEnergyL = 0, _mlpEnergyR = 0;

      for (let wi = 0; wi < _waveRings.length; wi++) {
        const ring = _waveRings[wi];
        if (ring.userData.baseY === undefined) ring.userData.baseY = ring.position.y;
        let phase = (_wt / WAVE_CYCLE + ring.userData.wavePhase) % 1.0;
        if (ring.userData.speakerSide === 'SUB') {
          // Shockwave pulse, not a continuously-cycling ring: fast
          // expand+fade over PULSE_DUR seconds, then silent until the next
          // beat -- reads as a "thump" instead of a slow repeating wave.
          const beatRate = 45 / 60; // Hz
          const beatPeriod = 1 / beatRate;
          const PULSE_DUR = 0.5; // seconds the pulse stays visible
          const bob = Math.abs(Math.sin(_nowT * beatRate * Math.PI)) * 0.09;
          ring.position.y = ring.userData.baseY + bob;
          const tSincePulse = ((_nowT + ring.userData.wavePhase * beatPeriod) % beatPeriod);
          phase = Math.min(1, tSincePulse / PULSE_DUR); // clamps at 1 (invisible) between pulses
        }
        const r = phase * ring.userData.waveMaxR;
        ring.scale.set(r, 1, r);
        // Peak opacity = base 0.40 × waveAmp — REW nulls produce dimmer rings.
        // waveAmp is 1.0 in simulation mode (no REW data) so no visual regression.
        // Tube primitive has far more pixel coverage than the prior 1-px Line,
        // so the base is dialled down to avoid oversaturating the canvas.
        // 2026-05 tuning: 0.55 → 0.40 (~27%) so wave rings don't compete
        // with the reflection overlay's HDR cyan panel flashes.
        const _peakOp = 0.40 * (ring.userData.waveAmp ?? 1.0);
        ring.material.opacity = Math.max(0, (1 - phase) * _peakOp);
        // Lerp toward treatment-driven target color (cyan=treated, pink=untreated)
        // Only override colour in simulation mode — REW data already set colour on build.
        if (ring.userData.targetColor && !_rewFreqs) {
          ring.material.color.lerp(ring.userData.targetColor, 0.06);
        }

        // Contribution to MLP interference: Gaussian on the gap between
        // this ring's current radius and its speaker → MLP distance.
        // Peaks (≈1.0) when the wavefront is passing through the listener.
        const speakerDist  = ring.userData.speakerSide === 'L' ? _dL : _dR;
        const wavefrontGap = r - speakerDist;
        const contribution = Math.exp(-(wavefrontGap * wavefrontGap) / _TWO_SIGMA_SQ);
        if (ring.userData.speakerSide === 'L') _mlpEnergyL += contribution;
        else                                    _mlpEnergyR += contribution;
      }

      // Multiplicative combination — sqrt(L * R) is ~0 unless BOTH channels
      // have wavefronts at the listener simultaneously (true constructive
      // interference). Drives the disc's opacity and a subtle 1.0 → 1.25
      // scale pulse so peaks read kinetically as well as luminously.
      if (_interferenceIndicator) {
        const _constructive = Math.sqrt(_mlpEnergyL * _mlpEnergyR);
        _interferenceIndicator.material.opacity =
          Math.min(1, Math.max(0, _constructive * 0.85));
        const _s = 1.0 + Math.min(1, _constructive) * 0.25;
        _interferenceIndicator.scale.set(_s, _s, _s);
      }
    }

    // SBIR motion — energy streams collide and get eaten at the suckouts /
    // pop into flares at the walls; the seat vortex throbs at the dip.
    _animateSbirStreams(performance.now());

    // Bass Modes (Resonance) — the field itself is baked (static texture, no
    // per-frame shader work); the LIFE is the interior particle cloud, which
    // vibrates in place at the room's dominant-mode tempo. Frozen under
    // prefers-reduced-motion (handled inside _animateBassModes).
    _animateBassModes(performance.now());

    // Side reflection wave field — advance time uniform
    {
      const sideField = roomGroup.children.find(o => o.userData?.isSideRefField);
      if (sideField?.material?.uniforms && !sideField.material.uniforms.uReducedMotion?.value) {
        sideField.material.uniforms.uTime.value = performance.now() * 0.002;
      }
    }

    // Reflections behavioural simulation — drive pulse position/opacity,
    // wall flash glow, and listener halo from the cycle clock. Geometry
    // and event schedules are baked at rebuild time; this block only
    // mutates position/opacity. Reduced-motion freezes the simulation:
    // pulses hide, wall flashes show static at half their event strength
    // so the user still sees which surfaces reflect strongly.
    {
      const REFL_CYCLE_S = _reflCyclePeriod;
      const reducedRefl = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const cycleTime   = reducedRefl ? 0 : (performance.now() / 1000) % REFL_CYCLE_S;

      // Shared surface-impact: fire impactAt() each time the cycle clock
      // crosses a bounce's wall-arrival (flashStart), so each reflection feeds
      // the splash + heat map exactly once per loop. Frozen under reduced
      // motion (pulses are parked) — the heat map can still build from Impulse.
      if (!reducedRefl && _reflImpactEvents.length) {
        const prev = _reflImpactPrevCycle;
        for (const ev of _reflImpactEvents) {
          const fired = (prev <= cycleTime)
            ? (ev.flashStart > prev && ev.flashStart <= cycleTime)
            : (ev.flashStart > prev || ev.flashStart <= cycleTime);   // clock wrapped
          if (fired) impactAt(ev.surface, ev.point, ev.energy);
        }
        _reflImpactPrevCycle = cycleTime;
      }

      roomGroup.children.forEach(obj => {
        const ud = obj.userData;
        if (!ud) return;

        if (ud.isReflectionBallField) {
          // Frequency-banded pulse clusters — one InstancedMesh, one draw call.
          // Per instance: position-lerp along the shared path, per-band SIZE,
          // and per-band BRIGHTNESS folded into the additive instance colour
          // (additive blending: a dimmer colour contributes less light, so we
          // never need per-instance opacity / a custom shader).
          const descs = ud.isReflectionBallField;
          for (let bi = 0; bi < descs.length; bi++) {
            const d = descs[bi];
            let scl = 0, bright = 0;
            if (reducedRefl) {
              // Static + brighter: park the pink return balls at their bounce
              // point so per-surface treatment dimming reads spatially; the
              // teal outgoing companions rest hidden to keep the frame calm.
              if (d.kind === 'return') {
                _reflPos.copy(d.from);          // return.from === the bounce point
                scl = d.radius;
                bright = d.brightness;
              }
            } else {
              const t = (cycleTime - d.start) / (d.end - d.start);
              if (t >= 0 && t <= 1) {
                const env = t < 0.2 ? t / 0.2 : t > 0.8 ? (1 - t) / 0.2 : 1;
                // Launch pop — quick scale/brightness overshoot as the ball
                // leaves its origin (first 18% of travel).
                const pop = t < 0.18 ? 1 + 0.6 * (1 - t / 0.18) : 1;
                _reflPos.copy(d.from).lerp(d.to, t);
                scl = d.radius * pop;
                bright = d.brightness * env * (0.85 + 0.15 * pop);
              }
            }
            _reflScale.setScalar(scl);
            _reflM.compose(_reflPos, _reflQuat, _reflScale);
            obj.setMatrixAt(bi, _reflM);
            _reflCol.copy(d.color).multiplyScalar(bright);
            obj.setColorAt(bi, _reflCol);
          }
          obj.instanceMatrix.needsUpdate = true;
          if (obj.instanceColor) obj.instanceColor.needsUpdate = true;

        } else if (ud.isReflectionFlash) {
          const d = ud.isReflectionFlash;
          if (reducedRefl) {
            obj.material.opacity = d.surfaceStrength * 0.4;
            return;
          }
          let intensity = 0;
          for (const ev of d.events) {
            const dt = cycleTime - ev.start;
            if (dt >= 0 && dt < ev.duration) {
              const t = dt / ev.duration;
              // Asymmetric envelope: fast attack (peak at 20% of flash
              // duration), longer decay — reads as absorbed energy
              // rather than frame flicker.
              const env = t < 0.2 ? t / 0.2 : (1 - t) / 0.8;
              const v = ev.strength * env;
              if (v > intensity) intensity = v;
            }
          }
          obj.material.opacity = intensity * 0.85;

        } else if (ud.isReflectionHalo) {
          const d = ud.isReflectionHalo;
          if (reducedRefl) { obj.material.opacity = 0; return; }
          let intensity = 0;
          // Default envAtPeak=1 → scale 1.0 at rest (no active arrival).
          // Decays to 0 as the dominant event ages out, growing scale to 1.6.
          let envAtPeak = 1;
          for (const ev of d.events) {
            const dt = cycleTime - ev.hitTime;
            if (dt >= 0 && dt < 0.4) {
              const env = 1 - dt / 0.4;
              const v = ev.strength * env;
              if (v > intensity) {
                intensity = v;
                envAtPeak = env;
              }
            }
          }
          obj.material.opacity = intensity * 0.95;
          obj.scale.setScalar(1.0 + 0.6 * (1 - envAtPeak));
        }
      });
    }

    _tickSoundBurst();   // showpiece swarm — no-op unless a burst is running
    // Shared surface-impact + heat map: the Layer-1 ripple tick (every frame),
    // then the throttled Layer-2 accumulation pass which renders into the
    // off-screen atlas BEFORE the main scene render so the shell samples the
    // current frame's heat. Both no-op while idle / context-lost.
    _tickHeatSplashes();
    roomGroup.scale.set(scale, scale, scale);
    if (flyAnim) flyAnim.tick(performance.now());
    controls.update();
    // Skip render while the WebGL context is lost — render() against a
    // dead context is wasted work and spams the console. rAF keeps
    // ticking so we resume the moment `webglcontextrestored` clears the flag.
    if (!_animationPaused) {
      _updateHeatAccumulation();   // off-screen RT pass (decay + splat), then…
      renderer.render(scene, camera);
    }

  }


  // Build a Core+Aura dual-tube energy vector between two points.
  // Outer aura: thick, coloured, semi-transparent.  Inner core: thin, white, solid.
  // Both use MeshBasicMaterial (light-independent) with DoubleSide for full visibility.
  function _addReflectionTube(a, b, color, opacity = 0.85) {
    const curve    = new THREE.LineCurve3(a.clone(), b.clone());
    const segments = Math.max(3, Math.ceil(a.distanceTo(b) * 8));

    // ── Outer aura ─────────────────────────────────────────────
    const AURA_R = useFatEdges ? 0.050 : 0.040;
    const auraMat = new THREE.MeshBasicMaterial({
      color:       color,
      transparent: true,
      opacity:     opacity * 0.5,   // semi-transparent aura
      side:        THREE.DoubleSide,
      depthTest:   false,
      depthWrite:  false,
    });
    const auraGeo  = new THREE.TubeGeometry(curve, segments, AURA_R, 7, false);
    const auraMesh = new THREE.Mesh(auraGeo, auraMat);
    auraMesh.renderOrder = 10;
    roomGroup.add(auraMesh);

    // ── Inner core ─────────────────────────────────────────────
    const CORE_R = useFatEdges ? 0.016 : 0.012;
    const coreMat = new THREE.MeshBasicMaterial({
      color:       0xFFFFFF,        // white hot core
      transparent: true,
      opacity:     opacity,
      side:        THREE.DoubleSide,
      depthTest:   false,
      depthWrite:  false,
    });
    const coreGeo  = new THREE.TubeGeometry(curve, segments, CORE_R, 5, false);
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    coreMesh.renderOrder = 11;      // renders on top of aura
    roomGroup.add(coreMesh);
  }

  // Draw a two-leg reflection path (speaker → bounce → listener) using mesh tubes.
  // Adds a pulsing sphere at the bounce point, a travelling pulse dot, and a
  // surface-normal indicator at the bounce point.
  // absorption: 0 = full strength, 1 = fully absorbed (dims tubes + dots)
  function drawReflectionPath(start, bounce, end, color = 0xd4950f, absorption = 0) {
    // Scale tube brightness by measured 2–8 kHz energy (where reflections are most
    // audible as stereo smearing / harshness). Falls back to 1.0 with no REW data.
    //   -60 dBFS (dead room) → rewScale 0.25  (tubes nearly invisible)
    //   -20 dBFS (typical)   → rewScale 0.67  (tubes moderate)
    //    -6 dBFS (harsh)     → rewScale 1.00  (tubes at full brightness)
    const _rfEnergy  = _rewBandEnergy(2000, 8000, -20);
    const _rewScale  = Math.max(0.25, Math.min(1.0, (_rfEnergy + 60) / 54));
    const tubeOpacity = 0.85 * (1 - absorption * 0.75) * _rewScale;
    _addReflectionTube(start, bounce, color, tubeOpacity);
    _addReflectionTube(bounce, end, color, tubeOpacity * 0.5); // second leg dimmer — energy lost at panel

    // Bounce hotspot — Core+Aura sphere at wall reflection point
    const hotspotOpacity = 0.9 * (1 - absorption * 0.7);

    // Aura sphere (large, coloured, 0.5 opacity)
    const auraHotspot = new THREE.Mesh(
      new THREE.SphereGeometry(useFatEdges ? 0.15 : 0.12, 16, 10),
      new THREE.MeshBasicMaterial({
        color:       color,
        transparent: true,
        opacity:     hotspotOpacity * 0.5,
        side:        THREE.DoubleSide,
        depthTest:   false,
        depthWrite:  false,
      })
    );
    auraHotspot.position.copy(bounce);
    auraHotspot.renderOrder = 12;
    auraHotspot.userData.isPulseDot = true;
    roomGroup.add(auraHotspot);

    // Core sphere (small, white, solid)
    const coreHotspot = new THREE.Mesh(
      new THREE.SphereGeometry(useFatEdges ? 0.050 : 0.038, 12, 8),
      new THREE.MeshBasicMaterial({
        color:       0xFFFFFF,
        transparent: true,
        opacity:     hotspotOpacity,
        depthTest:   false,
        depthWrite:  false,
      })
    );
    coreHotspot.position.copy(bounce);
    coreHotspot.renderOrder = 13;
    roomGroup.add(coreHotspot);

    // ── Travelling ping — Core+Aura with physics-based timing and colour reactivity ──
    // Path length drives the travel period so L & R pings arrive in sync.
    const leg1 = start.distanceTo(bounce);
    const leg2 = bounce.distanceTo(end);
    const totalPathLen = leg1 + leg2;
    const leg1Frac     = leg1 / totalPathLen; // fraction of journey spent on first leg

    // Aura ping (large, coloured) — colour + size updated in render loop
    const tDot = new THREE.Mesh(
      new THREE.SphereGeometry(useFatEdges ? 0.075 : 0.060, 10, 7),
      new THREE.MeshBasicMaterial({
        color: color, transparent: true, opacity: 0,
        depthTest: false, depthWrite: false,
      })
    );
    tDot.renderOrder = 14;
    tDot.userData.isTravelDot = {
      path:         [start.clone(), bounce.clone(), end.clone()],
      phaseOffset:  0,                // cleared — sync epoch handles offset
      pathLen:      totalPathLen,     // metres
      leg1Frac,                       // where the bounce split is
      baseColor:    new THREE.Color(color),
      absorption,                     // 0 = untreated, 0.75 = fully treated
    };
    roomGroup.add(tDot);

    // Core ping (small, white) — child of tDot so it moves with it
    const tCore = new THREE.Mesh(
      new THREE.SphereGeometry(useFatEdges ? 0.028 : 0.022, 8, 6),
      new THREE.MeshBasicMaterial({
        color: 0xFFFFFF, transparent: true, opacity: 0,
        depthTest: false, depthWrite: false,
      })
    );
    tCore.renderOrder = 15;
    tDot.add(tCore); // child — inherits tDot.position

    // Comet trail — short line of TRAIL_LEN previous positions, fades out behind the ping
    const TRAIL_LEN = 6;
    const trailPts = new Array(TRAIL_LEN).fill(null).map(() => start.clone());
    const trailGeo = new THREE.BufferGeometry().setFromPoints(trailPts);
    const trailMat = new THREE.LineBasicMaterial({
      color: color, transparent: true, opacity: 0,
      depthTest: false, depthWrite: false, vertexColors: false,
    });
    const trailLine = new THREE.Line(trailGeo, trailMat);
    trailLine.renderOrder = 13;
    trailLine.userData.isCometTrail = { dot: tDot, pts: trailPts };
    roomGroup.add(trailLine);

    // Bounce normal — bisector of (bounce→start) and (bounce→end), 0.28 m long
    const toSrc = new THREE.Vector3().subVectors(start, bounce).normalize();
    const toDst = new THREE.Vector3().subVectors(end, bounce).normalize();
    const normal = new THREE.Vector3().addVectors(toSrc, toDst).normalize();
    const normalTip = bounce.clone().addScaledVector(normal, 0.28);
    const normMat = new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.38, depthWrite: false
    });
    const normLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([bounce.clone(), normalTip]),
      normMat
    );
    normLine.renderOrder = 11;
    roomGroup.add(normLine);
  }

  /* ------------------------------------------
    FIELD HIGHLIGHT OVERLAYS (SETUP WIZARD)
  ------------------------------------------ */
  function renderHighlightOverlays(room) {
    if (!highlightTarget) return;

    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x0f766e,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    if (highlightTarget === 'wall_length') {
      // Front wall (z = -length/2) and back wall (z = +length/2)
      [-1, 1].forEach(sign => {
        const wall = new THREE.Mesh(
          new THREE.PlaneGeometry(room.width_m, room.height_m),
          glowMat
        );
        wall.position.z = sign * room.length_m / 2;
        roomGroup.add(wall);
      });
    }

    if (highlightTarget === 'wall_width') {
      // Left wall (x = -width/2) and right wall (x = +width/2)
      [-1, 1].forEach(sign => {
        const wall = new THREE.Mesh(
          new THREE.PlaneGeometry(room.length_m, room.height_m),
          glowMat
        );
        wall.rotation.y = Math.PI / 2;
        wall.position.x = sign * room.width_m / 2;
        roomGroup.add(wall);
      });
    }

    if (highlightTarget === 'wall_height') {
      // Derive ceiling state from room (these are local to rebuild, not accessible here)
      const _isSlanted = room.ceiling_type === "slanted";
      const _isGable = room.ceiling_type === "gable";
      const _hasSlopedCeiling = _isSlanted || _isGable;
      const _lowH = _hasSlopedCeiling ? Math.min(room.ceiling_height_secondary_m, room.height_m) : room.height_m;
      const _slantDir = room.ceiling_slant_direction || "left_to_right";
      const _gableAxis = room.ceiling_gable_axis || "depth";
      const _highY = room.height_m / 2;
      const _lowY = -room.height_m / 2 + _lowH;

      if (_isSlanted) {
        // Build a quad with vertices at the actual ceiling height at each corner
        // This avoids Euler rotation twisting entirely
        const _hW = room.width_m / 2;
        const _hL = room.length_m / 2;

        // Compute ceiling Y at each corner based on slant direction
        function _ceilY(x, z) {
          let t;
          switch (_slantDir) {
            case "left_to_right": t = (x + _hW) / room.width_m; break;
            case "right_to_left": t = 1 - (x + _hW) / room.width_m; break;
            case "front_to_back": t = 1 - (z + _hL) / room.length_m; break;
            case "back_to_front": t = (z + _hL) / room.length_m; break;
            default: t = (x + _hW) / room.width_m;
          }
          return _lowY + t * (_highY - _lowY);
        }

        const verts = new Float32Array([
          -_hW, _ceilY(-_hW, -_hL), -_hL,
          _hW, _ceilY(_hW, -_hL), -_hL,
          _hW, _ceilY(_hW, _hL), _hL,
          -_hW, _ceilY(-_hW, _hL), _hL,
        ]);
        const indices = [0, 1, 2, 0, 2, 3];

        const ceilGeo = new THREE.BufferGeometry();
        ceilGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
        ceilGeo.setIndex(indices);
        ceilGeo.computeVertexNormals();

        const ceil = new THREE.Mesh(ceilGeo, glowMat);
        roomGroup.add(ceil);

      } else if (_isGable) {
        const _hW = room.width_m / 2;
        const _hL = room.length_m / 2;

        const verts = _gableAxis === "depth"
          ? new Float32Array([
            -_hW, _lowY, -_hL, // 0 FL
            _hW, _lowY, -_hL, // 1 FR
            _hW, _lowY, _hL, // 2 BR
            -_hW, _lowY, _hL, // 3 BL
            0, _highY, -_hL, // 4 F Ridge
            0, _highY, _hL  // 5 B Ridge
          ])
          : new Float32Array([
            -_hW, _lowY, -_hL, // 0 FL
            _hW, _lowY, -_hL, // 1 FR
            _hW, _lowY, _hL, // 2 BR
            -_hW, _lowY, _hL, // 3 BL
            -_hW, _highY, 0, // 4 L Ridge
            _hW, _highY, 0  // 5 R Ridge
          ]);

        const indices = _gableAxis === "depth"
          ? [0, 3, 5, 0, 5, 4, 1, 4, 5, 1, 5, 2]
          : [1, 5, 4, 1, 4, 0, 2, 5, 4, 2, 4, 3];

        const ceilGeo = new THREE.BufferGeometry();
        ceilGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
        ceilGeo.setIndex(indices);
        ceilGeo.computeVertexNormals();

        const ceil = new THREE.Mesh(ceilGeo, glowMat);
        roomGroup.add(ceil);

      } else {
        // Flat ceiling highlight
        const ceiling = new THREE.Mesh(
          new THREE.PlaneGeometry(room.width_m, room.length_m),
          glowMat
        );
        ceiling.rotation.x = -Math.PI / 2;
        ceiling.position.y = room.height_m / 2;
        roomGroup.add(ceiling);
      }
    }
  }

  /* ------------------------------------------
    WALL LABELS (R1 — Clarity over Realism)
    THREE.Sprite + CanvasTexture so labels always
    billboard toward the camera with no DOM overlay.
    Hidden when focusedOverlay is active (they clutter
    the focused view and the room shell is dimmed anyway).
  ------------------------------------------ */
  function _makeLabelSprite(text, color = '#9ca3af') {
    const W = 256, H = 56;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, W / 2, H / 2);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      opacity: 0.55,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    // Scale in world units: ~0.9 m wide, aspect-correct height
    sprite.scale.set(0.9, 0.9 * (H / W), 1);
    return sprite;
  }

  function renderWallLabels(room) {
    // Caller-controlled suppression — independent of mode/focus
    if (!_showLabels) return;
    // Only show labels in analysis mode — not during setup wizard
    if (currentMode === 'setup') return;
    // Skip when any overlay is focused — labels clutter the focused view
    if (focusedOverlay) return;

    const floorY = -room.height_m / 2;
    const hW = room.width_m / 2;
    const hL = room.length_m / 2;
    // Raise labels slightly above floor so they sit on the bottom edge
    const labelY = floorY + 0.35;
    // Pull slightly inside each wall so they don't z-fight the wireframe edge
    const inset = 0.12;

    const labels = [
      { text: 'Front', pos: [0, labelY, -hL + inset] },
      { text: 'Rear', pos: [0, labelY, hL - inset] },
      { text: 'L', pos: [-hW + inset, labelY, 0] },
      { text: 'R', pos: [hW - inset, labelY, 0] },
    ];

    labels.forEach(({ text, pos }) => {
      const sprite = _makeLabelSprite(text);
      sprite.position.set(...pos);
      roomGroup.add(sprite);
    });
  }

  /* ------------------------------------------
    ANALYSIS OVERLAYS (FINAL MODE)
  ------------------------------------------ */
  function renderAnalysisOverlays(room) {

    const offsetX = room.listener_offset_m || 0;
    const isFocused = (id) => focusedOverlay === id;

    // ---- CROWD ----
    if ((room.room_type === 'club' || overlayEnabled(OVERLAYS.CROWD)) && _crowdEnabled) try {
      // 1. Mesh setup
      const headGeo = new THREE.SphereGeometry(0.15, 10, 8);
      const bodyGeo = new THREE.CylinderGeometry(0.2, 0.25, 1.4, 8);
      bodyGeo.translate(0, 0.7, 0); // anchor at feet

      // Seeded PRNG (mulberry32), not Math.random() -- every UI change
      // calls room.update() (a full rebuild()), which was regenerating
      // every crowd position/jitter/phase from scratch each time, so the
      // whole crowd visibly reshuffled on any unrelated slider tweak
      // (booth position, PA toe-in, anything). Seeding on the inputs that
      // actually determine the crowd (floor size + crowd_limit) makes the
      // layout stable across everything else, while still changing
      // naturally when the floor or crowd size actually change.
      function _mulberry32(seed) {
        return function () {
          seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
          let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }
      const _crowdSeed = (Math.round((room.width_m || 0) * 100) ^ Math.round((room.length_m || 0) * 100) ^ (room.crowd_limit || 200)) | 0;
      const _rand = _mulberry32(_crowdSeed);

      // Candidate grid always generated at packed density (the max the
      // crowd-limit slider can reach, per its own area*4 cap) so there
      // are always enough candidates to satisfy any crowd_limit -- then
      // trimmed down below to the actual limit. room.density doesn't
      // exist any more (replaced by crowd_limit); referencing it here
      // left this whole block permanently reading the comfortable-only
      // branch and, more importantly, never actually capping to
      // crowd_limit at all -- the slider did nothing.
      const spacing = Math.sqrt(1 / 4); // packed, ~0.707m — trimmed to crowd_limit below

      const width = room.width_m || 4.0;
      const length = room.length_m || 5.0;
      // Start 0.5m back from speakers, end 0.5m from back wall
      const zStart = -length / 2 + (room.spk_front_m || 0.5) + 0.5;
      const zEnd = length / 2 - 0.5;
      // Leave 0.5m on sides
      const xStart = -width / 2 + 0.5;
      const xEnd = width / 2 - 0.5;

      const instances = [];

      // Lay out jittered grid, density biased toward front
      const zRange = zEnd - zStart;
      for (let z = zStart; z <= zEnd; z += spacing) {
        // Front density bias: chance to skip increases toward the back
        const depthFrac = (z - zStart) / zRange;
        for (let x = xStart; x <= xEnd; x += spacing) {
          if (_rand() < depthFrac * 0.5) continue; // up to 50% chance to skip at back wall

          instances.push({
            x: x + (_rand() - 0.5) * spacing * 0.4,
            z: z + (_rand() - 0.5) * spacing * 0.4,
            phase: _rand() * Math.PI * 2,
            hScale: 0.9 + _rand() * 0.25,
            yRot: (_rand() - 0.5) * 0.5, // slight random rotation
          });
        }
      }

      // Cap to crowd_limit -- deterministic shuffle-trim with the same
      // seeded RNG so *which* instances get dropped is also stable.
      if (room.crowd_limit && instances.length > room.crowd_limit) {
        for (let i = instances.length - 1; i > 0; i--) {
          const j = Math.floor(_rand() * (i + 1));
          [instances[i], instances[j]] = [instances[j], instances[i]];
        }
        instances.length = room.crowd_limit;
      }

      const count = instances.length;
      if (count === 0) return;
      
      // Update global footprint data for RT60 side
      if (typeof window !== 'undefined') {
        window.MeasurelyRoom3D = window.MeasurelyRoom3D || {};
        window.MeasurelyRoom3D.crowdFootprint = {
          count,
          bounds: { xStart, xEnd, zStart, zEnd },
          crowd_limit: room.crowd_limit
        };
      }

      const bodyMesh = new THREE.InstancedMesh(bodyGeo, new THREE.MeshBasicMaterial(), count);
      const headMesh = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial(), count);
      
      // Raycasting setup
      bodyMesh.userData.isCrowd = true;
      headMesh.userData.isCrowd = true;
      bodyMesh.userData.instances = instances;
      headMesh.userData.instances = instances;
      bodyMesh.userData.bpm = room.crowd_bpm || 126;
      bodyMesh.userData.floorY = -(room.height_m || 3.0) / 2;

      const floorY = -(room.height_m || 3.0) / 2;
      const dummy = new THREE.Object3D();
      
      const colTeal = new THREE.Color('#22d3c5');
      const colGold = new THREE.Color('#ffd166');
      const colPink = new THREE.Color('#ff2d78');
      
      let minDb = Infinity;
      let maxDb = -Infinity;
      const dbLevels = instances.map(inst => {
        const db = getLevelAtPosition(inst.x, floorY + 1.0, inst.z, room);
        if (db < minDb) minDb = db;
        if (db > maxDb) maxDb = db;
        return db;
      });

      const dbRange = Math.max(0.1, maxDb - minDb);

      for (let i = 0; i < count; i++) {
        const inst = instances[i];
        
        // Initial static placement (animation loop will update this)
        dummy.position.set(inst.x, floorY, inst.z);
        dummy.scale.set(1, inst.hScale, 1);
        dummy.rotation.y = inst.yRot;
        dummy.updateMatrix();
        
        bodyMesh.setMatrixAt(i, dummy.matrix);
        
        dummy.position.set(inst.x, floorY + 1.4 * inst.hScale + 0.15, inst.z);
        dummy.scale.setScalar(inst.hScale);
        dummy.updateMatrix();
        
        headMesh.setMatrixAt(i, dummy.matrix);

        // Colour mapping based on level
        const frac = (dbLevels[i] - minDb) / dbRange;
        const col = new THREE.Color();
        if (frac < 0.5) {
          col.lerpColors(colTeal, colGold, frac * 2);
        } else {
          col.lerpColors(colGold, colPink, (frac - 0.5) * 2);
        }
        bodyMesh.setColorAt(i, col);
        headMesh.setColorAt(i, col);
      }

      bodyMesh.instanceMatrix.needsUpdate = true;
      headMesh.instanceMatrix.needsUpdate = true;
      if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;
      if (headMesh.instanceColor) headMesh.instanceColor.needsUpdate = true;

      roomGroup.add(bodyMesh);
      roomGroup.add(headMesh);

    } catch (err) {
      console.error("[Room3D] Overlay 'crowd' failed to render", err);
    }

    // ---- CROWD ----
    if ((room.room_type === 'club' || overlayEnabled(OVERLAYS.CROWD)) && _crowdEnabled) try {
      // 1. Mesh setup
      const headGeo = new THREE.SphereGeometry(0.15, 10, 8);
      const bodyGeo = new THREE.CylinderGeometry(0.2, 0.25, 1.4, 8);
      bodyGeo.translate(0, 0.7, 0); // anchor at feet

      // Seeded PRNG (mulberry32), not Math.random() -- every UI change
      // calls room.update() (a full rebuild()), which was regenerating
      // every crowd position/jitter/phase from scratch each time, so the
      // whole crowd visibly reshuffled on any unrelated slider tweak
      // (booth position, PA toe-in, anything). Seeding on the inputs that
      // actually determine the crowd (floor size + crowd_limit) makes the
      // layout stable across everything else, while still changing
      // naturally when the floor or crowd size actually change.
      function _mulberry32(seed) {
        return function () {
          seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
          let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }
      const _crowdSeed = (Math.round((room.width_m || 0) * 100) ^ Math.round((room.length_m || 0) * 100) ^ (room.crowd_limit || 200)) | 0;
      const _rand = _mulberry32(_crowdSeed);

      // Candidate grid always generated at packed density (the max the
      // crowd-limit slider can reach, per its own area*4 cap) so there
      // are always enough candidates to satisfy any crowd_limit -- then
      // trimmed down below to the actual limit. room.density doesn't
      // exist any more (replaced by crowd_limit); referencing it here
      // left this whole block permanently reading the comfortable-only
      // branch and, more importantly, never actually capping to
      // crowd_limit at all -- the slider did nothing.
      const spacing = Math.sqrt(1 / 4); // packed, ~0.707m — trimmed to crowd_limit below

      const width = room.width_m || 4.0;
      const length = room.length_m || 5.0;
      // Start 0.5m back from speakers, end 0.5m from back wall
      const zStart = -length / 2 + (room.spk_front_m || 0.5) + 0.5;
      const zEnd = length / 2 - 0.5;
      // Leave 0.5m on sides
      const xStart = -width / 2 + 0.5;
      const xEnd = width / 2 - 0.5;

      const instances = [];

      // Lay out jittered grid, density biased toward front
      const zRange = zEnd - zStart;
      for (let z = zStart; z <= zEnd; z += spacing) {
        // Front density bias: chance to skip increases toward the back
        const depthFrac = (z - zStart) / zRange;
        for (let x = xStart; x <= xEnd; x += spacing) {
          if (_rand() < depthFrac * 0.5) continue; // up to 50% chance to skip at back wall

          instances.push({
            x: x + (_rand() - 0.5) * spacing * 0.4,
            z: z + (_rand() - 0.5) * spacing * 0.4,
            phase: _rand() * Math.PI * 2,
            hScale: 0.9 + _rand() * 0.25,
            yRot: (_rand() - 0.5) * 0.5, // slight random rotation
          });
        }
      }

      // Cap to crowd_limit -- deterministic shuffle-trim with the same
      // seeded RNG so *which* instances get dropped is also stable.
      if (room.crowd_limit && instances.length > room.crowd_limit) {
        for (let i = instances.length - 1; i > 0; i--) {
          const j = Math.floor(_rand() * (i + 1));
          [instances[i], instances[j]] = [instances[j], instances[i]];
        }
        instances.length = room.crowd_limit;
      }

      const count = instances.length;
      if (count === 0) return;
      
      // Update global footprint data for RT60 side
      if (typeof window !== 'undefined') {
        window.MeasurelyRoom3D = window.MeasurelyRoom3D || {};
        window.MeasurelyRoom3D.crowdFootprint = {
          count,
          bounds: { xStart, xEnd, zStart, zEnd },
          crowd_limit: room.crowd_limit
        };
      }

      const bodyMesh = new THREE.InstancedMesh(bodyGeo, new THREE.MeshBasicMaterial(), count);
      const headMesh = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial(), count);
      
      // Raycasting setup
      bodyMesh.userData.isCrowd = true;
      headMesh.userData.isCrowd = true;
      bodyMesh.userData.instances = instances;
      headMesh.userData.instances = instances;
      bodyMesh.userData.bpm = room.crowd_bpm || 126;
      bodyMesh.userData.floorY = -(room.height_m || 3.0) / 2;

      const floorY = -(room.height_m || 3.0) / 2;
      const dummy = new THREE.Object3D();
      
      const colTeal = new THREE.Color('#22d3c5');
      const colGold = new THREE.Color('#ffd166');
      const colPink = new THREE.Color('#ff2d78');
      
      let minDb = Infinity;
      let maxDb = -Infinity;
      const dbLevels = instances.map(inst => {
        const db = getLevelAtPosition(inst.x, floorY + 1.0, inst.z, room);
        if (db < minDb) minDb = db;
        if (db > maxDb) maxDb = db;
        return db;
      });

      const dbRange = Math.max(0.1, maxDb - minDb);

      for (let i = 0; i < count; i++) {
        const inst = instances[i];
        
        // Initial static placement (animation loop will update this)
        dummy.position.set(inst.x, floorY, inst.z);
        dummy.scale.set(1, inst.hScale, 1);
        dummy.rotation.y = inst.yRot;
        dummy.updateMatrix();
        
        bodyMesh.setMatrixAt(i, dummy.matrix);
        
        dummy.position.set(inst.x, floorY + 1.4 * inst.hScale + 0.15, inst.z);
        dummy.scale.setScalar(inst.hScale);
        dummy.updateMatrix();
        
        headMesh.setMatrixAt(i, dummy.matrix);

        // Colour mapping based on level
        const frac = (dbLevels[i] - minDb) / dbRange;
        const col = new THREE.Color();
        if (frac < 0.5) {
          col.lerpColors(colTeal, colGold, frac * 2);
        } else {
          col.lerpColors(colGold, colPink, (frac - 0.5) * 2);
        }
        bodyMesh.setColorAt(i, col);
        headMesh.setColorAt(i, col);
      }

      bodyMesh.instanceMatrix.needsUpdate = true;
      headMesh.instanceMatrix.needsUpdate = true;
      if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;
      if (headMesh.instanceColor) headMesh.instanceColor.needsUpdate = true;

      roomGroup.add(bodyMesh);
      roomGroup.add(headMesh);

    } catch (err) {
      console.error("[Room3D] Overlay 'crowd' failed to render", err);
    }

    // ---- CROWD ----
    if ((room.room_type === 'club' || overlayEnabled(OVERLAYS.CROWD)) && _crowdEnabled) try {
      // 1. Mesh setup
      const headGeo = new THREE.SphereGeometry(0.15, 10, 8);
      const bodyGeo = new THREE.CylinderGeometry(0.2, 0.25, 1.4, 8);
      bodyGeo.translate(0, 0.7, 0); // anchor at feet

      // Seeded PRNG (mulberry32), not Math.random() -- every UI change
      // calls room.update() (a full rebuild()), which was regenerating
      // every crowd position/jitter/phase from scratch each time, so the
      // whole crowd visibly reshuffled on any unrelated slider tweak
      // (booth position, PA toe-in, anything). Seeding on the inputs that
      // actually determine the crowd (floor size + crowd_limit) makes the
      // layout stable across everything else, while still changing
      // naturally when the floor or crowd size actually change.
      function _mulberry32(seed) {
        return function () {
          seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
          let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }
      const _crowdSeed = (Math.round((room.width_m || 0) * 100) ^ Math.round((room.length_m || 0) * 100) ^ (room.crowd_limit || 200)) | 0;
      const _rand = _mulberry32(_crowdSeed);

      // Candidate grid always generated at packed density (the max the
      // crowd-limit slider can reach, per its own area*4 cap) so there
      // are always enough candidates to satisfy any crowd_limit -- then
      // trimmed down below to the actual limit. room.density doesn't
      // exist any more (replaced by crowd_limit); referencing it here
      // left this whole block permanently reading the comfortable-only
      // branch and, more importantly, never actually capping to
      // crowd_limit at all -- the slider did nothing.
      const spacing = Math.sqrt(1 / 4); // packed, ~0.707m — trimmed to crowd_limit below

      const width = room.width_m || 4.0;
      const length = room.length_m || 5.0;
      // Start 0.5m back from speakers, end 0.5m from back wall
      const zStart = -length / 2 + (room.spk_front_m || 0.5) + 0.5;
      const zEnd = length / 2 - 0.5;
      // Leave 0.5m on sides
      const xStart = -width / 2 + 0.5;
      const xEnd = width / 2 - 0.5;

      const instances = [];

      // Lay out jittered grid, density biased toward front
      const zRange = zEnd - zStart;
      for (let z = zStart; z <= zEnd; z += spacing) {
        // Front density bias: chance to skip increases toward the back
        const depthFrac = (z - zStart) / zRange;
        for (let x = xStart; x <= xEnd; x += spacing) {
          if (_rand() < depthFrac * 0.5) continue; // up to 50% chance to skip at back wall

          instances.push({
            x: x + (_rand() - 0.5) * spacing * 0.4,
            z: z + (_rand() - 0.5) * spacing * 0.4,
            phase: _rand() * Math.PI * 2,
            hScale: 0.9 + _rand() * 0.25,
            yRot: (_rand() - 0.5) * 0.5, // slight random rotation
          });
        }
      }

      // Cap to crowd_limit -- deterministic shuffle-trim with the same
      // seeded RNG so *which* instances get dropped is also stable.
      if (room.crowd_limit && instances.length > room.crowd_limit) {
        for (let i = instances.length - 1; i > 0; i--) {
          const j = Math.floor(_rand() * (i + 1));
          [instances[i], instances[j]] = [instances[j], instances[i]];
        }
        instances.length = room.crowd_limit;
      }

      const count = instances.length;
      if (count === 0) return;
      
      // Update global footprint data for RT60 side
      if (typeof window !== 'undefined') {
        window.MeasurelyRoom3D = window.MeasurelyRoom3D || {};
        window.MeasurelyRoom3D.crowdFootprint = {
          count,
          bounds: { xStart, xEnd, zStart, zEnd },
          crowd_limit: room.crowd_limit
        };
      }

      const bodyMesh = new THREE.InstancedMesh(bodyGeo, new THREE.MeshBasicMaterial(), count);
      const headMesh = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial(), count);
      
      // Raycasting setup
      bodyMesh.userData.isCrowd = true;
      headMesh.userData.isCrowd = true;
      bodyMesh.userData.instances = instances;
      headMesh.userData.instances = instances;
      bodyMesh.userData.bpm = room.crowd_bpm || 126;
      bodyMesh.userData.floorY = -(room.height_m || 3.0) / 2;

      const floorY = -(room.height_m || 3.0) / 2;
      const dummy = new THREE.Object3D();
      
      const colTeal = new THREE.Color('#22d3c5');
      const colGold = new THREE.Color('#ffd166');
      const colPink = new THREE.Color('#ff2d78');
      
      let minDb = Infinity;
      let maxDb = -Infinity;
      const dbLevels = instances.map(inst => {
        const db = getLevelAtPosition(inst.x, floorY + 1.0, inst.z, room);
        if (db < minDb) minDb = db;
        if (db > maxDb) maxDb = db;
        return db;
      });

      const dbRange = Math.max(0.1, maxDb - minDb);

      for (let i = 0; i < count; i++) {
        const inst = instances[i];
        
        // Initial static placement (animation loop will update this)
        dummy.position.set(inst.x, floorY, inst.z);
        dummy.scale.set(1, inst.hScale, 1);
        dummy.rotation.y = inst.yRot;
        dummy.updateMatrix();
        
        bodyMesh.setMatrixAt(i, dummy.matrix);
        
        dummy.position.set(inst.x, floorY + 1.4 * inst.hScale + 0.15, inst.z);
        dummy.scale.setScalar(inst.hScale);
        dummy.updateMatrix();
        
        headMesh.setMatrixAt(i, dummy.matrix);

        // Colour mapping based on level
        const frac = (dbLevels[i] - minDb) / dbRange;
        const col = new THREE.Color();
        if (frac < 0.5) {
          col.lerpColors(colTeal, colGold, frac * 2);
        } else {
          col.lerpColors(colGold, colPink, (frac - 0.5) * 2);
        }
        bodyMesh.setColorAt(i, col);
        headMesh.setColorAt(i, col);
      }

      bodyMesh.instanceMatrix.needsUpdate = true;
      headMesh.instanceMatrix.needsUpdate = true;
      if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;
      if (headMesh.instanceColor) headMesh.instanceColor.needsUpdate = true;

      roomGroup.add(bodyMesh);
      roomGroup.add(headMesh);

    } catch (err) {
      console.error("[Room3D] Overlay 'crowd' failed to render", err);
    }

    // ---- FLOOR REFLECTION ----
    if (
      overlayEnabled(OVERLAYS.FLOOR_REFLECTION) &&
      room.floor_material === "hard"
    ) try {
      const floorOverlay = new THREE.Mesh(
        new THREE.PlaneGeometry(
          room.width_m * 0.9,
          room.length_m * 0.6
        ),
        new THREE.MeshBasicMaterial({
          color: OC.DIRECT_SIGNAL,
          transparent: true,
          opacity: 0.08,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      );

      floorOverlay.rotation.x = Math.PI / 2;
      floorOverlay.position.set(
        0,
        -room.height_m / 2 + 0.02,
        -room.length_m * 0.15
      );

      roomGroup.add(floorOverlay);

      // Actual speaker → floor → listener reflection paths (image-source method)
      const floorY = -room.height_m / 2 + 0.005;
      const _effTweeterY = room.room_type === 'club' ? (room.pa_mount_height_m || 3.0) : (room.tweeter_height_m || 0.95);
      const fTweeterY = -room.height_m / 2 + _effTweeterY;
      const _effEarY = room.room_type === 'club' ? 1.7 : 1.0;
      const fEarY = -room.height_m / 2 + _effEarY;
      const fListZ = -room.length_m / 2 + room.listener_front_m;

      for (const fSide of [-1, 1]) {
        const spkX = offsetX + fSide * room.spk_spacing_m / 2;
        const spkZ = -room.length_m / 2 + room.spk_front_m;
        // Mirror speaker across floor plane
        const mirrorY = -room.height_m - fTweeterY;
        // Find floor bounce point: parametric line from mirrorImage to listener
        const t = (floorY - mirrorY) / (fEarY - mirrorY);
        const bounceX = spkX + t * (offsetX - spkX);
        const bounceZ = spkZ + t * (fListZ - spkZ);
        drawReflectionPath(
          new THREE.Vector3(spkX, fTweeterY, spkZ),
          new THREE.Vector3(bounceX, floorY, bounceZ),
          new THREE.Vector3(offsetX, fEarY, fListZ),
          OC.DIRECT_SIGNAL
        );
      }
    } catch (err) {
      console.error("[Room3D] Overlay 'floor_reflection' failed to render", err);
    }

    // ---- SBIR ----
    if (overlayEnabled(OVERLAYS.SBIR)) try {

      const sbirDepth = Math.max(room.spk_front_m || 0.2, 0.2);
      const isFocSBIR = isFocused(OVERLAYS.SBIR);

      // Front wall panels and front/all bass traps are the primary SBIR fixes —
      // they still drive the wave-ring colour state, but no longer the score
      // (the +1.8 hardcoded bonus was a UI heuristic that lied; treatment
      // effects now emerge from the measurement itself via class B recession).
      const hasFrontPanels = room.wall_panel_mode === 'front' || room.wall_panel_mode === 'both';
      const hasBassTraps   = room.bass_trap_mode  === 'front' || room.bass_trap_mode  === 'all';
      const sbirTreated    = simulatePanels || hasFrontPanels || hasBassTraps;
      // Secondary contributions from other panels — reduce overall room energy slightly
      const _sbirBonus = simulatePanels ? 0 : Math.min(
        (room.wall_panel_mode === 'rear'  || room.wall_panel_mode === 'both' ? 0.10 : 0) +
        (room.bass_trap_mode  === 'rear'  || room.bass_trap_mode  === 'all'  ? 0.08 : 0) +
        (room.side_panel_mode !== 'none' ? 0.06 : 0), 0.22);
      const sbirAbsorption = Math.min(sbirTreated ? 0.75 : _sbirBonus, 0.80);

      // Drive wave ring color: cyan = treated, pink = untreated (lerped in render loop)
      const _sbirRingTarget = new THREE.Color(sbirTreated ? OC.TREATED_CYAN : OC.PRESSURE_PEAK);
      _waveRings.forEach(r => {
        if (r.userData.speakerSide === 'SUB') r.userData.targetColor = new THREE.Color(0xff2d78);
        else r.userData.targetColor = _sbirRingTarget;
      });

      // ── Measurement-aware classification ─────────────────────────────────
      // Predicted null lives at f = c / 4d. Real rooms shift it within ±15%
      // depending on damping, geometry detail, and treatment. Three classes:
      //   A — confirmed: measurement shows a significant null near predicted Hz
      //   B — predicted-not-confirmed: measurement loaded but no null detected
      //   C — pre-measurement: no measurement yet, predicted scaffolding only
      const predictedNullHz = 343 / (4 * sbirDepth);
      const hasMeasurement  = !!(_rewFreqs && _rewMags && _rewFreqs.length > 0);

      let measuredNullHz = null;
      let depthDb = null;
      let hasSignificantNull = false;

      if (hasMeasurement) {
        const winLo = predictedNullHz * 0.85;
        const winHi = predictedNullHz * 1.15;
        let minIdx = -1, minMag = Infinity;
        let sumMag = 0, count = 0;
        for (let i = 0; i < _rewFreqs.length; i++) {
          const f = _rewFreqs[i];
          if (f < winLo) continue;
          if (f > winHi) break;
          const m = _rewMags[i];
          if (!isFinite(m)) continue;
          sumMag += m;
          count++;
          if (m < minMag) { minMag = m; minIdx = i; }
        }
        if (count > 0 && minIdx >= 0) {
          const localMean = sumMag / count;
          const depth = minMag - localMean;     // negative = dip below local mean
          if (depth <= -3) {
            hasSignificantNull = true;
            measuredNullHz = _rewFreqs[minIdx];
            depthDb = depth;
          }
        }
      }

      const isClassA = hasMeasurement &&  hasSignificantNull;  // confirmed
      const isClassB = hasMeasurement && !hasSignificantNull;  // predicted, not measured
      const isClassC = !hasMeasurement;                        // pre-measurement

      // Shared geometry inputs for the boundary-null model below: the speaker
      // acoustic-centre height and the front wall Z.
      const tweeterY = -room.height_m / 2 + (room.tweeter_height_m || 0.95);
      const frontWallZ = -room.length_m / 2;

      // Wave number k = π/(2d) — first SBIR null at f0 = C/(4d). Still used by
      // the seat-notch depth evaluation below (the real path-difference comb).
      const sbirK = Math.PI / (2 * sbirDepth);

      // Two real speaker sources (XZ). Reuse the positions stashed during the
      // wave-ring build when available; otherwise the speaker-placement formula
      // (offsetX ± spk_spacing/2 at frontWallZ + d). Every boundary distance,
      // tripwire, and the seat probe derive from these.
      const _spkHalfSep = (room.spk_spacing_m || 0) / 2;
      const _spkSrcL = _wavesEnabled
        ? new THREE.Vector2(_spkLeftLocalPos.x,  _spkLeftLocalPos.z)
        : new THREE.Vector2(offsetX - _spkHalfSep, frontWallZ + sbirDepth);
      const _spkSrcR = _wavesEnabled
        ? new THREE.Vector2(_spkRightLocalPos.x, _spkRightLocalPos.z)
        : new THREE.Vector2(offsetX + _spkHalfSep, frontWallZ + sbirDepth);

      // ── Boundary-distance null model ─────────────────────────────────────
      // SBIR is a per-boundary-distance phenomenon: each speaker has a quarter-
      // wave null off each near boundary, f = c/(4·d). The real damage is when
      // two land at similar frequencies and STACK into a deep suckout. We draw a
      // thin glowing tripwire from each speaker to its near boundaries (front
      // wall, near side wall, floor), label each with its null Hz, and merge
      // collisions into one bright "deep null" warning. All geometry + labels
      // (no field shader), recomputed every rebuild so it slides live as
      // placement changes. Per the tenet: only these sound markers glow; the
      // room + speakers stay neutral wireframe.
      const C_SOUND = 343;
      const floorY  = -room.height_m / 2;
      const halfW   = room.width_m / 2;
      const IN_LO = 40, IN_HI = 200;            // danger band (Hz) — drop nulls outside it
      const STACK_RATIO = Math.pow(2, 1 / 6);   // merge nulls within ~1/6 octave
      const PINK = 0xFF107A, TEAL = 0x00C1B2;

      // Per-boundary treatment — treating a boundary HEALS (chokes) its stream.
      const _frontTreated = simulatePanels || hasFrontPanels || hasBassTraps;
      const _sideTreatedL = simulatePanels || room.side_panel_mode === 'left'  || room.side_panel_mode === 'both';
      const _sideTreatedR = simulatePanels || room.side_panel_mode === 'right' || room.side_panel_mode === 'both';
      const _floorTreated = room.floor_material === 'carpet' || (room.opt_area_rug ?? false);

      // Build the energy-stream / vortex / flare DEFINITIONS from the honest
      // per-boundary null model (c/4d). Meshes + the particle swarm are created
      // by _buildSbirStreams below; this stays pure data so the physics reads
      // clearly. throbW maps a null frequency → a visible breathing rate.
      const sbirStreamDefs = [];   // { a, b, treated, color, suck:Vector3|null, throbW }
      const sbirVortexDefs = [];   // { center, severity, color, throbW, seat }
      const sbirFlareDefs  = [];   // { pos, treated, throbW }
      const _throbOf = (f) => f / 40;   // Hz → ~2–4 s visual cycle (same mapping as Bass Modes)

      const _speakers = [
        { x: _spkSrcL.x, z: _spkSrcL.y, sideWallX: -halfW, sideTreated: _sideTreatedL },
        { x: _spkSrcR.x, z: _spkSrcR.y, sideWallX:  halfW, sideTreated: _sideTreatedR },
      ];
      const _seatNulls = [];   // in-band nulls (both speakers) → dominant-dip pick for the seat

      _speakers.forEach((s) => {
        const a = new THREE.Vector3(s.x, tweeterY, s.z);
        const dFront = Math.max(s.z - frontWallZ, 0.05);
        const dFloor = Math.max(tweeterY - floorY, 0.05);
        const dSide  = Math.max(Math.abs(s.x - s.sideWallX), 0.05);
        const nulls = [
          { d: dFront, end: new THREE.Vector3(s.x, tweeterY, frontWallZ),  treated: _frontTreated },
          { d: dFloor, end: new THREE.Vector3(s.x, floorY, s.z),           treated: _floorTreated },
          { d: dSide,  end: new THREE.Vector3(s.sideWallX, tweeterY, s.z),  treated: s.sideTreated },
        ].map(n => Object.assign(n, { f: C_SOUND / (4 * n.d) }))
         .filter(n => n.f >= IN_LO && n.f <= IN_HI);   // in-band only

        // Treated nulls — calm teal streams, NO suckout: the reflection is
        // absorbed, so energy flows smoothly through and the hole heals. A dim
        // teal flare still marks the boundary.
        nulls.filter(n => n.treated).forEach((n) => {
          sbirStreamDefs.push({ a: a.clone(), b: n.end.clone(), treated: true, color: TEAL, suck: null, throbW: _throbOf(n.f) });
          sbirFlareDefs.push({ pos: n.end.clone(), treated: true, throbW: _throbOf(n.f) });
        });

        // Untreated nulls — cluster by ~1/6 octave; coincident nulls STACK into
        // one more-violent suckout (the catastrophe). Each member feeds the
        // cluster's vortex (at the speaker, where the round trip cancels) with a
        // pink stream + a reinforcement flare at its wall.
        const active = nulls.filter(n => !n.treated).sort((p, q) => p.f - q.f);
        const clusters = [];
        active.forEach(n => {
          const last = clusters[clusters.length - 1];
          if (last && (n.f / last.members[last.members.length - 1].f) < STACK_RATIO) last.members.push(n);
          else clusters.push({ members: [n] });
        });

        clusters.forEach((cl) => {
          const fRef = cl.members.reduce((acc, m) => acc + m.f, 0) / cl.members.length;
          const severity = Math.min(1, (cl.members.length - 1) / 2 + 0.45);   // 1→0.45, 2→0.95, 3→1.0
          const suck = a.clone();   // the suckout sits at the speaker
          sbirVortexDefs.push({ center: suck.clone(), severity, color: PINK, throbW: _throbOf(fRef), seat: false });
          cl.members.forEach((n) => {
            sbirStreamDefs.push({ a: a.clone(), b: n.end.clone(), treated: false, color: PINK, suck: suck.clone(), throbW: _throbOf(n.f) });
            sbirFlareDefs.push({ pos: n.end.clone(), treated: false, throbW: _throbOf(n.f) });
          });
          _seatNulls.push({ f: fRef, members: cl.members.length });
        });
      });

      // ── Seat notch readout — the frequency-response dip at the seat ──────
      // Resolve to the listener: the dominant null (a stack if one exists, else
      // the lowest in-band boundary null) and its depth AT THE SEAT. Depth is the
      // measured dip (Class A) or a CPU evaluation of the real four-source path-
      // difference comb at the seat (more accurate than c/4d), deepened when the
      // dominant null is a stack. A halo tints by depth: deep = hot pink, shallow
      // = faint/teal. Rebuilt every cycle → slides live with placement.
      let _dom = null;
      for (const n of _seatNulls) {
        if (!_dom || n.members > _dom.members || (n.members === _dom.members && n.f < _dom.f)) _dom = n;
      }
      const dominantNullHz = _dom ? Math.round(_dom.f) : Math.round(predictedNullHz);
      {
        const _isStudioS = room.room_type === 'studio';
        const _seatS = room.seating_type || 'sofa';
        const _seatZoff = _isStudioS ? 0.20 : (_seatS === 'lounge' ? 0.38 : 0.28);
        const lx = offsetX + (room.listener_offset_m || 0);   // matches the listener station's X
        const lz = -room.length_m / 2 + (room.listener_front_m || 2.8) + _seatZoff;

        // Depth at the seat — real path-difference comb (the four sources: each
        // speaker direct + its front-wall image), more accurate than c/4d.
        const _refl = 1.0 - sbirAbsorption;
        const mirLz = 2 * frontWallZ - _spkSrcL.y;
        const mirRz = 2 * frontWallZ - _spkSrcR.y;
        const _src = [
          [_spkSrcL.x, _spkSrcL.y, 1.0], [_spkSrcL.x, mirLz, _refl],
          [_spkSrcR.x, _spkSrcR.y, 1.0], [_spkSrcR.x, mirRz, _refl],
        ];
        let _re = 0, _im = 0;
        for (const [sx, sz, amp] of _src) {
          const d = Math.hypot(lx - sx, lz - sz) * sbirK;
          _re += amp * Math.cos(d); _im += amp * Math.sin(d);
        }
        const seatAmp = Math.hypot(_re, _im) * 0.25;
        const ceiling = (1.0 + _refl) / 2;
        const predictedDip = Math.max(0, Math.min(1, 1 - seatAmp / Math.max(ceiling, 1e-3))) * _refl;
        // A stacked dominant null reads as a worse seat dip.
        const stackBoost = (_dom && _dom.members >= 2) ? Math.min(1.0, 0.55 + 0.22 * _dom.members) : 1.0;
        const seatDip = isClassA
          ? Math.max(0, Math.min(1, (-depthDb) / 18))
          : Math.min(1, predictedDip + (1 - predictedDip) * (stackBoost - 1) + (stackBoost > 1 ? 0.15 : 0));

        // Seat suckout — if the seat sits in a cancellation, a vortex throbs
        // here (the "your bass dies here" payoff). Built as a vortex def below;
        // its rim tints hot pink with depth.
        if (seatDip > 0.22) {
          sbirVortexDefs.push({
            center: new THREE.Vector3(lx, tweeterY, lz),
            severity: seatDip, color: PINK, throbW: _throbOf(dominantNullHz), seat: true,
          });
        }

        // Small readout riding the seat. On-brand pink family / neutral — never
        // amber/orange/red. Reads live as the dominant dip frequency slides.
        if (_showLabels) {
          let txt, col;
          if (isClassA) {
            const depthStr = `${depthDb >= 0 ? '+' : ''}${depthDb.toFixed(0)} dB`;
            txt = `Seat dip · ${Math.round(measuredNullHz)} Hz · ${depthStr}`;
            col = seatDip >= 0.55 ? '#FF107A' : seatDip >= 0.3 ? '#f9a8d4' : '#cbd5e1';
          } else {
            txt = `Seat dip · ~${dominantNullHz} Hz · predicted`;
            col = seatDip >= 0.55 ? '#f9a8d4' : '#94a3b8';
          }
          const lbl = _makeLabelSprite(txt, col);
          lbl.position.set(lx, tweeterY + 0.45, lz);
          roomGroup.add(lbl);
        }
      }

      // Create the meshes + particle swarm from the accumulated defs.
      _buildSbirStreams(sbirStreamDefs, sbirVortexDefs, sbirFlareDefs, _sbirTierConfig());

      // ------------------------------------------
      // SBIR CORNER BASS TRAPS (simulatePanels preview only)
      // Only shown when simulatePanels is active — the main room renderer already draws
      // real trap geometry when bass_trap_mode !== 'none', so these would double up.
      // Front corners (speaker wall, z = -length/2) are the SBIR-relevant corners.
      //
      // Class gate: outside focused mode, only render when Class A AND the
      // measured null is meaningful (≤ -8 dB). Class B (no measured null)
      // and Class C (pre-measurement) suppress the preview — no problem
      // identified, so don't suggest a fix. Focused mode renders for all
      // classes since the user explicitly asked to see treatment options.
      // ------------------------------------------
      const trapMeaningful = isClassA && depthDb <= -8;
      if (simulatePanels && (trapMeaningful || isFocSBIR)) {
        const trapSize   = 0.35;
        const trapHeight = room.height_m * 0.9;

        const trapMaterial = new THREE.MeshBasicMaterial({
          color: OC.DIRECT_SIGNAL,
          transparent: true,
          opacity: 0.30,
          depthWrite: false,
          side: THREE.DoubleSide
        });

        const halfW        = room.width_m  / 2;
        const frontCornerZ = -room.length_m / 2; // speaker wall — the SBIR reflection source

        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.lineTo(trapSize, 0);
        shape.lineTo(0, trapSize);
        shape.lineTo(0, 0);

        const geometry = new THREE.ExtrudeGeometry(shape, {
          depth: trapHeight,
          bevelEnabled: false
        });
        geometry.rotateX(-Math.PI / 2);

        // Front two corners only — these address the speaker-wall reflection
        const sbirCorners = [
          { cx: -halfW, cz: frontCornerZ, rotY:  0           }, // front-left
          { cx:  halfW, cz: frontCornerZ, rotY: -Math.PI / 2 }, // front-right
        ];

        sbirCorners.forEach(({ cx, cz, rotY }) => {
          const trap = new THREE.Mesh(geometry.clone(), trapMaterial);
          trap.position.set(cx, -room.height_m / 2, cz);
          trap.rotation.y = rotY;
          roomGroup.add(trap);
        });
      }

      // Pre-measurement nudge — single Class-C badge (matches the Bass Modes
      // pre-measurement pattern). The dip frequency + depth now live in the seat
      // probe above; the old wall-midpoint Hz labels were redundant with it and
      // have been removed. Suppressed in focused mode and when labels are off.
      if (_showLabels && currentMode !== 'setup' && !focusedOverlay && isClassC) {
        const badge = _makeLabelSprite('Predicted only — upload a measurement to confirm', '#6b7280');
        badge.position.set(0, -room.height_m / 2 + room.height_m * 0.85, 0);
        roomGroup.add(badge);
      }

    } catch (err) {
      console.error("[Room3D] Overlay 'sbir' failed to render", err);
    }

    // ---- REFLECTIONS ----
    // Behavioural simulation: speakers fire pulses → walls flash on impact
    // (intensity = treatment-driven reflection strength) → return pulses
    // travel to listener → listener halo lights up. Cycle repeats.
    //
    // The score still comes from the actual measurement (scoreRef etc.).
    // This visual teaches HOW the room behaves and how treatment helps.
    // First-order bounce geometry comes from MeasurelyImageSource; the
    // existing wave-field shader plane stays as the measured-energy
    // evidence layer underneath the simulation.
    if (overlayEnabled(OVERLAYS.SIDE_REFLECTIONS)) try {

      const isFocSide = focusedOverlay === OVERLAYS.SIDE_REFLECTIONS;

      // ── Per-surface treated state ───────────────────────────────────────
      // Binary treated/untreated per surface; the band-ball cluster (built
      // below) turns this into a per-band reflection magnitude r = √(1−α) via
      // reflectionMagnitude(). The simulation toggle force-treats every surface
      // so the user can preview treatment.
      const sideMode = room.side_panel_mode    || 'none';
      const wallMode = room.wall_panel_mode    || 'none';
      const ceilMode = room.ceiling_panel_mode || room.ceiling_mode || 'none';
      const floorMat = room.floor_material     || 'hard';

      // Floor treatment = whole-floor carpet OR a discrete area rug between
      // speakers and listener (the rug mesh sits across the first-order
      // bounce point in typical configurations).
      const surfaceTreated = simulatePanels
        ? { floor: true, ceiling: true, left: true, right: true, front: true, back: true }
        : {
            floor:   floorMat === 'carpet' || (room.opt_area_rug ?? false),
            ceiling: ceilMode !== 'none',
            left:    sideMode === 'left'  || sideMode === 'both' || room.side_wall_mode === 'left' || room.side_wall_mode === 'both',
            right:   sideMode === 'right' || sideMode === 'both' || room.side_wall_mode === 'right' || room.side_wall_mode === 'both',
            front:   wallMode === 'front' || wallMode === 'both' || (room.front_wall_mode && room.front_wall_mode !== 'none'),
            back:    wallMode === 'rear'  || wallMode === 'both' || (room.rear_wall_mode && room.rear_wall_mode !== 'none'),
          };

      // ── Measurement context ─────────────────────────────────────────────
      const hasMeasurement = !!_measurement;
      const _sideRefEnergy = _rewBandEnergy(2000, 8000, -20);
      const _sideRefScale  = Math.max(0.25, Math.min(1.0, (_sideRefEnergy + 60) / 54));
      // Pre-measurement: simulation runs at 0.7× opacity to read as scaffolding.
      const SIM_SCALE = hasMeasurement ? 1.0 : 0.7;

      const halfW = room.width_m  / 2;
      const halfL = room.length_m / 2;
      const halfH = room.height_m / 2;
      const _effTweeterY = room.room_type === 'club' ? (room.pa_mount_height_m || 3.0) : (room.tweeter_height_m || 0.95);
        const tweeterY = -halfH + _effTweeterY;

      // Aim halo, bounce paths, and return-pulse targets at the visible
      // head sphere (which the station builder shifts back into the seat
      // cushion via _sphereZ). Keeps the simulation co-located with the
      // listener mesh and uses the geometrically-correct ear point.
      // Math is duplicated from the station builder (~line 1941) — flagged
      // for future consolidation via a shared _headWorldPosition helper.
      // isStudio + effectiveHeadHeight are recomputed here because the
      // rebuild()-scoped versions (lines 739, 1642) are not visible inside
      // renderAnalysisOverlays(); same expressions, different scope.
      const _isStudio = room.room_type === 'studio';
      const _effectiveHeadHeight = _isStudio ? 1.22 : 0.82;
      const _seatType = room.seating_type || 'sofa';
      const _sphereZ  = room.room_type === 'club' ? 0 : (_isStudio ? 0.20 : (_seatType === 'lounge' ? 0.38 : 0.28));
      const _sphereY  = room.room_type === 'club' ? 1.7 : (_isStudio ? _effectiveHeadHeight : (_seatType === 'lounge' ? 1.00 : 0.96));
      const listenerPos = new THREE.Vector3(
        offsetX + (room.listener_offset_m || 0),
        -halfH + _sphereY,
        -halfL + room.listener_front_m + _sphereZ
      );
      const speakerPositions = [
        new THREE.Vector3(offsetX - room.spk_spacing_m / 2, tweeterY, -halfL + room.spk_front_m),
        new THREE.Vector3(offsetX + room.spk_spacing_m / 2, tweeterY, -halfL + room.spk_front_m),
      ];

      // ── Image-source first-order bounces (per speaker × per surface) ─────
      const IS = window.MeasurelyImageSource;
      if (!IS) throw new Error('MeasurelyImageSource not loaded — check script order.');
      // Ceiling geometry travels with the dims so the image-source method
      // reflects ceiling bounces across the REAL roofline (slanted / gable
      // facets), not a flat plane at room height. Fields mirror rebuild()'s
      // ceilingYAt() inputs; imageSource ignores the sloped fields for a
      // flat ceiling.
      const roomDims = {
        w: room.width_m, l: room.length_m, h: room.height_m,
        ceilingType: room.ceiling_type || 'flat',
        ceilingLowH: Math.min(
          room.ceiling_height_secondary_m != null ? room.ceiling_height_secondary_m : room.height_m,
          room.height_m
        ),
        slantDir: room.ceiling_slant_direction || 'left_to_right',
        gableAxis: room.ceiling_gable_axis || 'depth',
      };
      const allBounces = [];
      speakerPositions.forEach((s, idx) => {
        const bounces = IS.firstOrderBounces(
          { x: s.x, y: s.y, z: s.z },
          { x: listenerPos.x, y: listenerPos.y, z: listenerPos.z },
          roomDims
        );
        for (const b of bounces) {
          allBounces.push({ speakerIdx: idx, ...b });
        }
      });

      // ── Existing wave-field shader plane (measured-energy evidence) ─────
      // Survives from the prior migration as the "pink bloom" layer beneath
      // the simulation. Opacity follows measurement: full _sideRefScale when
      // confirmed, 0.55 fallback pre-measurement.
      const sideGap = (room.width_m - room.spk_spacing_m) / 2;
      const sideK   = Math.PI / Math.max(sideGap, 0.3);
      const _sideRM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const fieldScale = hasMeasurement ? _sideRefScale : 0.55;
      const absL = surfaceTreated.left  ? 0.75 : 0.10;
      const absR = surfaceTreated.right ? 0.75 : 0.10;

      const sideMat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uK: { value: sideK },
          uSpkC: { value: new THREE.Vector2(offsetX, -halfL + room.spk_front_m) },
          uMirL: { value: new THREE.Vector2(-room.width_m - offsetX, -halfL + room.spk_front_m) },
          uMirR: { value: new THREE.Vector2(room.width_m - offsetX, -halfL + room.spk_front_m) },
          uRoomW: { value: room.width_m },
          uRoomL: { value: room.length_m },
          uOpacity: { value: (isFocSide ? 0.78 : 0.38) * fieldScale },
          uReflL:   { value: (1.0 - absL) * fieldScale },
          uReflR:   { value: (1.0 - absR) * fieldScale },
          uReducedMotion: { value: _sideRM ? 1.0 : 0.0 },
        },
        vertexShader: `
          uniform float uRoomW;
          uniform float uRoomL;
          varying vec2 vXZ;
          void main() {
            vXZ = vec2(
              (uv.x - 0.5) * uRoomW,
              (0.5 - uv.y) * uRoomL
            );
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uK;
          uniform vec2  uSpkC;
          uniform vec2  uMirL;
          uniform vec2  uMirR;
          uniform float uOpacity;
          uniform float uReflL;
          uniform float uReflR;
          uniform float uReducedMotion;
          varying vec2  vXZ;

          void main() {
            float t = uTime * (1.0 - uReducedMotion);
            float direct = sin(distance(vXZ, uSpkC) * uK - t);
            float reflL  = uReflL * sin(distance(vXZ, uMirL) * uK - t);
            float reflR  = uReflR * sin(distance(vXZ, uMirR) * uK - t);
            float absField = abs((direct + reflL + reflR) * 0.33);

            float fresnelBand = smoothstep(0.40, 0.75, absField);
            vec3 greyBase   = vec3(0.30 + absField * 0.45);
            vec3 neonPink   = vec3(1.0, 0.063, 0.478);
            vec3 finalColor = mix(greyBase, neonPink, fresnelBand);

            float opacity = clamp(absField * uOpacity * 2.2 + 0.06, 0.0, 0.88);
            gl_FragColor = vec4(finalColor, opacity);
          }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const sideField = new THREE.Mesh(
        new THREE.PlaneGeometry(room.width_m, room.length_m, 1, 1),
        sideMat
      );
      sideField.rotation.x = -Math.PI / 2;
      sideField.position.set(0, -halfH + 1.6, 0);
      sideField.userData.isSideRefField = true;
      roomGroup.add(sideField);

      // ── Frequency bands + per-surface reflection magnitude ───────────────
      // The pulse cluster carries N bands; each return ball's brightness is the
      // surface's reflection magnitude r = √(1−α) at that band. reflectionMagnitude()
      // is the SINGLE seam to later swap for the materials DB alphaAt(material, f).
      const _reflReduced  = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const _reflLowPower = _reflReduced
        || window.matchMedia('(pointer: coarse)').matches
        || window.matchMedia('(max-width: 900px)').matches;
      const REFL_BANDS = _reflReduced  ? REFL_BAND_SETS[2]
                       : _reflLowPower ? REFL_BAND_SETS[3]
                       :                 REFL_BAND_SETS[4];
      const _treatedAlphaAt = (f) => {
        const pts = REFL_TREATED_ALPHA;
        if (f <= pts[0][0]) return pts[0][1];
        if (f >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
        for (let k = 0; k < pts.length - 1; k++) {
          const fa = pts[k][0], aa = pts[k][1], fb = pts[k + 1][0], ab = pts[k + 1][1];
          if (f >= fa && f < fb) {
            const t = (Math.log2(f) - Math.log2(fa)) / (Math.log2(fb) - Math.log2(fa));
            return aa + (ab - aa) * t;
          }
        }
        return pts[pts.length - 1][1];
      };
      // Single seam: reads the existing binary treated flag + the local α table.
      const reflectionMagnitude = (surfaceKey, bandFreq) => {
        const treated = surfaceTreated[surfaceKey] === true;
        const alpha = treated ? _treatedAlphaAt(bandFreq) : REFL_UNTREATED_ALPHA;
        return Math.sqrt(Math.max(0, 1 - alpha));
      };
      // Per-surface mean r across the active bands — drives the wall flash and
      // listener halo (aggregate remaining energy), so treatment dims them
      // rather than switching them fully off.
      const surfaceMeanR = {};
      for (const _sk of ['floor', 'ceiling', 'left', 'right', 'front', 'back']) {
        let _s = 0;
        for (const _f of REFL_BANDS) _s += reflectionMagnitude(_sk, _f);
        surfaceMeanR[_sk] = _s / REFL_BANDS.length;
      }

      // ── Cycle scheduling ─────────────────────────────────────────────────
      // Pulses travel at the SAME on-screen speed as the Sound Waves rings:
      // V_VIS = ringMaxR / WAVE_CYCLE_S (the rings' own speed, ~1.5 m/s — NOT
      // 343 m/s, which would desync from the intentionally-slowed rings).
      // Every segment's duration is its real geometric length / V_VIS, so a
      // far speaker→wall→listener path visibly arrives LATER than a near one,
      // both moving at the same speed. All bounces leave the speaker at the
      // same cycle origin (outStart = 0); lateness comes purely from path
      // length, not a cosmetic stagger.
      const _ringMaxR = Math.max(room.length_m, room.width_m) * WAVE_EXTENT_FACTOR;
      const V_VIS     = _ringMaxR / WAVE_CYCLE_S;   // m/s, shared with the rings
      const FLASH_DUR = 0.30;        // wall-glow visual duration (not propagation)
      const TAIL_S    = 0.25;        // listener-halo fade tail beyond final hit
      const GAP_S     = 1.0;         // rest before the sequence repeats

      const flashEventsBySurface = {
        floor: [], ceiling: [], left: [], right: [], front: [], back: [],
      };
      const haloEvents = [];
      let _maxSeqEnd = 0;            // longest active path end → drives loop period
      allBounces.forEach((b) => {
        const _spk = speakerPositions[b.speakerIdx];
        const _bp  = b.bouncePoint;
        // Segment lengths straight from the per-speaker image-source geometry.
        const _outLen = Math.hypot(_spk.x - _bp.x, _spk.y - _bp.y, _spk.z - _bp.z);
        const _retLen = Math.hypot(_bp.x - listenerPos.x, _bp.y - listenerPos.y, _bp.z - listenerPos.z);
        const outDur    = _outLen / V_VIS;
        const returnDur = _retLen / V_VIS;

        // The return leg launches the instant the outgoing leg reaches the
        // wall (returnStart = outEnd), with the wall flash firing concurrently.
        // Total speaker→wall→listener time = outDur + returnDur ∝ path length.
        b.outStart    = 0;
        b.outEnd      = b.outStart + outDur;
        b.flashStart  = b.outEnd;
        b.flashEnd    = b.flashStart + FLASH_DUR;
        b.returnStart = b.outEnd;
        b.returnEnd   = b.returnStart + returnDur;
        // Energy reaching the wall / listener = the surface's mean reflection
        // magnitude across bands. The wall flash and listener halo scale with
        // this, so a treated surface DIMS them rather than switching them fully
        // off — a bass-heavy return still registers. (The per-band return
        // cluster, built below, carries the full r(band) detail.)
        const _bMeanR = surfaceMeanR[b.surface] * SIM_SCALE;
        const isTreated = surfaceTreated[b.surface] === true;
        const _flashStrength = isTreated ? SIM_SCALE : _bMeanR;
        flashEventsBySurface[b.surface].push({
          start: b.flashStart, duration: FLASH_DUR, strength: _flashStrength,
        });
        // Shared surface-impact: fire impactAt() once per cycle as the pulse
        // reaches this wall (cycle-crossing detected in animate). Energy is the
        // surface's mean reflection magnitude r̄ = mean √(1−α) across the active
        // bands — i.e. how much actually reflects — so the splash brightness and
        // heat deposit track the per-band r(f). Treated surfaces have a low r̄
        // (and impactAt scales treated deposits down further) so they stay cool.
        _reflImpactEvents.push({
          surface:    b.surface,
          point:      { x: b.bouncePoint.x, y: b.bouncePoint.y, z: b.bouncePoint.z },
          energy:     surfaceMeanR[b.surface],
          flashStart: b.flashStart,
        });
        // Cycle length covers every bounce's return window — including treated
        // bounces (whose pink is killed) — so the teal companions and any live
        // pink returns all finish before the loop restarts.
        if (b.returnEnd > _maxSeqEnd) _maxSeqEnd = b.returnEnd;
        // Clean kill: a treated surface returns no pink, so the seat gets no
        // halo pulse from that bounce either.
        if (surfaceTreated[b.surface] !== true) {
          haloEvents.push({ hitTime: b.returnEnd, strength: _bMeanR });
        }
      });

      // Loop period covers the LONGEST active path plus the halo tail and a
      // rest gap, so far/back-wall bounces complete before the cycle restarts.
      // animate()'s pulse loop wraps performance.now() at this period.
      _reflCyclePeriod = (allBounces.length > 0 ? _maxSeqEnd : 6.0) + TAIL_S + GAP_S;

      // ── Wall flash planes (one per surface that has any events) ──────────
      // Additive blending so a flash reads as glow rather than solid colour.
      // Phase 1 panel-aware flash: the wall is always pink; treatment
      // panels carry their own additive cyan overlay (added in the panel
      // builders, wired to per-surface events below). Where panels cover
      // the wall, cyan dominates additively; bare wall reads pink.
      //
      // Vertical walls (front/back/left/right) use a per-wall BufferGeometry
      // built in world space whose top edge follows ceilingYAt(corner_x,
      // corner_z), so the flash never pokes through a slanted or gabled
      // roof. Gable-end walls get a 5-vertex pentagon with the apex at the
      // wall midpoint. Floor and ceiling stay as flat PlaneGeometry — floor
      // is flat by definition; the ceiling overlay is out of scope here.
      const _refIsSlanted = room.ceiling_type === 'slanted';
      const _refIsGable   = room.ceiling_type === 'gable';
      const _refHasSloped = _refIsSlanted || _refIsGable;
      const _refSlantDir  = room.ceiling_slant_direction || 'left_to_right';
      const _refGableAxis = room.ceiling_gable_axis || 'depth';
      const _refFloorY    = -halfH;
      const _refHighY     =  halfH;
      const _refLowY      = _refHasSloped
        ? _refFloorY + Math.min(room.ceiling_height_secondary_m ?? room.height_m, room.height_m)
        : _refHighY;
      // Mirrors rebuild()'s ceilingYAt(x, z) — kept local because the
      // rebuild()-scoped helper is not in closure here.
      const _refCeilYAt = (x, z) => {
        if (!_refHasSloped) return _refHighY;
        if (_refIsSlanted) {
          let t;
          switch (_refSlantDir) {
            case 'left_to_right': t = (x + halfW) / room.width_m; break;
            case 'right_to_left': t = 1 - (x + halfW) / room.width_m; break;
            case 'front_to_back': t = 1 - (z + halfL) / room.length_m; break;
            case 'back_to_front': t = (z + halfL) / room.length_m; break;
            default:              t = (x + halfW) / room.width_m;
          }
          return _refLowY + t * (_refHighY - _refLowY);
        }
        // gable
        const distRatio = _refGableAxis === 'depth'
          ? Math.abs(x) / halfW
          : Math.abs(z) / halfL;
        return _refHighY - distRatio * (_refHighY - _refLowY);
      };
      // 4% inset on every edge — collapses to the original
      // PlaneGeometry(w*0.92, h*0.92) on flat ceilings, and pulls the
      // top edge down by 0.04*H on sloped/gabled walls so the flash
      // never z-fights with the cage beams along the eave/ridge line.
      const _refInsetFrac = 0.04;
      const _refInsetH    = room.height_m * _refInsetFrac;
      const _buildVerticalFlashGeom = (surf) => {
        const bottomY = _refFloorY + _refInsetH;
        let xMin, xMax, zMin, zMax;
        let isGableEnd = false;
        if (surf === 'front') {
          xMin = -halfW + room.width_m * _refInsetFrac;
          xMax =  halfW - room.width_m * _refInsetFrac;
          zMin = zMax = -halfL + 0.02;
          isGableEnd = _refIsGable && _refGableAxis === 'depth';
        } else if (surf === 'back') {
          xMin = -halfW + room.width_m * _refInsetFrac;
          xMax =  halfW - room.width_m * _refInsetFrac;
          zMin = zMax =  halfL - 0.02;
          isGableEnd = _refIsGable && _refGableAxis === 'depth';
        } else if (surf === 'left') {
          xMin = xMax = -halfW + 0.02;
          zMin = -halfL + room.length_m * _refInsetFrac;
          zMax =  halfL - room.length_m * _refInsetFrac;
          isGableEnd = _refIsGable && _refGableAxis !== 'depth';
        } else { // right
          xMin = xMax =  halfW - 0.02;
          zMin = -halfL + room.length_m * _refInsetFrac;
          zMax =  halfL - room.length_m * _refInsetFrac;
          isGableEnd = _refIsGable && _refGableAxis !== 'depth';
        }
        const topYLeft  = _refCeilYAt(xMin, zMin) - _refInsetH;
        const topYRight = _refCeilYAt(xMax, zMax) - _refInsetH;
        const positions = [];
        const indices   = [];
        if (isGableEnd) {
          // Pentagon: apex sits on the gable axis of symmetry (x=0 or z=0).
          const midX = (surf === 'front' || surf === 'back') ? 0 : xMin;
          const midZ = (surf === 'left'  || surf === 'right') ? 0 : zMin;
          const apexY = _refCeilYAt(midX, midZ) - _refInsetH;
          positions.push(
            xMin, bottomY,   zMin,  // 0 BL
            xMax, bottomY,   zMax,  // 1 BR
            xMax, topYRight, zMax,  // 2 eave-R
            midX, apexY,     midZ,  // 3 apex
            xMin, topYLeft,  zMin,  // 4 eave-L
          );
          indices.push(0, 1, 2,  0, 2, 3,  0, 3, 4);
        } else {
          positions.push(
            xMin, bottomY,   zMin,  // 0 BL
            xMax, bottomY,   zMax,  // 1 BR
            xMax, topYRight, zMax,  // 2 TR
            xMin, topYLeft,  zMin,  // 3 TL
          );
          indices.push(0, 1, 2,  0, 2, 3);
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geom.setIndex(indices);
        return geom;
      };
      // ── Ceiling reflection flash builder ────────────────────────────────
      // Sibling to _buildVerticalFlashGeom: the ceiling has its own
      // topology (4-vertex quad for flat/slanted, 6-vertex tent for gabled
      // with the ridge as a shared edge between the two pitched faces),
      // unrelated to the walls' quad/pentagon outlines. Returns world-space
      // geometry; the outer loop skips pos/rot for entries flagged
      // meta.custom so the world-space vertices aren't re-translated.
      //
      // Vertex/index patterns mirror the wall_height highlight ceiling at
      // room3d.js:3242-3320 — a long-standing working reference for
      // slanted (all 4 slant directions) and gabled (both ridge axes)
      // ceilings. _refCeilYAt is the shared ceiling-height helper the
      // wall flash builder also uses — single source of truth.
      //
      // Vertical inset is deliberately a hard 0.02 m drop below the actual
      // ceiling at every vertex, NOT the proportional _refInsetH the walls
      // use. A proportional drop on the ceiling would read as a visible
      // "skirt" of bare ceiling around the flash; 2 cm is just enough to
      // dodge z-fighting with the cage beams along the eave/ridge line.
      // Horizontal inset stays at 4% per side — same as the walls and
      // same as the prior PlaneGeometry(w*0.92, h*0.92) footprint, so
      // flat ceilings remain visually identical.
      const _CEIL_FLASH_Z_DROP = 0.02;
      const _refCeilFlashY = (x, z) => _refCeilYAt(x, z) - _CEIL_FLASH_Z_DROP;
      const _buildCeilingFlashGeom = () => {
        const xMin = -halfW + room.width_m  * _refInsetFrac;
        const xMax =  halfW - room.width_m  * _refInsetFrac;
        const zMin = -halfL + room.length_m * _refInsetFrac;
        const zMax =  halfL - room.length_m * _refInsetFrac;
        const positions = [];
        const indices   = [];
        if (_refIsGable) {
          // 6-vertex tent: 4 inset eave corners + 2 ridge endpoints.
          if (_refGableAxis === 'depth') {
            // Ridge runs front-to-back along Z; pitched faces are L and R.
            positions.push(
              xMin, _refCeilFlashY(xMin, zMin), zMin,  // 0 FL eave
              xMax, _refCeilFlashY(xMax, zMin), zMin,  // 1 FR eave
              xMax, _refCeilFlashY(xMax, zMax), zMax,  // 2 BR eave
              xMin, _refCeilFlashY(xMin, zMax), zMax,  // 3 BL eave
              0,    _refCeilFlashY(0,    zMin), zMin,  // 4 ridge front
              0,    _refCeilFlashY(0,    zMax), zMax,  // 5 ridge back
            );
            indices.push(0, 3, 5,  0, 5, 4,  1, 4, 5,  1, 5, 2);
          } else {
            // Ridge runs left-to-right along X; pitched faces are F and B.
            positions.push(
              xMin, _refCeilFlashY(xMin, zMin), zMin,  // 0 FL eave
              xMax, _refCeilFlashY(xMax, zMin), zMin,  // 1 FR eave
              xMax, _refCeilFlashY(xMax, zMax), zMax,  // 2 BR eave
              xMin, _refCeilFlashY(xMin, zMax), zMax,  // 3 BL eave
              xMin, _refCeilFlashY(xMin, 0),    0,     // 4 ridge L
              xMax, _refCeilFlashY(xMax, 0),    0,     // 5 ridge R
            );
            indices.push(1, 5, 4,  1, 4, 0,  2, 5, 4,  2, 4, 3);
          }
        } else {
          // Slanted or flat: 4-vertex quad. _refCeilYAt collapses to halfH
          // for flat ceilings, so the resulting quad is horizontal at
          // y = halfH - 0.02 with the same 0.92 footprint as the original
          // PlaneGeometry path — vertex positions are byte-identical to
          // the prior flat-ceiling rendering.
          positions.push(
            xMin, _refCeilFlashY(xMin, zMin), zMin,  // 0 FL
            xMax, _refCeilFlashY(xMax, zMin), zMin,  // 1 FR
            xMax, _refCeilFlashY(xMax, zMax), zMax,  // 2 BR
            xMin, _refCeilFlashY(xMin, zMax), zMax,  // 3 BL
          );
          indices.push(0, 1, 2,  0, 2, 3);
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geom.setIndex(indices);
        return geom;
      };
      const surfaceMeta = {
        floor:   { vertical: false, pos: [0, -halfH + 0.04, 0],  rot: ['x', -Math.PI / 2], w: room.width_m,  h: room.length_m },
        ceiling: { custom: true },
        front:   { vertical: true },
        back:    { vertical: true },
        left:    { vertical: true },
        right:   { vertical: true },
      };
      for (const [surf, meta] of Object.entries(surfaceMeta)) {
        const events = flashEventsBySurface[surf];
        if (!events.length) continue;
        // Phase 2 panel-aware flash: treated surfaces get a green wall
        // flash, untreated surfaces get a pink wall flash.
        const isTreated = surfaceTreated[surf] === true;
        const flash = new THREE.Mesh(
          meta.vertical
            ? _buildVerticalFlashGeom(surf)
            : meta.custom
              ? _buildCeilingFlashGeom()
              : new THREE.PlaneGeometry(meta.w * 0.92, meta.h * 0.92),
          new THREE.MeshBasicMaterial({
            color: isTreated ? 0x22c55e : OC.PRESSURE_PEAK,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
          })
        );
        if (!meta.vertical && !meta.custom) {
          flash.position.set(...meta.pos);
          if (meta.rot) flash.rotation[meta.rot[0]] = meta.rot[1];
        }
        const _surfStrength = isTreated ? SIM_SCALE : surfaceMeanR[surf] * SIM_SCALE;
        flash.userData.isReflectionFlash = { events, surfaceStrength: _surfStrength };
        roomGroup.add(flash);
      }

      // Wire panel cyan flashes to per-surface flash events. The panel
      // builders tagged each cyan overlay with userData.isPanelCyanFlash
      // {surface}; here we hand them the same events/strength as the wall
      // flash for that surface so the animator at room3d.js:3064-3083
      // pulses them in lock-step. Surfaces with no events (no bounce hit
      // this rebuild) leave the cyan flash unwired — it stays at
      // opacity 0 and renders nothing.
      roomGroup.children.forEach(obj => {
        const tag = obj.userData?.isPanelCyanFlash;
        if (!tag) return;
        const events = flashEventsBySurface[tag.surface];
        if (!events?.length) return;
        const isTreated = surfaceTreated[tag.surface] === true;
        const _surfStrength = isTreated ? SIM_SCALE : surfaceMeanR[tag.surface] * SIM_SCALE;
        obj.userData.isReflectionFlash = { events, surfaceStrength: _surfStrength };
      });

      // ── Frequency-banded pulse clusters (InstancedMesh — one draw call) ──
      // Each path emits one teal outgoing companion ball + a cluster of pink
      // return balls (one per band). Band → SIZE (low freq large, log-
      // wavelength); surface absorption → BRIGHTNESS (r = √(1−α) per band).
      // All balls on a path share ONE trajectory and the shared V_VIS — the
      // per-band fan-out is size + brightness only, never speed. Rendered via a
      // single InstancedMesh (one draw call) so iPad stays smooth; the animate
      // loop only mutates matrices/colours.
      const _pinkCol = new THREE.Color(OC.PRESSURE_PEAK);   // #FF107A — hero (return)
      const _tealCol = new THREE.Color(0x22c55e);           // green — quieter companion (out)
      // Room-scaled radius envelope (clamped): 125 Hz biggest, 8 kHz smallest.
      const _ballK = Math.min(1.5, Math.max(0.7, Math.max(room.width_m, room.length_m) / 5));
      const _rMax  = 0.130 * _ballK;   // low band
      const _rMin  = 0.050 * _ballK;   // high band
      const _fLo = Math.log2(125), _fHi = Math.log2(8000);
      const _bandRadius = (f) => {
        const u = Math.max(0, Math.min(1, (_fHi - Math.log2(f)) / (_fHi - _fLo)));  // 1@125 → 0@8k
        return _rMin + (_rMax - _rMin) * u;
      };
      const _TEAL_BRIGHT = 0.60;   // light-blue balls bursting from the speaker
      const _PINK_BRIGHT = 0.95;   // hero — the reflection coming back
      const ballDescs = [];
      for (const b of allBounces) {
        const startPos  = speakerPositions[b.speakerIdx];
        const bouncePos = new THREE.Vector3(b.bouncePoint.x, b.bouncePoint.y, b.bouncePoint.z);

        // Outgoing — a teal cluster bursting from the speaker toward the wall,
        // one ball per band (sized by frequency). Always flies, treated or not.
        for (const f of REFL_BANDS) {
          if (ballDescs.length >= REFL_MAX_BALLS) break;
          ballDescs.push({
            kind: 'out',
            from: startPos, to: bouncePos,
            start: b.outStart, end: b.outEnd,
            radius: _bandRadius(f),
            color: _tealCol, brightness: _TEAL_BRIGHT * SIM_SCALE,
          });
        }

        // Return — pink cluster, one ball per band, bounce → listener. Clean
        // kill: only a bare (untreated) surface bounces the pink back; a treated
        // surface absorbs it (the teal balls die into the panel).
        if (surfaceTreated[b.surface] !== true) for (const f of REFL_BANDS) {
          if (ballDescs.length >= REFL_MAX_BALLS) break;
          const r = reflectionMagnitude(b.surface, f);
          ballDescs.push({
            kind: 'return',
            from: bouncePos, to: listenerPos,
            start: b.returnStart, end: b.returnEnd,
            radius: _bandRadius(f),
            color: _pinkCol, brightness: _PINK_BRIGHT * r * SIM_SCALE,
          });
        }
      }

      // Build one InstancedMesh per field. Sized to this rebuild's actual
      // instance count; the animate loop only mutates per-instance matrices /
      // colours (no per-frame allocation). Disposal: rebuild()'s traverse
      // disposes geometry + material and calls InstancedMesh.dispose() to free
      // the instance buffers. Additive blending + per-instance colour gives
      // per-ball brightness with NO custom shader.
      const _buildBallField = (descs, segs, flagKey) => {
        if (descs.length === 0) return;
        const geo = new THREE.SphereGeometry(1, segs, Math.max(4, segs - 2));
        const mat = new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 1,
          blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const mesh = new THREE.InstancedMesh(geo, mat, descs.length);
        mesh.frustumCulled = false;
        _reflScale.setScalar(0);
        _reflM.compose(_reflPos.set(0, 0, 0), _reflQuat, _reflScale);
        _reflCol.setRGB(0, 0, 0);
        for (let i = 0; i < descs.length; i++) {
          mesh.setMatrixAt(i, _reflM);     // start hidden (scale 0)
          mesh.setColorAt(i, _reflCol);    // allocates instanceColor
        }
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        if (mesh.instanceColor) mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        mesh.userData[flagKey] = descs;
        roomGroup.add(mesh);
      };
      _buildBallField(ballDescs, 10, 'isReflectionBallField');

      // ── Listener halo (pulses pink as return pulses arrive) ──────────────
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 16, 12),
        new THREE.MeshBasicMaterial({
          color: OC.PRESSURE_PEAK,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      halo.position.copy(listenerPos);
      halo.userData.isReflectionHalo = { events: haloEvents };
      roomGroup.add(halo);

      // ── Honest labelling ─────────────────────────────────────────────────
      // Persistent "Behavioural simulation" header tells the user this is a
      // teaching visualisation. Sub-line: pre-measurement asks for upload;
      // post-measurement surfaces the measured 2-8 kHz energy value.
      if (_showLabels && currentMode !== 'setup' && !focusedOverlay) {
        const labelX = offsetX;
        const labelZ = -halfL + room.listener_front_m + 0.4;
        const yTop   = tweeterY + 0.85;
        const yMid   = tweeterY + 0.55;

        const header = _makeLabelSprite('Behavioural simulation', '#9ca3af');
        header.position.set(labelX, yTop, labelZ);
        roomGroup.add(header);

        if (hasMeasurement) {
          const sub = _makeLabelSprite(
            `Reflection energy: ${_sideRefEnergy.toFixed(0)} dBFS · measured`,
            '#9ca3af'
          );
          sub.position.set(labelX, yMid, labelZ);
          roomGroup.add(sub);
        } else {
          const sub = _makeLabelSprite('Upload a measurement for accurate scoring', '#6b7280');
          sub.position.set(labelX, yMid, labelZ);
          roomGroup.add(sub);
          // Pre-measurement scene badge — matches SBIR / Bass Modes /
          // Smoothness pattern, sits high in the room so it doesn't compete
          // with the simulation animation.
          const badge = _makeLabelSprite('Driven by your geometry + treatment', '#6b7280');
          badge.position.set(0, -halfH + room.height_m * 0.85, 0);
          roomGroup.add(badge);
        }
      }

    } catch (err) {
      console.error("[Room3D] Overlay 'side_reflections' failed to render", err);
    }

    // ---- REAR WALL ENERGY ----
    if (overlayEnabled(OVERLAYS.REAR_ENERGY)) try {
      const rearDepth = Math.max(
        room.length_m - room.listener_front_m,
        0.4
      );

      const rearZone = new THREE.Mesh(
        new THREE.BoxGeometry(
          room.width_m * 0.8,
          room.height_m * 0.7,
          rearDepth
        ),
        new THREE.MeshBasicMaterial({
          color: OC.REAR_AMBER,
          transparent: true,
          opacity: 0.05,
          depthWrite: false
        })
      );

      rearZone.position.set(
        0,
        -room.height_m / 2 + room.height_m * 0.35,
        room.length_m / 2 - rearDepth / 2
      );

      roomGroup.add(rearZone);
    } catch (err) {
      console.error("[Room3D] Overlay 'rear_energy' failed to render", err);
    }

    // ---- COFFEE TABLE ----
    if (overlayEnabled(OVERLAYS.COFFEE_TABLE)) try {
      const tableReflection = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.15, 0.7),
        new THREE.MeshBasicMaterial({
          color: OC.SWEET_SPOT_TEAL,
          transparent: true,
          opacity: 0.12,
          depthWrite: false
        })
      );

      tableReflection.position.set(
        0,
        -room.height_m / 2 + 0.35,
        room.length_m * 0.1
      );

      roomGroup.add(tableReflection);
    } catch (err) {
      console.error("[Room3D] Overlay 'coffee_table' failed to render", err);
    }

    // ---- BANDWIDTH (ROOM MODE RESONANCE FIELD) ----
    if (overlayEnabled(OVERLAYS.BANDWIDTH)) try {

      const isFocBW = focusedOverlay === OVERLAYS.BANDWIDTH;

      // Floor Y in roomGroup-local space — anchor for the focused-mode labels.
      const _bwFloorY = -room.height_m / 2;

      // Predictive model: not a physical measurement
      const bwModes = window.MeasurelyAcoustics?.computeRoomModes(room) || [];

      // ── Measurement correlation ──────────────────────────────────────────
      // _measurement is the closure variable populated by setMeasurementContext.
      // When a measurement is loaded, cross-reference predicted modes against
      // analysis.modes (measured peaks/dips) within a ±8% frequency tolerance.
      // Confirmed modes render at full shader weight; unconfirmed dim out;
      // unmatched measured peaks ≤ 1 kHz surface as 'non-modal' labels.
      const FREQ_TOL = 0.08;
      const hasMeasuredModes = !!(_measurement?.modes?.length);
      const measuredModes = hasMeasuredModes ? _measurement.modes.slice() : [];
      const usedMeasuredIdx = new Set();

      const annotatedModes = bwModes.slice(0, 8).map(p => {
        if (!hasMeasuredModes) return { ...p, confidence: 'predicted', measured: null };
        let bestIdx = -1, bestDist = Infinity;
        for (let i = 0; i < measuredModes.length; i++) {
          if (usedMeasuredIdx.has(i)) continue;
          const m = measuredModes[i];
          if (!isFinite(m?.freq_hz)) continue;
          const dist = Math.abs(m.freq_hz - p.freq_hz) / Math.max(p.freq_hz, 1);
          if (dist <= FREQ_TOL && dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
          }
        }
        if (bestIdx >= 0) {
          usedMeasuredIdx.add(bestIdx);
          return { ...p, confidence: 'confirmed', measured: measuredModes[bestIdx] };
        }
        return { ...p, confidence: 'unconfirmed', measured: null };
      });

      // Non-modal: measured peaks ≤ 1 kHz with no matching predicted mode.
      // Dips are skipped here — they're SBIR / cancellation artefacts, not
      // resonances, and live in other overlays.
      const nonModalPeaks = hasMeasuredModes
        ? measuredModes.filter((m, i) =>
            !usedMeasuredIdx.has(i) &&
            m?.type === 'peak' &&
            isFinite(m?.freq_hz) &&
            m.freq_hz > 0 && m.freq_hz <= 1000
          )
        : [];

      // Speaker archetype determines low-frequency energy injection (Hz at
      // which bass output starts rolling off): standmount ~55, floorstander ~30,
      // statement ~20, panel ~45 (dipole — earlier than floorstanders, lower
      // than standmounts), monitor ~55 (near-field, standmount-class extension).
      // pa_top ~80 (full-range top hands off to the bin stack, not designed
      // to reach deep bass itself), bass_bin ~35 (single-18 sub, deepest
      // extension of any archetype bar the statement floorstander).
      const speakerArchetype = room.speaker_type || 'standmount';
      const bassRolloffByType = { standmount: 55, floorstander: 30, statement: 20, panel: 45, monitor: 55, pa_top: 80, bass_bin: 35 };
      const bassRolloffHz = bassRolloffByType[speakerArchetype] ?? 55;

      // Confidence multiplier — drives shader weight per mode.
      //   confirmed   1.00  full intensity for measurement-backed modes
      //   unconfirmed 0.32  predicted by geometry but not seen in the IR
      //                     (was 0.45 before the palette restraint pass — dimmer so
      //                      predicted-only modes recede as visual context, not
      //                      compete with confirmed modes for attention)
      //   predicted   0.50  pre-measurement uniform treatment (no Tier-2 data;
      //                     theoretical scaffolding, not confident diagnosis)
      const confidenceMul = (m) =>
        m.confidence === 'confirmed'   ? 1.00 :
        m.confidence === 'unconfirmed' ? 0.32 :
                                         0.50;

      // Build 3D mode data — (p, q, r) indices + an energy weight per mode.
      // Mode type weights: axial 1.0, tangential 0.7, oblique 0.4. The field
      // now colours by PRESSURE MAGNITUDE only (purple→pink→white); measured
      // severity is carried by the focused-mode labels, not the field hue — so
      // the per-mode colour/severity arrays the old winner-takes-all shader
      // needed are gone. uBwModes feeds both the GPU bake and the CPU sampler.
      const modeTypeWeight = { axial: 1.0, tangential: 0.7, oblique: 0.4 };
      const uBwModes  = [];   // THREE.Vector4(p, q, r, weight) × 8 for the bake shader
      const bwModeJs  = [];   // { p, q, r, w } for CPU pressure sampling (particles + probe)
      annotatedModes.forEach(m => {
        const typeWeight = modeTypeWeight[m.type] ?? 1.0;
        // Modes below speaker bass rolloff get reduced contribution — less energy injected
        const bassEnergyScale = (m.freq_hz <= bassRolloffHz) ? 0.30 : 1.0;
        const w = typeWeight * bassEnergyScale * confidenceMul(m);
        uBwModes.push(new THREE.Vector4(m.p, m.q, m.r, w));
        bwModeJs.push({ p: m.p, q: m.q, r: m.r, w, freq_hz: m.freq_hz });
      });
      while (uBwModes.length < 8) {
        uBwModes.push(new THREE.Vector4(0, 0, 0, 0));  // pad to the shader's fixed array length
      }

      // Breathing rate derived from the dominant (lowest) mode frequency.
      // Dividing by 40 maps acoustic Hz → a 2–4 second visual cycle.
      const dominantModeFrequency = bwModes.length > 0 ? (bwModes[0].freq_hz ?? 80) : 80;
      const visualOscillationRate = dominantModeFrequency / 40;

      // Corner bass trap absorption level:
      // all/simulatePanels = 0.85, front or rear only = 0.50, none = 0.0
      const hasCeilingCloudBW = room.ceiling_panel_mode !== 'none';
      const _cloudFloor       = hasCeilingCloudBW ? 0.10 : 0.0;
      // Per-wall absorption — front = speaker wall (z = -L/2), rear = listener wall (z = +L/2)
      const _frontTraps  = simulatePanels || room.bass_trap_mode === 'front' || room.bass_trap_mode === 'all';
      const _rearTraps   = simulatePanels || room.bass_trap_mode === 'rear'  || room.bass_trap_mode === 'all';
      const _frontPanels = simulatePanels || room.wall_panel_mode === 'front' || room.wall_panel_mode === 'both';
      const _rearPanels  = simulatePanels || room.wall_panel_mode === 'rear'  || room.wall_panel_mode === 'both';

      // Traps = 0.85, panels = 0.40, both stacked = 0.90 (diminishing returns)
      const bwBassTrapsF = Math.max(_cloudFloor,
        (_frontTraps && _frontPanels) ? 0.90 : _frontTraps ? 0.85 : _frontPanels ? 0.40 : 0.0);
      const bwBassTrapsR = Math.max(_cloudFloor,
        (_rearTraps  && _rearPanels)  ? 0.90 : _rearTraps  ? 0.85 : _rearPanels  ? 0.40 : 0.0);
      // Side panels cool the lateral room mode pressure at the side walls
      const bwSidePanels = (simulatePanels || room.side_panel_mode !== 'none')
        ? (simulatePanels || room.side_panel_mode === 'both' ? 0.40 : 0.22)
        : 0.0;

      // Treatment levels, packaged once for the bake shader AND the CPU sampler
      // (particles + listener probe) so all three agree on which corners cool.
      const bwTraps = { f: bwBassTrapsF, r: bwBassTrapsR, side: bwSidePanels };

      // Particle-cloud breathing rate = the room's own dominant-mode tempo
      // (visualOscillationRate, Hz/40). Snapshot reduced-motion here so the
      // animate loop and the build agree on whether the cloud moves.
      _bwOscRate = visualOscillationRate;
      _bwReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      // RENDER. Bake the 8-mode field into the dedicated atlas ONCE, display it
      // on the six boundary planes, scatter the interior standing-wave particle
      // cloud, and probe the listening seat. Each helper is internally wrapped
      // in the _bwDisable fail-safe, so a bad GPU/RT/shader disables the whole
      // subsystem without ever breaking rebuild() or the core scene.
      // Ceiling profile drives the bake (ceiling cell sampled on the real
      // roofline), the display planes (sloped ceiling quad(s) + wall clip), and
      // the particle clip. Mode FREQUENCIES already use H_eff via computeRoomModes.
      const bwCeil = _bwCeilingUniforms(room);
      _bwTier = _bwTierConfig();
      _bakeBassField(uBwModes, bwTraps, bwCeil);
      _buildBwFieldPlanes(room, isFocBW, bwCeil);
      _buildBwParticles(room, bwModeJs, bwTraps);
      _buildBwListenerProbe(room, bwModeJs, bwTraps, isFocBW && _showLabels);

      // ── Focused-mode annotations ─────────────────────────────────────────
      // Labels only appear in focused state to avoid cluttering the
      // background/at-a-glance view. All sprites are added to roomGroup so
      // rebuild()'s traverse-and-dispose pass cleans them up automatically.
      if (_showLabels && isFocBW) {
        const _bwListenerZ = -room.length_m / 2 + room.listener_front_m;

        if (hasMeasuredModes) {
          // Confirmed modes — neutral white labels so they read cleanly against
          // any severity colour behind them. The mode plane itself carries the
          // severity signal; tinting the label by severity would just clutter.
          const _confirmed = annotatedModes.filter(m => m.confidence === 'confirmed');
          _confirmed.slice(0, 5).forEach((m, i) => {
            const f  = Math.round(m.measured.freq_hz);
            const dB = m.measured.delta_db;
            const sign = dB >= 0 ? '+' : '';
            const lbl = _makeLabelSprite(`${f} Hz · ${sign}${dB.toFixed(1)} dB`,
                                         '#f8fafc');
            lbl.position.set(0, _bwFloorY + 0.45 + i * 0.20, 0);
            roomGroup.add(lbl);
          });

          // Non-modal peaks — pink labels stacked above listener position.
          // Distinct from the white modal labels by their " · non-modal" suffix
          // AND position (they float above the listener, while the purple field +
          // particle cloud carry the modal pressure pattern). On-brand pink per
          // the visual tenet — no amber on this overlay. Semantic: "we measured
          // this but it's not a textbook room mode."
          nonModalPeaks.slice(0, 4).forEach((m, i) => {
            const f  = Math.round(m.freq_hz);
            const dB = m.delta_db ?? 0;
            const sign = dB >= 0 ? '+' : '';
            const lbl = _makeLabelSprite(
              `${f} Hz · ${sign}${dB.toFixed(1)} dB · non-modal`,
              OVERLAY_COLOURS.PRESSURE_PEAK
            );
            lbl.position.set(0, _bwFloorY + 1.30 + i * 0.20, _bwListenerZ);
            roomGroup.add(lbl);
          });
        } else {
          // Pre-measurement: single badge to make the predicted-only state
          // explicit. Muted slate keeps the badge legible without competing
          // with the purple modal field behind it.
          const lbl = _makeLabelSprite('Predicted — no measurement loaded',
                                       '#94a3b8');
          lbl.position.set(0, _bwFloorY + 0.45, 0);
          roomGroup.add(lbl);
        }
      }
    } catch (err) {
      console.error("[Room3D] Overlay 'bandwidth' failed to render", err);
    }

    // ---- PEAKS & DIPS (volumetric modal-pressure slab) ----
    // Separate lens on the same modes as Bass Modes: a translucent slab you
    // scrub by frequency. Builds + bakes the field at the current _peaksFreq;
    // re-bakes (without a full rebuild) when api.setPeaksFreq() moves the slider.
    if (overlayEnabled(OVERLAYS.PEAKS_DIPS)) try {
      _buildPeaksSlab(room);
    } catch (err) {
      console.error("[Room3D] Overlay 'peaks_dips' failed to render", err);
    }

    // Clarity overlay was removed in May 2026: predicted three-ray triangle
    // wireframe never read measured arrival times. Reflections (rebuilt as
    // a behavioural simulation) covers the same teaching ground honestly.
    // The Clarity SCORE is preserved (scoreClarity in score.js, surfaced
    // through the HUD pillar breakdown).

  }

  /* ------------------------------------------
     START
  ------------------------------------------ */
  _dbg("[Room3D] 🚀 Starting engine | mountId:", mountId, "| stage:", renderStage);
  rebuild();
  animate();

  // ── Cloud data reactivity ────────────────────────────────────────────────
  // pullRoom() / loadRoomById() in sync.js dispatch this after writing to
  // localStorage; auth.js also dispatches it when seeding a new user's
  // default layout. Listener is *persistent* (no { once: true }) so the
  // engine re-renders every time a different saved room is loaded — the
  // multi-room "My Rooms" panel relies on this.
  // _freshRoomOverride lets us bypass a stale local roomState in the caller.
  window.addEventListener('measurely:data-ready', function _onCloudRoom(e) {
    if (e.detail?.room) _freshRoomOverride = e.detail.room;
    rebuild();
  });

  /* ------------------------------------------
     PUBLIC API
     Also exported to window.room3d so the
     instance is always inspectable from the
     browser console regardless of which page
     initialised it.
  ------------------------------------------ */
  /* ============================================================
     SOUND BURST — triggered showpiece subsystem
     ============================================================ */

  // Device tier — particle budget + trail length behind one scalar. iPad /
  // small / reduced-motion drop hard; desktop runs the full swarm.
  function _burstTier() {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const low = reduced
      || window.matchMedia('(pointer: coarse)').matches
      || window.matchMedia('(max-width: 900px)').matches;
    return {
      reduced,
      maxBalls:  reduced ? 120 : low ? 500 : 2500,   // hard-capped
      trailLen:  reduced ? 0   : low ? 2   : 3,
      speedMult: reduced ? 1.8 : 2.6,
    };
  }

  // Seed an InstancedMesh: all instances hidden (scale 0), instanceColor
  // allocated, dynamic-draw usage flagged for the per-frame updates.
  function _seedBurstInstanced(mesh, n) {
    _reflScale.setScalar(0);
    _reflM.compose(_reflPos.set(0, 0, 0), _reflQuat, _reflScale);
    _reflCol.setRGB(0, 0, 0);
    for (let i = 0; i < n; i++) { mesh.setMatrixAt(i, _reflM); mesh.setColorAt(i, _reflCol); }
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (mesh.instanceColor) mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }

  // Collapse a particle's ball + all its trail instances to scale 0 (hidden).
  function _burstHide(i) {
    _reflScale.setScalar(0);
    _reflM.compose(_reflPos.set(0, 0, 0), _reflQuat, _reflScale);
    _burstBalls.setMatrixAt(i, _reflM);
    if (_burstTrails) {
      for (let k = 0; k < _burstTrailLen; k++) _burstTrails.setMatrixAt(i * _burstTrailLen + k, _reflM);
    }
  }

  function _teardownSoundBurst() {
    for (const m of [_burstBalls, _burstTrails, _burstHalo]) {
      if (!m) continue;
      roomGroup.remove(m);
      if (m.geometry) m.geometry.dispose();
      if (m.material) m.material.dispose();
      if (m.isInstancedMesh && typeof m.dispose === 'function') m.dispose();
    }
    _burstBalls = _burstTrails = _burstHalo = null;
    _burstPool = [];
    _burstRunning = false;
    _burstHaloE = 0;
  }

  // Fire a fresh burst from both speakers. Re-fireable: tears down any running
  // burst first. Reads the CURRENT room (geometry + treatment) from _lastRoom,
  // so toggling a panel then firing shows the new absorption.
  function _fireSoundBurst() {
    if (!_lastRoom) return;
    _teardownSoundBurst();
    const room = _lastRoom;
    const tier = _burstTier();
    const halfW = room.width_m / 2, halfH = room.height_m / 2, halfL = room.length_m / 2;
    const offsetX = room.listener_offset_m || 0;
    const tweeterY = -halfH + (room.tweeter_height_m || 0.95);
    // Speakers — same formula that populates _spkLeftLocalPos / _spkRightLocalPos.
    const spk = [
      new THREE.Vector3(offsetX - room.spk_spacing_m / 2, tweeterY, -halfL + room.spk_front_m),
      new THREE.Vector3(offsetX + room.spk_spacing_m / 2, tweeterY, -halfL + room.spk_front_m),
    ];
    // Listener — same ear point the Reflections overlay aims at (listenerPos).
    const _isStudio = room.room_type === 'studio';
    const _seat = room.seating_type || 'sofa';
    const _sphZ = _isStudio ? 0.20 : (_seat === 'lounge' ? 0.38 : 0.28);
    const _sphY = _isStudio ? 1.22 : (_seat === 'lounge' ? 1.00 : 0.96);
    _burstCtx.listener.set(
      offsetX + (room.listener_offset_m || 0),
      -halfH + _sphY,
      -halfL + (room.listener_front_m || 2.8) + _sphZ
    );
    _burstCtx.halfW = halfW; _burstCtx.halfH = halfH; _burstCtx.halfL = halfL;
    // Treatment state — same derivation as the Reflections overlay's surfaceTreated.
    const sideMode = room.side_panel_mode || 'none', wallMode = room.wall_panel_mode || 'none';
    const ceilMode = room.ceiling_panel_mode || 'none', floorMat = room.floor_material || 'hard';
    _burstCtx.treated = {
      floor:   floorMat === 'carpet' || (room.opt_area_rug ?? false),
      ceiling: ceilMode !== 'none',
      left:    sideMode === 'left'  || sideMode === 'both',
      right:   sideMode === 'right' || sideMode === 'both',
      front:   wallMode === 'front' || wallMode === 'both',
      back:    wallMode === 'rear'  || wallMode === 'both',
    };
    _burstCtx.colors = BURST_CLASSES.map(c => new THREE.Color(c.hex));

    // ONE shared speed — the Sound Waves ring speed × a drama multiplier.
    // Frequency NEVER changes speed; temporal variety comes from decay only.
    const vVis  = (Math.max(room.length_m, room.width_m) * WAVE_EXTENT_FACTOR) / WAVE_CYCLE_S;
    const speed = vVis * tier.speedMult;
    const roomK = Math.min(1.5, Math.max(0.7, Math.max(room.width_m, room.length_m) / 5));

    // Per-class spawn counts ∝ weight (treble densest, bass fewest), capped to
    // the tier budget and split across the two speakers.
    const totW = BURST_CLASSES.reduce((a, c) => a + c.w, 0);
    _burstPool = [];
    for (let ci = 0; ci < BURST_CLASSES.length; ci++) {
      const cls = BURST_CLASSES[ci];
      const n = Math.max(2, Math.round(tier.maxBalls * (cls.w / totW)));
      const radius = cls.rK * roomK;
      const perSpk = Math.ceil(n / spk.length);
      for (let s = 0; s < spk.length; s++) {
        for (let j = 0; j < perSpk; j++) {
          if (_burstPool.length >= tier.maxBalls) break;
          // Forward-biased explosion: a uniform sphere direction blended toward
          // the speaker→listener axis.
          const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
          const rr = Math.sqrt(Math.max(0, 1 - u * u));
          const fx = _burstCtx.listener.x - spk[s].x;
          const fy = _burstCtx.listener.y - spk[s].y;
          const fz = _burstCtx.listener.z - spk[s].z;
          const fl = Math.hypot(fx, fy, fz) || 1;
          _burstScratchV.set(
            rr * Math.cos(th) * 0.6 + (fx / fl) * 0.5,
            u * 0.6 + (fy / fl) * 0.5,
            rr * Math.sin(th) * 0.6 + (fz / fl) * 0.5
          ).normalize();
          _burstPool.push({
            alive: true, ci, radius,
            pos: spk[s].clone(),
            vel: _burstScratchV.clone().multiplyScalar(speed),
            energy: 1.0,
          });
        }
      }
    }
    if (_burstPool.length === 0) return;
    _burstTrailLen = tier.trailLen;

    // The swarm — one InstancedMesh, additive so it blooms.
    const ballGeo = new THREE.SphereGeometry(1, 8, 6);
    const ballMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    _burstBalls = new THREE.InstancedMesh(ballGeo, ballMat, _burstPool.length);
    _burstBalls.frustumCulled = false;
    _seedBurstInstanced(_burstBalls, _burstPool.length);
    _burstBalls.userData.isBurstSwarm = true;
    roomGroup.add(_burstBalls);

    if (_burstTrailLen > 0) {
      const tGeo = new THREE.SphereGeometry(1, 6, 4);
      const tMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      _burstTrails = new THREE.InstancedMesh(tGeo, tMat, _burstPool.length * _burstTrailLen);
      _burstTrails.frustumCulled = false;
      _seedBurstInstanced(_burstTrails, _burstPool.length * _burstTrailLen);
      roomGroup.add(_burstTrails);
    }

    // Listener ping marker — pulses white when balls arrive.
    _burstHalo = new THREE.Mesh(
      new THREE.SphereGeometry(0.22 * roomK, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    _burstHalo.position.copy(_burstCtx.listener);
    roomGroup.add(_burstHalo);

    _burstHaloE = 0;
    _burstLastT = performance.now();
    _burstRunning = true;
  }

  // Per-frame integrator — called from animate(), after the overlay block so
  // the shared _refl* scratch is free. Advances, bounces (treated walls eat the
  // treble/mid), decays, pings the listener, recycles dead balls. No allocation.
  function _tickSoundBurst() {
    if (!_burstRunning || !_burstBalls) return;
    const now = performance.now();
    let dt = (now - _burstLastT) / 1000;
    _burstLastT = now;
    if (dt <= 0) return;
    if (dt > 0.05) dt = 0.05;   // clamp tab-switch / GC gaps
    const ctx = _burstCtx;
    const hw = ctx.halfW, hh = ctx.halfH, hl = ctx.halfL;
    let anyAlive = false, haloHit = 0;

    for (let i = 0; i < _burstPool.length; i++) {
      const p = _burstPool[i];
      if (!p.alive) { _burstHide(i); continue; }
      const cls = BURST_CLASSES[p.ci];
      p.pos.addScaledVector(p.vel, dt);
      // Bounce off the six planes — flip the normal velocity component, lose
      // energy = class base + treatment loss for the surface hit.
      let surf = null;
      if (p.pos.x >  hw) { p.pos.x =  hw - (p.pos.x - hw); p.vel.x = -p.vel.x; surf = 'right'; }
      else if (p.pos.x < -hw) { p.pos.x = -hw - (p.pos.x + hw); p.vel.x = -p.vel.x; surf = 'left'; }
      if (p.pos.y >  hh) { p.pos.y =  hh - (p.pos.y - hh); p.vel.y = -p.vel.y; surf = 'ceiling'; }
      else if (p.pos.y < -hh) { p.pos.y = -hh - (p.pos.y + hh); p.vel.y = -p.vel.y; surf = 'floor'; }
      if (p.pos.z >  hl) { p.pos.z =  hl - (p.pos.z - hl); p.vel.z = -p.vel.z; surf = 'back'; }
      else if (p.pos.z < -hl) { p.pos.z = -hl - (p.pos.z + hl); p.vel.z = -p.vel.z; surf = 'front'; }
      if (surf) {
        const loss = cls.bounce + (ctx.treated[surf] ? cls.treat : 0);
        p.energy *= (1 - Math.min(0.98, loss));
        // Shared surface-impact: the ball physically struck this plane — feed
        // the splash + heat map with its post-bounce energy (already reduced
        // on treated surfaces, so the rug/panels deposit little and stay cool).
        impactAt(surf, p.pos, p.energy);
      }
      p.energy -= cls.decay * dt;   // continuous decay — HF dies fastest
      if (p.energy <= _BURST_DIE) { p.alive = false; _burstHide(i); continue; }
      anyAlive = true;
      const dl = p.pos.distanceTo(ctx.listener);
      if (dl < _BURST_FLASH_R) haloHit = Math.max(haloHit, p.energy * (1 - dl / _BURST_FLASH_R));
      // Write swarm instance — additive colour carries brightness (energy).
      _reflScale.setScalar(p.radius);
      _reflM.compose(p.pos, _reflQuat, _reflScale);
      _burstBalls.setMatrixAt(i, _reflM);
      _reflCol.copy(ctx.colors[p.ci]).multiplyScalar(Math.min(1, p.energy));
      _burstBalls.setColorAt(i, _reflCol);
      // Trail — a short streak behind the ball along −velocity.
      if (_burstTrails) {
        const inv = 1 / (Math.hypot(p.vel.x, p.vel.y, p.vel.z) || 1);
        for (let k = 0; k < _burstTrailLen; k++) {
          const ti = i * _burstTrailLen + k;
          const fade = 1 - (k + 1) / (_burstTrailLen + 1);
          _burstScratchV.copy(p.vel).multiplyScalar(-inv * (k + 1) * p.radius * 1.6);
          _reflPos.copy(p.pos).add(_burstScratchV);
          _reflScale.setScalar(p.radius * fade * 0.85);
          _reflM.compose(_reflPos, _reflQuat, _reflScale);
          _burstTrails.setMatrixAt(ti, _reflM);
          _reflCol.copy(ctx.colors[p.ci]).multiplyScalar(Math.min(1, p.energy) * fade * 0.6);
          _burstTrails.setColorAt(ti, _reflCol);
        }
      }
    }

    // Listener ping — bump on arrival, decay otherwise.
    _burstHaloE = Math.max(_burstHaloE * Math.max(0, 1 - dt * 3.0), haloHit);
    if (_burstHalo) {
      _burstHalo.material.opacity = Math.min(0.9, _burstHaloE);
      _burstHalo.scale.setScalar(1 + _burstHaloE * 0.5);
    }

    _burstBalls.instanceMatrix.needsUpdate = true;
    if (_burstBalls.instanceColor) _burstBalls.instanceColor.needsUpdate = true;
    if (_burstTrails) {
      _burstTrails.instanceMatrix.needsUpdate = true;
      if (_burstTrails.instanceColor) _burstTrails.instanceColor.needsUpdate = true;
    }

    if (!anyAlive && _burstHaloE < 0.02) _teardownSoundBurst();   // costs nothing when idle
  }

  // ════════════════════════════════════════════════════════════════════════
  //  SHARED SURFACE-IMPACT + HEAT-MAP SYSTEM
  //  Layer 1: transient ripple splashes (instanced, pooled, recycled).
  //  Layer 2: GPU render-to-texture accumulation atlas → pink heat ramp on a
  //           six-plane heat shell. Fed by impactAt() from both ball systems.
  // ════════════════════════════════════════════════════════════════════════

  // Fail-safe kill switch. The heat map is a purely additive cosmetic layer
  // that touches a render target + custom shaders — exactly the surface that
  // can fail on an old/odd GPU. If any heat op throws, disable the whole
  // system once (logged once, never retried) so it can NEVER take the core
  // scene or the app's init flow down with it.
  function _heatDisable(where, err) {
    if (!_heatFailed) {
      _heatFailed = true;
      try { console.warn('[Room3D] heat-map disabled after error in ' + where + ':', err); } catch (e) {}
    }
    _heatReady = false;
    _heatActive = false;
  }

  // Device-tier scalar — modest target res + fewer updates on iPad / coarse
  // pointers, none of the animated ripples under reduced motion. Mirrors the
  // tiering the Reflections overlay and the burst swarm already use.
  function _heatTierConfig() {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const low = reduced
      || window.matchMedia('(pointer: coarse)').matches
      || window.matchMedia('(max-width: 900px)').matches;
    return {
      reduced,
      rtSize:      low ? 256 : 512,      // 8-bit atlas resolution (one texture, six cells)
      updateMs:    low ? 55  : 33,       // decay+splat throttle (~18 / ~30 Hz)
      decay:       low ? 0.95 : 0.965,   // per-update multiply — slow build, ~1 s fade-out
      depositGain: 0.085,                // heat added per unit reflected energy
      blobRadius:  0.05,                 // deposit blob full-width in atlas (0..1) units
      splashCap:   low ? 40 : 96,        // Layer-1 ripple pool hard cap
      splatCap:    64,                   // max deposits flushed per RT update
      enableSplash: !reduced,            // reduced motion: heat still builds, no ripples
    };
  }

  // Soft pink ripple annulus — generated once, reused for every splash. White
  // RGB (tinted per-instance via instanceColor), alpha is the ring profile.
  function _makeRingTexture() {
    if (_heatRingTex) return _heatRingTex;
    const S = 64, data = new Uint8Array(S * S * 4), c = (S - 1) / 2;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = (x - c) / c, dy = (y - c) / c;
        const radius = Math.sqrt(dx * dx + dy * dy);            // 0 centre → 1 rim
        const ring = Math.exp(-Math.pow((radius - 0.72) / 0.26, 2)); // peak near rim
        const alpha = radius > 1 ? 0 : Math.max(0, Math.min(1, ring));
        const i = (y * S + x) * 4;
        data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
        data[i + 3] = Math.round(alpha * 255);
      }
    }
    const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    _heatRingTex = tex;
    return tex;
  }

  // Wipe the accumulation atlas to zero heat (new room geometry must not
  // inherit the previous room's hot patches).
  function _clearHeatRT() {
    if (!_heatRT) return;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(_heatRT);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, false, false);
    renderer.setRenderTarget(prev);
    renderer.setClearColor(0xc8c8c8, 1);   // restore the scene's studio-cyc backdrop
  }

  // Lazily create the persistent off-screen machinery: the accumulation
  // render target, the ortho scene holding the in-place decay quad and the
  // additive deposit-splat InstancedMesh. These survive rebuild() — only the
  // atlas contents are cleared per rebuild.
  function _ensureHeatTargets() {
    const tier = _heatTierConfig();
    if (_heatRT && _heatRT.width !== tier.rtSize) { _heatRT.dispose(); _heatRT = null; }
    if (!_heatRT) {
      _heatRT = new THREE.WebGLRenderTarget(tier.rtSize, tier.rtSize, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,    // 8-bit is plenty for a heat scalar
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      });
      _clearHeatRT();
    }
    if (!_heatRtScene) {
      _heatRtScene = new THREE.Scene();
      // Ortho cam: atlas UV space [0,1]² maps to the full target.
      _heatRtCam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);

      // In-place decay: a fullscreen quad that MULTIPLIES the target by k.
      // CustomBlending (dst = dst·srcColor) with srcColor = (k,k,k) fades the
      // whole atlas each update — no ping-pong second target needed.
      const decayMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, depthTest: false, depthWrite: false,
      });
      decayMat.blending       = THREE.CustomBlending;
      decayMat.blendEquation  = THREE.AddEquation;
      decayMat.blendSrc       = THREE.ZeroFactor;
      decayMat.blendDst       = THREE.SrcColorFactor;
      decayMat.blendSrcAlpha  = THREE.ZeroFactor;
      decayMat.blendDstAlpha  = THREE.OneFactor;     // leave alpha alone (unused)
      _heatDecayQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), decayMat);
      _heatDecayQuad.position.set(0.5, 0.5, 0);
      _heatDecayQuad.renderOrder = 0;                // runs before the splats
      _heatRtScene.add(_heatDecayQuad);

      // Deposit splats — instanced additive blobs with a radial gaussian
      // falloff. Per-instance position+size via instanceMatrix; deposit amount
      // carried in instanceColor.r. (Under InstancedMesh, r128 auto-declares
      // both `instanceMatrix` and `instanceColor` in the vertex prefix.)
      _heatSplatCap = tier.splatCap;
      const splatMat = new THREE.ShaderMaterial({
        transparent: true, depthTest: false, depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {},
        vertexShader: `
          varying vec2 vUv;
          varying float vDeposit;
          void main() {
            vUv = uv;
            #ifdef USE_INSTANCING_COLOR
              vDeposit = instanceColor.r;
            #else
              vDeposit = 1.0;
            #endif
            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          varying vec2 vUv;
          varying float vDeposit;
          void main() {
            float d = length(vUv - 0.5) * 2.0;     // 0 centre → 1 rim
            float fall = exp(-d * d * 4.0);        // soft gaussian blob
            gl_FragColor = vec4(vec3(fall * vDeposit), 1.0);
          }`,
      });
      _heatSplatMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), splatMat, _heatSplatCap);
      _heatSplatMesh.frustumCulled = false;
      _heatScratchS.setScalar(0);
      _heatScratchM.compose(_heatScratchV.set(0, 0, 0), _heatScratchQ.set(0, 0, 0, 1), _heatScratchS);
      _heatScratchC.setRGB(0, 0, 0);
      for (let i = 0; i < _heatSplatCap; i++) {
        _heatSplatMesh.setMatrixAt(i, _heatScratchM);
        _heatSplatMesh.setColorAt(i, _heatScratchC);   // allocates instanceColor
      }
      _heatSplatMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (_heatSplatMesh.instanceColor) _heatSplatMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      _heatSplatMesh.renderOrder = 1;                  // additive, after decay
      _heatRtScene.add(_heatSplatMesh);
    }
    _heatTier = tier;
  }

  // (Heat-shell display shader strings _HEAT_VERT / _HEAT_FRAG are declared
  //  in the early module-state block — they must exist before the first
  //  rebuild() runs inside initRoom3D, which is earlier than this point in
  //  source order, so a const here would hit the temporal dead zone.)

  // Build the six heat-shell planes + the Layer-1 ripple pool. Called at the
  // end of rebuild() once room geometry + treatment are known. The planes and
  // ripple mesh live in roomGroup (auto-disposed by the next rebuild traverse);
  // the atlas/decay/splat machinery is persistent (only its contents reset).
  function _buildHeatShell(room) {
    if (_heatFailed) return;   // a prior heat op threw — stay disabled, never break rebuild()
    try {
    _teardownHeatShell();      // drop stale refs (meshes already freed by the rebuild traverse)
    _ensureHeatTargets();

    const hW = room.width_m / 2, hH = room.height_m / 2, hL = room.length_m / 2;
    _impactRoom.hW = hW; _impactRoom.hH = hH; _impactRoom.hL = hL;

    // Treatment state — SAME derivation as the Reflections overlay + burst, so
    // "treated" agrees across all three. Deposits scale down on treated
    // surfaces (rug doing its job; panels visibly cooling their wall).
    const sideMode = room.side_panel_mode    || 'none';
    const wallMode = room.wall_panel_mode    || 'none';
    const ceilMode = room.ceiling_panel_mode || 'none';
    const floorMat = room.floor_material     || 'hard';
    _impactTreated.floor   = floorMat === 'carpet' || (room.opt_area_rug ?? false);
    _impactTreated.ceiling = ceilMode !== 'none';
    _impactTreated.left    = sideMode === 'left'  || sideMode === 'both';
    _impactTreated.right   = sideMode === 'right' || sideMode === 'both';
    _impactTreated.front   = wallMode === 'front' || wallMode === 'both';
    _impactTreated.back    = wallMode === 'rear'  || wallMode === 'both';

    _heatPending.length = 0;
    _heatActive = false;
    _reflImpactPrevCycle = 0;
    for (const k in _heatSurfLastMs) delete _heatSurfLastMs[k];   // no stale per-surface heat across a geometry change
    _clearHeatRT();

    // Per-surface splash orientation: rotate the ripple quad's +Z to the
    // inward surface normal so the disc lies IN the surface plane.
    const faceNormal = (nx, ny, nz) => new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(nx, ny, nz));
    _heatSurfQuat.floor   = faceNormal(0,  1,  0);
    _heatSurfQuat.ceiling = faceNormal(0, -1,  0);
    _heatSurfQuat.front   = faceNormal(0,  0,  1);
    _heatSurfQuat.back    = faceNormal(0,  0, -1);
    _heatSurfQuat.left    = faceNormal(1,  0,  0);
    _heatSurfQuat.right   = faceNormal(-1, 0,  0);

    // Atlas cells — 3 columns × 2 rows, indexed by _HEAT_SURF_INDEX.
    const COLS = 3, ROWS = 2, cw = 1 / COLS, ch = 1 / ROWS;
    const cellRect = (idx) => [ (idx % COLS) * cw, Math.floor(idx / COLS) * ch, cw, ch ];

    // Heat-shell planes — explicit local-space quads at each boundary, slightly
    // inset, identity transform (so the vertex position IS the roomGroup-local
    // coordinate the fragment maps to UV). Floor sits just above the rug.
    const fY = -hH + 0.025, INSET = 0.02;
    const planeDefs = [
      ['floor',   [[-hW, fY, -hL], [hW, fY, -hL], [hW, fY, hL], [-hW, fY, hL]]],
      ['ceiling', [[-hW, hH - 0.01, -hL], [hW, hH - 0.01, -hL], [hW, hH - 0.01, hL], [-hW, hH - 0.01, hL]]],
      ['front',   [[-hW, -hH, -hL + INSET], [hW, -hH, -hL + INSET], [hW, hH, -hL + INSET], [-hW, hH, -hL + INSET]]],
      ['back',    [[-hW, -hH, hL - INSET], [hW, -hH, hL - INSET], [hW, hH, hL - INSET], [-hW, hH, hL - INSET]]],
      ['left',    [[-hW + INSET, -hH, -hL], [-hW + INSET, -hH, hL], [-hW + INSET, hH, hL], [-hW + INSET, hH, -hL]]],
      ['right',   [[hW - INSET, -hH, -hL], [hW - INSET, -hH, hL], [hW - INSET, hH, hL], [hW - INSET, hH, -hL]]],
    ];
    const buildQuad = (c) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        ...c[0], ...c[1], ...c[2],
        ...c[0], ...c[2], ...c[3],
      ]), 3));
      return g;
    };
    _heatPlanes = [];
    for (const [key, corners] of planeDefs) {
      const idx = _HEAT_SURF_INDEX[key];
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        vertexShader: _HEAT_VERT, fragmentShader: _HEAT_FRAG,
        uniforms: {
          uHeat:    { value: _heatRT.texture },
          uHalf:    { value: new THREE.Vector3(hW, hH, hL) },
          uSurf:    { value: idx },
          uCell:    { value: new THREE.Vector4(...cellRect(idx)) },
          uOpacity: { value: 0.95 },
        },
      });
      const mesh = new THREE.Mesh(buildQuad(corners), mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 4;          // after the grid (3), under the ball overlays
      mesh.visible = false;          // revealed once THIS surface receives heat
      mesh.userData.isHeatPlane = true;
      mesh.userData.heatSurfKey = key;
      roomGroup.add(mesh);
      _heatPlanes.push(mesh);
    }

    // Layer-1 ripple pool — one InstancedMesh, additive, ring texture. Per
    // splash: expanding scale (matrix) + fading tint (instanceColor). Pooled
    // and recycled round-robin so there is no per-frame allocation.
    _heatSplashCap = _heatTier.splashCap;
    _heatSplashCursor = 0;
    _heatSplashPool = [];
    const splashMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, map: _makeRingTexture(),
      transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    _heatSplashMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), splashMat, _heatSplashCap);
    _heatSplashMesh.frustumCulled = false;
    _heatScratchS.setScalar(0);
    _heatScratchM.compose(_heatScratchV.set(0, 0, 0), _heatScratchQ.set(0, 0, 0, 1), _heatScratchS);
    _heatScratchC.setRGB(0, 0, 0);
    for (let i = 0; i < _heatSplashCap; i++) {
      _heatSplashMesh.setMatrixAt(i, _heatScratchM);
      _heatSplashMesh.setColorAt(i, _heatScratchC);
      _heatSplashPool.push({
        alive: false, age: 0, life: 0.5, maxR: 0.3,
        pos: new THREE.Vector3(), quat: _heatSurfQuat.floor, col: new THREE.Color(1, 0.1, 0.5),
      });
    }
    _heatSplashMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (_heatSplashMesh.instanceColor) _heatSplashMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    _heatSplashMesh.renderOrder = 12;     // above the heat shell, with the ball overlays
    _heatSplashMesh.userData.isHeatSplash = true;
    roomGroup.add(_heatSplashMesh);

    _heatReady = true;
    } catch (err) { _heatDisable('_buildHeatShell', err); }
  }

  // Drop heat-shell refs. The planes + ripple mesh live in roomGroup, so the
  // rebuild() disposal traverse has already freed their GPU resources by the
  // time this runs; we only clear closure refs so a fresh rebuild starts clean.
  function _teardownHeatShell() {
    _heatPlanes = [];
    _heatSplashMesh = null;
    _heatSplashPool = [];
    _heatReady = false;
    _heatActive = false;
    _heatPending.length = 0;
  }

  // Shared impact entry point — called by the Impulse bounce handler and the
  // Reflections cycle-crossing detector. surfaceKey ∈ floor|ceiling|front|
  // back|left|right; point is in roomGroup-LOCAL coordinates; energy is the
  // reflected/effective energy in 0..1.
  function impactAt(surfaceKey, point, energy) {
    if (!_heatReady) return;
    try {
    const idx = _HEAT_SURF_INDEX[surfaceKey];
    if (idx === undefined) return;
    const e = Math.max(0, Math.min(1, energy));
    if (e <= 0.001) return;
    const treated = _impactTreated[surfaceKey] === true;
    const hW = _impactRoom.hW, hH = _impactRoom.hH, hL = _impactRoom.hL;
    const px = point.x, py = point.y, pz = point.z;

    // Local point → surface (u, v) — identical formula to the display shader.
    let u, v;
    if (idx <= 1)      { u = (px + hW) / (2 * hW); v = (pz + hL) / (2 * hL); }
    else if (idx <= 3) { u = (px + hW) / (2 * hW); v = (py + hH) / (2 * hH); }
    else               { u = (pz + hL) / (2 * hL); v = (py + hH) / (2 * hH); }
    u = Math.max(0, Math.min(1, u));
    v = Math.max(0, Math.min(1, v));

    // Layer 2 — queue a heat deposit. Deposit ∝ reflected energy; treated
    // surfaces deposit far less, so the rug / treated panels stay cool while
    // bare walls climb to the white-hot core.
    if (_heatPending.length < _heatSplatCap) {
      const COLS = 3, cw = 1 / COLS, ch = 1 / 2, PAD = 0.10;   // PAD keeps the blob inside its cell (no cross-surface bleed)
      const col = idx % COLS, rowTop = Math.floor(idx / COLS);
      const au = (col + PAD + u * (1 - 2 * PAD)) * cw;
      const av = (rowTop + PAD + v * (1 - 2 * PAD)) * ch;
      const deposit = e * (treated ? 0.18 : 1.0) * _heatTier.depositGain;
      _heatPending.push({ u: au, v: av, deposit });
    }
    _heatActive = true;
    _heatLastImpactMs = performance.now();
    _heatSurfLastMs[surfaceKey] = _heatLastImpactMs;   // gates this surface's plane visibility

    // Layer 1 — transient ripple splash (skipped entirely under reduced
    // motion). Treated surfaces get a cooler, smaller, shorter ripple;
    // untreated get a brighter, larger one. Both stay in the pink family.
    if (_heatTier.enableSplash && _heatSplashMesh) {
      const slot = (_heatSplashCursor++) % _heatSplashCap;   // O(1) round-robin
      const s = _heatSplashPool[slot];
      s.alive = true; s.age = 0;
      s.life = treated ? 0.70 : 0.90;                        // linger longer — readable to the eye
      s.maxR = (treated ? 0.26 : 0.42) * (0.5 + e);          // bigger; size ∝ energy
      s.pos.set(px, py, pz);
      s.quat = _heatSurfQuat[surfaceKey];
      if (treated) s.col.setRGB(0.55 * e, 0.10 * e, 0.55 * e); // dim cool magenta
      else         s.col.setRGB(1.00 * e, 0.10 * e, 0.48 * e); // bright hot pink (#FF107A family)
    }
    } catch (err) { _heatDisable('impactAt', err); }
  }

  // Throttled accumulation pass: decay the atlas in place, then additively
  // splat the deposits queued since the last update — ONE off-screen render
  // call. Retires the shell when impacts have stopped and the heat has faded.
  function _updateHeatAccumulation() {
    if (_heatFailed || !_heatRT || !_heatActive) return;
    try {
    const now = performance.now();
    if (now - _heatLastUpdateMs < _heatTier.updateMs) return;
    _heatLastUpdateMs = now;

    // Flush queued deposits into the splat instances; hide the rest.
    const n = Math.min(_heatPending.length, _heatSplatCap);
    for (let i = 0; i < _heatSplatCap; i++) {
      if (i < n) {
        const p = _heatPending[i];
        _heatScratchS.set(_heatTier.blobRadius, _heatTier.blobRadius, 1);
        _heatScratchM.compose(_heatScratchV.set(p.u, p.v, 0), _heatScratchQ.set(0, 0, 0, 1), _heatScratchS);
        _heatSplatMesh.setMatrixAt(i, _heatScratchM);
        _heatScratchC.setRGB(p.deposit, 0, 0);
        _heatSplatMesh.setColorAt(i, _heatScratchC);
      } else {
        _heatScratchS.setScalar(0);
        _heatScratchM.compose(_heatScratchV.set(0, 0, 0), _heatScratchQ.set(0, 0, 0, 1), _heatScratchS);
        _heatSplatMesh.setMatrixAt(i, _heatScratchM);
      }
    }
    _heatPending.length = 0;
    _heatSplatMesh.instanceMatrix.needsUpdate = true;
    if (_heatSplatMesh.instanceColor) _heatSplatMesh.instanceColor.needsUpdate = true;

    // Decay strength → fullscreen multiply quad colour.
    _heatDecayQuad.material.color.setScalar(_heatTier.decay);

    // One render into the atlas: decay (renderOrder 0, multiply) then splats
    // (renderOrder 1, additive). autoClear off so accumulation persists.
    const prevTarget    = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.setRenderTarget(_heatRT);
    renderer.autoClear = false;
    renderer.render(_heatRtScene, _heatRtCam);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;

    // Per-surface visibility — only draw the planes for surfaces that have
    // been struck recently (keeps cold walls' large additive quads off the
    // GPU, protecting iPad fillrate). Once EVERY surface has gone quiet long
    // enough for the decay to fade the map, idle off + clear (zero cost until
    // the next impact).
    const FADE_MS = 4000;
    let anyHot = false;
    for (const pl of _heatPlanes) {
      const hot = (now - (_heatSurfLastMs[pl.userData.heatSurfKey] || 0)) < FADE_MS;
      pl.visible = hot;
      if (hot) anyHot = true;
    }
    if (!anyHot) {
      _heatActive = false;
      _clearHeatRT();
    }
    } catch (err) { _heatDisable('_updateHeatAccumulation', err); }
  }

  // Layer-1 ripple tick — advance/expand/fade each live splash. No allocation;
  // recycles dead slots. Owns its own dt clock so it stays decoupled from the
  // overlay timing. No-op under reduced motion (no splashes ever spawn).
  function _tickHeatSplashes() {
    if (_heatFailed || !_heatSplashMesh) return;
    try {
    const now = performance.now();
    let dt = (now - _heatSplashPrevMs) / 1000;
    _heatSplashPrevMs = now;
    if (dt <= 0) return;
    if (dt > 0.05) dt = 0.05;

    let dirty = false;
    for (let i = 0; i < _heatSplashCap; i++) {
      const s = _heatSplashPool[i];
      if (!s.alive) continue;
      dirty = true;
      s.age += dt;
      const t = s.age / s.life;
      if (t >= 1) {
        s.alive = false;
        _heatScratchS.setScalar(0);
        _heatScratchM.compose(_heatScratchV.set(0, 0, 0), _heatScratchQ.set(0, 0, 0, 1), _heatScratchS);
        _heatSplashMesh.setMatrixAt(i, _heatScratchM);
        continue;
      }
      const radius = s.maxR * (0.15 + 0.85 * t);   // expand outward
      const fade   = 1 - t;                          // fade quickly
      _heatScratchS.set(radius, radius, 1);
      _heatScratchM.compose(s.pos, s.quat, _heatScratchS);
      _heatSplashMesh.setMatrixAt(i, _heatScratchM);
      _heatScratchC.setRGB(s.col.r * fade, s.col.g * fade, s.col.b * fade);
      _heatSplashMesh.setColorAt(i, _heatScratchC);
    }
    if (dirty) {
      _heatSplashMesh.instanceMatrix.needsUpdate = true;
      if (_heatSplashMesh.instanceColor) _heatSplashMesh.instanceColor.needsUpdate = true;
    }
    } catch (err) { _heatDisable('_tickHeatSplashes', err); }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  BASS MODES (RESONANCE) — baked modal field + standing-wave particle cloud
  //  + listener pressure probe. Architecture rationale is in the shader-string
  //  block near the top of the module. Everything here is wrapped in _bwDisable
  //  so a bad GPU / RT / shader disables the subsystem without ever breaking
  //  rebuild() or the core scene. Per the visual tenet, this is the ONLY part
  //  of the overlay that carries colour, light, and motion — the room shell and
  //  the listener marker stay neutral wireframe.
  // ════════════════════════════════════════════════════════════════════════

  function _bwDisable(where, err) {
    if (!_bwFailed) {
      _bwFailed = true;
      try { console.warn('[Room3D] Bass Modes field disabled after error in ' + where + ':', err); } catch (e) {}
    }
    _bwParticles = null;
    _bwListenerHalo = null;
  }

  // Hermite smoothstep — CPU twin of GLSL smoothstep, for the particle/probe
  // colour ramp and the bass-trap cooling so they agree with the bake shader.
  function _bwSmoothstep(e0, e1, x) {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }

  // Local-metre ceiling height at (x,z) — an exact mirror of rebuild()'s
  // ceilingYAt(), re-derived here because renderAnalysisOverlays is a sibling of
  // rebuild() (its const isSlanted/ceilingYAt are out of scope). Used to lay the
  // ceiling field plane on the real roofline and to keep particles under it.
  function _bwCeilingY(room, x, z) {
    const hW = room.width_m / 2, hL = room.length_m / 2, hH = room.height_m / 2;
    const type = room.ceiling_type;
    if (type !== 'slanted' && type !== 'gable') return hH;
    const lowH = Math.min(room.ceiling_height_secondary_m ?? room.height_m, room.height_m);
    const lowY = -hH + lowH, highY = hH;
    if (type === 'slanted') {
      let t;
      switch (room.ceiling_slant_direction || 'left_to_right') {
        case 'right_to_left': t = 1 - (x + hW) / room.width_m;  break;
        case 'front_to_back': t = 1 - (z + hL) / room.length_m; break;
        case 'back_to_front': t = (z + hL) / room.length_m;     break;
        default:              t = (x + hW) / room.width_m;       // left_to_right
      }
      return lowY + t * (highY - lowY);
    }
    // gable
    const distRatio = (room.ceiling_gable_axis || 'depth') === 'depth'
      ? Math.abs(x) / hW
      : Math.abs(z) / hL;
    return highY - distRatio * (highY - lowY);
  }

  // Encode the ceiling profile as the shader uniform set shared by the bake and
  // display materials. lowFrac = low ceiling height / room height.
  function _bwCeilingUniforms(room) {
    const slantCode = { left_to_right: 0, right_to_left: 1, front_to_back: 2, back_to_front: 3 };
    const lowH = Math.min(room.ceiling_height_secondary_m ?? room.height_m, room.height_m);
    return {
      type:       room.ceiling_type === 'slanted' ? 1 : room.ceiling_type === 'gable' ? 2 : 0,
      slantDir:   slantCode[room.ceiling_slant_direction] ?? 0,
      gableDepth: (room.ceiling_gable_axis || 'depth') === 'depth' ? 1 : 0,
      lowFrac:    Math.max(0, Math.min(1, (room.height_m ? lowH / room.height_m : 1))),
    };
  }

  // Device tier — modest atlas + fewer particles on iPad / coarse pointers.
  // reduced-motion still builds the field + cloud (frozen), consistent with the
  // rest of the engine's reduced-motion behaviour.
  function _bwTierConfig() {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const low = reduced
      || window.matchMedia('(pointer: coarse)').matches
      || window.matchMedia('(max-width: 900px)').matches;
    return {
      reduced,
      low,
      rtSize: low ? 256 : 512,                  // baked-field atlas resolution
      grid:   low ? [12, 6, 12] : [20, 8, 20],  // interior particle grid (x,y,z) → 864 / 3200
    };
  }

  // CPU twin of the bake shader's pressure sum — SIGNED (no abs) so neighbouring
  // antinodes oscillate in opposite directions, which is what reads as a
  // standing wave. Normalised to ~[-1,1] by total mode weight. nx/ny/nz are
  // 0..1 room coords. Predictive model: not a physical measurement.
  function _bwSignedPressure(nx, ny, nz, modes) {
    let pressure = 0, totalWeight = 0.001;
    for (let i = 0; i < modes.length; i++) {
      const m = modes[i];
      if (m.w <= 0) continue;
      pressure += m.w
        * Math.cos(m.p * Math.PI * nz)
        * Math.cos(m.q * Math.PI * nx)
        * Math.cos(m.r * Math.PI * ny);
      totalWeight += m.w;
    }
    return pressure / totalWeight;
  }

  // Per-wall bass-trap cooling — CPU twin of the bake shader's localTraps block,
  // so the particles and the probe cool at treated corners exactly as the field.
  function _bwTrapCool(nx, nz, traps) {
    const frontProx = _bwSmoothstep(0.5, 0.0, nz);
    const rearProx  = _bwSmoothstep(0.5, 1.0, nz);
    const leftProx  = _bwSmoothstep(0.5, 0.0, nx);
    const rightProx = _bwSmoothstep(0.5, 1.0, nx);
    const localTraps = Math.max(
      Math.max(frontProx * traps.f, rearProx * traps.r),
      (leftProx + rightProx) * traps.side
    );
    return 1.0 - localTraps * 0.35;
  }

  // Map a 0..1 pressure magnitude to the resonance ramp (void → purple #7C3AED →
  // pink #FF107A → white-hot), writing into the supplied THREE.Color. Mirrors
  // the display fragment's mix chain so JS-coloured particles/halo match the
  // GPU-coloured field surfaces.
  function _bwRampColor(t, out) {
    const mix = (a, b, k) => [a[0] + (b[0]-a[0])*k, a[1] + (b[1]-a[1])*k, a[2] + (b[2]-a[2])*k];
    const voidC  = [0.020, 0.010, 0.050];
    const purple = [0.486, 0.227, 0.929];   // #7C3AED
    const pink   = [1.000, 0.063, 0.478];   // #FF107A
    const hot    = [1.000, 0.850, 0.950];   // white-hot antinode core
    let c = mix(voidC,  purple, _bwSmoothstep(0.00, 0.28, t));
    c     = mix(c,      pink,   _bwSmoothstep(0.28, 0.62, t));
    c     = mix(c,      hot,    _bwSmoothstep(0.62, 1.00, t));
    return out.setRGB(c[0], c[1], c[2]);
  }

  // Lazily create the persistent bake machinery: the dedicated atlas render
  // target, an ortho scene with six per-surface bake quads, and its camera.
  // These survive rebuild() (only their uniforms + the atlas contents change).
  function _ensureBwTargets() {
    const tier = _bwTier;
    if (_bwRT && _bwRT.width !== tier.rtSize) { _bwRT.dispose(); _bwRT = null; }
    if (!_bwRT) {
      _bwRT = new THREE.WebGLRenderTarget(tier.rtSize, tier.rtSize, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      });
    }
    if (!_bwRtScene) {
      _bwRtScene = new THREE.Scene();
      _bwRtCam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);   // [0,1]² → atlas
      const COLS = 3, ROWS = 2, cw = 1 / COLS, ch = 1 / ROWS;
      _bwBakeQuads = [];
      for (const key in _HEAT_SURF_INDEX) {
        const idx = _HEAT_SURF_INDEX[key];
        const colN = idx % COLS, rowN = Math.floor(idx / COLS);
        const mat = new THREE.ShaderMaterial({
          depthTest: false, depthWrite: false,
          vertexShader: _BW_BAKE_VERT, fragmentShader: _BW_BAKE_FRAG,
          uniforms: {
            uSurf:       { value: idx },
            uModes:      { value: [] },     // filled in _bakeBassField before each render
            uBassTrapsF: { value: 0 },
            uBassTrapsR: { value: 0 },
            uBtSide:     { value: 0 },
            uCeilType:   { value: 0 },
            uSlantDir:   { value: 0 },
            uGableDepth: { value: 1 },
            uLowFrac:    { value: 1 },
          },
        });
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(cw, ch), mat);
        quad.position.set(colN * cw + cw / 2, rowN * ch + ch / 2, 0);
        _bwRtScene.add(quad);
        _bwBakeQuads.push(quad);
      }
    }
  }

  // Bake the 8-mode standing-wave pressure into the atlas — ONE off-screen draw
  // (six small quads) per rebuild. After this, the displayed field is just a
  // texture lookup per fragment, never the old per-frame per-fragment mode loop.
  function _bakeBassField(uBwModes, traps, ceil) {
    if (_bwFailed) return;
    try {
      _ensureBwTargets();
      for (const quad of _bwBakeQuads) {
        const u = quad.material.uniforms;
        u.uModes.value      = uBwModes;
        u.uBassTrapsF.value = traps.f;
        u.uBassTrapsR.value = traps.r;
        u.uBtSide.value     = traps.side;
        u.uCeilType.value   = ceil.type;
        u.uSlantDir.value   = ceil.slantDir;
        u.uGableDepth.value = ceil.gableDepth;
        u.uLowFrac.value    = ceil.lowFrac;
      }
      const prevTarget    = renderer.getRenderTarget();
      const prevAutoClear = renderer.autoClear;
      const prevClear     = new THREE.Color();
      renderer.getClearColor(prevClear);
      const prevAlpha     = renderer.getClearAlpha();
      renderer.setRenderTarget(_bwRT);
      renderer.setClearColor(0x000000, 1);
      renderer.autoClear = true;
      renderer.clear(true, false, false);
      renderer.render(_bwRtScene, _bwRtCam);
      renderer.setRenderTarget(prevTarget);
      renderer.autoClear = prevAutoClear;
      renderer.setClearColor(prevClear, prevAlpha);
    } catch (err) { _bwDisable('_bakeBassField', err); }
  }

  // Build the six boundary display planes that sample the baked atlas through
  // the purple→pink→white ramp. Local-space quads with identity transform (the
  // vertex position IS the UV-mapped coordinate), mirroring the heat shell.
  // Live in roomGroup → freed by the next rebuild's disposal traverse.
  function _buildBwFieldPlanes(room, isFocBW, ceil) {
    if (_bwFailed || !_bwRT) return;
    try {
      const hW = room.width_m / 2, hH = room.height_m / 2, hL = room.length_m / 2;
      const fY = -hH + 0.03, INSET = 0.025;   // sit just inside the wireframe, above the heat floor plane
      // Floor + four walls are flat rectangles. Walls run full height; the
      // display shader discards fragments above the sloped ceiling, so a
      // slanted/gable roof trims them to the room silhouette automatically.
      const planeDefs = [
        ['floor',   [[-hW, fY, -hL], [hW, fY, -hL], [hW, fY, hL], [-hW, fY, hL]]],
        ['front',   [[-hW, -hH, -hL + INSET], [hW, -hH, -hL + INSET], [hW, hH, -hL + INSET], [-hW, hH, -hL + INSET]]],
        ['back',    [[-hW, -hH, hL - INSET], [hW, -hH, hL - INSET], [hW, hH, hL - INSET], [-hW, hH, hL - INSET]]],
        ['left',    [[-hW + INSET, -hH, -hL], [-hW + INSET, -hH, hL], [-hW + INSET, hH, hL], [-hW + INSET, hH, -hL]]],
        ['right',   [[hW - INSET, -hH, -hL], [hW - INSET, -hH, hL], [hW - INSET, hH, hL], [hW - INSET, hH, -hL]]],
      ];

      // Ceiling plane(s) — laid on the REAL roofline so the field's ceiling
      // surface follows the slope. cy() insets each corner just below the
      // wireframe ceiling beams. Flat = one quad; slanted = one tilted quad;
      // gable = two quads meeting at the ridge (split on the ridge axis).
      const cy = (x, z) => _bwCeilingY(room, x, z) - 0.015;
      const ck = (x, z) => [x, cy(x, z), z];
      if (ceil.type === 2) {                       // gable
        if (ceil.gableDepth) {                     // ridge along Z (depth) at x = 0
          planeDefs.push(['ceiling', [ck(-hW, -hL), ck(0, -hL), ck(0, hL), ck(-hW, hL)]]);
          planeDefs.push(['ceiling', [ck(0, -hL), ck(hW, -hL), ck(hW, hL), ck(0, hL)]]);
        } else {                                   // ridge along X (width) at z = 0
          planeDefs.push(['ceiling', [ck(-hW, -hL), ck(hW, -hL), ck(hW, 0), ck(-hW, 0)]]);
          planeDefs.push(['ceiling', [ck(-hW, 0), ck(hW, 0), ck(hW, hL), ck(-hW, hL)]]);
        }
      } else {                                     // flat or slanted — single quad
        planeDefs.push(['ceiling', [ck(-hW, -hL), ck(hW, -hL), ck(hW, hL), ck(-hW, hL)]]);
      }

      const COLS = 3, ROWS = 2, cw = 1 / COLS, ch = 1 / ROWS;
      const cellRect = (idx) => [(idx % COLS) * cw, Math.floor(idx / COLS) * ch, cw, ch];
      const buildQuad = (c) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
          ...c[0], ...c[1], ...c[2],
          ...c[0], ...c[2], ...c[3],
        ]), 3));
        return g;
      };
      _bwPlanes = [];
      for (const [key, corners] of planeDefs) {
        const idx = _HEAT_SURF_INDEX[key];
        const mat = new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          vertexShader: _BW_FIELD_VERT, fragmentShader: _BW_FIELD_FRAG,
          uniforms: {
            uField:      { value: _bwRT.texture },
            uHalf:       { value: new THREE.Vector3(hW, hH, hL) },
            uSurf:       { value: idx },
            uCell:       { value: new THREE.Vector4(...cellRect(idx)) },
            uOpacity:    { value: isFocBW ? 0.62 : 0.34 },
            uCeilType:   { value: ceil.type },
            uSlantDir:   { value: ceil.slantDir },
            uGableDepth: { value: ceil.gableDepth },
            uLowFrac:    { value: ceil.lowFrac },
          },
        });
        const mesh = new THREE.Mesh(buildQuad(corners), mat);
        mesh.frustumCulled = false;
        mesh.renderOrder = 4;            // after the grid (3), under the ball overlays
        mesh.userData.isBwPlane = true;
        roomGroup.add(mesh);
        _bwPlanes.push(mesh);
      }
    } catch (err) { _bwDisable('_buildBwFieldPlanes', err); }
  }

  // Scatter the interior standing-wave particle cloud. Each particle's signed
  // modal amplitude (A) is sampled ONCE here; the per-frame work in
  // _animateBassModes is only the sin(t·w) vertical excursion. Particles thrash
  // at antinodes, sit dead-still (and hidden) on null planes, never travel — the
  // standing-wave behaviour that keeps Bass Modes distinct from Reflections.
  function _buildBwParticles(room, modes, traps) {
    if (_bwFailed) return;
    try {
      _bwParticles = null; _bwParticleN = 0;
      if (!modes.length) return;
      const [gx, gy, gz] = _bwTier.grid;
      const hW = room.width_m / 2, hH = room.height_m / 2, hL = room.length_m / 2;
      const INSET = 0.14;                 // keep particles in the interior air, off the walls
      const N = gx * gy * gz;
      const base = new Float32Array(N * 3);
      const amp  = new Float32Array(N);
      const size = new Float32Array(N);
      const geo  = new THREE.SphereGeometry(1, 6, 6);
      const uRadius = Math.max(0.6, Math.sqrt(room.width_m * room.width_m + room.length_m * room.length_m) * 0.12);
      const mat  = new THREE.ShaderMaterial({
        uniforms: {
          uRayO:      { value: new THREE.Vector3(0, -9999, 0) },  // off-screen until first pointermove
          uRayD:      { value: new THREE.Vector3(0, 1, 0) },
          uHover:     { value: 0 },                                // bumped on pointermove, decayed each frame
          uRadius:    { value: uRadius },
          uSwell:     { value: 1.4 },
          uBaseScale: { value: 0.95 },                             // matches the prior additive base brightness
        },
        vertexShader: _BW_PARTICLE_VERT,
        fragmentShader: _BW_PARTICLE_FRAG,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, N);
      mesh.frustumCulled = false;
      mesh.userData.isBwParticles = true;
      const col = new THREE.Color();
      let n = 0;
      for (let ix = 0; ix < gx; ix++) {
        for (let iy = 0; iy < gy; iy++) {
          for (let iz = 0; iz < gz; iz++) {
            const fx = gx > 1 ? ix / (gx - 1) : 0.5;
            const fy = gy > 1 ? iy / (gy - 1) : 0.5;
            const fz = gz > 1 ? iz / (gz - 1) : 0.5;
            // local centred position, inset from the walls
            const x = (fx - 0.5) * (room.width_m  - 2 * INSET);
            const y = (fy - 0.5) * (room.height_m - 2 * INSET);
            const z = (fz - 0.5) * (room.length_m - 2 * INSET);
            // true 0..1 room coords at the particle for the pressure sample
            const cnx = (x + hW) / room.width_m;
            const cny = (y + hH) / room.height_m;
            const cnz = (z + hL) / room.length_m;
            const a   = _bwSignedPressure(cnx, cny, cnz, modes) * _bwTrapCool(cnx, cnz, traps);
            const magnitude = Math.abs(a);
            base[n * 3] = x; base[n * 3 + 1] = y; base[n * 3 + 2] = z;
            amp[n] = a;
            // Antinodes glow + thrash; near-null particles collapse to scale 0
            // (additive black would vanish anyway, but hiding saves overdraw).
            // Anything above the sloped ceiling is outside the room → hidden.
            const aboveCeiling = y > _bwCeilingY(room, x, z) - 0.05;
            const radius = (magnitude < 0.06 || aboveCeiling) ? 0 : (0.018 + magnitude * 0.055);
            size[n] = radius;
            _bwScratchS.setScalar(radius);
            _bwScratchM.compose(_bwScratchV.set(x, y, z), _bwScratchQ.set(0, 0, 0, 1), _bwScratchS);
            mesh.setMatrixAt(n, _bwScratchM);
            // Cap the bright end so the antinode particle arcs across the top stop
            // blowing out: clamp the ramp input (brightest read hot-pink, not pure
            // white) and scale the emissive down so they feed less into the shared
            // bloom. Applied at the call site so the listener probe's _bwRampColor
            // (shared) is untouched. Null particles are already hidden (radius 0).
            _bwRampColor(Math.min(magnitude, 0.82), col);
            col.multiplyScalar(0.70);
            mesh.setColorAt(n, col);
            n++;
          }
        }
      }
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      roomGroup.add(mesh);
      _bwParticles    = mesh;
      _bwParticleN    = N;
      _bwParticleBase = base;
      _bwParticleAmp  = amp;
      _bwParticleSize = size;
      _bwAddHover();   // attach the pointer-pressure listener while Bass Modes is active
    } catch (err) { _bwDisable('_buildBwParticles', err); _bwParticles = null; }
  }

  // Pointer-pressure hover: add/remove ONE pointermove listener (covers mouse,
  // touch, pen). On move, cast a single ray from the pointer through the camera
  // and feed origin/direction to the particle shader + bump uHover (which decays
  // each frame in _animateBassModes). The handler reads the LIVE _bwParticles
  // material, so it survives rebuilds without re-binding logic changing.
  function _bwAddHover() {
    if (_bwHoverOn || !renderer || !renderer.domElement) return;
    if (!_bwHoverRay) _bwHoverRay = new THREE.Raycaster();
    _bwHoverHandler = function (e) {
      const m = _bwParticles && _bwParticles.material;
      if (!m || !m.uniforms || !m.uniforms.uRayO) return;
      const rect = renderer.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      _bwPointerNDC.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -(((e.clientY - rect.top) / rect.height) * 2 - 1)
      );
      _bwHoverRay.setFromCamera(_bwPointerNDC, camera);
      m.uniforms.uRayO.value.copy(_bwHoverRay.ray.origin);
      m.uniforms.uRayD.value.copy(_bwHoverRay.ray.direction);
      m.uniforms.uHover.value = 1.0;
    };
    renderer.domElement.addEventListener('pointermove', _bwHoverHandler, { passive: true });
    _bwHoverOn = true;
  }
  function _bwRemoveHover() {
    if (!_bwHoverOn) return;
    try { renderer.domElement.removeEventListener('pointermove', _bwHoverHandler); } catch (e) {}
    _bwHoverHandler = null;
    _bwHoverOn = false;
  }

  // Listener pressure probe — the hero beat. CPU-sample the seat's modal
  // pressure, float a sound-layer glow halo there (hot pink = boom, cool purple
  // = null) and, when focused, a readout naming the dominant mode at the seat
  // and whether it's a boom or a null. The structural listener sphere stays
  // neutral wireframe; this halo is the sound's footprint at the seat.
  function _buildBwListenerProbe(room, modes, traps, showReadout) {
    if (_bwFailed) return;
    try {
      _bwListenerHalo = null;
      if (!modes.length) return;
      const isStudio = room.room_type === 'studio';
      const seat = room.seating_type || 'sofa';
      // Seat offsets — same values the listener station uses to place the sphere.
      const sphZ = isStudio ? 0.20 : (seat === 'lounge' ? 0.38 : 0.28);
      const sphY = isStudio ? 1.22 : (seat === 'lounge' ? 1.00 : 0.96);
      const off  = room.listener_offset_m || 0;
      const hW = room.width_m / 2, hH = room.height_m / 2, hL = room.length_m / 2;
      const lx = off + off;   // matches the listener station's x (offsetX + listener_offset_m)
      const ly = -hH + sphY;
      const lz = -hL + room.listener_front_m + sphZ;
      // normalised room coords at the seat (clamped — a large offset can push outside)
      const cnx = Math.max(0, Math.min(1, (lx + hW) / room.width_m));
      const cny = Math.max(0, Math.min(1, (ly + hH) / room.height_m));
      const cnz = Math.max(0, Math.min(1, (lz + hL) / room.length_m));
      const pressure = Math.abs(_bwSignedPressure(cnx, cny, cnz, modes)) * _bwTrapCool(cnx, cnz, traps);
      const norm = Math.min(1, pressure * 1.3);

      const col = new THREE.Color();
      _bwRampColor(norm, col);
      const haloMat = new THREE.MeshBasicMaterial({
        color: col, transparent: true,
        opacity: 0.30 + 0.5 * norm,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.30, 16, 12), haloMat);
      halo.position.set(lx, ly, lz);
      halo.frustumCulled = false;
      halo.userData.isBwListenerHalo = true;
      roomGroup.add(halo);
      _bwListenerHalo = halo;

      if (showReadout) {
        // Dominant mode AT THE SEAT — the mode contributing the most |pressure|
        // at the listening position, so the readout names what the listener hears.
        let domF = 0, domContrib = -1;
        for (const m of modes) {
          const contrib = Math.abs(
            m.w
            * Math.cos(m.p * Math.PI * cnz)
            * Math.cos(m.q * Math.PI * cnx)
            * Math.cos(m.r * Math.PI * cny)
          );
          if (contrib > domContrib) { domContrib = contrib; domF = m.freq_hz; }
        }
        const verdict = pressure >= 0.45 ? 'boom at your seat'
                      : pressure <= 0.18 ? 'null at your seat'
                      : 'at your seat';
        const lbl = _makeLabelSprite(`${Math.round(domF || 0)} Hz · ${verdict}`, '#f8fafc');
        lbl.position.set(lx, ly + 0.5, lz);
        roomGroup.add(lbl);
      }
    } catch (err) { _bwDisable('_buildBwListenerProbe', err); _bwListenerHalo = null; }
  }

  // Per-frame particle animation — the ONLY per-frame cost of the overlay. Each
  // live particle vibrates in place: y = base.y + sin(t·w)·A. Shared phase +
  // signed A = a standing wave (antinodes opposed across nulls). No travel, no
  // geometry alloc. Frozen (early return) under reduced motion — particles stay
  // at their base positions, consistent with the baked field never moving.
  function _animateBassModes(now) {
    if (_bwFailed || !_bwParticles) return;
    try {
      // Hover aura decay — runs every frame (user-driven, allowed under reduced
      // motion). The swell/colour is in-shader from uHover, so it works even when
      // the autonomous oscillation below is frozen.
      const _u = _bwParticles.material && _bwParticles.material.uniforms;
      if (_u && _u.uHover) _u.uHover.value *= 0.90;
      if (_bwReduced) return;   // freeze ONLY the autonomous oscillation
      const phase = Math.sin(now * 0.001 * _bwOscRate);
      const GAIN = 0.12;   // metres of peak vertical excursion at a full antinode
      const base = _bwParticleBase, amp = _bwParticleAmp, size = _bwParticleSize;
      for (let i = 0; i < _bwParticleN; i++) {
        const radius = size[i];
        if (radius <= 0) continue;   // hidden null-plane particle — leave collapsed
        _bwScratchS.setScalar(radius);
        _bwScratchM.compose(
          _bwScratchV.set(base[i * 3], base[i * 3 + 1] + phase * amp[i] * GAIN, base[i * 3 + 2]),
          _bwScratchQ.set(0, 0, 0, 1),
          _bwScratchS
        );
        _bwParticles.setMatrixAt(i, _bwScratchM);
      }
      _bwParticles.instanceMatrix.needsUpdate = true;
    } catch (err) { _bwDisable('_animateBassModes', err); }
  }

  // Drop Bass Modes refs each rebuild. The planes / particles / halo live in
  // roomGroup (freed by the disposal traverse); the bake target + bake scene are
  // persistent (kept across rebuilds, like the heat targets) so only the closure
  // refs reset here.
  function _teardownBassField() {
    _bwRemoveHover();   // drop the pointer-pressure listener — no global leak
    _bwPlanes = [];
    _bwParticles = null;
    _bwParticleN = 0;
    _bwParticleBase = _bwParticleAmp = _bwParticleSize = null;
    _bwListenerHalo = null;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  SBIR ENERGY STREAMS — interference as energy colliding and being eaten.
  //  Dense glowing instanced particles stream speaker → boundary → back (the
  //  quarter-wave round trip); on the return they spiral into a suckout at the
  //  speaker (the cancellation devouring them) while a flare pops at the wall
  //  (reinforcement). Stacked nulls merge into one violent vortex; the seat
  //  vortex is the "your bass dies here" payoff. Treated boundaries flow calm
  //  teal with no suckout — the hole heals. Built from the per-boundary null
  //  model in the SBIR block; reuses the InstancedMesh + trail + tier patterns
  //  from the burst swarm. Frozen under reduced motion. DISTINCT motion:
  //  round-trip collision/annihilation — not Reflections' one-way travel, not
  //  Bass Modes' in-place oscillation.
  // ════════════════════════════════════════════════════════════════════════
  function _sbirTierConfig() {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const low = reduced
      || window.matchMedia('(pointer: coarse)').matches
      || window.matchMedia('(max-width: 900px)').matches;
    return { reduced, particles: low ? 260 : 760, trailLen: low ? 0 : 3 };
  }

  function _teardownSbirStreams() {
    _sbirParticles = null;
    _sbirTrails    = null;
    _sbirTrailLen  = 0;
    _sbirPool      = [];
    _sbirStreams   = [];
    _sbirVortices  = [];
    _sbirFlares    = [];
  }

  function _buildSbirStreams(streams, vortices, flares, tier) {
    try {
      _teardownSbirStreams();
      _sbirStreams = streams;

      // Vortex rings — additive torus; empty centre = dark core, pink/teal rim.
      _sbirVortices = vortices.map((v) => {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(v.seat ? 0.34 : 0.16, v.seat ? 0.055 : 0.03, 8, 28),
          new THREE.MeshBasicMaterial({ color: v.color, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false })
        );
        ring.position.copy(v.center);
        ring.rotation.x = -Math.PI / 2;
        ring.frustumCulled = false;
        ring.userData.isSbirFx = true;
        roomGroup.add(ring);
        return { ring, severity: v.severity, throbW: v.throbW, seat: !!v.seat };
      });

      // Reinforcement flares — bright additive sphere at each boundary impact.
      _sbirFlares = flares.map((f) => {
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(f.treated ? 0.05 : 0.08, 8, 6),
          new THREE.MeshBasicMaterial({ color: f.treated ? 0x00C1B2 : 0xFF107A, transparent: true,
            opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
        );
        m.position.copy(f.pos);
        m.frustumCulled = false;
        m.userData.isSbirFx = true;
        roomGroup.add(m);
        return { mesh: m, throbW: f.throbW, treated: f.treated };
      });

      // Particle swarm — one InstancedMesh, additive, instanceColor carries
      // brightness. Distributed round-robin across the streams.
      const N = tier.particles, nS = streams.length;
      if (nS === 0 || N === 0) return;
      _sbirParticles = new THREE.InstancedMesh(
        new THREE.SphereGeometry(1, 6, 5),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1,
          blending: THREE.AdditiveBlending, depthWrite: false }),
        N
      );
      _sbirParticles.frustumCulled = false;
      _sbirParticles.userData.isSbirFx = true;
      _seedBurstInstanced(_sbirParticles, N);
      roomGroup.add(_sbirParticles);

      _sbirTrailLen = tier.trailLen;
      if (_sbirTrailLen > 0) {
        _sbirTrails = new THREE.InstancedMesh(
          new THREE.SphereGeometry(1, 5, 4),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1,
            blending: THREE.AdditiveBlending, depthWrite: false }),
          N * _sbirTrailLen
        );
        _sbirTrails.frustumCulled = false;
        _sbirTrails.userData.isSbirFx = true;
        _seedBurstInstanced(_sbirTrails, N * _sbirTrailLen);
        roomGroup.add(_sbirTrails);
      }

      _sbirPool = [];
      for (let i = 0; i < N; i++) {
        const sIdx = i % nS;
        const s = streams[sIdx];
        // A perpendicular offset → the stream reads as a tube, not a line.
        const dir = new THREE.Vector3().subVectors(s.b, s.a);
        if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
        dir.normalize();
        const ref = Math.abs(dir.y) < 0.9 ? _sbirUpY : _sbirRightX;
        const perp1 = new THREE.Vector3().crossVectors(dir, ref).normalize();
        const perp2 = new THREE.Vector3().crossVectors(dir, perp1).normalize();
        const ang = Math.random() * Math.PI * 2;
        const rad = 0.02 + Math.random() * 0.06;
        _sbirPool.push({
          sIdx,
          phase0: Math.random(),
          speed:  0.8 + Math.random() * 0.5,
          radius: 0.025 + Math.random() * 0.03,
          ox: (perp1.x * Math.cos(ang) + perp2.x * Math.sin(ang)) * rad,
          oy: (perp1.y * Math.cos(ang) + perp2.y * Math.sin(ang)) * rad,
          oz: (perp1.z * Math.cos(ang) + perp2.z * Math.sin(ang)) * rad,
          swirl: Math.random() * Math.PI * 2,
        });
      }
    } catch (err) {
      try { console.warn('[Room3D] SBIR streams disabled:', err); } catch (e) {}
      _teardownSbirStreams();
    }
  }

  function _animateSbirStreams(now) {
    if (!_sbirParticles && !_sbirVortices.length && !_sbirFlares.length) return;
    try {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const tsec = now * 0.001;
      const period = WAVE_CYCLE_S;
      const N = (_sbirParticles && _sbirStreams.length) ? _sbirPool.length : 0;
      const trailLen = _sbirTrailLen;
      for (let i = 0; i < N; i++) {
        const p = _sbirPool[i];
        const s = _sbirStreams[p.sIdx];
        const phase = reduced ? p.phase0 : ((tsec / period * p.speed + p.phase0) % 1.0);
        const out = phase < 0.5;
        const leg = out ? phase * 2.0 : (phase - 0.5) * 2.0;   // 0..1 within the leg
        if (out) _sbirPos.copy(s.a).lerp(s.b, leg);
        else     _sbirPos.copy(s.b).lerp(s.a, leg);
        // Pinch the tube to a point at each endpoint (0 at a & b, full mid-flight).
        const pinch = Math.sin(phase * Math.PI);
        _sbirPos.x += p.ox * pinch; _sbirPos.y += p.oy * pinch; _sbirPos.z += p.oz * pinch;

        let snuff = 1.0;
        if (s.suck && !out && leg > 0.5) {
          // Return leg nearing the speaker → spiral into the suckout and fade
          // (the cancellation devouring the energy).
          const k = (leg - 0.5) / 0.5;             // 0..1 as it reaches the centre
          _sbirPos.lerp(s.suck, k * 0.9);
          const sw = p.swirl + (reduced ? 0 : tsec * 3.0);
          const swirlR = 0.10 * (1 - k);
          _sbirPos.x += Math.cos(sw) * swirlR;
          _sbirPos.z += Math.sin(sw) * swirlR;
          snuff = 1 - k;
        }

        const throb = reduced ? 0.85 : (0.6 + 0.4 * Math.sin(tsec * s.throbW + p.swirl));
        let bright = (s.treated ? 0.5 : 0.72) * snuff * throb;
        if (out && leg > 0.78) bright *= 1.4;            // reinforcement near the wall
        bright = Math.min(1, bright);
        const r = p.radius * (0.55 + 0.45 * snuff);
        _sbirScale.setScalar(r);
        _sbirM.compose(_sbirPos, _sbirQuat, _sbirScale);
        _sbirParticles.setMatrixAt(i, _sbirM);
        _sbirCol.setHex(s.color).multiplyScalar(bright);
        _sbirParticles.setColorAt(i, _sbirCol);

        if (trailLen > 0) {
          // Trail behind, along the leg's travel direction.
          if (out) _sbirV.subVectors(s.b, s.a).normalize();
          else     _sbirV.subVectors(s.a, s.b).normalize();
          for (let k = 0; k < trailLen; k++) {
            const ti = i * trailLen + k;
            const fade = 1 - (k + 1) / (trailLen + 1);
            _sbirPos2.copy(_sbirPos).addScaledVector(_sbirV, -(k + 1) * r * 1.8);
            _sbirScale.setScalar(r * fade * 0.8);
            _sbirM.compose(_sbirPos2, _sbirQuat, _sbirScale);
            _sbirTrails.setMatrixAt(ti, _sbirM);
            _sbirCol.setHex(s.color).multiplyScalar(bright * fade * 0.55);
            _sbirTrails.setColorAt(ti, _sbirCol);
          }
        }
      }
      if (_sbirParticles) {
        _sbirParticles.instanceMatrix.needsUpdate = true;
        if (_sbirParticles.instanceColor) _sbirParticles.instanceColor.needsUpdate = true;
      }
      if (_sbirTrails) {
        _sbirTrails.instanceMatrix.needsUpdate = true;
        if (_sbirTrails.instanceColor) _sbirTrails.instanceColor.needsUpdate = true;
      }

      // Vortex rings — throb at the null freq; bigger/brighter with severity.
      for (let v = 0; v < _sbirVortices.length; v++) {
        const vo = _sbirVortices[v];
        const throb = reduced ? 0.7 : (0.5 + 0.5 * Math.sin(tsec * vo.throbW));
        vo.ring.material.opacity = Math.min(0.95, (0.2 + 0.6 * vo.severity) * (0.55 + 0.45 * throb));
        vo.ring.scale.setScalar((vo.seat ? 1.0 : 0.9) + (0.35 + 0.5 * vo.severity) * throb);
      }

      // Reinforcement flares — pop on the round-trip period at each wall.
      for (let f = 0; f < _sbirFlares.length; f++) {
        const fl = _sbirFlares[f];
        const ph = reduced ? 0.5 : ((tsec / period) % 1.0);
        const flare = reduced ? 0.5 : Math.pow(Math.max(0, Math.sin(ph * Math.PI)), 2.5);
        fl.mesh.material.opacity = (fl.treated ? 0.22 : 0.55) * (reduced ? 0.6 : (0.25 + 0.75 * flare));
        fl.mesh.scale.setScalar(0.6 + 0.8 * (reduced ? 0.5 : flare));
      }
    } catch (err) {
      try { console.warn('[Room3D] SBIR stream anim disabled:', err); } catch (e) {}
      _teardownSbirStreams();
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  PEAKS & DIPS — volumetric modal-pressure SLAB. A separate lens on the same
  //  room modes as Bass Modes: ~10 stacked translucent horizontal layers from
  //  floor to speaker-cabinet top. Per-vertex steady-state modal pressure at the
  //  swept frequency is BAKED into an aPressure attribute (on build + on slider
  //  change, never per frame); the raw-GLSL shader ramps teal→purple and fades
  //  nulls to transparent. Static once baked → inherently reduced-motion-safe
  //  and cheap on iPad. DISTINCT from Bass Modes' oscillating particle cloud:
  //  this is a continuous translucent volume you scrub by frequency.
  // ════════════════════════════════════════════════════════════════════════
  function _teardownPeaksSlab() {
    if (_peaksSeat) {
      roomGroup.remove(_peaksSeat);
      _peaksSeat.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    }
    for (let i = 0; i < _peaksHalos.length; i++) {
      roomGroup.remove(_peaksHalos[i]);
      if (_peaksHalos[i].material) _peaksHalos[i].material.dispose();   // shared halo texture is cached, not disposed
    }
    _peaksHalos = [];
    _peaksLayers = [];
    _peaksMat = null;
    _peaksModes = [];
    _peaksDims = null;
    _peaksSeat = null;
  }

  // A horizontal vertex grid at height y, in roomGroup-local coords, with an
  // (initially zero) aPressure attribute the bake fills.
  function _buildPeaksGrid(y, GX, GZ, W, L) {
    const nx = GX + 1, nz = GZ + 1, count = nx * nz;
    const pos = new Float32Array(count * 3);
    let v = 0;
    for (let j = 0; j < nz; j++) {
      const z = -L / 2 + (j / GZ) * L;
      for (let i = 0; i < nx; i++) {
        const x = -W / 2 + (i / GX) * W;
        pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z; v++;
      }
    }
    const idx = [];
    for (let j = 0; j < GZ; j++) {
      for (let i = 0; i < GX; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const aAttr = new THREE.BufferAttribute(new Float32Array(count), 1);
    aAttr.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('aPressure', aAttr);
    geom.setIndex(idx);
    return { geom, pos, aPress: aAttr };
  }

  function _buildPeaksSlab(room) {
    try {
      _teardownPeaksSlab();
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const low = reduced
        || window.matchMedia('(pointer: coarse)').matches
        || window.matchMedia('(max-width: 900px)').matches;
      const NLAYERS = low ? 7 : 10;
      const GX = low ? 20 : 32, GZ = low ? 20 : 32;

      const W = room.width_m, H = room.height_m, L = room.length_m;
      const floorY = -H / 2;
      // Slab spans floor → speaker-cabinet top (fallback ~1.1 m above floor).
      const cabTop = Math.max(0.8, Math.min(1.4, (room.tweeter_height_m || 0.95) + 0.15));
      const slabTopY = floorY + Math.min(cabTop, H * 0.7);

      // Modes for this room, capped to the slider's top (240 Hz). Precompute the
      // speaker coupling per mode = Phi at each speaker (both drive the mode).
      // Predictive model: not a physical measurement
      const modeList = (window.MeasurelyAcoustics?.computeRoomModes(room, 15, 240)) || [];
      const offsetX = room.listener_offset_m || 0;
      const halfSep = (room.spk_spacing_m || 0) / 2;
      const tY = floorY + (room.tweeter_height_m || 0.95);
      const fwZ = -L / 2;
      const dF = Math.max(room.spk_front_m || 0.45, 0.05);
      const spk = [
        { x: offsetX - halfSep, y: tY, z: fwZ + dF },
        { x: offsetX + halfSep, y: tY, z: fwZ + dF },
      ];
      const phiAt = (p, q, r, x, y, z) =>
        Math.cos(p * Math.PI * ((z + L / 2) / L)) *
        Math.cos(q * Math.PI * ((x + W / 2) / W)) *
        Math.cos(r * Math.PI * ((y + H / 2) / H));
      _peaksModes = modeList.map(m => ({
        p: m.p, q: m.q, r: m.r, f: m.freq_hz,
        coupling: spk.reduce((acc, s) => acc + phiAt(m.p, m.q, m.r, s.x, s.y, s.z), 0),
      }));
      _peaksDims = { W, H, L };

      _peaksMat = new THREE.ShaderMaterial({
        vertexShader: _PEAKS_VERT, fragmentShader: _PEAKS_FRAG,
        uniforms: {
          uContrast: { value: 2.3 },             // higher → dips read as harder voids
          uNull:     { value: 0.30 },            // more of the low range goes transparent
          uOpacity:  { value: low ? 0.18 : 0.15 }, // a touch lower → headroom so stacks stay in-gamut (saturated, not clipped white)
        },
        transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });

      _peaksLayers = [];
      for (let li = 0; li < NLAYERS; li++) {
        const t = NLAYERS === 1 ? 0 : li / (NLAYERS - 1);
        const y = floorY + t * (slabTopY - floorY);
        const { geom, pos, aPress } = _buildPeaksGrid(y, GX, GZ, W, L);
        const mesh = new THREE.Mesh(geom, _peaksMat);
        mesh.frustumCulled = false;
        mesh.renderOrder = 3;
        mesh.userData.isPeaksLayer = true;
        roomGroup.add(mesh);
        _peaksLayers.push({ mesh, geom, pos, aPress });
      }
      _bakePeaksField(room);
    } catch (err) {
      try { console.warn('[Room3D] Peaks & dips disabled:', err); } catch (e) {}
      _teardownPeaksSlab();
    }
  }

  // Re-bake the per-vertex pressure at the current _peaksFreq across all layers
  // (normalised 0..1 over the whole slab) and refresh the seat readout. Called
  // on build + on slider change — NOT per frame.
  function _bakePeaksField(room) {
    if (!_peaksLayers.length || !_peaksDims) return;
    try {
      const { W, H, L } = _peaksDims;
      const PI = Math.PI;
      const f = _peaksFreq;
      const modes = _peaksModes;
      // Lorentzian resonance weight × speaker coupling, per mode at f.
      const mw = modes.map(m => {
        const gamma = Math.max(2, m.f * 0.06);     // ~Q 16 bandwidth
        const x = (f - m.f) / gamma;
        return m.coupling / (1 + x * x);
      });
      const M = modes.length;
      let gmax = 1e-6;
      for (let li = 0; li < _peaksLayers.length; li++) {
        const layer = _peaksLayers[li];
        const pos = layer.pos, arr = layer.aPress.array, n = arr.length;
        for (let vi = 0; vi < n; vi++) {
          const x = pos[vi * 3], y = pos[vi * 3 + 1], z = pos[vi * 3 + 2];
          const nzc = (z + L / 2) / L, nxc = (x + W / 2) / W, nyc = (y + H / 2) / H;
          let pr = 0;
          for (let mi = 0; mi < M; mi++) {
            const m = modes[mi];
            pr += mw[mi] * Math.cos(m.p * PI * nzc) * Math.cos(m.q * PI * nxc) * Math.cos(m.r * PI * nyc);
          }
          const a = Math.abs(pr);
          arr[vi] = a;
          if (a > gmax) gmax = a;
        }
      }
      // Pass 2: normalise + harvest the brightest points as halo-core candidates.
      const inv = 1 / gmax;
      const CORE_THRESH = 0.80;
      const cand = [];
      for (let li = 0; li < _peaksLayers.length; li++) {
        const arr = _peaksLayers[li].aPress.array;
        const pos = _peaksLayers[li].pos;
        for (let vi = 0; vi < arr.length; vi++) {
          const nv = arr[vi] * inv;
          arr[vi] = nv;
          if (nv > CORE_THRESH) cand.push({ x: pos[vi * 3], y: pos[vi * 3 + 1], z: pos[vi * 3 + 2], v: nv });
        }
        _peaksLayers[li].aPress.needsUpdate = true;
      }
      // Greedy spatial dedup → a few bold, distinct antinode cores (not hundreds
      // of adjacent verts). Tiered count; min separation scales with the room.
      cand.sort((a, b) => b.v - a.v);
      const coarse = window.matchMedia('(pointer: coarse)').matches
        || window.matchMedia('(max-width: 900px)').matches;
      const N = coarse ? 8 : 14;
      const minD = Math.max(0.45, Math.sqrt(W * W + L * L) * 0.10);
      const minD2 = minD * minD;
      const cores = [];
      for (let ci = 0; ci < cand.length && cores.length < N; ci++) {
        const c = cand[ci];
        let ok = true;
        for (let k = 0; k < cores.length; k++) {
          const dx = cores[k].x - c.x, dy = cores[k].y - c.y, dz = cores[k].z - c.z;
          if (dx * dx + dy * dy + dz * dz < minD2) { ok = false; break; }
        }
        if (ok) cores.push(c);
      }
      _buildPeaksHalos(cores, coarse);
      _updatePeaksSeat(room, mw, inv);
    } catch (err) {
      try { console.warn('[Room3D] Peaks bake failed:', err); } catch (e) {}
    }
  }

  // Quiet seat marker: is the listening position a peak or a dip at this freq?
  function _updatePeaksSeat(room, mw, inv) {
    if (_peaksSeat) {
      roomGroup.remove(_peaksSeat);
      _peaksSeat.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      _peaksSeat = null;
    }
    if (!room || !_showLabels) return;
    try {
      const { W, H, L } = _peaksDims;
      const PI = Math.PI;
      const floorY = -H / 2;
      const off = room.listener_offset_m || 0;
      const lx = off + off;   // matches the listener station's X (offsetX + listener_offset_m)
      const ly = floorY + Math.min((room.tweeter_height_m || 0.95), H - 0.1);   // ear height, inside the slab
      const _seat = room.seating_type || 'sofa';
      const lz = -L / 2 + (room.listener_front_m || 2.8) + (room.room_type === 'studio' ? 0.20 : (_seat === 'lounge' ? 0.38 : 0.28));
      const nzc = (lz + L / 2) / L, nxc = (lx + W / 2) / W, nyc = (ly + H / 2) / H;
      let pr = 0;
      for (let mi = 0; mi < _peaksModes.length; mi++) {
        const m = _peaksModes[mi];
        pr += mw[mi] * Math.cos(m.p * PI * nzc) * Math.cos(m.q * PI * nxc) * Math.cos(m.r * PI * nyc);
      }
      const seatP = Math.max(0, Math.min(1, Math.abs(pr) * inv));
      const grp = new THREE.Group();
      const col = new THREE.Color(0x00C1B2).lerp(new THREE.Color(0x7C3AED), seatP);
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 14, 10),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35 + 0.5 * seatP,
          blending: THREE.AdditiveBlending, depthWrite: false })
      );
      dot.position.set(lx, ly, lz);
      grp.add(dot);
      grp.userData.isPeaksSeat = true;
      roomGroup.add(grp);
      _peaksSeat = grp;
    } catch (err) { /* seat readout is optional — never block the slab */ }
  }

  // Soft-gaussian halo texture (white; tinted per-sprite via SpriteMaterial.color).
  // Cached and shared across all halos — never disposed per rebuild.
  function _peaksHaloTexture() {
    if (_peaksHaloTex) return _peaksHaloTex;
    const S = 64, data = new Uint8Array(S * S * 4), c = (S - 1) / 2;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = (x - c) / c, dy = (y - c) / c;
        const r = Math.sqrt(dx * dx + dy * dy);
        const g = Math.exp(-r * r * 3.2);                 // soft falloff
        const a = r > 1 ? 0 : Math.max(0, Math.min(1, g));
        const i = (y * S + x) * 4;
        data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = Math.round(a * 255);
      }
    }
    const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    _peaksHaloTex = tex;
    return tex;
  }

  // The slab's OWN glow — additive halo Sprites at the antinode cores. There is
  // NO post-processing bloom pass in the engine/consumers (render is a plain
  // renderer.render); "bloom" everywhere else is just additive blending. So the
  // glow must be self-provided, which also makes it mobile-proof. Sprites are
  // billboards positioned once per bake → no per-frame cost. World-sized so they
  // don't shrink/vanish with device-pixel-ratio; boosted on coarse/small screens
  // so they read boldly at phone canvas size. Saturated purple→magenta, never
  // white (carries the no-white-wash fix). Rebuilt each bake (freq change) and
  // freed by the rebuild traverse.
  function _buildPeaksHalos(cores, coarse) {
    for (let i = 0; i < _peaksHalos.length; i++) {
      roomGroup.remove(_peaksHalos[i]);
      if (_peaksHalos[i].material) _peaksHalos[i].material.dispose();
    }
    _peaksHalos = [];
    if (!cores || !cores.length || !_peaksDims) return;
    try {
      const { W, H, L } = _peaksDims;
      const diag = Math.sqrt(W * W + L * L + H * H);
      const sizeBoost = coarse ? 1.5 : 1.0;        // bolder on small screens (sprites are DPR-independent)
      const tex = _peaksHaloTexture();
      const purp = new THREE.Color(0x7C3AED), mag = new THREE.Color(0xB026FF);
      const col = new THREE.Color();
      for (let i = 0; i < cores.length; i++) {
        const core = cores[i];
        const t = Math.max(0, Math.min(1, (core.v - 0.80) / 0.20));   // purple → hot magenta with depth
        col.copy(purp).lerp(mag, t);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: tex, color: col, transparent: true,
          opacity: Math.min(0.95, 0.55 + 0.45 * core.v),
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        sp.position.set(core.x, core.y, core.z);
        const s = diag * 0.085 * (0.7 + core.v) * sizeBoost;   // world-sized: bold, DPR-independent
        sp.scale.set(s, s, 1);
        sp.userData.isPeaksHalo = true;
        roomGroup.add(sp);
        _peaksHalos.push(sp);
      }
    } catch (err) { /* halos are decorative — never block the slab */ }
  }

  const api = {
    update: rebuild,

    setMode(newMode) {
      _dbg("[Room3D] 🔄 setMode()", newMode);

      currentMode = newMode;

      if (newMode === "analysing") {
        analysisStart = performance.now();
        analysisPulse = 0;
        _dbg("[Room3D] ▶ analysisStart =", analysisStart);
      }

      if (newMode === "final") {
        // default dashboard overlays
        activeOverlays.clear();
        activeOverlays.add(OVERLAYS.FLOOR_REFLECTION);
        activeOverlays.add(OVERLAYS.SBIR);
        activeOverlays.add(OVERLAYS.SIDE_REFLECTIONS);
        activeOverlays.add(OVERLAYS.REAR_ENERGY);
        activeOverlays.add(OVERLAYS.COFFEE_TABLE);
        activeOverlays.add(OVERLAYS.CROWD);

      }

      rebuild();
    },

    setDisco(enabled) {
      _discoEnabled = !!enabled;
      rebuild();
    },

    setCrowd(enabled) {
      _crowdEnabled = !!enabled;
      rebuild();
    },

    setStage(newStage) {
      _dbg("[Room3D] 🎭 setStage()", newStage);
      renderStage = newStage;
      rebuild();
    },

    /**
     * Instantly swap the visible furniture to match the current room data.
     * Always forces "furnishings" stage so changes to room_type or speaker_type
     * are immediately visible without waiting for the wizard to advance a step.
     * @param {string} [typeHint] - optional hint ("studio"|"home") for logging
     */
    updateFurniture(typeHint) {
      _dbg("[Room3D] 🛋 updateFurniture()", typeHint ?? "");
      renderStage = "furnishings";
      rebuild();
    },

    resetView() {
      _dbg("[Room3D] 🔄 resetView()");
      focusedOverlay = null;
      activeOverlays.clear();
      rebuild();
    },

    /* ------------------------------------------
      TOUR CAMERA CONTROL
    ------------------------------------------ */
    focusOn(stepKey) {
      const views = {
        // "home" / "dimensions" / "placement" all share the global default
        home: { pos: DEFAULT_CAMERA.pos, look: DEFAULT_CAMERA.target },
        dimensions: { pos: DEFAULT_CAMERA.pos, look: DEFAULT_CAMERA.target },
        placement: { pos: DEFAULT_CAMERA.pos, look: DEFAULT_CAMERA.target },
        // Materials: slightly higher angle to see floor furniture
        materials: { pos: { x: 3.5, y: 6.0, z: 5.5 }, look: { x: 0, y: 0, z: 0 } }
      };

      const v = views[stepKey];
      if (!v) return;

      // Smooth camera lerp — ease-in-out-quad over 600 ms
      const FROM_POS = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
      const FROM_LOOK = { x: controls.target.x, y: controls.target.y, z: controls.target.z };
      const TO_POS = v.pos;
      const TO_LOOK = v.look;
      const DURATION = 600; // ms
      const t0 = performance.now();

      flyAnim = {
        tick(now) {
          const raw = Math.min((now - t0) / DURATION, 1);
          // Ease-in-out quad
          const t = raw < 0.5 ? 2 * raw * raw : -1 + (4 - 2 * raw) * raw;

          camera.position.set(
            FROM_POS.x + (TO_POS.x - FROM_POS.x) * t,
            FROM_POS.y + (TO_POS.y - FROM_POS.y) * t,
            FROM_POS.z + (TO_POS.z - FROM_POS.z) * t,
          );
          controls.target.set(
            FROM_LOOK.x + (TO_LOOK.x - FROM_LOOK.x) * t,
            FROM_LOOK.y + (TO_LOOK.y - FROM_LOOK.y) * t,
            FROM_LOOK.z + (TO_LOOK.z - FROM_LOOK.z) * t,
          );

          if (raw >= 1) flyAnim = null; // done
        }
      };
    },



    /* ------------------------------------------
      DIAGNOSTIC API (Updated)
    ------------------------------------------ */
    setOverlay(id, enabled = true, severity = 'info') {
      if (enabled) {
        activeOverlays.add(id);
      } else {
        activeOverlays.delete(id);
      }


      rebuild();
    },

    /**
     * focusIssue — sets the active diagnostic overlay state.
     *
     * NOTE: The name is historical and misleading. This function does NOT
     * move the camera. It only updates the overlay rendering state by
     * clearing activeOverlays, adding the requested id, and triggering a
     * rebuild(). For camera movement use focusOn(stepKey).
     *
     * @param {string|null} id     Overlay key from OVERLAYS, or null to clear all
     * @param {number}      score  Severity score (0–10) — drives some overlays' colour intensity
     *
     * The third positional `std` parameter (smoothness std-dev) was removed
     * along with the Smoothness overlay in May 2026 — callers may still pass
     * it for backwards compatibility, but it is now ignored.
     */
    focusIssue(id, score = 10) {
      _dbg("[Room3D] 🎯 focusIssue()", id, "score =", score);

      activeOverlays.clear();
      if (id) activeOverlays.add(id);   // null/falsy = clear all overlays, no rebuild artefact

      focusedOverlay = id ?? null;
      activeScore = score;

      rebuild();
    },

    togglePanelSimulation(enabled) {
      simulatePanels = enabled;
      rebuild();
    },

    highlight(target) {
      highlightTarget = target;
      rebuild();
    },

    /**
     * Live-resize the room.  For flat-ceiling rooms we directly scale the stored
     * mesh refs (no full rebuild — no flicker).  For slanted / gable ceilings the
     * geometry is custom so we fall back to a full rebuild.
     */
    setRoomWidth(meters) {
      const w = Math.max(1.5, Number(meters));
      _roomWidthOverride = w;
      if (_roomShell) {
        _roomShell.scale.x = w;
        if (_roomFloor) _roomFloor.scale.x = w;
        if (_roomGrid) _roomGrid.scale.x = w;
      } else {
        rebuild();
      }
      controls.target.set(0, 0, 0);
      controls.update();
    },

    setRoomLength(meters) {
      const l = Math.max(1.5, Number(meters));
      _roomLengthOverride = l;
      if (_roomShell) {
        _roomShell.scale.z = l;
        // Plane local-Y maps to world Z after -90° rotation, so scale.y = length
        if (_roomFloor) _roomFloor.scale.y = l;
        if (_roomGrid) _roomGrid.scale.z = l;
      } else {
        rebuild();
      }
      controls.target.set(0, 0, 0);
      controls.update();
    },

    /**
     * Live-resize the room height. Mirrors setRoomWidth/setRoomLength.
     * Flat ceilings with a captured shell ref scale in-place; slanted /
     * gable ceilings have custom geometry (vertex positions depend on
     * height non-uniformly), so they fall back to a full rebuild.
     *
     * NOTE: as of this commit `_roomShell` is never populated by the
     * fat-edge shell builder, so this function (like setRoomWidth /
     * setRoomLength) currently always takes the rebuild() path. The
     * disposal pass added to rebuild() makes that acceptable on the
     * hot path; if/when the shell ref is wired up the in-place branch
     * will activate automatically.
     */
    setRoomHeight(meters) {
      const h = Math.max(1.5, Number(meters));
      _roomHeightOverride = h;
      const data = getRoomData() || {};
      const ceilingType = (data.geometry || data).ceiling_type || 'flat';
      if (_roomShell && ceilingType === 'flat') {
        _roomShell.scale.y = h;
      } else {
        rebuild();
      }
      controls.target.set(0, 0, 0);
      controls.update();
    },

    getFocus() {
      return { id: focusedOverlay, score: activeScore };
    },

    /**
     * Enable / disable auto toe-in (speakers always face the listen station sphere).
     * When disabled, speakers use the toe_in_deg value from getRoomData().
     */
    setAutoToe(enabled) {
      _autoToe = Boolean(enabled);
      if (_autoToe) {
        _applyAutoToe();
      } else {
        // Restore static toe-in from room data
        const d = getRoomData() || {};
        const s = d.setup || d;
        const deg = s.toe_in_deg || 0;
        const rad = deg * Math.PI / 180;
        if (_spkMeshL) _spkMeshL.rotation.y = rad;
        if (_spkMeshR) _spkMeshR.rotation.y = -rad;
      }
    },

    /** Returns the current auto-toe angle in degrees (left speaker used as reference). */
    getToeAngleDeg() {
      return Math.round(Math.abs(_autoToeAngle) * 180 / Math.PI);
    },

    startAutoSpin() {
      controls.autoRotate = true;
    },

    stopAutoSpin() {
      controls.autoRotate = false;
    },

    /**
     * Set the auto-spin angular rate. Three.js uses 2π/3600 × speed rad/frame
     * at 60 fps, so the engine default of 4 turns the room 360° in 15 s; a
     * value of 1 stretches that to 60 s. Used by tools/record.html to slow
     * the orbit for marketing captures; safe to call any time, takes effect
     * on the next frame.
     */
    setSpinSpeed(speed) {
      controls.autoRotateSpeed = Math.max(0, Number(speed) || 0);
    },

    flyby(onDone) {
      const raw_room = getRoomData();
      if (!raw_room) { onDone?.(); return; }

      // Support both nested (geometry/setup) and flat room layouts
      const geo = raw_room.geometry || raw_room;
      const setup = raw_room.setup || raw_room;

      // ── Room half-extents (all positions derived from these) ────────────
      const W = (geo.width_m || 4) / 2;
      const L = (geo.length_m || 5) / 2;
      const H = (geo.height_m || 2.6) / 2;

      // Named acoustic positions in scene-space
      // (room centred at origin; front wall = z:-L, back wall = z:+L, floor = y:-H)
      const spkZ = -L + (setup.spk_front_m || 0.45);
      const spkY = -H + (setup.tweeter_height_m || 0.95);
      const lx = setup.listener_offset_m || 0;
      const lz = -L + (setup.listener_front_m || 2.8);
      const ly = -H + 1.1;  // seated ear height above floor

      // Shorthand vector constructor
      const P = (x, y, z) => ({ x, y, z });

      // Speaker-pair midpoint — the camera locks here during the approach
      const spkMid = P(0, spkY, spkZ);

      // ── Easing library (power4 + expo S-curves, no dependency) ─────────
      // Identical mathematics to GSAP's power4.inOut / expo.inOut.
      const EASE = {
        power4InOut: t => t < 0.5
          ? 8 * t * t * t * t
          : 1 - Math.pow(-2 * t + 2, 4) / 2,
        expoInOut: t => t === 0 ? 0 : t === 1 ? 1 : t < 0.5
          ? Math.pow(2, 20 * t - 10) / 2
          : (2 - Math.pow(2, -20 * t + 10)) / 2,
        cubicInOut: t => t < 0.5
          ? 4 * t * t * t
          : 1 - Math.pow(-2 * t + 2, 3) / 2,
        linear: t => t,
      };

      // ── Narrative keyframes ─────────────────────────────────────────────
      // Each frame describes where the camera body travels TO (cam) and where
      // it looks TO (look).  camEase / lookEase are independent so the look
      // target can lead or lag the body — creating the "head turns first" feel.
      const keyframes = [
        // STATE: EXTERIOR — slow drift in from outside, looking at speaker pair.
        {
          cam: P(lx, H * 0.7, -L * 2.1),
          look: spkMid,
          ms: 3000,
          camEase: EASE.power4InOut,
          lookEase: EASE.linear,
        },
        // STATE: OVERHEAD — long slow rise to god's-eye establishing shot.
        {
          cam: P(W * 0.1, H * 5.2, L * 0.25),
          look: P(0, 0, 0),
          ms: 4000,
          camEase: EASE.power4InOut,
          lookEase: EASE.cubicInOut,
        },
        // STATE: SWOOP RIGHT — slow arc to the sweet-spot reveal.
        // Look leads the body to create the "director's cut" moment.
        {
          cam: P(W * 2.3, H * 0.85, L * 0.95),
          look: P(lx, ly, lz),
          ms: 4000,
          camEase: EASE.expoInOut,
          lookEase: EASE.power4InOut,
        },
        // STATE: LANDING — long expo descent to the listener's ear level.
        {
          cam: P(lx, ly + 0.08, lz + 0.55),
          look: P(0, ly - 0.05, -L + 0.7),
          ms: 5500,
          camEase: EASE.expoInOut,
          lookEase: EASE.expoInOut,
        },
      ];

      // ── State machine ───────────────────────────────────────────────────
      // prevCam / prevLook track the exact endpoint of the previous frame so
      // each frame's lerp always starts precisely where the last one ended.
      let prevCam = P(camera.position.x, camera.position.y, camera.position.z);
      let prevLook = P(controls.target.x, controls.target.y, controls.target.z);
      let frameIdx = 0;
      let frameStart = performance.now();

      controls.enabled = false;

      flyAnim = {
        tick(now) {
          const frame = keyframes[frameIdx];
          if (!frame) return;

          const elapsed = now - frameStart;
          const rawT = Math.min(elapsed / frame.ms, 1);
          const tc = frame.camEase(rawT);
          const tl = frame.lookEase(rawT);

          // Interpolate camera body position
          camera.position.set(
            prevCam.x + (frame.cam.x - prevCam.x) * tc,
            prevCam.y + (frame.cam.y - prevCam.y) * tc,
            prevCam.z + (frame.cam.z - prevCam.z) * tc,
          );

          // Interpolate look-at target (independent easing from body)
          controls.target.set(
            prevLook.x + (frame.look.x - prevLook.x) * tl,
            prevLook.y + (frame.look.y - prevLook.y) * tl,
            prevLook.z + (frame.look.z - prevLook.z) * tl,
          );

          if (rawT >= 1) {
            // Snap to exact endpoint to eliminate float accumulation drift
            prevCam = { ...frame.cam };
            prevLook = { ...frame.look };
            frameIdx++;
            frameStart = now;

            if (frameIdx >= keyframes.length) {
              // Landed — re-enable orbit input. onDone is for app-level
              // work (HUD, chip, save), not engine input state; the
              // engine owns whether the user can drive the camera.
              camera.position.set(frame.cam.x, frame.cam.y, frame.cam.z);
              controls.target.set(frame.look.x, frame.look.y, frame.look.z);
              controls.update();
              controls.enabled = true;
              flyAnim = null;
              onDone?.();
            }
          }
        },
      };
    },

    /**
     * setWaves(freqs, mags)
     *   freqs – number[] Hz axis from REW, OR a boolean for simulation toggle.
     *   mags  – number[] dBFS magnitudes from REW (only used when freqs is an array).
     *
     * Data mode:       setWaves(freqArray, magArray)  → rings + SBIR are data-driven.
     * Simulation mode: setWaves(true)                 → rings animate at full amplitude.
     * Off:             setWaves(false)                → rings hidden.
     */
    setWaves(freqs, mags) {
      if (Array.isArray(freqs)) {
        _rewFreqs    = freqs;
        _rewMags     = mags ?? null;
        _wavesEnabled = true;
        _topsWavesOn = true;
        _subWavesOn  = true;
      } else {
        // Boolean toggle (simulation / off) -- sets both groups together,
        // for products that don't split tops/bass (only club's sidebar
        // does, via setTopWaves/setSubWaves below).
        _wavesEnabled = !!freqs;
        _topsWavesOn = !!freqs;
        _subWavesOn  = !!freqs;
        if (!freqs) { _rewFreqs = null; _rewMags = null; }
      }
      rebuild();
    },

    /**
     * setTopWaves(enabled) / setSubWaves(enabled)
     *   Independent visibility for the top-speaker (blue) vs bass-bin
     *   (pink) wave rings — club's sidebar splits the single Waves toggle
     *   into two buttons. _wavesEnabled (the master simulation flag) stays
     *   on as long as either group is on; both off matches setWaves(false).
     */
    setTopWaves(enabled) {
      _topsWavesOn = !!enabled;
      _wavesEnabled = _topsWavesOn || _subWavesOn;
      rebuild();
    },

    setSubWaves(enabled) {
      _subWavesOn = !!enabled;
      _wavesEnabled = _topsWavesOn || _subWavesOn;
      rebuild();
    },

    /**
     * setMeasurementContext(analysis)
     *   analysis – the `analysis` object returned by MeasurelyAnalyse.analyse()
     *              (i.e. result.analysis — NOT result.ai or result.scores).
     *              Pass null to clear the stored context.
     *
     * Foundation for measurement-driven overlays. Stores a defensively-
     * copied snapshot of the fields overlay renderers need so consumers
     * can't mutate engine-owned state.
     */
    setMeasurementContext(analysis) {
      if (analysis == null) {
        _measurement = null;
        return;
      }

      // Defensive shallow copies — engine owns the source arrays/objects.
      // Nested mode objects get a per-element spread so callers can't reach
      // through and mutate {type, freq_hz, delta_db}.
      const modes = Array.isArray(analysis.modes)
        ? analysis.modes.map(m => ({ ...m }))
        : [];
      const reflectionsMs = Array.isArray(analysis.reflections_ms)
        ? analysis.reflections_ms.slice()
        : [];
      const bandLevels = (analysis.band_levels_db && typeof analysis.band_levels_db === 'object')
        ? { ...analysis.band_levels_db }
        : null;
      const scores = (analysis.scores && typeof analysis.scores === 'object')
        ? { ...analysis.scores }
        : null;
      const signalIntegrity = (analysis.signal_integrity && typeof analysis.signal_integrity === 'object')
        ? { ...analysis.signal_integrity }
        : null;

      _measurement = {
        modes,
        reflectionsMs,
        bandLevels,
        bandwidthLo:    analysis.bandwidth_lo_3db_hz,
        bandwidthHi:    analysis.bandwidth_hi_3db_hz,
        smoothnessStd:  analysis.smoothness_std_db,
        scores,
        signalIntegrity,
        timestamp:      Date.now(),
      };
    },

    /**
     * getMeasurementContext() — read-only accessor.
     * Returns a defensive shallow copy of the stored context, or null if
     * no measurement is loaded. Future overlay consumers can read the
     * internal _measurement variable directly (cheaper); this accessor
     * exists for verification + browser-console debugging.
     */
    getMeasurementContext() {
      if (_measurement == null) return null;
      return {
        modes:           _measurement.modes.map(m => ({ ...m })),
        reflectionsMs:   _measurement.reflectionsMs.slice(),
        bandLevels:      _measurement.bandLevels ? { ..._measurement.bandLevels } : null,
        bandwidthLo:     _measurement.bandwidthLo,
        bandwidthHi:     _measurement.bandwidthHi,
        smoothnessStd:   _measurement.smoothnessStd,
        scores:          _measurement.scores ? { ..._measurement.scores } : null,
        signalIntegrity: _measurement.signalIntegrity ? { ..._measurement.signalIntegrity } : null,
        timestamp:       _measurement.timestamp,
      };
    },

    /** Toggle the SBIR energy-stream FX (particles, trails, vortices, flares). */
    setSbirField(enabled) {
      _sbirFieldVisible = !!enabled;
      roomGroup.children.forEach(o => {
        if (o.userData?.isSbirFx) o.visible = _sbirFieldVisible;
      });
    },

    /**
     * setPeaksFreq(hz) — set the swept frequency (20–240 Hz) for the Peaks &
     * dips slab. Re-bakes the field in place (no full rebuild) when the overlay
     * is active, so dragging the SCL frequency slider re-forms the volume live.
     */
    setPeaksFreq(hz) {
      _peaksFreq = Math.max(20, Math.min(240, parseFloat(hz) || 50));
      if (overlayEnabled(OVERLAYS.PEAKS_DIPS) && _peaksLayers.length) {
        _bakePeaksField(_lastRoom);
      }
    },

    /** Current Peaks & dips swept frequency (Hz). */
    getPeaksFreq() { return _peaksFreq; },

    /**
     * fireSoundBurst() — trigger the Sound Burst showpiece: a one-shot
     * explosion of frequency-coloured balls from both speakers that bounce off
     * the walls with energy loss (treated walls absorb the treble/mid) and ping
     * the listener. Re-fireable; one-shot, never loops; costs nothing when idle.
     * Separate from the analytical overlays — does not touch them.
     */
    fireSoundBurst() {
      _fireSoundBurst();
    },

    /**
     * setShowLabels(enabled) — toggle in-scene text rendering at runtime.
     * Suppresses wall compass labels (Front/Rear/L/R) and overlay annotation
     * strings (SBIR / Reflections / Bandwidth). Overlay GEOMETRY (rays,
     * shading, bounce paths, mode planes) is unaffected.
     */
    setShowLabels(enabled) {
      _showLabels = !!enabled;
      rebuild();
    },

    /** Reset camera to the default overview position and re-enable orbit controls. */
    resetCamera() {
      flyAnim = null;
      camera.position.set(DEFAULT_CAMERA.pos.x, DEFAULT_CAMERA.pos.y, DEFAULT_CAMERA.pos.z);
      controls.target.set(DEFAULT_CAMERA.target.x, DEFAULT_CAMERA.target.y, DEFAULT_CAMERA.target.z);
      controls.enabled = true;
      controls.update();
    },

    /**
     * Frame the camera proportionally to the current room size. Pure viewport
     * presentation — NOT acoustic logic and NOT a physical measurement. The
     * default overview position (DEFAULT_CAMERA.pos) is tuned for the 5.5 m
     * reference room; scaling it by the current room's largest dimension keeps
     * the room filling roughly the same fraction of the viewport regardless of
     * size, so a smaller room (e.g. studio) doesn't sit tiny in the frame.
     * Instant — no fly animation. Consumers call this after a geometry change
     * such as applying per-room-type default dimensions on a room-type switch.
     */
    frameRoom() {
      flyAnim = null;
      const r = _lastRoom || {};
      const longest = Math.max(r.width_m || 5.5, r.length_m || 5.5, r.height_m || 5.5);
      const scale = longest / 5.5;
      camera.position.set(
        DEFAULT_CAMERA.pos.x * scale,
        DEFAULT_CAMERA.pos.y * scale,
        DEFAULT_CAMERA.pos.z * scale
      );
      controls.target.set(DEFAULT_CAMERA.target.x, DEFAULT_CAMERA.target.y, DEFAULT_CAMERA.target.z);
      controls.enabled = true;
      controls.update();
    },

    /**
     * Force a re-fit of the camera and renderer to the current container size.
     * The engine already wires _onContainerResize to a ResizeObserver and a
     * deferred rAF at init; this exposes it so consumers can also trigger it
     * after layout is known to be final (e.g. retail's _launchRoom on phone,
     * where the iframe's initial fit races iOS Safari's URL-bar settling).
     * No-op if container clientWidth or clientHeight is 0.
     */
    resize: _onContainerResize,

    // Read-only handles to the underlying Three.js camera and OrbitControls.
    // Added for tools/record.html so it can dolly the camera in for tighter
    // marketing-clip framing without editing resetCamera (which the live app
    // and measurely-web rely on). No consumer of the engine library uses
    // these; if that changes, treat them as internal and prefer adding a
    // higher-level api method instead.
    getCamera()   { return camera; },
    getControls() { return controls; },
    getRenderer() { return renderer; },

    /**
     * setSweepMode('ideal' | 'problem')
     * Recolours the SBIR ping spheres and reflection path lines to give
     * immediate visual feedback about the loaded test suite.
     *   ideal   → bright teal (#00F5FF), slow smooth pulse, no jitter
     *   problem → amber/orange (#F59E0B), fast erratic pulse, jitter offset
     */
    setSweepMode(mode) {
      const isIdeal = mode === 'ideal';
      roomGroup.traverse(obj => {
        if (obj.userData?.isSideRefPing && obj.material?.uniforms) {
          const u = obj.material.uniforms;
          // uRate controls pulse frequency; uSeverity drives teal→pink mix
          if (u.uRate)     u.uRate.value     = isIdeal ? 1.8 : 6.5;
          if (u.uSeverity) u.uSeverity.value = isIdeal ? 0.0 : 0.75;
          // For problem mode, nudge position slightly for "erratic" feel
          if (!isIdeal) {
            const jitter = 0.03;
            obj.position.x += (Math.random() - 0.5) * jitter;
            obj.position.y += (Math.random() - 0.5) * jitter;
          }
        }
      });
    },
  };

  // Always accessible from the browser console as window.room3d / window.room3D
  window.room3d = api;
  window.room3D = api;   // alias used by demo.html test-suite toggle

  return api;
}