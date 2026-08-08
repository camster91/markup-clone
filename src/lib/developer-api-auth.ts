import { prisma } from './prisma';
import { consume } from './rate-limit';
import {
  DEVELOPER_API_SCOPE,
  hashDeveloperToken,
  isDeveloperTokenShape,
  parseBearerToken,
} from './developer-api-tokens';

type DeveloperScope = typeof DEVELOPER_API_SCOPE;

export type DeveloperApiAuthResult =
  | { ok: true; tokenId: string; projectId: string; scope: DeveloperScope }
  | {
      ok: false;
      status: 401 | 429;
      code: 'AUTH_REQUIRED' | 'AUTH_INVALID' | 'RATE_LIMITED';
      error: string;
      retryAfterSec?: number;
    };

export async function authenticateDeveloperApi(
  req: Request,
  projectId: string,
  requiredScope: DeveloperScope,
  now = new Date(),
): Promise<DeveloperApiAuthResult> {
  const authorization = req.headers.get('authorization');
  if (!authorization) {
    return { ok: false, status: 401, code: 'AUTH_REQUIRED', error: 'Bearer token required' };
  }
  const parsed = parseBearerToken(authorization);
  if (!parsed.ok || !isDeveloperTokenShape(parsed.value)) {
    return { ok: false, status: 401, code: 'AUTH_INVALID', error: 'Invalid developer API token' };
  }
  const tokenHash = hashDeveloperToken(parsed.value);
  const token = await prisma.projectApiToken.findUnique({
    where: { tokenHash },
    select: {
      id: true, projectId: true, scope: true, expiresAt: true, revokedAt: true,
      project: { select: { archivedAt: true } },
    },
  });
  if (
    !token
    || token.projectId !== projectId
    || token.scope !== requiredScope
    || token.revokedAt !== null
    || (token.expiresAt !== null && token.expiresAt.getTime() <= now.getTime())
  ) {
    return { ok: false, status: 401, code: 'AUTH_INVALID', error: 'Invalid developer API token' };
  }
  const limit = consume(`developer-api:${tokenHash}`, { maxTokens: 120, refillRate: 2 });
  if (!limit.ok) {
    return {
      ok: false, status: 429, code: 'RATE_LIMITED', error: 'Too many requests',
      retryAfterSec: Math.max(1, Math.ceil(limit.retryAfterSec ?? 1)),
    };
  }
  void prisma.projectApiToken.update({
    where: { id: token.id },
    data: { lastUsedAt: now },
  }).catch((error: unknown) => console.error('Developer token usage update failed:', error));
  return { ok: true, tokenId: token.id, projectId: token.projectId, scope: requiredScope };
}
