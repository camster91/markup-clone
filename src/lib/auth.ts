import { NextResponse } from 'next/server';

export function requireApiKey(req: Request): NextResponse | null {
  const required = process.env.MUP_API_KEY;
  if (!required) return null; // Auth disabled if not configured (dev mode)
  const provided = req.headers.get('x-api-key');
  if (provided === required) return null;
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
