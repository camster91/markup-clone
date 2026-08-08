import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export interface ProjectSummaryCounts {
  totalPages: number;
  totalScreenshots: number;
  totalPins: number;
  openPins: number;
}

interface AggregateRow {
  projectId: string;
  totalPages: number | bigint | string;
  totalScreenshots: number | bigint | string;
  totalPins: number | bigint | string;
  openPins: number | bigint | string;
}

type AggregateClient = Pick<PrismaClient, '$queryRaw'>;

const ZERO_COUNTS: ProjectSummaryCounts = Object.freeze({
  totalPages: 0,
  totalScreenshots: 0,
  totalPins: 0,
  openPins: 0,
});

function normalizeCount(value: number | bigint | string): number {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

/**
 * Count overview activity for project ids that have already passed caller
 * scoping. Projects with no Page row are pre-seeded with zeroes.
 */
export async function loadProjectSummaryCounts(
  projectIds: string[],
  client: AggregateClient = prisma,
): Promise<Map<string, ProjectSummaryCounts>> {
  const counts = new Map(projectIds.map((projectId) => [projectId, ZERO_COUNTS]));
  if (projectIds.length === 0) return counts;

  const rows = await client.$queryRaw<AggregateRow[]>(Prisma.sql`
    SELECT
      page."projectId" AS "projectId",
      COUNT(DISTINCT page.id) AS "totalPages",
      COUNT(DISTINCT screenshot.id) AS "totalScreenshots",
      COUNT(pin.id) AS "totalPins",
      COUNT(pin.id) FILTER (WHERE pin.status = 'OPEN') AS "openPins"
    FROM "Page" AS page
    LEFT JOIN "Screenshot" AS screenshot ON screenshot."pageId" = page.id
    LEFT JOIN "Pin" AS pin ON pin."screenshotId" = screenshot.id
    WHERE page."projectId" IN (${Prisma.join(projectIds)})
    GROUP BY page."projectId"
  `);

  for (const row of rows) {
    if (!counts.has(row.projectId)) continue;
    counts.set(row.projectId, {
      totalPages: normalizeCount(row.totalPages),
      totalScreenshots: normalizeCount(row.totalScreenshots),
      totalPins: normalizeCount(row.totalPins),
      openPins: normalizeCount(row.openPins),
    });
  }
  return counts;
}

export function projectSummaryCountsOrZero(
  counts: Map<string, ProjectSummaryCounts>,
  projectId: string,
): ProjectSummaryCounts {
  return counts.get(projectId) ?? ZERO_COUNTS;
}
