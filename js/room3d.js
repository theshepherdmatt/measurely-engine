/* ==========================================================
   Measurely 3D Room Engine (Reusable) — DEBUG BUILD
   ========================================================== */

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
  mode = "setup"
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
  let renderStage = "room"; 
  const activeOverlays = new Set();
  let focusedOverlay = null;
  let activeScore = 10;
  let smoothnessStd = 0;
  let simulatePanels = false;
  let flyAnim = null;

  function overlayEnabled(id) {
    return activeOverlays.has(id);
  }

/* ------------------------------------------
   COLOUR STATES (Refined for Glow)
------------------------------------------ */
  const ROOM_COLOURS = {
    idle: {
      room: 0x6366f1,     // Measurely purple
      accent: 0x818cf8,   // Cyan accent
      furniture: 0x4338ca // Deeper purple for grounding
    },
    active: {
      room: 0x22d3ee,
      accent: 0xffffff,   // White glow for analysis
      furniture: 0x0e7490
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

  const LINE_BOOST = isTablet ? 1.35 : 1.0;


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
  window.addEventListener("resize", () => {
    console.log("[Room3D] window resize");
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });


  /* ------------------------------------------
     REBUILD SCENE (GEOMETRY ONLY)
  ------------------------------------------ */
function rebuild() {
    renderStage = "furnishings"; 
    console.log("[Room3D] 🔧 rebuild() called | mode =", currentMode);

    roomGroup.clear();
    colourState = "idle";

    const data = getRoomData(); 
    window.__MEASURELY_ROOM__ = data;

    if (!data) return;

    // 1. UNPACKING
    const geo   = data.geometry    || data;
    const setup = data.setup       || data;
    const env   = data.environment || data;
    
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

    const OP_WIRE = (isLocked ? 0.25 : (isFinal ? 0.85 : 0.5)) * DIM_FACTOR;
    const OP_OBJ  = (isLocked ? 0.15 : (isFinal ? 0.6 : 0.25)) * DIM_FACTOR;

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

    if (VISIBILITY.roomShell) {
      const wireMat = new THREE.LineBasicMaterial({
        color: colors.room,
        transparent: true,
        opacity: focusedOverlay ? 0.18 : 1.0,
        depthTest: false,
        depthWrite: false
      });

      if (!isSlanted && !isGable) {
        const roomGeo = new THREE.BoxGeometry(room.width_m, room.height_m, room.length_m);
        const roomEdges = new THREE.LineSegments(new THREE.EdgesGeometry(roomGeo), wireMat);
        roomEdges.renderOrder = 1;
        roomGroup.add(roomEdges);
      } else if (isSlanted) {
        // 8 vertices — each ceiling corner uses ceilingYAt
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

        const points = [];
        edgePairs.forEach(([a, b]) => { points.push(v[a], v[b]); });
        const geo = new THREE.BufferGeometry().setFromPoints(points);
        const edges = new THREE.LineSegments(geo, wireMat);
        edges.renderOrder = 1;
        roomGroup.add(edges);
      } else if (isGable) {
        // 10 vertices: 4 floor + 4 eaves + 2 ridge
        const eavesY = lowY;
        const peakY  = highY;

        if (gableAxis === "depth") {
          // Ridge runs front-to-back (Z), slopes on X
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
            [0,1],[1,2],[2,3],[3,0],       // floor
            [0,4],[1,5],[2,6],[3,7],       // verticals
            [4,7],[5,6],                    // side wall tops (eaves)
            [8,9],                          // ridge
            [4,8],[8,5],[7,9],[9,6],       // gable slopes
          ];
          const points = [];
          edgePairs.forEach(([a, b]) => { points.push(v[a], v[b]); });
          const geo = new THREE.BufferGeometry().setFromPoints(points);
          const edges = new THREE.LineSegments(geo, wireMat);
          edges.renderOrder = 1;
          roomGroup.add(edges);
        } else {
          // Ridge runs left-to-right (X), slopes on Z
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
            [0,1],[1,2],[2,3],[3,0],       // floor
            [0,4],[1,5],[2,6],[3,7],       // verticals
            [4,5],[6,7],                    // front/back wall tops (eaves)
            [8,9],                          // ridge
            [4,8],[8,7],[5,9],[9,6],       // gable slopes
          ];
          const points = [];
          edgePairs.forEach(([a, b]) => { points.push(v[a], v[b]); });
          const geo = new THREE.BufferGeometry().setFromPoints(points);
          const edges = new THREE.LineSegments(geo, wireMat);
          edges.renderOrder = 1;
          roomGroup.add(edges);
        }
      }
    }

    const floorGeo = new THREE.PlaneGeometry(room.width_m * 1.1, room.length_m * 1.1);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.2,
      metalness: 0.4,
      transparent: true,
      opacity: 0.6,        // critical
      depthWrite: false
    });

    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -room.height_m / 2 - 0.01; // Tiny offset to prevent flickering
    roomGroup.add(floor);

    /* ------------------------------------------
       GRID
    ------------------------------------------ */
    if (VISIBILITY.grid) {
      const grid = new THREE.GridHelper(
        10,
        20,
        colors.room,   // primary lines
        0x334155       // softer slate for secondary lines
      );

      grid.position.y = -room.height_m / 2;
      grid.material.transparent = true;
      grid.material.opacity = 0.38;     // 👈 the key number
      grid.material.depthWrite = false;

      const gridMats = Array.isArray(grid.material) ? grid.material : [grid.material];
      gridMats.forEach(m => {
        m.transparent = true;
        m.opacity = focusedOverlay ? 0.1 : 0.45;
        m.depthTest = false;
        m.depthWrite = false;
      });

      roomGroup.add(grid);
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
            w: 0.34,
            h: 1.05,
            d: 0.32,
            color: 0x7c5cff,
            tweeterPos: 0.9   // near top of cabinet
          };

        case "panel":
          return {
            w: 0.90,
            h: 0.80,
            d: 0.08,
            color: 0xa5b4fc,
            lift: 0.05,
            tweeterPos: 0.65 // acoustic centre, not literal tweeter
          };

        case "standmount":
        default:
          return {
            w: 0.30,
            h: 0.65,
            d: 0.28,
            color: colors.accent,
            tweeterPos: 0.85 // bookshelves on stands
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
        SPEAKERS + BEAMS (LEVEL AXIS LOCK)
    ------------------------------------------ */
    if (renderStage === "speakers" || renderStage === "furnishings") {
      const toeRad = (room.toe_in_deg || 0) * Math.PI / 180;
      const baseY = -room.height_m / 2;

      ["L", "R"].forEach(side => {
        const profile = getSpeakerProfile(room.speaker_type);
        const isSpkHighlit = highlightTarget === 'speakers';
        
        const speaker = new THREE.Mesh(
          new THREE.BoxGeometry(profile.w, profile.h, profile.d),
          new THREE.MeshBasicMaterial({
            color: isSpkHighlit ? 0x22d3ee : profile.color,
            wireframe: true,
            transparent: true,
            opacity: isSpkHighlit ? 0.9 : Math.max(OP_OBJ, 0.5)
          })
        );

        // X and Z remain based on spacing and front-wall distance
        const x = offsetX + (side === "L" ? -1 : 1) * room.spk_spacing_m / 2;
        const z = -room.length_m / 2 + room.spk_front_m;

        /**
         * LEVEL LOCK LOGIC:
         * We want the "tweeter" point of the speaker box to be exactly at room.tweeter_height_m.
         * profile.tweeterPos represents where the tweeter is on the box (e.g., 0.2 is 20% down from top).
         */
        const tweeterOffsetFromCenter = (profile.h / 2) - (profile.h * (profile.tweeterPos || 0.5));
        const y = baseY + room.tweeter_height_m + tweeterOffsetFromCenter;

        speaker.position.set(x, y, z);
        
        // Horizontal rotation only (Toe-in)
        speaker.rotation.y = (side === "L" ? 1 : -1) * toeRad;

        // --- BEAMS (Perfectly Horizontal) ---
        const beam = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, room.length_m)
          ]),
          new THREE.LineDashedMaterial({
            color: isSpkHighlit ? 0x22d3ee : profile.color,
            dashSize: 0.25,
            gapSize: 0.15,
            transparent: true,
            opacity: isSpkHighlit ? 0.85 : 0.45
          })
        );
        beam.computeLineDistances();
        
        speaker.add(beam);
        roomGroup.add(speaker);
      });
    }

  /* ------------------------------------------
      LISTENER (STUDIO HEIGHT SYNC)
  ------------------------------------------ */
  const listenerZ = -room.length_m / 2 + room.listener_front_m;

  // In Studio mode, seated height is usually 1.1m - 1.2m. 
  // We use tweeter_height_m to allow fine-tuning.
  const effectiveHeadHeight = isStudio 
    ? Math.max(1.1, room.tweeter_height_m + 0.2) // Offset head above speaker height
    : room.tweeter_height_m;

  const isListHighlit = highlightTarget === 'listener';
  const listener = new THREE.Mesh(
    new THREE.SphereGeometry(isListHighlit ? 0.26 : 0.18, 24, 24),
    new THREE.MeshBasicMaterial({
      color: isListHighlit ? 0x22d3ee : colors.accent,
      wireframe: true,
      transparent: true,
      opacity: isListHighlit ? 0.95 : 0.6
    })
  );

