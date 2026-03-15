/* section-intro.js
   Lightweight IIFE that shows a single full-page blurred modal before each
   wizard section and on first dashboard visit.  Replaces the 19-step tooltip
   tour with one clear descriptor per section — tell the user what they're
   about to configure, then get out of the way.

   Public API (window.SectionIntro):
     show(key)   — show the modal for <key> if not already seen this session
     reset()     — clear all localStorage flags (dev / testing helper)
*/
(function () {
  'use strict';

  /* ── Storage ──────────────────────────────────────────── */
  const LS_PREFIX = 'mly_intro_v2_';

  /* ── SVG icon templates ───────────────────────────────── */
  const _icon = (path) =>
    `<svg width="40" height="40" viewBox="0 0 40 40" fill="none" ` +
    `xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${path}</svg>`;

  const ICONS = {
    house: _icon(
      `<path d="M7 21 L20 9 L33 21 V35 A1 1 0 0 1 32 36 H8 A1 1 0 0 1 7 35 Z" ` +
      `stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/>` +
      `<rect x="15" y="27" width="10" height="9" rx="2" ` +
      `stroke="currentColor" stroke-width="2" fill="none"/>`
    ),
    dims: _icon(
      `<rect x="5" y="5" width="30" height="30" rx="3" ` +
      `stroke="currentColor" stroke-width="2" fill="none"/>` +
      `<line x1="5" y1="20" x2="35" y2="20" stroke="currentColor" ` +
      `stroke-width="1.5" stroke-dasharray="3 3" opacity="0.45"/>` +
      `<line x1="20" y1="5" x2="20" y2="35" stroke="currentColor" ` +
      `stroke-width="1.5" stroke-dasharray="3 3" opacity="0.45"/>` +
      `<path d="M9 9 V13 M9 9 H13" stroke="currentColor" ` +
      `stroke-width="2" stroke-linecap="round"/>` +
      `<path d="M31 31 V27 M31 31 H27" stroke="currentColor" ` +
      `stroke-width="2" stroke-linecap="round"/>`
    ),
    speaker: _icon(
      `<rect x="14" y="4" width="12" height="32" rx="3" ` +
      `stroke="currentColor" stroke-width="2" fill="none"/>` +
      `<circle cx="20" cy="13" r="3.5" ` +
      `stroke="currentColor" stroke-width="2" fill="none"/>` +
      `<circle cx="20" cy="28" r="2.5" ` +
      `stroke="currentColor" stroke-width="2" fill="none"/>` +
      `<circle cx="20" cy="28" r="0.8" fill="currentColor"/>`
    ),
    sofa: _icon(
      `<path d="M9 34 V27 H31 V34" ` +
      `stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/>` +
      `<path d="M11 27 V22 H29 V27" ` +
      `stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/>` +
      `<path d="M5 34 H35" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>` +
      `<path d="M9 30 H6 V26 Q6 23 9 23" ` +
      `stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>` +
      `<path d="M31 30 H34 V26 Q34 23 31 23" ` +
      `stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>`
    ),
    chart: _icon(
      `<rect x="5" y="5" width="30" height="30" rx="4" ` +
      `stroke="currentColor" stroke-width="2" fill="none"/>` +
      `<path d="M11 30 V22 M20 30 V14 M29 30 V19" ` +
      `stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>`
    ),
  };

  /* ── Section definitions ──────────────────────────────── */
  const INTROS = {
    use: {
      icon:  ICONS.house,
      title: 'What\'s your setup?',
      body:  'Pick your room type and speaker format. This one choice shapes ' +
             'the 3D model, furniture, and all the defaults — get it right and ' +
             'everything else falls into place.',
      cta:   'Begin setup →',
    },
    dimensions: {
      icon:  ICONS.dims,
      title: 'Room Dimensions',
      body:  'Length, width, and ceiling height define your room\'s acoustic ' +
             'fingerprint. Accurate measurements mean better predictions — ' +
             'grab a tape measure if you can.',
      cta:   'Start measuring →',
    },
    speakers: {
      icon:  ICONS.speaker,
      title: 'Speaker Placement',
      body:  'Where your speakers live determines bass build-up, stereo imaging, ' +
             'and early reflections. Distance from the front wall matters most. ' +
             'Take a few minutes here — it\'s worth it.',
      cta:   'Got it →',
    },
    furniture: {
      icon:  ICONS.sofa,
      title: 'Surfaces & Furnishings',
      body:  'Your floor, soft furnishings, and acoustic treatment all shape ' +
             'how the room sounds. A few honest answers here sharpen every ' +
             'score on your dashboard.',
      cta:   'Got it →',
    },
    dashboard: {
      icon:  ICONS.chart,
      title: 'Your Dashboard',
      body:  'Your room model is ready. Upload a REW sweep measurement to get ' +
             'your acoustic scores, or explore the analysis cards and 3D diagram below.',
      cta:   'Let\'s go →',
    },
  };

  /* ── DOM ──────────────────────────────────────────────── */
  let _el = null;

  function _inject() {
    const d = document.createElement('div');
    d.id = 'sectionIntroBackdrop';
    d.className = 'section-intro-backdrop';
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-modal', 'true');
    d.setAttribute('aria-labelledby', 'sectionIntroTitle');
    d.innerHTML =
      `<div class="section-intro-card">` +
        `<div class="section-intro-icon-wrap" id="sectionIntroIcon"></div>` +
        `<h2 class="section-intro-title" id="sectionIntroTitle"></h2>` +
        `<p  class="section-intro-body"  id="sectionIntroBody"></p>` +
        `<button id="sectionIntroCta" class="btn btn-primary section-intro-cta"></button>` +
      `</div>`;
    document.body.appendChild(d);
    _el = d;
    document.getElementById('sectionIntroCta').addEventListener('click', _close);
  }

  function _close() {
    if (!_el) return;
    _el.classList.remove('open');
    document.body.classList.remove('intro-open');
    _el.addEventListener('transitionend', () => {
      if (_el && !_el.classList.contains('open')) _el.style.display = 'none';
    }, { once: true });
  }

  /* ── Public ───────────────────────────────────────────── */
  function show(key) {
    const intro = INTROS[key];
    if (!intro) return;
    if (localStorage.getItem(LS_PREFIX + key)) return;   // already seen
    localStorage.setItem(LS_PREFIX + key, '1');

    if (!_el) _inject();

    document.getElementById('sectionIntroIcon').innerHTML = intro.icon;
    document.getElementById('sectionIntroTitle').textContent = intro.title;
    document.getElementById('sectionIntroBody').textContent  = intro.body;
    document.getElementById('sectionIntroCta').textContent   = intro.cta;

    _el.style.display = 'flex';
    document.body.classList.add('intro-open');
    // Double rAF ensures display:flex is applied before the open class triggers transitions
    requestAnimationFrame(() => requestAnimationFrame(() => _el.classList.add('open')));
  }

  function reset() {
    Object.keys(INTROS).forEach(k => localStorage.removeItem(LS_PREFIX + k));
  }

  window.SectionIntro = { show, reset };
}());
