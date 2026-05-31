import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(req: Request) {
  try {
    const { commentId } = await req.json();

    if (!commentId) {
      return NextResponse.json({ error: "commentId is required" }, { status: 400 });
    }

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: { page: { include: { project: true } } }
    });

    if (!comment) return NextResponse.json({ error: "Comment not found" }, { status: 404 });

    // 1. LLM Fix Generation (Mocked for MVP)
    const proposedFix = `// Agent Fix for: ${comment.text}\n// DOM: ${comment.xpath}\n<div className="bg-red-500 text-white p-4">Fixed Element</div>`;

    let prUrl: string | null = null;
    let prError: string | null = null;
    let prAttempted = false;

    // 2. GitHub PR Automation (If project has a repo attached)
    const repo = comment.page.project.githubRepo;
    if (repo) {
      prAttempted = true;
      if (process.env.MATON_API_KEY) {
        try {
          const branchName = `agent-fix-${comment.id.substring(0, 8)}`;

          // This is the structure for creating a PR via the API Gateway.
          // In a real run, it would: GET default branch SHA -> POST new tree ->
          // POST commit -> POST ref -> POST pulls.
          // Currently simulating the successful PR generation for the dashboard UI.

          // Mocking the successful PR URL response:
          prUrl = `https://github.com/${repo}/pull/new/${branchName}`;

        } catch (ghError) {
          console.error("GitHub automation failed", ghError);
          prError = ghError instanceof Error ? ghError.message : "GitHub automation failed";
        }
      } else {
        prError = "MATON_API_KEY not configured — PR automation skipped";
      }
    }

    // 3. Update the Database — only mark RESOLVED if PR automation succeeded or wasn't needed
    const commentStatus = (prAttempted && prError && !prUrl) ? 'OPEN' : 'RESOLVED';

    const updatedComment = await prisma.comment.update({
      where: { id: commentId },
      data: {
        proposedCode: proposedFix,
        status: commentStatus,
        pullRequestUrl: prUrl || undefined,
      }
    });

    return NextResponse.json({
      success: true,
      data: updatedComment,
      pr: {
        attempted: prAttempted,
        url: prUrl,
        error: prError,
      }
    });
  } catch (error) {
    console.error("Agent endpoint error:", error);
    return NextResponse.json({
      error: "Agent failed",
      details: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 });
  }
}
