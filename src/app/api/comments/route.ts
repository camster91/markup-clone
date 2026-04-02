import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    
    // For MVP, we just log it. Prisma integration will go here.
    console.log("New Feedback Received:", body);
    
    return NextResponse.json({ success: true, data: body }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to process feedback" }, { status: 500 });
  }
}

export async function OPTIONS() {
  // Handle CORS for the script tag widget
  return NextResponse.json({}, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
