import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticateDeveloperApi } from '@/lib/developer-api-auth';
import { buildIssueHandoffV1 } from '@/lib/issue-handoff';
import { normalizeBrowserContext } from '@/lib/developer-context';
import { ISSUE_PRIORITIES, PIN_STATUSES, type IssuePriority } from '@/lib/issue-metadata';
import { parseHost } from '@/lib/origin';
import { validateProjectId, validateUuidParam } from '@/lib/validation';
import type { Pin } from '@/lib/types';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const API_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  Vary: 'Authorization',
};

const issueInclude = Prisma.validator<Prisma.PinInclude>()({
  assignee: { select: { id: true, email: true } },
  tags: { include: { tag: { select: { id: true, name: true, key: true } } } },
  reviewRound: { select: { id: true, number: true, name: true } },
  comments: {
    orderBy: { createdAt: 'asc' },
    include: { attachments: { select: { id: true, kind: true, mimeType: true, size: true } } },
  },
  screenshot: {
    select: {
      id: true, width: true, height: true, capturedAt: true,
      page: {
        select: {
          path: true,
          project: { select: { id: true, name: true, domain: true } },
        },
      },
    },
  },
});

type IssueRow = Prisma.PinGetPayload<{ include: typeof issueInclude }>;

function apiError(status: number, code: string, message: string, extraHeaders?: Record<string, string>) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { ...API_HEADERS, ...extraHeaders } },
  );
}

function parseLimit(value: string | null): number | null {
  if (value === null) return DEFAULT_LIMIT;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= 1 && parsed <= MAX_LIMIT ? parsed : null;
}

function asIssuePayload(row: IssueRow) {
  const normalized = normalizeBrowserContext(row.userAgent, row.platform);
  const selectors = (() => {
    try {
      const parsed: unknown = row.selectorCandidatesJson ? JSON.parse(row.selectorCandidatesJson) : [];
      return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string').slice(0, 5) : [];
    } catch {
      return [];
    }
  })();
  const pin: Pin = {
    id: row.id,
    xPercent: row.xPercent,
    yPercent: row.yPercent,
    status: row.status,
    priority: ((ISSUE_PRIORITIES as readonly string[]).includes(row.priority) ? row.priority : 'NONE') as IssuePriority,
    assignee: row.assignee,
    tags: row.tags.map(({ tag }) => tag),
    elementXPath: row.elementXPath,
    elementHTML: row.elementHTML,
    developerContext: {
      pageUrl: row.pageUrl,
      route: row.screenshot.page.path,
      viewport: row.viewportWidth !== null && row.viewportHeight !== null ? {
        width: row.viewportWidth,
        height: row.viewportHeight,
        devicePixelRatio: row.devicePixelRatio,
      } : null,
      browser: normalized.browser,
      platform: normalized.platform,
      selectors,
      elementSnippet: row.elementHTML,
      screenshot: {
        id: row.screenshot.id,
        width: row.screenshot.width,
        height: row.screenshot.height,
        capturedAt: row.screenshot.capturedAt.toISOString(),
      },
      reviewRound: row.reviewRound,
    },
    createdAt: row.createdAt.toISOString(),
    comments: row.comments.map((comment) => ({
      id: comment.id,
      text: comment.text,
      author: comment.author,
      authorRole: comment.authorRole,
      createdAt: comment.createdAt.toISOString(),
      attachments: comment.attachments.map((attachment) => ({
        id: attachment.id,
        kind: attachment.kind as 'image' | 'voice' | 'video',
        mimeType: attachment.mimeType,
        size: attachment.size,
        url: '',
      })),
    })),
    annotations: [],
  };
  return buildIssueHandoffV1({
    dashboardOrigin: parseHost(process.env.DASHBOARD_HOST).origin,
    project: row.screenshot.page.project,
    pagePath: row.screenshot.page.path,
    screenshot: {
      id: row.screenshot.id,
      width: row.screenshot.width,
      height: row.screenshot.height,
      capturedAt: row.screenshot.capturedAt.toISOString(),
    },
    pin,
  });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const projectId = validateProjectId(id);
  if (!projectId.ok) return apiError(400, 'INVALID_PROJECT_ID', projectId.error);
  const auth = await authenticateDeveloperApi(req, projectId.value, 'issues:read');
  if (!auth.ok) {
    return apiError(
      auth.status,
      auth.code,
      auth.error,
      auth.retryAfterSec ? { 'Retry-After': String(auth.retryAfterSec) } : undefined,
    );
  }

  const search = new URL(req.url).searchParams;
  const limit = parseLimit(search.get('limit'));
  const status = search.get('status');
  const priority = search.get('priority');
  if (limit === null
    || (status !== null && !(PIN_STATUSES as readonly string[]).includes(status))
    || (priority !== null && !(ISSUE_PRIORITIES as readonly string[]).includes(priority))) {
    return apiError(400, 'INVALID_QUERY', 'Invalid limit, status, or priority filter');
  }

  const uuidFilters = ['assigneeId', 'tagId', 'reviewRoundId', 'cursor'] as const;
  const values: Partial<Record<(typeof uuidFilters)[number], string>> = {};
  for (const key of uuidFilters) {
    const raw = search.get(key);
    if (raw === null) continue;
    const validated = validateUuidParam(raw, key);
    if (!validated.ok) return apiError(400, 'INVALID_QUERY', validated.error);
    values[key] = validated.value;
  }
  if (values.cursor) {
    const ownedCursor = await prisma.pin.findFirst({
      where: { id: values.cursor, screenshot: { page: { projectId: projectId.value } } },
      select: { id: true },
    });
    if (!ownedCursor) return apiError(400, 'INVALID_CURSOR', 'Cursor is not valid for this project');
  }

  const where: Prisma.PinWhereInput = {
    screenshot: { page: { projectId: projectId.value } },
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(values.assigneeId ? { assigneeId: values.assigneeId } : {}),
    ...(values.reviewRoundId ? { reviewRoundId: values.reviewRoundId } : {}),
    ...(values.tagId ? { tags: { some: { tagId: values.tagId } } } : {}),
  };
  const rows = await prisma.pin.findMany({
    where,
    include: issueInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(values.cursor ? { cursor: { id: values.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return NextResponse.json({
    apiVersion: 'v1',
    data: page.map(asIssuePayload),
    pagination: {
      limit,
      nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
    },
  }, { headers: API_HEADERS });
}
