# First-Class PDF Review Implementation Plan

**Goal:** Let project administrators upload a PDF and let owners, invited
reviewers, and managed-share viewers review each rendered page with the same
pins, annotations, threads, review rounds, notifications, and sign-off model
as website and image reviews.

## Boundaries

- This is a core MarkUp-style review feature, not an AI, repository, or GitHub
  delivery feature.
- PDF source files are accepted only from authenticated project administrators.
- SVG, HTML, and arbitrary document formats remain unsupported.
- The original PDF and every rendered page use opaque UUID storage keys. No
  filename, filesystem path, or PDF text is exposed in a public DTO or audit
  entry.
- PDF rendering must run in a bounded, non-networked subprocess/container with
  page-count, pixel, and byte limits. Do not render arbitrary PDFs in a request
  handler without those bounds.

## Delivery sequence

1. **Renderer spike and contract.** Add a small isolated renderer adapter and
   test its command contract against the production Linux image. Select a
   maintained renderer available in the Docker build (for example Poppler),
   pin its OS package, and prove timeout, page-count, dimensions, and cleanup
   behavior before accepting PDFs.
2. **Schema and storage.** Add a minimal `ReviewAsset`/source relation only if
   the existing Page/Screenshot model cannot retain the original PDF and its
   rendered page screenshots safely. Existing rendered pages must remain normal
   Pages and Screenshots so all feedback surfaces are reused.
3. **Scoped upload pipeline.** Add a project-admin multipart endpoint with
   dashboard auth, CSRF, per-project/origin rate limit, PDF magic-byte and
   MIME checks, maximum source size, renderer timeout, and transaction/file
   cleanup. Audit only safe metadata (project id, generated asset/page ids,
   MIME, byte count, page count).
4. **Reviewer UI.** Extend the existing upload control with explicit PDF
   guidance and a queued/rendering state. A single PDF upload should show its
   generated pages in natural order, never pretend that a PDF is a single
   raster image, and preserve the existing 44px and mobile constraints.
5. **Journey verification.** Use a disposable Compose fixture to upload a
   small test PDF, add a pin on a rendered page, verify owner and managed-share
   rendering at 1280px/375px, assert no console/request errors or horizontal
   overflow, and prove database/source/page-file cleanup.

## Likely files

- `Dockerfile`
- `prisma/schema.prisma` and a dated migration
- `src/lib/pdf-*`
- `src/app/api/projects/[id]/documents/route.ts` or the existing image route
  after a deliberately named shared upload abstraction is extracted
- `src/components/ImageReviewUpload.tsx` (renamed only if its interface grows
  beyond images)
- `tests/unit/pdf-*.test.ts`, `tests/integration/project-pdf-upload-route.test.ts`,
  `tests/components/*Upload*.test.tsx`, and `scripts/qa-pdf-review-upload.cjs`

## Required validation

- Strict red-to-green tests for rejected SVG/non-PDF bytes, oversize inputs,
  bad page counts, renderer timeout, authorization, CSRF, and rate limiting.
- Focused tests, full Vitest, lint, TypeScript, Prisma validation, production
  build, Linux Docker build, and local Compose migration.
- Browser evidence for the owner and client journeys plus cleanup.

## Open implementation decision

The rendering runtime is not currently in the dependency graph. The first
implementation task is intentionally a renderer spike; do not add a PDF npm
package or an OS renderer until its security/size/timeout behavior is verified
in the production image.

## Spike evidence — 2026-08-10

The isolated Alpine base accepted `poppler-utils` and exposed `pdfinfo` and
`pdftoppm` (Poppler 25.12.0). The local contract now rejects non-PDF headers,
bounds page count at 50, and produces an argument-only 144-DPI command capped
at 1920 pixels per axis. The full Next.js runner-image build remains a release
gate: local Docker build clients stalled without producing an image, so no PDF
upload endpoint exists and no PDF runtime change has been deployed.

## Implementation progress — 2026-08-11

The runner-image gate subsequently passed on the guarded VPS release: the live
`dad28a5` container exposes Poppler 25.12.0. The next local slice adds a scoped
PDF endpoint and extends the review upload picker: PDFs are bounded to 16 MB
and 50 rendered pages, render to capped PNG pages, and become ordinary
Page/Screenshot records. Focused tests, production compilation, and the full
suite are green locally. It is not yet deployed: the remaining gates are an
actual renderer journey with a disposable PDF fixture and owner/share browser
QA.
