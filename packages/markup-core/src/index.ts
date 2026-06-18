// @markup/core
//
// Re-exports of the shared primitives. The root app consumes these via
// the per-subpath entrypoints (e.g. `@markup/core/validation`) so each
// route pulls in only the surface it needs. The bare `.` import below
// is for callers that want the full bundle in one go (none today, but
// the seam is here for tools / scripts).

export * as validation from './validation';
export * as origin from './origin';
export * as rateLimit from './rate-limit';
export * as auth from './auth';
export * as email from './email';
