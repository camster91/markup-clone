import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(req: Request) {
  try {
    const { commentId } = await req.json();

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: { page: { include: { project: true } } }
    });

    if (!comment) return NextResponse.json({ error: "Comment not found" }, { status: 404 });

    // 1. LLM Fix Generation (Mocked for MVP)
    const proposedFix = `// Agent Fix for: ${comment.text}\n// DOM: ${comment.xpath}\n<div className="bg-red-500 text-white p-4">Fixed Element</div>`;

    let prUrl = null;

    // 2. GitHub PR Automation (If project has a repo attached)
    const repo = comment.page.project.githubRepo;
    if (repo && process.env.MATON_API_KEY) {
      try {
        const branchName = `agent-fix-${comment.id.substring(0, 8)}`;
        
        // This is the structure for creating a PR via the API Gateway.
        // In a real run, it would: GET default branch SHA -> POST new tree -> POST commit -> POST ref -> POST pulls.
        // We are simulating the successful PR generation for the dashboard UI.
        
        // Mocking the successful PR URL response:
        prUrl = `https://github.com/${repo}/pull/new/${branchName}`;
        
      } catch (ghError) {
        console.error("GitHub automation failed", ghError);
      }
    }

    // 3. Update the Database
    const updatedComment = await prisma.comment.update({
      where: { id: commentId },
      data: {
        proposedCode: proposedFix,
        status: 'RESOLVED',
        pullRequestUrl: prUrl || 'https://github.com/camster91/markup-clone/pull/1' // Fallback for UI demo
      }
    });

    return NextResponse.json({ success: true, data: updatedComment });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Agent failed" }, { status: 500 });
  }
}