// Force the head height to be exactly the same as the tweeter height
  listener.position.set(
    offsetX + (room.listener_offset_m || 0),
    -room.height_m / 2 + room.tweeter_height_m,
    listenerZ
  );
  roomGroup.add(listener);

  /* ------------------------------------------
    FURNITURE (Refined Modular Look)
  ------------------------------------------ */
  const furnMat = new THREE.MeshStandardMaterial({
    color: colors.furniture,
    emissive: colors.furniture,
    emissiveIntensity: 0.35,
    wireframe: true,
    transparent: true,
    opacity: OP_OBJ,

    depthTest: false,    // THIS fixes the flicker
    depthWrite: false
  });

  /* ------------------------------------------
    RUG (Restored)
  ------------------------------------------ */
  if (VISIBILITY.furniture.rug && room.opt_area_rug && !hasFocus) {
    const rug = new THREE.Mesh(
      new THREE.PlaneGeometry(
        room.width_m * 0.45,
        room.length_m * 0.35
      ),
      new THREE.MeshStandardMaterial({
        color: 0x64748b,
        wireframe: true,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
        depthTest: false
      })

    );

    rug.rotation.x = -Math.PI / 2;
    rug.position.set(
      offsetX,
      -room.height_m / 2 + 0.01,
      listenerZ - 1.15
    );

    roomGroup.add(rug);
  }

  // 1. SOFA (Only show if Home mode AND Sofa option is on)
  if (VISIBILITY.furniture.sofa && !isStudio && room.opt_sofa && !hasFocus) {
    const sofaGroup = new THREE.Group();

    // The Base Seat
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.4, 0.9), furnMat);
    base.position.y = 0.2;
    sofaGroup.add(base);

    // The Backrest
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.5, 0.2), furnMat);
    back.position.set(0, 0.55, 0.35); 
    sofaGroup.add(back);

    // The Arms
    const armGeo = new THREE.BoxGeometry(0.2, 0.35, 0.9);
    const leftArm = new THREE.Mesh(armGeo, furnMat);
    leftArm.position.set(-0.95, 0.4, 0);
    const rightArm = new THREE.Mesh(armGeo, furnMat);
    rightArm.position.set(0.95, 0.4, 0);
    sofaGroup.add(leftArm, rightArm);

    // Position at listener coordinates
    sofaGroup.position.set(offsetX, -room.height_m / 2, listenerZ);
    roomGroup.add(sofaGroup);
  }

  // --- STUDIO MODE: WIREFRAME DESK & OFFICE CHAIR ---
  if (isStudio && !hasFocus) {
    // 1. THE DESK (Locked to the front wall/speakers)
    const deskGroup = new THREE.Group();
    
    const deskTop = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.8), furnMat);
    deskTop.position.y = 0.75; 
    deskGroup.add(deskTop);

    const legGeo = new THREE.BoxGeometry(0.04, 0.75, 0.04);
    const legPos = [[-0.75, 0.375, -0.35], [0.75, 0.375, -0.35], [-0.75, 0.375, 0.35], [0.75, 0.375, 0.35]];
    legPos.forEach(p => {
      const leg = new THREE.Mesh(legGeo, furnMat);
      leg.position.set(...p);
      deskGroup.add(leg);
    });

    // Position Desk: Front wall + speaker distance + desk depth/2
    const deskZ = -room.length_m / 2 + room.spk_front_m + 0.4;
    deskGroup.position.set(offsetX, -room.height_m / 2, deskZ);
    roomGroup.add(deskGroup);


    // 2. THE OFFICE CHAIR (Follows you as you roll back)
    const chairGroup = new THREE.Group();
    
    const star1 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 0.1), furnMat);
    const star2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.6), furnMat);
    star1.position.y = star2.position.y = 0.02;
    chairGroup.add(star1, star2);
    
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.4, 0.08), furnMat);
    stem.position.y = 0.2;
    chairGroup.add(stem);
    
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.5), furnMat);
    seat.position.y = 0.45;
    chairGroup.add(seat);
    
    const support = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.4, 0.04), furnMat);
    support.position.set(0, 0.65, 0.22);
    support.rotation.x = -0.15; 
    chairGroup.add(support);
    
    const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.05), furnMat);
    backrest.position.set(0, 0.85, 0.28);
    chairGroup.add(backrest);
    
    // POSITION CHAIR: Centered under the Sphere
    // We subtract 0.25 so the sphere (head) sits over the seat, not the stem
    chairGroup.position.set(
      offsetX + (room.listener_offset_m || 0), 
      -room.height_m / 2, 
      listenerZ - 0.15 
    );
    roomGroup.add(chairGroup);
  }

  // --- COFFEE TABLE ---
  if (VISIBILITY.furniture.coffeeTable && room.opt_coffee_table && !hasFocus) {
    console.log("[Room3D] Adding coffee table frame");
    const tableGroup = new THREE.Group();

    // Table Top (Thinner for a glass/modern look)
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 0.6), furnMat);
    top.position.y = 0.4;
    tableGroup.add(top);

    // Four Legs
    const legGeo = new THREE.BoxGeometry(0.04, 0.4, 0.04);
    const legPositions = [
      [-0.45, 0.2, -0.25], [0.45, 0.2, -0.25],
      [-0.45, 0.2, 0.25],  [0.45, 0.2, 0.25]
    ];

    legPositions.forEach(pos => {
      const leg = new THREE.Mesh(legGeo, furnMat);
      leg.position.set(...pos);
      tableGroup.add(leg);
    });

    // Table Position
    tableGroup.position.set(offsetX, -room.height_m / 2, listenerZ - 1.2);
    roomGroup.add(tableGroup);
  }

  /* ------------------------------------------
     ACOUSTIC TREATMENT PANELS
  ------------------------------------------ */
  const panelMat = new THREE.MeshStandardMaterial({
    color: 0x22d3ee,
    emissive: 0x22d3ee,
    emissiveIntensity: 0.4,
    wireframe: true,
    transparent: true,
    opacity: 0.35,
    depthTest: false,
    depthWrite: false
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

  // ---- SMOOTHNESS (Spectral Turbulence Field) ----
  if (overlayEnabled(OVERLAYS.SMOOTHNESS)) {

    const intensity = THREE.MathUtils.clamp(smoothnessStd / 4, 0, 1);

    const geo = new THREE.PlaneGeometry(
      room.width_m * 0.8,
      room.length_m * 0.6,
      40,
      40
    );

    geo.attributes.position.setUsage(THREE.DynamicDrawUsage);

    const mat = new THREE.MeshBasicMaterial({
      color: intensity > 0.6 ? 0xff3b3b : 0x22d3ee,
      wireframe: true,
      transparent: true,
      opacity: focusedOverlay === OVERLAYS.SMOOTHNESS ? 0.9 : 0.15,
      depthWrite: false
    });

    const field = new THREE.Mesh(geo, mat);
    field.rotation.x = -Math.PI / 2;
    field.position.set(
      0,
      -room.height_m / 2 + room.tweeter_height_m,
      -room.length_m * 0.1
    );

    field.userData.isSmoothnessField = true;

    roomGroup.add(field);
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

    // Smoothness field animation
    if (focusedOverlay === OVERLAYS.SMOOTHNESS) {
      const field = roomGroup.children.find(o => o.userData?.isSmoothnessField);
      if (field) {
        const pos = field.geometry.attributes.position;
        const time = performance.now() * 0.001;
        const intensity = THREE.MathUtils.clamp(smoothnessStd / 8, 0, 1);

        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const y = pos.getY(i);

          const ripple =
            Math.sin(x * 3 + time * 2.0) *
            Math.cos(y * 2 + time * 1.5);

          pos.setZ(i, ripple * 0.12 * intensity);
        }

        pos.needsUpdate = true;
        field.geometry.computeVertexNormals();
      }
    }

    roomGroup.scale.set(scale, scale, scale);
    if (flyAnim) flyAnim.tick(performance.now());
    controls.update();
    renderer.render(scene, camera);

  }


  function drawReflectionPath(start, bounce, end, color = 0x818cf8) {
    const points = [start, bounce, end];

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(
      geometry,
      new THREE.LineDashedMaterial({
        color,
        dashSize: 0.25,
        gapSize: 0.15,
        transparent: true,
        opacity: 0.7
      })
    );

    line.computeLineDistances();
    roomGroup.add(line);
  }

  /* ------------------------------------------
    FIELD HIGHLIGHT OVERLAYS (SETUP WIZARD)
  ------------------------------------------ */
  function renderHighlightOverlays(room) {
    if (!highlightTarget) return;

    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
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
          color: 0x6366f1,
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
    }

    // ---- SBIR ----
    if (overlayEnabled(OVERLAYS.SBIR)) {

      const sbirDepth = Math.max(room.spk_front_m || 0.2, 0.2);

      // Simulated improvement when traps enabled
      const effectiveScore = simulatePanels
        ? Math.min(activeScore + 1.8, 10)
        : activeScore;

      const isSevere = effectiveScore < 5;

      const sbirMaterial = new THREE.MeshStandardMaterial({
        color: isSevere ? 0xff3b3b : 0x22d3ee,
        emissive: isSevere ? 0xff0000 : 0x00f2ff,
        emissiveIntensity: simulatePanels ? 0.4 : 1.2,
        transparent: true,
        opacity: simulatePanels
          ? 0.25
          : (focusedOverlay === OVERLAYS.SBIR ? 0.6 : 0.15),
        depthWrite: false
      });

      const sbirZone = new THREE.Mesh(
        new THREE.BoxGeometry(
          room.width_m * 0.85,
          room.height_m * 0.6,
          sbirDepth
        ),
        sbirMaterial
      );

      sbirZone.position.set(
        0,
        -room.height_m / 2 + room.height_m * 0.3,
        -room.length_m / 2 + sbirDepth / 2
      );

      roomGroup.add(sbirZone);

      // ------------------------------------------
      // REAR CORNER BASS TRAPS (2 only)
      // ------------------------------------------
      if (simulatePanels) {

        const trapSize = 0.35;
        const trapHeight = room.height_m * 0.9;

        const trapMaterial = new THREE.MeshBasicMaterial({
          color: 0x22c55e,
          transparent: true,
          opacity: 0.85,
          depthWrite: false
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
          effectiveScore < 5 ? 0xff3b3b : 0x22d3ee
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
          effectiveScore < 5 ? 0xff3b3b : 0x22d3ee
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

            const panel = new THREE.Mesh(
              new THREE.PlaneGeometry(panelWidth, panelHeight),
              new THREE.MeshBasicMaterial({
                color: 0x22c55e,
                transparent: true,
                opacity: 0.75,
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

          // Draw reflection path
          drawReflectionPath(
            speakerPos,
            bouncePoint,
            listenerPos,
            effectiveScore < 5 ? 0xff3b3b : 0x22d3ee
          );

          // Glow dot at reflection point (optional but nice)
          const dot = new THREE.Mesh(
            new THREE.SphereGeometry(0.06, 12, 12),
            new THREE.MeshBasicMaterial({ color: 0x22d3ee })
          );
          dot.position.copy(bouncePoint);
          roomGroup.add(dot);
        }
      }
    }

    // ---- REAR WALL ENERGY ----
    if (overlayEnabled(OVERLAYS.REAR_ENERGY)) {
      const rearDepth = Math.max(
        room.length_m - room.listener_front_m - 0.3,
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
          color: 0x22d3ee,
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

    // ---- BANDWIDTH (LOW FREQUENCY SUPPORT ZONE) ----
    if (overlayEnabled(OVERLAYS.BANDWIDTH)) {

      // FLOOR = primary LF boundary
      const floorZone = new THREE.Mesh(
        new THREE.PlaneGeometry(
          room.width_m * 0.95,
          room.length_m * 0.95
        ),
        new THREE.MeshBasicMaterial({
          color: 0x7c3aed, // Measurely purple
          transparent: true,
          opacity: focusedOverlay === OVERLAYS.BANDWIDTH ? 0.55 : 0.08,
          depthWrite: false,
          side: THREE.DoubleSide
        })
      );

      floorZone.rotation.x = -Math.PI / 2;
      floorZone.position.y = -room.height_m / 2 + 0.02;
      roomGroup.add(floorZone);

      // LOWER WALL MASS (bass loading zone)
      const wallHeight = room.height_m * 0.35;

      const bassWalls = new THREE.Mesh(
        new THREE.BoxGeometry(
          room.width_m * 0.92,
          wallHeight,
          room.length_m * 0.92
        ),
        new THREE.MeshBasicMaterial({
          color: 0x7c3aed,
          transparent: true,
          opacity: focusedOverlay === OVERLAYS.BANDWIDTH ? 0.35 : 0.06,
          depthWrite: false
        })
      );

      bassWalls.position.y =
        -room.height_m / 2 + wallHeight / 2;

      roomGroup.add(bassWalls);
    }

    // ---- BALANCE (LEFT / RIGHT SYMMETRY) ----
    if (overlayEnabled(OVERLAYS.BALANCE)) {

      const halfW = room.width_m / 2;
      const halfL = room.length_m / 2;

      // 1️⃣ Centre reference line (keep)
      const centreLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, -room.height_m / 2, -halfL),
          new THREE.Vector3(0, -room.height_m / 2,  halfL)
        ]),
        new THREE.LineBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: focusedOverlay === OVERLAYS.BALANCE ? 0.9 : 0.15
        })
      );
      roomGroup.add(centreLine);

      // 2️⃣ Speaker symmetry planes
      const planeMat = new THREE.MeshBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: focusedOverlay === OVERLAYS.BALANCE ? 0.45 : 0.05,
        side: THREE.DoubleSide,
        depthWrite: false
      });

      [-1, 1].forEach(side => {
        const plane = new THREE.Mesh(
          new THREE.PlaneGeometry(room.length_m * 0.9, room.height_m * 0.6),
          planeMat
        );

        plane.rotation.y = Math.PI / 2;
        plane.position.set(
          side * (room.spk_spacing_m / 2),
          -room.height_m / 2 + room.height_m * 0.3,
          0
        );

        roomGroup.add(plane);
      });

      // 3️⃣ Listener offset arrow
      const offset = room.listener_offset_m || 0;
      const isBad = Math.abs(offset) > 0.15;

      const arrowDir = new THREE.Vector3(
        Math.sign(offset || 1),
        0,
        0
      );

      const arrow = new THREE.ArrowHelper(
        arrowDir,
        new THREE.Vector3(0, -room.height_m / 2 + 0.05, -room.length_m * 0.15),
        Math.min(Math.abs(offset) * 2, 1.2),
        isBad ? 0xff3b3b : 0x22d3ee,
        0.25,
        0.15
      );

      arrow.line.material.transparent = true;
      arrow.line.material.opacity =
        focusedOverlay === OVERLAYS.BALANCE ? 0.95 : 0.15;


      roomGroup.add(arrow);
    }

    // ---- CLARITY (EARLY REFLECTION WINDOW) ----
    if (overlayEnabled(OVERLAYS.CLARITY)) {

      const speakerY = -room.height_m / 2 + room.tweeter_height_m;
      const listenerZ = -room.length_m / 2 + room.listener_front_m;

      const listenerPos = new THREE.Vector3(
        offsetX,
        speakerY,
        listenerZ
      );

      // 1️⃣ Direct sound beams
      [-1, 1].forEach(side => {

        const speakerPos = new THREE.Vector3(
          offsetX + side * room.spk_spacing_m / 2,
          speakerY,
          -room.length_m / 2 + room.spk_front_m
        );

        const beam = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([speakerPos, listenerPos]),
          new THREE.LineBasicMaterial({
            color: 0x22d3ee,
            transparent: true,
            opacity: focusedOverlay === OVERLAYS.CLARITY ? 0.95 : 0.15
          })
        );

        roomGroup.add(beam);
      });

      // 2️⃣ Clarity time window (listener bubble)
      const clarityRadius = 0.8; // visual proxy for ~20ms window

      const clarityBubble = new THREE.Mesh(
        new THREE.SphereGeometry(clarityRadius, 32, 32),
        new THREE.MeshBasicMaterial({
          color: 0x22d3ee,
          transparent: true,
          opacity: focusedOverlay === OVERLAYS.CLARITY ? 0.35 : 0.05,
          depthWrite: false
        })
      );

      clarityBubble.position.copy(listenerPos);
      roomGroup.add(clarityBubble);

      // 3️⃣ Early reflection example (side walls)
      const wallX = room.width_m / 2;

      [-1, 1].forEach(side => {

        const speakerPos = new THREE.Vector3(
          side * room.spk_spacing_m / 2,
          speakerY,
          -room.length_m / 2 + room.spk_front_m
        );

        const bounce = new THREE.Vector3(
          side * wallX,
          speakerY,
          0
        );

        const reflectionEnd = listenerPos.clone();

        const hitsBubble =
          bounce.distanceTo(listenerPos) < clarityRadius * 1.4;

        const reflection = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            speakerPos,
            bounce,
            reflectionEnd
          ]),
          new THREE.LineDashedMaterial({
            color: hitsBubble ? 0xff3b3b : 0x22d3ee,
            dashSize: 0.25,
            gapSize: 0.15,
            transparent: true,
            opacity: focusedOverlay === OVERLAYS.CLARITY ? 0.85 : 0.08

          })
        );

        reflection.computeLineDistances();
        roomGroup.add(reflection);
      });
    }

  }

  /* ------------------------------------------
     START
  ------------------------------------------ */
  console.log("[Room3D] 🚀 Starting engine");
  rebuild();
  animate();

  /* ------------------------------------------
     PUBLIC API
  ------------------------------------------ */
  return {
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
            // Materials: slightly higher angle to see floor furniture, same distance as home
            materials:   { pos: { x: 3.5, y: 6.0, z: 5.5 }, look: { x: 0, y: 0, z: 0 } }
          };

          const v = views[stepKey];
          if (!v) return;

          // Update camera and orbit controls target
          camera.position.set(v.pos.x, v.pos.y, v.pos.z);
          controls.target.set(v.look.x, v.look.y, v.look.z);
          controls.update();
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

    getFocus() {
      return { id: focusedOverlay, score: activeScore, std: smoothnessStd };
    },

    startAutoSpin() {
      controls.autoRotate = true;
    },

    stopAutoSpin() {
      controls.autoRotate = false;
    },

    flyby(onDone) {
      const room = getRoomData();
      if (!room) { onDone?.(); return; }

      const W = room.width_m  / 2;
      const L = room.length_m / 2;
      const H = room.height_m / 2;

      // Cinematic waypoints: each segment interpolates from the previous position
      // to this one over `ms` milliseconds, with ease-in-out-quad.
      const waypoints = [
        // 0 – start: capture current state (filled in below)
        null,
        // 1 – pull up for a god's-eye overview
        { pos: { x:  W * 0.3, y: H * 5.5, z:  L * 0.5  }, look: { x: 0,        y: 0,         z: 0       }, ms: 1700 },
        // 2 – swoop in from the listener side, medium height
        { pos: { x:  W * 1.4, y: H * 1.4, z:  L * 2.2  }, look: { x: 0,        y: 0,         z: -L * 0.3}, ms: 1500 },
        // 3 – dive low, heading toward the speaker wall
        { pos: { x:  W * 0.2, y: -H * 0.2, z:  L * 0.2 }, look: { x: -W * 0.5, y: -H * 0.4, z: -L      }, ms: 1400 },
        // 4 – close on left speaker
        { pos: { x: -W * 1.6, y:  H * 0.2, z: -L * 0.6 }, look: { x: -W * 0.6, y: -H * 0.4, z: -L      }, ms: 1400 },
        // 5 – sweep back along the left wall (shows side panels)
        { pos: { x: -W * 1.8, y:  H * 1.2, z:  L * 1.0 }, look: { x: 0,        y: 0,         z: 0       }, ms: 1500 },
        // 6 – return home
        { pos: DEFAULT_CAMERA.pos, look: DEFAULT_CAMERA.target, ms: 1700 },
      ];

      // Snapshot current camera state as waypoint 0
      waypoints[0] = {
        pos:  { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        look: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
        ms: 0,
      };

      // Build cumulative timestamps for each transition
      let cum = 0;
      const tStamps = waypoints.map(wp => { const s = cum; cum += wp.ms; return s; });
      const totalMs = cum;

      controls.enabled = false;
      const t0 = performance.now();

      flyAnim = {
        tick(now) {
          const elapsed = now - t0;

          if (elapsed >= totalMs) {
            camera.position.set(DEFAULT_CAMERA.pos.x, DEFAULT_CAMERA.pos.y, DEFAULT_CAMERA.pos.z);
            controls.target.set(DEFAULT_CAMERA.target.x, DEFAULT_CAMERA.target.y, DEFAULT_CAMERA.target.z);
            controls.update();
            flyAnim = null;
            controls.enabled = true;
            onDone?.();
            return;
          }

          // Find active segment
          let si = waypoints.length - 2;
          for (let i = 0; i < waypoints.length - 1; i++) {
            if (elapsed >= tStamps[i] && elapsed < tStamps[i + 1]) { si = i; break; }
          }

          const segDur = waypoints[si + 1].ms;
          const raw    = (elapsed - tStamps[si]) / segDur;
          // Ease-in-out quadratic
          const t = raw < 0.5 ? 2 * raw * raw : -1 + (4 - 2 * raw) * raw;

          const a = waypoints[si];
          const b = waypoints[si + 1];

          camera.position.set(
            a.pos.x  + (b.pos.x  - a.pos.x)  * t,
            a.pos.y  + (b.pos.y  - a.pos.y)  * t,
            a.pos.z  + (b.pos.z  - a.pos.z)  * t,
          );
          controls.target.set(
            a.look.x + (b.look.x - a.look.x) * t,
            a.look.y + (b.look.y - a.look.y) * t,
            a.look.z + (b.look.z - a.look.z) * t,
          );
        },
      };
    },
    update: () => { rebuild(); }, 
  }; 
}   