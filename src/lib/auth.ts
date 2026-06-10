import { NextResponse } from 'next/server';

const DASHBOARD_HOST = process.env.DASHBOARD_HOST || 'markup.ashbi.ca';

export function requireApiKey(req: Request): NextResponse | null {
  const required = process.env.MUP_API_KEY;
  if (!required) return null; // Auth disabled if not configured (dev mode)

  // Same-origin browser requests from the dashboard are implicitly trusted.
  // The browser's Origin header is the dashboard host, and the request cookie
  // (if we ever set one) would prove it. For now: skip auth when the Origin
  // header matches the configured dashboard host.
  const origin = req.headers.get('origin');
  if (origin && origin.includes(DASHBOARD_HOST)) {
    return null;
  }
  // For server-to-server or same-origin fetch without Origin (e.g. older
  // clients), also accept Sec-Fetch-Site=same-origin.
  const secFetchSite = req.headers.get('sec-fetch-site');
  if (secFetchSite === 'same-origin') {
    return null;
  }

  const provided = req.headers.get('x-api-key');
  if (provided === required) return null;

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
