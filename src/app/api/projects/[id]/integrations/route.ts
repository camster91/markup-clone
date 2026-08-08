// /api/projects/[id]/integrations
//
// CRUD for the per-project outbound integration rows. Mirrors
// the conventions of /api/projects/[id]/subscribers:
//
//   GET   — list every integration for a project (dashboard).
//   POST  — create a new integration (dashboard).
//
// Auth: requireDashboardAuth (+ CSRF on POST). Team-scope via
// assertProjectAccessible. GET redacts webhook URLs / headers in
// configJson so a list response never leaks full secrets.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { audit } from '@/lib/audit';
import { validateProjectId } from '@/lib/validation';
import { assertProjectAdmin } from '@/lib/teams';
import { isIntegrationKind, type GitHubConfig, type IntegrationKind } from '@/lib/integrations/types';
import { validateConfig, validateStoredConfig } from '@/lib/integrations/validate';
import { generateWebhookSigningSecret } from '@/lib/integrations/signing';
import {
  encryptIntegrationCredential,
  loadIntegrationEncryptionKey,
} from '@/lib/integrations/credential-crypto';

/** Mask path segments after the host (token-bearing URLs). */
function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const segments = u.pathname.split('/').filter(Boolean);
    const path = segments.length > 0 ? `/${segments.map(() => '••••').join('/')}` : '';
    // Build manually so •••• is not percent-encoded by URL.pathname.
    return `https://${u.host}${path}`;
  } catch {
    return '••••';
  }
}

/**
 * Return a JSON string safe to emit on the list endpoint.
 * Webhook URLs keep host; path token segments become ••••.
 * Custom headers are fully redacted.
 */
export function redactConfig(kind: string, configJson: string): string {
  try {
    const cfg = JSON.parse(configJson) as Record<string, unknown>;
    if (kind === 'slack' || kind === 'discord') {
      if (typeof cfg.webhookUrl === 'string') {
        cfg.webhookUrl = redactUrl(cfg.webhookUrl);
      }
    } else if (kind === 'webhook') {
      if (typeof cfg.url === 'string') {
        cfg.url = redactUrl(cfg.url);
      }
      if (cfg.headers && typeof cfg.headers === 'object' && !Array.isArray(cfg.headers)) {
        const redacted: Record<string, string> = {};
        for (const k of Object.keys(cfg.headers as Record<string, unknown>)) {
          redacted[k] = '••••';
        }
        cfg.headers = redacted;
      }
    } else if (kind === 'github') {
      const validated = validateStoredConfig('github', cfg);
      return validated.ok ? JSON.stringify(validated.value) : '{}';
    }
    return JSON.stringify(cfg);
  } catch {
    return '{}';
  }
}

function publicIntegration(integration: {
  id: string;
  projectId: string;
  kind: string;
  configJson: string;
  lastSuccessAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  createdAt: Date;
  credentialCiphertext?: string | null;
}) {
  const result = {
    id: integration.id,
    projectId: integration.projectId,
    kind: integration.kind,
    configJson: integration.configJson,
    lastSuccessAt: integration.lastSuccessAt,
    lastError: integration.lastError,
    lastErrorAt: integration.lastErrorAt,
    createdAt: integration.createdAt,
  };
  return integration.kind === 'github'
    ? { ...result, credentialConfigured: Boolean(integration.credentialCiphertext) }
    : result;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = await requireDashboardAuth(req);
  if (authErr) return authErr;

  try {
    const { id: projectId } = await params;
    const idRes = validateProjectId(projectId);
    if (!idRes.ok) return NextResponse.json({ error: idRes.error }, { status: 400 });

    const access = await assertProjectAdmin(projectId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const integrations = await prisma.integration.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
    return NextResponse.json(
      integrations.map((integration) => {
        return {
          ...publicIntegration(integration),
          configJson: redactConfig(integration.kind, integration.configJson),
        };
      })
    );
  } catch (error) {
    console.error('Integration list error:', error);
    return NextResponse.json({ error: 'Failed to list integrations' }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = await requireDashboardAuth(req);
  if (authErr) return authErr;
  const csrfErr = requireCsrfToken(req);
  if (csrfErr) return csrfErr;

  try {
    const { id: projectId } = await params;
    const idRes = validateProjectId(projectId);
    if (!idRes.ok) return NextResponse.json({ error: idRes.error }, { status: 400 });

    const access = await assertProjectAdmin(projectId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = (await req.json()) as { kind?: unknown; config?: unknown };

    // 1. Validate kind against the closed set. We use the same
    //    isIntegrationKind() helper as the dispatcher so the
    //    set is defined exactly once.
    if (!isIntegrationKind(body.kind)) {
      return NextResponse.json(
        { error: 'kind must be one of: slack, discord, webhook, github' },
        { status: 400 }
      );
    }
    const kind: IntegrationKind = body.kind;

    // 2. Validate the kind-specific config shape.
    const configRes = validateConfig(kind, body.config);
    if (!configRes.ok) {
      return NextResponse.json({ error: configRes.error }, { status: 400 });
    }

    // 3. Insert. We store the config as a JSON string so the
    //    column is a plain TEXT — no Prisma `Json` mapping
    //    quirks. assertProjectAdmin already confirmed the
    //    project exists and is in scope.
    const signingSecret = kind === 'webhook' ? generateWebhookSigningSecret() : null;
    let configToStore: unknown = configRes.value;
    let credentialCiphertext: string | null = null;
    if (kind === 'github') {
      const github = configRes.value as GitHubConfig;
      try {
        credentialCiphertext = encryptIntegrationCredential(
          github.token,
          loadIntegrationEncryptionKey(),
        );
      } catch {
        return NextResponse.json(
          { error: 'GitHub credential encryption is not configured' },
          { status: 503 },
        );
      }
      configToStore = { owner: github.owner, repo: github.repo, labels: github.labels };
    }
    const integration = await prisma.integration.create({
      data: {
        projectId,
        kind,
        configJson: JSON.stringify(configToStore),
        ...(signingSecret ? { signingSecret } : {}),
        ...(credentialCiphertext ? { credentialCiphertext } : {}),
      },
    });

    // 4. Audit. Same `actor: projectId` convention as
    //    /subscribers — the integration creation is logically
    //    scoped to the project, not to a per-user identity.
    //    No metadata about the secret (the webhook URL is a
    //    credential); record only the kind.
    audit({
      actor: projectId,
      action: 'integration.create',
      target: projectId,
      metadata: { kind },
    });

    const safeIntegration = publicIntegration(integration);
    return NextResponse.json(
      signingSecret ? { ...safeIntegration, signingSecret } : safeIntegration,
      { status: 201 },
    );
  } catch (error) {
    console.error('Integration create error:', error);
    return NextResponse.json({ error: 'Failed to create integration' }, { status: 500 });
  }
}
