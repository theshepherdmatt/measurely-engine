# Measurely Scoring Pipeline — Tier 2 (Measured) Reference

How a REW WAV upload becomes six 1–10 scores. This is the measured path used by
`measurely-web`. It describes what the code actually does, in plain language, so it
can be relied on for support, copy, and outreach without re-reading the source.

**Where the code lives:** the **scoring math** is in the engine submodule at
`engine/js/engine/` — shared byte-for-byte between `measurely-web` and the
`measurely-engine` source-of-truth checkout. Key files: `fileLoader.js`, `fft.js`,
`signal_math.js`, `analyse.js`, `score.js`. The **orchestration around it** (upload
modal, REW HTTP wrapper, PocketBase sync) lives in `measurely-web` — this doc covers
both, even though it sits in the engine repo, because the user-facing pipeline is
only meaningful end-to-end. The retail Shopify app is Tier 1 only and never runs any
of this.

**Important:** everything runs in the user's browser. There is no server-side analysis
in the live path. A Cloudflare Worker exposing `POST /analyse` exists in the repo
(`engine/worker.js`) but is not wired to any page — it is a parallel artefact, not the
live pipeline.

---

## 1. What the upload accepts

The expected input is an **impulse-response WAV that REW has already produced** — i.e.
the user has run their sweep in REW and exported the IR. There are three ways in, all
converging on the same engine call:

- **Manual upload** — two file slots, Left and Right, each a separate mono WAV. Both
  must be filled before the Analyse button enables.
- **REW HTTP API** — pulls an IR straight from REW running on the user's machine
  (`localhost:4735`), via `js/rew-api.js`.
- **Demo** — fetches two hosted "ideal" WAVs so a visitor can see a result without
  measuring anything.

**Measurely does not deconvolve a sweep.** It assumes the WAV is already an impulse
response. If a user exports a raw sweep recording instead of the IR, the validity gate
(below) is meant to reject it, and the error message tells them to run it through REW's
deconvolution first. This is by design, not a missing feature.

**Validity gate** (`analyse.js`, `assessValidity`): after decoding, the IR is checked for
(a) not empty, (b) a real peak present, (c) signal-to-noise ≥ 10 dB, and (d) at least
half the energy sitting in the 100 ms after the main transient — the "does this actually
look like an impulse response" test that rejects music, speech, or an undeconvolved
sweep. Only that last failure ("not an impulse response") is a hard stop at the upload
screen; the other three flow through but return an invalid result with blank scores.

**Two known input quirks:**
- **Stereo files are silently reduced to the left channel only.** The modal asks for two
  separate mono files (L and R), but if someone feeds in a single stereo file, only
  channel 0 is read. They won't be warned.
- **No file-size or sample-rate limit in code.** Whatever the browser's audio decoder
  accepts is processed. The code has been hardened against very large files (96k/192k),
  so length is tolerated rather than capped.

---

## 2. WAV → frequency response

No external DSP library — this is hand-written JavaScript.

1. **Decode to mono.** The WAV is decoded via the browser's Web Audio API to a single
   channel of float samples. The sample rate is taken from the file as-is; nothing is
   resampled. Any bad (NaN/Inf) samples are zeroed.
2. **FFT to magnitude.** The IR is zero-padded to the next power of two and run through a
   hand-coded real FFT. Each frequency bin is converted to a magnitude in decibels. This
   produces the raw, linear-frequency response.
3. **Log-binning.** The linear response is re-spaced onto a logarithmic axis from 20 Hz
   to 20 kHz, at **two resolutions**:
   - **48 points per octave** — the fine curve used for the on-screen plot.
   - **12 points per octave** — a deliberately coarser curve used for *scoring*. The
     coarser axis exists because scoring on the fine curve treated every tiny ripple as a
     separate room mode.
4. **Smoothing (display only).** A light 9-point moving average is applied to the
   on-screen curve. The scoring curve is left unsmoothed.

**Microphone calibration: none (as of May 2026).** Earlier code applied an
"Omnitronic MM-2" correction — a leftover from the rental-kit era when Measurely ran the
sweep itself with a known mic. That correction lifted 10–20 kHz by up to 6 dB. Because a
REW export is already mic-corrected by REW, applying it again double-corrected the top
end and skewed Bandwidth, Balance and Smoothness. **This was removed for the upload
path:** uploads are now read as-is, with no mic lift applied to either curve. The
calibration function still exists in the engine but is a no-op on this path.

There is **no windowing** of the IR before the FFT, and **no tail-gating** in code.

---

## 3. Room-mode detection

Modes are found from the **measured curve**, not predicted from room dimensions. (Room
geometry *is* used for the predictive Tier 1 model, but that prediction is not what the
measured-path mode list comes from.)

The method, on the coarse 12-points-per-octave curve: take a moving average over roughly
a 3/4-octave window, then flag any point that sits **4 dB or more** above or below that
local average as a peak or a dip, requiring detections to be at least 10 Hz apart. The
result is a list of `{peak or dip, frequency, deviation in dB}`.

Detected modes are then **filtered to below 1 kHz** — only low-frequency features carry
through to scoring. The 3/4-octave window width was tuned empirically against a test
spectrum (narrower windows missed real features).

---

## 4. The six scores

The six pillars the user sees: **Peaks & Dips, Reflections, Bandwidth, Balance,
Smoothness, Clarity.** All are computed in the browser, rounded to one decimal, and
clamped to 0–10. A pillar returns a blank (not zero) when its input is missing — e.g. a
perfectly flat trace with no peaks produces no Peaks & Dips score rather than a 10.

