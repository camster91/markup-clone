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

import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/audit';
import { getClientIp } from '@/lib/request-ip';
import ScreenshotView from '@/components/ScreenshotView';
import type { ScreenshotWithPins } from '@/lib/types';
import {
  isShareAccessCookieValid,
  isShareExpired,
  shareAccessCookieName,
} from '@/lib/share-access';
import { resolveWorkspaceBranding } from '@/lib/branding';

// Read-only share view must always reflect the latest pins/comments
// from the DB. The dashboard re-polls every 5s, but a public viewer
// loading a stale cached page is a much worse experience — the
// whole point of the share link is "client is looking at this right
// now". force-dynamic disables the page-level cache and ISR.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

type PageProps = {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ error?: string | string[] }>;
};

export default async function PublicSharePage({ params, searchParams }: PageProps) {
  const { token } = await params;

  // Lookup by shareToken. We do the audit-log write BEFORE the
  // notFound() so even a "bad token" probe is recorded — operators
  // want to know who's scanning their share URLs. The actor is
  // 'anonymous' (we don't have a user identity in the public view)
  // and the metadata carries the token prefix and request IP/UA so
  // the audit UI can render it usefully.
  // Explicit select that EXCLUDES apiKey. The share page is
  // public — embedding the widget key in the RSC payload (or
  // accidentally spreading the full prisma row into client
  // props) would leak a write credential to every share viewer.
  const project = await prisma.project.findUnique({
    where: { shareToken: token },
    select: {
      id: true,
      name: true,
      domain: true,
      shareToken: true,
      shareExpiresAt: true,
      sharePasswordHash: true,
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
        },
      },
      createdAt: true,
      updatedAt: true,
      pages: {
        orderBy: [{ createdAt: 'asc' }, { assetPageNumber: 'asc' }],
        select: {
          id: true,
          path: true,
          assetPageNumber: true,
          reviewAsset: { select: { id: true, pageCount: true } },
          createdAt: true,
          updatedAt: true,
          screenshots: {
            orderBy: { capturedAt: 'desc' },
            select: {
              id: true,
              storageKey: true,
              pageId: true,
              width: true,
              height: true,
              capturedAt: true,
              pins: {
                orderBy: { createdAt: 'asc' },
                select: {
                  id: true,
                  xPercent: true,
                  yPercent: true,
                  status: true,
                  createdAt: true,
                  updatedAt: true,
                  comments: {
                    orderBy: { createdAt: 'asc' },
                    select: {
                      id: true,
                      text: true,
                      author: true,
                      authorRole: true,
                      createdAt: true,
                      updatedAt: true,
                      attachments: {
                        orderBy: { createdAt: 'asc' },
                        select: {
                          id: true,
                          kind: true,
                          mimeType: true,
                          size: true,
                        },
                      },
                    },
                  },
                  // Same shape as /api/projects: include the
                  // annotations (drawn marks) on each pin so the
                  // shared ScreenshotView renders them too. The
                  // public view is read-only — clients can't add
                  // annotations from this page, only view them.
                  annotations: {
                    orderBy: { createdAt: 'asc' },
                    select: {
                      id: true,
                      kind: true,
                      pathJson: true,
                      createdAt: true,
                    },
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
    const ip = getClientIp({ headers: headerStore });
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

  const expiresAt = project.shareExpiresAt ?? null;
  const passwordHash = project.sharePasswordHash ?? null;
  const branding = resolveWorkspaceBranding(
    project.team?.workspace ?? { name: 'Visual Feedback' }
  );
  if (isShareExpired(expiresAt)) {
    notFound();
  }

  const cookieStore = await cookies();
  const accessCookie = cookieStore.get(shareAccessCookieName(token))?.value;
  const hasAccess = isShareAccessCookieValid(token, passwordHash, accessCookie);
  if (!hasAccess) {
    if (!passwordHash) {
      redirect(`/share/${token}/open`);
    }
    const query = searchParams ? await searchParams : undefined;
    const invalidPassword = query?.error === 'invalid';
    return (
      <main className="min-h-screen bg-gray-50 p-4 sm:p-8 flex items-center justify-center">
        <section className="w-full max-w-md overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="h-2" style={{ backgroundColor: branding.accentColor }} />
          <div className="p-6 sm:p-8">
            <div className="mb-5 flex min-w-0 items-center gap-3">
              {branding.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- operator-validated external agency logo.
                <img src={branding.logoUrl} alt="" className="h-10 max-w-36 object-contain object-left" />
              ) : (
                <div
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-bold"
                  style={{ backgroundColor: branding.accentColor, color: branding.accentText }}
                >
                  {branding.displayName.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-gray-950">{branding.displayName}</p>
                <p className="text-xs text-gray-600">{branding.welcome}</p>
              </div>
            </div>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: branding.accentColor }}>
              Protected review
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-gray-900">{project.name}</h1>
            <p className="mt-2 text-sm text-gray-600">
              Enter the password supplied by the agency to open this read-only review.
            </p>
            <form className="mt-6 space-y-4" method="post" action={`/share/${token}/open`}>
            <div>
              <label htmlFor="share-password" className="block text-sm font-medium text-gray-800">
                Review password
              </label>
              <input
                id="share-password"
                name="password"
                type="password"
                autoComplete="current-password"
                minLength={8}
                maxLength={128}
                required
                autoFocus
                aria-describedby={invalidPassword ? 'share-password-error' : undefined}
                className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
              />
            </div>
            {invalidPassword && (
              <p id="share-password-error" role="alert" className="text-sm text-red-700">
                Incorrect password. Check the password and try again.
              </p>
            )}
              <button
                type="submit"
                className="min-h-11 w-full rounded-lg px-4 py-2.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
                style={{ backgroundColor: branding.accentColor, color: branding.accentText }}
              >
                Open review
              </button>
            </form>
          </div>
        </section>
      </main>
    );
  }

  // Serialize Date fields to ISO strings before handing the tree to
  // the client ScreenshotView. The component's TypeScript types
  // declare capturedAt / createdAt as strings (because in the
  // browser pipeline, /api/projects returns JSON which stringifies
  // dates), and the dashboard's existing components assume the
  // string form. Forcing the conversion here keeps the type contract
  // the same — the share page is a server component, so the client
  // components downstream never see the raw Date objects.
  //
  // Annotations: parse pathJson into a `number[][]` `path` field
  // (matching the FeedbackAnnotation type and the
  // /api/projects/route.ts shape). A malformed pathJson would have
  // been rejected at write time by the POST /api/annotations
  // validator, so the JSON.parse here only fails on a hand-crafted
  // DB row; we fall back to an empty array so the share view's
  // ScreenshotView doesn't throw on the bad row.
  // Build a deliberate client payload — never spread the prisma
  // row (that would risk re-introducing apiKey if the select
  // above is widened later).
  const serializedProject = {
    id: project.id,
    name: project.name,
    domain: project.domain,
    shareToken: null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    pages: project.pages.map((page) => ({
      id: page.id,
      path: page.path,
      reviewAsset: page.reviewAsset && page.assetPageNumber ? {
        id: page.reviewAsset.id,
        pageNumber: page.assetPageNumber,
        pageCount: page.reviewAsset.pageCount,
      } : null,
      createdAt: page.createdAt.toISOString(),
      updatedAt: page.updatedAt.toISOString(),
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
          developerContext: null,
          createdAt: pin.createdAt.toISOString(),
          updatedAt: pin.updatedAt.toISOString(),
          comments: pin.comments.map((comment) => ({
            id: comment.id,
            text: comment.text,
            author: comment.author,
            authorRole: comment.authorRole,
            createdAt: comment.createdAt.toISOString(),
            updatedAt: comment.updatedAt.toISOString(),
            attachments: comment.attachments.map((attachment) => ({
              id: attachment.id,
              kind: attachment.kind as 'image' | 'voice' | 'video',
              mimeType: attachment.mimeType,
              size: attachment.size,
              url: `/api/attachments/${attachment.id}`,
            })),
          })),
          annotations: (pin.annotations ?? []).map((annotation) => {
            let path: number[][] = [];
            try {
              const parsed = JSON.parse(annotation.pathJson);
              if (Array.isArray(parsed)) path = parsed as number[][];
            } catch {
              // Fall through with the empty path; the ScreenshotView
              // renders zero shapes for this pin and the bad row is
              // visible in the DB.
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
    <main className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-5xl mx-auto">
        <header className="mb-6">
          <div className="overflow-hidden bg-white rounded-xl shadow-sm border border-gray-200">
            <div className="h-2" style={{ backgroundColor: branding.accentColor }} />
            <div className="px-6 py-4">
              <div className="mb-3 flex min-w-0 items-center gap-3">
                {branding.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- operator-validated external agency logo.
                  <img src={branding.logoUrl} alt="" className="h-9 max-w-40 object-contain object-left" />
                ) : (
                  <div aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-bold" style={{ backgroundColor: branding.accentColor, color: branding.accentText }}>
                    {branding.displayName.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-950">{branding.displayName}</p>
                  <p className="text-xs text-gray-600">{branding.welcome}</p>
                </div>
              </div>
            <div className="flex items-center gap-2 text-xs text-gray-500 uppercase tracking-wider mb-1">
              <span aria-hidden="true">🔗</span>
              <span>Shared visual feedback</span>
            </div>
            <h1 className="text-2xl font-semibold text-gray-900">{serializedProject.name}</h1>
            <p className="text-gray-500 text-sm mt-1">{serializedProject.domain}</p>
            </div>
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
                  <h2 className={`text-base font-semibold text-white break-all ${page.reviewAsset ? '' : 'font-mono'}`}>
                    {page.reviewAsset
                      ? `PDF page ${page.reviewAsset.pageNumber} of ${page.reviewAsset.pageCount}`
                      : page.path}
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
                      screenshot={screenshot as unknown as ScreenshotWithPins}
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
    </main>
  );
}
