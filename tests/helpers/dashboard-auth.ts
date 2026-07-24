// Shared dashboard-session stubs for integration tests.
//
// Production routes now require `requireDashboardSession` (Origin +
// active session cookie). Route tests that previously only forged
// Origin need a cookie + a prisma.session.findUnique hit that
// resolves to a live user. Centralising the literals here keeps
// every file on the same contract.

export const TEST_SESSION_TOKEN = 'test-dashboard-session';

export const TEST_SESSION_USER = {
  id: 'user-test-1',
  email: 'operator@example.com',
  role: 'operator',
} as const;

/** Shape returned by prisma.session.findUnique({ include: { user } }). */
export function liveSessionRow(token: string = TEST_SESSION_TOKEN) {
  return {
    id: 'session-test-1',
    userId: TEST_SESSION_USER.id,
    token,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    createdAt: new Date(),
    user: { ...TEST_SESSION_USER },
  };
}

/**
 * Build a minimal next/headers cookies() stub that returns the
 * dashboard session cookie. Import and `vi.mock('next/headers', …)`
 * in each test file that hits requireDashboardSession / requireAuth.
 */
export function makeCookieStore(initialToken: string | undefined = TEST_SESSION_TOKEN) {
  const data: { value?: string } = { value: initialToken };
  return {
    data,
    get: (name: string) =>
      data.value !== undefined ? { name, value: data.value } : undefined,
    set: (name: string, value: string) => {
      void name;
      if (value === '' || value === undefined) data.value = undefined;
      else data.value = value;
    },
    delete: (name: string) => {
      void name;
      data.value = undefined;
    },
    has: (name: string) => {
      void name;
      return data.value !== undefined;
    },
  };
}
