import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(req: Request) {
  try {
    const { commentId } = await req.json();

    const comment = await prisma.comment.findUnique({
      where: { id: commentId }
    });

    if (!comment) return NextResponse.json({ error: "Comment not found" }, { status: 404 });

    // Mocking the AI Agent Execution for MVP
    // In production, this would pass the XPath and comment.text to Gemini/Claude
    // to read the DOM and return the exact code patch.
    const simulatedAgentOutput = `// Agent generated fix for: "${comment.text}"
// Targeting element: ${comment.xpath}
export default function UpdatedComponent() {
  return (
    <div className="updated-tailwind-classes">
      {/* Applied fix based on user feedback */}
    </div>
  )
}`;

    // Update the comment in DB with the proposed code and mark as RESOLVED
    const updatedComment = await prisma.comment.update({
      where: { id: commentId },
      data: {
        proposedCode: simulatedAgentOutput,
        status: 'RESOLVED'
      }
    });

    return NextResponse.json({ success: true, data: updatedComment });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Agent failed to execute" }, { status: 500 });
  }
}
