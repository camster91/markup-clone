import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import NewProjectForm from '@/components/NewProjectForm';
import TeamAccessManager from '@/components/TeamAccessManager';
import TeamReviewDefaultsForm from '@/components/TeamReviewDefaultsForm';
import { prisma } from '@/lib/prisma';
import { assertTeamRole, getCallerUser } from '@/lib/teams';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string; teamId: string }>;
};

export default async function TeamDetailPage({ params }: PageProps) {
  const { id: workspaceId, teamId } = await params;
  const caller = await getCallerUser();
  if (!caller) redirect('/');

  const access = await assertTeamRole(workspaceId, teamId);
  if (!access.ok) notFound();

  if (access.membershipRole === 'guest') {
    if (!access.membershipProjectId) notFound();
    redirect(`/projects/${access.membershipProjectId}`);
  }

  const canManageTeam =
    access.membershipRole === 'owner' || access.membershipRole === 'operator';
  const canCreateProject = canManageTeam || access.membershipRole === 'contributor';

  const team = await prisma.team.findFirst({
    where: { id: teamId, workspaceId },
    include: {
      workspace: { select: { id: true, name: true } },
      members: canManageTeam
        ? {
            orderBy: { createdAt: 'asc' },
            select: { id: true, email: true, role: true, projectId: true },
          }
        : false,
      projects: {
        where: canCreateProject ? undefined : { archivedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, domain: true, archivedAt: true },
      },
    },
  });
  if (!team) notFound();
  const activeProjects = team.projects.filter((project) => !project.archivedAt);
  const archivedProjects = canCreateProject
    ? team.projects.filter((project) => Boolean(project.archivedAt))
    : [];

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          <Link
            href={`/workspaces/${workspaceId}`}
            className="mb-2 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
          >
            <span aria-hidden="true">←</span>
            <span>{team.workspace.name}</span>
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">{team.name}</h1>
              <p className="mt-1 text-sm text-gray-500">
                Client account · {activeProjects.length} active site{activeProjects.length === 1 ? '' : 's'}
                {canManageTeam ? (
                  <>
                    {' · '}
                    {team.members.length} member{team.members.length === 1 ? '' : 's'}
                  </>
                ) : null}
              </p>
            </div>
            {access.membershipRole === 'contributor' ? (
              <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-800">
                Contributor access
              </span>
            ) : access.membershipRole === 'client' ? (
              <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-800">
                Client review access
              </span>
            ) : null}
          </div>
        </header>

        {canCreateProject ? <NewProjectForm teamId={team.id} /> : null}

        <div
          className={
            canManageTeam
              ? 'grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]'
              : 'grid gap-6'
          }
        >
          <section aria-labelledby="team-projects-heading">
            <h2 id="team-projects-heading" className="mb-3 text-lg font-semibold text-gray-900">
              Sites
            </h2>
            {activeProjects.length === 0 ? (
              <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
                No active sites for this client yet.
              </div>
            ) : (
              <ul className="space-y-3">
                {activeProjects.map((project) => (
                  <li key={project.id}>
                    <Link
                      href={`/projects/${project.id}`}
                      className="block rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow"
                    >
                      <span className="font-medium text-gray-900">{project.name}</span>
                      <span className="mt-1 block truncate text-sm text-gray-500">{project.domain}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {archivedProjects.length > 0 ? (
              <div className="mt-6">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="font-semibold text-gray-900">Archived sites</h3>
                  <Link href="/archive" className="text-sm text-blue-700 hover:underline">Open archive →</Link>
                </div>
                <ul className="space-y-2">
                  {archivedProjects.map((project) => (
                    <li key={project.id}>
                      <Link href={`/projects/${project.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm hover:border-blue-300">
                        <span className="min-w-0 truncate font-medium text-gray-800">{project.name}</span>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">Archived</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          {canManageTeam ? (
            <aside className="space-y-6">
              <TeamReviewDefaultsForm
                workspaceId={workspaceId}
                teamId={team.id}
                reviewRoundNameTemplate={team.reviewRoundNameTemplate}
                reviewRoundCommentsPaused={team.reviewRoundCommentsPaused}
              />
              <TeamAccessManager
                workspaceId={workspaceId}
                teamId={team.id}
                projects={activeProjects.map(({ id, name }) => ({ id, name }))}
                members={team.members.map((member) => ({
                  ...member,
                  role: member.role as 'owner' | 'contributor' | 'client' | 'guest',
                }))}
              />
            </aside>
          ) : null}
        </div>
      </div>
    </main>
  );
}
