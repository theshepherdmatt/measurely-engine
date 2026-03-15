/* ------------------------------------------------------------------
   LAZY PLOTLY LOADER
   Plotly (3.5 MB) is not in the HTML. Call loadPlotly() before
   any chart render — it's a no-op after the first successful load.
------------------------------------------------------------------ */
let _plotlyPromise = null;

function loadPlotly() {
  if (window.Plotly) return Promise.resolve();
  if (_plotlyPromise) return _plotlyPromise;

  _plotlyPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'js/plotly.min.js';
    script.onload  = () => resolve();
    script.onerror = () => {
      _plotlyPromise = null; // allow retry on next call
      reject(new Error('[Dashboard] Failed to load Plotly'));
    };
    document.head.appendChild(script);
  });

  return _plotlyPromise;
}

const UI = {
  historyCardSelector: ".uploads-card",
  historyIdDatasetKey: "uploadId",        // ALWAYS uploads
  historyScoreSelector: ".uploads-score", // ALWAYS uploads
  historyTimeSelector: ".uploads-time",
  navId: "uploadsNav"
};

/* Returns true when running on GitHub Pages / measurely.uk (no Pi backend).
   Used to skip /api/* calls that will 404, keeping the console clean. */
function isStaticHosting() {
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return false;
  if (/^192\.168\./.test(h) || /^10\./.test(h)) return false;
  if (h.endsWith('.local')) return false;
  return true; // public domain → static deploy, no Pi
}

