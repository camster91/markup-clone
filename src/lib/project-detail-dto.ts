import { Prisma } from '@prisma/client';
import { normalizeBrowserContext } from './developer-context';
import type { ProjectWithPages } from './types';
import { ISSUE_PRIORITIES, type IssuePriority } from './issue-metadata';
import { resolveWorkspaceBranding } from './branding';

export const projectDetailInclude = Prisma.validator<Prisma.ProjectInclude>()({
  pages: {
    orderBy: { createdAt: 'asc' },
    include: {
      screenshots: {
        orderBy: { capturedAt: 'desc' },
        include: {
          pins: {
            orderBy: { createdAt: 'asc' },
            include: {
              comments: { orderBy: { createdAt: 'asc' } },
              annotations: { orderBy: { createdAt: 'asc' } },
              reviewRound: { select: { id: true, number: true, name: true } },
              assignee: { select: { id: true, email: true } },
              tags: {
                include: { tag: { select: { id: true, name: true, key: true } } },
              },
            },
          },
        },
      },
    },
  },
  subscribers: true,
  tags: {
    orderBy: { name: 'asc' },
    select: { id: true, name: true, key: true },
  },
  team: {
    select: {
      workspace: {
        select: {
          name: true,
          brandName: true,
          logoUrl: true,
          accentColor: true,
          reviewerWelcome: true,
        },
      },
      members: {
        where: { userId: { not: null } },
        select: { user: { select: { id: true, email: true } } },
      },
    },
  },
});

export type ProjectDetailRow = Prisma.ProjectGetPayload<{
  include: typeof projectDetailInclude;
}>;

export function serializeProjectDetail(
  project: ProjectDetailRow,
  canAdmin: boolean
): ProjectWithPages {
  const parseSelectors = (value: string | null): string[] => {
    if (!value) return [];
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((selector): selector is string => typeof selector === 'string').slice(0, 5)
        : [];
    } catch {
      return [];
    }
  };

  const assignees = Array.from(
    new Map(
      (project.team?.members ?? [])
        .flatMap((member) => member.user ? [member.user] : [])
        .map((user) => [user.id, user] as const)
    ).values()
  ).sort((a, b) => a.email.localeCompare(b.email));

  return {
    id: project.id,
    name: project.name,
    domain: project.domain,
    archivedAt: project.archivedAt?.toISOString() ?? null,
    apiKey: canAdmin ? project.apiKey : null,
    shareToken: canAdmin ? project.shareToken : null,
    shareExpiresAt: canAdmin ? project.shareExpiresAt?.toISOString() ?? null : null,
    sharePasswordProtected: canAdmin ? Boolean(project.sharePasswordHash) : false,
    canAdmin,
    ...(project.team?.workspace ? {
      reviewBranding: resolveWorkspaceBranding(project.team.workspace),
    } : {}),
    ...(canAdmin ? {
      issueOptions: {
        assignees,
        tags: [...(project.tags ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
      },
    } : {}),
    pages: project.pages.map((page) => ({
      id: page.id,
      path: page.path,
      screenshots: page.screenshots.map((screenshot) => ({
        id: screenshot.id,
        storageKey: screenshot.storageKey,
        pageId: screenshot.pageId,
        width: screenshot.width,
        height: screenshot.height,
        capturedAt: screenshot.capturedAt.toISOString(),
        pins: screenshot.pins.map((pin) => {
          const hasDeveloperContext = Boolean(
            pin.pageUrl || pin.viewportWidth || pin.viewportHeight || pin.devicePixelRatio ||
            pin.userAgent || pin.platform || pin.selectorCandidatesJson || pin.elementXPath || pin.elementHTML
          );
          const normalized = normalizeBrowserContext(pin.userAgent, pin.platform);

          return {
          id: pin.id,
          xPercent: pin.xPercent,
          yPercent: pin.yPercent,
          status: pin.status,
          ...(canAdmin ? {
            priority: ((ISSUE_PRIORITIES as readonly string[]).includes(pin.priority)
              ? pin.priority
              : 'NONE') as IssuePriority,
            assignee: pin.assignee ?? null,
            tags: (pin.tags ?? []).map(({ tag }) => tag),
          } : {}),
          elementXPath: canAdmin ? pin.elementXPath : null,
          elementHTML: canAdmin ? pin.elementHTML : null,
          developerContext: canAdmin && hasDeveloperContext ? {
            pageUrl: pin.pageUrl,
            route: page.path,
            viewport: pin.viewportWidth !== null && pin.viewportHeight !== null ? {
              width: pin.viewportWidth,
              height: pin.viewportHeight,
              devicePixelRatio: pin.devicePixelRatio,
            } : null,
            browser: normalized.browser,
            platform: normalized.platform,
            selectors: parseSelectors(pin.selectorCandidatesJson),
            elementSnippet: pin.elementHTML,
            screenshot: {
              id: screenshot.id,
              width: screenshot.width,
              height: screenshot.height,
              capturedAt: screenshot.capturedAt.toISOString(),
            },
            reviewRound: pin.reviewRound,
          } : null,
          createdAt: pin.createdAt.toISOString(),
          comments: pin.comments.map((comment) => ({
            id: comment.id,
            text: comment.text,
            author: comment.author,
            authorRole: comment.authorRole,
            createdAt: comment.createdAt.toISOString(),
            attachments: [],
          })),
          annotations: (pin.annotations ?? []).map((annotation) => {
            let path: number[][] = [];
            try {
              const parsed = JSON.parse(annotation.pathJson);
              if (Array.isArray(parsed)) path = parsed as number[][];
            } catch {
              // Preserve the rest of the review if a hand-edited row is bad.
            }
            return {
              id: annotation.id,
              kind: annotation.kind as 'arrow' | 'box' | 'freehand',
              path,
              createdAt: annotation.createdAt.toISOString(),
            };
          }),
        };
        }),
      })),
    })),
  };
}
