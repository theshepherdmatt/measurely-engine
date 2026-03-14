// js/dashboard-tour.js

export const dashboardStyles = {
  options: {
    arrowColor: "#1e293b",
    backgroundColor: "#1e293b",
    overlayColor: "rgba(0, 0, 0, 0.55)",
    primaryColor: "#6366f1",
    textColor: "#e2e8f0",
    width: 360,
    zIndex: 99999,
  },
  tooltip: {
    backgroundColor: "#1e293b",
    borderRadius: "16px",
    border: "1px solid rgba(255,255,255,0.10)",
    boxShadow: "0 24px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(99,102,241,0.15)",
    padding: "20px 22px",
    fontFamily: "inherit",
  },
  tooltipContainer: {
    textAlign: "left",
  },
  tooltipTitle: {
    color: "#f8fafc",
    fontSize: "15px",
    fontWeight: "700",
    marginBottom: "8px",
    lineHeight: "1.3",
  },
  tooltipContent: {
    color: "#cbd5e1",
    fontSize: "13.5px",
    lineHeight: "1.65",
    padding: "0",
  },
  tooltipFooter: {
    marginTop: "16px",
    paddingTop: "0",
  },
  buttonNext: {
    backgroundColor: "#6366f1",
    color: "#ffffff",
    borderRadius: "10px",
    fontSize: "13.5px",
    fontWeight: "600",
    padding: "9px 18px",
    outline: "none",
  },
  buttonBack: {
    color: "#94a3b8",
    fontSize: "13.5px",
    marginRight: "8px",
  },
  buttonSkip: {
    color: "#64748b",
    fontSize: "12.5px",
  },
  buttonClose: {
    color: "#64748b",
  },
};

export const dashboardSteps = [

  // 0 — Dashboard arrival
  {
    target: "body",
    title: "Your room model is ready",
    content: "Room saved. This is your acoustic command centre — every score, chart, and diagram here comes from the measurements and room data you just entered. Let's walk through what it all means.",
    disableBeacon: true,
    placement: "center",
    data: {},
  },

  // 1 — Overall score
  {
    target: ".overall-score-card",
    title: "Your overall room score",
    content: "A single number from 1–10 summing up how well your room behaves acoustically. Below it you'll see how bass, mid, treble, and air are sitting relative to each other. The quote underneath explains what that score means in plain English.",
    placement: "bottom",
    data: {},
  },

  // 2 — Analysis cards
  {
    target: ".analysis-sidebar-menu",
    title: "Dig into the detail",
    content: "Each card covers one acoustic property: Peaks & Dips (SBIR bass cancellation), Reflections (early echo delay), Bandwidth (usable frequency range), Balance (tonal tilt), Smoothness (response variance), and Clarity (late reverb ratio). Click any card to highlight its problem zones in the 3D room diagram.",
    placement: "right",
    data: {},
  },

  // 3 — Room diagram
  {
    target: ".room-diagram-card",
    title: "Room diagram",
    content: "When you click an analysis card, this view highlights where in your room that problem originates — a bass node in the corner, a reflection off the side wall, and so on. The colour overlays are generated from your room dimensions and speaker positions.",
    placement: "left",
    data: {},
  },

  // 4 — Advanced analysis chart
  {
    target: ".nerds-card",
    title: "Advanced frequency analysis",
    content: "The full frequency response plot lives here. Use the session tabs (Latest, Previous, Earlier, Oldest) to compare sweeps over time, and the metric buttons to overlay diagnostic colouring — peaks, balance, reflections — directly onto the curve.",
    placement: "top",
    data: {},
  },

  // 5 — Sweep history
  {
    target: "#uploadsHistoryGrid",
    title: "Sweep history",
    content: "Your last four sweeps are compared side by side. Each card shows the overall score plus all six metrics so you can see at a glance whether recent changes to your room or speaker placement helped. Hit the Notes button on any card to log what you changed.",
    placement: "top",
    data: {},
  },

  // 6 — Run Sweep (conclusion)
  {
    target: "#runSweepBtn",
    title: "You're all set",
    content: "Hit Run Sweep to measure your room and get your first scores. Make sure your mic is connected, the room is quiet, and your speakers are playing at a comfortable volume. Everything you just saw updates the moment the sweep completes.",
    placement: "bottom",
    data: {},
  },

];
