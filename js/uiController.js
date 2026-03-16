/* ------------------------------------------------------------------
   CENTRAL UI CONTROLLER - js/uiController.js
------------------------------------------------------------------ */

let highlightTimer;

const FIELD_TO_HIGHLIGHT = {
    // Geometry Group
    'geometry.length_m':         'wall_length', 
    'geometry.width_m':          'wall_width', 
    'geometry.height_m':         'wall_height',
    
    // Ceiling Logic
    'geometry.ceiling_type':                 'wall_height',
    'geometry.ceiling_slant_direction':       'wall_height',
    'geometry.ceiling_gable_axis':            'wall_height',
    'geometry.ceiling_height_secondary_m':   'wall_height',

    // Setup Group
    'setup.spk_spacing_m':       'speakers',
    'setup.spk_front_m':         'speakers', 
    'setup.tweeter_height_m':    'speakers', 
    'setup.toe_in_deg':          'speakers',
    'setup.subwoofer':           'speakers',
    'setup.listener_front_m':    'listener',
    'setup.listener_offset_m':   'listener',

    // Environment Group - UPDATED TO MATCH NESTED STRUCTURE
    'room_type':                             'furnishings',
    'environment.furniture.opt_area_rug':    'furnishings', 
    'environment.furniture.opt_sofa':        'furnishings',
    'environment.furniture.opt_desk':        'furnishings', 
    'environment.furniture.opt_chair':       'furnishings',
    'environment.furniture.opt_coffee_table':'furnishings'
};

export function setDeepValue(obj, path, value) {
    const keys = path.split('.');
    let current = obj;
    
    while (keys.length > 1) {
        const key = keys.shift();
        if (!current[key]) current[key] = {}; 
        current = current[key];
    }
    
    current[keys[0]] = value;
}

export function getNestedRoomValue(state, key) {
    if (state[key] !== undefined) return state[key];
    if (state.geometry?.[key] !== undefined) return state.geometry[key];
    if (state.setup?.[key] !== undefined) return state.setup[key];
    if (state.environment?.furniture?.[key] !== undefined) return state.environment.furniture[key];
    if (state.environment?.treatment?.[key] !== undefined) return state.environment.treatment[key];
    if (state.environment?.[key] !== undefined) return state.environment[key];
    return ""; 
}

export function setNestedRoomValue(state, key, value) {
    if (state.geometry && key in state.geometry) { state.geometry[key] = value; return true; }
    if (state.setup && key in state.setup) { state.setup[key] = value; return true; }
    if (state.environment?.furniture && key in state.environment.furniture) { state.environment.furniture[key] = value; return true; }
    if (state.environment?.treatment && key in state.environment.treatment) { state.environment.treatment[key] = value; return true; }
    if (state.environment && key in state.environment) { state.environment[key] = value; return true; }
    state[key] = value;
    return true;
}

function handleEnvironmentChange(type, state) {
    const isStudio = (type === "studio");

    const settings = isStudio ? {
        "setup.speaker_type": "monitor",
        "setup.tweeter_height_m": 1.30,
        "setup.spk_front_m": 0.10,
        "setup.listener_front_m": 1.40,
        "setup.spk_spacing_m": 1.20,
        "geometry.ceiling_type": "flat",
        // Added .furniture. to these paths
        "environment.furniture.opt_desk": true,
        "environment.furniture.opt_chair": true,
        "environment.furniture.opt_sofa": false,
        "environment.furniture.opt_area_rug": false,
        "environment.furniture.opt_coffee_table": false
    } : {
        "setup.speaker_type": "standmount",
        "setup.tweeter_height_m": 0.95,
        "setup.spk_front_m": 0.80,
        "setup.listener_front_m": 2.50,
        "setup.spk_spacing_m": 2.20,
        // Added .furniture. to these paths
        "environment.furniture.opt_desk": false,
        "environment.furniture.opt_chair": false,
        "environment.furniture.opt_sofa": true,
        "environment.furniture.opt_area_rug": true,
        "environment.furniture.opt_coffee_table": true
    };

    for (const [path, value] of Object.entries(settings)) {
        setDeepValue(state, path, value);
    }
}

export function attachHighlightListeners(input, fieldKey, room3D) {
    const hlKey = FIELD_TO_HIGHLIGHT[fieldKey];
    if (!hlKey) return;

    const startHighlight = () => {
        if (highlightTimer) clearTimeout(highlightTimer);
        if (room3D?.highlight) room3D.highlight(hlKey);
    };

    const stopHighlight = () => {
        if (highlightTimer) clearTimeout(highlightTimer);
        highlightTimer = setTimeout(() => {
            if (room3D) {
                room3D.highlight(null);
                room3D.update(); 
            }
        }, 80);
    };

    input.addEventListener('focus', startHighlight);
    input.addEventListener('input', startHighlight);
    input.addEventListener('blur', stopHighlight);
}

export function updateSliderFill(slider) {
    const min = parseFloat(slider.min) || 0;
    const max = parseFloat(slider.max) || 100;
    const val = parseFloat(slider.value) || 0;
    const percentage = ((val - min) / (max - min)) * 100;
    slider.style.setProperty('--fill', `${percentage}%`);
}

export const UIController = {
    attach: function({ container, state, room3D, onValueUpdate, onMacroChange }) {
        const inputs = container.querySelectorAll('input, select');
        inputs.forEach(input => {
            const key = input.getAttribute('data-key');
            if (!key && input.type !== 'range') return;

            if (input.type === 'range') {
                updateSliderFill(input); // Initialize fill
                input.addEventListener('input', () => updateSliderFill(input));
            }

            if (!key) return; // For sliders that don't have a data-key but need the fill logic

            attachHighlightListeners(input, key, room3D);

            input.addEventListener('change', () => {
                this.syncState(input, key, state, room3D, onValueUpdate, onMacroChange);
            });
            
            if (input.type === 'range') {
                input.addEventListener('input', () => {
                    this.syncState(input, key, state, room3D, onValueUpdate, null);
                    const display = input.parentElement.querySelector('.js-val-display');
                    if (display) {
                        display.textContent = Number(input.value).toFixed(2);
                    }
                });
            }
        });
    },

    syncState(input, key, state, room3D, onValueUpdate, onMacroChange) {
        let val;
        if (input.type === 'checkbox') val = !!input.checked;
        else if (input.type === 'range' || input.type === 'number') val = parseFloat(input.value);
        else val = input.value;

        if (key.includes('.')) {
            setDeepValue(state, key, val);
        } else {
            setNestedRoomValue(state, key, val);
        }

        // Let the caller also handle the value (e.g. set flat keys)
        if (onValueUpdate) onValueUpdate(key, val);

        if (key === "room_type") {
            handleEnvironmentChange(val, state);
        }

        // Invoke macro callback for fields that need a full UI re-render
        const MACRO_KEYS = ["room_type", "speaker_type", "ceiling_type", "ceiling_gable_axis", "geometry.ceiling_type", "geometry.ceiling_gable_axis"];
        const bareKey = key.includes('.') ? key.split('.').pop() : key;
        if (onMacroChange && (MACRO_KEYS.includes(bareKey) || MACRO_KEYS.includes(key))) {
            onMacroChange();
        }

        if (room3D?.update) room3D.update();
    }
};

window.UIController = UIController;
window.attachHighlightListeners = attachHighlightListeners;
window.updateSliderFill = updateSliderFill;