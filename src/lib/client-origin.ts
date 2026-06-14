// Client-side helpers for the dashboard's fetch Origin header.
//
// This module exists as FOOTGUN DEFENSE, not a fix for a current bug.
//
// The dashboard's API routes (under /api/projects/*) gate writes behind an
// Origin allow-list that hard-codes "https://markup.ashbi.ca". Several client
// components used to spell that literal in their fetch headers. That's fine
// for the single production deploy we run today, but it has two failure modes
// that this helper removes:
//
//   1. Refactor risk. Six call sites each carried the literal. Miss one when
//      adding a new fetch and the new endpoint silently 403s because the
//      Origin header is "http://localhost:3000" or similar.
//   2. Multi-tenant risk. If we ever deploy this app under a second hostname
//      (preview, staging, white-label), every fetch now has to be updated
//      again. Centralizing the value behind a build-time env var means
//      one source of truth per build, and no runtime branching on the client.
//
// `process.env.NEXT_PUBLIC_DASHBOARD_HOST` is the single tunable. Next.js
// inlines any `NEXT_PUBLIC_*` env var at build time, so the client receives
// the value that was baked in at `next build` — no hydration mismatch, no
// `window` access, no runtime fetch. If the env var is absent, the default
// preserves today's literal so existing single-host deploys behave
// identically.

const DEFAULT_DASHBOARD_ORIGIN = 'https://markup.ashbi.ca';

export function getDashboardOrigin(): string {
  return process.env.NEXT_PUBLIC_DASHBOARD_HOST || DEFAULT_DASHBOARD_ORIGIN;
}

export function dashboardHeaders(): Record<string, string> {
  return { Origin: getDashboardOrigin() };
}
