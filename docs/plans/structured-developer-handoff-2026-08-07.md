# Versioned developer handoff - 2026-08-07

**Status:** completed locally on 2026-08-07; external delivery and production remain approval-gated
**Parent:** `docs/plans/markup-parity-and-agency-advantage-2026-08-07.md`

## Outcome

Let an agency owner turn any feedback pin into a deterministic, copyable issue
without retyping client comments or exposing private project credentials. This
slice defines the contract and Markdown adapter before any external GitHub or
webhook delivery is authorized.

## Contract

The canonical payload identifier is `visual-feedback.issue.v1`. It contains:

- bounded issue title, pin id, state, coordinates, and creation timestamp;
- project id/name/domain plus page path and an authorized dashboard deep link;
- screenshot id, dimensions, and capture timestamp;
- review-round identity when present;
- privacy-bounded viewport, normalized browser/platform, selectors, and scrubbed
  element snippet when captured;
- the bounded existing comment conversation with attachment metadata only.

The contract must not contain project API keys, public-share tokens, session or
CSRF values, attachment bytes, authorization headers, URL queries/fragments,
console output, network traffic, or the raw user-agent string.

## Markdown adapter

- Render the canonical payload through one pure deterministic formatter.
- Escape untrusted prose so a comment cannot inject headings, links, or HTML into
  the generated issue structure.
- Put selector and element content in code blocks that remain valid even when the
  captured value contains Markdown fence characters.
- Omit absent optional sections instead of inventing values.
- Include the schema identifier in the output so copied issues remain traceable.

## Dashboard behavior

- Only project owners/operators receive the fields and mount the copy control.
- Copying reports `Copied` or an actionable failure without changing the pin.
- The dashboard URL uses `?pin=<uuid>` and opening that URL selects the matching
  pin; invalid or unrelated ids are ignored and closing the thread removes only
  the pin parameter.
- Reviewer and public-share surfaces do not mount the handoff control or receive
  the technical packet.

## Delivery order and proof

1. Add failing pure-contract and Markdown tests, including malicious Markdown,
   missing legacy context, fence characters, and deterministic output.
2. Implement the versioned payload builder and Markdown adapter.
3. Add failing component tests for admin copy success/failure and role redaction.
4. Add the admin-only copy action and exact-pin deep-link behavior.
5. Run the full automated gates, production/Docker build, and authenticated
   owner/reviewer desktop/mobile/keyboard browser QA.

## Non-goals

- creating or updating an external GitHub issue;
- signed webhooks, retries, or delivery logs;
- priority, assignee, or tags before their domain fields exist;
- exposing the handoff through public share links;
- claiming the copied Markdown was delivered anywhere.

## Completion evidence

- Added the deterministic `visual-feedback.issue.v1` payload and one pure
  Markdown adapter for project/page/pin identity, conversation, screenshot,
  review round, and privacy-bounded technical context.
- Added boundary recanonicalization and limits so hand-constructed input cannot
  reintroduce credentials, query tokens, cross-project URLs, raw attachment
  URLs, oversized selectors/snippets, or raw user-agent data.
- Escaped untrusted prose and selected dynamic code fences so comments cannot
  restructure the issue and captured elements containing backticks remain valid.
- Added an administrator-only copy action with explicit success/failure feedback
  and a short explanation of the copied format. Reviewer/public surfaces do not
  mount the action.
- Added exact-pin `?pin=` URLs with keyboard selection, reload restoration,
  invalid-id rejection, unrelated query/hash preservation, and clean close.
- Final gates: 565 tests passed, 3 skipped; ESLint, TypeScript, Prisma validation,
  production Next.js build, Docker build/migrations/health, and authenticated
  owner/reviewer browser QA at 1280px and 375px passed. Clipboard contents and
  reviewer DOM redaction were checked directly. Existing widget output-directory
  and disk-media tracing warnings remain unchanged and tracked.
