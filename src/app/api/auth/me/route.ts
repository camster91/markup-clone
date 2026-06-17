// GET /api/auth/me
//
// Returns the current authenticated user, or 401 if no valid session
// is present. Used by the dashboard's LoginForm to decide between
// "show login" and "show user info" on first render, and by client
// fetches to revalidate the session after a tab focus (the cookie
// could have been cleared server-side by a logout in another tab).
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await requireAuth();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  return NextResponse.json({ user }, { status: 200 });
}
