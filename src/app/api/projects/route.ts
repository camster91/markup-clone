import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardOrigin, generateApiKey } from '@/lib/auth';
import { audit } from '@/lib/audit';
import crypto from 'crypto';

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
