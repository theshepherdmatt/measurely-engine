/*
  @measurely/engine — Sidebar Component Library (SCL)
  ─────────────────────────────────────────────────────
  Renders all standard control panel sections from JS.
  One function per section; each returns a reset() API.

  All satellites (demo.html, sonarworks, myroom) call these functions
  from their <script type="module"> and pass onChange callbacks.
  No control HTML is required in the HTML file — mount divs only.

  Exports: window.MeasurelySCL
*/

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.MeasurelySCL = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── Shared DOM helpers ─────────────────────────────────────────────────────

  function _el(tag, attrs = {}, text) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else el.setAttribute(k, v);
    }
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function _mount(mountId) {
    const el = document.getElementById(mountId);
    if (!el) console.warn('[MeasurelySCL] mount not found:', mountId);
    return el;
  }

  function _updateSliderFill(slider) {
    const min = parseFloat(slider.min), max = parseFloat(slider.max);
    const pct = ((parseFloat(slider.value) - min) / (max - min) * 100).toFixed(1);
    slider.style.setProperty('--fill', pct + '%');
  }

  // Wires a teal glow on the related 3D object while a slider is being moved.
  // Uses window.room3D lazily so init order doesn't matter.
  let _hlTimer;
  function _attachHighlight(slider, hlTarget) {
    if (!hlTarget) return;
    const on  = () => { clearTimeout(_hlTimer); window.room3D?.highlight?.(hlTarget); };
    const off = () => { clearTimeout(_hlTimer); _hlTimer = setTimeout(() => window.room3D?.highlight?.(null), 80); };
    slider.addEventListener('focus',     on);
    slider.addEventListener('input',     on);
    slider.addEventListener('blur',      off);
    slider.addEventListener('pointerup', off);
  }

  // ── Unit system (display-layer only) ───────────────────────────────────────
  // Imperial support is presentational: all state, slider min/max/step, and the
  // values passed to onChange stay in metres. Only the readout STRINGS change.
  // Default 'metric' so every existing consumer is unaffected with no change on
  // their side. setUnitSystem affects readouts built AFTER it is called — call
  // it before rendering a section (or re-render) to switch an existing panel.
  let _unitSystem = 'metric';

  function setUnitSystem(system) {
    _unitSystem = system === 'imperial' ? 'imperial' : 'metric';
    return _unitSystem;
  }
  function getUnitSystem() { return _unitSystem; }

  // Pure formatter for a length readout. `metres` is the canonical value;
  // `decimals` is the metric precision (1dp or 2dp per slider) and is preserved
  // exactly as today so metric output is byte-identical. Imperial rounds to the
  // nearest whole inch: under 36 in (3 ft) it reads as inches (e.g. '18 in');
  // at or above 3 ft it reads feet + inches, dropping the inches part when it
  // rounds to 0 (e.g. 14', 13' 9"). Negative values (listener/seat offset) keep
  // their sign.
  function formatLength(metres, decimals = 1) {
    const m = parseFloat(metres);
    if (_unitSystem === 'imperial') {
      if (!isFinite(m)) return '0 in';
      const sign = m < 0 ? '-' : '';
      const totalIn = Math.round(Math.abs(m) * 39.3701);
      if (totalIn < 36) return sign + totalIn + ' in';
      const feet = Math.floor(totalIn / 12);
      const inches = totalIn - feet * 12;
      return sign + (inches === 0 ? feet + "'" : feet + "' " + inches + '"');
    }
    return m.toFixed(decimals) + ' m';
  }

  // Builds a labelled slider field: label + value display + range input
  function _sliderField({ label, id, min, max, step, value, unit = '', decimals = 1, ariaLabel, acoustic }) {
    const wrap  = _el('div', { class: 'demo-field' });
    const hdr   = _el('div', { class: 'demo-field-header' });
    const lbl   = _el('span', { class: 'demo-field-label' }, label);
    const val   = _el('span', { class: 'demo-field-value', id: id + '-val' },
                       unit === 'm'
                         ? formatLength(value, decimals)
                         : (parseFloat(value).toFixed(decimals)) + (unit ? ' ' + unit : ''));
    hdr.append(lbl, val);

    const slider = _el('input', {
      type: 'range', id, min: String(min), max: String(max),
      step: String(step), value: String(value),
      class: 'measurely-slider', 'aria-label': ariaLabel ?? label,
      ...(acoustic ? { 'data-acoustic': acoustic } : {}),
    });
    _updateSliderFill(slider);

    wrap.append(hdr, slider);
    return { wrap, slider, val };
  }

  // Builds a group of sbox-btn toggle buttons (single-select)
  function _btnGroup(options, activeKey, onChange) {
    const row = _el('div', { class: 'demo-btn-row' });
    const btns = {};
    for (const { key, label, title } of options) {
      const btn = _el('button', {
        class: 'sbox-btn' + (key === activeKey ? ' active' : ''),
        type: 'button',
        ...(title ? { title } : {}),
      }, label);
      btn.addEventListener('click', () => {
        Object.values(btns).forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        onChange(key);
      });
      btns[key] = btn;
      row.appendChild(btn);
    }
    return { row, btns, setActive: k => {
      Object.values(btns).forEach(b => b.classList.remove('active'));
      btns[k]?.classList.add('active');
    }};
  }

  // Builds a sbox-btn toggle (binary on/off)
  function _toggleBtn(label, active, title) {
    const btn = _el('button', {
      class: 'sbox-btn' + (active ? ' active' : ''),
      type: 'button',
      ...(title ? { title } : {}),
    }, label);
    return btn;
  }

  // ── Icon-grid helpers ──────────────────────────────────────────────────────
  // BASE_PATH resolves relative to the page, not this script file.
  const _ICON_BASE = 'icons/';

  // Grid styles shared by both helpers
  const _GRID_CSS = 'display:grid;gap:8px;';
  const _CELL_BASE = [
    'display:flex;flex-direction:column;align-items:center;justify-content:center;',
    'gap:4px;padding:7px 4px 5px;border:1px solid transparent;border-radius:6px;cursor:pointer;',
    'background:var(--scl-cell-bg,rgba(0,0,0,0.04));transition:background 0.15s,border-color 0.15s,transform 0.1s;',
    'font-size:8px;font-family:var(--mly-font,\'DM Sans\',sans-serif);',
    'letter-spacing:0.08em;text-transform:uppercase;font-weight:600;color:var(--scl-cell-col,#71717a);',
  ].join('');
  const _CELL_ACTIVE_BG  = 'var(--scl-cell-active-bg,var(--mly-teal,#0d9488))';
  const _CELL_ACTIVE_COL = 'var(--scl-cell-active-col,#ffffff)';
  const _MASK_INACTIVE   = 'var(--scl-mask-i,rgba(113,113,122,0.7))';
  const _MASK_ACTIVE     = 'var(--scl-mask-a,#ffffff)';

  // Build a single icon-grid cell (button)
  function _iconCell(iconFile, label, active) {
    const btn  = document.createElement('button');
    btn.type   = 'button';
    btn.title  = label;
    btn.style.cssText = _CELL_BASE;
    _iconCellApply(btn, active);

    // Mask element — the SVG colour is driven by background-color on the mask div
    const mask = document.createElement('div');
    mask.style.cssText = [
      'width:26px;height:26px;',
      '-webkit-mask-image:url(' + _ICON_BASE + iconFile + ');',
      'mask-image:url(' + _ICON_BASE + iconFile + ');',
      '-webkit-mask-size:contain;mask-size:contain;',
      '-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;',
      '-webkit-mask-position:center;mask-position:center;',
      'background-color:' + (active ? _MASK_ACTIVE : _MASK_INACTIVE) + ';',
      'transition:background-color 0.15s;',
    ].join('');
    btn._iconMask = mask;

    const lbl = document.createElement('span');
    lbl.textContent = label;
    lbl._isIconLabel = true;

    btn.appendChild(mask);
    btn.appendChild(lbl);
    return btn;
  }

  function _iconCellApply(btn, active) {
    btn.style.background  = active ? _CELL_ACTIVE_BG  : 'var(--scl-cell-bg,rgba(0,0,0,0.04))';
    btn.style.color       = active ? _CELL_ACTIVE_COL : 'var(--scl-cell-col,#71717a)';
    btn.style.borderColor = active ? 'var(--scl-cell-active-border,transparent)' : 'transparent';
    if (btn._iconMask) {
      btn._iconMask.style.backgroundColor = active ? _MASK_ACTIVE : _MASK_INACTIVE;
    }
  }

  // Multi-toggle icon grid (each button independently on/off)
  // items: [{ key, icon, label, active }]
  // returns { grid, states, setActive(key, bool) }
  function _iconGridToggle(items, cols, onChange) {
    const grid = document.createElement('div');
    grid.style.cssText = _GRID_CSS + 'grid-template-columns:repeat(' + cols + ',1fr);';
    const states = {};
    const btns   = {};
    for (const item of items) {
      const btn = _iconCell(item.icon, item.label, !!item.active);
      states[item.key] = !!item.active;
      btns[item.key]   = btn;
      btn.addEventListener('click', () => {
        states[item.key] = !states[item.key];
        _iconCellApply(btn, states[item.key]);
        onChange?.(item.key, states[item.key]);
      });
      grid.appendChild(btn);
    }
    return {
      grid,
      states,
      setActive(key, bool) {
        states[key] = bool;
        _iconCellApply(btns[key], bool);
      },
    };
  }

  // Single-select icon grid (radio behaviour)
  // items: [{ key, icon, label }], activeKey
  // returns { grid, setActive(key) }
  function _iconGridSelect(items, activeKey, cols, onChange) {
    const grid = document.createElement('div');
    grid.style.cssText = _GRID_CSS + 'grid-template-columns:repeat(' + cols + ',1fr);';
    let _cur = activeKey;
    const btns = {};
    for (const item of items) {
      const btn = _iconCell(item.icon, item.label, item.key === activeKey);
      btns[item.key] = btn;
      btn.addEventListener('click', () => {
        _cur = item.key;
        Object.keys(btns).forEach(k => _iconCellApply(btns[k], k === _cur));
        onChange?.(item.key);
      });
      grid.appendChild(btn);
    }
    return {
      grid,
      setActive(key) {
        _cur = key;
        Object.keys(btns).forEach(k => _iconCellApply(btns[k], k === _cur));
      },
    };
  }

  // ── Section 0 — Room Type Toggle (Hi-Fi / Studio) ────────────────────────
  // Canonical source of truth for home vs studio defaults.
  // Both demo.html and onboarding.html consume this function.

  const _ROOM_TYPE_DEFAULTS = {
    home: {
      room_type:           'home',
      speaker_type:        'floorstander',
      spk_spacing_m:       2.2,
      spk_front_m:         0.3,
      tweeter_height_m:    0.95,
      listener_front_m:    3.2,
      toe_in_deg:          10,
      opt_sofa:            true,
      opt_area_rug:        true,
      opt_coffee_table:    true,
      opt_ottoman:         false,
      opt_display:         false,
      opt_mic:             false,
      opt_keyboard:        false,
      opt_client_seating:  false,
      client_seating_type: 'sofa',
      desk_width_m:        1.6,
      desk_depth_m:        0.7,
      // Per-room-type default geometry. Home is the spacious listening-room
      // default; consumers apply these on a room-type switch so studio rooms
      // start smaller (less empty space around the desk) and home round-trips
      // back to its full size.
      width_m:             4.2,
      length_m:            5.5,
      height_m:            2.6,
    },
    studio: {
      room_type:           'studio',
      speaker_type:        'monitor',
      spk_front_m:         0.6,
      spk_spacing_m:       1.8,
      spk_inset_m:         0.20,
      tweeter_height_m:    1.1,
      listener_front_m:    1.4,
      toe_in_deg:          15,
      opt_sofa:            false,
      opt_area_rug:        false,
      opt_coffee_table:    false,
      opt_ottoman:         false,
      opt_display:         true,
      opt_mic:             false,
      opt_keyboard:        false,
      opt_client_seating:  false,
      client_seating_type: 'sofa',
      desk_width_m:        1.6,
      desk_depth_m:        0.7,
      desk_style:          'plain',
      // Smaller near-field studio footprint — see note on home above.
      width_m:             3.2,
      length_m:            3.8,
      height_m:            2.4,
    },
    // Cinema — blank shell for now. Mirrors home's placement numbers and
    // speaker_type (placeholder; cinema speaker roles come later) and turns
    // ALL furniture opts off so the room renders empty (placeholder speakers +
    // listener still draw via the home path). Carries the full field set home
    // and studio carry — incl. spk_inset_m (inert outside studio) and desk dims
    // — so no downstream reader falls back to an inline default.
    cinema: {
      room_type:           'cinema',
      speaker_type:        'floorstander',
      screen_type:         'stand',   // 'stand' | 'wall' | 'projector' — cinema TV/screen mount
      cinema_seat_count:   3,          // 3 | 4 | 5 — theatre recliner row length
      cinema_row_count:    1,          // 1 | 2 | 3 | 4 — elevated theatre rows (recliner row only)
      speaker_layout:      '5_1',      // '5_1' | '7_2' | '7_2_4' — surround layout (extends: 'soundbar')
      cinema_seating_type: 'recliner_row',  // 'recliner_row' | 'corner_l' | 'corner_r'
      spk_spacing_m:       2.2,
      spk_front_m:         0.3,
      spk_inset_m:         0.20,
      tweeter_height_m:    0.95,
      listener_front_m:    3.2,
      toe_in_deg:          10,
      opt_sofa:            false,
      opt_area_rug:        false,
      opt_coffee_table:    false,
      opt_ottoman:         false,
      opt_display:         false,
      opt_mic:             false,
      opt_keyboard:        false,
      opt_client_seating:  false,
      client_seating_type: 'sofa',
      desk_width_m:        1.6,
      desk_depth_m:        0.7,
    },
  };

  function renderRoomTypeToggle(mountId, {
    initial        = 'home',
    onChange,
    collapsible    = false,
    collapsedLabel = 'Room type',
    confirm        = false,
    confirmText    = 'Switching room type will reset speakers and furniture. Continue?',
    initiallyOpen  = false,
  } = {}) {
    const mount = _mount(mountId);
    if (!mount) return null;

    const _TOGGLE_IDS = { home: 'select-hifi', studio: 'select-studio', cinema: 'select-cinema' };
    const _LABELS     = { home: 'Hi-Fi', studio: 'Studio', cinema: 'Cinema' };

    // Live current key — fixes getActive() previously returning stale `initial`
    let currentKey = initial;

    // Forward declaration — populated below if collapsible
    let summaryEl = null;
    const _summaryText = key => collapsedLabel + ' · ' + _LABELS[key];

    // Cinema is hidden for now — the room type is unfinished and needs more
    // work. All cinema machinery (defaults, render functions, room3d geometry,
    // legacy IDs) is left intact; flip _SHOW_CINEMA back to true to restore the
    // toggle cell once the feature is ready.
    const _SHOW_CINEMA = false;
    const _cells = [
      { key: 'home',   icon: 'hifi.svg',   label: _LABELS.home   },
      { key: 'studio', icon: 'studio.svg', label: _LABELS.studio },
    ];
    if (_SHOW_CINEMA) _cells.push({ key: 'cinema', icon: 'cinema.svg', label: _LABELS.cinema });

    const gridResult = _iconGridSelect(
      _cells,
      initial,
      _cells.length,
      key => {
        // Re-click of the active cell — no-op
        if (key === currentKey) return;
        // Confirm gate — _iconGridSelect has already flipped visual state, so revert on cancel
        if (confirm && !window.confirm(confirmText)) {
          gridResult.setActive(currentKey);
          return;
        }
        currentKey = key;
        if (summaryEl) summaryEl.textContent = _summaryText(key);
        onChange?.(key, { ..._ROOM_TYPE_DEFAULTS[key] });
      }
    );

    // Stamp legacy IDs so existing workstation.js selectors keep working
    const cells = gridResult.grid.children;
    if (cells[0]) cells[0].id = _TOGGLE_IDS.home;
    if (cells[1]) cells[1].id = _TOGGLE_IDS.studio;
    if (cells[2]) cells[2].id = _TOGGLE_IDS.cinema;

    if (collapsible) {
      const details = document.createElement('details');
      details.className = 'mly-room-type-switcher';
      if (initiallyOpen) details.open = true;

      summaryEl = document.createElement('summary');
      summaryEl.className = 'mly-room-type-summary';
      summaryEl.textContent = _summaryText(currentKey);

      details.appendChild(summaryEl);
      details.appendChild(gridResult.grid);
      mount.appendChild(details);
    } else {
      mount.appendChild(gridResult.grid);
    }

    return {
      setActive(key) {
        currentKey = key;
        gridResult.setActive(key);
        if (summaryEl) summaryEl.textContent = _summaryText(key);
      },
      getActive()      { return currentKey; },
      getDefaults(key) { return { ..._ROOM_TYPE_DEFAULTS[key] }; },
      reset() {
        currentKey = initial;
        gridResult.setActive(initial);
        if (summaryEl) summaryEl.textContent = _summaryText(initial);
      },
    };
  }

  // ── Section 1 — Analysis Overlays ─────────────────────────────────────────
  // overlays: [{ key, label }]  initial: key string  onOverlayChange: fn(key)
  // showOff: true adds an "Off" button that fires onOverlayChange('none')

  function renderAnalysisOverlaySection(mountId, { initial, overlays = [], showOff = false, onOverlayChange } = {}) {
    const mount = _mount(mountId);
    if (!mount) return null;

    let activeKey = initial;
    const btns = {};

    const allOverlays = showOff
      ? [...overlays, { key: 'none', label: 'Off' }]
      : overlays;

    const row = _el('div', { class: 'demo-btn-row' });
    for (const { key, label } of allOverlays) {
      const btn = _el('button', {
        class: 'overlay-btn' + (key === activeKey ? ' active' : ''),
        type: 'button',
        'data-overlay': key,
      }, label);
      btn.addEventListener('click', () => {
        if (activeKey === key) return;
        Object.values(btns).forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeKey = key;
        onOverlayChange?.(key);
      });
      btns[key] = btn;
      row.appendChild(btn);
    }
    mount.appendChild(row);

    return {
      setActive(key) {
        Object.values(btns).forEach(b => b.classList.remove('active'));
        btns[key]?.classList.add('active');
        activeKey = key;
      },
      reset() { this.setActive(initial); },
    };
  }

  // ── Section 2 — Room Dimensions ───────────────────────────────────────────
  // state: { width_m, length_m, height_m }  onChange: fn({ width_m, length_m, height_m })

  // `ranges` lets a consumer override any def's min/max/step — e.g. club-scale
  // venues (15m+ length) blow past the hi-fi-room defaults below, and a
  // range input silently clamps its value to `max` the instant it's created,
  // so an out-of-range default would visibly "jump" to the slider's max on
  // first render/touch rather than showing the real value.
  //   ranges: { length_m: { max: 30 }, width_m: { max: 25 }, height_m: { max: 8 } }
  function renderRoomSection(mountId, { state = {}, onChange, ranges = {} } = {}) {
    const mount = _mount(mountId);
    if (!mount) return null;

    const cur = { width_m: state.width_m ?? 4.2, length_m: state.length_m ?? 5.5, height_m: state.height_m ?? 2.6 };
    const wrap = _el('div', { style: 'display:flex;flex-direction:column;gap:12px;' });

    const defs = [
      { label: 'Room width',  key: 'width_m',  min: 2.0, max: 8.0,  step: 0.1,  unit: 'm', decimals: 1, hl: 'wall_width',  acoustic: 'sbir' },
      { label: 'Room length', key: 'length_m', min: 2.5, max: 10.0, step: 0.1,  unit: 'm', decimals: 1, hl: 'wall_length', acoustic: 'sbir' },
      { label: 'Room height', key: 'height_m', min: 2.0, max: 4.0,  step: 0.05, unit: 'm', decimals: 1, hl: 'wall_height', acoustic: 'sbir' },
    ].map(def => ({ ...def, ...ranges[def.key] }));

    const sliders = {};
    for (const def of defs) {
      const { wrap: fw, slider, val } = _sliderField({
        label: def.label, id: 'scl-' + def.key,
        min: def.min, max: def.max, step: def.step,
        value: cur[def.key], unit: def.unit, decimals: def.decimals,
        acoustic: def.acoustic,
      });
      _attachHighlight(slider, def.hl);
      slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        cur[def.key] = v;
        val.textContent = def.unit === 'm'
          ? formatLength(v, def.decimals)
          : v.toFixed(def.decimals) + ' ' + def.unit;
        _updateSliderFill(slider);
        onChange?.({ ...cur });
      });
      sliders[def.key] = { slider, val, def };
      wrap.appendChild(fw);
    }

    mount.appendChild(wrap);

    return {
      reset() {
        for (const [k, { slider, val, def }] of Object.entries(sliders)) {
          slider.value = String(state[k]);
          cur[k] = state[k];
          val.textContent = def.unit === 'm'
            ? formatLength(state[k], def.decimals)
            : parseFloat(state[k]).toFixed(def.decimals) + ' ' + def.unit;
          _updateSliderFill(slider);
        }
      },
      // Push new dimension values into the sliders (value, label, fill) without
      // firing onChange — for re-syncing the UI after a programmatic geometry
      // change, e.g. applying per-room-type default dimensions on a room-type
      // switch. Only keys present in `next` are updated; others are left as-is.
      setValues(next = {}) {
        for (const [k, { slider, val, def }] of Object.entries(sliders)) {
          if (next[k] === undefined) continue;
          const v = parseFloat(next[k]);
          slider.value = String(v);
          cur[k] = v;
          val.textContent = def.unit === 'm'
            ? formatLength(v, def.decimals)
            : v.toFixed(def.decimals) + ' ' + def.unit;
          _updateSliderFill(slider);
        }
      },
    };
  }

  // ── Section 3 — Ceiling ───────────────────────────────────────────────────

  function renderCeilingSection(mountId, { state = {}, onChange } = {}) {
    const mount = _mount(mountId);
    if (!mount) return null;

    const cur = {
      ceiling_type:               state.ceiling_type               ?? 'flat',
      ceiling_slant_direction:    state.ceiling_slant_direction    ?? 'left_to_right',
      ceiling_gable_axis:         state.ceiling_gable_axis         ?? 'depth',
      ceiling_height_secondary_m: state.ceiling_height_secondary_m ?? 2.0,
    };

    const wrap = _el('div', { style: 'display:flex;flex-direction:column;gap:10px;' });

    // Ceiling type selector — Slate Highlight buttons
    const typeGroup = _btnGroup(
      [{ key: 'flat', label: 'Flat' }, { key: 'slanted', label: 'Slanted' }, { key: 'gable', label: 'Gabled' }],
      cur.ceiling_type,
      key => {
        cur.ceiling_type = key;
        _updateSubControls();
        onChange?.({ ...cur });
      }
    );
    wrap.appendChild(typeGroup.row);

    // Slant direction (shown when slanted)
    const slantWrap = _el('div', { style: 'display:none;flex-direction:column;gap:8px;' });
    slantWrap.appendChild(_el('span', { class: 'demo-field-label' }, 'Slant direction'));
    const slantGroup = _btnGroup(
      [
        { key: 'left_to_right', label: 'L → R' }, { key: 'right_to_left', label: 'R → L' },
        { key: 'front_to_back', label: 'F → B' }, { key: 'back_to_front', label: 'B → F' },
      ],
      cur.ceiling_slant_direction,
      key => { cur.ceiling_slant_direction = key; onChange?.({ ...cur }); }
    );
    slantWrap.appendChild(slantGroup.row);
    wrap.appendChild(slantWrap);

    // Gable axis (shown when gabled)
    const gableWrap = _el('div', { style: 'display:none;flex-direction:column;gap:8px;' });
    gableWrap.appendChild(_el('span', { class: 'demo-field-label' }, 'Ridge direction'));
    const gableGroup = _btnGroup(
      [{ key: 'depth', label: 'Front ↔ Back' }, { key: 'width', label: 'Left ↔ Right' }],
      cur.ceiling_gable_axis,
      key => { cur.ceiling_gable_axis = key; onChange?.({ ...cur }); }
    );
    gableWrap.appendChild(gableGroup.row);
    wrap.appendChild(gableWrap);

    // Secondary height slider (shown when slanted or gabled)
    const { wrap: secWrap, slider: secSlider, val: secVal } = _sliderField({
      label: 'Lowest ceiling height', id: 'scl-ceil-secondary',
      min: 1.5, max: 4.0, step: 0.05,
      value: cur.ceiling_height_secondary_m, unit: 'm', decimals: 1,
      acoustic: 'sbir',
    });
    secWrap.style.display = 'none';
    _attachHighlight(secSlider, 'wall_height');
    secSlider.addEventListener('input', () => {
      const v = parseFloat(secSlider.value);
      cur.ceiling_height_secondary_m = v;
      secVal.textContent = formatLength(v, 1);
      _updateSliderFill(secSlider);
      onChange?.({ ...cur });
    });
    wrap.appendChild(secWrap);

    function _updateSubControls() {
      const isFlat     = cur.ceiling_type === 'flat';
      const isSlanted  = cur.ceiling_type === 'slanted';
      const isGable    = cur.ceiling_type === 'gable';
      slantWrap.style.display = isSlanted ? 'flex' : 'none';
      gableWrap.style.display = isGable   ? 'flex' : 'none';
      secWrap.style.display   = (isSlanted || isGable) ? 'block' : 'none';
    }
    _updateSubControls();

    mount.appendChild(wrap);

    return {
      reset() {
        cur.ceiling_type               = state.ceiling_type               ?? 'flat';
        cur.ceiling_slant_direction    = state.ceiling_slant_direction    ?? 'left_to_right';
        cur.ceiling_gable_axis         = state.ceiling_gable_axis         ?? 'depth';
        cur.ceiling_height_secondary_m = state.ceiling_height_secondary_m ?? 2.0;
        typeGroup.setActive(cur.ceiling_type);
        slantGroup.setActive(cur.ceiling_slant_direction);
        gableGroup.setActive(cur.ceiling_gable_axis);
        secSlider.value = String(cur.ceiling_height_secondary_m);
        secVal.textContent = formatLength(cur.ceiling_height_secondary_m, 1);
        _updateSliderFill(secSlider);
        _updateSubControls();
      },
    };
  }

  // ── Cinema screen-type selector ───────────────────────────────────────────
  // Standalone control (not part of any always-mounted section) — a consumer
  // mounts it only for the cinema room type, so it stays dormant elsewhere
  // (e.g. web, which has no cinema room type). Follows the renderCeilingSection
  // pattern: a 3-key _btnGroup whose callback writes cur.screen_type and fires
  // onChange. screen_type is geometry-only (drives the TV/screen prop in
  // room3d.js); it does not feed acoustics/analysis.
  function renderScreenTypeSection(mountId, { state = {}, onChange } = {}) {
    const mount = _mount(mountId);
    if (!mount) return null;

    const cur = {
      screen_type: state.screen_type ?? 'stand',
    };

    const wrap = _el('div', { style: 'display:flex;flex-direction:column;gap:10px;' });

    const typeGroup = _btnGroup(
      [
        { key: 'stand',     label: 'Stand'     },
        { key: 'wall',      label: 'Wall'      },
        { key: 'projector', label: 'Projector' },
      ],
      cur.screen_type,
      key => {
        cur.screen_type = key;
        onChange?.({ ...cur });
      }
    );
    wrap.appendChild(typeGroup.row);

    mount.appendChild(wrap);

    return {
      reset() {
        cur.screen_type = state.screen_type ?? 'stand';
        typeGroup.setActive(cur.screen_type);
      },
    };
  }

  // ── Cinema speaker-layout selector ────────────────────────────────────────
  // Standalone control (not part of any always-mounted section) — a consumer
  // mounts it only for the cinema room type, so it stays dormant elsewhere
  // (e.g. web, which has no cinema room type). Mirrors renderScreenTypeSection:
  // a labelled segmented _btnGroup whose callback writes cur.speaker_layout and
  // fires onChange. speaker_layout is geometry/coverage-only (drives the surround
  // speakers + subs in room3d.js); it does not feed acoustics/analysis. Options
  // extend later ('7_2_4', 'soundbar') — keep the segmented-group shape.
  function renderSpeakerLayoutSection(mountId, { state = {}, onChange } = {}) {
    const mount = _mount(mountId);
    if (!mount) return null;

    const cur = {
      speaker_layout: state.speaker_layout ?? '5_1',
    };

    const wrap = _el('div', { style: 'display:flex;flex-direction:column;gap:10px;' });
    wrap.appendChild(_el('div', { class: 'demo-field-label' }, 'Speaker layout'));

    const layoutGroup = _btnGroup(
      [
        { key: '5_1',   label: '5.1'   },
        { key: '7_2',   label: '7.2'   },
        { key: '7_2_4', label: '7.2.4' },
      ],
      cur.speaker_layout,
      key => {
        cur.speaker_layout = key;
        onChange?.({ ...cur });
      }
    );
    wrap.appendChild(layoutGroup.row);

    mount.appendChild(wrap);

    return {
      reset() {
        cur.speaker_layout = state.speaker_layout ?? '5_1';
        layoutGroup.setActive(cur.speaker_layout);
      },
    };
  }

  // ── Cinema seat-count selector ────────────────────────────────────────────
  // Standalone control (not part of any always-mounted section) — a consumer
  // mounts it only for the cinema room type, so it stays dormant elsewhere
  // (e.g. web, which has no cinema room type). A single 3–5 slider whose value
  // writes cur.cinema_seat_count and fires onChange. cinema_seat_count is
  // geometry-only (drives the theatre recliner row length in room3d.js); it
  // does not feed acoustics/analysis.
  function renderSeatCountSection(mountId, { state = {}, onChange } = {}) {
    const mount = _mount(mountId);
    if (!mount) return null;

    const cur = {
      cinema_seat_count: state.cinema_seat_count ?? 3,
    };

    const wrap = _el('div', { style: 'display:flex;flex-direction:column;gap:10px;' });

    const { wrap: seatWrap, slider: seatSlider, val: seatVal } = _sliderField({
      label: 'Seats', id: 'scl-cinema-seats',
      min: 3, max: 5, step: 1, decimals: 0,
      value: cur.cinema_seat_count,
    });
    seatSlider.addEventListener('input', () => {
      const v = parseInt(seatSlider.value, 10);
      cur.cinema_seat_count = v;
      seatVal.textContent = String(v);
      _updateSliderFill(seatSlider);
      onChange?.({ ...cur });
    });
    wrap.appendChild(seatWrap);

    mount.appendChild(wrap);

    return {
      reset() {
        cur.cinema_seat_count = state.cinema_seat_count ?? 3;
        seatSlider.value = String(cur.cinema_seat_count);
        seatVal.textContent = String(cur.cinema_seat_count);
        _updateSliderFill(seatSlider);
      },
    };
  }

  // ── Cinema row-count selector ─────────────────────────────────────────────
  // Standalone control (not part of any always-mounted section) — a consumer
  // mounts it only for the cinema room type, and only for the recliner row
  // (corner couches ignore rows), so it stays dormant elsewhere (e.g. web, which
  // has no cinema room type). A single 1–4 slider whose value writes
  // cur.cinema_row_count and fires onChange. cinema_row_count is geometry-only
  // (drives the number of elevated theatre rows in room3d.js); it does not feed
  // acoustics/analysis, which stays on the front/money seat. Short rooms render
  // fewer rows than requested (the engine clamps to what fits the back wall).
  function renderRowCountSection(mountId, { state = {}, onChange } = {}) {
    const mount = _mount(mountId);
    if (!mount) return null;

    const cur = {
      cinema_row_count: state.cinema_row_count ?? 1,
    };

    const wrap = _el('div', { style: 'display:flex;flex-direction:column;gap:10px;' });

    const { wrap: rowWrap, slider: rowSlider, val: rowVal } = _sliderField({
      label: 'Rows', id: 'scl-cinema-rows',
      min: 1, max: 4, step: 1, decimals: 0,
      value: cur.cinema_row_count,
    });
    rowSlider.addEventListener('input', () => {
      const v = parseInt(rowSlider.value, 10);
      cur.cinema_row_count = v;
      rowVal.textContent = String(v);
      _updateSliderFill(rowSlider);
      onChange?.({ ...cur });
    });
    wrap.appendChild(rowWrap);

    mount.appendChild(wrap);

    return {
      reset() {
        cur.cinema_row_count = state.cinema_row_count ?? 1;
        rowSlider.value = String(cur.cinema_row_count);
        rowVal.textContent = String(cur.cinema_row_count);
        _updateSliderFill(rowSlider);
      },
    };
  }

  // ── Cinema seating-type selector ──────────────────────────────────────────
  // Standalone control (not part of any always-mounted section) — a consumer
  // mounts it only for the cinema room type, so it stays dormant elsewhere
  // (e.g. web, which has no cinema room type). A 3-key _btnGroup whose callback
  // writes cur.cinema_seating_type and fires onChange. cinema_seating_type is
  // geometry-only (drives the cinema seating shape in room3d.js); it does not
  // feed acoustics/analysis.
  function renderCinemaSeatingTypeSection(mountId, { state = {}, onChange } = {}) {
    const mount = _mount(mountId);
    if (!mount) return null;

    const cur = {
      cinema_seating_type: state.cinema_seating_type ?? 'recliner_row',
    };

    const wrap = _el('div', { style: 'display:flex;flex-direction:column;gap:10px;' });

    const typeGroup = _btnGroup(
      [
        { key: 'recliner_row', label: 'Recliners' },
        { key: 'corner_l',     label: 'Corner L'  },
        { key: 'corner_r',     label: 'Corner R'  },
      ],
      cur.cinema_seating_type,
      key => {
        cur.cinema_seating_type = key;
        onChange?.({ ...cur });
      }
    );
    wrap.appendChild(typeGroup.row);

    mount.appendChild(wrap);

    return {
      reset() {
        cur.cinema_seating_type = state.cinema_seating_type ?? 'recliner_row';
        typeGroup.setActive(cur.cinema_seating_type);
      },
    };
  }

  // ── Cinema seating-position slider ────────────────────────────────────────
  // Standalone control (not part of any always-mounted section) — a consumer
  // mounts it only for the cinema room type, so it stays dormant elsewhere
  // (e.g. web, which has no cinema room type). It reuses the existing
  // listener_offset_m field rather than introducing a new one: that field is
  // already threaded through room3d.js (it positions the listener station, and
  // the cinema seating block is parented to that station, so sliding it moves
  // the whole row + listening point together) and is acoustically live
  // (acoustics.js reads it as list_x for the side-wall path difference). So,
  // unlike the geometry-only seat-count / seating-type controls above, this one
  // genuinely shifts the analysed seat off-centre and the score reflects it.
  // The ±1.0 m range is the lateral clamp (narrower than the hidden Speakers
  // slider's ±2.0 m); neither the threading, the station math, the acoustics
  // path, nor the existing hidden slider are touched.
  function renderSeatingPositionSection(mountId, { state = {}, onChange } = {}) {
    const mount = _mount(mountId);
    if (!mount) return null;

    const cur = {
      listener_offset_m: state.listener_offset_m ?? 0,
    };

    const wrap = _el('div', { style: 'display:flex;flex-direction:column;gap:10px;' });

    const { wrap: posWrap, slider: posSlider, val: posVal } = _sliderField({
      label: 'Seating position', id: 'scl-cinema-seating-position',
      min: -1.0, max: 1.0, step: 0.1, decimals: 1, unit: 'm',
      value: cur.listener_offset_m,
      acoustic: 'reflection',
    });
    posSlider.addEventListener('input', () => {
      const v = parseFloat(posSlider.value);
      cur.listener_offset_m = v;
      posVal.textContent = formatLength(v, 1);
      _updateSliderFill(posSlider);
      onChange?.({ ...cur });
    });
    wrap.appendChild(posWrap);

    mount.appendChild(wrap);

    return {
      reset() {
        cur.listener_offset_m = state.listener_offset_m ?? 0;
        posSlider.value = String(cur.listener_offset_m);
        posVal.textContent = formatLength(cur.listener_offset_m, 1);
        _updateSliderFill(posSlider);
      },
    };
  }

  // ── Section 4 — Speakers ──────────────────────────────────────────────────

  function renderSpeakersSection(mountId, { state = {}, roomType = 'home', onChange } = {}) {
    const mount = _mount(mountId);
    if (!mount) return null;


    const cur = {
      speaker_type:      state.speaker_type      ?? 'floorstander',
      spk_placement:     state.spk_placement     ?? null,
      spk_spacing_m:     state.spk_spacing_m     ?? 2.0,
      spk_inset_m:       state.spk_inset_m       ?? 0.20,
      spk_front_m:       state.spk_front_m       ?? 0.45,
      toe_in_deg:        state.toe_in_deg        ?? 12,
      listener_front_m:  state.listener_front_m  ?? 2.8,
      tweeter_height_m:  state.tweeter_height_m  ?? 0.95,
      listener_offset_m: state.listener_offset_m ?? 0,
      subwoofer:         state.subwoofer         ?? false,
      subwoofer_dual:    state.subwoofer_dual    ?? false,
    };

    // Root wrapper — children manage their own top margins
    const wrap = _el('div', { style: 'display:flex;flex-direction:column;' });

    // ── BLOCK A: Hardware Profile ─────────────────────────────────────────────
    const speakerHifiBlock   = _el('div', { style: 'display:flex;flex-direction:column;gap:8px;' });
    const speakerStudioBlock = _el('div', { style: 'display:none;flex-direction:column;gap:8px;' });

    const hifiGroup = _btnGroup(
      [
        { key: 'standmount',   label: 'Standmount',   title: 'Bookshelf on stand' },
        { key: 'floorstander', label: 'Floorstander', title: 'Full-range tower' },
        { key: 'statement',    label: 'Statement',    title: 'Flagship floor-standing speaker' },
        { key: 'panel',        label: 'Panel',        title: 'Dipole panel / planar speaker' },
      ],
      cur.speaker_type,
      function(key) { cur.speaker_type = key; studioGroup.setActive(null); onChange && onChange({ ...cur }); }
    );
    speakerHifiBlock.appendChild(hifiGroup.row);
    wrap.appendChild(speakerHifiBlock);

    const studioGroup = _btnGroup(
      [{ key: 'monitor', label: 'Monitor', title: 'Near-field studio monitor' }],
      cur.speaker_type === 'monitor' ? 'monitor' : null,
      function(key) { cur.speaker_type = key; hifiGroup.setActive(null); onChange && onChange({ ...cur }); }
    );

    // Studio no longer offers floor stands — the stand pole would
    // punch through the desk surface. Coerce any stale 'stands' state
    // (from a session before this option was removed) so the button
    // group has a valid active key and the engine renders a sensible
    // placement. Hi-Fi mode has no placement selector at all, so this
    // mutation is studio-only in effect.
    if (cur.spk_placement === 'stands') cur.spk_placement = 'desk_stands';
    const placementGroup = _btnGroup(
      [
        { key: 'desk_stands', label: 'Desk stands' },
        { key: 'desk',        label: 'On desk'     },
      ],
      cur.spk_placement ?? 'desk',
      function(key) { cur.spk_placement = key; onChange && onChange({ ...cur }); }
    );
    speakerStudioBlock.appendChild(studioGroup.row);
    speakerStudioBlock.appendChild(placementGroup.row);
    wrap.appendChild(speakerStudioBlock);

    function _applySpkRoomType(rt) {
      speakerHifiBlock.style.display   = rt === 'studio' ? 'none' : 'flex';
      speakerStudioBlock.style.display = rt === 'studio' ? 'flex' : 'none';
    }
    function _setTypeActive(key) {
      var isStudio = key === 'monitor';
      hifiGroup.setActive(isStudio ? null : key);
      studioGroup.setActive(isStudio ? key : null);
    }
    var typeGroup = { setActive: _setTypeActive };
    _applySpkRoomType(roomType);

    // ── BLOCK B: Speaker Placement — 24 px gap after Block A ─────────────────
    var blockBDefs = [
      { key: 'spk_front_m',      label: 'Speakers from wall', min: 0.1,  max: 1.5,  step: 0.05, unit: 'm', decimals: 2, hl: 'speakers', acoustic: 'sbir'       },
      { key: 'spk_spacing_m',    label: 'Speaker spacing',    min: 1.0,  max: 4.0,  step: 0.1,  unit: 'm', decimals: 1, hl: 'speakers', acoustic: 'reflection' },
      { key: 'spk_inset_m',      label: 'Speaker inset',      min: 0,    max: 1.0,  step: 0.05, unit: 'm', decimals: 2, hl: 'speakers', acoustic: 'reflection' },
      { key: 'toe_in_deg',       label: 'Toe-in angle',       min: 0,    max: 45,   step: 1,    unit: '\u00b0',decimals: 0, hl: 'speakers', acoustic: 'reflection' },
      { key: 'tweeter_height_m', label: 'Tweeter height',     min: 0.75, max: 1.15, step: 0.05, unit: 'm', decimals: 2, hl: 'speakers', acoustic: 'reflection' },
    ];

    // ── BLOCK C: Listener Placement — 24 px gap after Block B ────────────────
    var blockCDefs = [
      { key: 'listener_front_m',  label: 'Listening position', min: 1.0,  max: 5.0,  step: 0.1,  unit: 'm', decimals: 1, hl: 'listener', acoustic: 'reflection' },
      { key: 'listener_offset_m', label: 'Listener offset',    min: -2.0, max: 2.0,  step: 0.05, unit: 'm', decimals: 2, hl: 'listener', acoustic: 'reflection' },
    ];

    var sliders = {};
    var blockDefs = [[blockBDefs, 24], [blockCDefs, 24]];

    for (var bi = 0; bi < blockDefs.length; bi++) {
      var defs = blockDefs[bi][0];
      var topGap = blockDefs[bi][1];
      var block = _el('div', { style: 'display:flex;flex-direction:column;gap:12px;margin-top:' + topGap + 'px;' });
      for (var di = 0; di < defs.length; di++) {
        (function(def) {
          var sf = _sliderField({
            label: def.label, id: 'scl-' + def.key,
            min: def.min, max: def.max, step: def.step,
            value: cur[def.key], unit: def.unit, decimals: def.decimals,
            acoustic: def.acoustic,
          });
          _attachHighlight(sf.slider, def.hl);
          sf.slider.addEventListener('input', function() {
            var v = parseFloat(sf.slider.value);
            cur[def.key] = v;
            sf.val.textContent = def.unit === 'm'
              ? formatLength(v, def.decimals)
              : v.toFixed(def.decimals) + (def.unit === '\u00b0' ? '\u00b0' : ' ' + def.unit);
            _updateSliderFill(sf.slider);
            onChange && onChange({ ...cur });
          });
          sliders[def.key] = { slider: sf.slider, val: sf.val, def: def, wrap: sf.wrap };
          block.appendChild(sf.wrap);
        })(defs[di]);
      }
      wrap.appendChild(block);
    }

    // ── Listening-position slider visibility ────────────────────────────────
    // In studio mode the chair follows the rig automatically (its world Z
    // is derived from spk_front_m + the equilateral-triangle offset in
    // room3d.js, with room.listener_front_m overridden at the studio
    // anchor block). The slider would have no visible effect, so hide it
    // entirely to avoid user confusion. listener_offset_m (left/right)
    // stays — it still does something in studio (asymmetric desk setups).
    function _applyListenerSliderVisibility(rt) {
      var w = sliders.listener_front_m && sliders.listener_front_m.wrap;
      if (w) w.style.display = rt === 'studio' ? 'none' : '';
    }
    _applyListenerSliderVisibility(roomType);

    // ── Speaker spacing vs inset slider visibility ──────────────────────────
    // Hi-Fi mode shows "Speaker spacing" (spk_spacing_m — absolute distance
    // between the two speakers). Studio mode shows "Speaker inset" instead
    // (spk_inset_m — how far each speaker sits inward from its desk edge);
    // room3d.js derives the true spacing from desk width minus the insets.
    // Exactly one of the two is visible at any time, so Hi-Fi behaviour is
    // unchanged and the inset slider only appears in studio.
    function _applySpacingSliderVisibility(rt) {
      var isStudio = rt === 'studio';
      var sp  = sliders.spk_spacing_m && sliders.spk_spacing_m.wrap;
      var ins = sliders.spk_inset_m   && sliders.spk_inset_m.wrap;
      if (sp)  sp.style.display  = isStudio ? 'none' : '';
      if (ins) ins.style.display = isStudio ? ''     : 'none';
    }
    _applySpacingSliderVisibility(roomType);

    // ── LOW FREQUENCY sub-section — 24 px gap after Block C ─────────────────
    var lfSection = _el('div', { style: 'margin-top:24px;' });
    var lfLabel   = _el('span', {
      class: 'demo-field-label',
      style: 'display:block;margin-bottom:6px;',
    }, 'Subs');
    lfSection.appendChild(lfLabel);

    // Single binary toggle \u2014 matches client-seating + wave-toggle pattern.
    // Tap to enable, tap again to disable. Active state is the visual cue.
    var lfRow  = _el('div', { class: 'demo-btn-row', style: 'gap:6px;' });
    var subBtn = _toggleBtn('Sub', cur.subwoofer, 'Toggle subwoofer');
    subBtn.addEventListener('click', function() {
      cur.subwoofer      = !cur.subwoofer;
      cur.subwoofer_dual = false;
      subBtn.classList.toggle('active', cur.subwoofer);
      onChange && onChange({ ...cur });
    });
    lfRow.appendChild(subBtn);
    lfSection.appendChild(lfRow);
    wrap.appendChild(lfSection);

    mount.appendChild(wrap);

    return {
      reset: function() {
        typeGroup.setActive(state.speaker_type ?? 'floorstander');
        cur.speaker_type = state.speaker_type ?? 'floorstander';
        if (placementGroup && state.spk_placement) {
          placementGroup.setActive(state.spk_placement);
          cur.spk_placement = state.spk_placement;
        }
        Object.entries(sliders).forEach(function(entry) {
          var k = entry[0], s = entry[1];
          // state may predate spk_inset_m - fall back to the live cur value
          // (already migration-defaulted to 0.20) so the slider never resets to NaN.
          var rv = state[k] !== undefined ? state[k] : cur[k];
          s.slider.value = String(rv);
          cur[k] = rv;
          s.val.textContent = s.def.unit === 'm'
            ? formatLength(rv, s.def.decimals)
            : parseFloat(rv).toFixed(s.def.decimals) + (s.def.unit === '\u00b0' ? '\u00b0' : ' ' + s.def.unit);
          _updateSliderFill(s.slider);
        });
        cur.subwoofer      = state.subwoofer      ?? false;
        cur.subwoofer_dual = state.subwoofer_dual ?? false;
        subBtn.classList.toggle('active', cur.subwoofer);
      },
      setValues: function(newState) {
        if (newState.speaker_type) {
          _setTypeActive(newState.speaker_type);
          cur.speaker_type = newState.speaker_type;
        }
        Object.entries(sliders).forEach(function(entry) {
          var k = entry[0], s = entry[1];
          if (newState[k] !== undefined) {
            var v = newState[k];
            s.slider.value = String(v);
            cur[k] = v;
            s.val.textContent = s.def.unit === 'm'
              ? formatLength(v, s.def.decimals)
              : parseFloat(v).toFixed(s.def.decimals) + (s.def.unit === '\u00b0' ? '\u00b0' : ' ' + s.def.unit);
            _updateSliderFill(s.slider);
          }
        });
        if (newState.subwoofer !== undefined) {
          cur.subwoofer      = newState.subwoofer;
          cur.subwoofer_dual = newState.subwoofer_dual ?? false;
          subBtn.classList.toggle('active', cur.subwoofer);
        }
      },
      setRoomType: function(rt) {
        _applySpkRoomType(rt);
        _applyListenerSliderVisibility(rt);
        _applySpacingSliderVisibility(rt);
      },
    };
  }

  // ── Section 5 — Seating & Furniture ──────────────────────────────────────
  // roomType: 'home' | 'studio'  — controls which sub-block is visible.
  // Exposes setRoomType(rt) so the room-type toggle can update the view.


  function renderFurnitureSection(mountId, { state = {}, roomType = 'home', onChange } = {}) {
    const mount = _mount(mountId);
    if (!mount) return null;

    let currentRoomType = roomType;

    const cur = {
      opt_area_rug:        state.opt_area_rug        ?? true,
      opt_sofa:            state.opt_sofa             ?? true,
      opt_coffee_table:    state.opt_coffee_table     ?? true,
      seating_type:        state.seating_type         ?? 'sofa',
      sofa_width_m:        state.sofa_width_m         ?? 2.8,
      opt_ottoman:         state.opt_ottoman          ?? false,
      opt_display:         state.opt_display          ?? true,
      opt_mic:             state.opt_mic              ?? false,
      opt_keyboard:        state.opt_keyboard         ?? false,
      opt_client_seating:  state.opt_client_seating   ?? false,
      client_seating_type: state.client_seating_type  ?? 'sofa',
      desk_width_m:        state.desk_width_m         ?? 1.6,
      desk_depth_m:        state.desk_depth_m         ?? 0.7,
      desk_style:          state.desk_style           ?? 'plain',
    };

    const wrap = _el('div', { style: 'display:flex;flex-direction:column;gap:10px;' });

    // ─── Hi-Fi block ────────────────────────────────────────────────────────────
    const hifiBlock = _el('div', { style: 'display:flex;flex-direction:column;gap:10px;' });

    // Hi-Fi seating: 3-icon grid  [Sofa] [Compact] [Lounge]
    // sofa → sofa_width_m=2.8, compact → 1.4, lounge → null (Eames)
    const _SEATING_MAP = {
      sofa:    { seating_type: 'sofa',   opt_sofa: true,  sofa_width_m: 2.8  },
      compact: { seating_type: 'sofa',   opt_sofa: true,  sofa_width_m: 1.4  },
      lounge:  { seating_type: 'lounge', opt_sofa: true,  sofa_width_m: null },
    };
    let _curSeatingKey = (() => {
      if (cur.seating_type === 'lounge') return 'lounge';
      return (cur.sofa_width_m ?? 2.8) <= 1.4 ? 'compact' : 'sofa';
    })();

    const seatingGroup = _iconGridSelect(
      [
        { key: 'sofa',    icon: 'sofa.svg',        label: 'Sofa'    },
        { key: 'compact', icon: 'chair.svg',        label: 'Chair'   },
        { key: 'lounge',  icon: 'lounge-chair.svg', label: 'Lounge'  },
      ],
      _curSeatingKey,
      3,
      key => {
        _curSeatingKey = key;
        const vals = _SEATING_MAP[key];
        Object.assign(cur, vals);
        // Lounge mode: suppress ottoman + coffee table icon cells
        if (key === 'lounge') {
          cur.opt_coffee_table = false;
          cur.opt_ottoman      = false;
          hifiGrid.setActive('opt_coffee_table', false);
          hifiGrid.setActive('opt_ottoman',      false);
        }
        onChange?.({ ...cur });
      }
    );
    hifiBlock.appendChild(seatingGroup.grid);


    // Hi-Fi furniture icon grid (3-col: Rug | Table | Stool)
    const hifiGrid = _iconGridToggle(
      [
        { key: 'opt_area_rug',     icon: 'rug.svg',        label: 'Rug',   active: cur.opt_area_rug },
        { key: 'opt_coffee_table', icon: 'coffee-table.svg', label: 'Table', active: cur.opt_coffee_table },
        { key: 'opt_ottoman',      icon: 'foot-stool.svg', label: 'Stool', active: cur.opt_ottoman },
      ],
      3,
      (key, val) => {
        // Lounge mode blocks ottoman + coffee table
        if (_curSeatingKey === 'lounge' && (key === 'opt_ottoman' || key === 'opt_coffee_table')) {
          hifiGrid.setActive(key, false);
          cur[key] = false;
        } else {
          cur[key] = val;
          // Coffee Table and Ottoman are mutually exclusive — you can't
          // realistically have both in front of the listener. Turning
          // one ON forces the other OFF.
          if (val && key === 'opt_coffee_table' && cur.opt_ottoman) {
            cur.opt_ottoman = false;
            hifiGrid.setActive('opt_ottoman', false);
          } else if (val && key === 'opt_ottoman' && cur.opt_coffee_table) {
            cur.opt_coffee_table = false;
            hifiGrid.setActive('opt_coffee_table', false);
          }
        }
        onChange?.({ ...cur });
      }
    );
    // Suppress cells that don't apply in initial lounge mode
    if (_curSeatingKey === 'lounge') {
      hifiGrid.setActive('opt_ottoman',      false);
      hifiGrid.setActive('opt_coffee_table', false);
      cur.opt_ottoman      = false;
      cur.opt_coffee_table = false;
    }
    hifiBlock.appendChild(hifiGrid.grid);
    wrap.appendChild(hifiBlock);


    // ─── Studio block ───────────────────────────────────────────────────────────
    const studioBlock = _el('div', { style: 'display:none;flex-direction:column;gap:10px;' });

    // Desk width slider
    const deskHdr = _el('div', { class: 'demo-field-header' });
    deskHdr.append(_el('span', { class: 'demo-field-label' }, 'Desk width'));
    const deskValEl = _el('span', { class: 'demo-field-value' }, formatLength(cur.desk_width_m, 2));
    deskHdr.appendChild(deskValEl);
    const deskSlider = _el('input', {
      type: 'range', id: 'scl-desk-width', min: '1.0', max: '2.5', step: '0.05',
      value: String(cur.desk_width_m), class: 'measurely-slider', 'aria-label': 'Desk width', 'data-acoustic': 'bass',
    });
    _updateSliderFill(deskSlider);
    const deskTicks = _el('div', { class: 'demo-slider-ticks' });
    [1.0, 1.6, 2.5].forEach(t => deskTicks.appendChild(_el('span', {}, formatLength(t, 1))));
    const deskField = _el('div', { class: 'demo-field' });
    deskField.append(deskHdr, deskSlider, deskTicks);
    studioBlock.appendChild(deskField);
    deskSlider.addEventListener('input', () => {
      cur.desk_width_m = parseFloat(deskSlider.value);
      deskValEl.textContent = formatLength(cur.desk_width_m, 2);
      _updateSliderFill(deskSlider);
      onChange?.({ ...cur });
    });

    // Desk depth slider
    const deskDHdr = _el('div', { class: 'demo-field-header' });
    deskDHdr.append(_el('span', { class: 'demo-field-label' }, 'Desk depth'));
    const deskDValEl = _el('span', { class: 'demo-field-value' }, formatLength(cur.desk_depth_m, 2));
    deskDHdr.appendChild(deskDValEl);
    const deskDSlider = _el('input', {
      type: 'range', id: 'scl-desk-depth', min: '0.5', max: '0.9', step: '0.05',
      value: String(cur.desk_depth_m), class: 'measurely-slider', 'aria-label': 'Desk depth', 'data-acoustic': 'reflection',
    });
    _updateSliderFill(deskDSlider);
    const deskDTicks = _el('div', { class: 'demo-slider-ticks' });
    [0.5, 0.7, 0.9].forEach(t => deskDTicks.appendChild(_el('span', {}, formatLength(t, 1))));
    const deskDField = _el('div', { class: 'demo-field' });
    deskDField.append(deskDHdr, deskDSlider, deskDTicks);
    studioBlock.appendChild(deskDField);
    deskDSlider.addEventListener('input', () => {
      cur.desk_depth_m = parseFloat(deskDSlider.value);
      deskDValEl.textContent = formatLength(cur.desk_depth_m, 2);
      _updateSliderFill(deskDSlider);
      onChange?.({ ...cur });
    });

    // Desk style selector (plain / production) — mirrors the placement btn-group
    const deskStyleHdr = _el('div', { class: 'demo-field-header' });
    deskStyleHdr.append(_el('span', { class: 'demo-field-label' }, 'Desk style'));
    studioBlock.appendChild(deskStyleHdr);
    const deskStyleGroup = _btnGroup(
      [
        { key: 'plain',      label: 'Plain' },
        { key: 'production', label: 'Production' },
      ],
      cur.desk_style ?? 'plain',
      function (key) { cur.desk_style = key; onChange?.({ ...cur }); }
    );
    studioBlock.appendChild(deskStyleGroup.row);

    // Studio furniture icon grid (3-col: Display | Mic | Keys | Rug)
    const studioGrid = _iconGridToggle(
      [
        { key: 'opt_display',  icon: 'monitor.svg',    label: 'Display', active: cur.opt_display },
        { key: 'opt_mic',      icon: 'mic.svg',         label: 'Mic',     active: cur.opt_mic },
        { key: 'opt_keyboard', icon: 'wave-square.svg',   label: 'Keys',    active: cur.opt_keyboard },
        { key: 'opt_area_rug', icon: 'rug.svg',           label: 'Rug',     active: cur.opt_area_rug },
      ],
      3,
      (key, val) => {
        cur[key] = val;
        onChange?.({ ...cur });
      }
    );
    studioBlock.appendChild(studioGrid.grid);
    wrap.appendChild(studioBlock);


    // ─── Client seating sub-section (studio mode only) ──────────────────────
    const clientDivider = _el('hr', { style: 'display:none;border:none;border-top:1px solid var(--mly-border,rgba(0,0,0,.1));margin:4px 0;' });
    wrap.appendChild(clientDivider);

    const clientWrap = _el('div', { style: 'display:none;flex-direction:column;gap:8px;' });
    const clientHdr  = _el('div', { style: 'display:flex;align-items:center;justify-content:space-between;' });
    clientHdr.append(_el('span', { class: 'demo-field-label' }, 'Client seating'));
    const clientToggleBtn = _toggleBtn(cur.opt_client_seating ? 'On' : 'Off', cur.opt_client_seating);
    clientToggleBtn.style.fontSize = '0.72rem';
    clientHdr.appendChild(clientToggleBtn);
    clientWrap.appendChild(clientHdr);

    // Type selector (sofa / lounge) — visible only when client seating is on
    const clientTypeRow = _el('div', { class: 'demo-btn-row' });
    clientTypeRow.style.display = cur.opt_client_seating ? '' : 'none';
    const csSofaBtn   = _toggleBtn('Sofa',   cur.client_seating_type === 'sofa');
    const csLoungeBtn = _toggleBtn('Lounge', cur.client_seating_type === 'lounge');
    if (cur.client_seating_type === 'sofa')   csSofaBtn.classList.add('active');
    if (cur.client_seating_type === 'lounge') csLoungeBtn.classList.add('active');
    csSofaBtn.addEventListener('click',   () => { cur.client_seating_type = 'sofa';   csSofaBtn.classList.add('active'); csLoungeBtn.classList.remove('active'); onChange?.({ ...cur }); });
    csLoungeBtn.addEventListener('click', () => { cur.client_seating_type = 'lounge'; csLoungeBtn.classList.add('active'); csSofaBtn.classList.remove('active'); onChange?.({ ...cur }); });
    clientTypeRow.append(csSofaBtn, csLoungeBtn);
    clientWrap.appendChild(clientTypeRow);

    clientToggleBtn.addEventListener('click', () => {
      cur.opt_client_seating = !cur.opt_client_seating;
      clientToggleBtn.classList.toggle('active', cur.opt_client_seating);
      clientToggleBtn.textContent = cur.opt_client_seating ? 'On' : 'Off';
      clientTypeRow.style.display = cur.opt_client_seating ? '' : 'none';
      onChange?.({ ...cur });
    });
    wrap.appendChild(clientWrap);
    mount.appendChild(wrap);

    // ─── Room type visibility helper ─────────────────────────────────────────
    function _applyRoomType(rt) {
      currentRoomType = rt;
      hifiBlock.style.display      = rt === 'studio' ? 'none'  : 'flex';
      studioBlock.style.display    = rt === 'studio' ? 'flex'  : 'none';
      clientDivider.style.display  = rt === 'studio' ? ''      : 'none';
      clientWrap.style.display     = rt === 'studio' ? 'flex'  : 'none';
    }
    _applyRoomType(currentRoomType);

    return {
      setRoomType(rt) { _applyRoomType(rt); },
      // Reflect an external set of furniture flags into the button states —
      // mirrors speakersAPI.setValues. One-way "adopt this state" update used
      // when a consumer changes the underlying flags (e.g. a room-type switch
      // reseeds opt_* furniture defaults): merge the flags into `cur`, then
      // re-derive every grid's active state the SAME way construction does.
      // Deliberately does NOT call onChange — this is not a user edit, so it
      // must not write back to the consumer or create a feedback loop.
      setValues(flags) {
        if (!flags) return;
        const FURN_KEYS = ['opt_area_rug', 'opt_sofa', 'opt_coffee_table',
                           'seating_type', 'sofa_width_m', 'opt_ottoman',
                           'opt_display', 'opt_mic', 'opt_keyboard',
                           'opt_client_seating', 'client_seating_type', 'desk_style'];
        for (const k of FURN_KEYS) {
          if (flags[k] !== undefined) cur[k] = flags[k];
        }
        // Seating single-select — same derivation as construction (~842-845).
        _curSeatingKey = (cur.seating_type === 'lounge')
          ? 'lounge'
          : ((cur.sofa_width_m ?? 2.8) <= 1.4 ? 'compact' : 'sofa');
        seatingGroup.setActive(_curSeatingKey);
        // Lounge suppresses coffee table + ottoman (mirrors the seating onChange).
        if (_curSeatingKey === 'lounge') {
          cur.opt_coffee_table = false;
          cur.opt_ottoman      = false;
        }
        // Re-apply every furniture grid's active state from the merged `cur`.
        hifiGrid.setActive('opt_area_rug',     cur.opt_area_rug);
        hifiGrid.setActive('opt_coffee_table', cur.opt_coffee_table);
        hifiGrid.setActive('opt_ottoman',      cur.opt_ottoman);
        studioGrid.setActive('opt_display',    cur.opt_display);
        studioGrid.setActive('opt_mic',        cur.opt_mic);
        studioGrid.setActive('opt_keyboard',   cur.opt_keyboard);
        studioGrid.setActive('opt_area_rug',   cur.opt_area_rug);
        deskStyleGroup.setActive(cur.desk_style ?? 'plain');
        clientToggleBtn.classList.toggle('active', cur.opt_client_seating);
        clientToggleBtn.textContent = cur.opt_client_seating ? 'On' : 'Off';
        clientTypeRow.style.display = cur.opt_client_seating ? '' : 'none';
      },
      reset() {
        _curSeatingKey = 'sofa';
        seatingGroup.setActive('sofa');
        Object.assign(cur, _SEATING_MAP['sofa']);
        cur.opt_area_rug        = state.opt_area_rug        ?? true;
        cur.opt_coffee_table    = state.opt_coffee_table    ?? true;
        cur.opt_ottoman         = state.opt_ottoman         ?? false;
        cur.opt_display         = state.opt_display         ?? true;
        cur.opt_mic             = state.opt_mic             ?? false;
        cur.opt_keyboard        = state.opt_keyboard        ?? false;
        cur.opt_client_seating  = state.opt_client_seating  ?? false;
        cur.client_seating_type = state.client_seating_type ?? 'sofa';
        cur.desk_style          = state.desk_style          ?? 'plain';
        // Restore icon grid states
        hifiGrid.setActive('opt_area_rug',     cur.opt_area_rug);
        hifiGrid.setActive('opt_coffee_table', cur.opt_coffee_table);
        hifiGrid.setActive('opt_ottoman',      cur.opt_ottoman);
        studioGrid.setActive('opt_display',    cur.opt_display);
        studioGrid.setActive('opt_mic',        cur.opt_mic);
        studioGrid.setActive('opt_keyboard',   cur.opt_keyboard);
        studioGrid.setActive('opt_area_rug',   cur.opt_area_rug);
        deskStyleGroup.setActive(cur.desk_style ?? 'plain');
        clientToggleBtn.classList.toggle('active', cur.opt_client_seating);
        clientToggleBtn.textContent = cur.opt_client_seating ? 'On' : 'Off';
        clientTypeRow.style.display = cur.opt_client_seating ? '' : 'none';
        _applyRoomType(currentRoomType);
      },
    };
  }

  // ── Section 6 — Floor ─────────────────────────────────────────────────────

  function renderFloorSection(mountId, { state = {}, onChange } = {}) {
    const mount = _mount(mountId);
    if (!mount) return null;

    const cur = {
      floor_material: state.floor_material ?? 'hard',
    };

    const wrap = _el('div', { style: 'display:flex;flex-direction:column;gap:6px;' });

    // 2-column icon-select grid for floor type
    const floorGrid = _iconGridSelect(
      [
        { key: 'hard',   icon: 'mountain.svg',    label: 'Hard' },
        { key: 'carpet', icon: 'wave-square.svg',  label: 'Carpet' },
      ],
      cur.floor_material,
      2,
      key => {
        cur.floor_material = key;
        onChange?.({ ...cur });
      }
    );
    wrap.appendChild(floorGrid.grid);
    mount.appendChild(wrap);

    return {
      setRoomType(rt) {}, // no-op for floor
      reset() {
        cur.floor_material = state.floor_material ?? 'hard';
        floorGrid.setActive(cur.floor_material);
      },
    };
  }

  // ── Section 7 — Treatment ─────────────────────────────────────────────────
  // Delegates to treatment-registry.js; wraps its API for consistency.

  function renderTreatmentSection(mountId, { types, state, defaultColour, colours, onTreatmentChange, onColourChange } = {}) {
    const MT = window.MeasurelyTreatment;
    if (!MT) {
      console.warn('[MeasurelySCL] treatment-registry.js not loaded');
      return null;
    }
    // Default resolved here (not in the destructure) because MT is
    // function-scoped — referencing it in the parameter pattern would
    // throw before this assignment runs.
    if (colours === undefined) colours = MT.PANEL_COLOURS;
    const api = MT.initTreatmentControls({
      mountId, types, state, defaultColour,
      colours,
      onTreatmentChange, onColourChange,
    });
    return api;
  }

  // ── Section 8 — Wave Toggle ───────────────────────────────────────────────

  function renderWaveToggle(mountId, { checked = true, label = 'Sound waves', onChange } = {}) {
    const mount = _mount(mountId);
    if (!mount) return null;

    const row  = _el('div', { style: 'display:flex;align-items:center;justify-content:space-between;' });
    const lbl  = _el('span', { class: 'demo-field-label' }, label);
    const btn  = _toggleBtn('On', checked);
    btn.style.fontSize = '0.72rem';

    let state = checked;
    btn.addEventListener('click', () => {
      state = !state;
      btn.classList.toggle('active', state);
      btn.textContent = state ? 'On' : 'Off';
      onChange?.(state);
    });

    row.append(lbl, btn);
    mount.appendChild(row);

    return {
      reset() {
        state = checked;
        btn.classList.toggle('active', state);
        btn.textContent = state ? 'On' : 'Off';
      },
    };
  }

  // ── Section — Sound Burst trigger (showpiece) ─────────────────────────────
  // A single fire button for the Sound Burst showpiece. One-shot, re-fireable.
  // onFire: fn() — wire to room3D.fireSoundBurst().
  //   renderSoundBurstSection(mountId, { label, onFire })

  function renderSoundBurstSection(mountId, { label = 'Play sound burst', onFire } = {}) {
    const mount = _mount(mountId);
    if (!mount) return null;

    const row = _el('div', { class: 'demo-btn-row' });
    const btn = _el('button', { class: 'sbox-btn', type: 'button' }, label);
    btn.addEventListener('click', () => onFire?.());
    row.appendChild(btn);
    mount.appendChild(row);

    return {
      fire() { onFire?.(); },
      reset() {},
    };
  }

  // ── Section — Peaks & dips frequency sweep ────────────────────────────────
  // A single range slider (20–240 Hz) for the Peaks & dips overlay. Mount it
  // when that overlay is active; wire onChange to room3D.setPeaksFreq(hz) so the
  // slab re-forms as you scrub. Debounce is unnecessary — the engine re-bakes on
  // change (not per frame) and the bake is fast — but callers may throttle.
  //   renderPeaksFreqSlider(mountId, { value, min, max, onChange })
  function renderPeaksFreqSlider(mountId, { value = 50, min = 20, max = 240, onChange } = {}) {
    const mount = _mount(mountId);
    if (!mount) return null;

    const wrap = _el('div', { style: 'display:flex;flex-direction:column;gap:12px;' });
    const { wrap: fw, slider, val } = _sliderField({
      label: 'Frequency', id: 'scl-peaks-freq',
      min, max, step: 1, value, unit: 'Hz', decimals: 0, acoustic: 'peaks_dips',
    });
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      val.textContent = v.toFixed(0) + ' Hz';
      _updateSliderFill(slider);
      onChange?.(v);
    });
    wrap.appendChild(fw);
    mount.appendChild(wrap);

    return {
      setValue(v) {
        slider.value = String(v);
        val.textContent = Math.round(v) + ' Hz';
        _updateSliderFill(slider);
      },
      reset() { this.setValue(value); },
    };
  }

  // ── Section — Club: dance floor capacity ───────────────────────────────────
  // Club-only. Crowd limit is capped by room floor area (packed density,
  // 4 people/m² — the "up to 4 packed" figure from the club brief) so the
  // slider can't be set higher than the floor can actually hold. Caller
  // pushes floor area in via setArea() whenever the room width/length
  // sliders (renderRoomSection) change, since the dance floor *is* the
  // room floor for this room_type.
  //   renderClubSection(mountId, { state: { crowd_limit, area_m2 }, onChange })
  function renderClubSection(mountId, { state = {}, onChange } = {}) {
    const mount = _mount(mountId);
    if (!mount) return null;

    const PACKED_DENSITY = 4; // people/m² — see brief: 2/m² comfortable, up to 4/m² packed
    const cur = {
      crowd_limit: state.crowd_limit ?? 200,
    };
    let areaM2 = state.area_m2 ?? 0;

    const wrap = _el('div', { style: 'display:flex;flex-direction:column;gap:12px;' });

    const maxReadout = _el('div', {
      style: 'font-size:0.72rem;color:var(--rt-text-muted,#888);line-height:1.4;'
    });
    wrap.appendChild(maxReadout);

    const { wrap: limitWrap, slider: limitSlider, val: limitVal } = _sliderField({
      label: 'Crowd limit', id: 'scl-crowd-limit',
      min: 50, max: Math.max(50, Math.round(areaM2 * PACKED_DENSITY)) || 500, step: 50,
      value: cur.crowd_limit, unit: ' people', decimals: 0,
      ariaLabel: 'Crowd limit',
    });
    limitSlider.addEventListener('input', () => {
      const v = parseInt(limitSlider.value, 10);
      cur.crowd_limit = v;
      limitVal.textContent = String(v) + ' people';
      _updateSliderFill(limitSlider);
      onChange?.({ ...cur });
    });
    wrap.appendChild(limitWrap);

    function _updateCapacity() {
      const maxCap = Math.max(50, Math.round(areaM2 * PACKED_DENSITY));
      maxReadout.textContent = areaM2 > 0
        ? `Max ${maxCap} people (${Math.round(areaM2)} m² floor × ${PACKED_DENSITY}/m² packed)`
        : '';
      limitSlider.max = String(maxCap);
      if (cur.crowd_limit > maxCap) {
        cur.crowd_limit = maxCap;
        limitSlider.value = String(maxCap);
        limitVal.textContent = String(maxCap) + ' people';
        _updateSliderFill(limitSlider);
        onChange?.({ ...cur });
      }
    }
    _updateCapacity();

    mount.appendChild(wrap);

    return {
      reset() {
        cur.crowd_limit = state.crowd_limit ?? 200;
        limitSlider.value = String(cur.crowd_limit);
        limitVal.textContent = String(cur.crowd_limit) + ' people';
        _updateSliderFill(limitSlider);
      },
      // Pushed by the caller whenever room width/length change — the dance
      // floor area comes from the room geometry section, not a slider here.
      setArea(area_m2) {
        areaM2 = area_m2;
        _updateCapacity();
      },
    };
  }

  // ── Section — Club: PA rig placement (tops + bass bins) ────────────────────
  // Club-only. Coverage-driven placement, not imaging — no tweeter-height
  // slider (assumes a stereo sweet spot, which doesn't apply here). No tilt
  // slider — room3d.js derives the downward aim from mount height +
  // distance so the tops always point at ear height on the dance floor
  // centre, not an arbitrary fixed angle. Bass bins live here (they're
  // part of the PA system, not booth furniture) even though the 'centre'
  // placement mode visually sits under the booth — booth-only controls
  // (decks, riser, booth position) are in renderClubBoothSection instead.
  //   renderClubSpeakersSection(mountId, { state: { spk_spacing_m, pa_mount_height_m, toe_in_deg, rear_pa, bass_bin_placement, bass_bin_count, spk_front_m }, onChange })
  //
  // ── PA sizing estimate ──────────────────────────────────────────────────
  // Ballpark sound-reinforcement design math, not a measured prediction:
  // inverse-square throw loss + a rough crowd-absorption penalty (packed
  // bodies eat high-frequency energy), solved for box count via power
  // summation (+10*log10(N) per doubling, the conservative/incoherent
  // assumption). Sub count is a straight people-per-box rule of thumb.
  // Intended as a starting-point readout, not a spec.
  function _paRecommendation(width_m, length_m, crowd_limit) {
    const TARGET_SPL_DB = 105;       // dB(C) average at the back of the crowd
    const TOP_RATING_1M_DB = 126;    // typical mid-size 2-way top, continuous @1m
    const throw_m = Math.max(1, length_m * 0.9);
    const density = crowd_limit / Math.max(1, width_m * length_m); // people/m2
    const crowdLossDb = Math.min(4, density * 1.0);
    const required1mDb = TARGET_SPL_DB + 20 * Math.log10(throw_m) + crowdLossDb;
    const deficitDb = required1mDb - TOP_RATING_1M_DB;
    const topsPerSide = deficitDb <= 0 ? 1 : Math.ceil(Math.pow(10, deficitDb / 10));
    const subCount = Math.max(2, Math.ceil(crowd_limit / 65));
    const coverageDeg = Math.round(2 * Math.atan((width_m / 2) / throw_m) * 180 / Math.PI);
    return { topsPerSide, subCount, coverageDeg, throw_m };
  }

  // Shared normaliser: bass_bin_placement accepts a legacy string
  // ('centre'/'corners'/'rear_corners'/'both_corners') or the current
  // array-of-keys form; always returns a non-empty array.
  function _normaliseBinPlacement(p) {
    if (Array.isArray(p)) return p.length ? [...p] : ['centre'];
    if (p === 'both_corners') return ['corners', 'rear_corners'];
    return [p || 'centre'];
  }

  function renderClubSpeakersSection(mountId, { state = {}, onChange } = {}) {
    const mount = _mount(mountId);
    if (!mount) return null;

    const cur = {
      spk_spacing_m:      state.spk_spacing_m      ?? 6.0,
      pa_mount_height_m:  state.pa_mount_height_m  ?? 3.0,
      pa_mount:           state.pa_mount           ?? 'wall',
      toe_in_deg:         state.toe_in_deg         ?? 10,
      rear_pa:            state.rear_pa            ?? false,
      // Multi-select: an ARRAY of placement keys ('centre' | 'corners' |
      // 'rear_corners') so stacks can combine — e.g. centre under the
      // booth PLUS rear-corner fill towers. Legacy string values (incl.
      // 'both_corners') are normalised to the array form here.
      bass_bin_placement: _normaliseBinPlacement(state.bass_bin_placement),
      bass_bin_count:     state.bass_bin_count     ?? 2,
      spk_front_m:        state.spk_front_m        ?? 1.0,
      width_m:            state.width_m             ?? 10,
      length_m:           state.length_m            ?? 10,
      crowd_limit:        state.crowd_limit         ?? 200,
    };

    const wrap = _el('div', { style: 'display:flex;flex-direction:column;gap:12px;' });

    // Readout box -- recalculated whenever room dims, crowd limit, or
    // the sliders below change, via _paRecommendation().
    const paRecWrap = _el('div', {
      style: 'background:#f7f7f7;border:1px solid #e0e0e0;padding:10px 12px;font-size:0.78rem;line-height:1.6;color:#1a1a1a;'
    });
    wrap.appendChild(paRecWrap);
    function _renderPaRec() {
      const rec = _paRecommendation(cur.width_m, cur.length_m, cur.crowd_limit);
      paRecWrap.innerHTML =
        `<div style="font-weight:700;text-transform:uppercase;font-size:0.68rem;letter-spacing:0.5px;color:#888;margin-bottom:4px;">PA Estimate</div>` +
        `${rec.topsPerSide}× top per side · ${rec.subCount}× dual-18&quot; sub · ~${rec.coverageDeg}&deg; coverage`;
    }
    _renderPaRec();

    const defs = [
      { key: 'spk_spacing_m',     label: 'Top spacing',      min: 2.0, max: 10.0, step: 0.1, unit: 'm', decimals: 1, hl: 'speakers' },
      { key: 'pa_mount_height_m', label: 'Top mount height', min: 1.5, max: 4.5,  step: 0.1, unit: 'm', decimals: 1, hl: 'speakers' },
      // Coverage-driven, not imaging -- kept modest (0-25°) so it tunes
      // side-wall/centre coverage evenness rather than a hi-fi stereo
      // triangle toe angle.
      { key: 'toe_in_deg',        label: 'Top toe-in',       min: 0,   max: 25,   step: 1,   unit: '°', decimals: 0, hl: 'speakers' },
      { key: 'spk_front_m',       label: 'Bass bins from front wall', min: 0.2, max: 3.0, step: 0.1, unit: 'm', decimals: 1, hl: 'speakers' },
    ];

    // Top mount: permanent wall-bracket install vs portable tripod
    // stands — geometry (and the crowd-map source standoff) follow it.
    const mountWrap = _el('div', { class: 'demo-field', style: 'margin-top:4px;' });
    const mountHdr = _el('div', { class: 'demo-field-header' });
    mountHdr.appendChild(_el('span', { class: 'demo-field-label' }, 'Top Mount'));
    mountWrap.appendChild(mountHdr);
    const mountGroup = _btnGroup(
      [
        { key: 'wall',   label: 'Wall',   title: 'Permanent install: wall brackets at height' },
        { key: 'tripod', label: 'Tripod', title: 'Portable rig: speaker poles on tripod stands' }
      ],
      cur.pa_mount,
      (key) => {
        cur.pa_mount = key;
        onChange?.({ ...cur });
      }
    );
    mountWrap.appendChild(mountGroup.row);
    wrap.appendChild(mountWrap);

    const rearPaWrap = _el('div', { class: 'demo-field', style: 'margin-top:4px;' });
    const rearPaHdr = _el('div', { class: 'demo-field-header' });
    const rearPaLbl = _el('span', { class: 'demo-field-label' }, 'Rear PA (4-Point)');
    rearPaHdr.appendChild(rearPaLbl);
    rearPaWrap.appendChild(rearPaHdr);

    const rearPaGroup = _btnGroup(
      [
        { key: 'off', label: 'Off', title: 'Front PA only' },
        { key: 'on',  label: 'On',  title: 'Add mirrored PA at rear wall' }
      ],
      cur.rear_pa ? 'on' : 'off',
      (key) => {
        cur.rear_pa = key === 'on';
        onChange?.({ ...cur });
      }
    );
    rearPaWrap.appendChild(rearPaGroup.row);
    wrap.appendChild(rearPaWrap);

    const binPlacementWrap = _el('div', { class: 'demo-field', style: 'margin-top:4px;' });
    const binPlacementHdr = _el('div', { class: 'demo-field-header' });
    binPlacementHdr.appendChild(_el('span', { class: 'demo-field-label' }, 'Bass Bin Placement'));
    binPlacementWrap.appendChild(binPlacementHdr);
    // Multi-select toggle row (not _btnGroup, which is exclusive): each
    // placement toggles independently so stacks combine — centre under
    // the booth plus rear fill towers, etc. The old exclusive "Both"
    // option is gone; Front + Rear toggled together covers it. At least
    // one placement stays active (clicking the last active one is a
    // no-op) — bass_bin_count still controls how many bins per stack.
    const binPlacementRow = _el('div', { class: 'demo-btn-row' });
    const binPlacementBtns = {};
    [
      { key: 'centre',       label: 'Centre', title: 'Mono stack under the booth' },
      { key: 'corners',      label: 'Front',  title: 'Stacks at both front corners' },
      { key: 'rear_corners', label: 'Rear',   title: 'Stacks at both rear corners (fill for a long floor)' },
    ].forEach(({ key, label, title }) => {
      const btn = _el('button', {
        class: 'sbox-btn' + (cur.bass_bin_placement.includes(key) ? ' active' : ''),
        type: 'button',
        title,
      }, label);
      btn.addEventListener('click', () => {
        const has = cur.bass_bin_placement.includes(key);
        if (has && cur.bass_bin_placement.length === 1) return; // keep one
        cur.bass_bin_placement = has
          ? cur.bass_bin_placement.filter(k => k !== key)
          : [...cur.bass_bin_placement, key];
        btn.classList.toggle('active', !has);
        onChange?.({ ...cur });
      });
      binPlacementBtns[key] = btn;
      binPlacementRow.appendChild(btn);
    });
    binPlacementRow.style.display = 'grid';
    binPlacementRow.style.gridTemplateColumns = 'repeat(3, 1fr)';
    binPlacementRow.style.gap = '5px';
    binPlacementWrap.appendChild(binPlacementRow);
    wrap.appendChild(binPlacementWrap);

    // Buttons, not a slider -- 2/3/4 is a small, discrete set (matching
    // real cabinet-count options), not a continuous range.
    const binCountWrap = _el('div', { class: 'demo-field', style: 'margin-top:4px;' });
    const binCountHdr = _el('div', { class: 'demo-field-header' });
    binCountHdr.appendChild(_el('span', { class: 'demo-field-label' }, 'Bass Bins (Mono Stack)'));
    binCountWrap.appendChild(binCountHdr);
    const binCountGroup = _btnGroup(
      [{ key: '2', label: '2' }, { key: '3', label: '3' }, { key: '4', label: '4' }],
      String(cur.bass_bin_count),
      (key) => { cur.bass_bin_count = parseInt(key, 10); onChange?.({ ...cur }); }
    );
    binCountWrap.appendChild(binCountGroup.row);
    wrap.appendChild(binCountWrap);

    const sliders = {};
    for (const def of defs) {
      const { wrap: fw, slider, val } = _sliderField({
        label: def.label, id: 'scl-club-' + def.key,
        min: def.min, max: def.max, step: def.step,
        value: cur[def.key], unit: def.unit, decimals: def.decimals,
      });
      _attachHighlight(slider, def.hl);
      slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        cur[def.key] = v;
        val.textContent = def.unit ? (def.unit === 'm' ? formatLength(v, def.decimals) : v.toFixed(def.decimals) + ' ' + def.unit) : String(v);
        _updateSliderFill(slider);
        onChange?.({ ...cur });
      });
      sliders[def.key] = { slider, val, def };
      wrap.appendChild(fw);
    }

    mount.appendChild(wrap);

    return {
      reset() {
        for (const [k, { slider, val, def }] of Object.entries(sliders)) {
          slider.value = String(state[k] ?? cur[k]);
          cur[k] = parseFloat(slider.value);
          val.textContent = def.unit ? (def.unit === 'm' ? formatLength(cur[k], def.decimals) : cur[k].toFixed(def.decimals) + ' ' + def.unit) : String(cur[k]);
          _updateSliderFill(slider);
        }
      },
      // Called by app.js whenever room dimensions or crowd_limit change
      // elsewhere in the sidebar, so the PA estimate stays live.
      setRoomContext(width_m, length_m, crowd_limit) {
        cur.width_m = width_m;
        cur.length_m = length_m;
        cur.crowd_limit = crowd_limit;
        _renderPaRec();
      },
    };
  }

  // ── Section — Club: DJ booth (decks, riser, booth position) ────────────────
  // Club-only. Everything anchored to the booth/desk itself -- deck
  // type/count, riser platform, and booth position. Bass bins are in
  // renderClubSpeakersSection instead (they're part of the PA system, not
  // booth furniture, even though 'centre' placement visually sits under
  // the booth).
  //   renderClubBoothSection(mountId, { state: { deck_config, dj_riser_enabled, booth_front_m, booth_offset_m }, onChange, maxBoothFront })
  function renderClubBoothSection(mountId, { state = {}, onChange, maxBoothFront } = {}) {
    const mount = _mount(mountId);
    if (!mount) return null;

    const cur = {
      deck_config:      state.deck_config      ?? 'both',
      dj_riser_enabled: state.dj_riser_enabled ?? true,
      booth_front_m:    state.booth_front_m    ?? 0.75,
      booth_offset_m:   state.booth_offset_m   ?? 0,
    };

    const wrap = _el('div', { style: 'display:flex;flex-direction:column;gap:12px;' });

    function _toggleField(label, options, activeKey, onPick) {
      const fWrap = _el('div', { class: 'demo-field', style: 'margin-top:4px;' });
      const fHdr = _el('div', { class: 'demo-field-header' });
      fHdr.appendChild(_el('span', { class: 'demo-field-label' }, label));
      fWrap.appendChild(fHdr);
      const group = _btnGroup(options, activeKey, onPick);
      fWrap.appendChild(group.row);
      wrap.appendChild(fWrap);
      return group;
    }

    _toggleField('Decks', [
      { key: 'turntables', label: 'Turntables', title: '2 turntables' },
      { key: 'cdj',        label: 'CDJs',        title: '2 CDJs, no tonearm' },
      { key: 'both',       label: '4 (Both)',    title: '4-deck mixed layout: 2 turntables + 2 CDJs' },
    ], cur.deck_config, (key) => { cur.deck_config = key; onChange?.({ ...cur }); });

    _toggleField('Riser Platform', [
      { key: 'off', label: 'Off', title: 'Desk sits flush on the floor' },
      { key: 'on',  label: 'On',  title: 'Raised platform under the desk and DJ' },
    ], cur.dj_riser_enabled ? 'on' : 'off', (key) => {
      cur.dj_riser_enabled = key === 'on';
      onChange?.({ ...cur });
    });

    // "Booth forward / back" -- was capped at a fixed 2.5m, which didn't
    // let the booth slide all the way to room centre on anything but a
    // small floor. Max is now dynamic (maxBoothFront, defaults to 2.5 if
    // not passed) -- the caller recomputes and calls setMaxBoothFront()
    // whenever room length changes, same live-update pattern
    // renderClubSection uses for crowd-limit's area-derived max.
    const defs = [
      { key: 'booth_front_m',  label: 'Booth forward / back', min: 0.2,  max: maxBoothFront ?? 2.5, step: 0.1, unit: 'm', decimals: 1, hl: 'speakers' },
      { key: 'booth_offset_m', label: 'Booth left / right',    min: -3.0, max: 3.0, step: 0.1, unit: 'm', decimals: 1, hl: 'speakers' },
    ];

    const sliders = {};
    for (const def of defs) {
      const { wrap: fw, slider, val } = _sliderField({
        label: def.label, id: 'scl-club-booth-' + def.key,
        min: def.min, max: def.max, step: def.step,
        value: cur[def.key], unit: def.unit, decimals: def.decimals,
      });
      _attachHighlight(slider, def.hl);
      slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        cur[def.key] = v;
        val.textContent = formatLength(v, def.decimals);
        _updateSliderFill(slider);
        onChange?.({ ...cur });
      });
      sliders[def.key] = { slider, val, def };
      wrap.appendChild(fw);
    }

    mount.appendChild(wrap);

    return {
      reset() {
        for (const [k, { slider, val, def }] of Object.entries(sliders)) {
          slider.value = String(state[k] ?? cur[k]);
          cur[k] = parseFloat(slider.value);
          val.textContent = formatLength(cur[k], def.decimals);
          _updateSliderFill(slider);
        }
      },
      // Called by the caller whenever room length changes -- widens (or
      // shrinks) the "Booth forward / back" ceiling so it always reaches
      // room centre, clamping the current value down if it's now past
      // the new max.
      setMaxBoothFront(maxM) {
        const { slider, val, def } = sliders.booth_front_m;
        def.max = maxM;
        slider.max = String(maxM);
        if (cur.booth_front_m > maxM) {
          cur.booth_front_m = maxM;
          slider.value = String(maxM);
          val.textContent = formatLength(maxM, def.decimals);
          _updateSliderFill(slider);
          onChange?.({ ...cur });
        }
      },
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    setUnitSystem,
    getUnitSystem,
    renderRoomTypeToggle,
    renderAnalysisOverlaySection,
    renderRoomSection,
    renderCeilingSection,
    renderScreenTypeSection,
    renderSpeakerLayoutSection,
    renderSeatCountSection,
    renderRowCountSection,
    renderCinemaSeatingTypeSection,
    renderSeatingPositionSection,
    renderSpeakersSection,
    renderFurnitureSection,
    renderFloorSection,
    renderTreatmentSection,
    renderWaveToggle,
    renderSoundBurstSection,
    renderPeaksFreqSlider,
    renderClubSection,
    renderClubSpeakersSection,
    renderClubBoothSection,
  };
});