### Peaks & Dips
Driven by the **single worst** peak or dip in the filtered mode list. The bigger the
largest deviation, the lower the score — a smooth ladder from 10 (worst deviation under
2 dB) down to 1 (12 dB or more). Note: only the worst single feature matters. Ten 5 dB
peaks score the same as one 5 dB peak; count and frequency are not weighted in.

### Reflections
Driven by the timing of early reflections in the 20 ms after the main impulse peak. A
`> 0.5 ms` filter is applied to the detected peaks before scoring — this is what stops
the direct sound itself from being counted as the "earliest reflection." Without it,
every measurement would score 4.0. The score is a **coarse three-step ladder** on the
*earliest* surviving reflection:
- earliest under 1 ms → 4.0
- earliest under 5 ms → 6.5
- otherwise → 9.0

So on the WAV-upload path this pillar can only ever be **4.0, 6.5, 9.0, or blank** — three
real values. The on-screen "1–10" framing is coarser in practice than it looks. (The REW
Pro path computes this differently — see §5.)

### Bandwidth
How much usable frequency range the room passes. A reference level is taken from the
500–2000 Hz region; the low and high −3 dB roll-off points are found relative to it.
- Low end: full marks below ~40 Hz, sliding down toward 1 by ~150 Hz.
- High end: full marks above ~18 kHz, sliding down below ~12 kHz.
- Final score is the **worse of the two ends.**

### Balance
Whether bass, mids, treble and "air" are in proportion. The curve is split into four
bands (bass 20–200, mid 200–2000, treble 2000–10000, air 10000–20000 Hz). For non-studio
rooms a gentle target curve (a Harman-style bass shelf and treble tilt) is subtracted
first; studios are measured against flat. The score is driven by the **spread** between
the loudest and quietest band after that correction — 2 dB spread or less scores 10, and
it falls to a floor of 4 by 8 dB spread.

### Smoothness
How even the response is. A moving average is subtracted from the curve and the standard
deviation of what's left (in dB) is measured. 0 dB of residual ripple → 10; 8 dB or more
→ 0, linearly between.

### Clarity
**Not an independent measurement** — a composite of the reflection and smoothness data.
Starts at 10 and subtracts penalties for: an early first reflection, a high density of
reflections within 5 ms, and high residual ripple (the same value Smoothness uses).
Returns blank if there are no reflections or smoothness couldn't be computed.

### Two post-scoring adjustments
- **Studio desk penalty.** If the room is a studio *and* a desk is present, Reflections
  is reduced by 1.5 and Clarity by 1.0 (floored at 0), to reflect desk-bounce.
- **Overall score.** The plain average of whichever of the six pillars produced a number
  (blanks excluded), then capped by signal quality: very poor SNR voids the overall
  score; mediocre SNR caps it at 6.5.

---

## 5. REW Pro path differs on two scores

When the input comes from **REW Pro and includes RT60 decay data**, two of the six scores
are **overwritten** with values derived from RT60 instead of the impulse-response method
above:
- **Clarity** is taken from EDT (early decay time) at 500/1000/2000 Hz.
- **Reflections** is taken from T30 at 63/125/250 Hz.

**Consequence:** the same physical room measured via plain WAV upload versus via REW Pro
with RT60 can return **different Clarity and Reflections scores**, because two different
formulas are in play. The other four pillars are computed identically on both paths.

---

## 6. Output — what gets stored

The pipeline produces three things in memory:
- **`analysis`** — the full verbose object: the curve, band levels, bandwidth points,
  smoothness figure, mode list, reflection times, signal-integrity, the six scores, room
  context. (This is the in-memory equivalent of the old `analysis.json`.)
- **`ai`** — a slim summary: scores, bands, bandwidth, smoothness, first five
  reflections, signal integrity, room context. (Equivalent of the old `analysis_ai.json`
  — the "ai" is just a legacy key name, not a separate process.)
- **`reportCurve`** — the smooth 48-points-per-octave display curve, capped at 18 kHz.
  (Equivalent of the old `report_curve.json`.)

The result is then written to the 3D engine (to draw the measured curve), kept in the
browser's local storage (most recent 20 sessions), and synced to PocketBase. The
PocketBase `sessions` collection stores: `session_id`, `label`, `timestamp`,
`overall_score`, `has_analysis`, `analysis` (full object), `report_curve` (curve),
`room_modes`, `schroeder_freq`, `sbir_null`, `scores` (the six pillars). **No raw IR or
WAV is uploaded anywhere** — only the derived analysis leaves the browser.

---

## 7. Known limitations (be honest about these)

These are real characteristics of the current code, worth knowing before describing the
tool to a measurement-literate audience:

1. **Reflections is effectively a 4-value score on the WAV path** (4.0 / 6.5 / 9.0 /
   blank). Two visibly different rooms can land on the same value.
2. **Peaks & Dips ignores everything but the single worst feature.** Number and spread of
   problems don't factor in.
3. **Clarity and Reflections can differ between the WAV-upload and REW-Pro paths** for the
   same room, because they use different formulas (§5).
4. **Stereo uploads silently use the left channel only.**
5. **No deconvolution** — a raw sweep recording will be rejected, not processed; the user
   must export the IR from REW.

---

*Source of truth for scoring: `engine/js/engine/score.js` and `signal_math.js`. If those
change, this doc is stale — re-derive from the code. Last reconciled against an engine
audit in May 2026, reflecting the removal of mic calibration on the upload path.*
