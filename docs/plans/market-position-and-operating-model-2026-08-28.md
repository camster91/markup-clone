# Market position and operating model — 2026-08-28

**Status:** researched baseline; product and pricing hypotheses await real pilot
evidence
**Governing roadmap:**
`launch-and-saas-replacement-roadmap-2026-08-28.md`
**Evidence date:** 2026-08-28

This document supplies the durable product charter, market snapshot, access
register, decision log, risk register, metric definitions, and preliminary
commercial model requested for the launch program. It does not create a second
execution queue or reorder L1-L5 in the governing roadmap.

## Product charter

- **Product:** Ashbi Visual Feedback.
- **Company and first operator:** Ashbi and Cameron Ashley.
- **Initial customer:** Ashbi itself, then small web-development and digital
  agencies that repeatedly collect feedback from non-technical clients.
- **Core job:** let a client point at a website or review asset, explain the
  issue in context, follow the discussion, and give attributable approval
  without learning a project-management tool.
- **Promise:** a branded, role-safe review link turns visual client feedback into
  developer-ready context, an owned resolution workflow, and explicit sign-off.
- **Primary platforms:** responsive web dashboard, embedded website widget,
  managed review links, and a scoped developer API. npm publication is not part
  of the launch commitment.
- **Initial market:** Ashbi client delivery. A broader geographic or commercial
  market is not yet selected or validated.
- **Constraints:** use the existing production footprint until measured demand
  justifies spend; require approval for production releases, client
  communication, pricing, purchases, sensitive data, and cancellation; make no
  enterprise identity or compliance claims; preserve export and rollback paths.

The governing roadmap's seven-part success definition remains the product's
release standard. “Market-leading” and product-market fit are hypotheses until
real customer behavior supports them.

## Evidence map

### Verified facts

- The repository implements website and image review, first-class bounded PDF
  review, pins and annotations, threads, resolution, review rounds, sign-off,
  managed sharing, role-safe workspaces/teams/projects, agency branding,
  notifications, developer context, GitHub and webhook delivery, an audit log,
  and backup/rollback tooling.
- The production release `e4f8e4eb45017930969e9ba9f46e6100472f9a08`
  is healthy and publicly verified. The schema-cleanup and Docker environment
  correction merged as `a03b87d8d05db0a69b050c75d05baf383d611fea`
  but are not released yet.
- The exact merged head passed the repository test, lint, schema, build, local
  CI, secret-scanning, and disposable PostgreSQL migration gates recorded in
  `TASK.md` and the production checklist.
- No production operator exists yet, so authenticated production behavior and a
  real client journey are not proven.
- No real pilot, retention window, subscription export, or cancellation has
  occurred.

### Evidence-backed inferences

- The strongest credible initial wedge is not broad file-format parity. It is a
  calmer agency handoff: a simple branded client experience coupled to richer
  developer context, review-round ownership, and attributable sign-off.
- Ashbi dogfooding is the lowest-risk route to customer evidence because it can
  compare the current paid workflow and this product on real work while keeping
  the incumbent available as a fallback.
- Broad AI, video, enterprise identity, and generic folder work would dilute
  the current wedge before the core journey is validated.

### Material unknowns

- The name, plan, renewal date, tax-inclusive cost, and retained data of Ashbi's
  current paid visual-feedback subscription.
- The first pilot client/project, reviewer, review window, and consent or data
  constraints.
- Baseline feedback turnaround, sign-off delay, review-round effort, failed
  attempts, and support burden in the current workflow.
- Marginal storage, bandwidth, email, backup, monitoring, and support cost per
  active project on the shared VPS.
- External willingness to pay, acquisition channel, support capacity, legal
  terms, privacy disclosures, and whether Ashbi intends to sell the product
  beyond its own client work.

## Current first-party market snapshot

Prices below are public USD list prices observed on 2026-08-28. Annual figures
are shown as the vendor's effective monthly price where the page exposes both.
They are market anchors, not evidence of Ashbi's actual subscription.

