// Shared CSRF cookie + header name constants.
//
// Lives in its own file (rather than being re-exported from either
// `src/lib/csrf.ts` or `src/lib/client-origin.ts`) so that BOTH the
// server (`src/lib/csrf.ts`, which imports `next/server`) and the
// client (`src/lib/client-origin.ts`, which is a "use client" module
// in the dashboard components) can use the same string literals
// without creating a circular or cross-boundary import.
//
// The server's `setCsrfCookie` writes a cookie with this name; the
// client's `csrfHeaders` reads the same cookie and sets a header
// with this name. They MUST agree on the literals — a typo in
// either would be a silent CSRF bypass. Centralizing them here
// removes the typo class of bug.

export const CSRF_COOKIE = 'markup.csrf';
export const CSRF_HEADER = 'X-CSRF-Token';
