// /workspaces/[id]
//
// Workspace detail page. Server component that fetches the
// workspace (with team + member + project counts) and renders a
// list of teams. The page also has small forms for creating a new
// team — they post JSON to /api/workspaces/[id]/teams and reload
// the page on success.
//
// force-dynamic: a team rename, project move, or new sign-up
// should appear on the next page load, not after a cache TTL. The
// query is O(teams) per workspace which is tiny in practice; the
// cost of caching is not worth the staleness.

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import NewTeamForm from '@/components/NewTeamForm';
import WorkspaceBrandingForm from '@/components/WorkspaceBrandingForm';
import { getCallerUser, getWorkspaceScopeWhere, normalizeTeamRole } from '@/lib/teams';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function WorkspaceDetailPage({ params }: PageProps) {
  const { id } = await params;
  const caller = await getCallerUser();
  if (!caller) redirect('/');

  const workspace = await prisma.workspace.findFirst({
    where: {
      AND: [{ id }, getWorkspaceScopeWhere(caller)],
    },
    include: {
      teams: {
        where: caller.role === 'operator'
          ? undefined
          : { members: { some: { userId: caller.id } } },
        orderBy: { createdAt: 'asc' },
        include: {
          members: {
            where: { userId: caller.id },
            select: { role: true, projectId: true },
          },
          _count: { select: { members: true, projects: true } },
        },
      },
    },
  });
  if (!workspace) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-5xl mx-auto">
        <header className="mb-6 flex items-center justify-between flex-wrap gap-4">
          <div>
            <Link
              href="/workspaces"
              className="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1 mb-2"
            >
              <span aria-hidden="true">←</span>
              <span>All agency workspaces</span>
            </Link>
            <h1 className="text-2xl font-semibold text-gray-900">{workspace.name}</h1>
            <p className="text-gray-500 mt-1 text-sm">
              {workspace.teams.length} client account{workspace.teams.length === 1 ? '' : 's'}
            </p>
          </div>
        </header>

        {caller.role === 'operator' ? (
          <>
            <NewTeamForm workspaceId={workspace.id} />
            <WorkspaceBrandingForm
              workspaceId={workspace.id}
              initialBranding={{
                brandName: workspace.brandName,
                logoUrl: workspace.logoUrl,
                accentColor: workspace.accentColor,
                reviewerWelcome: workspace.reviewerWelcome,
              }}
            />
          </>
        ) : null}

        <h2 className="mt-6 text-lg font-semibold text-gray-900">Client accounts</h2>

        {workspace.teams.length === 0 ? (
          <div className="bg-white p-12 text-center rounded-xl shadow-sm border border-gray-200 mt-6">
            <h3 className="text-lg font-medium text-gray-900">No client accounts yet</h3>
            <p className="text-gray-500 mt-2">Create the first client account to start adding sites.</p>
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {workspace.teams.map((t) => {
              const membershipRole = normalizeTeamRole(t.members[0]?.role);
              const isGuest = caller.role !== 'operator' && membershipRole === 'guest';
              const canSeeMemberCount = caller.role === 'operator' || membershipRole === 'owner';
              const projectCount = isGuest ? 1 : t._count.projects;
              return <li key={t.id}>
                <div className="block bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-lg font-medium text-gray-900 truncate">{t.name}</div>
                      <div className="text-sm text-gray-500 mt-1">
                        {canSeeMemberCount ? (
                          <>{t._count.members} member{t._count.members === 1 ? '' : 's'} {' · '}</>
                        ) : null}
                        {projectCount} site{projectCount === 1 ? '' : 's'}
                      </div>
                    </div>
                    <Link
                      href={`/workspaces/${workspace.id}/teams/${t.id}`}
                      className="text-blue-600 text-sm hover:underline"
                    >
                      Open →
                    </Link>
                  </div>
                </div>
              </li>;
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
