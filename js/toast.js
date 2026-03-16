/**
 * toast.js — Measurely notification toasts
 *
 * Usage: toast('message', 'info' | 'success' | 'error')
 *
 * Toasts stack vertically from the top-right corner so they never overlap.
 * Each auto-dismisses after 6 s with a fade-out.
 */

(function () {
    'use strict';

    // Single container anchored to top-right; created on demand.
    function _getContainer() {
        let c = document.getElementById('mly-toast-container');
        if (!c) {
            c = document.createElement('div');
            c.id = 'mly-toast-container';
            c.style.cssText = [
                'position:fixed',
                'top:1rem',
                'right:1rem',
                'z-index:9999',
                'display:flex',
                'flex-direction:column',
                'gap:0.5rem',
                'align-items:flex-end',
                'pointer-events:none',
            ].join(';');
            document.body.appendChild(c);
        }
        return c;
    }

    const STYLES = {
        error:   { bg: '#ef4444', icon: '✕' },
        success: { bg: '#22c55e', icon: '✓' },
        info:    { bg: '#6366f1', icon: 'ℹ' },
        warning: { bg: '#f59e0b', icon: '⚠' },
    };

    function toast(msg, type) {
        const t = type && STYLES[type] ? type : 'info';
        const { bg, icon } = STYLES[t];

        const box = document.createElement('div');
        box.style.cssText = [
            `background:${bg}`,
            'color:#fff',
            'font-size:0.875rem',
            'font-family:var(--font-main,system-ui,sans-serif)',
            'padding:0.625rem 1rem',
            'border-radius:10px',
            'box-shadow:0 4px 16px rgba(0,0,0,0.4)',
            'display:flex',
            'align-items:center',
            'gap:0.5rem',
            'max-width:320px',
            'pointer-events:auto',
            'opacity:0',
            'transform:translateX(12px)',
            'transition:opacity 0.25s ease, transform 0.25s ease',
        ].join(';');

        const iconEl = document.createElement('span');
        iconEl.style.cssText = 'font-size:0.75rem;flex-shrink:0;opacity:0.85';
        iconEl.textContent = icon;

        const textEl = document.createElement('span');
        textEl.textContent = msg;

        box.appendChild(iconEl);
        box.appendChild(textEl);

        const container = _getContainer();
        container.appendChild(box);

        // Animate in
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                box.style.opacity = '1';
                box.style.transform = 'translateX(0)';
            });
        });

        // Dismiss
        function dismiss() {
            box.style.opacity = '0';
            box.style.transform = 'translateX(12px)';
            setTimeout(() => box.remove(), 300);
        }

        const autoTimer = setTimeout(dismiss, 6000);
        box.addEventListener('click', () => { clearTimeout(autoTimer); dismiss(); });
    }

    // Expose globally — sync.js and any page can call window.toast(...)
    window.toast = toast;

})();
