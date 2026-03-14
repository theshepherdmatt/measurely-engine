// web/js/speakers.js
// Static speaker profile catalogue. No server dependency.
// Provides manufacturer data, accurate cabinet dimensions for 3D rendering,
// and acoustic character notes for Dave's commentary.

const LS_KEY      = 'mly.speaker.key';
const LS_LIST_KEY = 'mly.speakers.list';

/* ============================================================
   PROFILE CATALOGUE
   Cabinet dimensions are the physical outer dimensions in metres.
   tweeter_pos is a 0–1 fraction from the bottom of the cabinet
   (e.g. 0.85 = tweeter is 85% of the way up — near the top).
   bass_ext_hz is the approximate –6 dB point in-room.
   char is the plain-English note Dave uses when this profile is active.
   ============================================================ */
export const SPEAKER_PROFILES = {

    // ── GENERIC CATEGORIES (always available as fallbacks) ─────────
    generic: {
        key:           'generic',
        name:          'Generic',
        friendly_name: 'Generic speaker',
        type:          'category',
        cabinet:       { w: 0.20, h: 0.35, d: 0.25 },
        tweeter_pos:   0.85,
        bass_ext_hz:   60,
        char: 'Measurement without speaker-specific corrections. Results are geometry-only.'
    },

    bookshelf: {
        key:           'bookshelf',
        name:          'Bookshelf / Standmount',
        friendly_name: 'Bookshelf (generic)',
        type:          'category',
        cabinet:       { w: 0.22, h: 0.37, d: 0.28 },
        tweeter_pos:   0.82,
        bass_ext_hz:   55,
        char: 'Typical 2-way standmount. Bass rolls off below ~55 Hz — room gain from corners will accentuate this band. SBIR is the priority issue.'
    },

    floorstander: {
        key:           'floorstander',
        name:          'Floorstander',
        friendly_name: 'Floorstander (generic)',
        type:          'category',
        cabinet:       { w: 0.28, h: 1.10, d: 0.35 },
        tweeter_pos:   0.90,
        bass_ext_hz:   30,
        char: 'Larger cabinet with deep bass extension. Room modes below 80 Hz are almost certainly significant. Modal decay time is the key metric.'
    },

    studio_monitor: {
        key:           'studio_monitor',
        name:          'Studio Monitor',
        friendly_name: 'Studio Monitor (generic)',
        type:          'category',
        cabinet:       { w: 0.20, h: 0.32, d: 0.24 },
        tweeter_pos:   0.80,
        bass_ext_hz:   45,
        char: 'Near-field monitor optimised for short listening distances. SBIR and early reflections off the desk surface are the primary issues to solve.'
    },

    panel: {
        key:           'panel',
        name:          'Panel / Electrostatic',
        friendly_name: 'Panel speaker (generic)',
        type:          'category',
        cabinet:       { w: 0.55, h: 1.40, d: 0.05 },
        tweeter_pos:   0.50,
        bass_ext_hz:   60,
        char: 'Dipole/planar radiation. Rear wave is out of phase — rear wall distance is critical. Typically need 1 m+ from the wall behind. Side walls matter less than for conventional drivers.'
    },

    // ── MANUFACTURER SPOTLIGHTS ────────────────────────────────────
    kef_ls50: {
        key:           'kef_ls50',
        name:          'KEF LS50',
        friendly_name: 'KEF LS50 Meta',
        type:          'spotlight',
        manufacturer:  'KEF',
        cabinet:       { w: 0.200, h: 0.302, d: 0.278 },
        tweeter_pos:   0.50,   // Uni-Q: tweeter sits at acoustic centre of woofer
        bass_ext_hz:   47,
        char: 'Concentric Uni-Q driver gives excellent point-source imaging. Very sensitive to front-wall distance — anything closer than 50 cm loads the bass. Toe-in 10–15° is the sweet spot. Schroeder frequency is the primary concern in small rooms.'
    },

    kef_r3: {
        key:           'kef_r3',
        name:          'KEF R3',
        friendly_name: 'KEF R3 Meta',
        type:          'spotlight',
        manufacturer:  'KEF',
        cabinet:       { w: 0.204, h: 0.360, d: 0.306 },
        tweeter_pos:   0.50,
        bass_ext_hz:   38,
        char: 'Larger Uni-Q with more bass extension. Room modes below 60 Hz will be visible in the sweep. Benefits significantly from pulling out from the front wall.'
    },

    harbeth_p3: {
        key:           'harbeth_p3',
        name:          'Harbeth P3ESR',
        friendly_name: 'Harbeth P3ESR',
        type:          'spotlight',
        manufacturer:  'Harbeth',
        cabinet:       { w: 0.189, h: 0.295, d: 0.202 },
        tweeter_pos:   0.88,
        bass_ext_hz:   75,
        char: 'Classic BBC-lineage minimonitor. Wide sweet spot, forgiving of toe-in. Bass rolls off gently above 75 Hz — room gain below this point is audible and intentional. A dip in the 60–80 Hz region on your sweep is normal.'
    },

    harbeth_shl5: {
        key:           'harbeth_shl5',
        name:          'Harbeth SHL5+',
        friendly_name: 'Harbeth SHL5 Plus',
        type:          'spotlight',
        manufacturer:  'Harbeth',
        cabinet:       { w: 0.324, h: 0.520, d: 0.295 },
        tweeter_pos:   0.85,
        bass_ext_hz:   40,
        char: 'BBC monitor heritage in a larger two-way. Strong bass output means room modes will be energetic. Harbeth recommends stands at 60 cm, speakers well clear of side walls.'
    },

    atc_scm7: {
        key:           'atc_scm7',
        name:          'ATC SCM7',
        friendly_name: 'ATC SCM7',
        type:          'spotlight',
        manufacturer:  'ATC',
        cabinet:       { w: 0.169, h: 0.280, d: 0.195 },
        tweeter_pos:   0.86,
        bass_ext_hz:   60,
        char: 'Professional BBC-spec monitor. Demanding of amplification — low sensitivity means sweep level matters. Mids are brutally revealing of room issues above 200 Hz. Check your Smoothness and Clarity scores first.'
    },

    atc_scm19: {
        key:           'atc_scm19',
        name:          'ATC SCM19',
        friendly_name: 'ATC SCM19',
        type:          'spotlight',
        manufacturer:  'ATC',
        cabinet:       { w: 0.197, h: 0.355, d: 0.270 },
        tweeter_pos:   0.85,
        bass_ext_hz:   48,
        char: 'Extended bass version of the SCM7 family. SBIR will likely appear in the 40–60 Hz region. ATC\'s tight bass control means room problems are very audible — a low Smoothness score here is a real finding.'
    },

    genelec_8030: {
        key:           'genelec_8030',
        name:          'Genelec 8030',
        friendly_name: 'Genelec 8030C',
        type:          'spotlight',
        manufacturer:  'Genelec',
        cabinet:       { w: 0.189, h: 0.290, d: 0.215 },
        tweeter_pos:   0.30,   // Tweeter is above the woofer (inverted layout)
        bass_ext_hz:   54,
        char: 'SAM-capable studio monitor. If you have SAM room correction active, disable it before running your sweep — Measurely measures the room, not the correction. Re-enable SAM after to hear the difference.'
    },

    genelec_8341: {
        key:           'genelec_8341',
        name:          'Genelec 8341',
        friendly_name: 'Genelec 8341A SAM',
        type:          'spotlight',
        manufacturer:  'Genelec',
        cabinet:       { w: 0.194, h: 0.350, d: 0.240 },
        tweeter_pos:   0.50,   // Coaxial: acoustic centre of woofer
        bass_ext_hz:   38,
        char: 'Three-way coaxial SAM monitor. Disable SAM correction before sweeping. The coaxial driver gives ideal point-source behaviour — any comb filtering you see is the room, not the speaker.'
    },

    adam_a7x: {
        key:           'adam_a7x',
        name:          'ADAM A7X',
        friendly_name: 'ADAM A7X',
        type:          'spotlight',
        manufacturer:  'ADAM Audio',
        cabinet:       { w: 0.199, h: 0.330, d: 0.296 },
        tweeter_pos:   0.35,
        bass_ext_hz:   42,
        char: 'Folded-ribbon (ART) tweeter has extreme horizontal dispersion above 5 kHz. Side wall first reflections will carry more HF energy than with soft-dome alternatives. A low Clarity or Smoothness score may point to untreated side walls.'
    },

    dynaudio_emit20: {
        key:           'dynaudio_emit20',
        name:          'Dynaudio Emit 20',
        friendly_name: 'Dynaudio Emit 20',
        type:          'spotlight',
        manufacturer:  'Dynaudio',
        cabinet:       { w: 0.202, h: 0.350, d: 0.280 },
        tweeter_pos:   0.85,
        bass_ext_hz:   50,
        char: 'Danish soft-dome — warm, controlled dispersion. Performs best with 40–60 cm clearance from the front wall. Bass is tight but room modes will still dominate below 80 Hz.'
    },

    dynaudio_contour20i: {
        key:           'dynaudio_contour20i',
        name:          'Dynaudio Contour 20i',
        friendly_name: 'Dynaudio Contour 20i',
        type:          'spotlight',
        manufacturer:  'Dynaudio',
        cabinet:       { w: 0.196, h: 0.370, d: 0.292 },
        tweeter_pos:   0.86,
        bass_ext_hz:   42,
        char: 'High-end Dynaudio Esotar3 tweeter. Reference-grade imaging demands a quiet room. Check your Balance score — any off-axis asymmetry in this speaker\'s high-frequency output will be scored harshly.'
    },

    focal_aria906: {
        key:           'focal_aria906',
        name:          'Focal Aria 906',
        friendly_name: 'Focal Aria 906',
        type:          'spotlight',
        manufacturer:  'Focal',
        cabinet:       { w: 0.218, h: 0.380, d: 0.295 },
        tweeter_pos:   0.88,
        bass_ext_hz:   55,
        char: 'Inverted-dome tweeter with controlled dispersion. Focal house sound tends toward HF presence — check your Balance score first. Toe-in of 0–10° is usually optimal with this tweeter type.'
    },

    focal_kanta2: {
        key:           'focal_kanta2',
        name:          'Focal Kanta 2',
        friendly_name: 'Focal Kanta No.2',
        type:          'spotlight',
        manufacturer:  'Focal',
        cabinet:       { w: 0.260, h: 1.100, d: 0.360 },
        tweeter_pos:   0.90,
        bass_ext_hz:   31,
        char: 'Three-way floorstander with substantial bass output. Expect significant room mode interaction below 80 Hz. The IAL2 tweeter is a beryllium-dome — it will reveal any reflections above 3 kHz with clinical accuracy.'
    },

    bw_705s3: {
        key:           'bw_705s3',
        name:          'B&W 705 S3',
        friendly_name: 'Bowers & Wilkins 705 S3',
        type:          'spotlight',
        manufacturer:  'Bowers & Wilkins',
        cabinet:       { w: 0.222, h: 0.386, d: 0.316 },
        tweeter_pos:   0.95,   // On-top tweeter pod
        bass_ext_hz:   50,
        char: 'Carbon-dome tweeter in its own dedicated pod sits above the cabinet. The tweeter\'s acoustic centre is physically above the stated cabinet top — the actual height used by Measurely accounts for this. Low SBIR risk if kept 40+ cm from the wall.'
    },

    bw_804d4: {
        key:           'bw_804d4',
        name:          'B&W 804 D4',
        friendly_name: 'Bowers & Wilkins 804 D4',
        type:          'spotlight',
        manufacturer:  'Bowers & Wilkins',
        cabinet:       { w: 0.300, h: 1.050, d: 0.380 },
        tweeter_pos:   0.96,
        bass_ext_hz:   28,
        char: 'Diamond-dome tweeter floorstander. Very extended bass — room modes down to 30 Hz are in play. Continuum FST midrange is ruthlessly revealing of comb filtering. Clarity score above 7 is the target for this speaker.'
    },

    sonus_olympica1: {
        key:           'sonus_olympica1',
        name:          'Sonus faber Olympica I',
        friendly_name: 'Sonus faber Olympica Nova I',
        type:          'spotlight',
        manufacturer:  'Sonus faber',
        cabinet:       { w: 0.205, h: 0.360, d: 0.325 },
        tweeter_pos:   0.85,
        bass_ext_hz:   50,
        char: 'Italian craftsmanship — wood cabinet provides natural internal damping. The silk-dome tweeter is forgiving of reflections. The rear port means front-wall distance has a strong effect on bass level — 40–80 cm is the typical optimum range.'
    },

    pmc_twenty523: {
        key:           'pmc_twenty523',
        name:          'PMC Twenty5.23',
        friendly_name: 'PMC Twenty5.23',
        type:          'spotlight',
        manufacturer:  'PMC',
        cabinet:       { w: 0.165, h: 0.393, d: 0.285 },
        tweeter_pos:   0.88,
        bass_ext_hz:   35,
        char: 'ATL (Advanced Transmission Line) bass loading gives unusually deep bass from a compact cabinet. The bass character is very different from a ported design — expect a flatter SBIR profile. Check Bandwidth and Smoothness below 50 Hz specifically.'
    },

    linn_majik: {
        key:           'linn_majik',
        name:          'Linn Majik 109',
        friendly_name: 'Linn Majik 109',
        type:          'spotlight',
        manufacturer:  'Linn',
        cabinet:       { w: 0.179, h: 0.313, d: 0.228 },
        tweeter_pos:   0.84,
        bass_ext_hz:   58,
        char: 'Linn system-optimised speaker. Often actively driven (Exakt). If using Exakt, the correction is already applied in the digital domain — sweep results will show the corrected response. Measurely can still identify room geometry problems the correction cannot fix.'
    },
};

