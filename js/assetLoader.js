/**
 * assetLoader.js — Measurely
 *
 * Lightweight chart-loading overlay utility.
 * No external dependencies; no framework required.
 *
 * Usage:
 *   window.MeasurelyAssetLoader.showChartLoading(containerEl);
 *   // … wait for render …
 *   window.MeasurelyAssetLoader.hideChartLoading(containerEl);
 */

(function () {
    'use strict';

    const OVERLAY_CLASS = 'mly-chart-loading';

    // Inject the spin keyframes exactly once
    function _ensureKeyframes() {
        if (document.getElementById('mly-chart-kf')) return;
        const s = document.createElement('style');
        s.id = 'mly-chart-kf';
        s.textContent = '@keyframes mly-chart-spin{to{transform:rotate(360deg)}}';
        document.head.appendChild(s);
    }

    /**
     * showChartLoading(containerEl)
     *
     * Appends an absolutely-positioned "Calculating…" overlay inside
     * containerEl. The container is given position:relative if it is
     * currently static so the overlay sits correctly inside it.
     *
     * Safe to call multiple times — any existing overlay is removed first.
     *
     * @param {HTMLElement} containerEl  The element to overlay (e.g. the
     *                                   parent div of #frequencyChart).
     */
    function showChartLoading(containerEl) {
        if (!containerEl) return;
        _ensureKeyframes();

        // Remove any stale overlay from a previous call
        hideChartLoading(containerEl);

        // Ensure container is a positioning context
        if (getComputedStyle(containerEl).position === 'static') {
            containerEl.style.position = 'relative';
        }

        const overlay = document.createElement('div');
        overlay.className = OVERLAY_CLASS;
        overlay.setAttribute('aria-hidden', 'true');
        overlay.style.cssText = [
            'position:absolute',
            'inset:0',
            'z-index:20',
            'display:flex',
            'flex-direction:column',
            'align-items:center',
            'justify-content:center',
            'gap:0.65rem',
            'background:rgba(17,24,39,0.82)',
            'backdrop-filter:blur(3px)',
            '-webkit-backdrop-filter:blur(3px)',
            'border-radius:inherit',
            'pointer-events:none',
            'opacity:0',
            'transition:opacity 0.2s ease',
        ].join(';');

        // Spinner ring
        const ring = document.createElement('div');
        ring.style.cssText = [
            'width:26px',
            'height:26px',
            'border:2px solid rgba(99,102,241,0.2)',
            'border-top-color:#6366f1',
            'border-radius:50%',
            'animation:mly-chart-spin 0.72s linear infinite',
            'flex-shrink:0',
        ].join(';');

        // Label
        const label = document.createElement('span');
        label.style.cssText = [
            'font-family:var(--font-main,system-ui,sans-serif)',
            'font-size:0.78rem',
            'font-weight:500',
            'color:rgba(148,163,184,0.85)',
            'letter-spacing:0.06em',
            'text-transform:uppercase',
        ].join(';');
        label.textContent = 'Calculating\u2026';

        overlay.appendChild(ring);
        overlay.appendChild(label);
        containerEl.appendChild(overlay);

        // Animate in on next frame so the transition fires
        requestAnimationFrame(() => {
            requestAnimationFrame(() => { overlay.style.opacity = '1'; });
        });
    }

    /**
     * hideChartLoading(containerEl)
     *
     * Fades out and removes any loading overlay previously inserted into
     * containerEl by showChartLoading(). Safe to call even if no overlay
     * is present.
     *
     * @param {HTMLElement} containerEl
     */
    function hideChartLoading(containerEl) {
        if (!containerEl) return;
        containerEl.querySelectorAll('.' + OVERLAY_CLASS).forEach(el => {
            el.style.opacity = '0';
            // Remove after transition completes; fallback: 300 ms
            el.addEventListener('transitionend', () => el.remove(), { once: true });
            setTimeout(() => el.remove(), 350);
        });
    }

    window.MeasurelyAssetLoader = { showChartLoading, hideChartLoading };

})();
