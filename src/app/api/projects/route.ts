import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardOrigin, generateApiKey } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { validateProjectDomain, validateProjectName } from '@/lib/validation';

export async function GET(req: Request) {
  const authErr = requireDashboardOrigin(req);
  if (authErr) return authErr;

  const projects = await prisma.project.findMany({
    include: {
      pages: {
        include: {
          screenshots: {
            orderBy: { capturedAt: 'desc' },
            include: {
              pins: {
                orderBy: { createdAt: 'asc' },
                include: {
                  comments: {
                    orderBy: { createdAt: 'asc' },
                  },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(projects);
}

export async function POST(req: Request) {
  const authErr = requireDashboardOrigin(req);
  if (authErr) return authErr;

  try {
    const { name, domain } = await req.json();
    if (!name || !domain) {
      return NextResponse.json({ error: 'name and domain required' }, { status: 400 });
    }

    // Validate name + domain BEFORE the DB write. validateProjectDomain
    // rejects local/loopback hostnames and IP addresses so a project can't
    // be registered that would later turn the recapture flow into an SSRF
    // vector (recapture.sh builds a URL of `https://<domain><path>` and
    // shells out to Chromium). The validator was previously implemented in
    // src/lib/validation.ts but never wired up here.
    const nameRes = validateProjectName(name);
    if (!nameRes.ok) return NextResponse.json({ error: nameRes.error }, { status: 400 });
    const domainRes = validateProjectDomain(domain);
    if (!domainRes.ok) return NextResponse.json({ error: domainRes.error }, { status: 400 });

    const apiKey = generateApiKey();
    const project = await prisma.project.create({
      data: { name, domain, apiKey },
    });
    audit({ actor: project.id, action: 'project.create', target: project.id });
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error('Project create error:', error);
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 });
  }
}
