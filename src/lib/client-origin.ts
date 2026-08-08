// Client-side headers for authenticated dashboard requests.
//
// This module exists as FOOTGUN DEFENSE, not a fix for a current bug.
//
// Browsers own the Origin header and do not allow application JavaScript to
// choose it. The server validates that browser-supplied value against the
// single DASHBOARD_HOST configuration. Keeping a second NEXT_PUBLIC host
// created build/runtime drift and attempted to set a forbidden header.
//
// CSRF: dashboardHeaders() also reads the `markup.csrf` cookie (when
// running in the browser) and sets X-CSRF-Token so state-changing
// fetches satisfy requireCsrfToken. On SSR / Node there is no
// `document`, so the cookie read is skipped.

import { CSRF_COOKIE, CSRF_HEADER } from './csrf-constants';

/** Read the double-submit CSRF cookie from document.cookie.
 *  Returns null on SSR or when the cookie is absent. */
function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const match = document.cookie.match(
      new RegExp(`(?:^|;\\s*)${CSRF_COOKIE.replace(/\./g, '\\.')}=([^;]*)`)
    );
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

export function dashboardHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const csrf = readCsrfCookie();
  if (csrf) {
    headers[CSRF_HEADER] = csrf;
  }
  return headers;
}
