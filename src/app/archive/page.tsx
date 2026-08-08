import Link from 'next/link';
import { redirect } from 'next/navigation';
import ArchivedSites from '@/components/ArchivedSites';
import { prisma } from '@/lib/prisma';
import type { ProjectSummary } from '@/lib/types';
import { canAdminProject, getCallerAdminTeamIds, getCallerUser, getProjectScopeWhere } from '@/lib/teams';

export const dynamic = 'force-dynamic';

export default async function ArchivePage() {
  const caller = await getCallerUser();
  if (!caller) redirect('/');
  const teamScope = await getProjectScopeWhere(caller);
  const adminTeamIds = caller.role === 'operator' ? [] : await getCallerAdminTeamIds(caller.id);
  const rows = await prisma.project.findMany({
    where: { AND: [teamScope, { archivedAt: { not: null } }] },
    select: {
      id: true, name: true, domain: true, apiKey: true, shareToken: true,
      teamId: true, archivedAt: true, createdAt: true, updatedAt: true,
      team: { select: { id: true, name: true } },
      pages: { select: { screenshots: { select: { pins: { select: { status: true } } } } } },
    },
    orderBy: { archivedAt: 'desc' },
  });
  const projects: ProjectSummary[] = rows.flatMap((project) => {
    if (!canAdminProject(caller, project.teamId, adminTeamIds)) return [];
    const screenshots = project.pages.flatMap((page) => page.screenshots);
    const pins = screenshots.flatMap((screenshot) => screenshot.pins);
    return [{
      id: project.id, name: project.name, domain: project.domain,
      archivedAt: project.archivedAt?.toISOString() ?? null,
      apiKey: null, shareToken: null, canAdmin: true, teamId: project.teamId, team: project.team,
      createdAt: project.createdAt.toISOString(), updatedAt: project.updatedAt.toISOString(),
      totalPages: project.pages.length, totalScreenshots: screenshots.length,
      totalPins: pins.length, openPins: pins.filter(({ status }) => status === 'OPEN').length,
    }];
  });

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          <Link href="/" className="mb-2 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <span aria-hidden="true">←</span><span>Active sites</span>
          </Link>
          <h1 className="text-2xl font-semibold text-gray-950">Archived sites</h1>
          <p className="mt-1 text-sm text-gray-500">Historical client work stays available without cluttering active delivery.</p>
        </header>
        <ArchivedSites projects={projects} />
      </div>
    </main>
  );
}
