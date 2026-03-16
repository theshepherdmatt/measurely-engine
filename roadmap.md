# Measurely — UX Roadmap: 3D Room Improvements

> Generated: 2026-03-16 | Design principle: **Clarity over Realism**

---

## Core Design Principle

> **Clarity over Realism**: The 3D room is not an architectural renderer. It is an acoustic communication tool. Every visual element earns its place by making an acoustic concept clearer. Realism that adds visual weight without communicating meaning should be removed or deferred.

This principle governs every item in this roadmap. If a proposed change looks impressive but doesn't help the user understand *what their room is doing to their sound*, it doesn't ship.

---

## Current State Assessment

### What's working well
- Wireframe-only aesthetic is coherent and intentional — avoids competing with acoustic overlays
- Auto-toe-in gives instant feedback when speakers are dragged
- Progressive stage reveal (`room → speakers → furnishings → treatment`) prevents cognitive overload
- Device adaptation (fat mesh tubes on mobile) is sound — wireframe legibility is preserved at all DPRs
- Overlay system is cleanly separated from geometry rebuild

### Clarity problems identified

| # | Problem | Impact |
|---|---|---|
| P1 | No labels — user cannot tell which surface is the front wall vs rear wall at a glance | High |
| P2 | Overlays are undiscoverable — there is no in-scene affordance that an overlay is active or what it means | High |
| P3 | SBIR overlay renders an arc, but gives no numeric feedback in-scene — the connection to Hz value is broken | High |
| P4 | `analysing` mode pulse animation gives no directional information — it pulses uniformly, not pointing to the problem area | Medium |
| P5 | Furniture (sofa, rug, coffee table) appears at the same opacity as the room shell — hierarchy is flat | Medium |
| P6 | The `smoothness` overlay (particle scatter) reads as visual noise, not as spatial data | Medium |
| P7 | No camera reset control — once the user orbits away from the default view, recovery requires page reload | Medium |
| P8 | `focusedOverlay` dims everything to 12% (`DIM_FACTOR = 0.12`) — this is so aggressive that the room outline disappears on some displays | Low |
| P9 | The 3D canvas on `index.html` auto-spins behind a launch overlay — the motion is decorative, not communicative | Low |
| P10 | No mobile touch affordance — users on phones don't know they can orbit | Low |

---

## Roadmap Items

---

### R1 — Wall Labels (Clarity: Critical)

**Problem**: P1 — walls are visually identical; front/rear/left/right are ambiguous.

**Solution**: Render floating text sprites at the midpoint of each wall edge.

| Label | Position | Content |
|---|---|---|
| Front wall | midpoint of front bottom edge | "Front wall" |
| Rear wall | midpoint of rear bottom edge | "Rear wall" |
| Left / Right | midpoint of side bottom edges | "L" / "R" |

