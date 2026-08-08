// DOM helpers for the markup widget: toggle button, hover outline, CSS path.
//
// These are stateful: `lastHoveredEl` is a module-level reference that
// `clearHoverOutline` and the lifecycle click handler use. The original
// IIFE kept it as a free variable; here it's exported as a setter so the
// test suite can drive hover state without re-reading the private var.

let lastHoveredEl: HTMLElement | null = null;

/** Append the floating Feedback toggle to the document body. */
export function createToggleButton(): HTMLButtonElement {
  if (!document.getElementById('markup-accessibility-style')) {
    const style = document.createElement('style');
    style.id = 'markup-accessibility-style';
    style.textContent =
      '#markup-toggle:focus-visible,[data-markup-dialog] button:focus-visible,' +
      '[data-markup-dialog] input:focus-visible,[data-markup-dialog] textarea:focus-visible{' +
      'outline:3px solid #2563EB !important;outline-offset:2px !important}';
    document.head.appendChild(style);
  }
  const btn = document.createElement('button');
  btn.id = 'markup-toggle';
  btn.type = 'button';
  // The inner <span> is a fixed decorative dot. The string is a static
  // template — no user data is interpolated, so this innerHTML assignment
  // is safe (and matches the original widget's behavior byte-for-byte).
  btn.innerHTML =
    '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#fff;margin-right:6px;vertical-align:middle"></span>Feedback';
  btn.style.cssText =
    'position:fixed;bottom:20px;right:20px;z-index:2147483646;min-width:44px;min-height:44px;padding:10px 16px;background:#0F172A;color:#fff;border:none;border-radius:24px;cursor:pointer;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,0.2);transition:background 0.15s';

  // The click handler reads/writes the lifecycle module's isFeedbackMode.
  // We don't import lifecycle.ts here to avoid a circular import: lifecycle
  // already imports the DOM module. Instead, the lifecycle module installs
  // the click handler directly on the button it owns. To keep this function
  // self-contained for unit tests, we expose the button-creation side as
  // pure DOM and the click-handler wiring lives in lifecycle.ts via
  // installToggleHandler(btn, …).
  document.body.appendChild(btn);
  return btn;
}

/** Remove any modal, all pin markers, and the hover outline. */
export function cleanupAll(opts: { closeModal?: () => void } = {}): void {
  if (opts.closeModal) opts.closeModal();
  document.querySelectorAll('[id^="markup-pin-"]').forEach((p) => p.remove());
  clearHoverOutline();
}

/** Reset the hover-outline element's inline styles. */
export function clearHoverOutline(): void {
  if (lastHoveredEl) {
    lastHoveredEl.style.outline = '';
    lastHoveredEl.style.outlineOffset = '';
    lastHoveredEl.style.transition = '';
    lastHoveredEl = null;
  }
}

/** Test seam: set the module-level hover target. */
export function setLastHoveredEl(el: HTMLElement | null): void {
  lastHoveredEl = el;
}

/** Test seam: read the module-level hover target. */
export function getLastHoveredEl(): HTMLElement | null {
  return lastHoveredEl;
}

/** Build a short CSS selector that uniquely identifies `el`. */
export function getCssPath(el: Element | null): string {
  if (!el || !(el instanceof Element)) return '';
  if (el.id) return '#' + el.id;
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.body && parts.length < 6) {
    let part = cur.tagName.toLowerCase();
    if (cur.classList && cur.classList.length > 0) {
      part += '.' + Array.from(cur.classList).slice(0, 2).join('.');
    } else {
      const parent = cur.parentNode;
      if (parent) {
        let i = 1;
        for (let sib = cur.previousElementSibling; sib; sib = sib.previousElementSibling) {
          if (sib.tagName === cur.tagName) i++;
        }
        part += ':nth-of-type(' + i + ')';
      }
    }
    parts.unshift(part);
    cur = cur.parentNode as Element | null;
  }
  return parts.join(' > ');
}
