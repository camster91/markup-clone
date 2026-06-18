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

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import NewTeamForm from '@/components/NewTeamForm';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function WorkspaceDetailPage({ params }: PageProps) {
  const { id } = await params;

  const workspace = await prisma.workspace.findUnique({
    where: { id },
    include: {
      teams: {
        orderBy: { createdAt: 'asc' },
        include: {
          _count: { select: { members: true, projects: true } },
        },
      },
    },
  });
  if (!workspace) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-5xl mx-auto">
        <header className="mb-6 flex items-center justify-between flex-wrap gap-4">
          <div>
            <Link
              href="/workspaces"
              className="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1 mb-2"
            >
              <span aria-hidden="true">←</span>
              <span>All workspaces</span>
            </Link>
            <h1 className="text-2xl font-semibold text-gray-900">{workspace.name}</h1>
            <p className="text-gray-500 mt-1 text-sm">
              {workspace.teams.length} team{workspace.teams.length === 1 ? '' : 's'} in this workspace
            </p>
          </div>
        </header>

        <NewTeamForm workspaceId={workspace.id} />

        {workspace.teams.length === 0 ? (
          <div className="bg-white p-12 text-center rounded-xl shadow-sm border border-gray-200 mt-6">
            <h3 className="text-lg font-medium text-gray-900">No teams yet</h3>
            <p className="text-gray-500 mt-2">Create the first team to start adding projects.</p>
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {workspace.teams.map((t) => (
              <li key={t.id}>
                <div className="block bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-lg font-medium text-gray-900 truncate">{t.name}</div>
                      <div className="text-sm text-gray-500 mt-1">
                        {t._count.members} member{t._count.members === 1 ? '' : 's'} ·{' '}
                        {t._count.projects} project{t._count.projects === 1 ? '' : 's'}
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
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
