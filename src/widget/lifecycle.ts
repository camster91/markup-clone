// Lifecycle / boot for the markup widget.
//
// The IIFE wrapper, the click/mousemove listeners, the feedback-mode
// toggle, and the DOMContentLoaded boot live here. State that crosses
// module boundaries (isFeedbackMode, config) is kept on this module
// and exposed to the rest via a small init() entry point.

import { createToggleButton, clearHoverOutline, getLastHoveredEl, setLastHoveredEl } from './dom';
import { showModal, hideModal, getCurrentModal } from './form';
import { readConfig, type WidgetConfig } from './config';

let isFeedbackMode = false;
let booted = false;
let configRef: WidgetConfig | null = null;

/** Read by tests / debug; flips when the user clicks the toggle button. */
export function getIsFeedbackMode(): boolean {
  return isFeedbackMode;
}

/** Test seam: force feedback mode on/off without driving the DOM. */
export function setIsFeedbackMode(v: boolean): void {
  isFeedbackMode = v;
}

/** Test seam: read the live widget config (read once at boot). */
export function getConfig(): WidgetConfig | null {
  return configRef;
}

/** Install the toggle button's click handler. */
function installToggleHandler(btn: HTMLButtonElement): void {
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    e.preventDefault();
    isFeedbackMode = !isFeedbackMode;
    if (isFeedbackMode) {
      btn.style.background = '#DC2626';
      btn.innerHTML =
        '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#fff;margin-right:6px;vertical-align:middle;animation:markup-pulse 1.2s infinite"></span>Click anywhere to leave feedback';
      if (!document.getElementById('markup-pulse-style')) {
        const style = document.createElement('style');
        style.id = 'markup-pulse-style';
        style.textContent = '@keyframes markup-pulse{0%,100%{opacity:1}50%{opacity:0.4}}';
        document.head.appendChild(style);
      }
    } else {
      btn.style.background = '#0F172A';
      btn.innerHTML =
        '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#fff;margin-right:6px;vertical-align:middle"></span>Feedback';
      cleanupAll();
    }
  });
}

function cleanupAll(): void {
  hideModal();
  document.querySelectorAll('[id^="markup-pin-"]').forEach((p) => p.remove());
  clearHoverOutline();
}

/** Install the global click + mousemove handlers. */
function installListeners(cfg: WidgetConfig): void {
  document.addEventListener(
    'click',
    function (e) {
      if (!isFeedbackMode) return;
      const target = e.target as Element;
      if (target && target.closest && target.closest('#markup-toggle')) return;
      if (
        currentModalOpenAndClickOnPin(target)
      )
        return;
      const modal = getCurrentModal();
      if (modal && modal.box && modal.box.contains(target)) return;
      if (modal && modal.overlay && modal.overlay.contains(target)) return;

      e.preventDefault();
      e.stopPropagation();

      // Clear hover outline on click so pin doesn't sit on a stale outline
      clearHoverOutline();

      showModal(
        e.clientX,
        e.clientY,
        target,
        cfg.authorName,
        cfg.apiUrl,
        cfg.apiKey,
        cfg.projectId
      );
    },
    true
  );

  document.addEventListener('mousemove', function (e) {
    if (!isFeedbackMode) return;
    if (getCurrentModal()) return; // don't show outline while modal is open

    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    if (!el || el === getLastHoveredEl()) return;
    if (el && el.closest && el.closest('#markup-toggle')) return;

    clearHoverOutline();

    setLastHoveredEl(el);
    el!.style.outline = '2px dashed #FF0055';
    el!.style.outlineOffset = '2px';
    el!.style.transition = 'outline 0.1s';
  });
}

function currentModalOpenAndClickOnPin(target: Element): boolean {
  if (!getCurrentModal()) return false;
  return !!(target && target.closest && target.closest('[id^="markup-pin-"]'));
}

/** Boot the widget: read config, render toggle, install listeners. */
export function init(): void {
  if (booted) return;
  booted = true;

  const cfg = readConfig();
  if (!cfg) {
    console.warn(
      '[markup] widget missing data-api-key or data-project-id attribute. Not active.'
    );
    return;
  }
  if (!cfg.apiKey || !cfg.projectId) {
    console.warn(
      '[markup] widget missing data-api-key or data-project-id attribute. Not active.'
    );
    return;
  }
  configRef = cfg;

  const btn = createToggleButton();
  installToggleHandler(btn);
  installListeners(cfg);
}

/** DOMContentLoaded boot. The Vite IIFE wraps init() — the host page
 *  calls this either immediately (if document.readyState !== 'loading')
 *  or on DOMContentLoaded. The same logic as the original IIFE.
 */
export function boot(): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
