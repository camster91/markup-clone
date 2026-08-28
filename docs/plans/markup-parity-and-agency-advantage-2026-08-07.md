# MarkUp.io parity and agency advantage — 2026-08-07

**Status:** product reference; execution priority is governed by
`docs/plans/launch-and-saas-replacement-roadmap-2026-08-28.md`
**Parent plan:** `docs/plans/agency-product-release-2026-08-07.md`
**Evidence date:** 2026-08-07

This checklist turns “as close as possible to MarkUp.io, but better for web
developers and agencies” into a testable product direction. Competitor claims
come from current first-party MarkUp.io pages. Repository status comes from the
current schema, routes, components, and tests; it is not a claim about the live
deployment.

## Core product goal - MarkUp-style SaaS parity

The release goal is a focused visual-review SaaS for websites and common design
files. A client should be able to open a managed review link, point at the work,
leave visual feedback, discuss it in context, and approve a review round. An
agency should be able to organize clients and projects, manage access, monitor
progress, notify participants, archive completed work, and control its branding
from one workspace.

The core journey is:

`workspace -> client -> project -> review round -> page or file -> annotation -> discussion -> resolution -> sign-off`

AI-generated fixes, repository source access, GitHub branches, commits, and pull
requests are not required for this goal. Existing local experiments in those
areas are parked and must not displace core review, sharing, organization,
notification, account, or billing work.

## Current first-party benchmark

MarkUp.io currently advertises unlimited comments and MarkUps, website and file
review, folders, managed share links, integrations, comment pausing, native PDF
review, archiving, custom invites, notifications, and unlimited users on its
paid plans. Enterprise adds unlimited workspaces and storage, SAML SSO, and SOC
2 documentation. Its FAQs describe nested folders up to five levels, restricted
folder/MarkUp sharing, Owner/Admin/Member/Guest roles, and moving projects
between workspaces.

Its developer offering now includes a public API and browser SDK. The SDK
exposes projects, threads, comments, uploads, typed events, UI and headless
entry points, but the official documentation currently labels it an internal
`1.0.0-beta.x` with an unstable public API. The public API includes workspace
API keys and signed webhook registrations. MarkUp.io also documents project
status, reviewer sign-off, and pausing new comments while retaining replies to
existing threads.

First-party sources:

