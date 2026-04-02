import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { projectId, path, text, xPercent, yPercent, xpath, screenSize } = body;

    // 1. Ensure the Project exists (for MVP we auto-create a default one if missing)
    let project = await prisma.project.findFirst({ where: { domain: 'dev-domain.com' } });
    if (!project) {
      project = await prisma.project.create({
        data: { name: 'Development Project', domain: 'dev-domain.com' }
      });
    }

    // 2. Ensure the Page exists
    let page = await prisma.page.findFirst({
      where: { projectId: project.id, path: path || '/' }
    });
    
    if (!page) {
      page = await prisma.page.create({
        data: { projectId: project.id, path: path || '/' }
      });
    }

    // 3. Create the Comment
    const comment = await prisma.comment.create({
      data: {
        pageId: page.id,
        text: text,
        xPercent: parseFloat(xPercent),
        yPercent: parseFloat(yPercent),
        xpath: xpath || '',
        screenSize: screenSize || '',
      }
    });
    
    return NextResponse.json({ success: true, data: comment }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to save feedback" }, { status: 500 });
  }
}

export async function OPTIONS() {
  return NextResponse.json({}, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
