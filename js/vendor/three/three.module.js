/**
 * three.module.js — ESM bridge for Measurely
 *
 * WHY THIS FILE EXISTS
 * ──────────────────────────────────────────────────────────────────────────
 * three.min.js is a UMD bundle (Universal Module Definition). In a browser
 * with no CommonJS environment it falls through to the global assignment:
 *
 *   globalThis.THREE = { Scene, WebGLRenderer, … }
 *
 * That global is set by the <script src="three.min.js" defer> tag in the HTML
 * before any ES module in the page evaluates. This bridge file simply
 * re-exports that namespace as proper ESM so that:
 *
 *   import * as THREE from 'three';           // via importmap
 *   import THREE    from 'three';             // default import
 *
 * both work with zero additional downloads and zero changes to three.min.js.
 *
 * UPGRADE PATH
 * ──────────────────────────────────────────────────────────────────────────
 * When you're ready to switch to the true Three.js ESM build (which enables
 * tree-shaking with Vite/Rollup), replace this file with the official
 * three.module.js from https://github.com/mrdoob/three.js/releases and
 * delete the <script src="three.min.js"> tag from the HTML files. The import
 * map specifiers ("three") stay identical — no other source files change.
 *
 * TIMING GUARANTEE
 * ──────────────────────────────────────────────────────────────────────────
 * ES modules are always deferred. Classic <script defer> tags also defer.
 * The HTML parser flushes classic deferred scripts before module scripts that
 * appear later in document order. So three.min.js is guaranteed to have set
 * globalThis.THREE by the time this bridge is evaluated.
 */

const THREE = globalThis.THREE;

if (!THREE) {
    // This fires only if someone imports 'three' before three.min.js has run —
    // which is a mis-ordered HTML file, not a runtime error in normal use.
    throw new Error(
        '[Measurely] three.module.js: globalThis.THREE is not set. ' +
        'Ensure <script src="three.min.js" defer> appears before any ' +
        '<script type="module"> that imports "three".'
    );
}

// ── Default export (covers: import THREE from 'three') ───────────────────
export default THREE;

// ── Namespace export (covers: import * as THREE from 'three') ────────────
// Explicitly re-export every constructor and constant room3d.js uses.
// This also serves as a self-documenting list of our Three.js surface area.
export const {
    // Core
    Scene,
    Group,
    Object3D,

    // Camera
    PerspectiveCamera,
    OrthographicCamera,

    // Renderer
    WebGLRenderer,

    // Geometries
    BoxGeometry,
    PlaneGeometry,
    SphereGeometry,
    BufferGeometry,
    EdgesGeometry,
    ExtrudeGeometry,
    Shape,

    // Materials
    MeshBasicMaterial,
    MeshStandardMaterial,
    LineBasicMaterial,
    LineDashedMaterial,

    // Objects
    Mesh,
    Line,
    LineSegments,
    ArrowHelper,

    // Lights
    AmbientLight,
    PointLight,

    // Helpers
    GridHelper,

    // Math
    Vector2,
    Vector3,
    Plane,
    Raycaster,
    MathUtils,

    // Attributes
    BufferAttribute,

    // Constants
    DoubleSide,
    DynamicDrawUsage,
    MOUSE,
    TOUCH,

    // Events
    EventDispatcher,

    // Controls — added to THREE namespace by OrbitControls.js IIFE
    OrbitControls,
    MapControls,
} = THREE;
