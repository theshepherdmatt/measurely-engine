/**
 * @measurely/engine — Sidebar Engine
 *
 * Renders and wires the acoustic analysis sidebar for any Measurely 3D room
 * context. Satellites (web, retail, etc.) pick a named preset or pass a custom
 * section list. The engine owns DOM rendering, click → 3D overlay wiring, and
 * score display updates. Dashboard controllers call updateSection() / updateAll()
 * to feed live data in; the engine drives everything else.
 *
 * Usage:
 *   const sidebar = MeasurelySidebar.initSidebar({
 *     mountId:       'analysisSidebarMount',
 *     preset:        'home_hifi',           // or 'studio' | 'retail'
 *     onSectionClick: (id) => { ... }       // called after 3D overlay is set
 *   });
 *
 *   sidebar.updateSection('sbir', 7.2, 'Bass buildup in front corners');
 *   sidebar.updateAll(scores, smoothnessStdDb);
 *
 * UMD — works in browser (window.MeasurelySidebar) and Node (module.exports).
 */

(function (root) {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════════
     SECTION REGISTRY
     Every possible sidebar section. Satellites pick a subset via preset.

     domKey    — stem used to build DOM IDs: ${domKey}Score / Track / Dave
     scoreKey  — key in the backend scores object (snake_case)
     overlay   — string passed to room3D.focusIssue()
  ═══════════════════════════════════════════════════════════════════════ */
  const SECTION_REGISTRY = {

    sbir: {
      id:       'sbir',
      domKey:   'peaksDips',
      scoreKey: 'peaks_dips',
      label:    'Peaks & Dips',
      unit:     'Bass bumps',
      icon:     'icons/mountain.svg',
      overlay:  'sbir',
    },

    side_reflections: {
      id:       'side_reflections',
      domKey:   'reflections',
      scoreKey: 'reflections',
      label:    'Reflections',
      unit:     'Wall bounce',
      icon:     'icons/square-caret-left.svg',
      overlay:  'side_reflections',
    },

    bandwidth: {
      id:       'bandwidth',
      domKey:   'bandwidth',
      scoreKey: 'bandwidth',
      label:    'Bandwidth',
      unit:     'Usable range',
      icon:     'icons/signal.svg',
      overlay:  'bandwidth',
    },

    balance: {
      id:       'balance',
      domKey:   'balance',
      scoreKey: 'balance',
      label:    'Balance',
      unit:     'Bass to treble',
      icon:     'icons/balance-scale.svg',
      overlay:  'balance',
    },

    smoothness: {
      id:       'smoothness',
      domKey:   'smoothness',
      scoreKey: 'smoothness',
      label:    'Smoothness',
      unit:     'Consistency',
      icon:     'icons/wave-square.svg',
      overlay:  'smoothness',
    },

    clarity: {
      id:       'clarity',
      domKey:   'clarity',
      scoreKey: 'clarity',
      label:    'Clarity',
      unit:     'Direct sound',
      icon:     'icons/clock.svg',
      overlay:  'clarity',
    },

  };

  /* ═══════════════════════════════════════════════════════════════════════
     NAMED PRESETS
     Pick the sections that make sense for each context.
  ═══════════════════════════════════════════════════════════════════════ */
  const SIDEBAR_PRESETS = {
    // Full home listening room — all six metrics apply
    home_hifi: [
      'sbir',
      'side_reflections',
      'bandwidth',
      'balance',
      'smoothness',
      'clarity',
    ],

    // Near-field studio — axial modes and tonal consistency dominate;
    // stereo balance and side reflections are secondary for nearfield setups
    studio: [
      'sbir',
      'bandwidth',
      'clarity',
      'smoothness',
    ],

    // Retail / spec-driven — no sweep data, show only spec-predictable metrics
    retail: [
      'sbir',
      'bandwidth',
      'balance',
    ],
  };

  /* ═══════════════════════════════════════════════════════════════════════
     INIT SIDEBAR
  ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @param {object}   opts
   * @param {string}   opts.mountId        — ID of the <aside> container element
   * @param {string}   [opts.preset]       — named preset key (default: 'home_hifi')
   * @param {string[]} [opts.sections]     — custom section ID array (overrides preset)
   * @param {Function} [opts.onSectionClick] — called with (id|null) after click is handled
   * @returns {SidebarAPI|null}
   */
  function initSidebar({ mountId, preset, sections, onSectionClick } = {}) {
    const container = document.getElementById(mountId);
    if (!container) {
      console.error(`[SidebarEngine] Mount element #${mountId} not found`);
      return null;
    }

    // Resolve section list: explicit array > named preset > default
    const ids = sections || SIDEBAR_PRESETS[preset] || SIDEBAR_PRESETS.home_hifi;
    const activeSections = ids.map(id => SECTION_REGISTRY[id]).filter(Boolean);

    if (!activeSections.length) {
      console.warn('[SidebarEngine] No valid sections resolved — check preset/sections config');
    }

    // Live score + std state (keyed by section id)
    const _scores = {};
    const _stds   = {};
    let   _activeId = null;

    // DOM card references keyed by section id
    const _cards = {};

    // ── Build DOM ──────────────────────────────────────────────────────────
    container.innerHTML = '';

    activeSections.forEach(def => {
      const btn = document.createElement('button');
      btn.className            = 'card glass-panel analysis-card-trigger';
      btn.dataset.overlay      = def.overlay;
      btn.dataset.sectionId    = def.id;
      btn.setAttribute('aria-label', `View ${def.label} details`);

      btn.innerHTML = `
        <div class="card-header">
          <h2 class="card-title">${def.label}</h2>
          <img src="${def.icon}" class="card-icon" alt="" aria-hidden="true">
        </div>
        <div class="score-readout">
          <span id="${def.domKey}Score" class="score-value">--</span>
          <span class="score-unit">${def.unit}</span>
        </div>
        <div class="perf-track">
          <div id="${def.domKey}Track" class="perf-fill"></div>
        </div>
        <div id="${def.domKey}Dave" class="dave-quote-mini">--</div>
      `;

      btn.addEventListener('click', () => _handleClick(def));
      container.appendChild(btn);
      _cards[def.id] = btn;
    });

    // ── Click handler ──────────────────────────────────────────────────────
    function _handleClick(def) {
      // Second click on active section → collapse + reset 3D
      if (_activeId === def.id) {
        _activeId = null;
        _clearActive();
        const r3d = window.room3D;
        if (r3d?.resetView) r3d.resetView();
        onSectionClick?.(null);
        return;
      }

      _activeId = def.id;
      _clearActive();
      _cards[def.id]?.classList.add('active');

      // Drive 3D overlay — access window.room3D lazily so init order doesn't matter
      const r3d   = window.room3D;
      const score = _scores[def.id] ?? 5;
      if (r3d) {
        if (def.id === 'smoothness') {
          r3d.focusIssue(def.overlay, score, _stds[def.id] ?? 0);
        } else {
          r3d.focusIssue(def.overlay, score);
        }
      }

      onSectionClick?.(def.id);
    }

    function _clearActive() {
      Object.values(_cards).forEach(c => c.classList.remove('active'));
    }

    // ── Helpers ────────────────────────────────────────────────────────────
    function _statusClass(percent) {
      if (percent < 45)  return 'metric-poor';
      if (percent >= 70) return 'metric-good';
      return 'metric-ok';
    }

    function _trackColor(statusClass) {
      if (statusClass === 'metric-poor') return 'var(--c-poor)';
      if (statusClass === 'metric-good') return 'var(--c-excellent)';
      return 'var(--c-good)';
    }

    /* ══════════════════════════════════════════════════════════════════════
       PUBLIC API
    ══════════════════════════════════════════════════════════════════════ */

    /**
     * Update a single section with fresh score + commentary.
     * @param {string} id          — section id (e.g. 'sbir', 'bandwidth')
     * @param {number} score       — 0–10
     * @param {string} [commentary] — short Dave phrase or null to leave unchanged
     * @param {number} [std]       — smoothness std deviation (smoothness section only)
     */
    function updateSection(id, score, commentary, std) {
      const def = SECTION_REGISTRY[id];
      if (!def) return;

      _scores[id] = score;
      if (std !== undefined) _stds[id] = std;

      const percent     = Math.min(Number.isFinite(score) ? score * 10 : 0, 100);
      const cls         = _statusClass(percent);

      const scoreEl = document.getElementById(`${def.domKey}Score`);
      if (scoreEl) {
        scoreEl.textContent = Number.isFinite(score) ? score.toFixed(1) : '--';
        scoreEl.className   = `score-value ${cls}`;
      }

      const trackEl = document.getElementById(`${def.domKey}Track`);
      if (trackEl) {
        trackEl.style.width      = `${percent}%`;
        trackEl.style.background = _trackColor(cls);
        trackEl.style.boxShadow  = '';
      }

      if (commentary !== undefined) {
        const daveEl = document.getElementById(`${def.domKey}Dave`);
        if (daveEl) {
          daveEl.innerHTML = '';
          if (commentary) {
            const span = document.createElement('span');
            span.textContent = commentary;
            daveEl.appendChild(span);
          }
        }
      }
    }

    /**
     * Feed all scores from a scores object in one call.
     * Matches scoreKey against scores object properties.
     * @param {object} scoresObj   — e.g. { peaks_dips: 7.2, bandwidth: 8.1, ... }
     * @param {number} [stdDb]     — smoothness std deviation
     */
    function updateAll(scoresObj, stdDb) {
      if (!scoresObj) return;
      activeSections.forEach(def => {
        const raw = scoresObj[def.scoreKey];
        if (raw !== undefined) {
          const std = def.id === 'smoothness' ? stdDb : undefined;
          updateSection(def.id, Number(raw), undefined, std);
        }
      });
    }

    /**
     * Programmatically focus a section (e.g. from onboarding tour).
     * @param {string} id — section id
     */
    function focusSection(id) {
      const def = SECTION_REGISTRY[id];
      if (def && _cards[id]) _handleClick(def);
    }

    /**
     * Clear all active states and reset the 3D view.
     */
    function reset() {
      _activeId = null;
      _clearActive();
      const r3d = window.room3D;
      if (r3d?.resetView) r3d.resetView();
    }

    /**
     * Returns IDs of currently rendered sections in display order.
     * @returns {string[]}
     */
    function getSections() {
      return activeSections.map(d => d.id);
    }

    /**
     * Returns the id of the currently active (clicked) section, or null.
     * @returns {string|null}
     */
    function getActive() {
      return _activeId;
    }

    /**
     * Hot-swap the preset without re-mounting the container.
     * Useful for switching between home_hifi and studio in the same session.
     * @param {string|string[]} presetOrSections
     */
    function setPreset(presetOrSections) {
      const nextIds = Array.isArray(presetOrSections)
        ? presetOrSections
        : SIDEBAR_PRESETS[presetOrSections];

      if (!nextIds) {
        console.warn(`[SidebarEngine] Unknown preset: ${presetOrSections}`);
        return;
      }

      // Re-init in place — destroy and rebuild
      destroy();
      // Mutate activeSections in place
      activeSections.length = 0;
      nextIds.forEach(id => {
        const def = SECTION_REGISTRY[id];
        if (def) activeSections.push(def);
      });
      // Rebuild DOM
      activeSections.forEach(def => {
        const btn = document.createElement('button');
        btn.className         = 'card glass-panel analysis-card-trigger';
        btn.dataset.overlay   = def.overlay;
        btn.dataset.sectionId = def.id;
        btn.setAttribute('aria-label', `View ${def.label} details`);
        btn.innerHTML = `
          <div class="card-header">
            <h2 class="card-title">${def.label}</h2>
            <img src="${def.icon}" class="card-icon" alt="" aria-hidden="true">
          </div>
          <div class="score-readout">
            <span id="${def.domKey}Score" class="score-value">--</span>
            <span class="score-unit">${def.unit}</span>
          </div>
          <div class="perf-track">
            <div id="${def.domKey}Track" class="perf-fill"></div>
          </div>
          <div id="${def.domKey}Dave" class="dave-quote-mini">--</div>
        `;
        btn.addEventListener('click', () => _handleClick(def));
        container.appendChild(btn);
        _cards[def.id] = btn;
      });

      _activeId = null;
      Object.keys(_cards).forEach(id => {
        if (!activeSections.find(d => d.id === id)) delete _cards[id];
      });
    }

    /**
     * Remove all sidebar DOM and unbind everything.
     */
    function destroy() {
      container.innerHTML = '';
      Object.keys(_cards).forEach(k => delete _cards[k]);
      _activeId = null;
    }

    /** @type {SidebarAPI} */
    return {
      updateSection,
      updateAll,
      focusSection,
      reset,
      getSections,
      getActive,
      setPreset,
      destroy,
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     EXPORTS (UMD)
  ═══════════════════════════════════════════════════════════════════════ */
  const publicApi = { initSidebar, SECTION_REGISTRY, SIDEBAR_PRESETS };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = publicApi;
  } else if (typeof window !== 'undefined') {
    window.MeasurelySidebar = publicApi;
  }

}(typeof globalThis !== 'undefined' ? globalThis : this));
