/*
  @measurely/engine — Treatment Registry
  ───────────────────────────────────────
  Single source of truth for acoustic treatment types, 3D geometry params,
  and panel colour palette. All satellites (demo.html, myroom.html, sonarworks,
  audiosilk) derive their treatment controls from this module.

  Usage:
    <script src="engine/js/treatment-registry.js"></script>
    const treat = MeasurelyTreatment.initTreatmentControls({ ... });

  Exports (window.MeasurelyTreatment / module.exports):
    TREATMENT_TYPES     — canonical definition of each treatment type
    GEOMETRY            — 3D geometry params (read by room3d.js)
    PANEL_COLOURS       — canonical colour swatch palette
    DEFAULT_COLOUR      — first colour in palette (used as panel_color default)
    initTreatmentControls(options) → API
*/

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.MeasurelyTreatment = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // ═══════════════════════════════════════════════════════════════
  // GEOMETRY — read by room3d.js to drive 3D rendering
  // ═══════════════════════════════════════════════════════════════

  const GEOMETRY = {
    bass_trap: {
      shape:          'triangle_prism',  // right-angle triangular prism — fills corner flush
      legSize:        0.3,               // metres — each leg of the right-angle triangle
      heightFraction: 0.75,              // fraction of local room height
    },
    wall_panel: {
      shape:          'box',
      panelWidth:     0.60,              // metres — individual panel width (standard 600mm)
      panelHeight:    1.20,              // metres — individual panel height (standard 1200mm)
      panelGap:       0.04,              // metres — gap between panels
      maxWidthFrac:   0.80,              // max coverage as fraction of room width
      thickness:      0.06,              // metres — panel depth
    },
    side_panel: {
      shape:          'box',
      panelWidth:     0.60,              // metres — individual panel width (standard 600mm)
      panelHeight:    1.20,              // metres — individual panel height (standard 1200mm)
      panelGap:       0.04,              // metres — gap between panels
      length:         0.90,              // metres — total coverage span along wall (fits 1 panel)
      thickness:      0.06,
    },
    ceiling_panel: {
      shape:          'box',             // cloud; wires added on flat ceilings by room3d.js
      widthFactor:    1.60,              // cpW = min(spkSpacing * widthFactor, roomW * 0.8)
      lengthFraction: 0.28,             // cpL = roomL * lengthFraction
      thickness:      0.06,
    },
  };

  // ═══════════════════════════════════════════════════════════════
  // TREATMENT_TYPES — canonical treatment definitions
  // ═══════════════════════════════════════════════════════════════

  const TREATMENT_TYPES = {
    bass_trap: {
      id:          'bass_trap',
      stateKey:    'bass_trap_mode',
      label:       'Bass traps',
      description: 'Floor-to-ceiling triangular corner absorbers',
      modes:       ['none', 'front', 'rear', 'all'],
      defaultMode: 'all',
      geometry:    GEOMETRY.bass_trap,
    },
    wall_panel: {
      id:          'wall_panel',
      stateKey:    'wall_panel_mode',
      label:       'Wall panels',
      description: 'Broadband absorbers on front and/or rear walls',
      modes:       ['none', 'front', 'rear', 'both'],
      defaultMode: 'both',
      geometry:    GEOMETRY.wall_panel,
    },
    side_panel: {
      id:          'side_panel',
      stateKey:    'side_panel_mode',
      label:       'Side panels',
      description: 'First-reflection point absorbers on side walls',
      modes:       ['none', 'left', 'right', 'both'],
      defaultMode: 'both',
      geometry:    GEOMETRY.side_panel,
    },
    ceiling_panel: {
      id:          'ceiling_panel',
      stateKey:    'ceiling_panel_mode',
      label:       'Ceiling cloud',
      description: 'Overhead absorber — wire-suspended on flat, slope-mounted on angled ceilings',
      modes:       ['none', 'cloud'],
      defaultMode: 'cloud',
      geometry:    GEOMETRY.ceiling_panel,
    },
  };

  // ═══════════════════════════════════════════════════════════════
  // PANEL_COLOURS — canonical swatch palette
  // Satellites can use a subset; audiosilk uses its own fabric set
  // ═══════════════════════════════════════════════════════════════

  const PANEL_COLOURS = [
    { id: 'black',   hex: '#1A1714', label: 'Matte Black' },
    { id: 'grey',    hex: '#8a8a8a', label: 'Mid Grey'    },
    { id: 'white',   hex: '#FFFFFF', label: 'Pure White'  },
    { id: 'teal',    hex: '#00B8A9', label: 'Teal'        },
    { id: 'natural', hex: '#c8a882', label: 'Natural'     },
  ];

  const DEFAULT_COLOUR = PANEL_COLOURS[0].hex; // Matte Black

  // ═══════════════════════════════════════════════════════════════
  // initTreatmentControls
  // ───────────────────────────────────────────────────────────────
  // Renders treatment toggle buttons and colour swatches into a
  // mount element. Returns an API for external reset / state reads.
  //
  // options:
  //   mountId           {string}   — id of container element
  //   types             {string[]} — subset of TREATMENT_TYPES keys, in order
  //   colours           {Array}    — colour objects [{id,hex,label}]; [] = no swatches
  //   state             {object}   — initial treatment state { bass_trap_mode, ... }
  //   defaultColour     {string}   — initial panel_color hex
  //   onTreatmentChange {fn(state)}— called when any toggle changes
  //   onColourChange    {fn(hex)}  — called when a colour swatch is clicked
  // ═══════════════════════════════════════════════════════════════

  function initTreatmentControls(options) {
    const {
      mountId,
      types          = Object.keys(TREATMENT_TYPES),
      colours        = PANEL_COLOURS,
      state          = {},
      defaultColour  = DEFAULT_COLOUR,
      onTreatmentChange,
      onColourChange,
    } = options;

    const mount = document.getElementById(mountId);
    if (!mount) {
      console.warn('[MeasurelyTreatment] mount element not found:', mountId);
      return null;
    }

    // ── Internal treatment state ──────────────────────────────────
    const treatState = {};
    types.forEach(key => {
      const def = TREATMENT_TYPES[key];
      if (!def) return;
      treatState[def.stateKey] = state[def.stateKey] ?? 'none';
    });

    // ── Toggle buttons ────────────────────────────────────────────
    const btnRow = document.createElement('div');
    btnRow.className = 'demo-btn-row';

    const buttons = {};

    types.forEach(key => {
      const def = TREATMENT_TYPES[key];
      if (!def) return;

      const isActive = treatState[def.stateKey] !== 'none';
      const btn = document.createElement('button');
      btn.className  = 'sbox-btn' + (isActive ? ' active' : '');
      btn.dataset.treatKey = key;
      btn.textContent = def.label;
      btn.title       = def.description;
      btn.type        = 'button';

      const updateBtn = () => {
        const cur = treatState[def.stateKey];
        const isOn = cur !== 'none';
        btn.classList.toggle('active', isOn);
        btn.textContent = isOn ? `${def.label} \u00b7 ${cur}` : def.label;
      };

      btn.addEventListener('click', () => {
        const modes   = def.modes; // e.g. ['none','front','rear','both']
        const cur     = treatState[def.stateKey];
        const idx     = modes.indexOf(cur);
        const next    = modes[(idx + 1) % modes.length];
        treatState[def.stateKey] = next;
        updateBtn();
        onTreatmentChange?.({ ...treatState });
      });

      updateBtn();

      buttons[key] = btn;
      btnRow.appendChild(btn);
    });

    mount.appendChild(btnRow);

    // ── Colour swatches ───────────────────────────────────────────
    let activeColour = defaultColour;
    let swatchRow = null;

    if (colours.length > 0) {
      swatchRow = document.createElement('div');
      swatchRow.className = 'demo-btn-row treat-swatch-row';

      colours.forEach(colour => {
        const btn = document.createElement('button');
        btn.className      = 'as-colour-btn' + (colour.hex === activeColour ? ' active' : '');
        btn.dataset.colour = colour.hex;
        btn.title          = colour.label;
        btn.type           = 'button';
        btn.style.background = colour.hex;
        if (colour.hex.toUpperCase() === '#FFFFFF') {
          btn.style.border = '1px solid rgba(0,0,0,0.3)';
        }

        btn.addEventListener('click', () => {
          swatchRow.querySelectorAll('.as-colour-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          activeColour = colour.hex;
          onColourChange?.(colour.hex);
        });

        swatchRow.appendChild(btn);
      });

      mount.appendChild(swatchRow);
    }

    // ── Public API ────────────────────────────────────────────────
    return {
      getState:   () => ({ ...treatState }),
      getColour:  () => activeColour,

      reset() {
        types.forEach(key => {
          const def = TREATMENT_TYPES[key];
          if (!def) return;
          treatState[def.stateKey] = 'none';
          if (buttons[key]) {
            buttons[key].classList.remove('active');
            buttons[key].textContent = def.label;
          }
        });
        onTreatmentChange?.({ ...treatState });
      },

      setColour(hex) {
        activeColour = hex;
        swatchRow?.querySelectorAll('.as-colour-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.colour === hex);
        });
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════

  return {
    TREATMENT_TYPES,
    GEOMETRY,
    PANEL_COLOURS,
    DEFAULT_COLOUR,
    initTreatmentControls,
  };
});
