import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { domain, projectId, path, text, xPercent, yPercent, xpath, screenSize } = body;

    // Look up project by domain or projectId
    let project = null;
    if (domain) {
      project = await prisma.project.findFirst({ where: { domain } });
    } else if (projectId) {
      project = await prisma.project.findUnique({ where: { id: projectId } });
    }

    if (!project) {
      return NextResponse.json({ error: 'No project for domain' }, { status: 400 });
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