/* ============================================================
   HELPERS
   ============================================================ */

/**
 * Returns the full profile for a given key.
 * Falls back to 'generic' if the key is unknown.
 */
export function getProfile(key) {
    return SPEAKER_PROFILES[key] || SPEAKER_PROFILES.generic;
}

/**
 * Returns the physical cabinet dimensions { w, h, d } in metres.
 * Used by room3d.js to render accurate speaker geometry.
 */
export function getProfileDimensions(key) {
    return getProfile(key).cabinet;
}

/**
 * Returns the 0–1 tweeter position from the bottom of the cabinet.
 */
export function getTweeterPos(key) {
    return getProfile(key).tweeter_pos ?? 0.85;
}

/**
 * Infers the speaker_type string that room3d.js uses for cabinet shape.
 */
export function getProfileCabinetType(key) {
    const p = getProfile(key);
    if (p.cabinet.h > 0.80) return 'floorstander';
    if (p.cabinet.d < 0.08) return 'panel';
    // Studio monitors and spotlights with monitor in their char
    if (
        key === 'studio_monitor' ||
        p.char?.toLowerCase().includes('near-field') ||
        p.manufacturer === 'Genelec' ||
        p.manufacturer === 'ADAM Audio'
    ) return 'monitor';
    return 'standmount';
}

