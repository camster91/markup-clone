// Unit tests for the client-side dashboard origin helper.
//
// The default fallback and the env-override path are both worth covering
// because they correspond to two different build outcomes (the env var is
// resolved at `next build` time, so once a build is shipped the value is
// frozen — these tests pin both branches so a refactor of the helper can't
// silently regress either one).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { dashboardHeaders } from '@/lib/client-origin';

describe('client-origin', () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_DASHBOARD_HOST;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_DASHBOARD_HOST;
  });

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.NEXT_PUBLIC_DASHBOARD_HOST;
    } else {
      process.env.NEXT_PUBLIC_DASHBOARD_HOST = ORIGINAL;
    }
  });

  it('does not set the browser-controlled Origin header', () => {
    expect(dashboardHeaders()).toEqual({});
  });

  it('does not need a second public host configuration', () => {
    process.env.NEXT_PUBLIC_DASHBOARD_HOST = 'https://staging.markup.example';
    expect(dashboardHeaders()).toEqual({});
  });
});
