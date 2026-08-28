# First-Class PDF Review Implementation Plan

**Status:** active implementation; bounded upload and storage are next
**Parent:** `docs/plans/launch-and-saas-replacement-roadmap-2026-08-28.md` (L2)

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

## Renderer decision

The renderer is Poppler from Alpine's `poppler-utils`; no PDF npm package is
used. The runner-image build now contains a fail-closed verification step, but
the exact Linux image must build successfully before an upload endpoint is
allowed.

## Spike evidence — 2026-08-10

The isolated Alpine base accepted `poppler-utils` and exposed `pdfinfo` and
`pdftoppm` (Poppler 25.12.0). The local contract now rejects non-PDF headers,
bounds page count at 50, and produces an argument-only 144-DPI command capped
at 1920 pixels per axis. The full Next.js runner-image build remains a release
gate: local Docker build clients stalled without producing an image, so no PDF
upload endpoint exists and no PDF runtime change has been deployed.

## Renderer checkpoint — 2026-08-28

- Added a real single-page PDF runtime probe to the runner layer. BuildKit runs
  it with `--network=none`; it exercises `pdfinfo`, `pdftoppm`, a killed timeout,
  page count, PNG dimensions, and temporary-directory cleanup.
- The first runtime probe caught that separate `-scale-to-x 1920` and
  `-scale-to-y 1920` arguments distorted a portrait page into a square. The
  contract now uses aspect-preserving `-scale-to 1920` and asserts a non-square
  fixture remains non-square.
- Local Poppler produced one bounded 1484x1920 page and passed cleanup/timeout
  checks. The focused PDF/integration suites passed 50 tests; the full suite
  passed 927 tests; ESLint, TypeScript, and the Next production webpack build
  passed.
- A temporary isolated Colima profile built the exact Linux/arm64 runner image
  from commit `523df43`. BuildKit step `RUN --network=none` passed the verifier,
  and the loaded image repeated it in a `docker run --network none` container.
  The image was `sha256:99e1cd8322c7c55131d8a04a8d7948ea1795ab7508f51429624f12e2188c8d01`
  and reported Poppler 25.12.0. L2.1 is complete; the upload pipeline may begin.