**Constraints**:
- Use `THREE.Sprite` with a `CanvasTexture` — no HTML overlay (breaks when canvas scrolls)
- 12 px, `--text-muted` colour (#9ca3af), opacity 0.55
- Must not render when `focusedOverlay` is active (they clutter the focused view)
- Labels must billboard (always face camera) — Sprites do this natively in Three.js

**Clarity rule applied**: Labels communicate orientation directly. Without them, the SBIR overlay ("your speaker is X metres from the front wall") has no spatial anchor.

---

### R2 — Overlay Tooltip Anchors (Clarity: Critical)

**Problem**: P2 — overlays are invisible to new users; no in-scene affordance.

**Solution**: When an overlay is activated, render a small coloured dot + a short label at the point of acoustic significance.

| Overlay | Anchor point | Label text |
|---|---|---|
| `sbir` | midpoint of speaker-to-wall arc | "SBIR null: {n} Hz" |
| `side_reflections` | reflection point on side wall | "1st reflection" |
| `floor_reflection` | floor bounce point | "Floor bounce" |
| `rear_energy` | rear wall hit point | "Rear boundary" |
| `bandwidth` | centre of modal plane | "Modal region < {n} Hz" |

**Constraints**:
- One label per overlay, not per reflection ray — avoid label clutter
- Labels hide when camera angle puts them behind geometry
- Fade in over 300 ms using `opacity` lerp in the animation loop

**Clarity rule applied**: The number (Hz, ms, dB) is the insight. The geometry is just a pointer to where in the room that number lives.

---

### R3 — SBIR Arc → Numeric Badge (Clarity: High)

**Problem**: P3 — the SBIR arc is visually present but the Hz value only appears in the sidebar card. The 3D view and the data card feel disconnected.

**Solution**: Render a badge on the SBIR arc geometry showing the first null frequency.

```
[ 68 Hz ]   ← floating above the arc midpoint
```

**Implementation**:
- `CanvasTexture` badge on a `PlaneGeometry` billboard
- Updates when `pushRoom()` changes speaker distance
- Badge colour follows the score: green (> 80 Hz) → amber (50–80 Hz) → red (< 50 Hz)

**Clarity rule applied**: The user's job is "move the speaker until the number improves." The number must live where the visual feedback lives, not one scroll away.

---

### R4 — Hierarchy Opacity Tiers (Clarity: Medium)

**Problem**: P5 — room shell, speakers, and furniture render at similar opacity. The acoustic elements (speakers, listener) should read first; furniture should recede.

**Proposed opacity ladder**:

| Element | Current opacity | Proposed opacity |
|---|---|---|
| Room shell wireframe | 0.50 | 0.65 |
| Speakers | 0.55 | 0.80 |
| Listener sphere | 0.60 | 0.90 |
| Acoustic treatment panels | 0.35 | 0.55 |
| Furniture (sofa, rug, table) | 0.25 | 0.18 |
| Floor grid | 0.85 | 0.40 |

**Clarity rule applied**: Visual weight should map to acoustic importance. Furniture is context, not signal.

---

### R5 — Camera Reset Button (Clarity: Medium)

**Problem**: P7 — no recovery from an orbited-away view.

**Solution**: Floating button inside the canvas container, bottom-right corner.

```html
<button class="room3d-reset-cam" aria-label="Reset camera view">
  <!-- home icon SVG -->
</button>
```

**Implementation**:
- Calls `api.resetCamera()` which lerps `camera.position` and `controls.target` back to `DEFAULT_CAMERA` values over 600 ms
- Uses same fly animation system as `cinematicEngine.js`
- Button is always visible (not just on hover) on touch devices

**Clarity rule applied**: The default view is the most informative view. Users should always be able to return to it without a reload.

---

### R6 — Focused-Overlay Dim Floor (Clarity: Low→Medium)

**Problem**: P8 — `DIM_FACTOR = 0.12` makes the room outline invisible. The user loses spatial context for the very overlay they're examining.

**Solution**: Two-tier dimming.

| Element | Dim factor when overlay focused |
|---|---|
| Room shell wireframe | 0.35 (was 0.12) — context must stay legible |
| Furniture | 0.05 (was 0.12) — furniture is irrelevant during overlay focus |
| Grid | 0.08 (was 0.12) |
| Focused overlay elements | 1.0 — no dimming |

**Clarity rule applied**: Context geometry (room shell) helps the user understand *where* the focused acoustic phenomenon occurs. Killing it defeats the purpose of the overlay.

---

### R7 — Smoothness Overlay Redesign (Clarity: Medium)

**Problem**: P6 — particle scatter is visually noisy and doesn't communicate comb filtering spatially.

**Proposed alternative**: Replace particles with frequency-band-coloured line segments radiating from the listener position.

- Each line segment represents a frequency band with high roughness
- Length encodes roughness magnitude (longer = rougher)
- Colour encodes frequency range: bass (purple) → mid (cyan) → treble (white)
- Lines point toward the wall contributing the most to that band's roughness (derived from reflection timing)

**Clarity rule applied**: Roughness is directional — it comes from specific reflections. The visual should show direction, not just "there is roughness."

---

### R8 — Analysing Mode: Directed Pulse (Clarity: Medium)

**Problem**: P4 — the `analysing` mode colour pulse is uniform. It gives no spatial information.

**Proposed change**: During analysis, pulse the geometry of the room *surface* most likely to be causing the highest-scoring acoustic problem.

Logic:
1. If SBIR score is lowest → pulse front wall
2. If reflections score is lowest → pulse side walls
3. If bandwidth score is lowest → pulse floor + ceiling (modal region)
4. Default → pulse full shell (current behaviour)

The pulse is a simple `emissiveIntensity` sine wave (0.2 → 0.8) on the relevant wall mesh.

**Constraint**: This requires splitting the room shell into per-face meshes (currently it's a single `LineSegments` object). Only needed for the `analysing` mode — the setup mode can keep the single-object shell.

**Clarity rule applied**: The animation should answer "where should I look?" not just "something is happening."

---

### R9 — Touch Orbit Hint (Clarity: Low)

**Problem**: P10 — no mobile affordance.

**Solution**: On first render on a touch device, show a 2-second animated gesture hint overlay ("drag to orbit") that auto-dismisses.

- Render as an HTML overlay (not Three.js) for accessibility
- Store dismissal in `localStorage` so it only shows once
- Same "fade + pointer-events: none" pattern used by `sbox-launch-overlay`

---

### R10 — Landing Page Preview: Replace Auto-Spin with Acoustic Moment (Clarity: Low)

**Problem**: P9 — the `index.html` preview auto-spins forever behind a launch overlay. The spin is pure decoration.

**Proposed alternative**: Instead of spinning, show a **frozen key frame** at the default camera angle with the SBIR overlay active and the badge visible. The room does not move. The badge shows a sample Hz value.

This communicates *what the tool does* (shows acoustic data in 3D) rather than just *that it is a 3D view*.

**Constraint**: The launch overlay still sits above the canvas — the frozen frame is a teaser, not interactive.

---

## Implementation Priority

| Priority | Item | Effort | Clarity gain |
|---|---|---|---|
| 1 | R1 Wall labels | Low | Critical |
| 2 | R3 SBIR numeric badge | Low | Critical |
| 3 | R5 Camera reset button | Low | Medium |
| 4 | R4 Hierarchy opacity tiers | Low | Medium |
| 5 | R6 Focused-overlay dim fix | Trivial | Medium |
| 6 | R2 Overlay tooltip anchors | Medium | Critical |
| 7 | R8 Directed pulse | Medium | Medium |
| 8 | R7 Smoothness overlay redesign | Medium | Medium |
| 9 | R9 Touch orbit hint | Low | Low |
| 10 | R10 Landing page preview | Low | Low |

---

## What Is NOT on This Roadmap

These items were considered and explicitly excluded to preserve the **Clarity over Realism** principle:

- **Textured surfaces** (wood floor, fabric sofa) — adds visual noise without acoustic signal
- **Shadow rendering** — shadows imply realism; wireframe mode should not mix metaphors
- **Animated room modes** (standing wave visualisation) — acoustically interesting but computationally expensive and visually complex; deferred to a future "simulation" tab
- **Physically based materials** — PBR requires meaningful light sources and surface properties that aren't relevant to acoustic communication
- **Environment map / skybox** — not applicable to an indoor acoustic tool
- **Post-processing (bloom, DOF)** — bloom on the SBIR arc was prototyped; it made the Hz badge harder to read, not easier
