import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardOrigin } from '@/lib/auth';
import { consume } from '@/lib/rate-limit';
import { validatePinText } from '@/lib/validation';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireDashboardOrigin(req);
  if (authErr) return authErr;

  // Rate limit AFTER auth, BEFORE the DB write.
  // 30 tokens / 0.5 per second = 60s sustained per (origin, pinId).
  // Per (origin, pinId) so a busy reviewer on one pin doesn't starve the
  // bucket for any other pin they're reviewing at the same time, and so
  // a runaway client on a single pin is capped at 30/min. Note: rate-limit
  // state is in-process (see src/lib/rate-limit.ts) — fine for the current
  // single-instance deploy; will not share buckets across instances if we
  // ever scale horizontally.
  const origin = req.headers.get('origin') ?? 'unknown';
  const { id: pinId } = await params;
  const rateCheck = consume(`comments:origin:${origin}:${pinId}`, { maxTokens: 30, refillRate: 0.5 });
  if (!rateCheck.ok) {
    return new NextResponse(null, { status: 429, headers: { 'Retry-After': String(rateCheck.retryAfterSec) } });
  }

  try {
    const { id } = await params;
    const { text, author, authorRole } = await req.json();
    // Use the same validator as the pin-create flow (R0.3) so the comment
    // text gets the same length cap, trim, and null-byte rejection. A
    // missing/empty/whitespace-only text is rejected here (it would
    // produce a 500 from the prisma NOT NULL constraint otherwise).
    if (text !== undefined) {
      const textRes = validatePinText(text);
      if (!textRes.ok) {
        return NextResponse.json({ error: textRes.error }, { status: 400 });
      }
    } else {
      return NextResponse.json({ error: 'text required' }, { status: 400 });
    }
    const comment = await prisma.comment.create({
      data: {
        pinId: id,
        text,
        author: author || 'Reviewer',
        authorRole: authorRole || 'reviewer',
      },
    });

    // Reopen-on-reply: if the pin was RESOLVED, flip it back to OPEN.
    // This is the reviewer-side signal that more work is needed.
    const pin = await prisma.pin.findUnique({ where: { id }, select: { status: true } });
    if (pin?.status === 'RESOLVED') {
      await prisma.pin.update({ where: { id }, data: { status: 'OPEN' } });
    }

    return NextResponse.json({ success: true, data: comment }, { status: 201 });
  } catch (error) {
    console.error('Comment create error:', error);
    return NextResponse.json({ error: 'Failed to create comment' }, { status: 500 });
  }
}