/**
 * Returns all profiles as a flat array, categories first then spotlights.
 */
export function getAllProfiles() {
    return Object.values(SPEAKER_PROFILES).sort((a, b) => {
        if (a.type === b.type) return (a.friendly_name || a.name).localeCompare(b.friendly_name || b.name);
        return a.type === 'category' ? -1 : 1;
    });
}

/* ============================================================
   INIT — builds the page dropdown if #speakerSel exists,
   restores saved selection, fires 'speakerprofile' event.
   ============================================================ */
export async function initSpeakers() {
    console.log('[spk] initSpeakers()');

    // Populate global lookups (used by legacy code that reads window.SPEAKERS)
    window.SPEAKERS        = {};
    window.SPEAKERS_BY_KEY = {};
    Object.values(SPEAKER_PROFILES).forEach(p => {
        window.SPEAKERS[p.key]        = p;
        window.SPEAKERS_BY_KEY[p.key] = p;
    });

    // Restore last-used selection
    const savedKey = localStorage.getItem(LS_KEY);
    if (savedKey && SPEAKER_PROFILES[savedKey]) {
        window.activeSpeaker = SPEAKER_PROFILES[savedKey];
    } else {
        window.activeSpeaker = null;
    }

    console.log('[spk] Loaded', Object.keys(SPEAKER_PROFILES).length, 'profiles');

    _buildDropdown(savedKey);
}

