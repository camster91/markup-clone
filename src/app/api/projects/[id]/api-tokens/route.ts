import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { assertProjectAdmin } from '@/lib/teams';
import { audit } from '@/lib/audit';
import { validateProjectId } from '@/lib/validation';
import {
  createDeveloperTokenSecret,
  DEVELOPER_API_SCOPE,
  validateDeveloperTokenExpiry,
  validateDeveloperTokenName,
} from '@/lib/developer-api-tokens';

const safeSelect = {
  id: true,
  name: true,
  tokenPrefix: true,
  tokenLastFour: true,
  scope: true,
  expiresAt: true,
  revokedAt: true,
  lastUsedAt: true,
  createdAt: true,
} as const;

type RouteContext = { params: Promise<{ id: string }> };

type SafeToken = {
  id: string; name: string; tokenPrefix: string; tokenLastFour: string; scope: string;
  expiresAt: Date | null; revokedAt: Date | null; lastUsedAt: Date | null; createdAt: Date;
};

function serializeSafeToken(token: SafeToken) {
  return {
    id: token.id, name: token.name, tokenPrefix: token.tokenPrefix,
    tokenLastFour: token.tokenLastFour, scope: token.scope,
    expiresAt: token.expiresAt, revokedAt: token.revokedAt,
    lastUsedAt: token.lastUsedAt, createdAt: token.createdAt,
  };
}

async function authorize(req: Request, id: string, csrf: boolean) {
  const authError = await requireDashboardAuth(req);
  if (authError) return { error: authError } as const;
  if (csrf) {
    const csrfError = requireCsrfToken(req);
    if (csrfError) return { error: csrfError } as const;
  }
  const projectId = validateProjectId(id);
  if (!projectId.ok) {
    return { error: NextResponse.json({ error: projectId.error }, { status: 400 }) } as const;
  }
  const access = await assertProjectAdmin(projectId.value);
  if (!access.ok) {
    return { error: NextResponse.json({ error: access.error }, { status: access.status }) } as const;
  }
  return { access, projectId: projectId.value } as const;
}

export async function GET(req: Request, { params }: RouteContext): Promise<NextResponse> {
  const { id } = await params;
  const authorized = await authorize(req, id, false);
  if ('error' in authorized) return authorized.error as NextResponse;
  const rows = await prisma.projectApiToken.findMany({
    where: { projectId: authorized.projectId },
    select: safeSelect,
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(rows.map(serializeSafeToken));
}

export async function POST(req: Request, { params }: RouteContext): Promise<NextResponse> {
  const { id } = await params;
  const authorized = await authorize(req, id, true);
  if ('error' in authorized) return authorized.error as NextResponse;

  let body: { name?: unknown; expiresAt?: unknown; scope?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  }
  const name = validateDeveloperTokenName(body.name);
  if (!name.ok) return NextResponse.json({ error: name.error }, { status: 400 });
  if (body.scope !== undefined && body.scope !== DEVELOPER_API_SCOPE) {
    return NextResponse.json({ error: `scope must be ${DEVELOPER_API_SCOPE}` }, { status: 400 });
  }
  const expiry = validateDeveloperTokenExpiry(body.expiresAt);
  if (!expiry.ok) return NextResponse.json({ error: expiry.error }, { status: 400 });

  const generated = createDeveloperTokenSecret();
  const token = await prisma.projectApiToken.create({
    data: {
      projectId: authorized.projectId,
      name: name.value,
      tokenHash: generated.tokenHash,
      tokenPrefix: generated.prefix,
      tokenLastFour: generated.lastFour,
      scope: DEVELOPER_API_SCOPE,
      expiresAt: expiry.value,
      createdById: authorized.access.caller.id,
    },
    select: safeSelect,
  });
  audit({
    actor: authorized.access.caller.id,
    action: 'developer_api_token.create',
    target: token.id,
    metadata: { projectId: authorized.projectId, scope: token.scope, expiresAt: token.expiresAt },
  });
  return NextResponse.json({ token: serializeSafeToken(token), secret: generated.secret }, { status: 201 });
}
