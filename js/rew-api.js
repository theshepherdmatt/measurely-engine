/* ============================================================
   rew-api.js — REW 5.40 Local HTTP API Integration
   Measurely Web · github.com/measurely

   Connects to REW running on localhost:4735.
   - Probes for REW on load; shows #rewSyncBtn only if found.
   - On click: blocks REW, fires a 512k SPL sweep, pulls the
     impulse response, runs the full Measurely analysis pipeline,
     saves the session, and refreshes the dashboard.

   Dependencies (must load before this script):
     js/engine/fft.js
     js/engine/fileLoader.js  → window.MeasurelyFileLoader
     js/engine/analyse.js     → window.MeasurelyAnalyse
   ============================================================ */

(function () {
    'use strict';

    const REW_API = 'http://localhost:4735';

    // ── 1. Probe: is REW running and accessible? ──────────────────────────────
    // Uses /application/commands — confirmed working in live testing.
    // Times out after 2 s so the UI doesn't hang on dashboard load.
    async function pingREW() {
        try {
            const res = await fetch(`${REW_API}/application/commands`, {
                method: 'GET',
                signal: AbortSignal.timeout(2000),
            });
            return res.ok;
        } catch (_) {
            return false;
        }
    }

    // ── 2. Trigger a sweep ────────────────────────────────────────────────────
    // Three calls must happen in order:
    //   a) Set blocking mode — the sweep POST will hang until the sweep ends.
    //   b) Configure sweep parameters.
    //   c) Fire the sweep (this await resolves only when REW is done).
    async function runRewSweep() {
        // a) Blocking mode ON
        await fetch(`${REW_API}/application/blocking`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: 'true',
        });

        // b) Sweep config: 20–20 kHz, 512k length, dither fill
        await fetch(`${REW_API}/measure/sweep/configuration`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                startFreq: 20,
                endFreq: 20000,
                length: '512k',
                fillSilenceWithDither: true,
            }),
        });

        // c) Fire sweep — hangs until REW finishes measuring
        await fetch(`${REW_API}/measure/command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: 'SPL' }),
        });
    }

    // ── 3. Fetch IR from the latest measurement ───────────────────────────────
    // GET /measurements returns an object keyed by numeric index: { "1": {...} }
    // NOT an array — Object.keys().pop() gets the last (latest) index.
    //
    // The IR is returned as a Base64-encoded big-endian IEEE 754 float32 array.
    // We decode it manually via DataView with littleEndian=false.
    // Confirmed in live testing: big-endian gives sensible values (-1..+1),
    // little-endian produces garbage (~4.6e-41).
    //
    // We omit unit=dBFS — that returns log-domain values clamped to -1.0 for
    // silence, which is wrong for Measurely's linear FFT pipeline.
    async function fetchLatestIR() {
        // Get measurement list
        const listRes = await fetch(`${REW_API}/measurements`);
        if (!listRes.ok) throw new Error(`REW /measurements returned ${listRes.status}`);
        const list = await listRes.json();

        const keys = Object.keys(list);
        if (!keys.length) throw new Error('No measurements found in REW. Run a sweep first.');
        const latestId = keys[keys.length - 1];

        // Fetch linear normalised IR
        const irRes = await fetch(
            `${REW_API}/measurements/${latestId}/impulse-response?normalised=true`
        );
        if (!irRes.ok) throw new Error(`REW IR endpoint returned ${irRes.status}`);
        const irData = await irRes.json();

        if (!irData.data) throw new Error('REW returned an IR response with no data field.');

        // Decode Base64 → big-endian Float32Array
        const binary = atob(irData.data);
        const bytes  = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const view      = new DataView(bytes.buffer);
        const ir        = new Float32Array(bytes.length / 4);
        for (let i = 0; i < ir.length; i++) {
            ir[i] = view.getFloat32(i * 4, false); // false = big-endian
        }

        const fs    = irData.sampleRate || 48000;
        const label = list[latestId]?.title
            ? `REW: ${list[latestId].title}`
            : `REW Auto-sync ${new Date().toLocaleTimeString()}`;

        return { ir, fs, label };
    }

    // ── 4. Full pipeline: sweep → IR → analyse → save → dashboard ────────────
    async function rewAutoSync() {
        const btn       = document.getElementById('rewSyncBtn');
        const strongEl  = btn?.querySelector('strong');
        const spanEl    = btn?.querySelector('span');

        function setLabel(strong, span) {
            if (strongEl) strongEl.textContent = strong;
            if (spanEl)   spanEl.textContent   = span;
        }

        if (btn) btn.disabled = true;

        try {
            if (window.toast) window.toast('REW sweep started — measuring your room…', 'info');

            // Stage 1 — sweep
            setLabel('Sweeping…', 'Please wait — REW is measuring');
            await runRewSweep();

            // Stage 2 — fetch IR
            setLabel('Fetching data…', 'Downloading impulse response');
            const { ir, fs, label } = await fetchLatestIR();

            // Stage 3 — FFT → freq/mag
            setLabel('Analysing…', 'Computing frequency response');
            if (!window.MeasurelyFileLoader?.irToFreqMag) {
                throw new Error('MeasurelyFileLoader not loaded — check script order.');
            }
            const { freq, mag } = window.MeasurelyFileLoader.irToFreqMag(ir, fs);

            // Stage 4 — full acoustic analysis (same call as WAV upload modal)
            if (!window.MeasurelyAnalyse?.analyse) {
                throw new Error('MeasurelyAnalyse not loaded — check script order.');
            }
            const room   = JSON.parse(localStorage.getItem('measurely_room') || '{}');
            const result = window.MeasurelyAnalyse.analyse(ir, fs, freq, mag, room);

            // Stage 5 — build session object (mirrors upload modal shape exactly)
            const sessionId = 'upload_rew_' + Date.now();
            const ai        = result.ai || {};
            const aiScores  = ai.scores || {};

            // Acoustic Scientist metadata (same as upload modal)
            const durSec    = ir.length / fs;
            const L         = +(room.length_m        || 4.5);
            const W         = +(room.width_m         || 3.2);
            const H         = +(room.height_m        || 2.5);
            const spkFront  = +(room.spk_front_m ?? room.speaker_front_m ?? 0.6);

            const sessionObj = {
                id:          sessionId,
                label,
                timestamp:   new Date().toISOString(),
                ai:          result.ai,
                analysis:    result.analysis,
                reportCurve: result.reportCurve,
                room_modes:     {
                    l: Math.round(170 / L),
                    w: Math.round(170 / W),
                    h: Math.round(170 / H),
                },
                schroeder_freq: Math.min(999, Math.round(2000 * Math.sqrt(0.16 / Math.max(durSec, 0.05)))),
                sbir_null:      Math.round(340 / (4 * Math.max(spkFront, 0.1))),
                scores: {
                    overall:     +(aiScores.overall     ?? 0),
                    peaks_dips:  +(aiScores.peaks_dips  ?? 0),
                    reflections: +(aiScores.reflections ?? 0),
                    bandwidth:   +(aiScores.bandwidth   ?? 0),
                    balance:     +(aiScores.balance     ?? 0),
                    smoothness:  +(aiScores.smoothness  ?? 0),
                    clarity:     +(aiScores.clarity     ?? 0),
                },
            };

            // Stage 6 — persist (mirrors upload modal)
            setLabel('Saving…', 'Writing session to store');
            if (window.MeasurelySessions) {
                window.MeasurelySessions.saveSession(sessionObj);
            } else {
                const history = JSON.parse(localStorage.getItem('measurely_sessions') || '[]');
                history.unshift({
                    id: sessionId, label,
                    timestamp: sessionObj.timestamp,
                    analysis: result.ai, reportCurve: result.reportCurve,
                });
                localStorage.setItem('measurely_sessions', JSON.stringify(history.slice(0, 20)));
            }
            window.MeasurelySync?.pushSession?.(sessionObj);

            // Stage 7 — refresh dashboard
            if (window.dashboard?.loadLatestAnalysis) window.dashboard.loadLatestAnalysis(result.ai);
            if (window.dashboard?.loadHistory)        window.dashboard.loadHistory();

            if (window.toast) window.toast('REW sync complete!', 'success');

        } catch (err) {
            console.error('[rew-api]', err);
            if (window.toast) {
                window.toast('REW sync failed: ' + (err.message || err), 'error');
            }
        } finally {
            if (btn) btn.disabled = false;
            setLabel('Sync from REW', '1-click sweep & analysis');
        }
    }

    // ── 5. Init: probe REW, wire button ──────────────────────────────────────
    async function initRewButton() {
        const btn = document.getElementById('rewSyncBtn');
        if (!btn) return;

        const available = await pingREW();
        if (available) {
            btn.style.display = '';
            btn.addEventListener('click', rewAutoSync);
        }
        // If REW is not running the button simply stays hidden — no console noise.
    }

    // Public API (useful for console debugging)
    window.MeasurelyREW = { ping: pingREW, sync: rewAutoSync };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initRewButton);
    } else {
        initRewButton();
    }

}());