function _buildDropdown(savedKey) {
    const sel = document.getElementById('speakerSel');
    if (!sel) return;

    sel.innerHTML = '';
    sel.appendChild(new Option('— Generic sweep (no profile) —', ''));

    const categoryGroup  = document.createElement('optgroup');
    categoryGroup.label  = 'Speaker Categories';
    const spotlightGroup = document.createElement('optgroup');
    spotlightGroup.label = 'Manufacturer Profiles';

    getAllProfiles().forEach(prof => {
        const label = prof.friendly_name || prof.name;
        const opt   = new Option(label, prof.key);
        if (prof.type === 'spotlight') {
            spotlightGroup.appendChild(opt);
        } else {
            categoryGroup.appendChild(opt);
        }
    });

    if (categoryGroup.children.length  > 0) sel.appendChild(categoryGroup);
    if (spotlightGroup.children.length > 0) sel.appendChild(spotlightGroup);

    if (savedKey && SPEAKER_PROFILES[savedKey]) sel.value = savedKey;

    const hint = document.getElementById('speakerHint');

    function updateHint() {
        if (!hint) return;
        const prof = SPEAKER_PROFILES[sel.value];
        if (!prof) {
            hint.textContent = 'Generic sweep — no profile applied.';
            return;
        }
        const mfr = prof.manufacturer ? `${prof.manufacturer} · ` : '';
        hint.textContent = `${mfr}${prof.friendly_name || prof.name}  ·  bass ext. ~${prof.bass_ext_hz} Hz`;
    }

    updateHint();

    sel.addEventListener('change', () => {
        const key  = sel.value;
        const prof = SPEAKER_PROFILES[key] || null;
        localStorage.setItem(LS_KEY, key);
        window.activeSpeaker = prof;
        updateHint();

        // Notify any listeners (e.g. room3d.js, dashboard) that the profile changed
        document.dispatchEvent(new CustomEvent('speakerprofile', {
            detail: { key, profile: prof },
            bubbles: true
        }));
    });
}
