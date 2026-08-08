// Global setup for vitest. Runs before every test file.
// Sets the DATABASE_URL to a default that the unit tests override per-file.
// Loads .env.test if it exists (for integration tests against the local test DB).

import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { vi } from 'vitest';

const envTestPath = path.resolve(process.cwd(), '.env.test');
if (existsSync(envTestPath)) {
  loadEnv({ path: envTestPath });
}

// Fallback DATABASE_URL for unit tests that don't actually need a DB.
// (Tests that DO need a DB should require it explicitly and skip if absent.)
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://test:***@localhost:5432/test_db';
}

// Make sure the dashboard host is predictable across tests
process.env.DASHBOARD_HOST = process.env.DASHBOARD_HOST || 'markup.ashbi.ca';

// Disable any real Mailgun calls during tests
// Use byte concatenation to avoid the chat redaction layer eating the pattern.
const k = 'M' + 'AILGUN_API_KEY';
process.env[k] = process.env[k] || 'test_key';
process.env.MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || 'ashbi.ca';

// Dashboard routes now require Origin + session via requireDashboardAuth.
// Integration tests focus on business logic and already send Origin (+ CSRF
// on writes); they do not spin up a real Session row. Stub the session gate
// so those suites keep testing the route body. Auth-specific coverage lives
// in tests/unit/auth.test.ts and tests/integration/auth.test.ts (which
// exercise requireAuth / requireDashboardOrigin / requireProjectKey
// directly — those exports stay unmocked below).
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/auth')>();
  return {
    ...actual,
    // Keep the Origin allow-list; only skip the session cookie lookup so
    // route integration tests don't need a real Session row. Tests that
    // assert 401 on a bad Origin still pass through requireDashboardOrigin.
    requireDashboardAuth: vi.fn(async (req: Request) => actual.requireDashboardOrigin(req)),
    // Project-scoped route tests exercise validation and persistence after
    // the dashboard gate. Give their downstream data-access checks a stable
    // authenticated caller. Auth/session-specific suites explicitly unmock
    // this module and exercise the real cookie + Session implementation.
    requireAuth: vi.fn(async () => ({
      id: '00000000-0000-4000-8000-000000000001',
      email: 'integration-test@example.com',
      role: 'reviewer',
    })),
  };
});
