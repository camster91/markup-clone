// Configuration reader for the markup widget.
//
// The widget is loaded via <script src="/widget.js" data-api-key="..." data-project-id="...">.
//
// document.currentScript is only non-null while the widget script is being
// evaluated. When the snippet sits in <head>, the lifecycle defers init() to
// DOMContentLoaded, by which point currentScript is null — and a "last
// <script> in the document" fallback then picks whatever script happens to be
// at the end of <body>. So we capture currentScript synchronously at module
// evaluation time (the IIFE evaluates every module while the widget script is
// executing) and, failing that, look the script up by its data-api-key /
// data-project-key attribute or a src ending in widget.js.
//
// No DOM mutation happens here. The lifecycle module owns the "bail out if
// config is missing" decision.

export interface WidgetConfig {
  /** Absolute URL of the script element (used to derive the API base). */
  scriptSrc: string;
  /** Base for POST /api/pins, derived from scriptSrc by stripping /widget.js. */
  apiUrl: string;
  /** API key (from data-api-key, with data-project-key as a legacy alias). */
  apiKey: string;
  /** Project id (from data-project-id). */
  projectId: string;
  /** Author name shown as a default in the comment form. */
  authorName: string;
}

function asScript(el: Element | null | undefined): HTMLScriptElement | null {
  return el && el.tagName === 'SCRIPT' ? (el as HTMLScriptElement) : null;
}

/** The <script> that was executing when this module was evaluated. */
const scriptAtEval: HTMLScriptElement | null =
  typeof document !== 'undefined' ? asScript(document.currentScript) : null;

const WIDGET_SRC_RE = /\/widget\.js(?:[?#]|$)/;

function hasKeyAttr(el: Element): boolean {
  return el.hasAttribute('data-api-key') || el.hasAttribute('data-project-key');
}

function isWidgetScript(el: HTMLScriptElement | null): el is HTMLScriptElement {
  if (!el) return false;
  return hasKeyAttr(el) || WIDGET_SRC_RE.test(el.getAttribute('src') || '');
}

function lastOf<T>(list: ArrayLike<T>, pred: (item: T) => boolean): T | null {
  for (let i = list.length - 1; i >= 0; i--) {
    if (pred(list[i])) return list[i];
  }
  return null;
}

/**
 * Find the <script> tag the widget was loaded from, in priority order:
 *   1. the script that was executing when the widget module evaluated;
 *   2. the live document.currentScript (tests / synchronous init);
 *   3. the last <script> carrying data-api-key or data-project-key;
 *   4. the last <script> whose src ends in /widget.js;
 *   5. legacy fallback: the last <script> in the document.
 * 1 and 2 are only trusted when they look like the widget's tag, so a host
 * script that calls startFeedback() synchronously can't be mistaken for it.
 */
export function findScriptEl(): HTMLScriptElement | null {
  if (isWidgetScript(scriptAtEval)) return scriptAtEval;
  const current = asScript(document.currentScript);
  if (isWidgetScript(current)) return current;
  const scripts = document.getElementsByTagName('script');
  const byKey = lastOf(scripts, hasKeyAttr);
  if (byKey) return byKey;
  const bySrc = lastOf(scripts, (s) => WIDGET_SRC_RE.test(s.getAttribute('src') || ''));
  if (bySrc) return bySrc;
  if (scriptAtEval) return scriptAtEval;
  if (current) return current;
  if (scripts.length === 0) return null;
  return scripts[scripts.length - 1] as HTMLScriptElement;
}

/**
 * Read the widget config from the script tag the widget was loaded from.
 * Pure function — does not mutate the DOM.
 */
export function readConfig(): WidgetConfig | null {
  const scriptEl = findScriptEl();
  if (!scriptEl) {
    return null;
  }
  const scriptSrc = scriptEl.src || '';
  const apiUrl = scriptSrc.replace(/\/widget\.js.*$/, '') + '/api/pins';
  const apiKey =
    scriptEl.getAttribute('data-api-key') ||
    scriptEl.getAttribute('data-project-key') ||
    '';
  const projectId = scriptEl.getAttribute('data-project-id') || '';
  // data-author is accepted as an alias: earlier @ashbi/markup-sdk builds
  // set data-author instead of data-author-name, and pages loading the
  // widget through those builds are already deployed.
  const authorName =
    scriptEl.getAttribute('data-author-name') ||
    scriptEl.getAttribute('data-author') ||
    'Client';
  return { scriptSrc, apiUrl, apiKey, projectId, authorName };
}

/**
 * Compute the API URL for a given script src. Exported separately so the
 * unit test can exercise the URL-derivation rule without needing a DOM.
 */
export function parseHost(src: string): string {
  return src.replace(/\/widget\.js.*$/, '') + '/api/pins';
}
