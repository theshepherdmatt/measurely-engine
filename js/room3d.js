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

export function initRoom3D({
  mountId,
  getRoomData,
  mode = "setup",
}) {
  console.log("[Room3D] initRoom3D() called with mode:", mode);

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
    CLARITY: "clarity",
    BALANCE: "balance",
    SMOOTHNESS: "smoothness"

  };

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
  let smoothnessStd = 0;
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


  console.log("[Room3D] baseScale =", baseScale);


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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0xf0ede8, 1); // Warm off-white — matches site light theme
  renderer.domElement.style.touchAction = 'none'; // prevent iOS/iPad scroll hijack
  container.appendChild(renderer.domElement);

  console.log("[Room3D] Renderer + camera initialised");

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
  function _onContainerResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
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
  let _waveRings = [];       // Expanding wave ring Lines, repopulated on rebuild
  let _wavesEnabled = false;  // Off by default; toggled via api.setWaves()
  let _sbirFieldVisible = true; // SBIR heatmap field on by default; toggled via api.setSbirField()
  // ── REW live measurement data ─────────────────────────────────────────────
  // Set by api.setWaves(freqs, mags). Null = no measurement loaded (simulation mode).
  let _rewFreqs = null;       // Float32[] Hz axis from REW
  let _rewMags  = null;       // Float32[] dBFS magnitudes from REW
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
    // renderStage is set externally via setStage() — never override here.
    console.log("[Room3D] 🔧 rebuild() | stage:", renderStage, "| mode:", currentMode);

    roomGroup.clear();
    _waveRings = [];
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
        listener_offset_m: 0, subwoofer: false
      },
      environment: {
        room_type: 'home', floor_material: 'hard',
        furniture: {
          opt_area_rug: true, opt_sofa: true,
          opt_coffee_table: false, opt_desk: false, opt_chair: false,
          seating_type: 'sofa', opt_display: true, opt_mic: false,
          opt_keyboard: false, opt_client_seating: false,
          client_seating_type: 'sofa', desk_width_m: 1.6
        },
        treatment: {
          wall_panel_mode: 'none', side_panel_mode: 'none',
          bass_trap_mode: 'none', ceiling_panel_mode: 'none'
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
      spk_placement: setup.spk_placement || 'desk',
      spk_spacing_m: setup.spk_spacing_m,
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

      // TREATMENT: Digging into data.environment.treatment
      wall_panel_mode: treat.wall_panel_mode ?? env.wall_panel_mode ?? "none",
      side_panel_mode: treat.side_panel_mode ?? env.side_panel_mode ?? "none",
      bass_trap_mode: treat.bass_trap_mode ?? env.bass_trap_mode ?? "none",
      ceiling_panel_mode: treat.ceiling_panel_mode ?? env.ceiling_panel_mode ?? "none",
      panel_color: data.panel_color ?? null,  // optional hex string e.g. '#c8a882'

      // FLOOR: read from env (data.environment.floor_material) with hard fallback
      floor_material: env.floor_material ?? data.floor_material ?? 'hard',
    };

    // 2. DEFINE MISSING VARIABLES (Prevents the ReferenceError crash)
    const isLocked = (currentMode === "locked");
    const isStudio = (room.room_type === "studio");
    const offsetX = room.listener_offset_m || 0;
    // Raise all floor-based speakers + rack by rug thickness so they sit ON the rug,
    // not flush with the floor beneath it. Zero in studio mode (no rug).
    const rugRaise = (!isStudio && (room.opt_area_rug ?? true)) ? 0.02 : 0;

    // 3. MASTER SWITCHES
    VISIBILITY.furniture = { sofa: true, coffeeTable: true, rug: true, desk: true, chair: true };

    if (room.length_m == null || room.width_m == null || room.height_m == null) {
      console.error("[Room3D] ❌ Invalid room data", data);
      return;
    }

    console.log("[Room3D] Mapped Room (Checking Panels):", {
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
    // floor_material drives the visual — hard floor = cool off-white reflective surface,
    // carpet = dark charcoal grey, fully matte. Neutral grey avoids colour casts under
    // the scene's high ambient+point lighting and reads immediately as carpet.
    const isCarpet = room.floor_material === 'carpet';
    const floorMat = new THREE.MeshStandardMaterial({
      color: isCarpet ? 0x3a3a3a : 0xe8e3da,   // dark charcoal grey vs. cool off-white
      roughness: isCarpet ? 0.97 : 0.18,        // fully matte vs. slightly reflective
      metalness: isCarpet ? 0.00 : 0.30,        // no sheen vs. polished tile
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
      const grid = new THREE.GridHelper(1, gridDivisions, colors.room, 0xd0cbc4);
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

      console.log("[Room3D] Rendering placeholder sources");

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
            detailed: true
          };

        case "statement":
          return {
            w: 0.46,
            h: 1.44,
            d: 0.50,
            color: 0x2a2a28,
            tweeterPos: 0.82,
            floorStand: true,   // floor-standing flagship — bottom sits on floor
            isStatement: true
          };

        case "panel":
          return {
            w: 0.55,
            h: 1.55,
            d: 0.06,
            color: 0x1a1714,
            floorStand: true, // sits on floor, not tweeter-height positioned
            tweeterPos: 0.50, // acoustic centre at mid-panel
            isPanel: true
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

      ["L", "R"].forEach(side => {
        const profile = getSpeakerProfile(room.speaker_type);
        const isSpkHighlit = highlightTarget === 'speakers';

        const spkColor = isSpkHighlit ? 0x0f766e : profile.color;
        const spkOpacity = isSpkHighlit ? 0.9 : Math.max(OP_OBJ, 0.80);

        const speaker = profile.isStatement
          ? _buildStatementSpeaker(profile.w, profile.h, profile.d, spkColor, spkOpacity)
          : profile.isPanel
            ? _buildElectrostaticSpeaker(profile.w, profile.h, profile.d, spkColor, spkOpacity)
            : profile.detailed
              ? _buildDetailedSpeaker(profile.w, profile.h, profile.d, spkColor, spkOpacity)
              : _buildStandmountSpeaker(profile.w, profile.h, profile.d, spkColor, spkOpacity);

        // X position — for desk monitors use desk_width_m so speakers track the width slider;
        // all other types use spk_spacing_m as usual.
        const deskHalfW = (room.desk_width_m ?? 1.6) / 2;
        const onDeskMode = profile.onDesk && room.spk_placement !== 'stands';
        const x = offsetX + (side === "L" ? -1 : 1) * (onDeskMode ? deskHalfW * 0.78 : room.spk_spacing_m / 2);

        // Z anchor for all desk-based placements
        const deskBackZ = -room.length_m / 2 + 0.05;
        const deskZ_pos = deskBackZ + 0.30; // ~30 cm from back edge = speaker sits on rear of desk

        let y, z;
        if (profile.onDesk && room.spk_placement === 'stands') {
          // Nearfield monitors on floor stands — tweeter height driven by slider
          const standTweeterH = room.tweeter_height_m || 1.1;
          const tweeterOffsetFromCenter = (profile.h / 2) - (profile.h * (profile.tweeterPos || 0.5));
          y = baseY + standTweeterH + tweeterOffsetFromCenter;
          z = deskZ_pos; // same depth as desk so they sit either side of it
        } else if (profile.onDesk && room.spk_placement === 'desk_stands') {
          // Short isolation stands on the desk surface — raises monitor ~7 cm
          const riserH = 0.07;
          const deskSurface = baseY + 0.775;
          y = deskSurface + riserH + profile.h / 2;
          z = deskZ_pos - 0.15;
        } else if (profile.onDesk) {
          // Desk monitors: snap to desk surface (desk top at 0.775 m above floor)
          const deskSurface = baseY + 0.775;
          y = deskSurface + profile.h / 2;
          z = deskZ_pos - 0.15;
        } else if (profile.floorStand) {
          // Floor-standing panels / statement: bottom sits on rug surface
          y = baseY + rugRaise + profile.h / 2;
          z = -room.length_m / 2 + room.spk_front_m;
        } else {
          // Standmounts & floorstanders: cabinet stays fixed, only beam moves.
          // Floorstanders: bottom on floor. Standmounts: fixed 0.64 m stand height.
          const isFloorstander = profile.detailed; // detailed build = floorstander
          if (isFloorstander) {
            y = baseY + rugRaise + profile.h / 2;   // floor-standing, always grounded
          } else {
            const fixedStandH = 0.64;               // standard 24" stand
            y = baseY + rugRaise + fixedStandH + profile.h / 2;
          }
          z = -room.length_m / 2 + room.spk_front_m;
        }

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
          const standHeight = (y - profile.h / 2) - baseY;
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
        if (!profile.onDesk && !profile.floorStand && !profile.detailed) {
          const standHeight = (y - profile.h / 2) - baseY;
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

        // Initial toe-in (may be overridden by _applyAutoToe after rebuild)
        spkGroup.rotation.y = (side === "L" ? 1 : -1) * toeRad;

        // --- BEAMS ---
        // Beam is in speaker-local space. We want its world Y = floor + tweeter_height_m.
        // Compute the local offset: beamLocalY = target_world_Y - spkGroup.world_Y
        const targetBeamWorldY = baseY + rugRaise + (room.tweeter_height_m || 0.95);
        const beamLocalY = targetBeamWorldY - y;  // y is spkGroup world Y
        const beamGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, beamLocalY, 0),
          new THREE.Vector3(0, beamLocalY, room.length_m)
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
        if (_wavesEnabled) {
          const NUM_RINGS = 5;
          const maxR = Math.max(room.length_m, room.width_m) * 0.85;
          const waveY = baseY + room.tweeter_height_m;
          const waveZ = -room.length_m / 2 + room.spk_front_m;
          const waveX = offsetX + (side === 'L' ? -1 : 1) * room.spk_spacing_m / 2;

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

          // Unit circle geometry shared across all rings for this speaker
          const circlePts = [];
          const SEG = 72;
          for (let j = 0; j <= SEG; j++) {
            const a = (j / SEG) * Math.PI * 2;
            circlePts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
          }
          const circleGeo = new THREE.BufferGeometry().setFromPoints(circlePts);

          for (let ri = 0; ri < NUM_RINGS; ri++) {
            const amp = ringAmps[ri];
            // Colour: cyan (HSL 0.50) at full energy → magenta (HSL 0.83) at deep null
            // Lightness 0.42 (down from 0.55) so the rings read against the
            // cream canvas background — light cyan-on-cream was barely visible.
            const ringColor = new THREE.Color().setHSL(
              0.50 + (1 - amp) * 0.33,   // 0.50=cyan → 0.83=magenta
              0.90,
              0.42
            );
            const ringMat = new THREE.LineBasicMaterial({
              color: ringColor,
              transparent: true,
              opacity: 0,
              depthWrite: false,
            });
            const ring = new THREE.Line(circleGeo, ringMat);
            ring.position.set(waveX, waveY, waveZ);
            ring.userData.wavePhase = ri / NUM_RINGS;
            ring.userData.waveMaxR  = maxR;
            ring.userData.waveAmp   = amp;   // animate() uses this to scale peak opacity
            roomGroup.add(ring);
            _waveRings.push(ring);
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
    ------------------------------------------ */
    if (!isStudio && (renderStage === 'speakers' || renderStage === 'furnishings')) {
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

      // Solid fill material for stacked electronics — near-black, brushed-metal look
      const _compMat = new THREE.MeshStandardMaterial({
        color: 0x111111,  // Near-black stealth
        roughness: 0.45,
        metalness: 0.45,
      });
      // Subtle edge highlight for component front-panels (slightly lighter)
      const _compEdgeMat = new THREE.LineBasicMaterial({
        color: 0x2e2e2e, transparent: true, opacity: 0.70,
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
              new THREE.Vector3(spkX, standBaseY, rearZ + 0.05),        // base of stand (floor level)
              new THREE.Vector3(spkX + (_rackTarget.x - spkX) * 0.28, floorY + 0.018, rearZ + (_rackTarget.z - rearZ) * 0.15),
              new THREE.Vector3(spkX + (_rackTarget.x - spkX) * 0.68, floorY + 0.010, rearZ + (_rackTarget.z - rearZ) * 0.72),
              _rackTarget.clone(),
            ];
          } else {
            // Floorstanders / floor-panels: exit near base of cabinet above rug
            const cableExitY = floorY + rugRaise + Math.min(_profile.h * 0.10, 0.13);
            cablePoints = [
              new THREE.Vector3(spkX, cableExitY, rearZ),
              new THREE.Vector3(spkX + (_rackTarget.x - spkX) * 0.28, floorY + 0.018, rearZ + (_rackTarget.z - rearZ) * 0.15),
              new THREE.Vector3(spkX + (_rackTarget.x - spkX) * 0.68, floorY + 0.010, rearZ + (_rackTarget.z - rearZ) * 0.72),
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
          const exitY = fY + subH * 0.12;
          const pts = [
            new THREE.Vector3(fromX, exitY, fromZ - subD / 2),
            new THREE.Vector3(fromX + (toTarget.x - fromX) * 0.25, fY + 0.016, fromZ + (toTarget.z - fromZ) * 0.18),
            new THREE.Vector3(fromX + (toTarget.x - fromX) * 0.65, fY + 0.010, fromZ + (toTarget.z - fromZ) * 0.70),
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
          sg.position.set(offsetX + rackW / 2 + 0.06 + subW / 2, floorY + subH / 2, rackWallZ);
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
            sg.position.set(sx, floorY + subH / 2, sideSubZ);
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

    {
      const station = new THREE.Group();
      station.position.set(offsetX + (room.listener_offset_m || 0), -room.height_m / 2, listenerZ);

      // ── Listener sphere (always visible) ──
      const isListHighlit = highlightTarget === 'listener';
      const sphereColor = isListHighlit ? 0x0f766e : colors.accent;
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
      const _sphereY = isStudio ? effectiveHeadHeight : (_seatType === 'lounge' ? 1.00 : 0.96);
      sphere.position.set(0, _sphereY, _sphereZ);
      station.add(sphere);

      // ── Rug ──
      // Studio: small rug in station local coords (clamped from front wall).
      // Hi-Fi: rug added to roomGroup in world coords (speaker-anchored, grows with listener).
      if (isStudio && VISIBILITY.furniture.rug && room.opt_area_rug) {
        const rugW = room.width_m * 0.45, rugD = room.length_m * 0.35;
        const rug = _ghostBox(rugW, 0.02, rugD);
        const rugHalfD = rugD / 2;
        const minLocalZ = (-room.length_m / 2) - listenerZ + rugHalfD + 0.06;
        const rugLocalZ = Math.max(-0.80, minLocalZ);
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
        const _sofaBackExtent = 0.80;  // base back face + back panel back face
        const _sofaMaxLocalZ = (room.length_m / 2) - listenerZ - _sofaBackExtent - 0.05;
        seatingGroup.position.set(0, 0, Math.min(0.35, Math.max(0, _sofaMaxLocalZ)));
        station.add(seatingGroup);
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
        ctGroup.position.set(0, 0, -0.9);
        station.add(ctGroup);
      }

      // ── Studio: desk + chair + display + mic + keyboard ──────────────────────
      // Desk anchored to front wall (via spk_front_m) so monitors always land on it.
      // Chair anchored to listenerZ — sticky to the listening position slider.
      if (isStudio) {
        const deskW = room.desk_width_m ?? 1.6;

        const deskD = 0.85;  // depth
        const halfW = deskW / 2;
        const spkFront = room.spk_front_m ?? 0.6;

        // Desk back edge sits 5 cm from front wall; center is half-depth further.
        // This puts the desk at the SAME Z as the speakers so monitors land on it.
        const deskBackZ = -room.length_m / 2 + 0.05;
        const deskZ = deskBackZ + deskD / 2;          // desk centre
        const deskFrontZ = deskBackZ + deskD;              // desk front edge

        // Chair is at listening position — sticky to listener_front_m slider.
        // For a normal studio layout the chair is comfortably behind the desk.
        const chairZ = listenerZ;

        // ── Desk ──
        const deskGroup = new THREE.Group();
        const deskTop = _ghostBox(deskW, 0.05, deskD);
        deskTop.position.y = 0.775;
        deskGroup.add(deskTop);
        [[-halfW + 0.04, 0.375, -deskD / 2 + 0.04], [halfW - 0.04, 0.375, -deskD / 2 + 0.04],
        [-halfW + 0.04, 0.375, deskD / 2 - 0.04], [halfW - 0.04, 0.375, deskD / 2 - 0.04]]
          .forEach(p => { const l = _ghostBox(0.04, 0.775, 0.04); l.position.set(...p); deskGroup.add(l); });
        deskGroup.position.set(offsetX, -room.height_m / 2, deskZ);
        roomGroup.add(deskGroup);

        // ── Display monitor (sits at back of desk, on a stand) ──
        if (room.opt_display !== false) {
          const dispGroup = new THREE.Group();
          const standBase = _ghostBox(0.22, 0.04, 0.18);
          standBase.position.y = 0.795;
          dispGroup.add(standBase);
          const standPole = _ghostBox(0.04, 0.22, 0.04);
          standPole.position.set(0, 0.915, 0.02);
          dispGroup.add(standPole);
          const monitor = _ghostBox(Math.min(deskW * 0.70, 0.68), 0.38, 0.032);
          monitor.position.set(0, 1.10, 0.01);
          dispGroup.add(monitor);
          // Positioned at back-centre of desk surface
          dispGroup.position.set(offsetX, -room.height_m / 2, deskBackZ + 0.12);
          roomGroup.add(dispGroup);
        }

        // ── Keyboard (thin slab on desk front edge) ──
        if (room.opt_keyboard) {
          const kb = _ghostBox(Math.min(deskW * 0.30, 0.44), 0.02, 0.16);
          kb.position.set(offsetX, -room.height_m / 2 + 0.795, deskFrontZ - 0.12);
          roomGroup.add(kb);
        }

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
          micGroup.position.set(offsetX - halfW - 0.1, -room.height_m / 2, deskZ);
          roomGroup.add(micGroup);
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
        chairGroup.position.set(offsetX, -room.height_m / 2, chairZ);
        // No whole-group tilt — feet and stem stay flat, only backrest angled
        roomGroup.add(chairGroup);
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

      const hiRug = _ghostBox(rugWidth, 0.02, rugDepth);
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
    const panelMat = new THREE.MeshBasicMaterial({
      color: _panelHex,
      transparent: true,
      opacity: room.panel_color ? 0.55 : 0.28,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    // Helper: panel mesh + edge outline for embed mode

    // --- WALL PANELS (front & rear walls) ---
    // Canonical geometry from treatment-registry.js — individual standard-size panels.
    // Identical rendering on all pages regardless of embed_mode.
    if (room.wall_panel_mode !== "none") {
      const wpGeo = window.MeasurelyTreatment?.GEOMETRY?.wall_panel;
      const wpW = wpGeo?.panelWidth ?? 0.60;
      const wpH = wpGeo?.panelHeight ?? 1.20;
      const wpGap = wpGeo?.panelGap ?? 0.04;
      const wpMaxFrac = wpGeo?.maxWidthFrac ?? 0.80;
      const wpThickness = wpGeo?.thickness ?? 0.06;

      const maxSpan = room.width_m * wpMaxFrac;
      const panelCount = Math.max(1, Math.floor((maxSpan + wpGap) / (wpW + wpGap)));
      const totalSpan = panelCount * wpW + (panelCount - 1) * wpGap;
      // Panels centred at tweeter/ear height — acoustically correct and stays fixed
      // relative to the floor regardless of room height slider changes.
      const floorInWorld = -room.height_m / 2;
      const panelY = floorInWorld + (room.tweeter_height_m ?? 0.95);

      // panelH / panelCenterY can be overridden for client sofa sizing
      const addWallPanels = (wallZ, facingDir, panelH = wpH, panelCenterY = panelY) => {
        const geo = new THREE.BoxGeometry(wpW, panelH, wpThickness);
        for (let i = 0; i < panelCount; i++) {
          const px = offsetX - totalSpan / 2 + wpW / 2 + i * (wpW + wpGap);
          const mesh = new THREE.Mesh(geo, panelMat);
          mesh.position.set(px, panelCenterY, wallZ + facingDir * wpThickness / 2);
          roomGroup.add(mesh);
        }
      };

      if (room.wall_panel_mode === "front" || room.wall_panel_mode === "both") {
        addWallPanels(-room.length_m / 2, 1);
      }
      if (room.wall_panel_mode === "rear" || room.wall_panel_mode === "both") {
        // When a client sofa is at the rear wall, raise panels above the sofa back
        // (sofa back top ≈ 0.80 m from floor; panels sit just above it).
        const hasSofaAtRear = room.opt_client_seating && (room.client_seating_type || 'sofa') === 'sofa';
        const rearH = hasSofaAtRear ? 0.72 : wpH;
        const floorInWorld = -room.height_m / 2;
        // Sofa back top in world Y: floorInWorld + 0.80. Panel centre = sofa_top + rearH/2 + 0.05 gap.
        const rearCentreY = hasSofaAtRear
          ? floorInWorld + 0.80 + rearH / 2 + 0.05
          : panelY;
        addWallPanels(room.length_m / 2, -1, rearH, rearCentreY);
      }
    }

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
        if (room.bass_trap_mode === 'front' && !isFront) return;
        if (room.bass_trap_mode === 'rear' && isFront) return;

        // Height: scale to sloped ceiling at this exact corner
        const rawTrapH = room.height_m * trapHFr;
        let localCeilH = rawTrapH;
        if (hasSlopedCeiling) {
          const localCeilY = ceilingYAt(cx, cz);
          const localHeight = localCeilY - floorY;
          localCeilH = Math.max(0.1, localHeight * trapHFr);
        }
        const maxSafeH = Math.max(0.1, hasSlopedCeiling
          ? ceilingYAt(cx, cz) - floorY
          : room.height_m);
        localCeilH = Math.min(localCeilH, maxSafeH * 0.95); // 5% clearance from ceiling

        const geo = _makeCornerTrapGeo(trapLeg, localCeilH);
        const mesh = new THREE.Mesh(geo, panelMat);
        // Right-angle vertex sits exactly at the wall corner; no box-centre offset needed
        mesh.position.set(offsetX + cx, floorY, cz);
        mesh.rotation.y = rotY;
        roomGroup.add(mesh);
      });

    }

    // --- CEILING PANELS ---
    if (room.ceiling_panel_mode === "cloud" || room.ceiling_panel_mode === "flush") {

      const cpW = Math.min(room.spk_spacing_m * 1.6, room.width_m * 0.8);
      const cpL = room.length_m * 0.28;
      const thickness = 0.10;  // 100mm (4") — GIK 244 / Primacoustic London 16 standard

      const spkZ = -room.length_m / 2 + (room.spk_front_m ?? 0.45);
      const midZ = (spkZ + listenerZ) / 2;

      // Industry standard: 300–460mm air gap when hanging (400mm = 16" midpoint)
      const isFlush = room.ceiling_panel_mode === 'flush';
      const dropGap = isFlush ? 0 : 0.40;

      if (isFlush) {
        // ── FLUSH: panels follow the ceiling surface ──────────────────────────
        if (isGable) {
          // Two angled panels, one on each pitched face
          const panelGroup = new THREE.Group();
          if (gableAxis === "depth") {
            const slopeAngle = Math.atan2(room.height_m - lowH, room.width_m / 2);
            const halfWidth = cpW / 2;
            const leftX = offsetX - halfWidth / 2;
            const rightX = offsetX + halfWidth / 2;
            const lp = new THREE.Mesh(new THREE.BoxGeometry(halfWidth - 0.05, thickness, cpL), panelMat);
            lp.position.set(leftX, ceilingYAt(leftX, midZ) - thickness / 2, midZ);
            lp.rotation.z = slopeAngle;
            const rp = new THREE.Mesh(new THREE.BoxGeometry(halfWidth - 0.05, thickness, cpL), panelMat);
            rp.position.set(rightX, ceilingYAt(rightX, midZ) - thickness / 2, midZ);
            rp.rotation.z = -slopeAngle;
            panelGroup.add(lp, rp);
          } else {
            const slopeAngle = Math.atan2(room.height_m - lowH, room.length_m / 2);
            const halfLength = cpL / 2;
            const frontZ = midZ - halfLength / 2;
            const backZ = midZ + halfLength / 2;
            const fp = new THREE.Mesh(new THREE.BoxGeometry(cpW, thickness, halfLength - 0.05), panelMat);
            fp.position.set(offsetX, ceilingYAt(offsetX, frontZ) - thickness / 2, frontZ);
            fp.rotation.x = -slopeAngle;
            const bp = new THREE.Mesh(new THREE.BoxGeometry(cpW, thickness, halfLength - 0.05), panelMat);
            bp.position.set(offsetX, ceilingYAt(offsetX, backZ) - thickness / 2, backZ);
            bp.rotation.x = slopeAngle;
            panelGroup.add(fp, bp);
          }
          roomGroup.add(panelGroup);

        } else if (isSlanted) {
          // Single panel tilted to follow the slope
          const panelCeilY = ceilingYAt(offsetX, midZ);
          const panel = new THREE.Mesh(new THREE.BoxGeometry(cpW, thickness, cpL), panelMat);
          panel.position.set(offsetX, panelCeilY - thickness / 2, midZ);
          const isZSlant = slantDir === "front_to_back" || slantDir === "back_to_front";
          const span = isZSlant ? room.length_m : room.width_m;
          const slopeAngle = Math.atan2(room.height_m - lowH, span);
          if (isZSlant) panel.rotation.x = (slantDir === "back_to_front" ? -1 : 1) * slopeAngle;
          else panel.rotation.z = (slantDir === "left_to_right" ? 1 : -1) * slopeAngle;
          roomGroup.add(panel);

        } else {
          // Flat: horizontal panel pressed against ceiling
          const panel = new THREE.Mesh(new THREE.BoxGeometry(cpW, thickness, cpL), panelMat);
          panel.position.set(offsetX, room.height_m / 2 - thickness / 2, midZ);
          roomGroup.add(panel);
        }

      } else {
        // ── HANGING (cloud): always a single HORIZONTAL panel ────────────────
        // Position is LISTENER-RELATIVE, not ceiling-relative.
        // ITU-R BS.1116: seated ear height = 1.1m above floor.
        // Primacoustic / GIK / RPG: cloud bottom 0.6m above ears = 1.7m above floor.
        // Cloud centre = 1.7m + thickness/2 = 1.75m above floor.
        //
        // Ceiling-relative approaches (e.g. ceilTop - 0.4m) put the cloud at
        // 3.5m in a 4m room — far too high to intercept ceiling reflections.
        const SEATED_EAR_H = 1.10;   // m above floor (ITU-R BS.1116 standard)
        const EAR_CLEARANCE = 1.10;  // m above ears to cloud bottom (2.2m above floor)
        const floorY = -room.height_m / 2;
        const ceilTop = room.height_m / 2;
        // Clamp: always keep at least 0.2m of clearance below the ceiling
        const cloudY = Math.min(
          floorY + SEATED_EAR_H + EAR_CLEARANCE + thickness / 2,
          ceilTop - 0.20 - thickness / 2
        );

        const panel = new THREE.Mesh(new THREE.BoxGeometry(cpW, thickness, cpL), panelMat);
        panel.rotation.set(0, 0, 0);   // always horizontal
        panel.position.set(offsetX, cloudY, midZ);
        roomGroup.add(panel);

        // Suspension wires: 4 corner wires, vertical, length driven by ceilingYAt.
        // Works for flat / slanted / gabled — ceilingYAt returns the correct ceiling Y
        // at any (x,z), so wires automatically lengthen as ceiling height increases.
        const wireMat = new THREE.LineBasicMaterial({ color: 0x999999, transparent: true, opacity: 0.55 });
        const panelTopY = cloudY + thickness / 2;
        const hW2 = cpW / 2, hL2 = cpL / 2;
        [
          [offsetX - hW2, midZ - hL2],
          [offsetX + hW2, midZ - hL2],
          [offsetX - hW2, midZ + hL2],
          [offsetX + hW2, midZ + hL2],
        ].forEach(([wx, wz]) => {
          const wireTop = ceilingYAt(wx, wz);
          if (wireTop <= panelTopY) return;  // defensive: skip if ceiling at/below panel
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

    // --- SIDE PANELS ---
    if (room.side_panel_mode !== "none" || simulatePanels) {

      const wallX = room.width_m / 2;
      const earY = -(room.height_m / 2) + (room.tweeter_height_m ?? 0.9);

      const listenerPos = new THREE.Vector3(
        offsetX,
        earY,
        listenerZ
      );

      for (const side of [-1, 1]) {

        if (!simulatePanels) {

          if (room.side_panel_mode === "left" && side === 1) continue;
          if (room.side_panel_mode === "right" && side === -1) continue;
          if (room.side_panel_mode === "none") continue;

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
        // Scale count with room length (same pattern as front/rear scaling by width):
        //   ≤4 m → 1 panel   |   ~6 m → 2 panels   |   ~9 m → 3 panels
        const spLength = Math.min(
          spBaseLen * Math.max(1, room.length_m / 4.0),
          room.length_m * 0.45          // never more than 45 % of the wall length
        );

        // Panel count + centred span — same formula as the front/rear builder
        const spCount = Math.max(1, Math.floor((spLength + spGap) / (spW + spGap)));
        const spTotalSpan = spCount * spW + (spCount - 1) * spGap;
        // spGeo3 is the full-height geometry — may be replaced per-panel below if ceiling clips
        const spGeo3Full = new THREE.BoxGeometry(spThickness, spH_panel, spW);

        for (let i = 0; i < spCount; i++) {
          const pz = bouncePoint.z - spTotalSpan / 2 + spW / 2 + i * (spW + spGap);

          // Clamp panel top to ceiling at this exact wall + Z position.
          // ceilingYAt() handles flat, slanted, and gabled profiles correctly.
          const wallCeilY = ceilingYAt(side * (wallX - spThickness / 2), pz);
          const spFloor = -room.height_m / 2;
          const spCentreY = spFloor + (room.tweeter_height_m ?? 0.95); // ear height from floor
          const panelBot = spCentreY - spH_panel / 2;                 // bottom of full-height panel
          const panelTop = Math.min(spCentreY + spH_panel / 2, wallCeilY - 0.04);
          const effH = Math.max(0.10, panelTop - panelBot);
          const geo = effH < spH_panel - 0.01
            ? new THREE.BoxGeometry(spThickness, effH, spW)  // ceiling-clamped geometry
            : spGeo3Full;                                     // full height — reuse shared geometry

          const mesh = new THREE.Mesh(geo, panelMat);
          mesh.position.set(side * (wallX - spThickness / 2), panelBot + effH / 2, pz);
          roomGroup.add(mesh);
        }
      }

    }

    renderHighlightOverlays(room);
    renderAnalysisOverlays(room);
    renderWallLabels(room);

    // Auto-toe: snap speakers to face the sphere after every full rebuild
    _applyAutoToe();

    // ---- SMOOTHNESS (Room Modal Standing Wave Field) ----
    if (overlayEnabled(OVERLAYS.SMOOTHNESS)) {

      const roughness = THREE.MathUtils.clamp(smoothnessStd / 5, 0, 1);
      const isRough = roughness > 0.55;
      const fieldColor = roughness > 0.8 ? 0xff3b3b : isRough ? 0xd97706 : 0x0f766e;
      const isFocSM = isFocused(OVERLAYS.SMOOTHNESS);

      // Populate uModes from real room mode data — vec4(p, q, weight, phase_offset)
      // Axial weighted 1.0, tangential 0.7, oblique 0.4 (Kuttruff energy weighting).
      // Golden-ratio phase offsets create a complex, non-periodic standing wave pattern.
      const smRawModes = window.MeasurelyAcoustics?.computeRoomModes(room) || [];
      const smModeData = [];
      smRawModes.slice(0, 12).forEach((m, i) => {
        const w = m.type === 'axial' ? 1.0 : m.type === 'tangential' ? 0.7 : 0.4;
        smModeData.push(new THREE.Vector4(m.p, m.q, w, i * Math.PI * 0.618));
      });
      while (smModeData.length < 12) smModeData.push(new THREE.Vector4(0, 0, 0, 0));

      const smMat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uRoomW: { value: room.width_m },
          uRoomL: { value: room.length_m },
          uModes: { value: smModeData },
          uRoughness: { value: roughness },
          uColor: { value: new THREE.Color(fieldColor) },
          uOpacity: { value: isFocSM ? 0.55 : 0.18 },
        },
        vertexShader: `
        uniform float uRoomW;
        uniform float uRoomL;
        varying vec2 vXZ;
        void main() {
          vXZ = vec2((uv.x - 0.5) * uRoomW, (0.5 - uv.y) * uRoomL);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
        fragmentShader: `
        #define PI 3.14159265359
        uniform float uTime;
        uniform float uRoomW;
        uniform float uRoomL;
        uniform float uRoughness;
        uniform vec3  uColor;
        uniform float uOpacity;
        uniform vec4  uModes[12];
        varying vec2  vXZ;
        void main() {
          float halfL = uRoomL * 0.5;
          float halfW = uRoomW * 0.5;
          float field = 0.0;
          float totalWeight = 0.001;
          
          for (int i = 0; i < 12; i++) {
            vec4 m = uModes[i];
            if (m.z > 0.0) {
              float w = m.z * (1.0 + uRoughness);
              float pL = cos(m.x * PI * (vXZ.y + halfL) / uRoomL); // length = y in vXZ
              float pW = cos(m.y * PI * (vXZ.x + halfW) / uRoomW); // width = x in vXZ
              // Use abs(cos) so modes always add, never cancel — field stays visible
              float amp = 0.7 + 0.3 * abs(cos(uTime * 1.2 + m.w));
              field += w * abs(pL * pW) * amp;
              totalWeight += w;
            }
          }

          field = field / totalWeight;
          gl_FragColor = vec4(uColor, clamp(field * uOpacity * 2.5, 0.0, 0.85));
        }
      `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      const smField = new THREE.Mesh(
        new THREE.PlaneGeometry(room.width_m, room.length_m, 1, 1),
        smMat
      );
      smField.rotation.x = -Math.PI / 2;
      smField.position.set(0, -room.height_m / 2 + (room.tweeter_height_m || 0.95), 0);
      smField.userData.isSmoothnessField = true;
      roomGroup.add(smField);

      // Focused: show axial mode pressure-node planes with frequencies from computeRoomModes()
      if (isFocSM) {
        const axialModes = smRawModes.filter(m => m.type === 'axial').slice(0, 5);
        axialModes.forEach(m => {
          const freqHz = Math.round(m.freq_hz);
          if (m.p > 0) {
            // Length-axis mode: nodes along Z
            for (let k = 0; k < m.p; k++) {
              const nodeZ = -room.length_m / 2 + (2 * k + 1) * room.length_m / (2 * m.p);
              const nodePlane = new THREE.Mesh(
                new THREE.PlaneGeometry(room.width_m * 0.9, room.height_m * 0.8),
                new THREE.MeshBasicMaterial({
                  color: 0xff3b3b, transparent: true,
                  opacity: 0.06, side: THREE.DoubleSide, depthWrite: false,
                })
              );
              nodePlane.position.set(0, 0, nodeZ);
              roomGroup.add(nodePlane);
              const lbl = _makeLabelSprite(`${freqHz} Hz`);
              lbl.position.set(room.width_m * 0.38, -room.height_m / 2 + room.height_m * 0.55, nodeZ);
              roomGroup.add(lbl);
            }
          } else if (m.q > 0) {
            // Width-axis mode: label only (node along X)
            const nodeX = (2 * 0 + 1) * room.width_m / (2 * m.q) - room.width_m / 2;
            const lbl = _makeLabelSprite(`${freqHz} Hz`);
            lbl.position.set(nodeX, -room.height_m / 2 + room.height_m * 0.75, 0);
            roomGroup.add(lbl);
          }
        });
      }
    }


  }

  /* ------------------------------------------
    ANIMATION LOOP
  ------------------------------------------ */
  function animate() {
    requestAnimationFrame(animate);

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
      const _colPink  = new THREE.Color(0xFF107A);
      const _colAmber = new THREE.Color(0xF59E0B);
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

    // WAVE RINGS — expanding circles from each speaker at tweeter height
    if (_waveRings.length > 0) {
      const _wt = performance.now() * 0.001;
      const WAVE_CYCLE = 2.8; // seconds per full cycle
      for (let wi = 0; wi < _waveRings.length; wi++) {
        const ring = _waveRings[wi];
        const phase = (_wt / WAVE_CYCLE + ring.userData.wavePhase) % 1.0;
        const r = phase * ring.userData.waveMaxR;
        ring.scale.set(r, 1, r);
        // Peak opacity = base 0.48 × waveAmp — REW nulls produce dimmer rings.
        // waveAmp is 1.0 in simulation mode (no REW data) so no visual regression.
        // Bumped from 0.28 → 0.48 along with the darker HSL lightness so the
        // rings read clearly against the cream canvas backdrop.
        const _peakOp = 0.48 * (ring.userData.waveAmp ?? 1.0);
        ring.material.opacity = Math.max(0, (1 - phase) * _peakOp);
        // Lerp toward treatment-driven target color (cyan=treated, pink=untreated)
        // Only override colour in simulation mode — REW data already set colour on build.
        if (ring.userData.targetColor && !_rewFreqs) {
          ring.material.color.lerp(ring.userData.targetColor, 0.03);
        }
      }
    }

    // SBIR interference field — advance time uniform (frozen when prefers-reduced-motion)
    {
      const sbirMesh = roomGroup.children.find(o => o.userData?.isSbirField);
      if (sbirMesh?.material?.uniforms && !sbirMesh.material.uniforms.uReducedMotion?.value) {
        sbirMesh.material.uniforms.uTime.value = performance.now() * 0.002;
      }
    }

    // Resonance field — advance time uniform (frozen when prefers-reduced-motion)
    {
      const bwMesh = roomGroup.children.find(o => o.userData?.isBandwidthField);
      if (bwMesh?.material?.uniforms && !bwMesh.material.uniforms.uReducedMotion?.value) {
        bwMesh.material.uniforms.uTime.value = performance.now() * 0.001;
      }
    }

    // Side reflection wave field — advance time uniform
    {
      const sideField = roomGroup.children.find(o => o.userData?.isSideRefField);
      if (sideField?.material?.uniforms && !sideField.material.uniforms.uReducedMotion?.value) {
        sideField.material.uniforms.uTime.value = performance.now() * 0.002;
      }
    }

    // Side reflection pings — advance time + lerp severity toward target (cyan→pink transition)
    {
      roomGroup.children
        .filter(o => o.userData?.isSideRefPing)
        .forEach(m => {
          if (m.material?.uniforms) {
            m.material.uniforms.uTime.value = performance.now() * 0.001;
            const target = m.userData.targetSeverity ?? 0;
            const current = m.material.uniforms.uSeverity.value;
            m.material.uniforms.uSeverity.value = current + (target - current) * 0.03;
          }
        });
    }

    // Smoothness field — advance shader time uniform
    {
      const smMesh = roomGroup.children.find(o => o.userData?.isSmoothnessField);
      if (smMesh) smMesh.material.uniforms.uTime.value = performance.now() * 0.001;
    }

    // Balance marker — gentle pulse
    {
      const _bt = performance.now() * 0.002;
      scene.traverse(obj => {
        if (obj.userData?.isBalanceMarker) {
          obj.scale.setScalar(1 + 0.18 * Math.sin(_bt));
        }
      });
    }

    roomGroup.scale.set(scale, scale, scale);
    if (flyAnim) flyAnim.tick(performance.now());
    controls.update();
    renderer.render(scene, camera);

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
  function _makeLabelSprite(text) {
    const W = 256, H = 56;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillStyle = '#9ca3af';
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

    // ---- FLOOR REFLECTION ----
    if (
      overlayEnabled(OVERLAYS.FLOOR_REFLECTION) &&
      room.floor_material === "hard"
    ) {
      const floorOverlay = new THREE.Mesh(
        new THREE.PlaneGeometry(
          room.width_m * 0.9,
          room.length_m * 0.6
        ),
        new THREE.MeshBasicMaterial({
          color: 0x00B8A9,
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
      const fTweeterY = -room.height_m / 2 + (room.tweeter_height_m || 0.95);
      const fEarY = -room.height_m / 2 + 1.0;
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
          0x00B8A9
        );
      }
    }

    // ---- SBIR ----
    if (overlayEnabled(OVERLAYS.SBIR)) {

      const sbirDepth = Math.max(room.spk_front_m || 0.2, 0.2);

      // Front wall panels and front/all bass traps are the primary SBIR fixes
      const hasFrontPanels = room.wall_panel_mode === 'front' || room.wall_panel_mode === 'both';
      const hasBassTraps   = room.bass_trap_mode  === 'front' || room.bass_trap_mode  === 'all';
      const sbirTreated    = simulatePanels || hasFrontPanels || hasBassTraps;
      // Secondary contributions from other panels — reduce overall room energy slightly
      const _sbirBonus = simulatePanels ? 0 : Math.min(
        (room.wall_panel_mode === 'rear'  || room.wall_panel_mode === 'both' ? 0.10 : 0) +
        (room.bass_trap_mode  === 'rear'  || room.bass_trap_mode  === 'all'  ? 0.08 : 0) +
        (room.side_panel_mode !== 'none' ? 0.06 : 0), 0.22);
      const sbirAbsorption = Math.min(sbirTreated ? 0.75 : _sbirBonus, 0.80);

      // Simulated improvement when front panels or bass traps enabled
      const effectiveScore = sbirTreated
        ? Math.min(activeScore + 1.8, 10)
        : activeScore;

      const isSevere = effectiveScore < 5;

      // Drive wave ring color: cyan = treated, pink = untreated (lerped in render loop)
      const _sbirRingTarget = new THREE.Color(sbirTreated ? 0x00F5FF : 0xFF107A);
      _waveRings.forEach(r => { r.userData.targetColor = _sbirRingTarget; });

      // ── Live SBIR interference field (ShaderMaterial) ─────────────────────
      // Two point sources per speaker (direct + front-wall mirror image).
      // The shader computes the exact wave interference at every pixel in the
      // horizontal plane at tweeter height — destructive bands = SBIR nulls.
      const fieldColor = isSevere ? 0xFF107A : 0x00B8A9;
      const tweeterY = -room.height_m / 2 + (room.tweeter_height_m || 0.95);
      const frontWallZ = -room.length_m / 2;
      const isFocSBIR = isFocused(OVERLAYS.SBIR);

      // Front wall glow — shaped to follow the ceiling profile
      const _fwHalfW = room.width_m / 2;
      const _fwHalfH = room.height_m / 2;
      const _fwFloorY = -_fwHalfH;
      const _fwHighY = _fwHalfH;
      const _fwLowY = room.ceiling_height_secondary_m != null
        ? -_fwHalfH + room.ceiling_height_secondary_m
        : _fwHighY;
      const _fwCeilType = room.ceiling_type || 'flat';
      const _fwSlantDir = room.ceiling_slant_direction || 'left_to_right';
      const _fwGableAxis = room.ceiling_gable_axis || 'depth';
      const _fwCeilAt = (x) => {
        if (_fwCeilType === 'slanted') {
          let t;
          switch (_fwSlantDir) {
            case 'left_to_right': t = (x + _fwHalfW) / room.width_m; break;
            case 'right_to_left': t = 1 - (x + _fwHalfW) / room.width_m; break;
            case 'front_to_back': t = 1; break; // front wall is high side
            case 'back_to_front': t = 0; break; // front wall is low side
            default: t = (x + _fwHalfW) / room.width_m;
          }
          return _fwLowY + t * (_fwHighY - _fwLowY);
        }
        if (_fwCeilType === 'gable') {
          const distRatio = _fwGableAxis === 'depth'
            ? Math.abs(x) / _fwHalfW
            : 1; // width-axis gable: front wall is at eave height
          return _fwHighY - distRatio * (_fwHighY - _fwLowY);
        }
        return _fwHighY;
      };
      const _fwShape = new THREE.Shape();
      const _fwSteps = 20;
      _fwShape.moveTo(-_fwHalfW, _fwFloorY);
      _fwShape.lineTo(_fwHalfW, _fwFloorY);
      for (let i = _fwSteps; i >= 0; i--) {
        const _sx = -_fwHalfW + (i / _fwSteps) * room.width_m;
        _fwShape.lineTo(_sx, _fwCeilAt(_sx));
      }
      _fwShape.closePath();
      const wallGlow = new THREE.Mesh(
        new THREE.ShapeGeometry(_fwShape),
        new THREE.MeshBasicMaterial({
          color: 0x00B8A9, transparent: true,
          opacity: isFocSBIR ? 0.12 : 0.06,
          side: THREE.DoubleSide, depthWrite: false
        })
      );
      wallGlow.position.set(offsetX, 0, frontWallZ + 0.01);
      roomGroup.add(wallGlow);

      // Wave number k = π/(2d) gives first SBIR null at f0 = C/(4d)
      const sbirK = Math.PI / (2 * sbirDepth);

      // Detect prefers-reduced-motion once at overlay build time
      const _sbirReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      // ── REW null depth: scale SBIR severity by measured magnitude ────────────
      // Sample the REW mags array at the geometric null frequency (c / 4d).
      // Deep measured null → scale stays at 1.0 (full shader intensity).
      // Shallow/treated null → scale reduces opacity so the shader reflects reality.
      // Falls back to 1.0 (full severity) when no REW data is present.
      let _sbirNullScale = 1.0;
      if (_rewFreqs && _rewMags && _rewFreqs.length > 0) {
        const _nullHz = 343 / (4 * sbirDepth);
        let _lo = 0, _hi = _rewFreqs.length - 1;
        while (_lo < _hi) {
          const _mid = (_lo + _hi) >> 1;
          if (_rewFreqs[_mid] < _nullHz) _lo = _mid + 1; else _hi = _mid;
        }
        // dBFS at null: -60 → scale 1.0 (severe), 0 → scale 0.1 (still visible)
        const _nullDB = _rewMags[_lo] ?? 0;
        _sbirNullScale = Math.max(0.1, Math.min(1.0, (-_nullDB) / 60));
      }

      const sbirMat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uK: { value: sbirK },
          // Single centre-speaker source — clean concentric rings from one origin
          uSpkC: { value: new THREE.Vector2(offsetX, frontWallZ + sbirDepth) },
          uRoomW: { value: room.width_m },
          uRoomL: { value: room.length_m },
          uOpacity: { value: (isFocSBIR ? 0.80 : 0.45) * _sbirNullScale },
          uAbsorption: { value: sbirAbsorption },
          uReducedMotion: { value: _sbirReducedMotion ? 1.0 : 0.0 },
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
          uniform float uRoomL;
          uniform float uOpacity;
          uniform float uAbsorption;
          uniform float uReducedMotion;
          varying vec2  vXZ;

          void main() {
            float wallZ = -uRoomL * 0.5;
            // Mirror image of speaker in front wall
            vec2 mirC = vec2(uSpkC.x, 2.0 * wallZ - uSpkC.y);

            float t    = uTime * (1.0 - uReducedMotion);
            float refl = 1.0 - uAbsorption;

            // Single-source: direct wave + front-wall reflection
            float direct    = sin(distance(vXZ, uSpkC) * uK - t);
            float reflected = refl * sin(distance(vXZ, mirC) * uK - t);
            float absField  = abs((direct + reflected) * 0.5);

            // Grey base with Neon Pink (#FF107A) at high-pressure peaks
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

      const sbirField = new THREE.Mesh(
        new THREE.PlaneGeometry(room.width_m, room.length_m, 1, 1),
        sbirMat
      );
      sbirField.rotation.x = -Math.PI / 2;
      sbirField.position.set(0, tweeterY, 0);
      sbirField.visible = _sbirFieldVisible;
      sbirField.userData.isSbirField = true;
      roomGroup.add(sbirField);

      // ------------------------------------------
      // SBIR CORNER BASS TRAPS (simulatePanels preview only)
      // Only shown when simulatePanels is active — the main room renderer already draws
      // real trap geometry when bass_trap_mode !== 'none', so these would double up.
      // Front corners (speaker wall, z = -length/2) are the SBIR-relevant corners.
      // ------------------------------------------
      if (simulatePanels) {
        const trapSize   = 0.35;
        const trapHeight = room.height_m * 0.9;

        const trapMaterial = new THREE.MeshBasicMaterial({
          color: 0x00B8A9,
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

      if (isFocused(OVERLAYS.SBIR)) {

        const speakerY  = -room.height_m / 2 + room.tweeter_height_m;
        const listenerZ = -room.length_m  / 2 + room.listener_front_m;
        const wallZ     = -room.length_m  / 2;

        // --- Toe-aware baffle origin ---
        // spkGroup.rotation.y = ±toeRad (L=+, R=-).
        // Speaker local +Z = forward (toward listener).
        // World-space forward = (-sin(toeY), 0, cos(toeY)) per Three.js Y-rotation convention.
        // Baffle world pos = spkCentre + forward * halfDepth.
        //
        // Inline depth table — getSpeakerProfile() is scoped inside rebuild(), not here.
        const _CABINET_DEPTH = { floorstander: 0.42, statement: 0.50, panel: 0.06, standmount: 0.25, monitor: 0.24 };
        const halfDepth  = (_CABINET_DEPTH[room.speaker_type] ?? 0.28) / 2;
        const toeRad     = (room.toe_in_deg || 0) * Math.PI / 180;
        const spkCentreZ = wallZ + room.spk_front_m;

        // Helper: compute baffle world position for a given speaker side.
        // toeSign: L=+1, R=-1 (matches spkGroup.rotation.y = side === 'L' ? +toeRad : -toeRad)
        function _bafflePos(centreX, toeSign) {
          const rotY = toeSign * toeRad;
          // Three.js Y-rotation: forward world = (-sin(rotY), 0, cos(rotY))
          const fwdX = -Math.sin(rotY);
          const fwdZ =  Math.cos(rotY);
          return new THREE.Vector3(
            centreX + fwdX * halfDepth,
            speakerY,
            spkCentreZ + fwdZ * halfDepth
          );
        }

        const beamColor = effectiveScore < 5 ? 0xFF107A : 0x00FFFF;

        const centreXL = offsetX - room.spk_spacing_m / 2;
        const centreXR = offsetX + room.spk_spacing_m / 2;

        // LEFT speaker front baffle → front wall → listener
        drawReflectionPath(
          _bafflePos(centreXL, +1),
          new THREE.Vector3(centreXL, speakerY, wallZ),
          new THREE.Vector3(offsetX,  speakerY, listenerZ),
          beamColor,
          sbirAbsorption          // ping absorption from treatment state
        );

        // RIGHT speaker front baffle → front wall → listener
        drawReflectionPath(
          _bafflePos(centreXR, -1),
          new THREE.Vector3(centreXR, speakerY, wallZ),
          new THREE.Vector3(offsetX,  speakerY, listenerZ),
          beamColor,
          sbirAbsorption          // ping absorption from treatment state
        );
      }

    }

    // ---- SIDE WALL REFLECTIONS ----
    if (overlayEnabled(OVERLAYS.SIDE_REFLECTIONS)) {

      const sideGap = (room.width_m - room.spk_spacing_m) / 2;
      const isTooClose = sideGap < 0.6;
      const sideMode      = room.side_panel_mode;
      const hasSidePanels = sideMode !== 'none';
      // Per-side absorption — left/right walls treated independently
      const hasCeilingCloud = room.ceiling_panel_mode !== 'none';
      const _cloudBonus     = hasCeilingCloud ? 0.15 : 0.0;
      // Front/rear panels reduce overall room energy, giving a small side-reflection bonus
      const _wallBonus = simulatePanels ? 0 : Math.min(
        (room.wall_panel_mode === 'front' || room.wall_panel_mode === 'both' ? 0.10 : 0) +
        (room.wall_panel_mode === 'rear'  || room.wall_panel_mode === 'both' ? 0.08 : 0), 0.16);
      const absL = Math.min((simulatePanels || sideMode === 'both' || sideMode === 'left')  ? 0.75 + _cloudBonus + _wallBonus : _cloudBonus + _wallBonus, 0.85);
      const absR = Math.min((simulatePanels || sideMode === 'both' || sideMode === 'right') ? 0.75 + _cloudBonus + _wallBonus : _cloudBonus + _wallBonus, 0.85);

      // Ping rate: fast = uncontrolled reflections, slow when panels absorbing energy
      const pingRate = (simulatePanels || sideMode === 'both') ? 0.9
                     : (sideMode !== 'none')                  ? 1.8
                     : 2.8;
      const isFocSide = focusedOverlay === OVERLAYS.SIDE_REFLECTIONS;

      // ── REW 2–8 kHz energy → reflection severity scale ──────────────────
      // _sideRefEnergy: mean dBFS in the reflection-audibility band.
      // _sideRefScale:  0.25 (dead room) … 1.0 (harsh room) — multiplied into
      //                 shader opacity and per-wall mirror coefficients.
      // _rewDelta:      score offset so REW-confirmed harsh rooms score worse
      //                 and naturally-damped rooms score better than geometry alone.
      const _sideRefEnergy = _rewBandEnergy(2000, 8000, -20);
      const _sideRefScale  = Math.max(0.25, Math.min(1.0, (_sideRefEnergy + 60) / 54));
      const _rewDelta      = _rewFreqs
        ? Math.max(-1.5, Math.min(2.0, (_sideRefEnergy + 20) / 10))
        : 0;

      let effectiveScore = activeScore + _rewDelta;
      if (simulatePanels && isTooClose)          effectiveScore = Math.min(effectiveScore + 2.0, 10);
      if (simulatePanels || sideMode === 'both') effectiveScore = Math.min(effectiveScore + 1.5, 10);
      else if (sideMode !== 'none')              effectiveScore = Math.min(effectiveScore + 0.8, 10);
      if (hasCeilingCloud)                       effectiveScore = Math.min(effectiveScore + 0.4, 10);
      effectiveScore = Math.max(0, Math.min(10, effectiveScore));

      const tweeterY = -room.height_m / 2 + room.tweeter_height_m;
      const spkZ = -room.length_m / 2 + room.spk_front_m;
      // Wave number based on speaker-to-wall gap — tighter gap = more rings
      const sideK = Math.PI / Math.max(sideGap, 0.3);
      const _sideRM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      // ── Grey/Pink wave field — same scheme as SBIR ──────────
      // uOpacity and mirror coefficients scaled by REW 2–8 kHz energy:
      //   full measured energy → full field brightness and strong mirror waves
      //   dead/treated room   → dim field and attenuated mirror reflection
      const sideMat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uK: { value: sideK },
          // Centre speaker + mirror images across each side wall
          uSpkC: { value: new THREE.Vector2(offsetX, spkZ) },
          uMirL: { value: new THREE.Vector2(-room.width_m - offsetX, spkZ) },
          uMirR: { value: new THREE.Vector2(room.width_m - offsetX, spkZ) },
          uRoomW: { value: room.width_m },
          uRoomL: { value: room.length_m },
          uOpacity: { value: (isFocSide ? 0.78 : 0.38) * _sideRefScale },
          uReflL:   { value: (1.0 - absL) * _sideRefScale },
          uReflR:   { value: (1.0 - absR) * _sideRefScale },
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
            // Direct wave from speaker centre
            float direct = sin(distance(vXZ, uSpkC) * uK - t);
            // Reflected waves — per-side coefficient so each wall cools independently
            float reflL  = uReflL * sin(distance(vXZ, uMirL) * uK - t);
            float reflR  = uReflR * sin(distance(vXZ, uMirR) * uK - t);
            float absField = abs((direct + reflL + reflR) * 0.33);

            // Grey base with Neon Pink (#FF107A) at high-interference peaks
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
      sideField.position.set(0, tweeterY, 0);
      sideField.userData.isSideRefField = true;
      roomGroup.add(sideField);

      // ── Focused: paths + animated pings at first-reflection points ──
      if (isFocused(OVERLAYS.SIDE_REFLECTIONS)) {

        const listenerPos = new THREE.Vector3(
          offsetX, tweeterY,
          -room.length_m / 2 + room.listener_front_m
        );
        const wallX = room.width_m / 2;

        // ── Worst-wall targeting (focused mode only) ─────────────────────
        // Listener offset biases path lengths: a rightward offset makes the
        // left wall's reflection arrive earlier (shorter path = more harmful).
        // Per-side severity = REW scale × path-length bias × (1 - absorption).
        const _lstnOff   = room.listener_offset_m || 0;
        const _halfW     = room.width_m * 0.5;
        const _leftBias  = 1.0 + _lstnOff / Math.max(_halfW, 0.1);
        const _rightBias = 1.0 - _lstnOff / Math.max(_halfW, 0.1);
        const _leftSev   = _sideRefScale * Math.max(0.1, _leftBias)  * (1 - absL);
        const _rightSev  = _sideRefScale * Math.max(0.1, _rightBias) * (1 - absR);
        // worstSide: -1 = left wall is worse, +1 = right wall is worse
        const _worstSide = _leftSev >= _rightSev ? -1 : 1;

        for (const side of [-1, 1]) {

          const speakerPos = new THREE.Vector3(
            offsetX + side * room.spk_spacing_m / 2,
            tweeterY,
            -room.length_m / 2 + room.spk_front_m
          );

          // Mirror speaker across nearest side wall → find bounce point
          const mirrorSpeaker = speakerPos.clone();
          mirrorSpeaker.x = side * wallX + (side * wallX - speakerPos.x);

          const dir = new THREE.Vector3().subVectors(mirrorSpeaker, listenerPos);
          const tHit = (side * wallX - listenerPos.x) / dir.x;
          const bouncePoint = listenerPos.clone().add(dir.multiplyScalar(tHit));

          // Does this specific wall have a panel?
          const thisSideHasPanel = simulatePanels
            || sideMode === 'both'
            || (side === -1 && sideMode === 'left')
            || (side ===  1 && sideMode === 'right');

          // Worst-wall flag: true when this side has higher combined severity
          const isWorstWall = (side === _worstSide);

          // Elliptical treatment panel at first-reflection point
          if (thisSideHasPanel) {
            const ellipseShape = new THREE.Shape();
            ellipseShape.absellipse(0, 0, 0.45, 0.6, 0, Math.PI * 2, false, 0);
            const panel = new THREE.Mesh(
              new THREE.ShapeGeometry(ellipseShape, 40),
              new THREE.MeshBasicMaterial({
                color: 0x22c55e, transparent: true, opacity: 0.28,
                side: THREE.DoubleSide, depthWrite: false
              })
            );
            panel.rotation.y = Math.PI / 2;
            panel.position.set(side * (wallX - 0.01), bouncePoint.y, bouncePoint.z);
            roomGroup.add(panel);
          }

          // ── Reflection path lines ───────────────────────────────────────
          // Worst wall gets full brightness + red hotspot; other wall is 60% opacity.
          const _pathColor = effectiveScore < 5 ? 0xFF107A : (isWorstWall ? 0xFF6B35 : 0x00B8A9);
          drawReflectionPath(
            speakerPos, bouncePoint, listenerPos,
            _pathColor,
            thisSideHasPanel ? 0.72 : 0
          );

          // Worst-wall label (focused mode only) — shows which wall REW+geometry
          // predicts as the primary smearing source.
          if (isWorstWall) {
            const _lbl = _makeLabelSprite(
              _rewFreqs ? `Most energy (${_sideRefEnergy.toFixed(0)} dBFS avg)` : 'Check this wall'
            );
            _lbl.position.set(side * (wallX - 0.15), tweeterY + 0.55, bouncePoint.z);
            roomGroup.add(_lbl);
          }

          // Animated ping — fast pulse when no panels, slow when absorbed
          const pingMat = new THREE.ShaderMaterial({
            uniforms: {
              uTime: { value: 0 },
              uRate: { value: pingRate },
              uSeverity: { value: 0.0 },  // always start cyan; lerped toward targetSeverity in render loop
            },
            vertexShader: `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `
              uniform float uTime;
              uniform float uRate;
              uniform float uSeverity;
              void main() {
                float pulse = 0.5 + 0.5 * sin(uTime * uRate);
                vec3 cyan = vec3(0.0, 0.957, 1.0);   // --mly-teal-neon #00F5FF
                vec3 pink = vec3(1.0, 0.063, 0.478);  // Neon Pink #FF107A
                gl_FragColor = vec4(mix(cyan, pink, uSeverity), pulse * 0.92);
              }
            `,
            transparent: true,
            depthWrite: false,
          });
          const ping = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), pingMat);
          ping.position.copy(bouncePoint);
          ping.userData.isSideRefPing = true;
          ping.userData.targetSeverity = thisSideHasPanel ? 0.0 : (isTooClose ? 1.0 : 0.0);
          roomGroup.add(ping);
        }
      }
    }

    // ---- REAR WALL ENERGY ----
    if (overlayEnabled(OVERLAYS.REAR_ENERGY)) {
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
          color: 0xf59e0b,
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
    }

    // ---- COFFEE TABLE ----
    if (overlayEnabled(OVERLAYS.COFFEE_TABLE)) {
      const tableReflection = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.15, 0.7),
        new THREE.MeshBasicMaterial({
          color: 0x0d9488,
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
    }

    // ---- BANDWIDTH (ROOM MODE RESONANCE FIELD) ----
    if (overlayEnabled(OVERLAYS.BANDWIDTH)) {

      const isFocBW = focusedOverlay === OVERLAYS.BANDWIDTH;
      const _bwReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      // Ceiling profile — re-derived here because renderAnalysisOverlays is a sibling
      // of rebuild(), not nested inside it, so rebuild()'s const isGable etc. are out of scope.
      const _bwIsSlanted = room.ceiling_type === 'slanted';
      const _bwIsGable = room.ceiling_type === 'gable';
      const _bwSlantDir = room.ceiling_slant_direction || 'left_to_right';
      const _bwGableAxis = room.ceiling_gable_axis || 'depth';
      const _bwFloorY = -room.height_m / 2;
      const _bwLowH = (_bwIsSlanted || _bwIsGable)
        ? Math.min(room.ceiling_height_secondary_m ?? room.height_m, room.height_m)
        : room.height_m;
      const _bwHighY = room.height_m / 2;
      const _bwLowY = _bwFloorY + _bwLowH;

      // Predictive model: not a physical measurement
      const bwModes = window.MeasurelyAcoustics?.computeRoomModes(room) || [];

      // Speaker archetype determines low-frequency energy injection.
      // Bookshelf rolls off ~55 Hz; floorstander ~30 Hz; statement ~20 Hz.
      const speakerArchetype = room.speaker_type || 'bookshelf';
      const bassRolloffByType = { bookshelf: 55, floorstander: 30, statement: 20 };
      const bassRolloffHz = bassRolloffByType[speakerArchetype] ?? 55;

      // Build 3D mode data — include height axis (r) for volumetric pressure field.
      // Mode type weights: axial 1.0, tangential 0.7, oblique 0.4.
      const modeTypeWeight = { axial: 1.0, tangential: 0.7, oblique: 0.4 };
      const uBwModes = [];
      bwModes.slice(0, 8).forEach(m => {
        const typeWeight = modeTypeWeight[m.type] ?? 1.0;
        // Modes below speaker bass rolloff get reduced contribution — less energy injected
        const bassEnergyScale = (m.freq_hz <= bassRolloffHz) ? 0.30 : 1.0;
        uBwModes.push(new THREE.Vector4(m.p, m.q, m.r, typeWeight * bassEnergyScale));
      });
      while (uBwModes.length < 8) uBwModes.push(new THREE.Vector4(0, 0, 0, 0));

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

      // Ceiling clip uniforms — discard fragments that fall outside the actual room volume.
      // Encoded: uSlantDir 0=left_to_right, 1=right_to_left, 2=front_to_back, 3=back_to_front
      const bwSlantDirCode = { left_to_right: 0, right_to_left: 1, front_to_back: 2, back_to_front: 3 };

      const bwMat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uRoomW: { value: room.width_m },
          uRoomL: { value: room.length_m },
          uRoomH: { value: room.height_m },
          uOpacity: { value: isFocBW ? 0.55 : 0.28 },
          uModes: { value: uBwModes },
          uOscRate: { value: visualOscillationRate },
          uBassTrapsF: { value: bwBassTrapsF },
          uBassTrapsR: { value: bwBassTrapsR },
          uBtSide:     { value: bwSidePanels },
          uReducedMotion: { value: _bwReducedMotion ? 1.0 : 0.0 },
          // Ceiling profile — for gable and slanted rooms, discard above the slope
          uIsGable: { value: _bwIsGable ? 1.0 : 0.0 },
          uIsSlanted: { value: _bwIsSlanted ? 1.0 : 0.0 },
          uGableDepthAxis: { value: _bwGableAxis === 'depth' ? 1.0 : 0.0 },
          uEavesY: { value: _bwLowY },   // lowest ceiling point (eave or slant low end)
          uPeakY: { value: _bwHighY },   // highest ceiling point (ridge or slant high end)
          uSlantDir: { value: bwSlantDirCode[_bwSlantDir] ?? 0 },
        },
        vertexShader: `
          varying vec3 vWorldPos;
          void main() {
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPos = worldPosition.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPosition;
          }
        `,
        fragmentShader: `
          #define PI 3.14159265359
          uniform float uTime;
          uniform float uRoomW;
          uniform float uRoomL;
          uniform float uRoomH;
          uniform float uOpacity;
          uniform float uOscRate;
          uniform float uBassTrapsF;
          uniform float uBassTrapsR;
          uniform float uBtSide;
          uniform float uReducedMotion;
          uniform vec4  uModes[8];
          uniform float uIsGable;
          uniform float uIsSlanted;
          uniform float uGableDepthAxis;
          uniform float uEavesY;
          uniform float uPeakY;
          uniform float uSlantDir;
          varying vec3  vWorldPos;

          void main() {
            // Clip fragments above the actual ceiling profile so the pressure field
            // never breaks through a gabled or slanted roof surface.
            if (uIsGable > 0.5) {
              float halfW    = uRoomW * 0.5;
              float halfL    = uRoomL * 0.5;
              float distRatio = (uGableDepthAxis > 0.5)
                ? abs(vWorldPos.x) / halfW   // gable ridge runs along Z (depth axis)
                : abs(vWorldPos.z) / halfL;  // gable ridge runs along X (width axis)
              float maxCeilingY = mix(uPeakY, uEavesY, distRatio);
              if (vWorldPos.y > maxCeilingY) discard;
            } else if (uIsSlanted > 0.5) {
              float halfW = uRoomW * 0.5;
              float halfL = uRoomL * 0.5;
              float t;
              if      (uSlantDir < 0.5) t = (vWorldPos.x + halfW) / uRoomW;          // left_to_right
              else if (uSlantDir < 1.5) t = 1.0 - (vWorldPos.x + halfW) / uRoomW;   // right_to_left
              else if (uSlantDir < 2.5) t = 1.0 - (vWorldPos.z + halfL) / uRoomL;   // front_to_back
              else                      t = (vWorldPos.z + halfL) / uRoomL;          // back_to_front
              float maxCeilingY = mix(uEavesY, uPeakY, t);
              if (vWorldPos.y > maxCeilingY) discard;
            }

            // Normalised position within room volume [0..1] on each axis
            float nx = (vWorldPos.x + uRoomW * 0.5) / uRoomW;
            float ny = (vWorldPos.y + uRoomH * 0.5) / uRoomH;
            float nz = (vWorldPos.z + uRoomL * 0.5) / uRoomL;

            float pressure    = 0.0;
            float totalWeight = 0.001;

            for (int i = 0; i < 8; i++) {
              vec4 m = uModes[i];
              if (m.w > 0.0) {
                float pressureLength = cos(m.x * PI * nz);
                float pressureWidth  = cos(m.y * PI * nx);
                float pressureHeight = cos(m.z * PI * ny);
                pressure    += m.w * abs(pressureLength * pressureWidth * pressureHeight);
                totalWeight += m.w;
              }
            }

            pressure /= totalWeight;

            // Spatially blend absorption based on proximity to each wall.
            // nz: 0=front wall (speakers), 1=rear wall. nx: 0=left wall, 1=right wall.
            float frontProx  = smoothstep(0.5, 0.0, nz);
            float rearProx   = smoothstep(0.5, 1.0, nz);
            float leftProx   = smoothstep(0.5, 0.0, nx);
            float rightProx  = smoothstep(0.5, 1.0, nx);
            float localTraps = max(
              max(frontProx * uBassTrapsF, rearProx * uBassTrapsR),
              (leftProx + rightProx) * uBtSide
            );

            // Bass traps damp the standing wave energy at treated corners.
            // 0.35 factor: full traps cut peak pressure by ~35%, visibly cooling corners.
            pressure *= (1.0 - localTraps * 0.35);

            // Resonance breathing: standing wave oscillates at dominant mode frequency.
            // uOscRate = f_dominant / 40 gives a 2–4 second visual cycle.
            // Frozen when prefers-reduced-motion is active.
            float resonancePulse = 0.80 + 0.20 * cos(uTime * uOscRate * (1.0 - uReducedMotion));
            pressure *= resonancePulse;

            // Neon Purple (#7C3AED) → Neon Pink (#FF107A) at absolute pressure peaks.
            // localTraps shifts the pink threshold — treated corners cool to purple/void.
            vec3 neonPurple = vec3(0.486, 0.227, 0.929);
            vec3 neonPink   = vec3(1.000, 0.063, 0.478);
            vec3 voidColor  = vec3(0.020, 0.010, 0.050);

            float pinkLow  = mix(0.65, 0.82, localTraps);
            float pinkHigh = mix(1.00, 1.30, localTraps);

            vec3 midColor   = mix(voidColor, neonPurple, smoothstep(0.20, 0.70, pressure));
            vec3 finalColor = mix(midColor,  neonPink,   smoothstep(pinkLow, pinkHigh, pressure));

            float opacity = clamp(pressure * uOpacity * 1.8 + 0.03, 0.0, 0.80);
            gl_FragColor = vec4(finalColor, opacity);
          }
        `,
        transparent: true,
        depthWrite: false,
        // BackSide renders only the inner faces — the near wall becomes transparent,
        // letting the camera see the pressure field on far walls, ceiling, and floor
        // without the 6-face opacity stacking that made it look like a solid grey box.
        side: THREE.BackSide,
      });

      // Full-room volume — BackSide makes the near wall invisible so the interior
      // pressure field reads clearly through the wireframe cage.
      const resonanceVolume = new THREE.Mesh(
        new THREE.BoxGeometry(room.width_m, room.height_m, room.length_m),
        bwMat
      );
      resonanceVolume.userData.isBandwidthField = true;
      roomGroup.add(resonanceVolume);
    }

    // ---- BALANCE (STEREO SYMMETRY) ----
    if (overlayEnabled(OVERLAYS.BALANCE)) {

      const halfW = room.width_m / 2;
      const halfL = room.length_m / 2;
      const floorY = -room.height_m / 2;
      const spkY = floorY + room.tweeter_height_m;
      const lstnZ = -halfL + room.listener_front_m;
      const offset = room.listener_offset_m || 0;
      const isBad = Math.abs(offset) > 0.15;
      const isFocBal = isFocused(OVERLAYS.BALANCE);

      const spkL = new THREE.Vector3(offsetX - room.spk_spacing_m / 2, spkY, -halfL + room.spk_front_m);
      const spkR = new THREE.Vector3(offsetX + room.spk_spacing_m / 2, spkY, -halfL + room.spk_front_m);
      const lstn = new THREE.Vector3(offsetX + offset, spkY, lstnZ);
      const alpha = isFocBal ? 0.75 : 0.12;

      // 1. Centre axis tube along the floor
      _addReflectionTube(
        new THREE.Vector3(0, floorY + 0.01, -halfL + 0.15),
        new THREE.Vector3(0, floorY + 0.01, halfL - 0.15),
        0xffffff, isFocBal ? 0.65 : 0.18
      );

      // 2. Stereo triangle: L→listener, R→listener, L→R base
      [[spkL, lstn], [spkR, lstn], [spkL, spkR]].forEach(([a, b]) => {
        _addReflectionTube(a, b, 0x0d9488, alpha);
      });

      // 3. Sweet spot ring on floor (±15 cm ideal zone)
      const sweetRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.15, 0.012, 6, 48),
        new THREE.MeshBasicMaterial({
          color: 0x0d9488, transparent: true,
          opacity: isFocBal ? 0.75 : 0.2, depthWrite: false
        })
      );
      sweetRing.rotation.x = Math.PI / 2;
      sweetRing.position.set(offsetX, floorY + 0.01, lstnZ);
      roomGroup.add(sweetRing);

      // 4. Actual listener position marker (pulses, red if off-axis)
      const markerColor = isBad ? 0xff3b3b : 0x0d9488;
      const markerRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.08, 0.016, 6, 32),
        new THREE.MeshBasicMaterial({
          color: markerColor, transparent: true,
          opacity: isFocBal ? 0.9 : 0.35, depthWrite: false
        })
      );
      markerRing.rotation.x = Math.PI / 2;
      markerRing.position.set(offsetX + offset, floorY + 0.01, lstnZ);
      markerRing.userData.isBalanceMarker = true;
      roomGroup.add(markerRing);

      // 5. Focused: offset label
      if (isFocBal) {
        const cm = Math.round(Math.abs(offset) * 100);
        const lbl = _makeLabelSprite(cm > 5 ? `${cm} cm off-axis` : 'Centred ✓');
        lbl.position.set(offsetX + offset, floorY + 0.6, lstnZ);
        roomGroup.add(lbl);
      }
    }

    // ---- CLARITY (EARLY REFLECTION WINDOW) ----
    if (overlayEnabled(OVERLAYS.CLARITY)) {

      const floorY = -room.height_m / 2;
      const ceilY = room.height_m / 2;
      const speakerY = floorY + room.tweeter_height_m;
      const listenerZ = -room.length_m / 2 + room.listener_front_m;
      const listenerPos = new THREE.Vector3(offsetX, speakerY, listenerZ);
      const isFocCl = isFocused(OVERLAYS.CLARITY);
      const wallX = room.width_m / 2;
      const clarityR = 0.8;

      // 1. Direct beams (speaker → listener) — solid tubes
      [-1, 1].forEach(side => {
        const spkPos = new THREE.Vector3(
          offsetX + side * room.spk_spacing_m / 2,
          speakerY,
          -room.length_m / 2 + room.spk_front_m
        );
        _addReflectionTube(spkPos, listenerPos, 0x0d9488, isFocCl ? 0.80 : 0.18);
      });

      // 2. Listener bubble
      roomGroup.add(Object.assign(new THREE.Mesh(
        new THREE.SphereGeometry(clarityR, 24, 16),
        new THREE.MeshBasicMaterial({ color: 0x0d9488, transparent: true, opacity: isFocCl ? 0.28 : 0.05, depthWrite: false })
      ), { position: listenerPos.clone() }));

      // Foot ring on floor
      const footRing = new THREE.Mesh(
        new THREE.TorusGeometry(clarityR * 0.55, 0.012, 6, 48),
        new THREE.MeshBasicMaterial({ color: 0x0d9488, transparent: true, opacity: isFocCl ? 0.55 : 0.1, depthWrite: false })
      );
      footRing.rotation.x = Math.PI / 2;
      footRing.position.set(listenerPos.x, floorY + 0.01, listenerPos.z);
      roomGroup.add(footRing);

      // 3. Side-wall reflections — tubes + bounce dots + travelling dots
      [-1, 1].forEach(side => {
        const spkPos = new THREE.Vector3(
          offsetX + side * room.spk_spacing_m / 2,
          speakerY,
          -room.length_m / 2 + room.spk_front_m
        );
        // Geometric bounce on side wall
        const bounceZ = spkPos.z + (listenerZ - spkPos.z) * (side * wallX - spkPos.x) / (side * wallX * 2 - spkPos.x - (offsetX + (room.listener_offset_m || 0)));
        const bounce = new THREE.Vector3(side * wallX, speakerY, THREE.MathUtils.clamp(bounceZ, -room.length_m / 2 + 0.1, room.length_m / 2 - 0.1));
        const reflPath = spkPos.distanceTo(bounce) + bounce.distanceTo(listenerPos);
        const directPath = spkPos.distanceTo(listenerPos);
        const hitsBubble = (reflPath - directPath) / 343 * 1000 < 15; // red if delay < 15 ms
        drawReflectionPath(spkPos, bounce, listenerPos, hitsBubble ? 0xff3b3b : 0x0d9488);

        if (isFocCl) {
          const dist = spkPos.distanceTo(bounce) + bounce.distanceTo(listenerPos);
          const delayMs = Math.round((dist - spkPos.distanceTo(listenerPos)) / 343 * 1000);
          const lbl = _makeLabelSprite(`${delayMs} ms`);
          lbl.position.set(bounce.x * 0.85, speakerY + 0.55, bounce.z);
          roomGroup.add(lbl);
        }
      });

      // 4. Ceiling reflections — indigo tubes + travelling dots
      const _cloudMitigatesCeil = room.ceiling_panel_mode !== 'none';
      [-1, 1].forEach(side => {
        const spkPos = new THREE.Vector3(
          offsetX + side * room.spk_spacing_m / 2,
          speakerY,
          -room.length_m / 2 + room.spk_front_m
        );
        const ceilBounce = new THREE.Vector3(
          (spkPos.x + listenerPos.x) / 2,
          ceilY,
          (spkPos.z + listenerPos.z) / 2
        );
        drawReflectionPath(spkPos, ceilBounce, listenerPos, _cloudMitigatesCeil ? 0x0d9488 : 0x6366f1);

        if (isFocCl) {
          const dist = spkPos.distanceTo(ceilBounce) + ceilBounce.distanceTo(listenerPos);
          const delayMs = Math.round((dist - spkPos.distanceTo(listenerPos)) / 343 * 1000);
          const lbl = _makeLabelSprite(`${delayMs} ms`);
          lbl.position.set(ceilBounce.x, ceilY - 0.3, ceilBounce.z);
          roomGroup.add(lbl);
        }
      });
    }

  }

  /* ------------------------------------------
     START
  ------------------------------------------ */
  console.log("[Room3D] 🚀 Starting engine | mountId:", mountId, "| stage:", renderStage);
  rebuild();
  animate();

  // ── Cloud data reactivity ────────────────────────────────────────────────
  // pullRoom() in sync.js dispatches this event after writing to localStorage.
  // auth.js also dispatches it when seeding a new user's default layout.
  // Using { once: true } so a single login never fires duplicate rebuilds.
  // _freshRoomOverride lets us bypass a stale local roomState in the caller.
  window.addEventListener('measurely:data-ready', function _onCloudRoom(e) {
    if (e.detail?.room) _freshRoomOverride = e.detail.room;
    rebuild();
  }, { once: true });

  /* ------------------------------------------
     PUBLIC API
     Also exported to window.room3d so the
     instance is always inspectable from the
     browser console regardless of which page
     initialised it.
  ------------------------------------------ */
  const api = {
    update: rebuild,

    setMode(newMode) {
      console.log("[Room3D] 🔄 setMode()", newMode);

      currentMode = newMode;

      if (newMode === "analysing") {
        analysisStart = performance.now();
        analysisPulse = 0;
        console.log("[Room3D] ▶ analysisStart =", analysisStart);
      }

      if (newMode === "final") {
        // default dashboard overlays
        activeOverlays.clear();
        activeOverlays.add(OVERLAYS.FLOOR_REFLECTION);
        activeOverlays.add(OVERLAYS.SBIR);
        activeOverlays.add(OVERLAYS.SIDE_REFLECTIONS);
        activeOverlays.add(OVERLAYS.REAR_ENERGY);
        activeOverlays.add(OVERLAYS.COFFEE_TABLE);
        activeOverlays.add(OVERLAYS.CLARITY);

      }

      rebuild();
    },

    setStage(newStage) {
      console.log("[Room3D] 🎭 setStage()", newStage);
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
      console.log("[Room3D] 🛋 updateFurniture()", typeHint ?? "");
      renderStage = "furnishings";
      rebuild();
    },

    resetView() {
      console.log("[Room3D] 🔄 resetView()");
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

    focusIssue(id, score = 10, std = 0) {
      console.log("[Room3D] 🎯 focusIssue()", id, "score =", score, "std =", std);

      activeOverlays.clear();
      if (id) activeOverlays.add(id);   // null/falsy = clear all overlays, no rebuild artefact

      focusedOverlay = id ?? null;
      activeScore = score;

      if (id === OVERLAYS.SMOOTHNESS) {
        smoothnessStd = std;   // store smoothness strength
      }

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

    getFocus() {
      return { id: focusedOverlay, score: activeScore, std: smoothnessStd };
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
              // Landed — leave controls disabled; caller decides what comes next
              camera.position.set(frame.cam.x, frame.cam.y, frame.cam.z);
              controls.target.set(frame.look.x, frame.look.y, frame.look.z);
              controls.update();
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
      } else {
        // Boolean toggle (simulation / off)
        _wavesEnabled = !!freqs;
        if (!freqs) { _rewFreqs = null; _rewMags = null; }
      }
      rebuild();
    },

    /** Toggle the SBIR interference heatmap field without hiding the ping/path geometry. */
    setSbirField(enabled) {
      _sbirFieldVisible = !!enabled;
      const m = roomGroup.children.find(o => o.userData?.isSbirField);
      if (m) m.visible = _sbirFieldVisible;
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