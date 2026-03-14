// web/js/speakers.js
// Loads speaker profiles from the server, falls back to a built-in minimal
// catalogue when offline (GitHub Pages). Always persists the last-known list
// to localStorage so subsequent loads are instant.

const LS_KEY       = 'mly.speaker.key';
const LS_LIST_KEY  = 'mly.speakers.list';

// Minimal built-in catalogue for offline / static hosting
const FALLBACK_SPEAKERS = [
    { key: 'generic',   name: 'Generic',   friendly_name: 'Generic speaker', type: 'category' },
    { key: 'bookshelf', name: 'Bookshelf', friendly_name: 'Bookshelf',       type: 'category' },
    { key: 'floorstander', name: 'Floorstander', friendly_name: 'Floorstander', type: 'category' },
    { key: 'studio_monitor', name: 'Studio Monitor', friendly_name: 'Studio Monitor', type: 'category' },
];

export async function initSpeakers() {
    console.log('[spk] initSpeakers() started');

    // 1. Try local cache first (instant)
    let list = [];
    try {
        const cached = localStorage.getItem(LS_LIST_KEY);
        if (cached) list = JSON.parse(cached);
    } catch (_) {}

    // 2. Try server — update cache if successful
    try {
        const res = await fetch('/api/speakers', { cache: 'no-store' });
        if (res.ok) {
            const apiData = await res.json();
            const apiList = apiData.list || [];
            if (apiList.length > 0) {
                list = apiList;
                localStorage.setItem(LS_LIST_KEY, JSON.stringify(list));
            }
        }
    } catch (_) {
        console.log('[spk] Server not reachable — using cached/fallback list');
    }

    // 3. Fall back to built-in if still empty
    if (list.length === 0) {
        list = FALLBACK_SPEAKERS;
    }

    // Populate global lookups
    window.SPEAKERS = {};
    list.forEach(spk => { window.SPEAKERS[spk.key] = spk; });
    window.SPEAKERS_BY_KEY = window.SPEAKERS;

    console.log('[spk] Loaded profiles:', list.length);

    // Set active speaker from saved key
    const savedKey = localStorage.getItem(LS_KEY);
    if (savedKey && window.SPEAKERS[savedKey]) {
        window.activeSpeaker = window.SPEAKERS[savedKey];
        console.log('🔥 Active speaker set from saved key:', window.activeSpeaker);
    }

    // Build dropdown if it exists on this page
    const sel = document.getElementById('speakerSel');
    if (!sel) return;

    sel.innerHTML = '';
    sel.appendChild(new Option('— None (generic sweep) —', ''));

    const spotlightGroup = document.createElement('optgroup');
    spotlightGroup.label = 'Spotlight Models';
    const categoryGroup = document.createElement('optgroup');
    categoryGroup.label = 'Speaker Categories';

    list.forEach(prof => {
        const label = prof.friendly_name || prof.name || prof.key;
        const opt   = new Option(label, prof.key);
        if (prof.type === 'spotlight') {
            spotlightGroup.appendChild(opt);
        } else {
            categoryGroup.appendChild(opt);
        }
    });

    if (spotlightGroup.children.length > 0) sel.appendChild(spotlightGroup);
    if (categoryGroup.children.length > 0)  sel.appendChild(categoryGroup);

    console.log('[spk] Dropdown built:', sel.options.length - 1);

    const saved = localStorage.getItem(LS_KEY);
    if (saved && window.SPEAKERS[saved]) sel.value = saved;

    const hint = document.getElementById('speakerHint');
    const updateHint = () => {
        if (!hint) return;
        const prof = window.SPEAKERS[sel.value];
        if (!prof) {
            hint.textContent = 'Generic sweep — no speaker-specific behaviour applied.';
            return;
        }
        const start = prof.sweep_start_hz ?? '?';
        const end   = prof.sweep_end_hz   ?? '?';
        const max   = prof.safe_level_dbfs ?? '?';
        hint.textContent = `${prof.friendly_name || prof.name} • sweep ${start}–${end} Hz • max ${max} dBFS`;
    };

    updateHint();
    sel.addEventListener('change', () => {
        localStorage.setItem(LS_KEY, sel.value);
        window.activeSpeaker = window.SPEAKERS[sel.value] || null;
        updateHint();
    });
}