- [Pricing and feature allowances](https://www.markup.io/pricing/)
- [Pricing FAQs: folders, sharing, roles, and workspaces](https://www.markup.io/pricing-page-faqs/)
- [Developer Hub](https://developer.markup.io/)
- [SDK overview and current beta availability](https://developer.markup.io/sdk/)
- [SDK API and event reference](https://developer.markup.io/sdk/api-reference/)
- [Public API authentication](https://developer.markup.io/api-specs/authentication/)
- [Webhook registration API](https://developer.markup.io/api-specs/resources/webhook_registrations/)
- [Status, sign-off, and comment pausing](https://www.markup.io/blog/status-sign-off-pause-comments/)

## Parity matrix

| Capability | Current repository evidence | Status | Release decision |
|---|---|---:|---|
| Drop-in website commenting | Script-tag widget, project key, click-to-pin, page path, viewport screenshot | Strong | Preserve and polish |
| Contextual threads | Pins, comments, authors, open/resolved status | Strong | Add editing/deletion and richer workflow states only after core QA |
| Visual annotation | Arrow, box, and freehand annotations plus origin-clean viewport PNG capture verified in Chromium, Firefox, and WebKit | Strong locally | Production remains approval-gated; retain real-device Safari verification |
| DOM targeting | CSS-style path stored as `elementXPath` plus bounded element HTML | Differentiator seed | Normalize naming and expose useful handoff context |
| Recapture and versions | Headless recapture, immutable screenshot versions, history UI/API | Strong | Make review rounds explicit |
| Sharing | Revocable, rotating, expiring, optional-password review links with token-bound HttpOnly media access | Strong locally | Production remains approval-gated; retain private/no-store shared-media caching |
| People and roles | Operator, team owner, contributor, client reviewer, and project guest permissions plus expiring/revocable invitation claiming | Strong locally | Production remains approval-gated; preserve role-redacted reviewer DTOs |
| Workspaces and teams | Workspace → team/client → project/site → review-round hierarchy with scoped navigation | Strong locally | Production remains approval-gated; validate migrated live data before release |
| Notifications | Self-service role-aware member preferences for new feedback, replies, status, assignment, and mentions; branded email plus external alerts and durable integrations | Strong locally | Production remains approval-gated; add digest scheduling only with a durable job runner |
| Integration reliability | Versioned signed events, encrypted credentials, retry queue, delivery log, manual retry, and stable event schema | Strong locally | Production remains approval-gated; operate the worker and retention policy explicitly |
| Presence/live changes | One session-bound heartbeat/list poll and one SSE stream per focused project, with screenshot cursor routing | Strong locally | Production remains approval-gated; horizontally scaled fan-out still requires shared pub-sub |
| Attachments | Image attachments on comments | Partial | Add safe video/voice and broader review assets only with storage controls |
| Project status and approval | Review-round status, explicit sign-off, reopen behavior, and audit-backed issue workflow | Strong locally | Production remains approval-gated; validate the client journey with real project data |
| Pause feedback | Owners can pause new feedback while existing-thread replies remain available | Strong locally | Production remains approval-gated |
| Client/site organization | Client/team → site/project → review-round organization, scoped navigation, and archive view | Strong locally | Production remains approval-gated; add generic folders only if real agency use requires them |
| File/PDF/video review | Website screenshots and image comment attachments only | Missing | Defer until the website workflow is excellent; then add PDF/image/video |
| Archiving | Reversible project archive state, archived-sites view, and role-aware controls | Strong locally | Production remains approval-gated; keep destructive deletion separate |
| Managed invitations | Expiring, revocable invitation inspection/acceptance with role-aware agency and guest access | Strong locally | Production remains approval-gated; validate delivery configuration before inviting clients |
| Public developer API | Versioned scoped project tokens, issue endpoint, OpenAPI document, and redacted contract | Strong locally | Production remains approval-gated; do not call the contract public until release |
| Embeddable SDK | Typed loader package with lifecycle/events and CSP guidance | Strong locally | npm publication remains separately approval-gated |
| Enterprise controls | No SAML/SCIM/SOC 2 program | Out of initial scope | Document honestly; do not imply compliance |
| Agency branding | Workspace reviewer name, logo, accent, client review mode, and branded member email | Strong locally | Production remains approval-gated; validate each live workspace identity before release |

“Strong locally” means the repository contains the working shape and meaningful test
coverage; it does not mean feature-for-feature equivalence or production proof.

## Better-for-agencies product wedge

The first differentiated release should make visual review calmer and easier to
operate across many client sites without making clients learn development tools.

### 1. Developer context packet

Each pin should expose a bounded, privacy-conscious packet containing:

- canonical page URL and route;
- viewport width/height and device pixel ratio;
- browser family/version and platform;
- robust selector candidates plus the captured element snippet;
- screenshot version and capture timestamp;
- console/network context only when explicitly enabled and scrubbed;
- priority, workflow status, assignee, tags, and review round;
- stable links for the dashboard and authorized client review.

The local implementation now captures and displays the bounded browser/viewport
context and connects it to priority, assignee, tags, review round, exact-pin links,
and copyable developer handoff. Production remains unverified and approval-gated.

### 2. Structured handoff

Define one versioned issue payload and render it consistently as:

- copyable Markdown for a developer;
- a signed generic webhook event;
- a GitHub issue payload;
- later adapters for common agency project-management systems.

The local delivery pipeline now uses a versioned event envelope, signing,
encrypted credentials, retries, delivery history, manual retry, copyable Markdown,
and native GitHub issue delivery. Production worker operation remains unverified.

### 3. Agency client experience

The reviewer surface should be project-first and deliberately simple: agency
identity, what is under review, progress, unresolved decisions, and a clear
sign-off action. API keys, integration configuration, internal team structure,
and implementation-only metadata remain hidden from client reviewers.

### 4. Review rounds, not generic folders

Use the hierarchy agencies naturally discuss:

`workspace/agency → client → site/project → review round → page → issue`

Folders can be added as a view later. The durable domain model should first
support review-round status, baselines, approvals, reopened feedback, and an
audit trail.

## Ordered delivery slices

1. ~~Finish Gate 1 offline/loading states and keyboard browser QA.~~ Completed
   locally on 2026-08-07; production remains separately approval-gated.
2. ~~Add review-round status, sign-off, and pause-new-feedback controls.~~
   Completed and browser-verified locally on 2026-08-07; production remains
   separately approval-gated.
3. ~~Capture and display the privacy-bounded developer context packet.~~
   Completed and browser-verified locally on 2026-08-07; production remains
   separately approval-gated.
4. ~~Add priority, assignee, tags, and issue filters.~~ Completed and
   browser-verified locally on 2026-08-08; production remains separately
   approval-gated.
5. ~~Version the integration event schema; add signing, retries, and delivery
   log.~~ Completed and browser-verified locally on 2026-08-08; production
   remains separately approval-gated.
6. ~~Ship copyable Markdown and native GitHub issue handoff.~~ Markdown and
   exact-pin links were completed on 2026-08-07. Encrypted, deduplicated GitHub
   issue delivery was completed and browser-verified locally on 2026-08-08;
   production remains separately approval-gated.
7. ~~Complete invitation claiming and agency/client roles.~~ Completed and
   browser-verified locally on 2026-08-08; production remains approval-gated.
8. ~~Add workspace branding and simplified client review mode.~~ Completed and
   browser-verified locally on 2026-08-08; production remains approval-gated.
9. ~~Add archive and client/site/review-round organization.~~ Completed and
   browser-verified locally on 2026-08-08; production remains approval-gated.
10. ~~Design a supported public SDK/API contract.~~ Completed, migration-rehearsed,
    and browser-verified locally on 2026-08-08; production and npm remain
    separately approval-gated.
11. ~~Add managed public review links with expiry, optional password, safe media
    access, and agency branding.~~ Completed, migration-rehearsed, and
    browser-verified locally on 2026-08-08; production remains approval-gated.
12. ~~Replace raw subscribers with self-service role-aware notification
    preferences while preserving external alerts.~~ Completed, migration-rehearsed,
    and browser-verified locally on 2026-08-08; production remains approval-gated.
13. Finish the website-review journey: comment editing/deletion rules, annotation
    polish, thread navigation, resolution, and sign-off with owner/client browser
    QA.
14. Add first-class image and PDF review using the same annotation, thread,
    sharing, role, notification, and approval model as website review.
15. Add workspace folders and bulk project organization only where the current
    client/site hierarchy cannot express the agency workflow.
16. Add SaaS account operations: plan/usage visibility, enforceable limits,
    subscription lifecycle, and billing administration. Payment-provider setup
    and live billing remain separately approval-gated.
17. Evaluate video review after image/PDF review is stable and storage/retention
    limits are enforced.

Repository execution, AI patch generation, and GitHub delivery are parked
optional experiments. They are not part of the ordered MarkUp SaaS parity path.

## Explicit non-claims

- The application is not currently at full MarkUp.io parity.
- Local tests and browser checks do not prove the live deployment has these changes.
- The repository does not currently provide SAML, SCIM, SOC 2 documentation,
  or broad file review.
- AI and GitHub delivery are not required to ship the MarkUp-style SaaS.
- “Better” will be earned by tested agency handoff outcomes, not by copying the
  competitor's entire feature list.
