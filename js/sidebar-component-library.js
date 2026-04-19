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

  // Builds a labelled slider field: label + value display + range input
  function _sliderField({ label, id, min, max, step, value, unit = '', decimals = 1, ariaLabel }) {
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

  function renderRoomTypeToggle(mountId, { initial = 'home', onChange } = {}) {
    const mount = _mount(mountId);
    if (!mount) return null;

    let active = initial;
    const btns = {};

    const row = _el('div', { class: 'demo-btn-row' });
    for (const { key, label } of [{ key: 'home', label: 'Hi-Fi' }, { key: 'studio', label: 'Studio' }]) {
      const btn = _el('button', {
        class: 'sbox-btn' + (key === active ? ' active' : ''),
        type: 'button',
      }, label);
      btn.addEventListener('click', () => {
        if (active === key) return;
        Object.values(btns).forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        active = key;
        onChange?.(key, { ..._ROOM_TYPE_DEFAULTS[key] });
      });
      btns[key] = btn;
      row.appendChild(btn);
    }

    mount.appendChild(row);

    return {
      setActive(key) {
        Object.values(btns).forEach(b => b.classList.remove('active'));
        btns[key]?.classList.add('active');
        active = key;
      },
      getActive()      { return active; },
      getDefaults(key) { return { ..._ROOM_TYPE_DEFAULTS[key] }; },
      reset()          { this.setActive(initial); },
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
      { label: 'Room width',  key: 'width_m',  min: 2.0, max: 8.0,  step: 0.1,  unit: 'm', decimals: 1 },
      { label: 'Room length', key: 'length_m', min: 2.5, max: 10.0, step: 0.1,  unit: 'm', decimals: 1 },
      { label: 'Room height', key: 'height_m', min: 2.0, max: 4.0,  step: 0.05, unit: 'm', decimals: 1 },
    ];

    const sliders = {};
    for (const def of defs) {
      const { wrap: fw, slider, val } = _sliderField({
        label: def.label, id: 'scl-' + def.key,
        min: def.min, max: def.max, step: def.step,
        value: cur[def.key], unit: def.unit, decimals: def.decimals,
      });
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

    // Ceiling type selector
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
    });
    secWrap.style.display = 'none';
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
      speaker_type:     state.speaker_type     ?? 'floorstander',
      spk_placement:    state.spk_placement    ?? null,
      spk_spacing_m:    state.spk_spacing_m    ?? 2.0,
      spk_front_m:      state.spk_front_m      ?? 0.45,
      toe_in_deg:       state.toe_in_deg       ?? 12,
      listener_front_m: state.listener_front_m ?? 2.8,
    };

    const wrap = _el('div', { style: 'display:flex;flex-direction:column;gap:12px;' });

    // Speaker type — split into mode-aware blocks that toggle with room type
    const speakerHifiBlock   = _el('div', { style: 'display:flex;flex-direction:column;gap:8px;' });
    const speakerStudioBlock = _el('div', { style: 'display:none;flex-direction:column;gap:8px;' });

    const hifiLabel = _el('span', { class: 'demo-sub-label' }, 'Hi-Fi');
    speakerHifiBlock.appendChild(hifiLabel);

    const hifiGroup = _btnGroup(
      [
        { key: 'standmount',   label: 'Standmount',    title: 'Bookshelf on stand' },
        { key: 'floorstander', label: 'Floorstander',  title: 'Full-range tower' },
        { key: 'statement',    label: 'Statement',     title: 'Flagship floor-standing speaker' },
        { key: 'panel',        label: 'Electrostatic', title: 'Dipole panel / planar speaker' },
      ],
      cur.speaker_type,
      key => {
        cur.speaker_type = key;
        studioGroup.setActive(null);
        onChange?.({ ...cur });
      }
    );
    speakerHifiBlock.appendChild(hifiGroup.row);
    wrap.appendChild(speakerHifiBlock);

    const studioLabel = _el('span', { class: 'demo-sub-label' }, 'Studio');
    speakerStudioBlock.appendChild(studioLabel);

    const studioGroup = _btnGroup(
      [
        { key: 'monitor', label: 'Monitor', title: 'Near-field studio monitor' },
      ],
      cur.speaker_type === 'monitor' ? 'monitor' : null,
      key => {
        cur.speaker_type = key;
        hifiGroup.setActive(null);
        onChange?.({ ...cur });
      }
    );
    speakerStudioBlock.appendChild(studioGroup.row);
    wrap.appendChild(speakerStudioBlock);

    function _applySpkRoomType(rt) {
      speakerHifiBlock.style.display   = rt === 'studio' ? 'none' : 'flex';
      speakerStudioBlock.style.display = rt === 'studio' ? 'flex' : 'none';
    }

    // Combined setActive helper used by reset()
    function _setTypeActive(key) {
      const isStudio = key === 'monitor';
      hifiGroup.setActive(isStudio ? null : key);
      studioGroup.setActive(isStudio ? key : null);
    }

    const typeGroup = { setActive: _setTypeActive };

    // Apply initial room type visibility
    _applySpkRoomType(roomType);

    // Placement — studio only; lives inside speakerStudioBlock so it hides with it
    const placementGroup = _btnGroup(
      [
        { key: 'stands',      label: 'Stands'     },
        { key: 'desk_stands', label: 'Desk stands' },
        { key: 'desk',        label: 'On desk'     },
      ],
      cur.spk_placement ?? 'desk',
      key => { cur.spk_placement = key; onChange?.({ ...cur }); }
    );
    speakerStudioBlock.appendChild(placementGroup.row);

    // Sliders
    const sliderDefs = [
      { key: 'spk_spacing_m',    label: 'Speaker spacing',      min: 1.0, max: 4.0, step: 0.1,  unit: 'm', decimals: 1 },
      { key: 'toe_in_deg',       label: 'Toe-in angle',         min: 0,   max: 45,  step: 1,    unit: '°', decimals: 0 },
      { key: 'listener_front_m', label: 'Listening position',   min: 1.0, max: 5.0, step: 0.1,  unit: 'm', decimals: 1 },
      { key: 'spk_front_m',      label: 'Speakers from wall',   min: 0.1, max: 1.5, step: 0.05, unit: 'm', decimals: 2 },
    ];

    const sliders = {};
    for (const def of sliderDefs) {
      const { wrap: fw, slider, val } = _sliderField({
        label: def.label, id: 'scl-' + def.key,
        min: def.min, max: def.max, step: def.step,
        value: cur[def.key], unit: def.unit, decimals: def.decimals,
      });
      slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        cur[def.key] = v;
        val.textContent = v.toFixed(def.decimals) + (def.unit === '°' ? '°' : ' ' + def.unit);
        _updateSliderFill(slider);
        onChange?.({ ...cur });
      });
      sliders[def.key] = { slider, val, def };
      wrap.appendChild(fw);
    }

    mount.appendChild(wrap);

    return {
      reset() {
        typeGroup.setActive(state.speaker_type ?? 'floorstander');
        cur.speaker_type = state.speaker_type ?? 'floorstander';
        if (placementGroup && state.spk_placement) {
          placementGroup.setActive(state.spk_placement);
          cur.spk_placement = state.spk_placement;
        }
        for (const [k, { slider, val, def }] of Object.entries(sliders)) {
          slider.value = String(state[k]);
          cur[k] = state[k];
          val.textContent = parseFloat(state[k]).toFixed(def.decimals) + (def.unit === '°' ? '°' : ' ' + def.unit);
          _updateSliderFill(slider);
        }
      },
      // Snap speaker type button and slider positions to a new set of values.
      // Called by the room-type toggle when switching Hi-Fi ↔ Studio.
      setValues(newState) {
        if (newState.speaker_type) {
          _setTypeActive(newState.speaker_type);
          cur.speaker_type = newState.speaker_type;
        }
        for (const [k, { slider, val, def }] of Object.entries(sliders)) {
          if (newState[k] !== undefined) {
            const v = newState[k];
            slider.value = String(v);
            cur[k] = v;
            val.textContent = parseFloat(v).toFixed(def.decimals) + (def.unit === '°' ? '°' : ' ' + def.unit);
            _updateSliderFill(slider);
          }
        }
      },
      setRoomType(rt) { _applySpkRoomType(rt); },
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

    // Seating type slider: Large Sofa → Compact Sofa → Eames Lounge Chair
    const seatingHdr = _el('div', { class: 'demo-field-header' });
    seatingHdr.append(_el('span', { class: 'demo-field-label' }, 'Seating'));
    const seatingValEl = _el('span', { class: 'demo-field-value' }, 'Large Sofa');
    seatingHdr.appendChild(seatingValEl);
    const seatingSlider = _el('input', {
      type: 'range', id: 'scl-seating', min: '0', max: '100', step: '1', value: '0',
      class: 'measurely-slider', 'aria-label': 'Seating style',
    });
    _updateSliderFill(seatingSlider);
    const ticks = _el('div', { class: 'demo-slider-ticks' });
    ['Large Sofa', 'Compact', 'Eames Lounge'].forEach(t => ticks.appendChild(_el('span', {}, t)));
    const seatingField = _el('div', { class: 'demo-field' });
    seatingField.append(seatingHdr, seatingSlider, ticks);
    hifiBlock.appendChild(seatingField);

    // Hi-Fi toggle row: Rug | Coffee table | Footstool
    const hifiToggleRow = _el('div', { class: 'demo-btn-row' });
    const rugBtn    = _toggleBtn('Rug',          cur.opt_area_rug);
    const coffeeBtn = _toggleBtn('Coffee table', cur.opt_coffee_table);
    const footBtn   = _toggleBtn('Footstool',    cur.opt_ottoman);

    function _applySeating(val) {
      _updateSliderFill(seatingSlider);
      const isLounge = val > 66;
      if (!isLounge) {
        const t = val / 66;
        cur.seating_type = 'sofa';
        cur.sofa_width_m = parseFloat((2.8 - t * 1.4).toFixed(2));
        seatingValEl.textContent = val <= 22 ? 'Large Sofa' : val <= 44 ? 'Standard Sofa' : 'Compact Sofa';
        footBtn.style.display   = '';      // footstool available with sofa
        coffeeBtn.style.display = '';
      } else {
        cur.seating_type     = 'lounge';
        cur.sofa_width_m     = null;
        cur.opt_coffee_table = false;
        coffeeBtn.classList.remove('active');
        seatingValEl.textContent = 'Eames Lounge';
        footBtn.style.display    = 'none'; // Eames ottoman is built-in
        coffeeBtn.style.display  = 'none';
      }
    }
    seatingSlider.addEventListener('input', () => { _applySeating(parseInt(seatingSlider.value)); onChange?.({ ...cur }); });
    rugBtn.addEventListener('click', () => { cur.opt_area_rug = !cur.opt_area_rug; rugBtn.classList.toggle('active', cur.opt_area_rug); onChange?.({ ...cur }); });
    coffeeBtn.addEventListener('click', () => { cur.opt_coffee_table = !cur.opt_coffee_table; coffeeBtn.classList.toggle('active', cur.opt_coffee_table); onChange?.({ ...cur }); });
    footBtn.addEventListener('click', () => { cur.opt_ottoman = !cur.opt_ottoman; footBtn.classList.toggle('active', cur.opt_ottoman); onChange?.({ ...cur }); });
    if (cur.opt_area_rug)     rugBtn.classList.add('active');
    if (cur.opt_coffee_table) coffeeBtn.classList.add('active');
    if (cur.opt_ottoman)      footBtn.classList.add('active');
    hifiToggleRow.append(rugBtn, coffeeBtn, footBtn);
    hifiBlock.appendChild(hifiToggleRow);
    wrap.appendChild(hifiBlock);

    // ─── Studio block ───────────────────────────────────────────────────────────
    const studioBlock = _el('div', { style: 'display:none;flex-direction:column;gap:10px;' });
    studioBlock.appendChild(_el('span', { class: 'demo-sub-label' }, 'Desk setup'));

    // Desk width slider
    const deskHdr = _el('div', { class: 'demo-field-header' });
    deskHdr.append(_el('span', { class: 'demo-field-label' }, 'Desk width'));
    const deskValEl = _el('span', { class: 'demo-field-value' }, cur.desk_width_m.toFixed(1) + ' m');
    deskHdr.appendChild(deskValEl);
    const deskSlider = _el('input', {
      type: 'range', id: 'scl-desk-width', min: '1.0', max: '2.2', step: '0.1',
      value: String(cur.desk_width_m), class: 'measurely-slider', 'aria-label': 'Desk width',
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

    const studioToggleRow = _el('div', { class: 'demo-btn-row' });
    const displayBtn  = _toggleBtn('Display',   cur.opt_display);
    const micBtn      = _toggleBtn('Mic stand', cur.opt_mic);
    const keyboardBtn = _toggleBtn('Keyboard',  cur.opt_keyboard);
    const studioRugBtn = _toggleBtn('Rug',      cur.opt_area_rug);
    if (cur.opt_display)  displayBtn.classList.add('active');
    if (cur.opt_mic)      micBtn.classList.add('active');
    if (cur.opt_keyboard) keyboardBtn.classList.add('active');
    if (cur.opt_area_rug) studioRugBtn.classList.add('active');
    displayBtn.addEventListener('click', () => { cur.opt_display = !cur.opt_display; displayBtn.classList.toggle('active', cur.opt_display); onChange?.({ ...cur }); });
    micBtn.addEventListener('click', () => { cur.opt_mic = !cur.opt_mic; micBtn.classList.toggle('active', cur.opt_mic); onChange?.({ ...cur }); });
    keyboardBtn.addEventListener('click', () => { cur.opt_keyboard = !cur.opt_keyboard; keyboardBtn.classList.toggle('active', cur.opt_keyboard); onChange?.({ ...cur }); });
    studioRugBtn.addEventListener('click', () => { cur.opt_area_rug = !cur.opt_area_rug; studioRugBtn.classList.toggle('active', cur.opt_area_rug); onChange?.({ ...cur }); });
    studioToggleRow.append(displayBtn, micBtn, keyboardBtn, studioRugBtn);
    studioBlock.appendChild(studioToggleRow);
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
        seatingSlider.value  = '0';
        _applySeating(0);
        cur.opt_area_rug        = state.opt_area_rug        ?? true;
        cur.opt_coffee_table    = state.opt_coffee_table    ?? true;
        cur.opt_ottoman         = state.opt_ottoman          ?? false;
        cur.opt_display         = state.opt_display         ?? true;
        cur.opt_mic             = state.opt_mic             ?? false;
        cur.opt_keyboard        = state.opt_keyboard        ?? false;
        cur.opt_client_seating  = state.opt_client_seating  ?? false;
        cur.client_seating_type = state.client_seating_type ?? 'sofa';
        rugBtn.classList.toggle('active',        cur.opt_area_rug);
        coffeeBtn.classList.toggle('active',     cur.opt_coffee_table);
        footBtn.classList.toggle('active',       cur.opt_ottoman);
        studioRugBtn.classList.toggle('active',  cur.opt_area_rug);
        displayBtn.classList.toggle('active',    cur.opt_display);
        micBtn.classList.toggle('active',        cur.opt_mic);
        keyboardBtn.classList.toggle('active',   cur.opt_keyboard);
        clientToggleBtn.classList.toggle('active', cur.opt_client_seating);
        clientToggleBtn.textContent = cur.opt_client_seating ? 'On' : 'Off';
        clientTypeRow.style.display = cur.opt_client_seating ? '' : 'none';
        footBtn.style.display   = 'none';
        coffeeBtn.style.display = '';
        _applyRoomType(currentRoomType);
      },
    };
  }

  // ── Section 6 — Treatment ─────────────────────────────────────────────────
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

  // ── Section 7 — Wave Toggle ───────────────────────────────────────────────

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
    renderTreatmentSection,
    renderWaveToggle,
  };
});
