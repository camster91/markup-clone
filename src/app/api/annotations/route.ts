import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireProjectKey } from '@/lib/auth';
import {
  validateAnnotationKind,
  validateAnnotationPath,
  validatePinId,
  LIMITS,
} from '@/lib/validation';
import { consume } from '@/lib/rate-limit';

// POST /api/annotations
//
// Create a drawn annotation (arrow / box / freehand) attached to an
// existing pin. Auth: widget-side `requireProjectKey` (the widget's
// flow is: create pin → wait for screenshot capture → draw → submit
// annotations). The projectId is derived from the pin's screenshot
// chain so the widget doesn't have to pass it (the pinId alone is the
// authoritative reference).
//
// Request body (JSON):
//   { pinId: string, kind: 'arrow' | 'box' | 'freehand', pathJson: string }
//
// Response:
//   201 { success: true, data: Annotation }
//   400 invalid payload (kind / pathJson / pinId)
//   401 missing / wrong X-Api-Key
//   403 pin belongs to a different project
//   404 pin not found
//   413 pathJson too large
//   429 rate limited
export async function POST(req: Request) {
  // === Body parsing ===
  // JSON body, not multipart. pathJson is already a string of arbitrary
  // length (up to ANNOTATION_PATH_MAX) so wrapping it in a multipart
  // form would force the client to URL-encode the JSON quotes — and
  // some browsers will silently mangle the boundary. Plain JSON is
  // simpler and matches how a Prisma Json field would have been sent.
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return NextResponse.json(
      { error: 'Content-Type must be application/json' },
      { status: 415 }
    );
  }

  let body: { pinId?: unknown; kind?: unknown; pathJson?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { pinId, kind, pathJson } = body;

  // === pinId shape check (cheap, no DB) ===
  if (typeof pinId !== 'string') {
    return NextResponse.json({ error: 'pinId required' }, { status: 400 });
  }
  const pinIdRes = validatePinId(pinId);
  if (!pinIdRes.ok) {
    return NextResponse.json({ error: pinIdRes.error }, { status: 400 });
  }
  const validatedPinId = pinIdRes.value;

  // === kind closed set ===
  const kindRes = validateAnnotationKind(kind);
  if (!kindRes.ok) {
    return NextResponse.json({ error: kindRes.error }, { status: 400 });
  }

  // === pathJson shape & content ===
  // Cheap pre-check: if the input is unreasonably long, reject with
  // 413 before the JSON.parse. The validator also caps at the same
  // limit; this branch is just the explicit 413 status the spec asks
  // for. The validator is still authoritative on shape.
  if (typeof pathJson === 'string' && pathJson.length > LIMITS.ANNOTATION_PATH_MAX) {
    return NextResponse.json(
      { error: `pathJson must be ≤${LIMITS.ANNOTATION_PATH_MAX} chars` },
      { status: 413 }
    );
  }
  const pathRes = validateAnnotationPath(pathJson);
  if (!pathRes.ok) {
    return NextResponse.json({ error: pathRes.error }, { status: 400 });
  }
  const canonicalPathJson = pathRes.value.json;

  // === Look up the pin's project so we can authorize the apiKey ===
  // We need projectId for requireProjectKey. Reading the full chain
  // (pin → screenshot → page → project) is one query; we use `select`
  // to limit the response footprint.
  const pin = await prisma.pin.findUnique({
    where: { id: validatedPinId },
    select: { id: true, screenshot: { select: { page: { select: { projectId: true } } } } },
  });
  if (!pin || !pin.screenshot?.page?.projectId) {
    return NextResponse.json({ error: 'pin not found' }, { status: 404 });
  }
  const projectId = pin.screenshot.page.projectId;

  // === Widget auth: X-Api-Key must match this project's key ===
  // The widget can carry any project's key; the auth helper looks up
  // the pin's project, so a key for project A cannot author annotations
  // on project B's pins — that's the cross-project leak we're guarding
  // against here. 403 (not 401) is the right code: the key is valid in
  // general, just not for this resource.
  const authErr = await requireProjectKey(req, projectId);
  if (authErr) return authErr;

  // === Rate limit: by IP + projectId, generous but bounded ===
  // 60 tokens / 1 per second = 60s sustained. The widget may draw
  // a handful of annotations per pin (arrow + box + freehand), so
  // 60/min is plenty for human use. The bucket is shared with /api/pins
  // (same key shape) so a flood of widget submissions gets one
  // consistent cap rather than two stacked buckets.
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  const rateLimitKey = `${ip}:${projectId}`;
  const rateLimit = consume(rateLimitKey, { maxTokens: 60, refillRate: 1 });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: 'Too many requests', retryAfterSec: rateLimit.retryAfterSec },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSec) } }
    );
  }

  // Defensive: in case future fields (e.g. color, strokeWidth) are
  // added to the schema but the validator forgets to gate them, the
  // `data` object below is a closed set — only fields we explicitly
  // read from the body end up in the create call.
  const created = await prisma.annotation.create({
    data: {
      pinId: validatedPinId,
      kind: kindRes.value,
      pathJson: canonicalPathJson,
    },
  });

  return NextResponse.json(
    { success: true, data: created },
    { status: 201 }
  );
}
