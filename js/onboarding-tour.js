// js/onboarding-tour.js

export const onboardingStyles = {
  options: {
    arrowColor: "#1e293b",
    backgroundColor: "#1e293b",
    overlayColor: "rgba(0, 0, 0, 0.55)",
    primaryColor: "#6366f1",
    textColor: "#e2e8f0",
    width: 340,
    zIndex: 99999,
  },
  tooltip: {
    backgroundColor: "#1e293b",
    borderRadius: "16px",
    border: "1px solid rgba(255,255,255,0.10)",
    boxShadow: "0 24px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(99,102,241,0.15)",
    padding: "18px 20px",
    fontFamily: "inherit",
  },
  tooltipContainer: { textAlign: "left" },
  tooltipTitle: {
    color: "#f8fafc",
    fontSize: "14px",
    fontWeight: "700",
    marginBottom: "7px",
    lineHeight: "1.3",
  },
  tooltipContent: {
    color: "#94a3b8",
    fontSize: "13px",
    lineHeight: "1.65",
    padding: "0",
  },
  tooltipFooter: { marginTop: "14px", paddingTop: "0" },
  buttonNext: {
    backgroundColor: "#6366f1",
    color: "#ffffff",
    borderRadius: "9px",
    fontSize: "13px",
    fontWeight: "600",
    padding: "8px 16px",
    outline: "none",
  },
  buttonBack:  { color: "#64748b", fontSize: "13px", marginRight: "8px" },
  buttonSkip:  { color: "#475569", fontSize: "12px" },
  buttonClose: { color: "#475569" },
};

// Maps wizard page index → first tour step for that page.
// Called by loadStep() via window.syncTourToWizard().
export const wizardToJoyrideStep = {
  1: 6,   // wizard page 1 (speakers)  → step 6  (section intro)
  2: 14,  // wizard page 2 (materials) → step 14 (section intro)
};

