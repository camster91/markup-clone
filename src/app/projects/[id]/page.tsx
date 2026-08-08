// /projects/[id]
//
// Per-project detail page. Server component that fetches the
// project by id and renders the full <ProjectDetail> client island.
//
// Why a server component: the first paint needs the entire
// project tree (project header, all pages, all screenshots, all
// pins, all comments, all annotations) to avoid a loading flash.
// The tree is small enough to embed in the HTML — projects with
// hundreds of pins are still well under the 1MB HTML budget
// (a 1000-pin project is ~200KB of HTML at the worst). The
// client <ProjectDetail> takes over from there: it polls the
// list endpoint for delta updates, hosts the presence heartbeat,
// and wires the recapture / pin / comment flows.
//
// Auth: direct navigation is authorized on the server before the
// full project tree is loaded. Anonymous callers and authenticated
// users outside the project's team receive the same 404 as a missing
// project. The /share/[token] path is the explicit public read-only
// escape hatch and carries its own token authorization.
//
// Team-scope gate: a project with teamId != NULL is only visible
// to a caller who is a member of that team. We check that on the
// server before fetching the tree, and we render a 404 (NOT a
// 403) for both "project not found" and "project not in your
// teams" — leaking the distinction would let a probing caller
// enumerate project ids. Legacy / unscoped projects (teamId IS
// NULL) remain visible to authenticated dashboard callers, matching
// the transitional single-project dashboard behaviour.
//
// 404: if the project is missing, deleted, or in a team the
// caller doesn't belong to, call Next.js's notFound() helper.
// The route's not-found.tsx renders the 404 page and the response
// carries a 404 status. We deliberately do NOT distinguish "bad
// id" from "deleted" from "no permission" — all three look like
// 404 to the user, which is the right shape for a
// dashboard-internal route.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import ProjectDetail from '@/components/ProjectDetail';
import type { ProjectWithPages } from '@/lib/types';
import { assertProjectAccessible } from '@/lib/teams';
import { projectDetailInclude, serializeProjectDetail } from '@/lib/project-detail-dto';

// force-dynamic: a project detail page is a live view. Caching
// the HTML for 60s would mean a deleted project still renders
// for the cache lifetime, and a new pin would not show up for
// up to a minute. The poll on the client side picks up deltas
// after the first paint; the first paint itself must be fresh.
export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ProjectDetailPage({ params }: PageProps) {
  const { id } = await params;

  // Authorize before loading the full project tree. The shared data-access
  // gate requires a session for legacy projects and team membership for
  // scoped projects. Missing and forbidden projects intentionally share the
  // same 404 response so identifiers cannot be enumerated.
  const access = await assertProjectAccessible(id);
  if (!access.ok) notFound();

  const project = await prisma.project.findUnique({
    where: { id },
    include: projectDetailInclude,
  });

  if (!project) {
    notFound();
  }

  // Serialize Date fields to ISO strings before handing the tree
  // to the client <ProjectDetail>. The component's TypeScript
  // types (PageWithScreenshots, ScreenshotWithPins, Pin,
  // FeedbackComment) declare createdAt / capturedAt as strings,
  // because in the browser pipeline /api/projects returns JSON
  // which stringifies dates. Forcing the conversion here keeps
  // the type contract the same — the page is a server component,
  // so the client components downstream never see the raw Date
  // objects.
  //
  // Annotations: parse pathJson into a `number[][]` `path` field
  // (matching the FeedbackAnnotation type and the
  // /api/projects/route.ts shape). A malformed pathJson would
  // have been rejected at write time by the POST /api/annotations
  // validator, so the JSON.parse here only fails on a
  // hand-crafted DB row; we fall back to an empty array so the
  // ScreenshotView doesn't throw on the bad row.
  const canAdmin = access.membershipRole === 'owner'
    || access.membershipRole === 'contributor'
    || access.membershipRole === 'operator';
  const serializedProject: ProjectWithPages = {
    ...serializeProjectDetail(project, canAdmin),
    accessRole: access.membershipRole,
  };

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <Link
              href="/"
              className="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1"
            >
              <span aria-hidden="true">←</span>
              <span>{project.archivedAt ? 'Archived sites' : 'Active sites'}</span>
            </Link>
            <h1 className="text-2xl font-semibold text-gray-900">{project.name}</h1>
            <div className="w-24" aria-hidden="true" />
          </div>
        </header>

        <ProjectDetail initialProject={serializedProject} />
      </div>
    </main>
  );
}
