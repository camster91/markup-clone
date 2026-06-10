import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiKey } from '@/lib/auth';

export async function GET(req: Request) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const projects = await prisma.project.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json(projects);
}

export async function POST(req: Request) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  try {
    const body = await req.json();
    const { name, domain, githubRepo } = body;
    if (!name || !domain) return NextResponse.json({ error: 'name and domain required' }, { status: 400 });
    const existing = await prisma.project.findFirst({ where: { domain } });
    if (existing) return NextResponse.json({ error: 'domain already exists' }, { status: 409 });
    const project = await prisma.project.create({ data: { name, domain, githubRepo: githubRepo || null } });
    return NextResponse.json(project, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown' }, { status: 500 });
  }
}