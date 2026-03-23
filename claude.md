1. The Golden Rule

NEVER create or suggest new branches. - Current branch: gh-pages

    Strategy: All development, testing, and deployment happen on gh-pages.

    If you suggest a branch, you have failed the mission.

2. window._pb() is a FUNCTION — not an object (CRITICAL)

`window._pb` is a lazy getter function that returns the PocketBase SDK instance.

    ALWAYS call it: const pb = window._pb();

    NEVER use it directly: window._pb.collection(...) ❌  — throws "collection is not a function"

3. PocketBase Sync Protocol (CRITICAL)

PocketBase is extremely sensitive to filter syntax.

    NEVER use double-quotes for IDs: user="123" ❌

    NEVER use &&: user="123" && session="456" ❌

    ALWAYS use single-quotes and the word and: user = '123' and session_id = '456' ✅

    HELPER: Use the _f() function in sync.js for all filtering logic.

    ALWAYS use { requestKey: null } on PocketBase calls to prevent auto-cancellation during modal interactions.

4. PocketBase Collections

| Collection      | Purpose                                          | Key API Rule                          |
|-----------------|--------------------------------------------------|---------------------------------------|
| rooms           | User room config                                 | owner = @request.auth.id              |
| sessions        | Measurement history (scores, analysis JSON)      | user = @request.auth.id               |
| users           | User profile (gear, genres, avatar)              | PocketBase native                     |
| devices         | Paired Measurely Remote Pi devices               | owner = @request.auth.id              |
| sweep_commands  | Web → Pi command queue (pending/running/done)    | device.owner = @request.auth.id       |
| sweep_results   | WAV file storage (wav_left, wav_right)           | command.device.owner = @request.auth.id |
| pairing_codes   | One-time 6-digit pairing codes                   | owner = @request.auth.id              |

5. Measurely Remote Integration

The Remote modal in profile.js connects the web app to the Pi device:
- Fetches the user's `devices` record from PocketBase
- Shows device status, mic_connected, dac_connected
- Run Sweep → creates a `sweep_commands` record → polls for completion
- Load to Dashboard → fetches `sweep_results.wav_left` from PocketBase → runs through the full analysis pipeline → updates dashboard

6. Three.js Philosophy: "Clarity over Realism"

    Visuals: Wireframe shell, simple boxes/spheres. No heavy textures or high-poly models.

    Hierarchy: Acoustic data (Speakers, Listener, Overlays) = High Opacity. Context (Furniture, Floor) = Low Opacity.

    Performance: Keep draw calls low. Use THREE.Sprite for UI labels within the scene.

7. Coding Standards

    Vanilla JS: No frameworks (React/Vue). Stay within the existing IIFE or ESM structures.

    Data Safety: Ensure localStorage is updated before attempting a PocketBase sync.

    Requests: Always use requestKey: null in PocketBase calls to prevent auto-cancellation during UI interactions.
