/**
 * Measurely Cinematic Engine (GSAP Powered)
 * Smoothly morphs room properties to show the 'Aha!' moment.
 */

export const CinematicEngine = {
    run: async function(api, state) {
        console.log("🎬 Starting Smooth Transformation...");

        // ACT 1: Morph the Structural Geometry (The Roof)
        // We lift the ceiling height smoothly over 2 seconds
        gsap.to(state, {
            height_m: 3.5, 
            duration: 2,
            ease: "power2.inOut",
            onUpdate: () => api.update() // Force Three.js to redraw every frame
        });
        await this.sleep(2500);

        // ACT 2: Reveal the Problem (Middle Room Null)
        api.setOverlay("bandwidth", true);
        api.focusIssue("smoothness", 2.0, 10.0); // 2.0 = Turbulent/Red ripples
        console.log("⚠️ Visualizing Middle-Room Bass Null");
        await this.sleep(3500);

        // ACT 3: The Correction (Smooth Slide & Toe-in)
        // Slide couch to back wall, adjust toe-in, and swap speaker type
        gsap.to(state, {
            listener_front_m: 5.2, // Slide all the way back
            toe_in_deg: 18,
            duration: 4,
            ease: "expo.inOut",
            onStart: () => api.highlight("listener"),
            onUpdate: () => {
                // Mid-slide, we swap to Floorstanders
                if (state.listener_front_m > 4.2) state.speaker_type = "floorstander";
                api.update();
            },
            onComplete: () => api.highlight(null)
        });

        // Gradually "Calm" the acoustic field as the listener moves
        gsap.to({}, {
            duration: 4,
            onUpdate: function() {
                const progress = this.progress();
                const score = 2.0 + (7.5 * progress); // Move score 2.0 -> 9.5
                const std = 10.0 - (9.5 * progress);  // Reduce turbulence
                api.focusIssue("smoothness", score, std);
            }
        });
        await this.sleep(4500);

        // ACT 4: The Hero Shot
        api.togglePanelSimulation(true); // Bass traps appear
        api.flyby(() => {
            api.startAutoSpin();
            console.log("✅ Transformation Complete.");
        });
    },

    sleep: ms => new Promise(res => setTimeout(res, ms))
};