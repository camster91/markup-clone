// Configuration reader for the markup widget.
//
// The widget is loaded via <script src="/widget.js" data-api-key="..." data-project-id="...">.
// JSDOM doesn't expose document.currentScript for dynamically added scripts, so we
// fall back to the last <script> in the document (which is the convention for
// embed-style scripts).
//
// All exports are pure functions / values: no side effects, no DOM mutation.
// The lifecycle module owns the "bail out if config is missing" decision.

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

/**
 * Find the <script> tag the widget was loaded from.
 * Tries document.currentScript first; falls back to the last <script> in
 * the document (matches the IIFE's original behavior in public/widget.js).
 */
export function findScriptEl(): HTMLScriptElement | null {
  const current = (document as Document).currentScript as HTMLScriptElement | null;
  if (current) return current;
  const scripts = document.getElementsByTagName('script');
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
  const authorName = scriptEl.getAttribute('data-author-name') || 'Client';
  return { scriptSrc, apiUrl, apiKey, projectId, authorName };
}

/**
 * Compute the API URL for a given script src. Exported separately so the
 * unit test can exercise the URL-derivation rule without needing a DOM.
 */
export function parseHost(src: string): string {
  return src.replace(/\/widget\.js.*$/, '') + '/api/pins';
}