| Product | Agency-relevant public price | Strongest advertised position | Relevant gap or tradeoff for Ashbi |
|---|---:|---|---|
| [MarkUp.io](https://www.markup.io/pricing/) | Pro $79/month | Unlimited users and MarkUps, 500 GB, managed links, folders, websites plus 30+ file types including PDF and video | Broad content parity is expensive to reproduce; one Pro workspace and generic feedback do not establish Ashbi's developer-handoff advantage |
| [BugHerd](https://bugherd.com/pricing) | Studio $80 monthly or $67 annual; Premium $150 or $125 | Unlimited clients/projects, technical capture, PDF/image/video, integrated task/client workflows; Premium adds branding and advanced integrations | Mature breadth and task management set a high bar; Ashbi should win on its own client-to-developer completion loop, not copy every feature |
| [Marker.io](https://marker.io/pricing) | Agency $129 monthly or $99 annual; Starter $59 or $39 | Website QA, environment context, session replay, issue sync, technical metadata, and project-management integrations | Developer tooling is strong, but seat/project/page-view packaging creates room for a simpler agency-owned workflow |
| [Pastel](https://usepastel.com/plans) | Pro $35 monthly or $29 annual; Team $119 or $99 | Very low-friction sharing, approvals, responsive review, feedback deadlines/reminders, CSV export, and unlimited reviewers | Client simplicity is strong; Ashbi must match that ease while proving a more actionable developer handoff |

### Competitive position

**Ideal customer profile:** a 2-25-person web agency managing several concurrent
client websites, where project managers currently translate screenshots, email,
meetings, or a generic annotation tool into developer tasks.

**Early-customer wedge:** one cooperative Ashbi client reviewing a low-risk
staging site or deliverable. The incumbent remains the fallback during the pilot,
but Ashbi Visual Feedback is the system of record for the selected review round.

**Reasons to switch, pending pilot proof:**

1. Clients receive a branded, deliberately simple reviewer experience without
   internal settings or developer-only data.
2. Every issue can carry page, viewport, browser, selector, screenshot-version,
   priority, assignment, and exact-link context into the development workflow.
3. Review rounds, pausing, resolution, reopen, and attributable sign-off make
   approval state explicit rather than inferred from messages.
4. Ashbi controls deployment, retention, export, integrations, and the client
   relationship while avoiding a recurring third-party annotation subscription.

**Deliberately deferred:** video review, generic nested folders, AI-generated
fixes, repository writes, commercial billing, enterprise SSO/SCIM, and compliance
claims. Promote one only when customer evidence and its own approval boundary
justify it.

## Preliminary pricing and unit economics

### Internal replacement

The first economic decision is cost avoidance, not a public price. Record the
actual tax-inclusive monthly/annual subscription expense and any staff time spent
translating feedback. Net monthly benefit is:

`avoided subscription + avoided coordination labor - incremental infrastructure - support/operations labor`

Do not claim savings from public list prices. Do not cancel until the L4 export,
second-project/30-day proof, and explicit owner approval are complete.

### External commercial hypothesis

Commercial packaging is **proposed**, not approved or implemented:

- 14-day trial with no credit card; no permanent free tier until abuse and
  support costs are measured.
- One agency plan initially, anchored below established agency products but not
  at an unsustainable loss. The research range is $59-$99/month before tax.
- Unlimited client reviewers and comments; limits should apply to internal
  members, active projects, stored media, and bandwidth because those drive cost.
- Publish export, deletion, cancellation, overage, retention, and price-change
  behavior before accepting payment.

Choose an exact price only after two pilots or 30 days provide marginal cost,
support effort, usage, and willingness-to-pay evidence. Billing implementation
and customer-visible pricing remain separately approval-gated.

## Access and approval register

| Capability | Current evidence | Approval or owner boundary | Status |
|---|---|---|---|
| Repository and GitHub | Local checkout, authenticated remote, checks and PRs working | Normal reviewed source changes are in scope | available |
| Production SSH/hosting | Dedicated SSH key and healthy VPS/container verified | Exact owner approval immediately before every production release | available; release approval pending |
| Production operator | Provisioning command exists; user row is absent | Cameron must enter the password in a trusted user-owned terminal | blocked on owner action |
| Production email | Mailgun key valid; `ashbi.ca` active; corrected domain staged | Sending any real test or client email requires approval | configured; unsent |
| Integrations | Worker/encryption secrets staged; GitHub/webhook code tested | Per-project credentials and external deliveries require owner/client approval | production proof pending |
| Client pilot | Plan and success gates exist | Cameron selects the project/reviewer and approves communication | blocked on owner selection |
| Paid SaaS account | No verified subscription or export inventory available | Cameron provides account access and separately approves cancellation | unavailable |
| Usage/business analytics | Audit and project data exist; no pilot baseline exists | Aggregate only necessary data; avoid sensitive content | definitions ready; baseline missing |
| Billing and payments | Not part of the current release | Pricing, spending, provider setup, and live billing require approval | parked |

## Risk register

| Risk | Severity | Evidence and consequence | Mitigation / release rule |
|---|---:|---|---|
| No authenticated production proof | High | No operator row exists; public health cannot prove the owner/client journey | Provision in trusted terminal, run the full dated QA checklist, and clean up disposable data |
| Release candidate not yet deployed | High | Merged schema/env corrections are not live | Deploy only after exact approval, fresh preflight/backup, then verify exact SHA and rollback state |
| Email or integration misconfiguration | High | Corrected Mailgun domain and integration secrets are staged but not live | Shape-check after deploy; send only an approved bounded test; verify delivery logs without exposing secrets |
| No real customer validation | High | Feature presence does not prove ease, trust, retention, or willingness to switch | Complete one pilot, then a second project or 30-day window before replacement claims |
| Subscription dependency or data loss | High | Current projects, exports, retention needs, and renewal date are unknown | Inventory and export before cancellation; retain checksummed copy and obtain explicit approval |
| Single-host operations | Medium | App, database, CI, and other fleet services share one VPS | Keep off-host backups, immutable rollback images, health checks, disk monitoring, and recovery ownership |
| Unbounded growth cost | Medium | Commercial storage/bandwidth/support baselines do not exist | Measure per-project media, requests, email, backup growth, and support time before public pricing |
| Horizontal scaling limits | Medium | In-memory rate-limit/SSE behavior is documented | Remain single-instance for the pilot; add shared coordination before scaling horizontally |
| Premature breadth | Medium | Competitors advertise video, AI, folders, and enterprise controls | Keep L1-L4 ahead of feature expansion; require observed friction and a dated plan |
| Commercial/legal readiness | Medium | No validated terms, privacy/support promise, billing, or compliance program | Do not accept external payment or make enterprise claims before owner/legal review |

## Decision log

| Date | Status | Decision | Evidence | Reversal condition | Accountable owner |
|---|---|---|---|---|---|
| 2026-08-28 | approved | Use one governing roadmap and keep older plans as evidence/reference | Previous plan and task states contradicted current `main` | A future roadmap explicitly supersedes it | Cameron |
| 2026-08-28 | researched hypothesis | Target small web agencies, starting with Ashbi dogfooding | Current product hierarchy, branding, handoff, and role model fit this workflow | Pilot shows another segment or job has materially stronger pull | Cameron |
| 2026-08-28 | researched hypothesis | Differentiate on client-to-developer completion, not raw file-format count | Repository strengths plus current competitor breadth | Customers consistently choose broad media support over the handoff workflow | Cameron |
| 2026-08-28 | approved | Require production proof before the pilot and pilot proof before cancellation | Security, recovery, and real-customer evidence hierarchy | Never reverse; only strengthen the gate | Cameron |
| 2026-08-28 | approved in roadmap | Keep AI, video, billing, and enterprise work parked | No pilot or unit-economic evidence supports them yet | Measured demand justifies a dated plan and approval | Cameron |
| 2026-08-28 | proposed | Treat $59-$99/month as a research range, not a price | Current first-party agency pricing spans roughly $67-$150/month for relevant tiers | Cost, support, or willingness-to-pay evidence supports a different range | Cameron |

## Measurement contract

All baselines are **unknown** until measured. Small-pilot targets are decision
rules, not market claims.

| Metric | Definition | Pilot target / decision rule | Source |
|---|---|---|---|
| Activation | Project created, review shared, and first attributable client feedback received | Complete within one business day of setup | Audit/project events plus pilot log |
| Reviewer task success | Invited reviewers who leave feedback and complete sign-off without a blocking support intervention | 100% for the first deliberately small pilot; investigate every failure | Audit events and support log |
| Time to first feedback | Review-link open to first successful pin/comment | Median under 5 minutes | Managed-share open and feedback timestamps |
| Feedback-to-resolution time | First attributable feedback to resolved status | Establish incumbent baseline; improve or match it without added PM effort | Pin/audit timestamps |
| Client sign-off wait | Last resolved issue to attributable sign-off | Establish baseline; no unexplained wait longer than 3 business days | Round/audit timestamps |
| Unresolved feedback at launch | Open issues when the reviewed work is released | Zero, or each exception explicitly accepted by the owner/client | Round and issue state |
| Handoff coverage | Actionable issues delivered to the chosen development workflow | At least 90%; investigate every omitted actionable issue | Integration delivery log |
| PM effort per round | Minutes spent setting up, chasing, translating, and reporting | Lower than the incumbent workflow; record actual minutes | Pilot work log |
| Failed attempts and support | Blocking errors, abandoned reviews, and support questions | Zero lost feedback; every failed attempt categorized | Support/pilot log |
| Reliability | Availability and release/worker failures during active review window | No severity-1/2 incident; all detected failures recover within the documented path | Health, deploy, worker, and incident logs |
| Cost per active project | Incremental infrastructure, email, backup, storage, and support labor | Measure before pricing; gross-margin target requires an approved commercial model | VPS/service usage and work log |
| SaaS cost eliminated | Actual tax-inclusive recurring charge removed after cancellation | Record only from invoice and cancellation receipt | Paid SaaS billing record |

## Next evidence sequence

1. Resolve the exact then-current `main` containing code-bearing cleanup merge
   `a03b87d8...`, obtain approval for that exact SHA, deploy it, and verify the
   cleanup, runtime configuration, public artifact, backup, and rollback state.
2. Cameron provisions `cameron@ashbi.ca` locally; complete and clean up
   authenticated production QA.
3. Select the first pilot and record incumbent baselines, actual subscription
   cost, reviewer outcome, support friction, timing, and usage in a dated copy of
   `docs/qa/client-pilot-record-template.md`.
4. Fix only launch-blocking or repeatedly observed friction.
5. Run a second project or 30-day window, export retained SaaS data, and request
   explicit cancellation approval.
6. Revisit external pricing only after cost and willingness-to-pay evidence
   exists.
