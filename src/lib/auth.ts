import { NextResponse } from 'next/server';
import { prisma } from './prisma';

const DASHBOARD_HOST = process.env.DASHBOARD_HOST || 'markup.ashbi.ca';

export function requireApiKey(req: Request): NextResponse | null {
  const required = process.env.MUP_API_KEY;
  if (!required) return null; // Auth disabled if not configured (dev mode)

  // Same-origin browser requests from the dashboard are implicitly trusted.
  const origin = req.headers.get('origin');
  if (origin && origin.includes(DASHBOARD_HOST)) {
    return null;
  }
  const secFetchSite = req.headers.get('sec-fetch-site');
  if (secFetchSite === 'same-origin') {
    return null;
  }

  const provided = req.headers.get('x-api-key');
  if (provided === required) return null;

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function requireProjectKey(req: Request, projectId: string): Promise<NextResponse | null> {
  // Same-origin bypass
  const origin = req.headers.get('origin');
  if (origin && origin.includes(DASHBOARD_HOST)) return null;
  const secFetchSite = req.headers.get('sec-fetch-site');
  if (secFetchSite === 'same-origin') return null;

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || !project.apiKey) return NextResponse.json({ error: 'No API key for project' }, { status: 403 });
  const provided = req.headers.get('x-api-key');
  if (provided !== project.apiKey) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
  }
  return null;
}
