1. The Golden Rule

NEVER create or suggest new branches. - Current branch: gh-pages

    Strategy: All development, testing, and deployment happen on gh-pages.

    If you suggest a branch, you have failed the mission.

2. PocketBase Sync Protocol (CRITICAL)

PocketBase is extremely sensitive to filter syntax.

    NEVER use double-quotes for IDs: user="123" ❌

    NEVER use &&: user="123" && session="456" ❌

    ALWAYS use single-quotes and the word and: user = '123' and session_id = '456' ✅

    HELPER: Use the _f() function in sync.js for all filtering logic.

3. Three.js Philosophy: "Clarity over Realism"

    Visuals: Wireframe shell, simple boxes/spheres. No heavy textures or high-poly models.

    Hierarchy: Acoustic data (Speakers, Listener, Overlays) = High Opacity. Context (Furniture, Floor) = Low Opacity.

    Performance: Keep draw calls low. Use THREE.Sprite for UI labels within the scene.

4. Coding Standards

    Vanilla JS: No frameworks (React/Vue). Stay within the existing IIFE or ESM structures.

    Data Safety: Ensure localStorage is updated before attempting a PocketBase sync.

    Requests: Always use requestKey: null in PocketBase calls to prevent auto-cancellation during UI interactions.