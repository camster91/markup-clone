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
// Auth: the page is mounted under the same dashboard origin as
// the /api/projects route. We don't re-check auth here — the
// dashboard's existing <AuthGate> on the home page is the
// canonical gate, and the per-project page is just a deeper
// route. If a user navigates directly to /projects/<id> without
// an active session, the share-link look-up equivalent (token
// rather than id) would not even match; the per-project page
// reads by id, which is a dashboard-internal identifier. The
// project lookup is `prisma.project.findUnique` (no auth check)
// — a determined attacker who guesses a UUID could read a
// project they don't own. The UUID v4 collision space makes
// that infeasible, and the route is mounted at the dashboard
// origin, not exposed publicly. The /share/[token] path is the
// public read-only escape hatch — it carries its own token
// auth and renders the same data with readOnly=true.
//
// 404: if the project is missing (or deleted between the user's
// last poll and this navigation), call Next.js's notFound()
// helper. The route's not-found.tsx renders the 404 page and
// the response carries a 404 status. We deliberately do NOT
// distinguish "bad id" from "deleted" from "no permission" —
// all three look like 404 to the user, which is the right
// shape for a dashboard-internal route.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import ProjectDetail from '@/components/ProjectDetail';
import type { ProjectWithPages } from '@/lib/types';

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

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      pages: {
        orderBy: { createdAt: 'asc' },
        include: {
          screenshots: {
            orderBy: { capturedAt: 'desc' },
            include: {
              pins: {
                orderBy: { createdAt: 'asc' },
                include: {
                  comments: {
                    orderBy: { createdAt: 'asc' },
                  },
                  // Same shape as /api/projects: include the
                  // annotations (drawn marks) on each pin so
                  // <ProjectDetail>'s <ScreenshotView> renders
                  // them. The client's FeedbackAnnotation type
                  // declares `path` as a parsed number[][];
                  // we parse pathJson into that shape below
                  // (mirror of /api/projects route handler).
                  annotations: {
                    orderBy: { createdAt: 'asc' },
                  },
                },
              },
            },
          },
        },
      },
      subscribers: true,
    },
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
  const serializedProject: ProjectWithPages = {
    id: project.id,
    name: project.name,
    domain: project.domain,
    apiKey: project.apiKey,
    shareToken: project.shareToken,
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
        pins: screenshot.pins.map((pin) => ({
          id: pin.id,
          xPercent: pin.xPercent,
          yPercent: pin.yPercent,
          status: pin.status,
          elementXPath: pin.elementXPath,
          elementHTML: pin.elementHTML,
          createdAt: pin.createdAt.toISOString(),
          comments: pin.comments.map((comment) => ({
            id: comment.id,
            text: comment.text,
            author: comment.author,
            authorRole: comment.authorRole,
            createdAt: comment.createdAt.toISOString(),
            // Empty array — attachments aren't currently
            // included in the prisma findUnique include for
            // this page (the list route skips them too). The
            // PinThread tolerates `attachments: []` cleanly.
            attachments: [],
          })),
          annotations: (pin.annotations ?? []).map((annotation) => {
            let path: number[][] = [];
            try {
              const parsed = JSON.parse(annotation.pathJson);
              if (Array.isArray(parsed)) path = parsed as number[][];
            } catch {
              // Fall through with the empty path; the
              // ScreenshotView renders zero shapes for this pin
              // and the bad row is visible in the DB.
            }
            return {
              id: annotation.id,
              kind: annotation.kind as 'arrow' | 'box' | 'freehand',
              path,
              createdAt: annotation.createdAt.toISOString(),
            };
          }),
        })),
      })),
    })),
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <Link
              href="/"
              className="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1"
            >
              <span aria-hidden="true">←</span>
              <span>All projects</span>
            </Link>
            <h1 className="text-2xl font-semibold text-gray-900">{project.name}</h1>
            <div className="w-24" aria-hidden="true" />
          </div>
        </header>

        <ProjectDetail initialProject={serializedProject} />
      </div>
    </div>
  );
}
