import { NextResponse } from 'next/server';
import { prisma } from './prisma';

const DASHBOARD_HOST = process.env.DASHBOARD_HOST || 'markup.ashbi.ca';

function isDashboardOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (origin && origin.includes(DASHBOARD_HOST)) return true;
  if (req.headers.get('sec-fetch-site') === 'same-origin') return true;
  return false;
}

export function requireDashboardOrigin(req: Request): NextResponse | null {
  if (isDashboardOrigin(req)) return null;
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function requireProjectKey(req: Request, projectId: string): Promise<NextResponse | null> {
  if (isDashboardOrigin(req)) return null;

  const provided = req.headers.get('x-api-key');
  if (!provided) return NextResponse.json({ error: 'Missing X-Api-Key' }, { status: 401 });

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { apiKey: true },
  });
  if (!project || !project.apiKey) {
    return NextResponse.json({ error: 'No API key for project' }, { status: 403 });
  }
  if (provided !== project.apiKey) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
  }
  return null;
}

export function generateApiKey(): string {
  return 'mk_' + require('crypto').randomBytes(20).toString('hex');
}
