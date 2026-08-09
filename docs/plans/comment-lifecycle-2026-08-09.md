# Administrator Comment Lifecycle Implementation Plan

**Status:** Complete locally; production untouched.

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Let project administrators edit or permanently delete comments in a
dashboard review thread, with scoped authorization, CSRF protection, rate
limiting, and audit evidence.

**Architecture:** Add a nested comment resource at
`/api/pins/[id]/comments/[commentId]`. The route resolves the pin's project,
requires project-administrator access, and verifies the comment belongs to the
pin before mutating it. The dashboard owns the updated thread state through new
optional callbacks on `PinThread`; public share links remain read-only.

**Tech Stack:** Next.js 16 Route Handlers, Prisma 6, Vitest, React, Tailwind 4.

**Completion evidence:** New route and component contracts pass (18 tests), the
affected regression suite passes (34 tests), TypeScript, ESLint, Prisma
validation, diff checks, and the optimized local Docker build pass. Intercepted
owner/reviewer browser QA at 1280px and 375px proved exactly one local `PATCH`
followed by one local `DELETE`, owner-only controls, zero overflow, and zero
console or failed-request errors. The disposable local fixture was removed and
independently rechecked at zero matching project, pin, and comment rows.

---

### Task 1: Define the route contract with failing tests

**Objective:** Prove valid administrator edit/delete behavior and all
authorization, ownership, validation, and audit boundaries before route code
exists.

**Files:**
- Create: `tests/integration/comment-lifecycle-route.test.ts`
- Test: `src/app/api/pins/[id]/comments/[commentId]/route.ts`

**Step 1:** Test `PATCH` returns the sanitized comment after an administrator
changes text, rejects empty text, rejects a comment from another pin, and never
updates on failed validation.

**Step 2:** Test `DELETE` removes only the exact comment, requires project-admin
access, and records `comment.update` or `comment.delete` only after a successful
write.

**Step 3:** Run
`npx vitest run tests/integration/comment-lifecycle-route.test.ts` and confirm
the test fails because the route does not exist.

### Task 2: Implement the minimal protected route

**Objective:** Make the failing route tests pass without changing public share
behavior or adding author-identity storage.

**Files:**
- Create: `src/app/api/pins/[id]/comments/[commentId]/route.ts`
- Modify: `src/lib/audit.ts`
- Test: `tests/integration/comment-lifecycle-route.test.ts`

**Step 1:** Validate both UUID path parameters before database access; apply
dashboard auth and CSRF checks first, then rate-limit mutation attempts.

**Step 2:** Resolve the pin project and require `assertProjectAdmin(projectId)`.
Query the comment by its id and pin id together so a cross-pin identifier does
not reveal or mutate another thread.

**Step 3:** For `PATCH`, accept exactly `{ text: string }`, use
`validatePinText`, update only text, return a safe comment DTO, and audit
`comment.update` with the caller email.

**Step 4:** For `DELETE`, delete only the scoped comment, return `{ deleted:
true }`, and audit `comment.delete` with the caller email. Attachments remain
retained because attachment/file cleanup needs its own recovery-safe policy.

**Step 5:** Re-run the focused test and confirm it passes.

### Task 3: Add dashboard controls with failing component tests

**Objective:** Expose edit/delete only in administrator dashboard threads while
preserving read-only share links.

**Files:**
- Modify: `src/components/PinThread.tsx`
- Modify: `src/components/ScreenshotView.tsx`
- Create: `tests/components/PinThread-comment-lifecycle.test.tsx`

**Step 1:** Test that an administrator sees labelled Edit and Delete controls,
can save an edited comment, and receives optimistic thread updates after a
successful request.

**Step 2:** Test a read-only thread and a non-administrator see neither control.

**Step 3:** Test delete requires an explicit in-dialog confirmation and leaves
the comment visible if the request fails.

**Step 4:** Run the focused component test and confirm it fails before UI code.

### Task 4: Implement and verify the dashboard controls

**Objective:** Pass the component tests with accessible, mobile-safe edit/delete
controls and no unrelated UI changes.

**Files:**
- Modify: `src/components/PinThread.tsx`
- Modify: `src/components/ScreenshotView.tsx`
- Test: `tests/components/PinThread-comment-lifecycle.test.tsx`

**Step 1:** Add an explicit `canManageComments` capability from the project DTO
to `PinThread`; never infer it from a display-only role string.

**Step 2:** Use semantic buttons and an inline edit form. Ensure the delete
confirmation is keyboard accessible, has an unambiguous destructive label, and
has at least 44px targets on mobile.

**Step 3:** Re-run the focused component test and then the affected PinThread
and ScreenshotView suites.

### Task 5: Regression, browser, and documentation verification

**Objective:** Prove the review flow works at desktop and mobile widths without
breaking the established dashboard or share-link boundaries.

**Files:**
- Modify: `TASK.md`
- Modify: `docs/plans/README.md`
- Create or modify: `scripts/qa-comment-lifecycle.cjs`

**Step 1:** Run focused integration and component tests, lint, TypeScript, and
Prisma validation.

**Step 2:** Build/recreate the local Compose app and use Playwright to verify an
administrator can edit and delete at 1280px and 375px; record screenshots and
assert no overflow, console errors, or failed requests.

**Step 3:** Update `TASK.md` with the completed slice and test evidence. Do not
deploy, create accounts, or alter the live service without separate approval.
