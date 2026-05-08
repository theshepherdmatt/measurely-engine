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

  // Builds a labelled slider field: label + value display + range input
  function _sliderField({ label, id, min, max, step, value, unit = '', decimals = 1, ariaLabel, acoustic }) {
    const wrap  = _el('div', { class: 'demo-field' });
    const hdr   = _el('div', { class: 'demo-field-header' });
    const lbl   = _el('span', { class: 'demo-field-label' }, label);
    const val   = _el('span', { class: 'demo-field-value', id: id + '-val' },
                       (parseFloat(value).toFixed(decimals)) + (unit ? ' ' + unit : ''));
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
    },
    studio: {
      room_type:           'studio',
      speaker_type:        'monitor',
      spk_front_m:         0.6,
      spk_spacing_m:       1.8,
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

    const _TOGGLE_IDS = { home: 'select-hifi', studio: 'select-studio' };
    const _LABELS     = { home: 'Hi-Fi', studio: 'Studio' };

    // Live current key — fixes getActive() previously returning stale `initial`
    let currentKey = initial;

    // Forward declaration — populated below if collapsible
    let summaryEl = null;
    const _summaryText = key => collapsedLabel + ' · ' + _LABELS[key];

    const gridResult = _iconGridSelect(
      [
        { key: 'home',   icon: 'hifi.svg',   label: _LABELS.home   },
        { key: 'studio', icon: 'studio.svg', label: _LABELS.studio },
      ],
      initial,
      2,
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

  function renderRoomSection(mountId, { state = {}, onChange } = {}) {
    const mount = _mount(mountId);
    if (!mount) return null;

    const cur = { width_m: state.width_m ?? 4.2, length_m: state.length_m ?? 5.5, height_m: state.height_m ?? 2.6 };
    const wrap = _el('div', { style: 'display:flex;flex-direction:column;gap:12px;' });

    const defs = [
      { label: 'Room width',  key: 'width_m',  min: 2.0, max: 8.0,  step: 0.1,  unit: 'm', decimals: 1, hl: 'wall_width',  acoustic: 'sbir' },
      { label: 'Room length', key: 'length_m', min: 2.5, max: 10.0, step: 0.1,  unit: 'm', decimals: 1, hl: 'wall_length', acoustic: 'sbir' },
      { label: 'Room height', key: 'height_m', min: 2.0, max: 4.0,  step: 0.05, unit: 'm', decimals: 1, hl: 'wall_height', acoustic: 'sbir' },
    ];

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
        val.textContent = v.toFixed(def.decimals) + ' ' + def.unit;
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
          val.textContent = parseFloat(state[k]).toFixed(def.decimals) + ' ' + def.unit;
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
    // Replace the sbox-btn class with room-sel-btn on the emitted buttons
    typeGroup.row.querySelectorAll('.sbox-btn').forEach(function(b) {
      b.className = b.className.replace('sbox-btn', 'room-sel-btn');
    });
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
      secVal.textContent = v.toFixed(1) + ' m';
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
        secVal.textContent = cur.ceiling_height_secondary_m.toFixed(1) + ' m';
        _updateSliderFill(secSlider);
        _updateSubControls();
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

    const placementGroup = _btnGroup(
      [
        { key: 'stands',      label: 'Stands'      },
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
            sf.val.textContent = v.toFixed(def.decimals) + (def.unit === '\u00b0' ? '\u00b0' : ' ' + def.unit);
            _updateSliderFill(sf.slider);
            onChange && onChange({ ...cur });
          });
          sliders[def.key] = { slider: sf.slider, val: sf.val, def: def };
          block.appendChild(sf.wrap);
        })(defs[di]);
      }
      wrap.appendChild(block);
    }

    // ── LOW FREQUENCY sub-section — 24 px gap after Block C ─────────────────
    var lfSection = _el('div', { style: 'margin-top:24px;' });
    var lfLabel   = _el('span', {
      class: 'demo-field-label',
      style: 'display:block;margin-bottom:6px;',
    }, 'Subs');
    lfSection.appendChild(lfLabel);

    var _subMode = cur.subwoofer_dual ? 'dual' : (cur.subwoofer ? 'single' : 'none');
    var lfRow    = _el('div', { class: 'demo-btn-row', style: 'gap:6px;' });
    var subBtns  = {};
    var subOpts  = [
      { key: 'none',   label: 'Off', title: 'No subwoofer' },
      { key: 'single', label: 'Sub', title: 'Single subwoofer \u2014 right of rack' },
    ];
    for (var si = 0; si < subOpts.length; si++) {
      (function(opt) {
        var btn = _el('button', {
          class: 'spk-sub-btn' + (opt.key === _subMode ? ' active' : ''),
          type: 'button', title: opt.title,
        }, opt.label);
        btn.addEventListener('click', function() {
          Object.values(subBtns).forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
          _subMode = opt.key;
          cur.subwoofer      = opt.key !== 'none';
          cur.subwoofer_dual = opt.key === 'dual';
          onChange && onChange({ ...cur });
        });
        subBtns[opt.key] = btn;
        lfRow.appendChild(btn);
      })(subOpts[si]);
    }
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
          s.slider.value = String(state[k]);
          cur[k] = state[k];
          s.val.textContent = parseFloat(state[k]).toFixed(s.def.decimals) + (s.def.unit === '\u00b0' ? '\u00b0' : ' ' + s.def.unit);
          _updateSliderFill(s.slider);
        });
        cur.subwoofer      = state.subwoofer      ?? false;
        cur.subwoofer_dual = state.subwoofer_dual  ?? false;
        _subMode = cur.subwoofer_dual ? 'dual' : (cur.subwoofer ? 'single' : 'none');
        Object.values(subBtns).forEach(function(b) { b.classList.remove('active'); });
        if (subBtns[_subMode]) subBtns[_subMode].classList.add('active');
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
            s.val.textContent = parseFloat(v).toFixed(s.def.decimals) + (s.def.unit === '\u00b0' ? '\u00b0' : ' ' + s.def.unit);
            _updateSliderFill(s.slider);
          }
        });
        if (newState.subwoofer !== undefined) {
          cur.subwoofer      = newState.subwoofer;
          cur.subwoofer_dual = newState.subwoofer_dual ?? false;
          _subMode = cur.subwoofer_dual ? 'dual' : (cur.subwoofer ? 'single' : 'none');
          Object.values(subBtns).forEach(function(b) { b.classList.remove('active'); });
          if (subBtns[_subMode]) subBtns[_subMode].classList.add('active');
        }
      },
      setRoomType: function(rt) { _applySpkRoomType(rt); },
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
    const deskValEl = _el('span', { class: 'demo-field-value' }, cur.desk_width_m.toFixed(1) + ' m');
    deskHdr.appendChild(deskValEl);
    const deskSlider = _el('input', {
      type: 'range', id: 'scl-desk-width', min: '1.0', max: '2.2', step: '0.1',
      value: String(cur.desk_width_m), class: 'measurely-slider', 'aria-label': 'Desk width', 'data-acoustic': 'bass',
    });
    _updateSliderFill(deskSlider);
    const deskTicks = _el('div', { class: 'demo-slider-ticks' });
    ['1.0 m', '1.6 m', '2.2 m'].forEach(t => deskTicks.appendChild(_el('span', {}, t)));
    const deskField = _el('div', { class: 'demo-field' });
    deskField.append(deskHdr, deskSlider, deskTicks);
    studioBlock.appendChild(deskField);
    deskSlider.addEventListener('input', () => {
      cur.desk_width_m = parseFloat(deskSlider.value);
      deskValEl.textContent = cur.desk_width_m.toFixed(1) + ' m';
      _updateSliderFill(deskSlider);
      onChange?.({ ...cur });
    });

    // Studio furniture icon grid (3-col: Display | Mic | Keys | Rug | Sub)
    const studioGrid = _iconGridToggle(
      [
        { key: 'opt_display',  icon: 'monitor.svg',    label: 'Display', active: cur.opt_display },
        { key: 'opt_mic',      icon: 'mic.svg',         label: 'Mic',     active: cur.opt_mic },
        { key: 'opt_keyboard', icon: 'wave-square.svg',   label: 'Keys',    active: cur.opt_keyboard },
        { key: 'opt_area_rug', icon: 'rug.svg',           label: 'Rug',     active: cur.opt_area_rug },
        { key: 'opt_sub',      icon: 'subspeaker.svg',    label: 'Sub',     active: cur.opt_sub ?? false },
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
        // Restore icon grid states
        hifiGrid.setActive('opt_area_rug',     cur.opt_area_rug);
        hifiGrid.setActive('opt_coffee_table', cur.opt_coffee_table);
        hifiGrid.setActive('opt_ottoman',      cur.opt_ottoman);
        studioGrid.setActive('opt_display',    cur.opt_display);
        studioGrid.setActive('opt_mic',        cur.opt_mic);
        studioGrid.setActive('opt_keyboard',   cur.opt_keyboard);
        studioGrid.setActive('opt_area_rug',   cur.opt_area_rug);
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

  function renderTreatmentSection(mountId, { types, state, defaultColour, onTreatmentChange, onColourChange } = {}) {
    const MT = window.MeasurelyTreatment;
    if (!MT) {
      console.warn('[MeasurelySCL] treatment-registry.js not loaded');
      return null;
    }
    const api = MT.initTreatmentControls({
      mountId, types, state, defaultColour,
      colours: MT.PANEL_COLOURS,
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

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    renderRoomTypeToggle,
    renderAnalysisOverlaySection,
    renderRoomSection,
    renderCeilingSection,
    renderSpeakersSection,
    renderFurnitureSection,
    renderFloorSection,
    renderTreatmentSection,
    renderWaveToggle,
  };
});
