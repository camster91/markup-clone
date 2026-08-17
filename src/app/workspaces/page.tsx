// /workspaces
//
// Workspaces index page. Server component that lists every workspace
// (with team counts) and renders a small create form below the
// list. The list is the same shape /api/workspaces returns — we
// fetch directly from prisma here instead of round-tripping through
// the API because the page is a server component and the data is
// already at hand.
//
// The home page already shows the project list, and the "Workspaces"
// link in the dashboard header (added in this commit) deep-links
// here. The page is intentionally minimal — a list of cards with
// team counts and a "+ New workspace" form — so it reads as the
// "org switcher" of the install, not a parallel project view.
//
// force-dynamic: a workspace / team rename or new sign-up should
// appear on the next page load, not after a cache TTL. The query is
// O(workspaces) which is tiny in practice; the cost of caching is
// not worth the staleness.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import NewWorkspaceForm from '@/components/NewWorkspaceForm';
import { getCallerUser, getWorkspaceScopeWhere } from '@/lib/teams';
import { signInRedirect } from '@/lib/sign-in-redirect';

export const dynamic = 'force-dynamic';

export default async function WorkspacesPage() {
  const caller = await getCallerUser();
  if (!caller) redirect(signInRedirect('/workspaces'));

  const workspaces = await prisma.workspace.findMany({
    where: getWorkspaceScopeWhere(caller),
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { teams: true } },
    },
  });

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-5xl mx-auto">
        <header className="mb-6 flex items-center justify-between flex-wrap gap-4">
          <div>
            <Link
              href="/"
              className="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1 mb-2"
            >
              <span aria-hidden="true">←</span>
              <span>Back to dashboard</span>
            </Link>
            <h1 className="text-2xl font-semibold text-gray-900">Agency workspaces</h1>
            <p className="text-gray-500 mt-1 text-sm">
              Each workspace is an agency or organisation. Client accounts contain their sites and review rounds.
            </p>
          </div>
        </header>

        {caller.role === 'operator' && <NewWorkspaceForm />}

        {workspaces.length === 0 ? (
          <div className="bg-white p-12 text-center rounded-xl shadow-sm border border-gray-200 mt-6">
            <h3 className="text-lg font-medium text-gray-900">No workspaces yet</h3>
            <p className="text-gray-500 mt-2">Create the first workspace to organise clients and sites.</p>
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {workspaces.map((w) => (
              <li key={w.id}>
                <Link
                  href={`/workspaces/${w.id}`}
                  className="block bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:border-gray-300 hover:shadow-md transition"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-lg font-medium text-gray-900 truncate">{w.name}</div>
                      <div className="text-sm text-gray-500 mt-1">
                        {w._count.teams} client account{w._count.teams === 1 ? '' : 's'}
                      </div>
                    </div>
                    <span className="text-blue-600 text-sm">Open →</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