export const onboardingSteps = [

  // ── 0 · Welcome ──────────────────────────────────────────────
  {
    target: "body",
    title: "Let's set up your room",
    content: "Measurely builds an acoustic model from three data sets: room dimensions, speaker positions, and surfaces. This tour walks you through each field and explains what it means — adjust values to match your space as you go.",
    disableBeacon: true,
    placement: "center",
    data: {},
  },

  // ── 1 · 3D preview ───────────────────────────────────────────
  {
    target: "#roomCanvas",
    title: "Live 3D model",
    content: "This updates in real time as you enter measurements. Room shape sets the modal frequencies; where you place your speakers affects how bass builds up in the room. Adjust any slider and watch it respond.",
    placement: "top-right",
    data: {},
  },

  // ══ SECTION 1 — ROOM DIMENSIONS (wizard page 0) ══════════════

  // 2 · Room length
  {
    target: "#field-length_m",
    title: "Room length",
    content: "Front wall to back wall — the wall your speakers face. Length sets your lowest axial room mode (speed of sound ÷ 2× length). A 5 m room has a mode at ~34 Hz; longer rooms push modal problems deeper into the sub-bass.",
    placement: "left",
    data: {},
  },

  // 3 · Room width
  {
    target: "#field-width_m",
    title: "Room width",
    content: "Side wall to side wall. Width and length each produce independent modal series — when they share a common factor, modes stack and bass problems compound. Square rooms are the worst case.",
    placement: "left",
    data: {},
  },

  // 4 · Ceiling height
  {
    target: "#field-height_m",
    title: "Ceiling height",
    content: "Floor to ceiling (or the highest point of a slanted/gabled roof). The vertical mode is usually the least troublesome. Ceilings below 2.2 m can cause flutter echo between floor and ceiling.",
    placement: "left",
    data: {},
  },

  // 5 · Ceiling shape — last room field; clicking Next advances wizard
  {
    target: "#field-ceiling_type",
    title: "Ceiling shape",
    content: "Flat, slanted, or gabled ceilings affect room volume and modal distribution. If your ceiling isn't flat, select its type here to reveal further dimensions. Click Next to move on to speaker placement.",
    placement: "left",
    data: { advanceWizard: true },
  },

  // ══ SECTION 2 — SPEAKER PLACEMENT (wizard page 1) ════════════

  // 5 · Section intro — target is the panel heading rendered by loadStep()
  {
    target: "body",
    title: "Section 2 — Speaker placement",
    content: "Where your speakers sit shapes bass response more than anything else. The next seven fields cover spacing, front-wall distance, tweeter height, toe-in, listening distance, and whether you run a subwoofer. Be as accurate as you can.",
    placement: "center",
    data: {},
  },

  // 6 · Listening position offset
  {
    target: "#field-listener_offset_m",
    title: "Listening position offset",
    content: "How far left or right of the room's centre line you sit. Zero is ideal — sitting asymmetrically places your ears at unequal distances from the side walls, producing different bass levels left and right.",
    placement: "left",
    data: {},
  },

  // 7 · Speaker spacing
  {
    target: "#field-spk_spacing_m",
    title: "Speaker spacing",
    content: "Distance between your two speakers (tweeter to tweeter). The equilateral triangle — spacing equals listening distance — is a widely used starting point. Wider spacing can broaden the soundstage but weakens centre fill.",
    placement: "left",
    data: {},
  },

  // 8 · Front wall distance
  {
    target: "#field-spk_front_m",
    title: "Distance from front wall",
    content: "The single most important speaker measurement. This sets the frequency of your first SBIR bass dip: speed of sound ÷ (4 × distance). At 0.3 m that's ~283 Hz — a significant notch. Most speakers benefit from at least 30–50 cm clearance.",
    placement: "left",
    data: {},
  },

  // 9 · Tweeter height
  {
    target: "#field-tweeter_height_m",
    title: "Tweeter height",
    content: "Height of the tweeter from the floor. Aim for ear height when seated — typically 90–105 cm in a listening chair. Tweeters work on-axis; pointing them below your ears causes high-frequency rolloff and degrades stereo imaging.",
    placement: "left",
    data: {},
  },

  // 10 · Toe-in
  {
    target: "#field-toe_in_deg",
    title: "Toe-in angle",
    content: "Degrees each speaker is rotated inward toward your ears. Zero is straight ahead; 30° is pointed directly at you. More toe-in sharpens focus and can reduce first side-wall reflections, but too much narrows the stereo image.",
    placement: "left",
    data: {},
  },

  // 11 · Listening distance
  {
    target: "#field-listener_front_m",
    title: "Listening distance",
    content: "Distance from the speaker plane to your ears. Together with spacing, this defines your listening triangle. Near-field listening reduces room contribution; sitting further back increases reverberant energy.",
    placement: "left",
    data: {},
  },

  // 12 · Subwoofer — last speaker field; clicking Next advances wizard
  {
    target: "#field-subwoofer",
    title: "Subwoofer",
    content: "Enable if you run a subwoofer. This tells Measurely that bass below ~80 Hz comes from a separate source with its own placement — the SBIR and room mode predictions adjust accordingly. Click Next to move on to materials.",
    placement: "left",
    data: { advanceWizard: true },
  },

  // ══ SECTION 3 — MATERIALS & FURNISHINGS (wizard page 2) ══════

  // 13 · Section intro
  {
    target: "body",
    title: "Section 3 — Materials & furnishings",
    content: "Surfaces absorb or reflect early reflections. The next five fields cover your floor, any rugs or soft furniture, and whether you've applied acoustic treatment. Even a few honest answers here meaningfully improves the model.",
    placement: "center",
    data: {},
  },

  // 14 · Floor type
  {
    target: "#field-floor_material",
    title: "Floor type",
    content: "Hard floors (wood, tile, stone) produce a strong floor-bounce reflection arriving 2–4 ms after the direct sound — adding brightness and comb filtering around 2–6 kHz. Carpet attenuates this significantly.",
    placement: "left",
    data: {},
  },

  // 15 · Rug
  {
    target: "#field-opt_area_rug",
    title: "Area rug",
    content: "A rug between the speakers and your seat is one of the cheapest acoustic improvements available. It breaks up the first-reflection floor bounce and reduces comb filtering in the 2–5 kHz region where the ear is most sensitive.",
    placement: "left",
    data: {},
  },

  // 16 · Sofa
  {
    target: "#field-opt_sofa",
    title: "Sofa",
    content: "Soft seating behind the listening position absorbs rear-wall reflections that would otherwise return to your ears 15–25 ms late. It adds broadband absorption, lowering reverb time and improving the Clarity score.",
    placement: "left",
    data: {},
  },

  // 17 · Coffee table
  {
    target: "#field-opt_coffee_table",
    title: "Coffee table",
    content: "A solid surface in the first-reflection path creates an additional early reflection and comb filtering in the midrange. Glass, stone, or metal tables are the worst offenders — a cloth throw makes a measurable difference.",
    placement: "left",
    data: {},
  },

  // 18 · Treatment — last step; clicking Next saves room and goes to dashboard
  {
    target: "#field-ceiling_panel_mode",
    title: "Acoustic treatment",
    content: "If you've applied wall panels, bass traps, or heavy curtains, configure them here. It shifts the model's predictions for early reflections and high-frequency decay — affecting Smoothness, Clarity, and Reflections scores. Click Save & continue — the tour picks up on the dashboard.",
    placement: "left",
    data: { advanceWizard: true },
  },

];