async function safeJson(url) {
  if (isStaticHosting() && url.startsWith('/api/')) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

window.addLog = function (msg) {
    const logBox = document.getElementById("sweepLogPanel");
    if (!logBox) return;

    const line = document.createElement("div");
    line.textContent = msg;

    // subtle fade (optional)
    line.style.opacity = 0;
    line.style.transition = "opacity 0.3s";
    logBox.appendChild(line);
    requestAnimationFrame(() => line.style.opacity = 1);

    // auto-scroll
    logBox.scrollTop = logBox.scrollHeight;
};

/* ============================================================
   ROOM → ANALYSIS ADAPTER (GEOMETRY ONLY)
   ============================================================ */
function buildRoomGeometryAnalysis(room, room_context) {
    if (!room) return null;

    // 🔧 NORMALISE ROOM SHAPE (onboarding vs analysis)
    const r = {
        length_m: room.length_m ?? room.length ?? null,
        width_m:  room.width_m  ?? room.width  ?? null,
        height_m: room.height_m ?? room.height ?? null,

        spk_spacing_m:    room.spk_spacing_m    ?? room.speakerSpacing   ?? null,
        spk_front_m:      room.spk_front_m      ?? room.speakerDistance  ?? null,
        listener_front_m: room.listener_front_m ?? room.seatingDistance  ?? null,

        toe_in_deg: room.toe_in_deg ?? null,
        tweeter_height_m: room.tweeter_height_m ?? null,

        speaker_type: room.speaker_type ?? null,
        subwoofer: room.subwoofer ?? null,

        opt_area_rug: room.opt_area_rug ?? null,
        opt_sofa: room.opt_sofa ?? null,
        opt_coffee_table: room.opt_coffee_table ?? null,
        wall_treatment: room.wall_treatment ?? null
    };

    const {
        length_m,
        width_m,
        height_m,
        spk_spacing_m,
        listener_front_m,
        toe_in_deg,
        tweeter_height_m,
        speaker_type,
        subwoofer,
        opt_area_rug,
        opt_sofa,
        opt_coffee_table,
        wall_treatment
    } = r;

    const measuredSBIR = room_context?.sbir ?? null;

    const hasGeometry =
        typeof length_m === "number" &&
        typeof width_m === "number" &&
        typeof height_m === "number";

    const volume_m3 = hasGeometry
        ? length_m * width_m * height_m
        : null;

    const schroeder_hz = volume_m3
        ? 2000 * Math.sqrt(0.161 / volume_m3)
        : null;

    return {
        room_geometry: hasGeometry
            ? {
                dimensions: `${length_m.toFixed(2)} × ${width_m.toFixed(2)} × ${height_m.toFixed(2)} m`,
                volume_m3: volume_m3.toFixed(1),
                schroeder_hz: Math.round(schroeder_hz)
            }
            : null,

        listening_geometry: {
            speaker_spacing_m: spk_spacing_m?.toFixed?.(2) ?? null,
            listener_distance_m: listener_front_m?.toFixed?.(2) ?? null,
            tweeter_height_m: tweeter_height_m?.toFixed?.(2) ?? null,
            toe_in_deg: toe_in_deg?.toFixed?.(1) ?? null
        },

        sbir: measuredSBIR
            ? {
                distance_m: measuredSBIR.distance_m,
                first_null_hz: measuredSBIR.nulls_hz?.[0] ?? null,
                harmonics: measuredSBIR.nulls_hz
            }
            : null,

        context: {
            speaker_type,
            subwoofer,
            opt_area_rug,
            opt_sofa,
            opt_coffee_table,
            wall_treatment
        }
    };
}


function addSweepLogLine(msg) {
    const panel = document.getElementById("sweepLogPanel");
    if (!panel) {
        console.warn("[SweepLog] sweepLogPanel not found");
        return;
    }

    const line = document.createElement("div");
    line.textContent = msg;
    panel.appendChild(line);

    // Auto-scroll to bottom
    panel.scrollTop = panel.scrollHeight;

    console.log("[SweepLog] UI +", msg);
}


/* ============================================================
   RENDER: ROOM ANALYSIS CARDS
   ============================================================ */
function renderRoomAnalysisCards(analysis) {
    if (!analysis) return;

    // -------- Room Geometry --------
    const dim = document.getElementById("analysisRoomDimensions");
    const vol = document.getElementById("analysisRoomVolume");
    const sch = document.getElementById("analysisSchroeder");

    if (dim) dim.textContent = analysis.room_geometry.dimensions;
    if (vol) vol.textContent = `${analysis.room_geometry.volume_m3} m³`;
    if (sch) sch.textContent = `${analysis.room_geometry.schroeder_hz} Hz`;

    // -------- Listening Geometry --------
    const spk = document.getElementById("analysisSpeakerSpacing");
    const lst = document.getElementById("analysisListenerDistance");
    const toe = document.getElementById("analysisToeIn");
    const toeNote = document.getElementById("analysisToeComment");

    if (spk) spk.textContent = `${analysis.listening_geometry.speaker_spacing_m} m`;
    if (lst) lst.textContent = `${analysis.listening_geometry.listener_distance_m} m`;
    if (toe) toe.textContent = `${analysis.listening_geometry.toe_in_deg}°`;
    if (toeNote) toeNote.textContent = analysis.listening_geometry.toe_comment;

    // -------- Side-wall reflection --------
    const sideEl = document.getElementById("sideRefMs");
    if (sideEl) {
        sideEl.textContent =
            Number.isFinite(analysis.reflections?.side_wall_ms)
                ? analysis.reflections.side_wall_ms
                : "—";
    }

    // -------- SBIR (Measured) --------
    const sbirFreqEl   = document.getElementById("sbirFreq");
    const sbirDetailEl = document.getElementById("sbirDetail");

    if (analysis.sbir && sbirFreqEl && sbirDetailEl) {
        const d = analysis.sbir.distance_m;
        const f = analysis.sbir.first_null_hz;

        sbirFreqEl.textContent =
            Number.isFinite(f) ? Math.round(f) : "—";

        sbirDetailEl.innerHTML = `
            <p><strong>Measured condition:</strong> Your speakers are ${d.toFixed(2)} m from the front wall.</p>

            <p><strong>Acoustic maths:</strong>  
            A rear-radiated wave reflects off the wall and returns 180° out of phase when its path equals half a wavelength.</p>

            <p><code>f = 343 / (4 × ${d.toFixed(2)})</code></p>

            <p><strong>Result:</strong> This predicts a cancellation at <strong>${Math.round(f)} Hz</strong>, which matches the energy dip seen in your sweep.</p>

            <p><strong>What this means:</strong>  
            This isn’t a speaker fault — it’s boundary interference.  
            Moving the speakers closer raises this null; moving them further lowers it.</p>
        `;
    }

    // -------- Bandwidth (Room Geometry Contribution) --------
    const bwEl = document.getElementById("bandwidthRange");
    const schEl = document.getElementById("bandwidthSchroeder");

    if (analysis.room_geometry && bwEl) {
        bwEl.textContent =
            `Below ${analysis.room_geometry.schroeder_hz} Hz`;
    }

    if (analysis.room_geometry && schEl) {
        schEl.textContent =
            `${analysis.room_geometry.schroeder_hz} Hz`;
    }


}

function addSmoothnessOverlay(traces, freqs, mags, smoothMag) {
    traces.push({
        x: freqs,
        y: smoothMag,
        type: "scatter",
        mode: "lines",
        name: "Smoothed",
        line: { width: 2, dash: "dot", color: "#ffffff" },
        hoverinfo: "skip"
    });

    traces.push({
        x: freqs,
        y: mags.map(v => v + 3),
        type: "scatter",
        mode: "lines",
        line: { width: 0 },
        showlegend: false
    });

    traces.push({
        x: freqs,
        y: mags.map(v => v - 3),
        type: "scatter",
        mode: "lines",
        fill: "tonexty",
        fillcolor: "rgba(239,68,68,0.08)",
        line: { width: 0 },
        name: "Roughness Zone",
        hoverinfo: "skip"
    });
}

function addBalanceOverlay(traces, freqs, mags, label) {
    const lowVals = [], highVals = [];

    for (let i = 0; i < freqs.length; i++) {
        if (freqs[i] >= 20 && freqs[i] <= 200) lowVals.push(mags[i]);
        if (freqs[i] >= 2000 && freqs[i] <= 10000) highVals.push(mags[i]);
    }

    if (!lowVals.length || !highVals.length) return;

    const lowAvg = lowVals.reduce((a,b)=>a+b,0) / lowVals.length;
    const highAvg = highVals.reduce((a,b)=>a+b,0) / highVals.length;
    const tilt = highAvg - lowAvg;

    const tiltLine = freqs.map(f => {
        const ratio = Math.log10(f / 200) / Math.log10(10000 / 200);
        return lowAvg + (ratio * tilt);
    });

    traces.push({
        x: freqs,
        y: tiltLine,
        type: "scatter",
        mode: "lines",
        name: `${label} Tonal Tilt`,
        line: { dash: "dot", width: 2, color: "#fbbf24" },
        hoverinfo: "skip"
    });
}

function addPeaksDipsOverlay(traces, freqs, mags, label) {
    const peakX = [], peakY = [];
    const dipX = [], dipY = [];

    for (let k = 2; k < mags.length - 2; k++) {
        const prev = (mags[k - 2] + mags[k - 1]) / 2;
        const next = (mags[k + 1] + mags[k + 2]) / 2;
        const curr = mags[k];

        if (curr - prev > 0.6 && curr - next > 0.6) {
            peakX.push(freqs[k]);
            peakY.push(curr);
        }
        if (prev - curr > 0.6 && next - curr > 0.6) {
            dipX.push(freqs[k]);
            dipY.push(curr);
        }
    }

    traces.push(
        {
            x: peakX,
            y: peakY,
            type: "scatter",
            mode: "markers",
            name: `${label} Peaks`,
            marker: { size: 7, symbol: "triangle-up" }
        },
        {
            x: dipX,
            y: dipY,
            type: "scatter",
            mode: "markers",
            name: `${label} Dips`,
            marker: { size: 7, symbol: "triangle-down" }
        }
    );
}

function addReflectionsOverlay(traces, freqs, mags, label) {

    if (!freqs.length || !mags.length) return;

    const rippleX = [];
    const rippleY = [];

    // Detect rapid oscillations (comb filtering)
    for (let i = 2; i < mags.length - 2; i++) {

        const slope1 = mags[i] - mags[i - 1];
        const slope2 = mags[i + 1] - mags[i];

        // More sensitive ripple detection
        if (Math.abs(slope1) > 0.4 && Math.abs(slope2) > 0.4 && Math.sign(slope1) !== Math.sign(slope2)) {
            rippleX.push(freqs[i]);
            rippleY.push(mags[i]);
        }
    }

    console.log(`🪞 ${label} Reflection points:`, rippleX.length);

    if (!rippleX.length) return;

    traces.push({
        x: rippleX,
        y: rippleY,
        type: "scatter",
        mode: "markers",
        name: `${label} Reflection Ripple`,
        marker: {
            size: 5,
            color: "rgba(251,191,36,0.9)", // amber
            symbol: "circle-open",
            line: { width: 1.5 }
        },
        hoverinfo: "skip"
    });
}


function addClarityOverlay(traces, freqs) {

    const clarityLow = 2000;
    const clarityHigh = 5000;

    traces.push({
        x: [clarityLow, clarityHigh, clarityHigh, clarityLow],
        y: [-60, -60, 20, 20], // full vertical span
        type: "scatter",
        mode: "lines",
        fill: "toself",
        fillcolor: "rgba(34,197,94,0.08)",
        line: { width: 0 },
        name: "Clarity Region",
        hoverinfo: "skip"
    });
}

/**
 * Adds a target curve trace to the chart.
 * Studio → flat (0 dB relative to measured mean).
 * Hi-Fi  → Harman-style sloped curve (gentle bass shelf + HF roll-off).
 * @param {Array} traces - Plotly trace array to push into
 * @param {number[]} freqs
 * @param {number[]} mags
 * @param {string} roomType  - 'studio' | anything else = hi-fi
 */
function addTargetCurveTrace(traces, freqs, mags, roomType) {
    if (!freqs.length || !mags.length) return;

    // Anchor the target at the measured mean in the 200Hz-2kHz midrange band
    const midVals = mags.filter((_, i) => freqs[i] >= 200 && freqs[i] <= 2000);
    const midMean = midVals.length
        ? midVals.reduce((a, b) => a + b, 0) / midVals.length
        : 0;

    let targetY;
    if (roomType === 'studio') {
        // Flat reference line at the midrange mean
        targetY = freqs.map(() => midMean);
    } else {
        // Harman 2020 approximation:
        //  Bass shelf: +3 dB at 80 Hz, transitions between 80–400 Hz
        //  HF roll-off: -1 dB/octave above 2 kHz
        targetY = freqs.map(f => {
            let offset = 0;
            if (f < 80)  offset = 3.0;
            else if (f < 400) offset = 3.0 - (Math.log10(f / 80) / Math.log10(400 / 80)) * 3.0;
            if (f > 2000) offset -= Math.log2(f / 2000) * 1.0;
            return midMean + offset;
        });
    }

    traces.push({
        x: freqs,
        y: targetY,
        type: "scatter",
        mode: "lines",
        name: roomType === 'studio' ? "Target: Flat" : "Target: Harman",
        line: { dash: "dash", width: 2, color: roomType === 'studio' ? "#22c55e" : "#f97316" },
        hoverinfo: "skip"
    });
}

/**
 * Adds Plotly annotations for peaks & dips in the bass region (20–500 Hz).
 * Used by the Bandwidth card click.
 */
function addBassAnnotations(traces, freqs, mags, label) {
    const annotations = [];
    const bassFreqs = freqs.filter(f => f <= 500);
    const bassMags  = mags.slice(0, bassFreqs.length);

    for (let k = 2; k < bassMags.length - 2; k++) {
        const prev = (bassMags[k-2] + bassMags[k-1]) / 2;
        const next = (bassMags[k+1] + bassMags[k+2]) / 2;
        const curr = bassMags[k];
        const isPeak = curr - prev > 4 && curr - next > 4;
        const isDip  = prev - curr > 4 && next - curr > 4;
        if (!isPeak && !isDip) continue;

        annotations.push({
            x: bassFreqs[k], y: curr,
            xref: "x", yref: "y",
            text: isPeak ? `▲ ${Math.round(bassFreqs[k])} Hz` : `▼ ${Math.round(bassFreqs[k])} Hz`,
            showarrow: true,
            arrowhead: 2, arrowsize: 0.8,
            arrowcolor: isPeak ? "rgba(239,68,68,0.8)" : "rgba(59,130,246,0.8)",
            font: { size: 9, color: isPeak ? "#ef4444" : "#60a5fa" },
            bgcolor: "rgba(15,23,42,0.75)",
            ax: 0, ay: isPeak ? -28 : 28,
            borderpad: 2
        });
    }

    // Expose annotations on the chart via a custom layout patch stored on element
    const chartEl = document.getElementById("frequencyChart");
    if (chartEl) chartEl._bassAnnotations = annotations;
}


function updateRoomInsightText(metric, data) {
    console.log("🧠 updateRoomInsightText called with:", metric, data);
    console.log("🧪 RAW DATA OBJECT:", data);

    const el = document.getElementById("roomInsightText");
    if (!el) return;

    // If we don't recognise the metric, don't break anything — just clear.
    const supported = new Set([
        "sbir",
        "peaks_dips",
        "side_reflections",
        "bandwidth",
        "balance",
        "smoothness",
        "clarity"
    ]);

    if (!supported.has(metric)) {
        el.innerHTML = "";
        return;
    }

  // -----------------------------
  // SBIR (your existing logic)
  // -----------------------------
  if (metric === "sbir" || metric === "peaks_dips") {

    const sbir = data?.room_context?.sbir || data?.geom?.sbir || null;

    if (!sbir) {
      el.innerHTML = `
        <div class="insight-block">
          <h3>Peaks & Dips</h3>
          <p>Your speakers are at some distance from the wall behind them. That distance creates a bass cancellation — sound reflecting off the wall arrives back slightly out of phase with the direct sound, cutting a notch in the low end.</p>
          <p>Run a sweep with your room configured to see the exact frequency and depth of the cancellation.</p>
        </div>
      `;
      return;
    }

    const d = Number(sbir.distance_m);
    const f = Number(
      sbir.first_null_hz ??
      sbir.nulls_hz?.[0] ??
      (Number.isFinite(d) ? 343 / (4 * d) : null)
    );

    if (!Number.isFinite(d) || !Number.isFinite(f)) {
      el.innerHTML = `
        <div class="insight-block">
          <p>Speaker placement data is incomplete — check your room setup and run another sweep.</p>
        </div>
      `;
      return;
    }

    const score = Number(data?.scores?.peaks_dips);

    el.innerHTML = `
      <div class="insight-block">
        <h3>Peaks & Dips</h3>

        <p><b>What’s happening:</b><br>
        Sound bounces off the wall behind your speakers and returns to the listening position slightly out of phase with the direct sound. This cancels some bass energy, creating a notch in the frequency response.</p>

        <p><b>Speaker distance from wall:</b> ${d.toFixed(2)} m</p>

        <p class="math">
          Bass cancellation frequency:<br>
          <code>f = 343 / (4 × ${d.toFixed(2)}) = ${Math.round(f)} Hz</code>
        </p>

        <p>Moving speakers further from the wall pushes the dip lower in frequency. Closer to the wall raises it. Corner placement spreads the effect across multiple frequencies.</p>

        <p><b>Score:</b>
          <code>${Number.isFinite(score) ? score.toFixed(1) : "—"}/10</code>
        </p>
      </div>
    `;

    return;
  }


    // -----------------------------
    // SIDE REFLECTIONS
    // -----------------------------
    if (metric === "side_reflections") {

    const room = window.__MEASURELY_ROOM__;

    console.log("🔎 SIDE REFLECTION ROOM DATA:", room);

    if (!room) {
        el.innerHTML = `
        <div class="insight-block">
            <h3>Reflections</h3>
            <p>Complete your room setup so Measurely can calculate how your room dimensions affect early reflections at the listening position.</p>
            <p>Head to <b>Room Setup</b> and enter your dimensions, speaker placement, and listening position.</p>
        </div>
        `;
        return;
    }

    const c = 343;

    const spkSpacing = Number(room.spk_spacing_m);
    const spkFront   = Number(room.spk_front_m);
    const listener   = Number(room.listener_front_m);
    const width      = Number(room.width_m);

    if (![spkSpacing, spkFront, listener, width].every(Number.isFinite)) {
        el.innerHTML = `
        <div class="insight-block">
            <h3>Reflections</h3>
            <p>Some room dimensions are missing. Go to <b>Room Setup</b> and make sure your speaker spacing, speaker distance, listening position, and room width are all filled in.</p>
        </div>
        `;
        return;
    }

    const speakerX = spkSpacing / 2;
    const speakerZ = spkFront;
    const listenerX = 0;
    const listenerZ = listener;

    const direct = Math.hypot(listenerX - speakerX, listenerZ - speakerZ);

    const wallX = width / 2;
    const mirrorSpeakerX = wallX + (wallX - speakerX);

    const reflected = Math.hypot(listenerX - mirrorSpeakerX, listenerZ - speakerZ);

    const delta = reflected - direct;
    const delayMs = (delta / c) * 1000;

    const score = Number(data?.scores?.reflections);

    el.innerHTML = `
        <div class="insight-block">
            <h3>Reflections</h3>

            <p><b>What’s happening:</b><br>
            Sound reflects off the side walls and reaches you slightly after the direct sound.</p>

            <p class="math">
                Direct path: <code>${direct.toFixed(2)} m</code><br>
                Reflected path: <code>${reflected.toFixed(2)} m</code><br>
                Extra distance: <code>${delta.toFixed(2)} m</code><br>
                Delay: <code>${delayMs.toFixed(2)} ms</code>
            </p>

            <p>
                Reflections under ~5 ms are most likely to blur stereo focus.
            </p>

            <p><b>Reflections score:</b>
                <code>${Number.isFinite(score) ? score.toFixed(1) : "—"}/10</code>
            </p>

            <button id="simulatePanelsBtn" class="btn btn-utility">
                Simulate Acoustic Panels
            </button>
        </div>
    `;

    const btn = document.getElementById("simulatePanelsBtn");

    if (btn && window.room3D) {
        let active = false;

        btn.addEventListener("click", () => {
            active = !active;

            if (window.room3D.togglePanelSimulation) {
                window.room3D.togglePanelSimulation(active);
            }

            btn.textContent = active
                ? "Remove Acoustic Panels"
                : "Simulate Acoustic Panels";
        });
    }

    return;
    }

    // -----------------------------
    // BANDWIDTH (room LF support)
    // -----------------------------
    if (metric === "bandwidth") {

        console.log("🔥 BANDWIDTH BLOCK ENTERED");

        const room = window.__MEASURELY_ROOM__;
        console.log("🔎 ROOM FOR BANDWIDTH:", room);

        if (!room) {
            el.innerHTML = `
            <div class="insight-block">
                <h3>Bandwidth</h3>
                <p>Complete your room setup so Measurely can calculate the lowest frequency your room can support before bass becomes uneven.</p>
                <p>Head to <b>Room Setup</b> and enter your room dimensions.</p>
            </div>
            `;
            return;
        }

        const L = Number(room.length_m);
        const W = Number(room.width_m);
        const H = Number(room.height_m);

        if (![L, W, H].every(Number.isFinite)) {
            el.innerHTML = `
            <div class="insight-block">
                <h3>Bandwidth</h3>
                <p>Room length, width, or height is missing. Go to <b>Room Setup</b> and fill in all three dimensions.</p>
            </div>
            `;
            return;
        }

        const c = 343;
        const longest = Math.max(L, W, H);
        const fLowest = c / (2 * longest);

        const score = Number(data?.scores?.bandwidth);

        el.innerHTML = `
            <div class="insight-block">
            <h3>Bandwidth</h3>

            <p><b>What’s happening:</b><br>
            Your room size sets the lowest frequency the space can naturally support before strong modal behaviour dominates.</p>

            <p class="math">
                Largest dimension: <code>${longest.toFixed(2)} m</code><br>
                Lowest axial mode: <code>f = c / (2L) = ${Math.round(fLowest)} Hz</code>
            </p>

            <p>
                Below this frequency, bass becomes increasingly uneven because full wavelengths cannot properly develop inside the room.
            </p>
            <p><b>Bandwidth score:</b> <code>${Number.isFinite(score) ? score.toFixed(1) : "—"}/10</code></p>
            </div>
        `;
        return;
    }

    // -----------------------------
    // BALANCE (from band_levels_db)
    // -----------------------------
    if (metric === "balance") {

    const bands = data?.band_levels_db || null;
    const score = Number(data?.scores?.balance);

    if (!bands) {
        el.innerHTML = `
        <div class="insight-block">
            <h3>Balance</h3>
            <p>Run a sweep to see how your room's bass, midrange, treble, and high frequencies compare. Balance tells you whether the room sounds warm, neutral, or bright overall.</p>
        </div>
        `;
        return;
    }

    const bass   = Number(bands.bass_20_200);
    const mid    = Number(bands.mid_200_2k);
    const treble = Number(bands.treble_2k_10k);
    const air    = Number(bands.air_10k_20k);

    if (![bass, mid, treble, air].every(Number.isFinite)) {
        el.innerHTML = `
        <div class="insight-block">
            <h3>Balance</h3>
            <p>Band data incomplete — cannot compute balance.</p>
        </div>
        `;
        return;
    }

    // ✅ HARD MATH FROM SWEEP DATA
    const lowAvg  = (bass + mid) / 2;
    const highAvg = (treble + air) / 2;

    const tiltDb = highAvg - lowAvg;              // warm vs bright bias
    const spreadDb = Math.max(bass, mid, treble, air) - Math.min(bass, mid, treble, air);

    el.innerHTML = `
        <div class="insight-block">
        <h3>Balance</h3>

        <p><b>What’s happening:</b><br>
        Balance is calculated from your measured band energy. If low bands measure higher than high bands, the room sounds warmer.  
        If high bands measure higher, the room sounds brighter.</p>

        <p><b>Measured band levels:</b><br>
            Bass (20–200): <code>${bass.toFixed(1)} dB</code><br>
            Mid (200–2k): <code>${mid.toFixed(1)} dB</code><br>
            Treble (2k–10k): <code>${treble.toFixed(1)} dB</code><br>
            Air (10k–20k): <code>${air.toFixed(1)} dB</code>
        </p>

        <p class="math">
            Low average: <code>(${bass.toFixed(1)} + ${mid.toFixed(1)}) / 2 = ${lowAvg.toFixed(2)} dB</code><br>
            High average: <code>(${treble.toFixed(1)} + ${air.toFixed(1)}) / 2 = ${highAvg.toFixed(2)} dB</code><br>
            Tilt: <code>${highAvg.toFixed(2)} − ${lowAvg.toFixed(2)} = ${tiltDb.toFixed(2)} dB</code><br>
            Spread: <code>${spreadDb.toFixed(2)} dB</code>
        </p>

        <p>
            Tilt <b>${tiltDb < 0 ? "below" : "above"}</b> zero means your tonal balance leans
            <b>${tiltDb < 0 ? "warm (bass-heavy)" : "bright (treble-heavy)"}</b>.
        </p>

        <p><b>Balance score:</b> <code>${Number.isFinite(score) ? score.toFixed(1) : "—"}/10</code></p>
        </div>
    `;
    return;
    }

    console.log("🔍 entering smoothness block");

    // -----------------------------
    // SMOOTHNESS (from smoothness_std_db)
    // -----------------------------
    if (metric === "smoothness") {
        console.log("🔎 smoothness data keys:", Object.keys(data));
        console.log("🔎 smoothness full data:", data);


        const std = Number(data?.smoothness_std_db);
        const score = Number(data?.scores?.smoothness);

        if (!Number.isFinite(std)) {
            el.innerHTML = `
            <div class="insight-block">
                <h3>Smoothness</h3>
                <p>Run a sweep to measure how evenly your room reproduces each frequency. A smooth response means every note is reproduced at a similar level — no frequencies stand out or disappear.</p>
            </div>
            `;
            return;
        }

        el.innerHTML = `
            <div class="insight-block">
            <h3>Smoothness</h3>

            <p><b>What’s happening:</b><br>
            Smoothness measures how much the frequency response varies across the spectrum.
            Large peaks and dips increase the variation; a flatter response lowers it.</p>

            <p class="math">
                Standard deviation of response:<br>
                <code>σ = ${std.toFixed(2)} dB</code>
            </p>

            <p>
                A lower σ means the response changes less between frequencies and sounds more even.
            </p>

            <p><b>Smoothness score:</b> <code>${Number.isFinite(score) ? score.toFixed(1) : "—"}/10</code></p>
            </div>
        `;
        return;
    }

    // -----------------------------
    // CLARITY (early reflections + smoothness)
    // -----------------------------
    if (metric === "clarity") {

        const refs = Array.isArray(data?.reflections_ms) ? data.reflections_ms : [];
        const smooth = Number(data?.smoothness_std_db);
        const score = Number(data?.scores?.clarity);

        if (!refs.length || !Number.isFinite(smooth)) {
            el.innerHTML = `
            <div class="insight-block">
                <h3>Clarity</h3>
                <p>Run a sweep to see how early reflections from walls, ceiling, and floor affect the detail and stereo focus you hear at the listening position. Reflections arriving within a few milliseconds of the direct sound are the main culprit for blurred imaging.</p>
            </div>`;
            return;
        }

        const first = refs[0] ?? null;
        const early = refs.filter(r => r <= 5);
        const count = early.length;

        el.innerHTML = `
            <div class="insight-block">
            <h3>Clarity</h3>

            <p><b>What’s happening:</b><br>
            Clarity depends on how quickly reflections reach your ears and how uneven the frequency response is.</p>

            <p class="math">
                First reflection: <code>${first?.toFixed(2) ?? "—"} ms</code><br>
                Reflections within 5 ms: <code>${count}</code><br>
                Smoothness σ: <code>${smooth.toFixed(2)} dB</code>
            </p>

            <p>
                Earlier and denser reflections blur detail and stereo focus.  
                A smoother response (lower σ) improves clarity.
            </p>

            <p><b>Clarity score:</b> <code>${Number.isFinite(score) ? score.toFixed(1) : "—"}/10</code></p>
            </div>
        `;
        return;
    }

}


function updateMeasurementIntegrity(data) {
    if (!data) return;

    // --- Sweep duration ---
    const sweepEl = document.getElementById("sweepLength");
    if (sweepEl) {
        const dur =
            data.sweep_duration_s ??
            data.analysis?.sweep_duration_s ??
            null;

        sweepEl.textContent =
            Number.isFinite(dur) ? `${dur.toFixed(1)} s` : "— s";
    }

    // --- Noise floor ---
    const noiseEl = document.getElementById("noiseFloor");
    if (noiseEl) {
        const nf =
            data.noise_floor_db ??
            data.signal_integrity?.noise_floor_db;

        noiseEl.textContent =
            Number.isFinite(nf) ? `${nf.toFixed(1)} dB` : "— dB";
    }

    // --- Peak SPL ---
    const peakEl = document.getElementById("peakSPL");
    if (peakEl && Array.isArray(data.mag_db)) {
        const peak = Math.max(...data.mag_db);
        peakEl.textContent =
            Number.isFinite(peak) ? `${peak.toFixed(1)} dB` : "— dB";
    }

    // --- L / R balance ---
    const lrEl = document.getElementById("lrBalance");
    if (lrEl) {
        const lr =
            data.lr_balance_db ??
            data.signal_integrity?.lr_balance_db;

        lrEl.textContent =
            Number.isFinite(lr) ? `± ${lr.toFixed(1)} dB` : "—";
    }
}


function findPeaksAndDips(freqs, mags) {
    const peaks = [];
    const dips = [];

    for (let i = 2; i < mags.length - 2; i++) {
        const f = freqs[i];
        if (f > 300) continue; // focus on room region

        const prev = (mags[i - 1] + mags[i - 2]) / 2;
        const next = (mags[i + 1] + mags[i + 2]) / 2;
        const current = mags[i];

        if (current - prev > 3 && current - next > 3) {
            peaks.push({ f, m: current });
        }

        if (prev - current > 3 && next - current > 3) {
            dips.push({ f, m: current });
        }
    }

    return { peaks, dips };
}




/* ============================================================
    DASHBOARD CLASS
    ============================================================ */
class MeasurelyDashboard {
    constructor() {
        this.currentData = null;
        this.aiSummary = null;
        this.deviceStatus = {};
        this.updateInterval = null;
        this.activeChartSessions = new Set([0]);
        this.isSweepRunning = false;
        this.sweepCheckInterval = null;
        this.sessions = [];
        this.sessionOrder = [];
        this._lastLogCount = 0;
        this._lastStatusMessage = null;
        this.SPEAKERS_BY_KEY = {};
        this.activeMetricOverlay = "none";

        this.init();
        
    }

    /* NEW unified scoring bucket */
    toBucket(score) {
        if (score >= 8) return 'excellent';
        if (score >= 6) return 'good';
        if (score >= 4) return 'okay';
        return 'needs_work';
    }


    bindSideReflections() {
        const el = document.getElementById("sideRefItem");
        const detail = document.getElementById("sideRefDetail");

        if (!el) return;

        let active = false;

        el.addEventListener("click", () => {
            active = !active;
            detail?.classList.toggle("hidden", !active);

            if (window.room3D) {
                window.room3D.setOverlay("side_reflections", active);
            }
        });
    }



    /* ============================================================
    PEAK / DIP MODE LIST PARSER (from analysis.json)
    ============================================================ */
    updateModes() {
        const data = this.currentData;
        if (!data || !data.modes) return;

        const modes = data.modes;

        // Count peaks and dips from flat objects
        const numPeaks = modes.filter(m => m.type === "peak").length;
        const numDips = modes.filter(m => m.type === "dip").length;

        // Debug
        console.log("Modes detected:", numPeaks, "peaks,", numDips, "dips");

        // OPTIONAL — update DOM if you want
        const peakEl = document.getElementById('modePeakCount');
        const dipEl = document.getElementById('modeDipCount');

        if (peakEl) peakEl.textContent = numPeaks;
        if (dipEl) dipEl.textContent = numDips;
    }


    /* ============================================================
    HISTORY (uploads in web, sweeps in local)
    ============================================================ */
    async loadHistory() {

        console.group("📜 loadHistory()");
        console.log("CAPS.history =", CAPS.history);

        if (!CAPS.history) return;

        try {
            // Use MeasurelySessions (localStorage-first with Pi server fallback)
            // or fall back to direct API call if sessions.js isn't loaded yet
            let all = [];
            if (window.MeasurelySessions) {
                all = await window.MeasurelySessions.loadSessions();
            } else {
                const history = await safeJson("/api/sweephistory");
                all = Array.isArray(history?.sweeps) ? history.sweeps : [];
            }

            console.log("history sessions =", all.length);
            const cards = document.querySelectorAll(UI.historyCardSelector);

            console.log("Found history cards =", cards.length);

            // =====================================================
            // 🔗 HYDRATE SESSION MODEL (SINGLE SOURCE OF TRUTH)
            // =====================================================
            const extractNum = (id) => {
                const m = String(id).match(/(\d+)(?!.*\d)/);
                return m ? parseInt(m[1], 10) : -1;
            };

            this.sessions = all
                
                .filter(s =>
                    s.has_analysis === true ||
                    Number.isFinite(s.overall_score) ||
                    s.scores ||
                    s.analysis
                )


                .map(s => ({
                    id: s.id,
                    timestamp: s.timestamp,
                    overall: s.overall_score,
                    metrics: s.metrics || {
                        peaks_dips: s.peaks_dips,
                        reflections: s.reflections,
                        bandwidth: s.bandwidth,
                        balance: s.balance,
                        smoothness: s.smoothness,
                        clarity: s.clarity
                    },
                    note: s.note || ""
                }));

            this.sessionOrder = this.sessions
                .map(s => s.id)
                .sort((a, b) => extractNum(b) - extractNum(a));

            console.log("📦 Sessions hydrated:", this.sessionOrder);

            // =====================================================
            // EMPTY / RESET STATE
            // =====================================================
            if (this.sessions.length === 0) {
                console.warn("⚠️ HISTORY EMPTY — CLEARING UI");

                cards.forEach(card => {
                    card.dataset.uploadId = "";
                    card.dataset.sweepid = "";
                    card.dataset[UI.historyIdDatasetKey] = "";

                    const scoreEl = card.querySelector(UI.historyScoreSelector);
                    if (scoreEl) scoreEl.textContent = "--";
                    const fillEl = card.querySelector(".uploads-score-fill");
                    if (fillEl) fillEl.style.width = "0%";

                    card.querySelectorAll(
                        ".m-peaks,.m-reflections,.m-bandwidth,.m-balance,.m-smoothness,.m-clarity"
                    ).forEach(e => e.textContent = "--");

                    const preview = card.querySelector("[data-note-preview]");
                    if (preview) {
                        preview.textContent = "—";
                        preview.style.opacity = "0.3";
                    }

                    const timeEl = card.querySelector(UI.historyTimeSelector);
                    if (timeEl) timeEl.textContent = "—";

                    const actionsEl = card.querySelector(".uploads-actions");
                    if (actionsEl) actionsEl.classList.remove("is-active");
                });

                return;
            }

            // =====================================================
            // POPULATE HISTORY CARDS (NEWEST → OLDEST)
            // =====================================================
            const recent = this.sessions
                .slice()
                .sort((a, b) => extractNum(b.id) - extractNum(a.id))
                .slice(0, cards.length);

            for (let i = 0; i < cards.length; i++) {
                const card = cards[i];
                const meta = recent[i];

                if (!meta) {
                    card.dataset.uploadId = "";
                    card.dataset.sweepid = "";
                    card.dataset[UI.historyIdDatasetKey] = "";

                    const scoreEl = card.querySelector(UI.historyScoreSelector);
                    if (scoreEl) scoreEl.textContent = "--";
                    const fillEl = card.querySelector(".uploads-score-fill");
                    if (fillEl) fillEl.style.width = "0%";

                    card.querySelectorAll(
                        ".m-peaks,.m-reflections,.m-bandwidth,.m-balance,.m-smoothness,.m-clarity"
                    ).forEach(e => e.textContent = "--");

                    const preview = card.querySelector("[data-note-preview]");
                    if (preview) {
                        preview.textContent = "—";
                        preview.style.opacity = "0.3";
                    }

                    const timeEl = card.querySelector(UI.historyTimeSelector);
                    if (timeEl) timeEl.textContent = "—";

                    // hide action buttons on empty slots
                    const actionsEl = card.querySelector(".uploads-actions");
                    if (actionsEl) actionsEl.classList.remove("is-active");

                    continue;
                }

                const sessionId = meta.id;

                // keep BOTH dataset keys for safety
                card.dataset.uploadId = sessionId;
                card.dataset.sweepid = sessionId;
                card.dataset[UI.historyIdDatasetKey] = sessionId;

                // ---- time ----
                const timeEl = card.querySelector(UI.historyTimeSelector);
                if (timeEl) {
                    timeEl.textContent = meta.timestamp
                        ? new Date(meta.timestamp).toLocaleString()
                        : "—";
                }

                // ---- overall score ----
                const scoreEl = card.querySelector(UI.historyScoreSelector);
                if (scoreEl) {
                    scoreEl.textContent =
                        typeof meta.overall === "number"
                            ? meta.overall.toFixed(1)
                            : "--";
                }

                // ---- score bar ----
                const fillEl = card.querySelector(".uploads-score-fill");
                if (fillEl) {
                    const pct = typeof meta.overall === "number" ? meta.overall * 10 : 0;
                    fillEl.style.width = `${pct}%`;
                }

                // ---- metrics ----
                const setMetric = (cls, val) => {
                    const el = card.querySelector(cls);
                    if (!el) return;
                    el.textContent = (typeof val === "number") ? val.toFixed(1) : "--";
                };

                const m = meta.metrics || {};
                setMetric(".m-peaks",       m.peaks_dips);
                setMetric(".m-reflections", m.reflections);
                setMetric(".m-bandwidth",   m.bandwidth);
                setMetric(".m-balance",     m.balance);
                setMetric(".m-smoothness",  m.smoothness);
                setMetric(".m-clarity",     m.clarity);

                // ---- note preview ----
                const previewEl = card.querySelector("[data-note-preview]");
                if (previewEl) {
                    previewEl.textContent = meta.note?.trim() || "—";
                    previewEl.style.opacity = meta.note?.trim() ? "1" : "0.3";
                }

                // ---- ensure actions row is visible ----
                const actionsEl = card.querySelector(".uploads-actions");
                if (actionsEl) actionsEl.classList.add("is-active");

                // ---- load / delete ----
                const loadBtn = card.querySelector(".btn-load-sweep");
                if (loadBtn) {
                    loadBtn.onclick = async () => {
                        await fetch(`/api/session/${encodeURIComponent(sessionId)}/load`, { method: "POST" });
                        window.location.reload();
                    };
                }

                const deleteBtn = card.querySelector(".btn-delete-sweep");
                if (deleteBtn) {
                    deleteBtn.onclick = async () => {
                        if (!confirm(`Delete sweep ${sessionId}? This cannot be undone.`)) return;
                        const res = await fetch(`/api/uploads/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
                        if (!res.ok) { alert("Delete failed"); return; }
                        await this.loadHistory();
                    };
                }
            }

            // ---- "View all" link ----
            const viewAllLink = document.getElementById("viewAllSweepsLink");
            if (viewAllLink) {
                if (this.sessions.length > cards.length) {
                    viewAllLink.classList.remove("hidden");
                } else {
                    viewAllLink.classList.add("hidden");
                }
            }

        } catch (err) {
            console.error("❌ loadHistory failed:", err);
        }

        console.groupEnd();
    }



    /* ============================================================
   SAVE NOTE TO BACKEND (PERSIST IN ANALYSIS.JSON)
   ============================================================ */
    async saveNote(sessionId, note) {
        try {
            await fetch(`/api/session/${encodeURIComponent(sessionId)}/note`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ note })
            });

            this.showSuccess("Note saved");
        } catch (err) {
            console.error("Failed to save note:", err);
            this.showError("Failed to save note");
        }
    }

    /* ============================================================
    INIT
    ============================================================ */
    async init() {
        console.log('Initializing Measurely Dashboard...');

        if (window.initSpeakers) {
            await window.initSpeakers();
        }

        this.setupEventListeners();

        // 🧠 Dave Phrase Engine
        this.dave = new window.DavePhraseEngine();
        await this.dave.load();


        // Load phrase bank + speaker metadata
        await this.loadData();

        this.startPolling();
        this.showSuccess('Analysis loaded');

        /* --------------------------------------------
        ANALYSIS ITEM → OVERLAY + DETAIL CONTROLLER
        -------------------------------------------- */
        document.querySelectorAll(".analysis-item").forEach(item => {
        item.addEventListener("click", () => {

            const overlay = item.dataset.overlay;
            const score   = Number(item.dataset.score || 5);
            const isOpen  = item.getAttribute("aria-expanded") === "true";

            const detailId = item.getAttribute("aria-controls");
            const detail   = document.getElementById(detailId);

            // 1️⃣ Collapse ALL items first
            document.querySelectorAll(".analysis-item").forEach(other => {
            other.setAttribute("aria-expanded", "false");

            const otherDetailId = other.getAttribute("aria-controls");
            const otherDetail   = document.getElementById(otherDetailId);
            if (otherDetail) otherDetail.classList.add("hidden");
            });


            if (isOpen) {
            if (window.room3D?.resetView) {
                window.room3D.resetView();
            }
            return;
            }

            // 3️⃣ Expand THIS item
            item.setAttribute("aria-expanded", "true");
            if (detail) detail.classList.remove("hidden");

            // 4️⃣ Activate 3D overlay
            if (overlay && window.room3D) {
                if (overlay === "smoothness") {
                    const std = Number(this.currentData?.smoothness_std_db);
                    window.room3D.focusIssue("smoothness", score, std);
                } else {
                    window.room3D.focusIssue(overlay, score);
                }
            }

            console.log("Analysis card clicked →", overlay);

            console.log("🧠 metric received:", overlay);

        if (!this.currentData) {
            console.warn("Insight blocked — currentData not ready");
            return;
        }

        const insightPayload = {
            ...this.currentData,
            room_context: this.currentData.room_context,
            geom: this.roomGeomAnalysis
        };


            console.log("🔥 SENDING TO updateRoomInsightText:", insightPayload);

            updateRoomInsightText(overlay, insightPayload);

        });
        });


        console.log('Dashboard initialized successfully');
    }

    /* ============================================================
    LOAD DATA — localStorage-first, server fallback
    ============================================================ */
    async loadData() {
    try {
        this.showLoadingState();

        // ── 1. Try localStorage first (instant, no network) ──────────────
        // Read sessions regardless of whether sessions.js is loaded so that
        // diagnose.html / simulate.html (which don't bundle sessions.js) still
        // pick up data written by app.html.
        {
            const localSessions = window.MeasurelySessions
                ? (window.MeasurelySessions.lsRead?.() ||
                   JSON.parse(localStorage.getItem('measurely_sessions') || '[]'))
                : JSON.parse(localStorage.getItem('measurely_sessions') || '[]');

            if (Array.isArray(localSessions) && localSessions.length > 0) {
                const latest = localSessions[0]; // newest first by design
                const ai = latest.analysis || latest.ai || {};

                if (ai && (ai.scores || ai.freq_hz)) {
                    this.currentData = {
                        scores:            ai.scores            || {},
                        band_levels_db:    ai.band_levels_db    || {},
                        modes:             ai.modes             || [],
                        reflections_ms:    ai.reflections_ms    || [],
                        smoothness_std_db: ai.smoothness_std_db ?? null,
                        signal_integrity:  ai.signal_integrity  ?? {},
                        room_context:      ai.room_context      ?? null,
                        has_analysis:      true,
                        label:             latest.label         || latest.id,
                        // Pi-era fields (pass through if present)
                        freq_hz:           ai.freq_hz           || null,
                        mag_db:            ai.mag_db            || null,
                    };

                    this.aiSummary = ai.ai_summary || null;
                    this.updateDashboard();
                    return; // done — no network needed
                }
            }
        }

        // ── 2. No local data — try Pi server ─────────────────────────────
        const all = CAPS.history
            ? await safeJson("/api/sessions/all")
            : null;

        if (!Array.isArray(all) || all.length === 0) {
            // Last resort: /api/latest
            const latest = await safeJson("/api/latest");

            if (
                window.__IGNORE_LATEST_SWEEP__ ||
                !latest ||
                latest.has_analysis !== true
            ) {
                console.log("[Dashboard] No sessions found — upload a measurement to get started.");
                window.__IGNORE_LATEST_SWEEP__ = false;
                this.currentData = null;
                this.updateDashboard();
                return;
            }

            this.currentData = latest;
            this.aiSummary = latest.ai_summary || null;
            this.updateDashboard();
            return;
        }

        const extractNum = (id) =>
            parseInt(String(id).match(/(\d+)(?!.*\d)/)?.[1] || "-1", 10);

        const latestMeta = all.slice().sort((a, b) => extractNum(b.id) - extractNum(a.id))[0];

        if (extractNum(latestMeta.id) === 0) {
            this.currentData = null;
            this.loadHistory();
            return;
        }

        const id = encodeURIComponent(latestMeta.id);
        const data = await safeJson(`/api/session/${id}`);
        const ai   = await safeJson(`/api/session/${id}/analysis_ai`);

        if (!data || (!data.freq_hz && !data.scores)) throw new Error("invalid session data");

        this.currentData = {
            ...data,
            room_context: ai?.room_context || null
        };

        this.aiSummary = data.ai_summary || null;
        console.log("ROOM CONTEXT ATTACHED:", this.currentData.room_context);
        this.updateDashboard();

    } catch (err) {
        console.error(err);
        this.currentData = null;
        this.updateDashboard();
    }
    }


    /**
     * loadLatestAnalysis(ai)
     * Called by the upload modal after a successful browser-side analysis.
     * Injects scores directly into the dashboard without a page reload.
     */
    loadLatestAnalysis(ai) {
        if (!ai) return;

        this.currentData = {
            scores:            ai.scores            || {},
            band_levels_db:    ai.band_levels_db    || {},
            modes:             ai.modes             || [],
            reflections_ms:    ai.reflections_ms    || [],
            smoothness_std_db: ai.smoothness_std_db ?? null,
            signal_integrity:  ai.signal_integrity  ?? {},
            room_context:      ai.room_context      ?? null,
            has_analysis:      true,
            label:             ai.label             || 'Browser upload',
        };

        this.updateDashboard();
        this.showSuccess('Analysis loaded');
    }


    async runSweep() {
        console.log("[Sweep] runSweep() called");

        if (this.isSweepRunning) {
            console.warn("[Sweep] already running");
            this.showInfo("Sweep already running");
            return;
        }

        // Clear any cancel flag from a previous aborted sweep
        window.__IGNORE_LATEST_SWEEP__ = false;

        // Pre-flight device check — only block if we have a definitive "not connected" status
        const ds = this.deviceStatus;
        if (ds && Object.keys(ds).length > 0) {
            if (!ds.mic?.connected && !ds.dac?.connected) {
                toast("Plug in your USB microphone. The DAC isn't responding either — try switching the device off and back on using the power button on the back.", "error");
                return;
            }
            if (!ds.mic?.connected) {
                toast("Plug in your USB microphone, then try again.", "error");
                return;
            }
            if (!ds.dac?.connected) {
                toast("The DAC isn't responding — try switching the device off and back on using the power button on the back.", "error");
                return;
            }
        }

        this.isSweepRunning = true;

        // ---- UI: open progress modal ----
        this._closeSweepProgress = null;

        try {
            if (window.showSweepProgress) {
                console.log("[SweepUI] Opening progress modal");
                this._sweepUI = showSweepProgress();

                // 🔥 Reset log tracking + clear panel
                this._lastLogCount = 0;

                const panel = document.getElementById("sweepLogPanel");
                if (panel) {
                    panel.innerHTML = "";
                    console.log("[SweepLog] Cleared previous logs");
                }

            } else {
                console.warn("[SweepUI] showSweepProgress() not found");
            }
        } catch (e) {
            console.error("[SweepUI] Failed to open progress modal", e);
        }

        try {
            console.log("[Sweep] POST /api/run-sweep");

            const response = await fetch("/api/run-sweep", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}"
            });

            console.log("[Sweep] HTTP status:", response.status);

            try {
                const result = await response.json();
                console.log("[Sweep] response JSON:", result);
            } catch {
                console.warn("[Sweep] No JSON body (expected)");
            }

            console.log("[Sweep] Assuming sweep started");

            // ---- Start polling (modal will close from poller) ----
            this.monitorSweepProgress();

        } catch (err) {
            console.error("[Sweep] HARD FAILURE", err);

            if (this._sweepUI) {
                this._sweepUI.error("Sweep failed to start");
                this._sweepUI = null;
            }

            this.isSweepRunning = false;
            this.showError("Sweep failed to start");
        }
    }

    async fetchSweepLogs() {
        // Sweep is browser-side now — no server log endpoint
        return [];
    }

    async monitorSweepProgress() {
        // Sweep is browser-side — no progress endpoint to poll
        console.log('[SweepPoll] Browser mode — no server sweep progress to poll');
    }

    resetSweepState() {
        this.isSweepRunning = false;

        if (this.sweepCheckInterval) {
            clearInterval(this.sweepCheckInterval);
            this.sweepCheckInterval = null;
        }
    }


    /* ============================================================
    ANALYSIS PROGRESS MONITOR — TEMPORARILY DISABLED
    ============================================================ */
    async monitorAnalysisProgress() {
        console.warn("⏸ Analysis progress polling disabled — pending backend API");
        return;
    }


    /* ============================================================
    WAIT FOR ANALYSIS FILE — Real finish signal
    ============================================================ */
    async waitForAnalysisFile() {
        const checkInterval = 1000; // ms
        const maxChecks = 20;
        let checks = 0;

        const extractNum = (id) => {
            const m = String(id).match(/(\d+)(?!.*\d)/);
            return m ? parseInt(m[1], 10) : -1;
        };

        const checkLoop = setInterval(async () => {
            checks++;

            try {
                // 1️⃣ Get list of sessions from MeasurelySessions (localStorage + server merge)
                const sessions = window.MeasurelySessions
                    ? await window.MeasurelySessions.loadSessions()
                    : await fetch('/api/sessions/all').then(r => r.json()).catch(() => []);
                if (!Array.isArray(sessions) || sessions.length === 0) return;

                // 2️⃣ Find newest session
                const latestMeta = sessions
                    .slice()
                    .sort((a, b) => extractNum(b.id) - extractNum(a.id))[0];

                if (!latestMeta) return;

                // 3️⃣ Fetch full analysis data for that session
                const dataRes = await fetch(`/api/session/${encodeURIComponent(latestMeta.id)}`);
                if (!dataRes.ok) return;

                const data = await dataRes.json();
                const score = Number(data.overall_score);

                // 4️⃣ Analysis is considered “ready” only when fully scored
                if (data.has_analysis && Number.isFinite(score) && score > 0) {
                    clearInterval(checkLoop);

                    addLog("Analysis ready — displaying results…");

                    if (this._sweepUI) {
                        this._sweepUI.showAnalysis(data);
                    }

                    this.currentData = data;
                    this.updateDashboard();

                    // 🔥 Switch UI to dashboard view
                    if (typeof window.showDashboard === "function") {
                        window.showDashboard();
                    } else {
                        // Fallback if you're using page anchors or sections
                        window.location.hash = "#dashboard";
                    }

                    setTimeout(() => {
                        if (this._sweepUI) {
                            this._sweepUI.close();
                            this._sweepUI = null;
                        }
                        this.resetSweepState();
                    }, 4000); // keep modal open 4s so user sees data

                    return;
                }

            } catch (err) {
                console.warn("analysis poll failed:", err);
            }

            // ⏳ Timeout fallback
            if (checks >= maxChecks) {
                clearInterval(checkLoop);

                addLog("Analysis timeout — showing latest available data.");

                await this.loadData();
                this.updateDashboard();
                this.resetSweepState();
            }

        }, checkInterval);
    }
    

    /* ============================================================
    UPDATE DASHBOARD (MAIN REFRESH)
    ============================================================ */
    updateDashboard() {
        if (!this.currentData) {
            console.warn('No data to update');
            this.showEmptyState();
            return;
        }

        this.hideEmptyState();

        console.log('Updating dashboard…');

        this.updateScores();
        this.updateFrequencyChartMulti();
        this.updateDetailedAnalysis();
        this.updateAcousticReality();
        this.updateModes();

        updateMeasurementIntegrity(this.currentData);

        // 🔥 ADD THIS — loads the 4 upload cards into the dashboard
        if (!this._historyLoaded) {
            this._historyLoaded = true;
            this.loadHistory();
        }

        // Attach room from localStorage if the analysis result doesn't carry it.
        // Always the case on the static/online version (Pi never embeds room metadata).
        if (!this.currentData.room) {
            try {
                const saved = JSON.parse(localStorage.getItem('measurely_room') || 'null');
                if (saved) {
                    this.currentData.room = {
                        ...saved.geometry,
                        ...saved.setup,
                        room_type: saved.room_type,
                        ...(saved.environment?.furniture || {}),
                        ...(saved.environment?.treatment || {}),
                        floor_material: saved.environment?.floor_material,
                    };
                }
            } catch (e) {
                console.warn('[dashboard] Could not read room from localStorage:', e);
            }
        }

        if (window.updateRoomCanvas && this.currentData.room) {
            window.updateRoomCanvas(this.currentData.room);
        }

        console.log("ROOM CONTEXT:", this.currentData.room_context);

        // 🧠 Room geometry analysis (pre-measurement facts)
        if (this.currentData.room) {
            this.roomGeomAnalysis = buildRoomGeometryAnalysis(
                this.currentData.room,
                this.currentData.room_context
            );

            renderRoomAnalysisCards(this.roomGeomAnalysis);
            console.log("GEOM SBIR:", this.roomGeomAnalysis.sbir);
        }

        console.log('Dashboard update complete.');
    }
    

    /* ============================================================
    EMPTY STATE — shown when there is no measurement data yet.
    Sits lightly over the 3D room so the canvas remains visible.
    Detects whether the user has set up their room profile first
    and adapts the CTA accordingly.
    ============================================================ */
    showEmptyState() {
        if (document.getElementById('mly-empty-state')) return;

        // Don't block analysis pages (diagnose / simulate) with the upload overlay.
        // Those pages set window.CAPS.sweep = false — use that as the sentinel.
        if (window.CAPS && typeof window.CAPS.sweep !== 'undefined') return;

        const hasRoom = !!localStorage.getItem('measurely_room');

        const el = document.createElement('div');
        el.id = 'mly-empty-state';
        // Re-use the section-intro backdrop styles (blur, dark tint, flex-center)
        el.className = 'section-intro-backdrop';
        el.style.display = 'flex';
        el.style.zIndex  = '300';

        // ── No room profile yet — steer to onboarding first ────────────
        const noRoomHtml = `
        <div style="max-width:480px;width:100%;
             background:linear-gradient(160deg,rgba(28,36,54,0.97),rgba(15,20,36,0.99));
             border:1px solid rgba(99,102,241,0.25);border-radius:1.5rem;
             padding:2.25rem 2rem;text-align:center;
             box-shadow:0 32px 80px rgba(0,0,0,0.65),inset 0 1px 0 rgba(255,255,255,0.05);">

          <div style="width:3.5rem;height:3.5rem;border-radius:50%;
               background:linear-gradient(135deg,#6366f1,#8b5cf6);
               display:flex;align-items:center;justify-content:center;
               margin:0 auto 1.25rem;">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none"
                 viewBox="0 0 24 24" stroke="white" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round"
                    d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
            </svg>
          </div>

          <h2 style="font-size:1.35rem;font-weight:800;margin:0 0 0.6rem;color:#f9fafb;
               letter-spacing:-0.03em;">Build your room first</h2>
          <p style="color:#94a3b8;font-size:0.9rem;line-height:1.65;margin:0 0 1.5rem;">
            Measurely combines your WAV measurement with your room's physical data —
            dimensions, speaker placement, and furnishings — to give you meaningful scores.
            Takes 2 minutes.
          </p>

          <a href="onboarding.html"
             style="display:inline-flex;align-items:center;gap:0.5rem;
                    background:linear-gradient(135deg,#6366f1,#4f46e5);color:white;
                    text-decoration:none;border-radius:0.75rem;padding:0.85rem 1.75rem;
                    font-size:0.95rem;font-weight:700;cursor:pointer;font-family:inherit;
                    box-shadow:0 8px 24px rgba(99,102,241,0.4);
                    transition:transform .15s,box-shadow .15s;">
            Set up my room
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none"
                 viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14m-7-7 7 7-7 7"/>
            </svg>
          </a>
        </div>`;

        // ── Has room — show instruction card (dismissable, no forced upload) ──
        const hasRoomHtml = `
        <div class="section-intro-card" style="max-width:480px;">

          <div class="section-intro-icon-wrap">
            <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" fill="none"
                 viewBox="0 0 40 40" aria-hidden="true">
              <rect x="5" y="5" width="30" height="30" rx="4"
                    stroke="currentColor" stroke-width="2" fill="none"/>
              <path d="M11 30 V22 M20 30 V14 M29 30 V19"
                    stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
            </svg>
          </div>

          <h2 class="section-intro-title">Ready to measure</h2>
          <p class="section-intro-body">
            Run a sine sweep in REW, export the impulse response as a WAV, then
            upload it here. Measurely will score your room's acoustics and map every
            issue to the 3D model you just built — entirely in your browser.
          </p>

          <div id="mly-rew-guide" style="
               text-align:left;
               background:rgba(255,255,255,0.04);
               border:1px solid rgba(255,255,255,0.08);
               border-radius:0.85rem;
               padding:1rem 1.15rem;
               margin-bottom:1.5rem;">
            <p style="font-size:0.72rem;font-weight:700;color:#a5b4fc;margin:0 0 0.65rem;
               letter-spacing:0.06em;text-transform:uppercase;">How to get a WAV from REW</p>
            <ol style="margin:0;padding-left:1.15rem;display:flex;flex-direction:column;gap:0.55rem;">
              <li style="font-size:0.82rem;color:#d1d5db;line-height:1.5;">
                Run a sine sweep in REW
                <span style="display:block;color:#64748b;font-size:0.75rem;">
                  Measure &rarr; Measure — default sweep settings are fine
                </span>
              </li>
              <li style="font-size:0.82rem;color:#d1d5db;line-height:1.5;">
                Export the impulse response
                <span style="display:block;color:#64748b;font-size:0.75rem;">
                  File &rarr; Export &rarr; Export impulse response as WAV
                </span>
              </li>
              <li style="font-size:0.82rem;color:#d1d5db;line-height:1.5;">
                Upload that WAV here
                <span style="display:block;color:#64748b;font-size:0.75rem;">
                  Nothing leaves your device &middot; Analysed entirely in your browser
                </span>
              </li>
            </ol>
            <p style="margin:0.75rem 0 0;font-size:0.75rem;color:#4b5563;">
              REW is free at
              <a href="https://www.roomeqwizard.com/" target="_blank" rel="noopener"
                 style="color:#818cf8;text-decoration:none;">roomeqwizard.com &rarr;</a>
            </p>
          </div>

          <div style="margin-bottom:0.75rem;">
            <button id="mly-empty-upload-btn"
                    class="btn btn-primary section-intro-cta">
              Upload a measurement &rarr;
            </button>
          </div>

          <button id="mly-empty-dismiss" class="flyby-back-link">
            Explore the dashboard first
          </button>

          <p style="margin-top:1.1rem;font-size:0.72rem;color:#374151;">
            <a href="onboarding.html" style="color:#4b5563;text-decoration:none;">
              Edit room profile &rarr;
            </a>
          </p>
        </div>`;

        el.innerHTML = hasRoom ? hasRoomHtml : noRoomHtml;
        document.body.appendChild(el);
        // Spring entrance using the section-intro animation
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('open')));

        if (!hasRoom) return;

        // ── "Upload a measurement" → open the upload modal and dismiss ──
        document.getElementById('mly-empty-upload-btn')?.addEventListener('click', () => {
            el.classList.remove('open');
            el.addEventListener('transitionend', () => el.remove(), { once: true });
            window.openUploadModal?.();
        });

        // ── "Explore the dashboard first" → dismiss overlay entirely ───
        document.getElementById('mly-empty-dismiss')?.addEventListener('click', () => {
            el.classList.remove('open');
            el.addEventListener('transitionend', () => el.remove(), { once: true });
        });
    }

    hideEmptyState() {
        const el = document.getElementById('mly-empty-state');
        if (el) el.remove();
    }

    /* ============================================================
    UPDATE SCORES (OVERALL + 6 CARDS)
    ============================================================ */
    updateScores() {
        const data = this.currentData;
        if (!data) return;


        const s = data.scores || {};

        /* ---------------- 1. OVERALL SCORE & INSTRUMENT GAUGE ---------------- */
        let overall = Number(s.overall ?? data.overall_score ?? data.overall ?? 5.0);
        if (!Number.isFinite(overall)) overall = 5.0;

        const overallEl = document.getElementById('overallScore');
        const overallGauge = document.getElementById('overallGauge');
        const overallPercent = document.getElementById('overallScorePercent');

        if (overallEl) overallEl.textContent = overall.toFixed(1);
        if (overallPercent) overallPercent.textContent = (overall * 10).toFixed(0) + '%';

        if (overallGauge) {
            requestAnimationFrame(() => {
                overallGauge.style.width = (overall * 10) + '%';
            });
        }

        const overallFill = document.querySelector('.overall-score-fill');
        if (overallFill) {
            requestAnimationFrame(() => {
                overallFill.style.width = (overall * 10) + '%';
            });
        }

        /* ---------------- 2. OVERALL DAVE PHRASE ---------------- */
        (() => {
            const el = document.getElementById("overallDavePhrase");
            if (!el) return;

            const score = Number(s.overall ?? data.overall_score ?? 5);
            const phrase = this.dave.overall(score);

            el.textContent = phrase || "Analysis complete. Review the measured metrics below.";
        })();

        /* ---------------- 3. SIX SMALL CARD SCORES ---------------- */
        const metrics = {
            peaksDips:   s.peaks_dips ?? 0,
            reflections: s.reflections ?? 0,
            bandwidth:   s.bandwidth ?? 0,
            balance:     s.balance ?? 0,
            smoothness:  s.smoothness ?? 0,
            clarity:     s.clarity ?? 0
        };

        for (const [key, val] of Object.entries(metrics)) {
            const scoreEl = document.getElementById(`${key}Score`);
            if (scoreEl) scoreEl.textContent = val.toFixed(1);

            const trackEl = document.getElementById(`${key}Track`);
            if (trackEl) {
                const percent = val * 10;
                trackEl.style.width = `${percent}%`;

                if (percent < 40) trackEl.style.background = 'var(--c-poor)';
                else if (percent > 75) trackEl.style.background = 'var(--c-excellent)';
                else trackEl.style.background = 'var(--c-accent)';
            }
        }

        /* ---------------- 4. META STATS GRID ---------------- */
        const metaSchroeder = document.getElementById('metaSchroeder');
        if (metaSchroeder) {
            const sch = data.room_context?.room?.schroeder_hz || data.room?.schroeder_hz;
            metaSchroeder.textContent = Number.isFinite(sch) ? `${Math.round(sch)} Hz` : "-- Hz";
        }

        const metaVolume = document.getElementById('metaVolume');
        if (metaVolume) {
            const vol = data.room_context?.room?.volume_m3 || data.room?.volume_m3;
            metaVolume.textContent = Number.isFinite(vol) ? `${vol} m³` : "-- m³";
        }

        const metaSmoothness = document.getElementById('metaSmoothness');
        if (metaSmoothness) {
            const dev = data.smoothness_std_db;
            metaSmoothness.textContent = Number.isFinite(dev) ? `± ${dev.toFixed(1)} dB` : "-- dB";
        }

        /* ---------------- 5. MEASURED ACOUSTIC REALITY (NEW CARD) ---------------- */
        const freqDevEl = document.getElementById('analysisFreqDeviation');
        const modeEl    = document.getElementById('analysisModalActivity');
        const reflEl    = document.getElementById('analysisReflections');
        const decayEl   = document.getElementById('analysisDecay');

        if (freqDevEl) {
            const dev = data.smoothness_std_db;
            freqDevEl.textContent = Number.isFinite(dev) ? `± ${dev.toFixed(1)} dB` : "—";
        }

        if (modeEl && Array.isArray(data.modes)) {
            modeEl.textContent = `${data.modes.length} modes`;
        }

        if (reflEl) {
            const r = s.reflections;
            reflEl.textContent = Number.isFinite(r) ? `${r.toFixed(1)} / 10` : "—";
        }

        if (decayEl) {
            const d = s.smoothness;
            decayEl.textContent = Number.isFinite(d) ? `${d.toFixed(1)} / 10` : "—";
        }

        /* ---------------- 6. DAVE PHRASES (SMALL CARDS) ---------------- */
        this.updateDescriptions(data);
    }

    updateAcousticReality() {
        const d = this.currentData;
        if (!d || !d.has_analysis) return;

        // --- Frequency deviation (measured flatness)
        const dev = d.smoothness_std_db;
        const freqEl = document.getElementById("analysisFreqDeviation");
        if (freqEl) {
            freqEl.textContent = Number.isFinite(dev)
                ? `± ${dev.toFixed(1)} dB`
                : "—";
        }

        // --- Modal activity (measured)
        const modeEl = document.getElementById("analysisModalActivity");
        if (modeEl && Array.isArray(d.modes)) {
            modeEl.textContent = `${d.modes.length} dominant modes`;
        }

        // --- Reflection score (measured)
        const reflEl = document.getElementById("analysisReflections");
        if (reflEl) {
            reflEl.textContent =
                Number.isFinite(d.scores?.reflections)
                    ? `${d.scores.reflections.toFixed(1)} / 10`
                    : "—";
        }

        // --- Decay / smoothness proxy
        const decayEl = document.getElementById("analysisDecay");
        if (decayEl) {
            decayEl.textContent =
                Number.isFinite(d.scores?.smoothness)
                    ? `${d.scores.smoothness.toFixed(1)} / 10`
                    : "—";
        }
    }

   /* ============================================================
   METRIC META-DATA (Schroeder / Volume / Smoothness)
   ============================================================ */
    updateMetaStats(data) {
        // Volume & Schroeder usually come from the room context
        const metaSchroeder = document.getElementById('metaSchroeder');
        const metaVolume = document.getElementById('metaVolume');
        const metaSmoothness = document.getElementById('metaSmoothness');

        if (metaSchroeder && data.room?.schroeder_hz) {
            metaSchroeder.textContent = `${Math.round(data.room.schroeder_hz)} Hz`;
        }
        
        if (metaVolume && data.room?.volume_m3) {
            metaVolume.textContent = `${data.room.volume_m3} m³`;
        }

        if (metaSmoothness && data.smoothness_std_db) {
            // Show the raw standard deviation (e.g., ± 3.8 dB)
            metaSmoothness.textContent = `± ${data.smoothness_std_db.toFixed(1)} dB`;
        }
    }
    
    /* ============================================================
    CARD SUMMARIES + Dave PHRASES (SAFE, DOM-ALIGNED)
    ============================================================ */
    updateDescriptions(data) {

        if (!data) return;

        /* ------------------------------------------------------------
        Resolve speaker (optional tag use)
        ------------------------------------------------------------ */
        const speakerType =
            data.room?.speaker_type === "standmount"     ? "standmount speakers" :
            data.room?.speaker_type === "floorstander"   ? "floorstanding speakers" :
            data.room?.speaker_type === "electrostatic"  ? "electrostatic speakers" :
            "your speakers";

        /* ------------------------------------------------------------
        Tag values for Dave phrase expansion
        ------------------------------------------------------------ */
        const tagMap = {
            room_width: data.room?.width_m ?? "--",
            room_length: data.room?.length_m ?? "--",
            listener_distance: data.room?.listener_front_m ?? "--",
            spk_distance: data.room?.spk_front_m ?? "--",
            speaker_friendly_name: speakerType
        };

        const expandTags = (str) => {
            if (!str) return str;
            return Object.entries(tagMap).reduce(
                (out, [k, v]) =>
                    out.replace(new RegExp(`{{${k}}}`, "g"), v ?? ""),
                str
            );
        };

        /* ------------------------------------------------------------
        Metric → DOM target mapping (THIS MUST MATCH HTML)
        ------------------------------------------------------------ */
        const metricMap = {
            bandwidth:   "bandwidthDave",
            balance:     "balanceDave",
            smoothness:  "smoothnessDave",
            peaks_dips:  "peaksDipsDave",
            reflections: "reflectionsDave",
            clarity:     "clarityDave"
        };

        /* ------------------------------------------------------------
        Inject Dave phrases
        ------------------------------------------------------------ */
        for (const [metric, elId] of Object.entries(metricMap)) {
            const el = document.getElementById(elId);
            if (!el) continue;

            const score = Number(data.scores?.[metric] ?? 5);
            const phrase = this.dave.category(metric, score);
            el.textContent = expandTags(phrase);

        }
    }


    /* ============================================================
    Chart
    ============================================================ */

    async updateFrequencyChartMulti() {

        const chartEl = document.getElementById("frequencyChart");
        if (!chartEl) return;

        // Lazy-load Plotly on first chart render (3.5 MB deferred until needed)
        await loadPlotly();

        console.log("📊 Drawing chart with overlay:", this.activeMetricOverlay);

        // ── Impulse-response view (Reflections card) ──────────────────────
        if (this.activeMetricOverlay === "side_reflections") {
            this._renderImpulseResponseChart();
            return;
        }

        // ── Data source: API sessions (Pi) or currentData fallback (static) ──
        let curvePairs = [];  // [{ freqs, mags, label, colour }]

        if (!isStaticHosting() && CAPS.history) {
            try {
                const all = await safeJson("/api/sessions/all") || [];
                const extractNum = (id) => {
                    const m = String(id).match(/(\d+)(?!.*\d)/);
                    return m ? parseInt(m[1], 10) : -1;
                };
                const LABELS  = ["Latest", "Previous", "Earlier", "Oldest"];
                const COLOURS = ["#3b82f6", "#a855f7", "#22c55e", "#f59e0b"];

                const sessions = all
                    .slice()
                    .sort((a, b) => extractNum(b.id) - extractNum(a.id))
                    .filter(s => !(extractNum(s.id) === 0 && all.length > 1))
                    .slice(0, 4);

                for (let i = 0; i < sessions.length; i++) {
                    if (!this.activeChartSessions.has(i)) continue;
                    const meta = sessions[i];
                    if (!meta) continue;
                    try {
                        const curve = await safeJson(`/api/session/${meta.id}/report_curve`);
                        if (curve && (curve.freqs || curve.freq)) {
                            curvePairs.push({
                                freqs:  curve.freqs || curve.freq || [],
                                mags:   curve.mag   || curve.mags || [],
                                label:  LABELS[i],
                                colour: COLOURS[i],
                                idx:    i
                            });
                        }
                    } catch { /* skip missing session */ }
                }
            } catch { /* fall through to currentData */ }
        }

        // Fallback: use currentData directly (static hosting / browser analysis)
        if (!curvePairs.length && this.currentData) {
            const d = this.currentData;

            // Ensure we always have flat JS arrays — data may arrive as JSON strings
            // (e.g. parsed from localStorage) which Plotly cannot accept as trace data.
            const toArray = (v) => {
                if (Array.isArray(v)) return v;
                if (typeof v === 'string') {
                    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; }
                    catch { return []; }
                }
                return [];
            };

            const freqs = toArray(d.freqs ?? d.freq ?? d.frequency ?? []);
            const mags  = toArray(d.mag   ?? d.mags ?? d.magnitude  ?? []);
            if (freqs.length && mags.length) {
                curvePairs.push({ freqs, mags, label: "Latest", colour: "#3b82f6", idx: 0 });
            }
        }

        if (!curvePairs.length) return;  // nothing to plot

        const LABELS  = ["Latest", "Previous", "Earlier", "Oldest"];
        const COLOURS = ["#3b82f6", "#a855f7", "#22c55e", "#f59e0b"];

        const traces = [];

        for (let i = 0; i < curvePairs.length; i++) {
            const { freqs, mags, label, colour, idx = i } = curvePairs[i];

            // ── kept inside loop (same scope as before) ──────────────────

                function movingAverage(arr, windowSize = 12) {
                const result = [];
                for (let k = 0; k < arr.length; k++) {
                    const start = Math.max(0, k - windowSize);
                    const end   = Math.min(arr.length - 1, k + windowSize);
                    let sum = 0, count = 0;
                    for (let j = start; j <= end; j++) { sum += arr[j]; count++; }
                    result.push(sum / count);
                }
                return result;
            }

            const smoothMag = movingAverage(mags, 12);

            // ── Base frequency response trace ─────────────────────────────
            traces.push({
                x: freqs, y: mags,
                type: "scatter", mode: "lines",
                name: label,
                line: { width: 2.5, color: colour, shape: "spline", smoothing: 0.6 },
                hoverinfo: "skip"
            });

            // ── Overlay dispatcher ────────────────────────────────────────
            if (this.activeMetricOverlay === "smoothness") {
                addSmoothnessOverlay(traces, freqs, mags, smoothMag);
            }
            if (this.activeMetricOverlay === "balance") {
                addBalanceOverlay(traces, freqs, mags, label);
            }
            if (this.activeMetricOverlay === "peaks_dips" || this.activeMetricOverlay === "sbir") {
                addPeaksDipsOverlay(traces, freqs, mags, label);
            }
            if (this.activeMetricOverlay === "reflections") {
                addReflectionsOverlay(traces, freqs, mags, label);
            }
            if (this.activeMetricOverlay === "clarity") {
                addClarityOverlay(traces, freqs);
                addTargetCurveTrace(traces, freqs, mags, this._roomType());
            }
            if (this.activeMetricOverlay === "bandwidth") {
                addBassAnnotations(traces, freqs, mags, label);
            }
        }

        // ── Layout ────────────────────────────────────────────────────────
        // Bandwidth view zooms into bass region; others show full spectrum
        const isBassView = this.activeMetricOverlay === "bandwidth";
        const xRange = isBassView
            ? [Math.log10(20), Math.log10(500)]
            : [Math.log10(20), Math.log10(20000)];
        const xTicks = isBassView
            ? { tickvals: [20,30,50,80,100,150,200,300,500], ticktext: ["20","30","50","80","100","150","200","300","500"] }
            : { tickvals: [20,50,100,200,500,1000,2000,5000,10000,20000],
                ticktext: ["20","50","100","200","500","1k","2k","5k","10k","20k"] };

        // Collect any bass annotations set by addBassAnnotations()
        const bassAnnotations = isBassView
            ? (document.getElementById("frequencyChart")?._bassAnnotations ?? [])
            : [];

        const layout = {
            xaxis: {
                title: isBassView ? "Frequency Hz (Bass Region)" : "Frequency (Hz)",
                type: "log",
                range: xRange,
                ...xTicks,
                ticks: "outside", showline: true, linewidth: 1, linecolor: "#9ca3af",
                showgrid: true, gridcolor: "rgba(255,255,255,0.025)", zeroline: false,
                tickfont: { size: 11, color: "rgba(255,255,255,0.6)" }
            },
            yaxis: {
                title: "Level (dB)",
                ticks: "outside", showline: true, linewidth: 1, linecolor: "#9ca3af",
                showgrid: true, gridcolor: "rgba(255,255,255,0.03)", zeroline: false,
                tickfont: { size: 11, color: "rgba(255,255,255,0.6)" }
            },
            showlegend: true,
            legend: {
                orientation: "h", x: 0.5, xanchor: "center",
                y: -0.24, yanchor: "top",
                font: { size: 10, color: "rgba(255,255,255,0.55)" }
            },
            annotations: bassAnnotations,
            plot_bgcolor: "#1f2937",
            paper_bgcolor: "transparent",
            margin: { t: 16, r: 20, b: 90, l: 56 }
        };

        Plotly.react("frequencyChart", traces, layout, {
            staticPlot: false,
            displayModeBar: false,
            responsive: true
        });
    }

    /** Returns the current room_type string (studio | home) from stored state. */
    _roomType() {
        try {
            const saved = JSON.parse(localStorage.getItem('measurely_room') || 'null');
            return saved?.room_type ?? this.currentData?.room?.room_type ?? 'home';
        } catch { return 'home'; }
    }

    /** Renders an impulse-response time-domain chart for the Reflections card. */
    _renderImpulseResponseChart() {
        const chartEl = document.getElementById("frequencyChart");
        if (!chartEl || !window.Plotly) return;

        const refs = this.currentData?.reflections_ms ?? [];
        if (!refs.length) {
            // Show empty state message inside the chart div
            chartEl.innerHTML = '<p style="color:#64748b;font-size:12px;padding:1rem;text-align:center;">No reflection data available — run a sweep to see the impulse response.</p>';
            return;
        }

        const traces = [];

        // Vertical lines at each reflection time (scatter with text mode)
        const maxTime = Math.max(...refs, 20) * 1.2;
        const xLines = [], yLines = [], textLabels = [];

        refs.slice(0, 12).forEach((t, i) => {
            // Each line = two points (bottom → top) separated by null
            xLines.push(t, t, null);
            yLines.push(0, 1, null);
            textLabels.push(`${t.toFixed(1)} ms`, '', '');
        });

        traces.push({
            x: xLines,
            y: yLines,
            type: "scatter",
            mode: "lines+text",
            text: textLabels,
            textposition: "top center",
            textfont: { size: 10, color: "rgba(251,191,36,0.85)" },
            line: { color: "rgba(251,191,36,0.75)", width: 2 },
            name: "Reflections",
            hoverinfo: "skip",
            connectgaps: false
        });

        // Shaded Haas zone (0–5ms)
        traces.push({
            x: [0, 5, 5, 0], y: [0, 0, 1.1, 1.1],
            type: "scatter", mode: "lines",
            fill: "toself",
            fillcolor: "rgba(239,68,68,0.07)",
            line: { width: 0 },
            name: "Haas Zone (< 5 ms)",
            hoverinfo: "skip"
        });

        const layout = {
            xaxis: {
                title: "Time (ms)", range: [0, maxTime],
                showgrid: true, gridcolor: "rgba(255,255,255,0.025)",
                zeroline: true, zerolinecolor: "rgba(255,255,255,0.2)",
                tickfont: { size: 11, color: "rgba(255,255,255,0.6)" }
            },
            yaxis: {
                visible: false, range: [0, 1.2]
            },
            showlegend: true,
            legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.24, yanchor: "top",
                font: { size: 10, color: "rgba(255,255,255,0.55)" } },
            plot_bgcolor: "#1f2937",
            paper_bgcolor: "transparent",
            margin: { t: 16, r: 20, b: 90, l: 24 },
            annotations: [{
                x: 2.5, y: 1.05, xref: "x", yref: "y",
                text: "Haas Zone (blur risk)", showarrow: false,
                font: { size: 10, color: "rgba(239,68,68,0.7)" }
            }]
        };

        Plotly.react("frequencyChart", traces, layout, {
            staticPlot: false, displayModeBar: false, responsive: true
        });
    }


    /* ============================================================
    NERDS CORNER: SESSION EXPLORER METRICS
    ============================================================ */
    updateCompareSessionMetrics() {
        const d = this.currentData;
        // Store previous band values between updates
        this._prevBands = this._prevBands || {};

        
        // Helper to update the Sesssion Explorer blocks
        const set = (id, value, isScore=false) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.innerHTML = isScore
                ? (value ? value.toFixed(1) : '--')
                : value;
        };

        if (!d || !d.has_analysis) {
             // Clear the explorer metrics if no analysis exists
            const emptyMetrics = {
                sessOverallScore: '--', sessOverallStatus: 'No Analysis',
                sessPeaksDips: '--', sessReflections: '--', sessBandwidth: '--',
                sessBalance: '--', sessSmoothness: '--', sessSignalIntegrity: '--',
                sessBass: '-- dB', sessMid: '-- dB', sessTreble: '-- dB', sessAir: '-- dB'
            };
            for (const [id, value] of Object.entries(emptyMetrics)) {
                set(id, value);
            }
            return;
        }

        const bands = d.band_levels_db || {};
        
        // Overall
        set("sessOverallScore", d.overall_score, true);
        set("sessOverallStatus", this.getScoreStatusText(d.overall_score).replace('<strong>Verdict:</strong> ', ''));

        // Six Metrics
        set("sessPeaksDips", d.peaks_dips, true);
        set("sessReflections", d.reflections, true);
        set("sessBandwidth", d.bandwidth, true);
        set("sessBalance", d.balance, true);
        set("sessSmoothness", d.smoothness, true);
        set("sessSignalIntegrity", d.scores?.signal_integrity, true);


        // Four Bands with deltas
        const arrow = () => '▲';


        const updateBand = (id, key) => {
            if (typeof bands[key] !== 'number') {
                set(id, '-- dB');
                return;
            }

            const curr = bands[key];
            const prev = this._prevBands[key];
            const sym = arrow();

            set(id, `${curr.toFixed(1)} dB ${sym}`);
            this._prevBands[key] = curr;
        };

        updateBand('sessBass',   'bass');
        updateBand('sessMid',    'mid');
        updateBand('sessTreble', 'treble');
        updateBand('sessAir',    'air');

        
    }

    /* ============================================================
    DETAILED BAND ANALYSIS (Bass / Mid / Treble / Air)
    ============================================================ */
    updateDetailedAnalysis() {
        if (!document.getElementById('bandBass')) return;

        const data = this.currentData || {};

        /* -------------------------- 
        1) Try band_levels_db FIRST
        -------------------------- */
        if (data.band_levels_db) {
            const b = data.band_levels_db;

            const bass   = (b.bass           ?? b.bass_20_200       ?? 0).toFixed(1);
            const mid    = (b.mid            ?? b.mid_200_2k        ?? 0).toFixed(1);
            const treble = (b.treble         ?? b.treble_2k_10k     ?? 0).toFixed(1);
            const air    = (b.air            ?? b.air_10k_20k       ?? 0).toFixed(1);

            document.getElementById("bandBass").textContent   = `${bass} dB`;
            document.getElementById("bandMid").textContent    = `${mid} dB`;
            document.getElementById("bandTreble").textContent = `${treble} dB`;
            document.getElementById("bandAir").textContent    = `${air} dB`;

            const norm = v => `${Math.max(0, Math.min(100, ((parseFloat(v) + 20) / 40) * 100))}%`;

            const bassBar = document.getElementById('bassBar');
            const midBar = document.getElementById('midBar');
            const trebleBar = document.getElementById('trebleBar');
            const airBar = document.getElementById('airBar');

            if (bassBar)   bassBar.style.width   = norm(bass);
            if (midBar)    midBar.style.width    = norm(mid);
            if (trebleBar) trebleBar.style.width = norm(treble);
            if (airBar)    airBar.style.width    = norm(air);

            return;
        }

        /* --------------------------
        2) No band_levels_db?
            → CALCULATE IT OURSELVES
        -------------------------- */
        const fhz = data.freq_hz;
        const mag = data.mag_db;

        if (!fhz || !mag || fhz.length !== mag.length) {
            // FINAL HARD FALLBACK (no data at all)
            document.getElementById('bassLevel').textContent   = `0.0 dB`;
            document.getElementById('midLevel').textContent    = `0.0 dB`;
            document.getElementById('trebleLevel').textContent = `0.0 dB`;
            document.getElementById('airLevel').textContent    = `0.0 dB`;

            document.getElementById('bassBar').style.width   = '50%';
            document.getElementById('midBar').style.width    = '50%';
            document.getElementById('trebleBar').style.width = '50%';
            document.getElementById('airBar').style.width    = '50%';
            return;
        }

        /* --------------------------
        3) Raw fallback calculation
        -------------------------- */
        let bSum=0,bCnt=0,mSum=0,mCnt=0,tSum=0,tCnt=0,aSum=0,aCnt=0;

        for (let i=0;i<fhz.length;i++){
            const f = fhz[i], v = mag[i];
            if (f>=20 && f<=200){ bSum+=v; bCnt++; }
            else if (f>200 && f<=2000){ mSum+=v; mCnt++; }
            else if (f>2000 && f<=10000){ tSum+=v; tCnt++; }
            else if (f>10000 && f<=20000){ aSum+=v; aCnt++; }
        }

        const bass   = (bCnt? bSum/bCnt : 0).toFixed(1);
        const mid    = (mCnt? mSum/mCnt : 0).toFixed(1);
        const treble = (tCnt? tSum/tCnt : 0).toFixed(1);
        const air    = (aCnt? aSum/aCnt : 0).toFixed(1);

        document.getElementById('bassLevel').textContent   = `${bass} dB`;
        document.getElementById('midLevel').textContent    = `${mid} dB`;
        document.getElementById('trebleLevel').textContent = `${treble} dB`;
        document.getElementById('airLevel').textContent    = `${air} dB`;

        const norm = v => `${Math.max(0, Math.min(100, ((parseFloat(v) + 20) / 40) * 100))}%`;

        document.getElementById('bassBar').style.width   = norm(bass);
        document.getElementById('midBar').style.width    = norm(mid);
        document.getElementById('trebleBar').style.width = norm(treble);
        document.getElementById('airBar').style.width    = norm(air);
    }

    updateDetailedAnalysisStandalone(data) {
        const prev = this.currentData;
        this.currentData = data;

        this.updateDetailedAnalysis();

        this.currentData = prev;
    }

    /* ============================================================
    SAVE RESULTS (JSON Download)
    ============================================================ */
    saveResults() {
        if (!this.currentData) {
            this.showError('No data to save');
            return;
        }

        const dataStr = JSON.stringify(this.currentData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const fileName = `measurely_results_${new Date()
            .toISOString()
            .slice(0,19)
            .replace(/:/g,'-')}.json`;

        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        URL.revokeObjectURL(url);
        this.showSuccess('Results saved successfully');
    }

    /* ============================================================
    EXPORT REPORT (Placeholder)
    ============================================================ */
    exportReport() {
        // On GitHub Pages, server-side report generation is unavailable.
        // Prompt the user to use the browser share card instead.
        if (window.toast) window.toast("Report export is only available when connected to your local Measurely server.", "info");
        console.info('[exportReport] Server not available on static hosting.');
    }


    /* ============================================================
    LOADING STATE FOR SCORE CARDS
    ============================================================ */
    showLoadingState() {
        const ids = [
            'overallScore','bandwidthScore','balanceScore','smoothnessScore',
            'peaksDipsScore','reflectionsScore','signalIntegrityScore'
        ];

        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '--';
        });
    }

    /* ============================================================
    POLLING FOR DEVICE STATUS
    ============================================================ */
    startPolling() {
        // Skip polling entirely on static hosting — no Pi to query
        if (isStaticHosting()) {
            this.deviceStatus = { ready: true, mode: 'web',
                mic: { connected: true, name: 'browser' },
                dac: { connected: true, name: 'browser' } };
            this.updateDeviceStatusDisplay();
            return;
        }
        this.updateInterval = setInterval(async () => {
            try {
                await this.updateDeviceStatus();
            } catch (err) {
                console.error('Device polling error:', err);
            }
        }, 5000);
    }

    async updateDeviceStatus() {
        // Only reached when running against a Pi (isStaticHosting() is false)
        try {
            const res = await fetch('/api/status');
            if (!res.ok) throw new Error('no status');
            this.deviceStatus = await res.json();
        } catch {
            this.deviceStatus = {
                ready: true, mode: 'web',
                mic: { connected: true, name: 'browser' },
                dac: { connected: true, name: 'browser' },
            };
        }
        this.updateDeviceStatusDisplay();
    }

    updateDeviceStatusDisplay() {
        const s = this.deviceStatus;
        if (!s) return;

        /* -------------------------------------------
        SYSTEM READY
        ------------------------------------------- */
        const sysDot = document.getElementById('systemReadyDot');
        const sysTxt = document.getElementById('systemReadyText');

        if (sysDot && sysTxt) {
            if (s.ready) {
                sysDot.className = "status-indicator bg-excellent";
                sysTxt.textContent = "System Ready";
            } else {
                sysDot.className = "status-indicator bg-poor";
                sysTxt.textContent = "System Check Required";
            }
        }

        /* -------------------------------------------
        DAC CONNECTED
        ------------------------------------------- */
        const dacDot = document.getElementById('dacStatusDot');
        const dacTxt = document.getElementById('dacStatusText');

        if (dacDot && dacTxt) {
            dacDot.className = "status-indicator " + (s.dac?.connected ? "bg-excellent" : "bg-poor");
            dacTxt.textContent = s.dac?.connected ? "DAC: Connected" : "DAC: Not Found";

        }

        /* -------------------------------------------
        USB MIC CONNECTED
        ------------------------------------------- */
        const micOk = s?.mic?.connected;
        const usbDot = document.getElementById('usbStatusDot');
        const usbTxt = document.getElementById('usbStatusText');

        if (usbDot && usbTxt) {
             usbDot.className = "status-indicator " + (s.mic?.connected ? "bg-excellent" : "bg-poor");
             usbTxt.textContent = micOk
                 ? "USB Mic: Connected" 
                 : "USB Mic: Not Connected";
        }
    }


    /* ============================================================
    LOAD SESSION BY INDEX (NEWEST → OLDEST, EXACT MATCH)
    ============================================================ */
    async loadNthSession(n) {
        // always allow loading sessions
 
        try {
            console.log(`📦 Loading session index: ${n}`);


            // Fetch all uploads
            const all = CAPS.history
                ? (window.MeasurelySessions
                    ? await window.MeasurelySessions.loadSessions()
                    : await fetch('/api/sessions/all').then(r => r.json()).catch(() => []))
                : [];

            const extractNum = (val) => {
                const m = String(val).match(/(\d+)(?!.*\d)/);
                return m ? parseInt(m[1], 10) : 0;
            };

            // Order newest → oldest & REMOVE upload0 if others exist
            const sorted = all
                .slice()
                .sort((a, b) => extractNum(b.id) - extractNum(a.id))
                .filter((s) => !(extractNum(s.id) === 0 && all.length > 1));

            console.warn("🔹 upload ORDER:", sorted.map(s => s.id));

            if (!sorted.length) return this.showError("No uploads found");
            if (n >= sorted.length) return this.showError("Not enough uploads");

            const sessionId = sorted[n].id;
            console.log(`📂 Fetching upload → ${sessionId}`);

            const data = await fetch(`/api/session/${encodeURIComponent(sessionId)}`)
                .then(r => r.json());

            if (!data || data.error) {
                console.error("❌ Invalid upload:", data);
                return this.showError("upload load failed");
            }

            this.currentData = data; // required for notes save
            this.updateFrequencyChartMulti();

            // Restore saved note to modal
            const note = (data.analysis_notes?.[0] || data.notes || "").trim();
            const textarea = document.getElementById("notesTextarea");
            if (textarea) {
                textarea.value = note;
                textarea.style.opacity = note ? "1" : "0.3";
                console.log(`📝 Restored note for ${sessionId}:`, note);
            }

            await this.loadHistory();

            // Highlight correct button
            const btns = document.querySelectorAll("#uploadsNav button");
            btns.forEach(b => b.classList.remove("session-active"));
            if (btns[n]) btns[n].classList.add("session-active");

            const tag = ["Latest", "Previous", "Earlier", "Oldest"][n] || "upload";
            this.showSuccess(`Loaded ${tag}`);

        } catch (err) {
            console.error("❌ loadNthSession error:", err);
            this.showError("Error loading upload");
        }
    }


    /* ============================================================
    EVENT LISTENERS — SAFE ON ALL PAGES
    ============================================================ */
    setupEventListeners() {

        if (!CAPS.notes) {
            document.querySelectorAll('[data-sweep-note]').forEach(b => b.remove());
        }

        const safe = (id, handler) => {
            const el = document.getElementById(id);
            if (!el) {
                console.warn(`[WARN] Missing element for listener: ${id}`);
                return;
            }
            el.addEventListener('click', handler);
        };

        // Metric / analysis-card trigger buttons
        // The sidebar uses .analysis-card-trigger[data-overlay] — wire those
        setTimeout(() => {
            const metricButtons = document.querySelectorAll(".analysis-card-trigger[data-overlay]");

            if (!metricButtons.length) {
                // Silently skip — this dashboard view may not include the analysis sidebar
                return;
            }

            metricButtons.forEach(btn => {
                btn.addEventListener("click", () => {
                    metricButtons.forEach(b => b.classList.remove("active"));
                    btn.classList.add("active");

                    this.activeMetricOverlay = btn.dataset.overlay;
                    this.updateFrequencyChartMulti();
                });
            });

        }, 0);


        safe('saveNotesBtn', async () => {

            if (!CAPS.notes) return;

            const textarea = document.getElementById("notesTextarea");
            const note = textarea ? textarea.value.trim() : "";

            // Determine correct upload ID from currently displayed session
            const uploadId = this.currentData?.id;
            if (!uploadId || uploadId === "latest") {
                console.error("❌ Cannot resolve real upload ID from currentData.id:", this.currentData?.id);
                this.showError("Cannot save note – invalid upload ID");
                return;
            }

            console.log(`💾 Saving note for ${uploadId}:`, note);

            await this.saveNote(uploadId, note);

            // Update preview on the correct upload card
            document.querySelectorAll(".uploads-card").forEach(card => {
                if (card.dataset.uploadId === uploadId) {
                    const preview = card.querySelector("[data-note-preview]");
                    if (preview) preview.textContent = note || "—";
                }
            });

            if (typeof closeNotesModal === "function") {
                closeNotesModal();
            }

            this.showSuccess("Note saved!");
        });


        const nav = document.getElementById(UI.navId)
        || document.getElementById("uploadsNav")
        || document.getElementById("sweepsNav");

        if (nav) {
        nav.querySelectorAll(".session-btn").forEach(btn => {
            const index =
            Number(btn.dataset.uploads ?? btn.dataset.sweeps ?? btn.dataset.session ?? 0);

            btn.addEventListener("click", () => {
            // Toggle ON
            if (!this.activeChartSessions.has(index)) {
                this.activeChartSessions.add(index);
                btn.classList.add("session-active");
            } else {
                // Toggle OFF (but never allow all off)
                if (this.activeChartSessions.size === 1) return;
                this.activeChartSessions.delete(index);
                btn.classList.remove("session-active");
            }

            this.updateFrequencyChartMulti();
            });
        });
        }

       
    }


    /* ============================================================
     TOAST MESSAGES
    ============================================================ */
    
    showMessage(msg, type = 'info') {
        const toast = document.createElement('div');

        const colour =
            type === 'error'   ? 'bg-red-600 text-white'
        : type === 'success' ? 'bg-green-600 text-white'
                            : 'bg-blue-600 text-white';

        toast.className = `
            fixed top-4 right-4 z-50
            px-4 py-3 rounded-lg shadow-lg
            transition-all duration-300 ease-out
            transform translate-x-full opacity-0
            ${colour}
        `;

        toast.textContent = msg;
        document.body.appendChild(toast);

        // Slide in
        requestAnimationFrame(() => {
            toast.classList.remove('translate-x-full', 'opacity-0');
            toast.classList.add('translate-x-0', 'opacity-100');
        });

        // Slide out
        setTimeout(() => {
            toast.classList.remove('translate-x-0', 'opacity-100');
            toast.classList.add('translate-x-full', 'opacity-0');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    showError(msg)   { this.showMessage(msg, 'error'); }
    showSuccess(msg) { this.showMessage(msg, 'success'); }
    showInfo(msg)    { this.showMessage(msg, 'info'); }
}

function showSweepProgress() {
    console.log("[SweepUI] showSweepProgress() called");

    const modal   = document.getElementById("sweepProgressModal");
    const fill    = document.getElementById("sweepProgressFill");
    const percent = document.getElementById("sweepPercent");
    const stage   = document.getElementById("sweepStageText");

    console.log("[SweepUI] Elements found:", {
        modal: !!modal,
        fill: !!fill,
        percent: !!percent,
        stage: !!stage
    });

    if (!modal || !fill || !percent || !stage) {
        console.error("[SweepUI] ❌ Required progress elements missing");
        return null;
    }

    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    console.log("[SweepUI] ✅ Modal opened");

    fill.style.width = "0%";
    percent.textContent = "0%";
    stage.textContent = "Starting measurement…";

    return {
        update(progress, message) {
            console.log("[SweepUI] update()", { progress, message });

            if (typeof progress === "number") {
                const p = Math.max(0, Math.min(100, progress));
                fill.style.width = `${p}%`;
                percent.textContent = `${p}%`;
            }

            if (message) {
                stage.textContent = message;
            }
        },

        complete() {
            console.log("[SweepUI] Sweep finished — waiting for analysis");

            fill.style.width = "100%";
            percent.textContent = "100%";
            stage.textContent = "Finalising analysis…";

        },
        
        showAnalysis(data) {
            console.log("[SweepUI] Showing analysis data in modal", data);

            const logPanel = document.getElementById("sweepLogPanel");
            if (!logPanel) return;

            const a = data.analysis || data;

            logPanel.innerHTML += `
        <hr style="opacity:0.2;margin:10px 0;">
        <b>Analysis Summary</b>

        SNR: ${a.signal?.snr_db?.toFixed(2)} dB  
        Peak Level: ${a.signal?.peak?.toFixed(4)}

        Bandwidth: ${a.bandwidth?.low_hz?.toFixed(1)} – ${a.bandwidth?.high_hz?.toFixed(1)} Hz  
        Balance Spread: ${a.balance?.spread_db?.toFixed(2)} dB  
        Smoothness σ: ${a.smoothness?.std_db?.toFixed(2)}

        Modes Found: ${a.modes?.length || 0}  
        First Reflection: ${a.reflections?.first_ms?.toFixed(2)} ms  

        Schroeder: ${a.acoustics?.schroeder_hz?.toFixed(1)} Hz  
        SBIR Nulls: ${a.acoustics?.sbir_nulls?.map(n=>n.toFixed(1)).join(", ")}
        `;

            stage.textContent = "Analysis complete";
        },


        close() {
            console.log("[SweepUI] Closing modal after analysis");
            modal.classList.add("hidden");
            modal.setAttribute("aria-hidden", "true");
        },

        error(msg = "Sweep failed") {
            console.log("[SweepUI] error()", msg);
            stage.textContent = msg;
            fill.style.width = "100%";
            percent.textContent = "!";
        }
    };
}