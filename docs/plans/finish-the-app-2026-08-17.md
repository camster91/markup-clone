# Finish the app — 2026-08-17

## Status

Active after the public onboarding release. This plan turns the remaining work
under GitHub issue #28 into bounded, independently verifiable delivery phases.

## Product goal

Ship a dependable MarkUp-style visual feedback SaaS for web developers and
agencies: quick client onboarding, URL/image/PDF review, precise annotations,
review rounds and sign-off, developer-ready handoff, branded sharing, and an
optional ChatGPT-compatible control surface that can use the same permissions
and capabilities as the web app.

## Product boundaries

- The core review workflow does not require GitHub, AI, or an external provider.
- AI/MCP is an optional client, never an authorization bypass or second source
  of business logic.
- Production claims require authenticated live evidence, not only local tests.
- Billing, account creation, email delivery, and external integrations remain
  approval-gated because they affect users or third-party systems.

## Phase 1 — Release proof and first operator

1. Provision the first production operator through the documented controlled
   process.
2. Run authenticated production journeys for owner, client, guest/share, and
   developer-token roles on desktop and mobile.
3. Cover URL capture, image upload, PDF review, pins, comments, status,
   assignment, rounds, sign-off, managed shares, notifications, archive, and
   developer handoff.
4. Record exact revision, migration, rollback, browser, and cleanup evidence.

**Exit:** the deployed revision passes the complete production smoke matrix and
the temporary QA records are removed or retained intentionally.

## Phase 2 — Agency onboarding and repeatable setup

1. Add a controlled request/invite/account activation path with clear states.
2. Add a guided workspace → client/team → site → first review setup flow.
3. Provide copyable widget installation instructions and an installation check.
4. Make agency defaults, branding, reviewer permissions, and notification
   presets understandable before the first invitation is sent.

**Exit:** a new agency can create and verify its first review without database
or command-line intervention.

## Phase 3 — Core journey regression suite

1. Turn the authenticated production smoke matrix into deterministic browser
   coverage against seeded local/staging data.
2. Add failure-path coverage for capture, upload, mail, sharing, recapture,
   concurrent comments, expired access, and paused rounds.
3. Add visual baselines for review, sharing, setup, loading, empty, and failure
   states at supported viewport sizes.

**Exit:** every release blocks on the critical agency/client journeys without
depending on production data.

## Phase 4 — Operations, security, and trust

1. Exercise a production-equivalent backup restore and document recovery time.
2. Add privacy-safe health, queue/capture, delivery, storage, and release alerts.
3. Resolve the Prisma CLI dependency advisory through a tested upgrade rather
   than an unbounded automatic dependency rewrite.
4. Publish product help, accessibility, privacy, retention/deletion, support,
   and service-status guidance appropriate to the actual operating model.

**Exit:** an operator can detect, diagnose, restore, and explain the product's
handling of customer data using versioned runbooks.

## Phase 5 — Commercial readiness

1. Decide trial/invite, plan, usage, seat, and storage limits before adding
   payment code.
2. Add subscription and account-management flows with webhook reconciliation,
   entitlement tests, cancellation/export behavior, and support tooling.
3. Keep review data accessible according to the documented cancellation and
   retention policy.

**Exit:** plan enforcement and billing state are deterministic, supportable,
and do not strand customer review data.

## Phase 6 — ChatGPT-compatible API and MCP

1. Inventory every user-visible capability and classify it as read, draft,
   write, destructive, administrative, or external-delivery.
2. Expose those capabilities through a versioned API and MCP server that reuse
   existing authorization, validation, audit, idempotency, and rate limits.
3. Add confirmation boundaries for destructive or externally visible actions.
4. Publish schemas, examples, capability discovery, error contracts, and an
   end-to-end ChatGPT connection guide.
5. Prove parity with contract tests and a real agent dogfood run using least-
   privilege credentials.

**Exit:** ChatGPT can discover and use the supported product surface end to end
without receiving broader permissions than the equivalent web user.

## Release order

Phases 1–2 are the immediate path to a usable product. Phases 3–4 make releases
repeatable and supportable. Phase 5 is required before charging customers.
Phase 6 can proceed after the core authorization and audit contracts are stable;
it must not block the non-AI review product.

## GitHub tracking

- Parent epic: #28
- Each phase is represented by one or more child issues with explicit acceptance
  criteria and links back to this plan.
- Implementation should split further only when a child issue cannot be shipped
  and verified in one focused pull request.
