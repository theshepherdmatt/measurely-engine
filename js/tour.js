/**
 * tour.js — Lightweight vanilla JS spotlight tour.
 * No external dependencies.
 *
 * Usage:
 *   const tour = createTour(steps, { onNext, onEnd });
 *   tour.start(0);
 *   tour.goTo(3);
 *   tour.stop();
 *   tour.isRunning();
 *
 * Step shape: { target, title, content, placement, data }
 *   placement: 'left' | 'right' | 'bottom' | 'center'
 */

const SPOTLIGHT_Z = 100100;
const TOOLTIP_Z   = 100200;
const SPOT_PAD    = 6;    // px padding around target
const TIP_WIDTH   = 340;  // px tooltip width
const TIP_GAP     = 18;   // px gap between target and tooltip
const MAX_RETRIES = 6;    // attempts to find a missing target element

export function createTour(steps, callbacks = {}) {
  const { onNext, onEnd } = callbacks;

  let index   = 0;
  let running = false;
  let retries = 0;
  let elSpot  = null;
  let elTip   = null;
  let styleEl = null;

  // ── Public API ───────────────────────────────────────────────

  function isRunning() { return running; }

  function start(startIndex = 0) {
    if (running) stop();
    running = true;
    _buildDOM();
    document.body.classList.add('tour-active');
    goTo(startIndex);
  }

  function stop() {
    running = false;
    _removeDOM();
    document.body.classList.remove('tour-active');
    onEnd?.();
  }

  function goTo(i) {
    if (!running) return;
    retries = 0;
    index   = i;
    if (index < 0 || index >= steps.length) { stop(); return; }
    _showStep();
  }

  // ── Internal ─────────────────────────────────────────────────

  function _showStep() {
    if (!running) return;
    const step   = steps[index];
    const target = document.querySelector(step.target);

    if (!target) {
      // Hide the old spotlight/tooltip immediately so the previous step's
      // highlight doesn't "ghost" while we wait for the new target to appear.
      if (elSpot) elSpot.style.display = 'none';
      if (elTip)  elTip.style.display  = 'none';
      if (retries < MAX_RETRIES) { retries++; setTimeout(_showStep, 150); }
      return;
    }

    retries = 0;
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Let scroll and any CSS animations settle before measuring
    setTimeout(() => {
      if (!running) return;
      _placeSpotlight(target, step);
      _renderTooltip(step);
    }, 80);
  }

  function _placeSpotlight(target, step) {
    const r   = target.getBoundingClientRect();
    const pad = step.placement === 'center' ? 0 : SPOT_PAD;
    Object.assign(elSpot.style, {
      display:      'block',
      top:          `${r.top    - pad}px`,
      left:         `${r.left   - pad}px`,
      width:        `${r.width  + pad * 2}px`,
      height:       `${r.height + pad * 2}px`,
      borderRadius: step.placement === 'center' ? '4px' : '6px',
    });
  }

  function _renderTooltip(step) {
    const isFirst = index === 0;
    const isLast  = index === steps.length - 1;

    elTip.innerHTML = `
      <p class="tt-title">${step.title}</p>
      <p class="tt-body">${step.content}</p>
      <div class="tt-footer">
        <button class="tt-btn tt-skip">Skip tour</button>
        <div class="tt-actions">
          ${!isFirst ? '<button class="tt-btn tt-back">Back</button>' : ''}
          <button class="tt-btn tt-next">${isLast ? 'Finish' : 'Next'}</button>
        </div>
      </div>`;

    elTip.style.display = 'block';

    // Wire buttons
    elTip.querySelector('.tt-skip').onclick = stop;

    elTip.querySelector('.tt-next').onclick = () => {
      // onNext may return false to suppress the default advance
      // (used when the callback needs to advance asynchronously)
      const suppress = onNext?.(index, step) === false;
      if (!suppress) {
        if (isLast) stop();
        else goTo(index + 1);
      }
    };

    const backBtn = elTip.querySelector('.tt-back');
    if (backBtn) backBtn.onclick = () => goTo(index - 1);

    _placeTooltip(step);
  }

  function _placeTooltip(step) {
    const target = document.querySelector(step.target);
    if (!target) return;

    const r   = target.getBoundingClientRect();
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;

    if (step.placement === 'center') {
      Object.assign(elTip.style, { top: '50%', left: '50%', transform: 'translate(-50%,-50%)' });
      return;
    }

    elTip.style.transform = '';
    const ttH = elTip.getBoundingClientRect().height;

    let top, left;

    if (step.placement === 'left') {
      left = r.left - TIP_WIDTH - TIP_GAP;
      top  = r.top + r.height / 2 - ttH / 2;
      if (left < 8) left = r.right + TIP_GAP; // fall back to right
    } else if (step.placement === 'right') {
      left = r.right + TIP_GAP;
      top  = r.top + r.height / 2 - ttH / 2;
    } else if (step.placement === 'top') {
      top  = r.top - ttH - TIP_GAP;
      left = r.left + r.width / 2 - TIP_WIDTH / 2;
    } else if (step.placement === 'top-right') {
      top  = r.top + TIP_GAP;
      left = r.right - TIP_WIDTH - TIP_GAP;
    } else { // bottom
      top  = r.bottom + TIP_GAP;
      left = r.left + r.width / 2 - TIP_WIDTH / 2;
    }

    left = Math.max(8, Math.min(left, vpW - TIP_WIDTH - 8));
    top  = Math.max(8, Math.min(top,  vpH - ttH - 8));

    Object.assign(elTip.style, { top: `${top}px`, left: `${left}px` });
  }

  function _buildDOM() {
    styleEl = document.createElement('style');
    styleEl.textContent = `
      .tour-spotlight {
        position: fixed;
        display: none;
        pointer-events: none;
        box-shadow: 0 0 0 9999px rgba(0,0,0,0.30);
        transition: top .2s ease, left .2s ease, width .2s ease, height .2s ease;
      }
      .tour-tooltip {
        position: fixed;
        display: none;
        width: ${TIP_WIDTH}px;
        background: rgba(15, 23, 42, 0.40);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 16px;
        box-shadow: 0 24px 60px rgba(0,0,0,.7), 0 0 0 1px rgba(99,102,241,.15);
        padding: 18px 20px;
        font-family: inherit;
        box-sizing: border-box;
      }
      .tt-title {
        margin: 0 0 7px;
        color: #f8fafc;
        font-size: 14px;
        font-weight: 700;
        line-height: 1.3;
      }
      .tt-body {
        margin: 0;
        color: #94a3b8;
        font-size: 13px;
        line-height: 1.65;
      }
      .tt-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 14px;
      }
      .tt-actions { display: flex; align-items: center; gap: 6px; }
      .tt-btn {
        background: none;
        border: none;
        cursor: pointer;
        font-family: inherit;
        padding: 0;
      }
      .tt-skip { color: #475569; font-size: 12px; }
      .tt-back { color: #64748b; font-size: 13px; padding: 4px 8px; }
      .tt-next {
        background: #6366f1;
        color: #fff;
        border-radius: 9px;
        font-size: 13px;
        font-weight: 600;
        padding: 8px 16px;
      }
      .tt-next:hover { background: #4f52c8; }
      .tt-back:hover { color: #94a3b8; }
      .tt-skip:hover { color: #64748b; }
    `;
    document.head.appendChild(styleEl);

    elSpot = document.createElement('div');
    elSpot.className = 'tour-spotlight';
    elSpot.style.zIndex = SPOTLIGHT_Z;

    elTip = document.createElement('div');
    elTip.className = 'tour-tooltip';
    elTip.style.zIndex = TOOLTIP_Z;

    document.body.append(elSpot, elTip);
  }

  function _removeDOM() {
    elSpot?.remove();
    elTip?.remove();
    styleEl?.remove();
    elSpot = elTip = styleEl = null;
  }

  return { start, stop, goTo, isRunning };
}
