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
  fov:    70,
  near:   0.1,
  far:    1000,
  pos:    { x: 5.0, y: 3.5, z: 6.0 },
  target: { x: 0,   y: 0,   z: 0   }
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
  let _roomWidthOverride  = null;
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

  let colourState    = "idle";
  let highlightTarget = null; // 'speakers' | 'listener' | 'wall_length' | 'wall_width' | 'wall_height' | null


  const isDesktop = window.innerWidth >= 900;
  const isTablet = window.innerWidth < 900;

  const baseScale = isDesktop ? 1.1 : 1;

  // WebGL lineWidth is capped at 1px on most GPUs (it's a spec limitation).
  // On high-DPR mobile (2–3×) that becomes visually sub-pixel.
  // On tablet/mobile we replace LineSegments with thin mesh tube geometry so
  // the wireframe is reliably visible regardless of device pixel ratio.
  // EDGE_TUBE_T: tube cross-section in metres (negligible in 3D, visible on screen).
  const EDGE_TUBE_T   = isTablet ? 0.038 : 0.016;
  const useFatEdges   = isTablet;   // desktop keeps fast LineSegments path

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
  let _spkMeshL      = null;  // Left  speaker mesh (for auto-toe)
  let _spkMeshR      = null;  // Right speaker mesh (for auto-toe)
  let _beamGeoL      = null;  // Left  beam BufferGeometry (for live endpoint update)
  let _beamGeoR      = null;  // Right beam BufferGeometry
  let _listenStation = null;  // Group: sphere + rug + sofa + coffee table
  let _autoToe       = false; // Auto-toe disabled by default; use toe_in_deg from room data
  let _autoToeAngle  = 0;     // Last computed angle (radians) — readable via API
  let _waveRings     = [];    // Expanding wave ring Lines, repopulated on rebuild
  let _wavesEnabled  = false; // Off by default; toggled via api.setWaves()

  // ── Room-geometry refs (for live resize without full rebuild) ─
  let _roomShell = null;  // LineSegments of the flat-ceiling wireframe box
  let _roomFloor = null;  // Floor plane mesh
  let _roomGrid  = null;  // GridHelper


  // ── Auto Toe-In ───────────────────────────────────────────
  // Rotates both speaker meshes to face the listener sphere using the
  // sphere's actual world position (via getWorldPosition) so that the
  // calculation is correct even when the station group is scaled/parented.
  const _tmpSphereWorld = new THREE.Vector3();
  const _tmpSpkWorld    = new THREE.Vector3();

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
      const s = d.setup    || d;
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
      geometry:    { length_m: 5, width_m: 4, height_m: 2.6,
                     ceiling_type: 'flat', ceiling_slant_direction: 'left_to_right',
                     ceiling_gable_axis: 'depth', ceiling_height_secondary_m: 2.0 },
      setup:       { speaker_type: 'standmount', spk_spacing_m: 2.0, spk_front_m: 0.45,
                     tweeter_height_m: 0.95, toe_in_deg: 12, listener_front_m: 2.8,
                     listener_offset_m: 0, subwoofer: false },
      environment: { room_type: 'home', floor_material: 'hard',
                     furniture: { opt_area_rug: true,  opt_sofa: true,
                                  opt_coffee_table: false, opt_desk: false, opt_chair: false,
                                  seating_type: 'sofa' },
                     treatment: { wall_panel_mode: 'none',  side_panel_mode: 'none',
                                  bass_trap_mode: 'none',   ceiling_panel_mode: 'none' } }
    };

    // Use cloud override if one was queued by the 'measurely:data-ready' listener,
    // then fall back to the normal caller-supplied getter.
    const raw  = _freshRoomOverride || getRoomData() || {};
    _freshRoomOverride = null;
    const data = {
      ...FALLBACK,
      ...raw,
      geometry:    { ...FALLBACK.geometry,    ...(raw.geometry    || {}) },
      setup:       { ...FALLBACK.setup,       ...(raw.setup       || {}) },
      environment: { ...FALLBACK.environment, ...(raw.environment || {}),
        furniture: { ...FALLBACK.environment.furniture,
                     ...((raw.environment || {}).furniture || {}) },
        treatment: { ...FALLBACK.environment.treatment,
                     ...((raw.environment || {}).treatment || {}) }
      }
    };

    window.__MEASURELY_ROOM__ = data;

    // 1. UNPACKING
    const geo   = data.geometry    || data;
    const setup = data.setup       || data;
    const env   = data.environment || data;

    // Apply live overrides (from setRoomWidth / setRoomLength API calls)
    if (_roomWidthOverride  !== null) geo.width_m  = _roomWidthOverride;
    if (_roomLengthOverride !== null) geo.length_m = _roomLengthOverride;
    
    // Check for furniture and treatment sub-objects
    const furn  = (env.furniture) ? env.furniture : env;
    const treat = (env.treatment) ? env.treatment : env;

    const room = {
      length_m: geo.length_m,
      width_m:  geo.width_m,
      height_m: geo.height_m,
      ceiling_type: geo.ceiling_type || "flat",
      ceiling_slant_direction: geo.ceiling_slant_direction || "left_to_right",
      ceiling_gable_axis: geo.ceiling_gable_axis || "depth",
      ceiling_height_secondary_m: geo.ceiling_height_secondary_m || 2.0,

      speaker_type:     setup.speaker_type,
      spk_spacing_m:    setup.spk_spacing_m,
      spk_front_m:      setup.spk_front_m,
      tweeter_height_m: setup.tweeter_height_m,
      toe_in_deg:       setup.toe_in_deg,
      listener_front_m: setup.listener_front_m,
      listener_offset_m: setup.listener_offset_m,
      subwoofer:         setup.subwoofer,

      room_type:        data.room_type || env.room_type || "home",
      opt_area_rug:     furn.opt_area_rug     ?? env.opt_area_rug     ?? data.opt_area_rug,
      opt_sofa:         furn.opt_sofa         ?? env.opt_sofa         ?? data.opt_sofa,
      opt_coffee_table: furn.opt_coffee_table ?? env.opt_coffee_table ?? data.opt_coffee_table,
      opt_desk:         furn.opt_desk         ?? env.opt_desk         ?? data.opt_desk,
      opt_chair:        furn.opt_chair        ?? env.opt_chair        ?? data.opt_chair,
      seating_type:     furn.seating_type     ?? env.seating_type     ?? data.seating_type ?? 'sofa',

      // TREATMENT: Digging into data.environment.treatment
      wall_panel_mode:    treat.wall_panel_mode    ?? env.wall_panel_mode    ?? "none",
      side_panel_mode:    treat.side_panel_mode    ?? env.side_panel_mode    ?? "none",
      bass_trap_mode:     treat.bass_trap_mode     ?? env.bass_trap_mode     ?? "none",
      ceiling_panel_mode: treat.ceiling_panel_mode ?? env.ceiling_panel_mode ?? "none"
    };

    // 2. DEFINE MISSING VARIABLES (Prevents the ReferenceError crash)
    const isLocked = (currentMode === "locked"); 
    const isStudio = (room.room_type === "studio");
    const offsetX  = room.listener_offset_m || 0;

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
    const isFinal     = currentMode === "final";

    const hasFocus = Boolean(focusedOverlay);
    const DIM_FACTOR = hasFocus ? 0.12 : 1.0;

    /* ------------------------------------------
      COLOUR STATE RESOLUTION
    ------------------------------------------ */
    const colors = ROOM_COLOURS[colourState] || ROOM_COLOURS.idle;

    const OP_WIRE = (isLocked ? 0.25 : (isFinal ? 0.85 : 0.65)) * DIM_FACTOR;
    const OP_OBJ  = (isLocked ? 0.15 : (isFinal ? 0.6  : 0.25)) * DIM_FACTOR;
    // Furniture recedes: always lower than acoustic elements (R4)
    const OP_FURN = (isLocked ? 0.10 : 0.18) * DIM_FACTOR;

    /* ------------------------------------------
       ROOM SHELL — flat box or slanted wireframe
    ------------------------------------------ */
    const isSlanted = room.ceiling_type === "slanted";
    const isGable   = room.ceiling_type === "gable";
    const hasSlopedCeiling = isSlanted || isGable;
    const lowH = hasSlopedCeiling
      ? Math.min(room.ceiling_height_secondary_m, room.height_m)
      : room.height_m;
    const slantDir  = room.ceiling_slant_direction || "left_to_right";
    const gableAxis = room.ceiling_gable_axis || "depth";

    const floorY = -room.height_m / 2;
    const highY  =  room.height_m / 2;
    const lowY   = floorY + lowH;
    const hW = room.width_m / 2;
    const hL = room.length_m / 2;

    function ceilingYAt(x, z) {
      if (!hasSlopedCeiling) return highY;

      if (isSlanted) {
        let t;
        switch (slantDir) {
          case "left_to_right":  t = (x + hW) / room.width_m;  break;
          case "right_to_left":  t = 1 - (x + hW) / room.width_m; break;
          case "front_to_back":  t = 1 - (z + hL) / room.length_m; break;
          case "back_to_front":  t = (z + hL) / room.length_m; break;
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
      const SHELL_BEAM_T  = 0.030; // metres — thicker for high-contrast "cage" look
      // Always solid — no transparency. depthTest:false means the cage renders
      // on top of interior geometry so it's never occluded by walls.
      const shellMat = new THREE.MeshBasicMaterial({
        color:       0x1a1714, // Dark charcoal — pops against light background
        transparent: false,
        opacity:     1.0,
        depthTest:   false,
        depthWrite:  false,
      });

      if (!isSlanted && !isGable) {
        const bverts = [
          new THREE.Vector3(-hW, floorY, -hL),
          new THREE.Vector3( hW, floorY, -hL),
          new THREE.Vector3( hW, floorY,  hL),
          new THREE.Vector3(-hW, floorY,  hL),
          new THREE.Vector3(-hW, floorY + room.height_m, -hL),
          new THREE.Vector3( hW, floorY + room.height_m, -hL),
          new THREE.Vector3( hW, floorY + room.height_m,  hL),
          new THREE.Vector3(-hW, floorY + room.height_m,  hL),
        ];
        const bpairs = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
        roomGroup.add(_fatEdgeGroup(bverts, bpairs, SHELL_BEAM_T, shellMat));
      } else if (isSlanted) {
        const v = [
          new THREE.Vector3(-hW, floorY, -hL),
          new THREE.Vector3( hW, floorY, -hL),
          new THREE.Vector3( hW, floorY,  hL),
          new THREE.Vector3(-hW, floorY,  hL),
          new THREE.Vector3(-hW, ceilingYAt(-hW, -hL), -hL),
          new THREE.Vector3( hW, ceilingYAt( hW, -hL), -hL),
          new THREE.Vector3( hW, ceilingYAt( hW,  hL),  hL),
          new THREE.Vector3(-hW, ceilingYAt(-hW,  hL),  hL),
        ];
        const edgePairs = [
          [0,1],[1,2],[2,3],[3,0],
          [4,5],[5,6],[6,7],[7,4],
          [0,4],[1,5],[2,6],[3,7]
        ];
        roomGroup.add(_fatEdgeGroup(v, edgePairs, SHELL_BEAM_T, shellMat));
      } else if (isGable) {
        const eavesY = lowY;
        const peakY  = highY;

        if (gableAxis === "depth") {
          const v = [
            new THREE.Vector3(-hW, floorY, -hL), // 0
            new THREE.Vector3( hW, floorY, -hL), // 1
            new THREE.Vector3( hW, floorY,  hL), // 2
            new THREE.Vector3(-hW, floorY,  hL), // 3
            new THREE.Vector3(-hW, eavesY, -hL), // 4 eave front-left
            new THREE.Vector3( hW, eavesY, -hL), // 5 eave front-right
            new THREE.Vector3( hW, eavesY,  hL), // 6 eave back-right
            new THREE.Vector3(-hW, eavesY,  hL), // 7 eave back-left
            new THREE.Vector3(  0, peakY,  -hL), // 8 ridge front
            new THREE.Vector3(  0, peakY,   hL), // 9 ridge back
          ];
          const edgePairs = [
            [0,1],[1,2],[2,3],[3,0],
            [0,4],[1,5],[2,6],[3,7],
            [4,7],[5,6],
            [8,9],
            [4,8],[8,5],[7,9],[9,6],
          ];
          roomGroup.add(_fatEdgeGroup(v, edgePairs, SHELL_BEAM_T, shellMat));
        } else {
          const v = [
            new THREE.Vector3(-hW, floorY, -hL), // 0
            new THREE.Vector3( hW, floorY, -hL), // 1
            new THREE.Vector3( hW, floorY,  hL), // 2
            new THREE.Vector3(-hW, floorY,  hL), // 3
            new THREE.Vector3(-hW, eavesY, -hL), // 4 eave front-left
            new THREE.Vector3( hW, eavesY, -hL), // 5 eave front-right
            new THREE.Vector3( hW, eavesY,  hL), // 6 eave back-right
            new THREE.Vector3(-hW, eavesY,  hL), // 7 eave back-left
            new THREE.Vector3(-hW, peakY,    0), // 8 ridge left
            new THREE.Vector3( hW, peakY,    0), // 9 ridge right
          ];
          const edgePairs = [
            [0,1],[1,2],[2,3],[3,0],
            [0,4],[1,5],[2,6],[3,7],
            [4,5],[6,7],
            [8,9],
            [4,8],[8,7],[5,9],[9,6],
          ];
          roomGroup.add(_fatEdgeGroup(v, edgePairs, SHELL_BEAM_T, shellMat));
        }
      }
    }

    // Unit plane: scale.x = width, scale.y = length (plane local-Y maps to world-Z
    // after the -90° X rotation). Stored for live resize.
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0xf0ede8,
      roughness: 0.2,
      metalness: 0.4,
      transparent: true,
      opacity: 0.6,
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

    function getSpeakerProfile(type) {
      switch (type) {

        case "floorstander":
          return {
            w: 0.24,
            h: 1.18,
            d: 0.42,
            color: 0x1a1714,
            tweeterPos: 0.805, // tweeter at ~0.95 m when cabinet bottom sits on floor
            detailed: true
          };

        case "panel":
          return {
            w: 0.55,
            h: 1.55,
            d: 0.06,
            color: 0x1a1714,
            floorStand: true, // sits on floor, not tweeter-height positioned
            tweeterPos: 0.50  // acoustic centre at mid-panel
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
        const hw = w/2, hh = h/2, hd = d/2;
        const v = [
          new THREE.Vector3(-hw,-hh,-hd), new THREE.Vector3( hw,-hh,-hd),
          new THREE.Vector3( hw,-hh, hd), new THREE.Vector3(-hw,-hh, hd),
          new THREE.Vector3(-hw, hh,-hd), new THREE.Vector3( hw, hh,-hd),
          new THREE.Vector3( hw, hh, hd), new THREE.Vector3(-hw, hh, hd),
        ];
        const pairs = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
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
    // woofer 1 (low)
    grp.add(_ring(0, -H * 0.28, front, W * 0.20));
    // woofer 2 (mid-low)
    grp.add(_ring(0, -H * 0.08, front, W * 0.20));
    // midrange
    grp.add(_ring(0,  H * 0.22, front, W * 0.14));
    // tweeter (small, near top)
    grp.add(_ring(0,  H * 0.38, front, W * 0.06));

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
        const hw = w/2, hh = h/2, hd = d/2;
        const v = [
          new THREE.Vector3(-hw,-hh,-hd), new THREE.Vector3( hw,-hh,-hd),
          new THREE.Vector3( hw,-hh, hd), new THREE.Vector3(-hw,-hh, hd),
          new THREE.Vector3(-hw, hh,-hd), new THREE.Vector3( hw, hh,-hd),
          new THREE.Vector3( hw, hh, hd), new THREE.Vector3(-hw, hh, hd),
        ];
        const pairs = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
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
    grp.add(_ring(0, -H * 0.18, front, W * 0.28)); // woofer
    grp.add(_ring(0,  H * 0.28, front, W * 0.08)); // tweeter

    return grp;
  }

/* ------------------------------------------
        SPEAKERS + BEAMS (LEVEL AXIS LOCK)
    ------------------------------------------ */
    // Reset speaker refs — will be set below when speakers are built
    _spkMeshL = null; _spkMeshR = null;
    _beamGeoL = null; _beamGeoR = null;

    if (renderStage === "speakers" || renderStage === "furnishings") {
      const toeRad = (room.toe_in_deg || 0) * Math.PI / 180;
      const baseY = -room.height_m / 2;

      ["L", "R"].forEach(side => {
        const profile = getSpeakerProfile(room.speaker_type);
        const isSpkHighlit = highlightTarget === 'speakers';

        const spkColor   = isSpkHighlit ? 0x0f766e : profile.color;
        const spkOpacity = isSpkHighlit ? 0.9 : Math.max(OP_OBJ, 0.80);

        const speaker = profile.detailed
          ? _buildDetailedSpeaker(profile.w, profile.h, profile.d, spkColor, spkOpacity)
          : _buildStandmountSpeaker(profile.w, profile.h, profile.d, spkColor, spkOpacity);

        // X position — always based on speaker spacing
        const x = offsetX + (side === "L" ? -1 : 1) * room.spk_spacing_m / 2;

        let y, z;
        if (profile.onDesk) {
          // Desk monitors: snap to desk surface (desk top at 0.775 m above floor)
          const deskSurface = baseY + 0.775;
          y = deskSurface + profile.h / 2;
          // Place at the front edge of the desk (20% of room depth from front wall, offset back slightly)
          z = -room.length_m / 2 + 0.20 * room.length_m - 0.15;
        } else if (profile.floorStand) {
          // Floor-standing panels (electrostatics): bottom sits on floor, toe toward listener
          y = baseY + profile.h / 2;
          z = -room.length_m / 2 + room.spk_front_m;
        } else {
          // Standmounts: always sit on a fixed standard stand so tweeter ~0.95 m.
          // tweeter_height_m drives acoustic overlays only — not the visual position.
          const stdTweeterH = 0.95;
          const tweeterOffsetFromCenter = (profile.h / 2) - (profile.h * (profile.tweeterPos || 0.5));
          y = baseY + stdTweeterH + tweeterOffsetFromCenter;
          z = -room.length_m / 2 + room.spk_front_m;
        }

        // Wrap cabinet (+ optional stand) in a group so toe rotation is shared
        const spkGroup = new THREE.Group();
        spkGroup.position.set(x, y, z);
        spkGroup.add(speaker); // cabinet sits at group origin (= cabinet centre)

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

        // --- BEAMS — extracted so _applyAutoToe can update the endpoint live ---
        // Start beam at tweeter position within the cabinet (not cabinet centre)
        const tweeterLocalY = (profile.tweeterPos - 0.5) * profile.h;
        const beamGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, tweeterLocalY, 0),
          new THREE.Vector3(0, tweeterLocalY, room.length_m)
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

        speaker.add(beam);
        roomGroup.add(spkGroup);

        // ── Wave rings — expanding circles at tweeter height ──────────────
        if (_wavesEnabled) {
          const NUM_RINGS   = 5;
          const maxR        = Math.max(room.length_m, room.width_m) * 0.85;
          const waveY       = baseY + room.tweeter_height_m;
          const waveZ       = -room.length_m / 2 + room.spk_front_m;
          const waveX       = offsetX + (side === "L" ? -1 : 1) * room.spk_spacing_m / 2;
          const waveColor   = isSpkHighlit ? 0x0f766e : profile.color;

          // Build a unit circle (r=1) in the XZ plane — scaled each frame
          const circlePts = [];
          const SEG = 72;
          for (let j = 0; j <= SEG; j++) {
            const a = (j / SEG) * Math.PI * 2;
            circlePts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
          }
          const circleGeo = new THREE.BufferGeometry().setFromPoints(circlePts);

          for (let ri = 0; ri < NUM_RINGS; ri++) {
            const ringMat = new THREE.LineBasicMaterial({
              color:       waveColor,
              transparent: true,
              opacity:     0,
              depthWrite:  false,
            });
            const ring = new THREE.Line(circleGeo, ringMat);
            ring.position.set(waveX, waveY, waveZ);
            ring.userData.wavePhase  = ri / NUM_RINGS;
            ring.userData.waveMaxR   = maxR;
            roomGroup.add(ring);
            _waveRings.push(ring);
          }
        }

        // Store refs for live auto-toe updates (Group supports .rotation.y same as Mesh)
        if (side === 'L') { _spkMeshL = spkGroup; _beamGeoL = beamGeo; }
        else              { _spkMeshR = spkGroup; _beamGeoR = beamGeo; }
      });

    }

  /* ------------------------------------------
    LISTEN STATION GROUP
    Sphere + rug + sofa + coffee table anchored at the listen position.
  ------------------------------------------ */

  const listenerZ = -room.length_m / 2 + room.listener_front_m;
  const effectiveHeadHeight = isStudio
    ? 1.22  // seated ear height at a desk (~desk surface 0.75m + ~0.47m seated posture)
    : 0.82; // seated ear height on a sofa — sofa back tops out at ~0.80m

  // Dark charcoal outline so edges pop clearly against the light background.
  const furnEdgeMat = useFatEdges
    ? new THREE.MeshBasicMaterial({
        color:       0x1a1714, // Dark charcoal
        transparent: false,
        depthTest:   true,
        depthWrite:  true
      })
    : new THREE.LineBasicMaterial({
        color:       0x1a1714, // Dark charcoal
        transparent: false,
        depthTest:   true,
        depthWrite:  true
      });

  // Returns a Group containing edge outlines only — no fill mesh so there are
  // no triangle diagonals bleeding through on top of the edge lines.
  function _ghostBox(w, h, d) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const grp = new THREE.Group();
    if (useFatEdges) {
      const hw = w / 2, hh = h / 2, hd = d / 2;
      const v = [
        new THREE.Vector3(-hw, -hh, -hd), new THREE.Vector3( hw, -hh, -hd),
        new THREE.Vector3( hw, -hh,  hd), new THREE.Vector3(-hw, -hh,  hd),
        new THREE.Vector3(-hw,  hh, -hd), new THREE.Vector3( hw,  hh, -hd),
        new THREE.Vector3( hw,  hh,  hd), new THREE.Vector3(-hw,  hh,  hd),
      ];
      const pairs = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
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
    const frontZ  = -room.length_m / 2 + room.spk_front_m;
    const floorY  = -room.height_m / 2;

    // ── Hi-fi rack — small coffee table + stacked component boxes ─
    const rackW = 0.55, rackD = 0.38;
    const legH  = 0.28, legT = 0.04;
    const topH  = 0.04;
    const tableTopY = legH + topH / 2; // surface centre height above floor

    const rack = new THREE.Group();

    // Table top
    const rTop = _ghostBox(rackW, topH, rackD);
    rTop.position.y = tableTopY;
    rack.add(rTop);

    // 4 legs (same corner pattern as coffee table, scaled down)
    const lx = rackW / 2 - 0.05, lz = rackD / 2 - 0.05;
    [[-lx, legH/2, -lz], [lx, legH/2, -lz],
     [-lx, legH/2,  lz], [lx, legH/2,  lz]].forEach(([px, py, pz]) => {
      const leg = _ghostBox(legT, legH, legT);
      leg.position.set(px, py, pz);
      rack.add(leg);
    });

    // Stacked components on top of the table
    const compW = rackW - 0.06, compD = rackD - 0.06, compGap = 0.015;
    const compHeights = [0.09, 0.07, 0.055, 0.055]; // amp, integrated, streamer, DAC
    let curY = legH + topH;
    compHeights.forEach(h => {
      const comp = _ghostBox(compW, h, compD);
      comp.position.y = curY + h / 2;
      rack.add(comp);
      curY += h + compGap;
    });

    rack.position.set(offsetX, floorY, frontZ);
    roomGroup.add(rack);

    // ── Subwoofer (right of rack) ───────────────────────────────
    if (room.subwoofer) {
      const profile    = getSpeakerProfile(room.speaker_type);
      const subColor   = profile.color;
      const subOpacity = Math.max(OP_OBJ, 0.80);
      const subW = 0.38, subH = 0.36, subD = 0.38;
      const subGap = 0.06;

      const subMat = useFatEdges
        ? new THREE.MeshBasicMaterial({ color: subColor, transparent: true, opacity: subOpacity })
        : new THREE.LineBasicMaterial({ color: subColor, transparent: true, opacity: subOpacity });

      const subGroup = new THREE.Group();

      // Cabinet wireframe
      if (useFatEdges) {
        const hw = subW/2, hh = subH/2, hd = subD/2;
        const v = [
          new THREE.Vector3(-hw,-hh,-hd), new THREE.Vector3( hw,-hh,-hd),
          new THREE.Vector3( hw,-hh, hd), new THREE.Vector3(-hw,-hh, hd),
          new THREE.Vector3(-hw, hh,-hd), new THREE.Vector3( hw, hh,-hd),
          new THREE.Vector3( hw, hh, hd), new THREE.Vector3(-hw, hh, hd),
        ];
        const pairs = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
        subGroup.add(_fatEdgeGroup(v, pairs, EDGE_TUBE_T * 0.55, subMat));
      } else {
        subGroup.add(new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(subW, subH, subD)),
          subMat
        ));
      }

      // Driver ring on front face (faces listener, +z direction)
      const driverMat = new THREE.LineBasicMaterial({
        color: subColor, transparent: true, opacity: subOpacity * 0.70
      });
      const driverPts = [];
      const driverR   = subW * 0.32; // ~12cm radius ≈ 24cm woofer
      for (let i = 0; i <= 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        driverPts.push(new THREE.Vector3(Math.cos(a) * driverR, Math.sin(a) * driverR, subD / 2 + 0.002));
      }
      subGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(driverPts), driverMat
      ));

      subGroup.position.set(
        offsetX + rackW / 2 + subGap + subW / 2, // right of rack
        floorY + subH / 2,
        frontZ
      );
      roomGroup.add(subGroup);
    }
  }

  {
    const station = new THREE.Group();
    station.position.set(offsetX + (room.listener_offset_m || 0), -room.height_m / 2, listenerZ);

    // ── Listener sphere (always visible) ──
    const isListHighlit = highlightTarget === 'listener';
    const sphereColor   = isListHighlit ? 0x0f766e : colors.accent;
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(isListHighlit ? 0.26 : 0.18, 24, 24),
      new THREE.MeshBasicMaterial({
        color:       sphereColor,
        wireframe:   true,
        transparent: true,
        opacity:     isListHighlit ? 0.95 : 0.55
      })
    );
    // Home: shift sphere into seat. Lounge chair has head further back (reclined posture).
    const _seatType = room.seating_type || 'sofa';
    const _sphereZ  = isStudio ? 0 : (_seatType === 'lounge' ? 0.38 : 0.28);
    const _sphereY  = isStudio ? effectiveHeadHeight : (_seatType === 'lounge' ? 1.00 : 0.96);
    sphere.position.set(0, _sphereY, _sphereZ);
    station.add(sphere);

    // ── Rug (local coords: centred in front of sphere) ──
    if (VISIBILITY.furniture.rug && room.opt_area_rug) {
      const rugIsNew = !!room._highlight_rug;
      const rug = new THREE.Mesh(
        new THREE.PlaneGeometry(room.width_m * 0.45, room.length_m * 0.35),
        new THREE.MeshBasicMaterial({
          color:       rugIsNew ? 0x10b981 : 0x9a8f87, // green if recommended by treatment plan, muted warm grey if existing
          wireframe:   true,
          transparent: true,
          opacity:     rugIsNew ? 0.45 : 0.22,
          depthWrite:  false,
          depthTest:   true,
          side: THREE.DoubleSide
        })
      );
      rug.rotation.x = -Math.PI / 2;
      rug.position.set(0, 0.01, -1.15); // 1 cm above floor so no z-fighting with grid
      station.add(rug);
    }

    // ── Seating (home mode only) — driven by room.seating_type ('sofa' | 'lounge') ──
    // In station-local coords: +Z is toward the back wall.
    if (VISIBILITY.furniture.sofa && !isStudio && room.opt_sofa) {
      const seatingGroup = new THREE.Group();
      const seatingStyle = room.seating_type || 'sofa';

      if (seatingStyle === 'sofa') {
        // ── Three-seater sofa (2.1 m wide) ──────────────────────────────────
        const base = _ghostBox(2.1, 0.4, 0.9);
        base.position.y = 0.2;
        seatingGroup.add(base);

        const back = _ghostBox(2.1, 0.5, 0.2);
        back.position.set(0, 0.55, 0.35);
        seatingGroup.add(back);

        const lArm = _ghostBox(0.2, 0.35, 0.9); lArm.position.set(-0.95, 0.4, 0);
        const rArm = _ghostBox(0.2, 0.35, 0.9); rArm.position.set( 0.95, 0.4, 0);
        seatingGroup.add(lArm, rArm);

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
        const rArm = _ghostBox(0.07, 0.05, 0.42); rArm.position.set( 0.31, 0.46, 0.0);
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

      // Both sit +0.35 m behind listener (toward back wall)
      seatingGroup.position.set(0, 0, 0.35);
      station.add(seatingGroup);
    }

    // ── Coffee table — anchored to listener station, in front of sofa ──
    if (VISIBILITY.furniture.coffeeTable && room.opt_coffee_table) {
      const ctGroup = new THREE.Group();

      const tTop = _ghostBox(1.0, 0.05, 0.6);
      tTop.position.y = 0.4;
      ctGroup.add(tTop);

      [[-0.45, 0.2, -0.3], [0.45, 0.2, -0.3],
       [-0.45, 0.2,  0.3], [0.45, 0.2,  0.3]].forEach(([lx, ly, lz]) => {
        const leg = _ghostBox(0.04, 0.4, 0.04);
        leg.position.set(lx, ly, lz);
        ctGroup.add(leg);
      });

      // -0.9 m in front of the listener (toward speakers)
      ctGroup.position.set(0, 0, -0.9);
      station.add(ctGroup);
    }

    // ── Studio: desk + chair — fixed at ~20% of room length from front wall ──
    // Both placed in roomGroup so they scale with room length automatically.
    if (isStudio && !hasFocus) {
      // Desk at 20 % from speaker wall
      const deskZ = -room.length_m / 2 + 0.20 * room.length_m;

      const deskGroup = new THREE.Group();
      const deskTop = _ghostBox(1.6, 0.05, 0.8);
      deskTop.position.y = 0.75;
      deskGroup.add(deskTop);
      [[-0.75, 0.375, -0.35], [0.75, 0.375, -0.35],
       [-0.75, 0.375,  0.35], [0.75, 0.375,  0.35]]
        .forEach(p => { const l = _ghostBox(0.04, 0.75, 0.04); l.position.set(...p); deskGroup.add(l); });
      deskGroup.position.set(offsetX, -room.height_m / 2, deskZ);
      roomGroup.add(deskGroup);

      // Office chair — just behind the desk (toward listener)
      const chairZ = deskZ + 0.55;
      const chairGroup = new THREE.Group();
      const s1 = _ghostBox(0.6, 0.04, 0.1); s1.position.y = 0.02;
      const s2 = _ghostBox(0.1, 0.04, 0.6); s2.position.y = 0.02;
      chairGroup.add(s1, s2);
      const stem = _ghostBox(0.08, 0.4, 0.08); stem.position.y = 0.2; chairGroup.add(stem);
      const seat = _ghostBox(0.5, 0.08, 0.5); seat.position.y = 0.45; chairGroup.add(seat);
      const sup = _ghostBox(0.08, 0.4, 0.04);
      sup.position.set(0, 0.65, 0.22); sup.rotation.x = -0.15; chairGroup.add(sup);
      const bk = _ghostBox(0.45, 0.45, 0.05);
      bk.position.set(0, 0.85, 0.28); chairGroup.add(bk);
      chairGroup.position.set(offsetX, -room.height_m / 2, chairZ);
      roomGroup.add(chairGroup);
    }

    roomGroup.add(station);
    _listenStation = station; // stored for auto-toe
  }

  /* ------------------------------------------
     ACOUSTIC TREATMENT PANELS
  ------------------------------------------ */
  const panelMat = new THREE.MeshBasicMaterial({
    color: 0x0f766e,
    transparent: true,
    opacity: 0.28,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  // --- WALL PANELS (front & rear walls) ---
  if (room.wall_panel_mode !== "none") {
    const panelW    = room.width_m * 0.55;
    const panelH    = room.height_m * 0.5;
    const thickness = 0.06;

    if (room.wall_panel_mode === "front" || room.wall_panel_mode === "both") {

      const frontPanel = new THREE.Mesh(
        new THREE.BoxGeometry(panelW, panelH, thickness),
        panelMat
      );

      frontPanel.position.set(
        offsetX,
        0,
        -room.length_m / 2 + thickness / 2
      );

      roomGroup.add(frontPanel);
    }

    if (room.wall_panel_mode === "rear" || room.wall_panel_mode === "both") {

      const rearPanel = new THREE.Mesh(
        new THREE.BoxGeometry(panelW, panelH, thickness),
        panelMat
      );

      rearPanel.position.set(
        offsetX,
        0,
        room.length_m / 2 - thickness / 2
      );

      roomGroup.add(rearPanel);
    }
  }

  // --- BASS TRAPS (all four vertical corners) ---
  // --- BASS TRAPS ---
  if (room.bass_trap_mode !== "none") {

    const trapSize = 0.3;
    const trapH    = room.height_m * 0.75;
    const halfW    = room.width_m  / 2;
    const halfL    = room.length_m / 2;

    const traps = [];

    if (room.bass_trap_mode === "front" || room.bass_trap_mode === "all") {
      traps.push(
        [-halfW + trapSize / 2, -halfL + trapSize / 2], // front left
        [ halfW - trapSize / 2, -halfL + trapSize / 2]  // front right
      );
    }

    if (room.bass_trap_mode === "rear" || room.bass_trap_mode === "all") {
      traps.push(
        [-halfW + trapSize / 2,  halfL - trapSize / 2], // rear left
        [ halfW - trapSize / 2,  halfL - trapSize / 2]  // rear right
      );
    }

    traps.forEach(([cx, cz]) => {
      // Use ceilingYAt to get the actual ceiling height at this corner
      let localCeilH = trapH;
      if (hasSlopedCeiling) {
        const localCeilY = ceilingYAt(cx, cz);
        const localHeight = localCeilY - floorY; // total height at this corner
        localCeilH = localHeight * 0.75;
      }

      const trap = new THREE.Mesh(
        new THREE.BoxGeometry(trapSize, localCeilH, trapSize),
        panelMat
      );

      trap.position.set(offsetX + cx, floorY + localCeilH / 2, cz);
      roomGroup.add(trap);
    });

  }

  // --- CEILING PANELS ---
  if (room.ceiling_panel_mode === "cloud") {

    const cpW       = Math.min(room.spk_spacing_m * 1.6, room.width_m * 0.8);
    const cpL       = room.length_m * 0.28;
    const thickness = 0.06;

    const spkZ = -room.length_m / 2 + (room.spk_front_m ?? 0.45);
    const midZ = (spkZ + listenerZ) / 2;

    if (isGable) {
      // Gabled roof: Two panels, one on each pitched side
      const panelGroup = new THREE.Group();
      
      if (gableAxis === "depth") {
        // Ridge runs front-to-back, slope is Left/Right (X axis)
        const slopeAngle = Math.atan2(room.height_m - lowH, room.width_m / 2);
        const halfWidth = cpW / 2;
        
        // Left panel
        const leftPanel = new THREE.Mesh(new THREE.BoxGeometry(halfWidth - 0.05, thickness, cpL), panelMat);
        const leftX = offsetX - halfWidth / 2;
        leftPanel.position.set(leftX, ceilingYAt(leftX, midZ) - thickness / 2, midZ);
        leftPanel.rotation.z = slopeAngle;
        panelGroup.add(leftPanel);

        // Right panel
        const rightPanel = new THREE.Mesh(new THREE.BoxGeometry(halfWidth - 0.05, thickness, cpL), panelMat);
        const rightX = offsetX + halfWidth / 2;
        rightPanel.position.set(rightX, ceilingYAt(rightX, midZ) - thickness / 2, midZ);
        rightPanel.rotation.z = -slopeAngle;
        panelGroup.add(rightPanel);

      } else {
        // Ridge runs left-to-right, slope is Front/Back (Z axis)
        const slopeAngle = Math.atan2(room.height_m - lowH, room.length_m / 2);
        const halfLength = cpL / 2;

        // Front panel (towards speakers, -z)
        const frontPanel = new THREE.Mesh(new THREE.BoxGeometry(cpW, thickness, halfLength - 0.05), panelMat);
        const frontZ = midZ - halfLength / 2;
        frontPanel.position.set(offsetX, ceilingYAt(offsetX, frontZ) - thickness / 2, frontZ);
        frontPanel.rotation.x = -slopeAngle;
        panelGroup.add(frontPanel);

        // Back panel (towards listener, +z)
        const backPanel = new THREE.Mesh(new THREE.BoxGeometry(cpW, thickness, halfLength - 0.05), panelMat);
        const backZ = midZ + halfLength / 2;
        backPanel.position.set(offsetX, ceilingYAt(offsetX, backZ) - thickness / 2, backZ);
        backPanel.rotation.x = slopeAngle;
        panelGroup.add(backPanel);
      }
      
      roomGroup.add(panelGroup);

    } else {
      // Flat or Slanted roof: One single panel
      const ceilPanel = new THREE.Mesh(
        new THREE.BoxGeometry(cpW, thickness, cpL),
        panelMat
      );

      if (isSlanted) {
        // Position at actual centre height
        const panelCeilY = ceilingYAt(offsetX, midZ);
        ceilPanel.position.set(offsetX, panelCeilY - thickness / 2, midZ);

        // Tilt to follow the roof slope
        const isZSlant = slantDir === "front_to_back" || slantDir === "back_to_front";
        const span = isZSlant ? room.length_m : room.width_m;
        const slopeAngle = Math.atan2(room.height_m - lowH, span);

        if (isZSlant) {
          const sign = (slantDir === "back_to_front") ? -1 : 1;
          ceilPanel.rotation.x = sign * slopeAngle;
        } else {
          const sign = (slantDir === "left_to_right") ? 1 : -1;
          ceilPanel.rotation.z = sign * slopeAngle;
        }
      } else {
        // Flat
        ceilPanel.position.set(
          offsetX,
          room.height_m / 2 - thickness / 2,
          midZ
        );
      }
      roomGroup.add(ceilPanel);
    }
  }

  // --- SIDE PANELS ---
  if (room.side_panel_mode !== "none" || simulatePanels) {

    const spH = room.height_m * 0.4;
    const spL = 0.9;
    const thickness = 0.06;

    const wallX = room.width_m / 2;
    const earY  = -(room.height_m / 2) + (room.tweeter_height_m ?? 0.9);

    const listenerPos = new THREE.Vector3(
      offsetX,
      earY,
      listenerZ
    );

    for (const side of [-1, 1]) {

      if (!simulatePanels) {

        if (room.side_panel_mode === "left"  && side ===  1) continue;
        if (room.side_panel_mode === "right" && side === -1) continue;
        if (room.side_panel_mode === "none") continue;

      }

      const speakerPos = new THREE.Vector3(
        offsetX + side * room.spk_spacing_m / 2,
        earY,
        -room.length_m / 2 + room.spk_front_m
      );

      const mirrorSpeaker = speakerPos.clone();
      mirrorSpeaker.x = side * wallX + (side * wallX - speakerPos.x);

      const dir = new THREE.Vector3().subVectors(mirrorSpeaker, listenerPos);
      const t   = (side * wallX - listenerPos.x) / dir.x;

      const bouncePoint = listenerPos.clone().add(dir.multiplyScalar(t));

      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(thickness, spH, spL),
        panelMat
      );

      panel.position.set(
        side * (wallX - thickness / 2),
        bouncePoint.y,
        bouncePoint.z
      );

      roomGroup.add(panel);
    }

  }

  renderHighlightOverlays(room);
  renderAnalysisOverlays(room);
  renderWallLabels(room);

  // Auto-toe: snap speakers to face the sphere after every full rebuild
  _applyAutoToe();

  // ---- SMOOTHNESS (Room Modal Standing Wave Field) ----
  if (overlayEnabled(OVERLAYS.SMOOTHNESS)) {

    const roughness  = THREE.MathUtils.clamp(smoothnessStd / 5, 0, 1);
    const isRough    = roughness > 0.55;
    const fieldColor = roughness > 0.8 ? 0xff3b3b : isRough ? 0xd97706 : 0x0f766e;
    const isFocSM    = isFocused(OVERLAYS.SMOOTHNESS);

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
        uTime:      { value: 0 },
        uRoomW:     { value: room.width_m },
        uRoomL:     { value: room.length_m },
        uModes:     { value: smModeData },
        uRoughness: { value: roughness },
        uColor:     { value: new THREE.Color(fieldColor) },
        uOpacity:   { value: isFocSM ? 0.55 : 0.18 },
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
      depthWrite:  false,
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

    // DASHED LINE ENERGY MOTION
    scene.traverse(obj => {
      if (obj.isLine && obj.material?.type === "LineDashedMaterial") {
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

    // TRAVELLING DOTS — slide along speaker → bounce → listener path
    const TRAVEL_PERIOD = 2.4; // seconds per full trip
    const _tt = performance.now() * 0.001;
    scene.traverse(obj => {
      if (obj.userData?.isTravelDot) {
        const { path, phaseOffset } = obj.userData.isTravelDot;
        const phase = (_tt / TRAVEL_PERIOD + phaseOffset) % 1.0;
        if (phase < 0.5) {
          obj.position.lerpVectors(path[0], path[1], phase * 2);
        } else {
          obj.position.lerpVectors(path[1], path[2], (phase - 0.5) * 2);
        }
        obj.material.opacity = Math.sin(phase * Math.PI) * 0.82;
      }
    });

    // WAVE RINGS — expanding circles from each speaker at tweeter height
    if (_waveRings.length > 0) {
      const _wt = performance.now() * 0.001;
      const WAVE_CYCLE = 2.8; // seconds per full cycle
      for (let wi = 0; wi < _waveRings.length; wi++) {
        const ring = _waveRings[wi];
        const phase = (_wt / WAVE_CYCLE + ring.userData.wavePhase) % 1.0;
        const r = phase * ring.userData.waveMaxR;
        ring.scale.set(r, 1, r);
        ring.material.opacity = Math.max(0, (1 - phase) * 0.28);
      }
    }

    // SBIR interference field — advance time uniform
    {
      const sbirMesh = roomGroup.children.find(o => o.userData?.isSbirField);
      if (sbirMesh) sbirMesh.material.uniforms.uTime.value = performance.now() * 0.002;
    }

    // Standing wave (bass modes) field — advance time uniform
    {
      const bwMesh = roomGroup.children.find(o => o.userData?.isBandwidthField);
      if (bwMesh) bwMesh.material.uniforms.uTime.value = performance.now() * 0.001;
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


  // Build a single tube segment between two points and add to roomGroup.
  function _addReflectionTube(a, b, color, opacity = 0.85) {
    const TUBE_R = useFatEdges ? 0.022 : 0.010;
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest:  false,
      depthWrite: false,
    });
    const curve = new THREE.LineCurve3(a.clone(), b.clone());
    const segments = Math.max(2, Math.ceil(a.distanceTo(b) * 6));
    const geo  = new THREE.TubeGeometry(curve, segments, TUBE_R, 3, false);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 10;
    roomGroup.add(mesh);
  }

  // Draw a two-leg reflection path (speaker → bounce → listener) using mesh tubes.
  // Adds a pulsing sphere at the bounce point, a travelling pulse dot, and a
  // surface-normal indicator at the bounce point.
  // absorption: 0 = full strength, 1 = fully absorbed (dims tubes + dots)
  function drawReflectionPath(start, bounce, end, color = 0xd4950f, absorption = 0) {
    const tubeOpacity = 0.85 * (1 - absorption * 0.75);
    _addReflectionTube(start, bounce, color, tubeOpacity);
    _addReflectionTube(bounce, end,   color, tubeOpacity * 0.5); // second leg dimmer — energy lost at panel

    // Static pulsing dot at bounce point
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(useFatEdges ? 0.075 : 0.055, 8, 8),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.9 * (1 - absorption * 0.7),
        depthTest: false, depthWrite: false,
      })
    );
    dot.position.copy(bounce);
    dot.renderOrder = 12;
    dot.userData.isPulseDot = true;
    roomGroup.add(dot);

    // Travelling pulse dot — animates along start → bounce → end
    const tDot = new THREE.Mesh(
      new THREE.SphereGeometry(useFatEdges ? 0.042 : 0.030, 6, 6),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0,
        depthTest: false, depthWrite: false,
      })
    );
    tDot.renderOrder = 13;
    tDot.userData.isTravelDot = {
      path: [start.clone(), bounce.clone(), end.clone()],
      phaseOffset: Math.random()
    };
    roomGroup.add(tDot);

    // Bounce normal — bisector of (bounce→start) and (bounce→end), 0.28 m long
    const toSrc = new THREE.Vector3().subVectors(start, bounce).normalize();
    const toDst = new THREE.Vector3().subVectors(end,   bounce).normalize();
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
      const _isGable   = room.ceiling_type === "gable";
      const _hasSlopedCeiling = _isSlanted || _isGable;
      const _lowH = _hasSlopedCeiling ? Math.min(room.ceiling_height_secondary_m, room.height_m) : room.height_m;
      const _slantDir = room.ceiling_slant_direction || "left_to_right";
      const _gableAxis = room.ceiling_gable_axis || "depth";
      const _highY =  room.height_m / 2;
      const _lowY  = -room.height_m / 2 + _lowH;

      if (_isSlanted) {
        // Build a quad with vertices at the actual ceiling height at each corner
        // This avoids Euler rotation twisting entirely
        const _hW = room.width_m / 2;
        const _hL = room.length_m / 2;

        // Compute ceiling Y at each corner based on slant direction
        function _ceilY(x, z) {
          let t;
          switch (_slantDir) {
            case "left_to_right":  t = (x + _hW) / room.width_m;  break;
            case "right_to_left":  t = 1 - (x + _hW) / room.width_m; break;
            case "front_to_back":  t = 1 - (z + _hL) / room.length_m; break;
            case "back_to_front":  t = (z + _hL) / room.length_m; break;
            default: t = (x + _hW) / room.width_m;
          }
          return _lowY + t * (_highY - _lowY);
        }

        const verts = new Float32Array([
          -_hW, _ceilY(-_hW, -_hL), -_hL,
           _hW, _ceilY( _hW, -_hL), -_hL,
           _hW, _ceilY( _hW,  _hL),  _hL,
          -_hW, _ceilY(-_hW,  _hL),  _hL,
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
               _hW, _lowY,  _hL, // 2 BR
              -_hW, _lowY,  _hL, // 3 BL
                 0, _highY, -_hL, // 4 F Ridge
                 0, _highY,  _hL  // 5 B Ridge
            ])
          : new Float32Array([
              -_hW, _lowY, -_hL, // 0 FL
               _hW, _lowY, -_hL, // 1 FR
               _hW, _lowY,  _hL, // 2 BR
              -_hW, _lowY,  _hL, // 3 BL
              -_hW, _highY,    0, // 4 L Ridge
               _hW, _highY,    0  // 5 R Ridge
            ]);
            
        const indices = _gableAxis === "depth"
          ? [0, 3, 5,   0, 5, 4,   1, 4, 5,   1, 5, 2]
          : [1, 5, 4,   1, 4, 0,   2, 5, 4,   2, 4, 3];

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
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillStyle = '#9ca3af';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, W / 2, H / 2);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({
      map:         tex,
      transparent: true,
      opacity:     0.55,
      depthTest:   false,
      depthWrite:  false,
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
    const hW     =  room.width_m  / 2;
    const hL     =  room.length_m / 2;
    // Raise labels slightly above floor so they sit on the bottom edge
    const labelY = floorY + 0.35;
    // Pull slightly inside each wall so they don't z-fight the wireframe edge
    const inset  = 0.12;

    const labels = [
      { text: 'Front',  pos: [  0,      labelY, -hL + inset] },
      { text: 'Rear',   pos: [  0,      labelY,  hL - inset] },
      { text: 'L',      pos: [-hW + inset, labelY,  0        ] },
      { text: 'R',      pos: [ hW - inset, labelY,  0        ] },
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
          color: 0xd4950f,
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
      const floorY    = -room.height_m / 2 + 0.005;
      const fTweeterY = -room.height_m / 2 + (room.tweeter_height_m || 0.95);
      const fEarY     = -room.height_m / 2 + 1.0;
      const fListZ    = -room.length_m / 2 + room.listener_front_m;

      for (const fSide of [-1, 1]) {
        const spkX = offsetX + fSide * room.spk_spacing_m / 2;
        const spkZ = -room.length_m / 2 + room.spk_front_m;
        // Mirror speaker across floor plane
        const mirrorY = -room.height_m - fTweeterY;
        // Find floor bounce point: parametric line from mirrorImage to listener
        const t = (floorY - mirrorY) / (fEarY - mirrorY);
        const bounceX = spkX + t * (offsetX - spkX);
        const bounceZ = spkZ + t * (fListZ   - spkZ);
        drawReflectionPath(
          new THREE.Vector3(spkX,    fTweeterY, spkZ),
          new THREE.Vector3(bounceX, floorY,    bounceZ),
          new THREE.Vector3(offsetX, fEarY,     fListZ),
          0xd4950f
        );
      }
    }

    // ---- SBIR ----
    if (overlayEnabled(OVERLAYS.SBIR)) {

      const sbirDepth = Math.max(room.spk_front_m || 0.2, 0.2);

      // Simulated improvement when traps enabled
      const effectiveScore = simulatePanels
        ? Math.min(activeScore + 1.8, 10)
        : activeScore;

      const isSevere = effectiveScore < 5;

      // ── Live SBIR interference field (ShaderMaterial) ─────────────────────
      // Two point sources per speaker (direct + front-wall mirror image).
      // The shader computes the exact wave interference at every pixel in the
      // horizontal plane at tweeter height — destructive bands = SBIR nulls.
      const fieldColor = isSevere ? 0xff3b3b : 0x0f766e;
      const tweeterY   = -room.height_m / 2 + (room.tweeter_height_m || 0.95);
      const frontWallZ = -room.length_m / 2;
      const isFocSBIR  = isFocused(OVERLAYS.SBIR);

      // Front wall glow — anchors the field to the reflective surface
      const wallGlow = new THREE.Mesh(
        new THREE.PlaneGeometry(room.width_m, room.height_m),
        new THREE.MeshBasicMaterial({
          color: fieldColor, transparent: true,
          opacity: isFocSBIR ? 0.10 : 0.05,
          side: THREE.DoubleSide, depthWrite: false
        })
      );
      wallGlow.position.set(offsetX, 0, frontWallZ + 0.01);
      roomGroup.add(wallGlow);

      // Wave number k = π/(2d) gives first SBIR null at f0 = C/(4d)
      const sbirK = Math.PI / (2 * sbirDepth);

      const sbirMat = new THREE.ShaderMaterial({
        uniforms: {
          uTime:    { value: 0 },
          uK:       { value: sbirK },
          uSpkL:    { value: new THREE.Vector2(offsetX - room.spk_spacing_m / 2, frontWallZ + sbirDepth) },
          uSpkR:    { value: new THREE.Vector2(offsetX + room.spk_spacing_m / 2, frontWallZ + sbirDepth) },
          uRoomW:   { value: room.width_m },
          uRoomL:   { value: room.length_m },
          uColor:      { value: new THREE.Color(fieldColor) },
          uOpacity:    { value: isFocSBIR ? 0.55 : 0.20 },
          uAbsorption: { value: simulatePanels ? 0.75 : 0.0 },
        },
        vertexShader: `
          uniform float uRoomW;
          uniform float uRoomL;
          varying vec2 vXZ;
          void main() {
            // Map UV → world XZ (PlaneGeometry rotated -90° around X)
            vXZ = vec2(
              (uv.x - 0.5) * uRoomW,
              (0.5 - uv.y) * uRoomL
            );
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          #define PI 3.14159265359
          uniform float uTime;
          uniform float uK;
          uniform vec2  uSpkL;
          uniform vec2  uSpkR;
          uniform float uRoomL;
          uniform vec3  uColor;
          uniform float uOpacity;
          uniform float uAbsorption;
          varying vec2  vXZ;
          void main() {
            float wallZ = -uRoomL * 0.5;
            // Mirror images behind the front wall (rigid reflection = +PI phase)
            vec2 mirL = vec2(uSpkL.x, 2.0 * wallZ - uSpkL.y);
            vec2 mirR = vec2(uSpkR.x, 2.0 * wallZ - uSpkR.y);
            // Bass traps reduce reflected wave — absorption 0=none, 1=full
            float refl = 1.0 - uAbsorption;
            float wL = sin(distance(vXZ, uSpkL) * uK - uTime)
                     + refl * sin(distance(vXZ, mirL) * uK - uTime);
            float wR = sin(distance(vXZ, uSpkR) * uK - uTime)
                     + refl * sin(distance(vXZ, mirR) * uK - uTime);
            float field = (wL + wR) * 0.25;
            gl_FragColor = vec4(uColor, clamp(abs(field) * uOpacity, 0.0, 0.92));
          }
        `,
        transparent: true,
        depthWrite:  false,
        side: THREE.DoubleSide,
      });

      const sbirField = new THREE.Mesh(
        new THREE.PlaneGeometry(room.width_m, room.length_m, 1, 1),
        sbirMat
      );
      sbirField.rotation.x = -Math.PI / 2;
      sbirField.position.set(0, tweeterY, 0);
      sbirField.userData.isSbirField = true;
      roomGroup.add(sbirField);

      // ------------------------------------------
      // REAR CORNER BASS TRAPS (2 only)
      // ------------------------------------------
      if (simulatePanels) {

        const trapSize = 0.35;
        const trapHeight = room.height_m * 0.9;

        const trapMaterial = new THREE.MeshBasicMaterial({
          color: 0x22c55e,
          transparent: true,
          opacity: 0.30,
          depthWrite: false,
          side: THREE.DoubleSide
        });

        const halfW = room.width_m / 2;
        const rearZ = -room.length_m / 2;

        // Create triangular shape once
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.lineTo(trapSize, 0);
        shape.lineTo(0, trapSize);
        shape.lineTo(0, 0);

        const geometry = new THREE.ExtrudeGeometry(shape, {
          depth: trapHeight,
          bevelEnabled: false
        });

        // Make height vertical
        geometry.rotateX(-Math.PI / 2);

        // -----------------------------
        // LEFT REAR TRAP
        // -----------------------------
        const leftTrap = new THREE.Mesh(geometry.clone(), trapMaterial);

        leftTrap.position.set(
          -halfW,
          -room.height_m / 2,
          rearZ
        );

        // Rotate clockwise (as viewed from listener)
        leftTrap.rotation.y = -Math.PI / 2;

        roomGroup.add(leftTrap);

        // -----------------------------
        // RIGHT REAR TRAP
        // -----------------------------
        const rightTrap = new THREE.Mesh(geometry.clone(), trapMaterial);

        rightTrap.position.set(
          halfW,
          -room.height_m / 2,
          rearZ
        );

        // Rotate anti-clockwise
        rightTrap.rotation.y = Math.PI;

        roomGroup.add(rightTrap);
      }

      if (isFocused(OVERLAYS.SBIR)) {


        // ------------------------------------------
        // SCORE ADJUSTMENT (Corner Trap Simulation)
        // ------------------------------------------
        let effectiveScore = activeScore;

        if (simulatePanels) {
          effectiveScore = Math.min(activeScore + 1.8, 10);
        }

        const speakerY = -room.height_m / 2 + room.tweeter_height_m;
        const listenerZ = -room.length_m / 2 + room.listener_front_m;
        const wallZ = -room.length_m / 2;

        // LEFT speaker → front wall → listener
        drawReflectionPath(
          new THREE.Vector3(
            offsetX - room.spk_spacing_m / 2,
            speakerY,
            wallZ + room.spk_front_m
          ),
          new THREE.Vector3(
            offsetX - room.spk_spacing_m / 2,
            speakerY,
            wallZ
          ),
          new THREE.Vector3(
            offsetX,
            speakerY,
            listenerZ
          ),
          effectiveScore < 5 ? 0xff3e00 : 0x14b8a6
        );

        // RIGHT speaker → front wall → listener
        drawReflectionPath(
          new THREE.Vector3(
            offsetX + room.spk_spacing_m / 2,
            speakerY,
            wallZ + room.spk_front_m
          ),
          new THREE.Vector3(
            offsetX + room.spk_spacing_m / 2,
            speakerY,
            wallZ
          ),
          new THREE.Vector3(
            offsetX,
            speakerY,
            listenerZ
          ),
          effectiveScore < 5 ? 0xff3e00 : 0x14b8a6
        );
      }
    
    }

    // ---- SIDE WALL REFLECTIONS ----
    if (overlayEnabled(OVERLAYS.SIDE_REFLECTIONS)) {

      const sideGap = (room.width_m - room.spk_spacing_m) / 2;
      const isTooClose = sideGap < 0.6;

      let effectiveScore = activeScore;

      if (simulatePanels && isTooClose) {
        effectiveScore = Math.min(activeScore + 2, 10);
      }

      const sideOffset = room.width_m / 2 - 0.05;
      const panelWidth = room.length_m * 0.45;
      const panelHeight = room.height_m * 0.6;

      const speakerY = -room.height_m / 2 + room.tweeter_height_m;
      const listenerPos = new THREE.Vector3(
        offsetX,
        speakerY,
        -room.length_m / 2 + room.listener_front_m
      );

      const wallX = room.width_m / 2;

      for (const side of [-1, 1]) {

        // -----------------------------
        // REFLECTION RAY (only when focused)
        // -----------------------------
        if (isFocused(OVERLAYS.SIDE_REFLECTIONS)) {

          const speakerPos = new THREE.Vector3(
            offsetX + side * room.spk_spacing_m / 2,
            speakerY,
            -room.length_m / 2 + room.spk_front_m
          );

          // Mirror speaker across side wall
          const mirrorSpeaker = speakerPos.clone();
          mirrorSpeaker.x = side * wallX + (side * wallX - speakerPos.x);

          // Ray from listener to mirrored speaker
          const dir = new THREE.Vector3().subVectors(mirrorSpeaker, listenerPos);

          // Intersection with wall plane (x = ±wallX)
          const t = (side * wallX - listenerPos.x) / dir.x;
          const bouncePoint = listenerPos.clone().add(dir.multiplyScalar(t));

          console.log("Bounce Z:", bouncePoint.z);

          // -----------------------------
          // ACOUSTIC PANEL SIMULATION
          // -----------------------------
          if (simulatePanels) {

            const panelWidth = 0.9;
            const panelHeight = 1.2;

            // Elliptical first-reflection zone (more accurate than a rectangle)
            const ellipseShape = new THREE.Shape();
            ellipseShape.absellipse(0, 0, panelWidth / 2, panelHeight / 2, 0, Math.PI * 2, false, 0);
            const panel = new THREE.Mesh(
              new THREE.ShapeGeometry(ellipseShape, 40),
              new THREE.MeshBasicMaterial({
                color: 0x22c55e,
                transparent: true,
                opacity: 0.28,
                side: THREE.DoubleSide,
                depthWrite: false
              })
            );

            panel.rotation.y = Math.PI / 2;

            panel.position.set(
              side * (room.width_m / 2 - 0.01),
              bouncePoint.y,
              bouncePoint.z
            );

            roomGroup.add(panel);
          }

          // Draw reflection path — dimmed when side panel absorbs at bounce point
          drawReflectionPath(
            speakerPos,
            bouncePoint,
            listenerPos,
            effectiveScore < 5 ? 0xff3e00 : 0x14b8a6,
            simulatePanels ? 0.72 : 0
          );
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

    // ---- BANDWIDTH (ROOM MODE PRESSURE FIELD) ----
    if (overlayEnabled(OVERLAYS.BANDWIDTH)) {

      const isFocBW   = focusedOverlay === OVERLAYS.BANDWIDTH;
      
      const bwModes = window.MeasurelyAcoustics?.computeRoomModes(room) || [];
      const uBwModes = [];
      // Select lowest 8 modes for bass pressure mapping
      bwModes.slice(0, 8).forEach(m => {
          const yFrac = 0; // floor plane → cos(r·π·0) = 1 for all r
          const rWeight = Math.cos(m.r * Math.PI * yFrac);
          uBwModes.push(new THREE.Vector3(m.p, m.q, Math.abs(rWeight)));
      });
      while (uBwModes.length < 8) uBwModes.push(new THREE.Vector3(0,0,0));

      // Standing-wave pressure shader — maps exact spatial pressure of the room's
      // lowest resonant modes to visualise bass buildup accurately.
      const bwMat = new THREE.ShaderMaterial({
        uniforms: {
          uTime:   { value: 0 },
          uRoomW:  { value: room.width_m },
          uRoomL:  { value: room.length_m },
          uOpacity:{ value: isFocBW ? 0.90 : 0.45 },
          uModes:  { value: uBwModes }
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
          #define PI 3.14159265359
          uniform float uTime;
          uniform float uRoomW;
          uniform float uRoomL;
          uniform float uOpacity;
          uniform vec3  uModes[8]; // p, q, weight
          varying vec2 vXZ;

          void main() {
            float hW = uRoomW * 0.5;
            float hL = uRoomL * 0.5;

            float pressure = 0.0;
            float totalWeight = 0.001;

            for (int i = 0; i < 8; i++) {
                vec3 m = uModes[i];
                if (m.z > 0.0) {
                    float pL = cos(m.x * PI * (vXZ.y + hL) / uRoomL); // length = y locally
                    float pW = cos(m.y * PI * (vXZ.x + hW) / uRoomW); // width = x locally
                    pressure += m.z * pL * pW;
                    totalWeight += m.z;
                }
            }

            pressure /= totalWeight;

            // Standing waves pulse in place — amplitude oscillates, nodes fixed
            float pulse = 0.78 + 0.22 * cos(uTime * 1.6);

            float alpha = clamp(abs(pressure) * pulse * uOpacity, 0.0, 0.90);
            gl_FragColor = vec4(0.95, 0.45, 0.05, alpha); // deep orange
          }
        `,
        transparent: true,
        depthWrite:  false,
        side: THREE.DoubleSide,
      });

      const bwPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(room.width_m, room.length_m, 1, 1),
        bwMat
      );
      bwPlane.rotation.x = -Math.PI / 2;
      bwPlane.position.y = -room.height_m / 2 + 0.02;
      bwPlane.userData.isBandwidthField = true;
      roomGroup.add(bwPlane);

      // Subtle lower-wall glow — bass loads all boundaries, not just floor
      roomGroup.add(new THREE.Mesh(
        new THREE.BoxGeometry(room.width_m * 0.98, room.height_m * 0.28, room.length_m * 0.98),
        new THREE.MeshBasicMaterial({
          color: 0xd4950f, transparent: true,
          opacity: isFocBW ? 0.14 : 0.06, depthWrite: false
        })
      )).position.y = -room.height_m / 2 + room.height_m * 0.14;
    }

    // ---- BALANCE (STEREO SYMMETRY) ----
    if (overlayEnabled(OVERLAYS.BALANCE)) {

      const halfW   = room.width_m  / 2;
      const halfL   = room.length_m / 2;
      const floorY  = -room.height_m / 2;
      const spkY    = floorY + room.tweeter_height_m;
      const lstnZ   = -halfL + room.listener_front_m;
      const offset  = room.listener_offset_m || 0;
      const isBad   = Math.abs(offset) > 0.15;
      const isFocBal = isFocused(OVERLAYS.BALANCE);

      const spkL   = new THREE.Vector3(offsetX - room.spk_spacing_m / 2, spkY, -halfL + room.spk_front_m);
      const spkR   = new THREE.Vector3(offsetX + room.spk_spacing_m / 2, spkY, -halfL + room.spk_front_m);
      const lstn   = new THREE.Vector3(offsetX + offset, spkY, lstnZ);
      const alpha  = isFocBal ? 0.75 : 0.12;

      // 1. Centre axis tube along the floor
      _addReflectionTube(
        new THREE.Vector3(0, floorY + 0.01, -halfL + 0.15),
        new THREE.Vector3(0, floorY + 0.01,  halfL - 0.15),
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

      const floorY     = -room.height_m / 2;
      const ceilY      =  room.height_m / 2;
      const speakerY   = floorY + room.tweeter_height_m;
      const listenerZ  = -room.length_m / 2 + room.listener_front_m;
      const listenerPos = new THREE.Vector3(offsetX, speakerY, listenerZ);
      const isFocCl    = isFocused(OVERLAYS.CLARITY);
      const wallX      = room.width_m / 2;
      const clarityR   = 0.8;

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
        const reflPath   = spkPos.distanceTo(bounce) + bounce.distanceTo(listenerPos);
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
        drawReflectionPath(spkPos, ceilBounce, listenerPos, 0x6366f1);

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
            home:        { pos: DEFAULT_CAMERA.pos,              look: DEFAULT_CAMERA.target },
            dimensions:  { pos: DEFAULT_CAMERA.pos,              look: DEFAULT_CAMERA.target },
            placement:   { pos: DEFAULT_CAMERA.pos,              look: DEFAULT_CAMERA.target },
            // Materials: slightly higher angle to see floor furniture
            materials:   { pos: { x: 3.5, y: 6.0, z: 5.5 }, look: { x: 0, y: 0, z: 0 } }
          };

          const v = views[stepKey];
          if (!v) return;

          // Smooth camera lerp — ease-in-out-quad over 600 ms
          const FROM_POS  = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
          const FROM_LOOK = { x: controls.target.x,  y: controls.target.y,  z: controls.target.z  };
          const TO_POS    = v.pos;
          const TO_LOOK   = v.look;
          const DURATION  = 600; // ms
          const t0        = performance.now();

          flyAnim = {
            tick(now) {
              const raw = Math.min((now - t0) / DURATION, 1);
              // Ease-in-out quad
              const t = raw < 0.5 ? 2 * raw * raw : -1 + (4 - 2 * raw) * raw;

              camera.position.set(
                FROM_POS.x  + (TO_POS.x  - FROM_POS.x)  * t,
                FROM_POS.y  + (TO_POS.y  - FROM_POS.y)  * t,
                FROM_POS.z  + (TO_POS.z  - FROM_POS.z)  * t,
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
      activeOverlays.add(id);

      focusedOverlay = id;
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
        if (_roomGrid)  _roomGrid.scale.x  = w;
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
        if (_roomGrid)  _roomGrid.scale.z  = l;
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
        const d   = getRoomData() || {};
        const s   = d.setup || d;
        const deg = s.toe_in_deg || 0;
        const rad = deg * Math.PI / 180;
        if (_spkMeshL) _spkMeshL.rotation.y =  rad;
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
      const geo   = raw_room.geometry || raw_room;
      const setup = raw_room.setup    || raw_room;

      // ── Room half-extents (all positions derived from these) ────────────
      const W = (geo.width_m   || 4)   / 2;
      const L = (geo.length_m  || 5)   / 2;
      const H = (geo.height_m  || 2.6) / 2;

      // Named acoustic positions in scene-space
      // (room centred at origin; front wall = z:-L, back wall = z:+L, floor = y:-H)
      const spkZ  = -L + (setup.spk_front_m     || 0.45);
      const spkY  = -H + (setup.tweeter_height_m || 0.95);
      const lx    =       setup.listener_offset_m  || 0;
      const lz    = -L + (setup.listener_front_m   || 2.8);
      const ly    = -H + 1.1;  // seated ear height above floor

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
          ? Math.pow(2,  20 * t - 10) / 2
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
          cam:      P(lx,         H * 0.7,   -L * 2.1),
          look:     spkMid,
          ms:       3000,
          camEase:  EASE.power4InOut,
          lookEase: EASE.linear,
        },
        // STATE: OVERHEAD — long slow rise to god's-eye establishing shot.
        {
          cam:      P(W * 0.1,    H * 5.2,    L * 0.25),
          look:     P(0,           0,           0),
          ms:       4000,
          camEase:  EASE.power4InOut,
          lookEase: EASE.cubicInOut,
        },
        // STATE: SWOOP RIGHT — slow arc to the sweet-spot reveal.
        // Look leads the body to create the "director's cut" moment.
        {
          cam:      P(W * 2.3,    H * 0.85,   L * 0.95),
          look:     P(lx,          ly,          lz),
          ms:       4000,
          camEase:  EASE.expoInOut,
          lookEase: EASE.power4InOut,
        },
        // STATE: LANDING — long expo descent to the listener's ear level.
        {
          cam:      P(lx,          ly + 0.08,  lz + 0.55),
          look:     P(0,            ly - 0.05, -L + 0.7),
          ms:       5500,
          camEase:  EASE.expoInOut,
          lookEase: EASE.expoInOut,
        },
      ];

      // ── State machine ───────────────────────────────────────────────────
      // prevCam / prevLook track the exact endpoint of the previous frame so
      // each frame's lerp always starts precisely where the last one ended.
      let prevCam  = P(camera.position.x, camera.position.y, camera.position.z);
      let prevLook = P(controls.target.x,  controls.target.y,  controls.target.z);
      let frameIdx   = 0;
      let frameStart = performance.now();

      controls.enabled = false;

      flyAnim = {
        tick(now) {
          const frame = keyframes[frameIdx];
          if (!frame) return;

          const elapsed = now - frameStart;
          const rawT    = Math.min(elapsed / frame.ms, 1);
          const tc      = frame.camEase(rawT);
          const tl      = frame.lookEase(rawT);

          // Interpolate camera body position
          camera.position.set(
            prevCam.x  + (frame.cam.x  - prevCam.x)  * tc,
            prevCam.y  + (frame.cam.y  - prevCam.y)  * tc,
            prevCam.z  + (frame.cam.z  - prevCam.z)  * tc,
          );

          // Interpolate look-at target (independent easing from body)
          controls.target.set(
            prevLook.x + (frame.look.x - prevLook.x) * tl,
            prevLook.y + (frame.look.y - prevLook.y) * tl,
            prevLook.z + (frame.look.z - prevLook.z) * tl,
          );

          if (rawT >= 1) {
            // Snap to exact endpoint to eliminate float accumulation drift
            prevCam  = { ...frame.cam };
            prevLook = { ...frame.look };
            frameIdx++;
            frameStart = now;

            if (frameIdx >= keyframes.length) {
              // Landed — leave controls disabled; caller decides what comes next
              camera.position.set(frame.cam.x,  frame.cam.y,  frame.cam.z);
              controls.target.set(frame.look.x, frame.look.y, frame.look.z);
              controls.update();
              flyAnim = null;
              onDone?.();
            }
          }
        },
      };
    },

    /** Toggle expanding sound-wave rings from each speaker.  Triggers a rebuild. */
    setWaves(enabled) {
      _wavesEnabled = !!enabled;
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
  };

  // Always accessible from the browser console as window.room3d
  window.room3d = api;

  return api;
}