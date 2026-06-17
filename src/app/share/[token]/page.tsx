// /share/[token]
//
// Public read-only view of a project. The token is the shareToken field
// on Project — opaque to the client, looked up by the page's server
// component on every request.
//
// Security model:
//   - No auth, no requireDashboardOrigin gate. The token IS the auth.
//   - 32-byte base64url token = 256 bits of entropy. The unique
//     constraint on Project.shareToken backs a uniqueness assumption
//     that holds with 1 - 2^-256 collision probability.
//   - The render tree is the same as the dashboard's, with the
//     ScreenshotView and PinThread `readOnly` props flipped on:
//     recapture button hidden, comment form hidden, pin status
//     toggle disabled. The widget pin-creation flow is also not
//     reachable from this page (the widget snippet is rendered
//     against an apiKey the page does not display).
//   - Every load is logged to the audit log with action='share.view'.
//     The audit row records the projectId, the token's prefix
//     (not the full token — same pattern as project.share.create),
//     and the request's IP/user-agent so the dashboard's audit UI
//     can show "this share link was viewed N times" without
//     exposing the full token to log-search users.
//
// If the token doesn't match an active shareToken, the page renders
// the not-found UI (a real 404 from Next.js — see
// node_modules/next/dist/docs/01-app/03-api-reference/04-functions/not-found.md).
// We deliberately do NOT distinguish "bad token" from "no project" —
// both should look like 404 to a share-link spammer probing for
// live URLs.

import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/audit';
import ScreenshotView from '@/components/ScreenshotView';

// Read-only share view must always reflect the latest pins/comments
// from the DB. The dashboard re-polls every 5s, but a public viewer
// loading a stale cached page is a much worse experience — the
// whole point of the share link is "client is looking at this right
// now". force-dynamic disables the page-level cache and ISR.
export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ token: string }>;
};

export default async function PublicSharePage({ params }: PageProps) {
  const { token } = await params;

  // Lookup by shareToken. We do the audit-log write BEFORE the
  // notFound() so even a "bad token" probe is recorded — operators
  // want to know who's scanning their share URLs. The actor is
  // 'anonymous' (we don't have a user identity in the public view)
  // and the metadata carries the token prefix and request IP/UA so
  // the audit UI can render it usefully.
  const project = await prisma.project.findUnique({
    where: { shareToken: token },
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
                },
              },
            },
          },
        },
      },
    },
  });

  // Log the load before the notFound() — a probing 404 should still
  // be auditable. We use a try/catch (NOT the fire-and-forget
  // audit() helper) so a slow audit write doesn't block the
  // notFound() return. audit() is fire-and-forget in spirit but
  // the helper doesn't actually return the promise; the docs
  // explicitly say ordering is best-effort, and the row is
  // recorded for forensics not for serialization.
  try {
    const headerStore = await headers();
    const ip =
      headerStore.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      headerStore.get('x-real-ip') ||
      'unknown';
    const userAgent = headerStore.get('user-agent') || 'unknown';
    // We log even on a "bad token" so the audit row exists for
    // security review. The target is either the project's real id
    // (good token) or the literal token string (bad token —
    // operators can search for it).
    audit({
      actor: 'anonymous',
      action: 'share.view',
      target: project?.id ?? `token:${token.slice(0, 8)}…`,
      metadata: {
        tokenPrefix: token.slice(0, 8),
        ip,
        userAgent,
        found: !!project,
      },
    });
  } catch {
    // headers() can throw during build, but force-dynamic makes
    // that impossible at runtime. Swallow anything else so a
    // header-read failure doesn't 500 a 404 page.
  }

  if (!project) {
    notFound();
  }

  // Serialize Date fields to ISO strings before handing the tree to
  // the client ScreenshotView. The component's TypeScript types
  // declare capturedAt / createdAt as strings (because in the
  // browser pipeline, /api/projects returns JSON which stringifies
  // dates), and the dashboard's existing components assume the
  // string form. Forcing the conversion here keeps the type contract
  // the same — the share page is a server component, so the client
  // components downstream never see the raw Date objects.
  const serializedProject = {
    ...project,
    pages: project.pages.map((page) => ({
      ...page,
      createdAt: page.createdAt.toISOString(),
      updatedAt: page.updatedAt.toISOString(),
      screenshots: page.screenshots.map((screenshot) => ({
        ...screenshot,
        capturedAt: screenshot.capturedAt.toISOString(),
        pins: screenshot.pins.map((pin) => ({
          ...pin,
          createdAt: pin.createdAt.toISOString(),
          updatedAt: pin.updatedAt.toISOString(),
          comments: pin.comments.map((comment) => ({
            ...comment,
            createdAt: comment.createdAt.toISOString(),
            updatedAt: comment.updatedAt.toISOString(),
          })),
        })),
      })),
    })),
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-5xl mx-auto">
        <header className="mb-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 px-6 py-4">
            <div className="flex items-center gap-2 text-xs text-gray-500 uppercase tracking-wider mb-1">
              <span aria-hidden="true">🔗</span>
              <span>Shared visual feedback</span>
            </div>
            <h1 className="text-2xl font-semibold text-gray-900">{serializedProject.name}</h1>
            <p className="text-gray-500 text-sm mt-1">{serializedProject.domain}</p>
          </div>
        </header>

        {serializedProject.pages.length === 0 ? (
          <div className="bg-white p-12 text-center rounded-xl shadow-sm border border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">No pages captured yet</h3>
            <p className="text-gray-500 mt-2">
              Once the team has reviewed this project, the screenshots will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {serializedProject.pages.map((page) => (
              <section
                key={page.id}
                className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
              >
                <div className="bg-gray-900 px-6 py-3">
                  <h2 className="text-base font-semibold text-white font-mono break-all">
                    {page.path}
                  </h2>
                  <p className="text-gray-400 text-xs mt-1">
                    {page.screenshots.length} capture{page.screenshots.length === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="p-6 space-y-6">
                  {page.screenshots.map((screenshot) => (
                    // `readOnly` flips the widget pin-creation and
                    // recapture flow off in the shared components —
                    // see ScreenshotView/PinThread. `projectId` is
                    // threaded through so the ScreenshotView's
                    // presence hook short-circuits cleanly (the
                    // share viewer has no userId, so the
                    // heartbeat is a no-op anyway).
                    <ScreenshotView
                      key={screenshot.id}
                      screenshot={screenshot}
                      pagePath={page.path}
                      projectId={serializedProject.id}
                      readOnly
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        <footer className="mt-8 text-center text-xs text-gray-400">
          Read-only view — no comments can be added from this link.
        </footer>
      </div>
    </div>
  );
}
