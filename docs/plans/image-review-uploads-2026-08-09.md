# First-Class Image Review Uploads Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Let a project administrator upload a PNG, JPEG, GIF, or WebP image as a reviewable project page using the existing pins, annotations, threads, review links, roles, review rounds, notifications, and sign-off workflow.

**Architecture:** An uploaded image becomes a normal `Page` and `Screenshot` inside the project, rather than a parallel asset system. Add a screenshot MIME type with a safe PNG default for existing website captures, parse image dimensions before writing, and retain the uploaded file in `SCREENSHOTS_DIR`. The existing ScreenshotView can then place visual pins and SVG annotations on the image without special share-link or comment code.

**Tech Stack:** Next.js 16 Route Handlers, Prisma 6/PostgreSQL, local disk storage, Vitest, React, Tailwind 4, Playwright. No new image-processing dependency.

## Implementation status — 2026-08-10

All five tasks are complete. The migration, bounded header parser, scoped
administrator upload route, MIME-preserving media response, audit action, and
dashboard upload control are implemented. Focused tests, lint, TypeScript,
Prisma validation, and a production build pass. The runtime feature is deployed
and the public endpoint rejects an unauthenticated multipart upload. On
2026-08-13, the disposable fixture was corrected to use the production-format
43-character share token and current picker accessibility labels required by
the managed-share opener. Its browser replay now passes against the clean Linux
candidate at 1280px and 375px, including client sharing and cleanup.
Authenticated production browser QA remains blocked until the first production
operator account exists.

---

### Task 1: Specify upload and media contracts with failing tests

**Files:** Create `tests/unit/image-dimensions.test.ts` and `tests/integration/project-image-upload-route.test.ts`; modify `tests/integration/screenshot-image.test.ts`.

1. Test bounded PNG, JPEG, GIF, and WebP header parsing; reject truncated, impossible, or unsupported input.
2. Test project-admin multipart upload, MIME/size rejection, project-scoped Page/Screenshot creation, and audit evidence.
3. Test screenshot image GET returns the stored MIME type while retaining ETag, cache, and authorization behavior.
4. Run each focused test and confirm it fails before implementation.

### Task 2: Add MIME migration and pure parsers

**Files:** Modify `prisma/schema.prisma`; create a dated Prisma migration and `src/lib/image-dimensions.ts`; test `tests/unit/image-dimensions.test.ts`.

1. Add non-null `Screenshot.mimeType` with a database default of `image/png`.
2. Implement header-only parsers; never decode pixels or accept SVG.
3. Run unit, Prisma, clean, and upgrade migration gates.

### Task 3: Create scoped image upload

**Files:** Create `src/app/api/projects/[id]/images/route.ts`; modify `src/app/api/screenshots/[id]/image/route.ts` and `src/lib/audit.ts`; test the integration route.

1. Require dashboard auth, CSRF, project validation, and `assertProjectAdmin` before bytes are read or written.
2. Store an opaque UUID filename in `SCREENSHOTS_DIR`, then create a unique synthetic Page and Screenshot. Remove a newly written file if persistence fails.
3. Audit MIME, byte count, page id, and screenshot id only. Serve the stored screenshot with its MIME type, `nosniff`, and existing dashboard/share authorization.

### Task 4: Add the administrator upload surface

**Files:** Create `src/components/ImageReviewUpload.tsx`; modify `src/components/ProjectDetail.tsx`; create `tests/components/ImageReviewUpload.test.tsx`.

1. Test non-admin/read-only omission, multipart submission, inline errors, and refresh only after success.
2. Add a labelled picker, formats/size guidance, progress/error state, and 44px controls. Do not claim PDF support.
3. Run focused component and project-detail tests.

### Task 5: Validate the agency review journey

**Files:** Create `scripts/qa-image-review-upload.cjs`; update `TASK.md` and `docs/plans/README.md`.

1. Use disposable local data to upload an image, place a pin, and verify owner/client viewing at 1280px and 375px.
2. Assert no overflow, console/request errors, or fixture/file residue after cleanup.
3. Run focused tests, lint, TypeScript, Prisma, Docker, and the full suite. Record unrelated parked GitHub/AI failures separately.
