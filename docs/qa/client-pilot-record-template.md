# Ashbi Visual Feedback client pilot record

**Template status:** ready; no pilot evidence recorded
**Governing roadmap:**
`docs/plans/launch-and-saas-replacement-roadmap-2026-08-28.md`
**Measurement contract:**
`docs/plans/market-position-and-operating-model-2026-08-28.md`

Create a dated copy named `client-pilot-YYYY-MM-DD-<non-sensitive-slug>.md`
for each pilot. Do not record passwords, tokens, private file contents, client
personal data that is unnecessary for the decision, or sensitive production
data. Link stable audit or delivery identifiers instead of copying secrets or
message bodies.

Honest statuses are `proposed`, `approved`, `in progress`, `verified`,
`customer-validated`, `blocked`, `rejected`, and `superseded`. A completed form
does not make a pilot successful; the evidence and exit decision do.

## Pilot identity

| Field | Record |
|---|---|
| Pilot ID | `[UTC date + non-sensitive slug]` |
| Status | `proposed` |
| Ashbi owner | `Cameron Ashley` |
| Client/project alias | `[non-sensitive alias]` |
| Production project ID | `[record after creation]` |
| Review round ID | `[record after creation]` |
| Exact deployed SHA | `[40-character SHA]` |
| Review window | `[UTC start]` to `[UTC end]` |
| Reviewer count and roles | `[aggregate, no unnecessary personal data]` |
| Incumbent fallback | `[product/plan alias and rollback trigger]` |
| Evidence owner | `[name]` |

## Approval and suitability gate

- [ ] Cameron approved this exact client/project and the review window.
- [ ] Client communication, reviewer invitation, and any test notification are
  approved; the approved sender and audience are recorded without credentials.
- [ ] The project is low risk, has a cooperative reviewer, and can return to the
  incumbent workflow without losing feedback.
- [ ] The reviewed site/assets and recorded metadata fit the agreed client data,
  confidentiality, and retention boundaries.
- [ ] The incumbent remains active and its current project/history is untouched.
- [ ] No billing, subscription, pricing, public announcement, or cancellation is
  implied by this pilot approval.

## Production readiness gate

- [ ] L1 authenticated production QA and disposable-data cleanup are complete
  for the exact deployed SHA.
- [ ] The operator can sign in and the reviewer/client surface is role-redacted
  at desktop and mobile widths.
- [ ] Current health, trusted TLS, migration count, worker/cron state, disk
  capacity, backup checksum, off-host copy, and retained rollback image are
  recorded in the production launch checklist.
- [ ] Email and any selected integration have a bounded, approved test result;
  unused delivery channels remain disabled or unconfigured for this project.
- [ ] Support owner, incident path, fallback trigger, and recovery owner are
  named for the review window.

## Incumbent baseline

Record observed values where available. Use `unknown` rather than an estimate
presented as fact.

| Measure | Baseline value | Period/source | Confidence or limitation |
|---|---:|---|---|
| Tax-inclusive recurring SaaS cost | `unknown` | `[invoice/billing record]` | `[record]` |
| Recent feedback-to-resolution median | `unknown` | `[comparable rounds]` | `[record]` |
| Recent client sign-off wait | `unknown` | `[comparable rounds]` | `[record]` |
| Review rounds per comparable project | `unknown` | `[project records]` | `[record]` |
| PM coordination minutes per round | `unknown` | `[time record/interview]` | `[record]` |
| Actionable feedback reaching development | `unknown` | `[issue/task records]` | `[record]` |
| Support questions or failed attempts | `unknown` | `[support/project notes]` | `[record]` |

## Pilot success and rollback rules

Before inviting the reviewer, preserve or tighten these defaults:

- **Success:** the reviewer leaves attributable feedback and signs off without
  blocking support; no feedback is lost; zero unresolved items reach launch
  unless explicitly accepted; at least 90% of actionable issues reach the
  selected development workflow; recovery and cleanup checks pass.
- **Investigate:** every failed or abandoned attempt, support intervention,
  missing handoff, delivery failure, unexpected permission, and unexplained wait
  longer than three business days.
- **Rollback to incumbent:** any suspected data loss, unauthorized disclosure,
  unavailable primary workflow without a bounded recovery, or client request to
  stop. Record the exact trigger and preserve evidence before recovery.
- **No-go for SaaS replacement:** incomplete sign-off, lost feedback, unresolved
  high-severity defect, unverified export/retention, or missing second-project or
  30-day evidence.

## Journey log

Record timestamps from the product/audit source where possible. Do not replace
observed client behavior with a synthetic test.

| UTC | Actor/role | Journey event | Outcome | Evidence ID/link | Support, defect, or workaround |
|---|---|---|---|---|---|
| `[time]` | owner | Create project and active review round | `[result]` | `[audit/project ID]` | `[record]` |
| `[time]` | owner | Configure branded managed review | `[result]` | `[share ID]` | `[record]` |
| `[time]` | reviewer | Open review and reach first value | `[result]` | `[share-open/audit ID]` | `[record]` |
| `[time]` | reviewer | Leave first attributable feedback | `[result]` | `[pin/comment ID]` | `[record]` |
| `[time]` | owner/developer | Triage and deliver actionable issue | `[result]` | `[delivery/issue ID]` | `[record]` |
| `[time]` | owner/developer | Resolve or request clarification | `[result]` | `[audit ID]` | `[record]` |
| `[time]` | reviewer | Confirm resolution or reopen | `[result]` | `[audit ID]` | `[record]` |
| `[time]` | reviewer | Complete attributable sign-off | `[result]` | `[round/sign-off ID]` | `[record]` |

## Measured outcome

Use the definitions in the market and operating model. Record numerator,
denominator, and sample size where a percentage or median is reported.

| Metric | Pilot result | Baseline | Target/result | Evidence and limitation |
|---|---:|---:|---|---|
| Activation time | `unknown` | `unknown` | `<= 1 business day` | `[record]` |
| Reviewer task success | `unknown` | `unknown` | `100% for first small pilot` | `[n/N and record]` |
| Time to first feedback | `unknown` | `unknown` | `median < 5 minutes` | `[timestamps]` |
| Feedback-to-resolution time | `unknown` | `unknown` | `match/improve without more PM effort` | `[timestamps]` |
| Client sign-off wait | `unknown` | `unknown` | `no unexplained wait > 3 business days` | `[timestamps]` |
| Unresolved feedback at launch | `unknown` | `unknown` | `0 or explicitly accepted` | `[issue state]` |
| Developer handoff coverage | `unknown` | `unknown` | `>= 90%` | `[n/N deliveries]` |
| PM minutes per round | `unknown` | `unknown` | `lower than incumbent` | `[time record]` |
| Failed attempts/support questions | `unknown` | `unknown` | `0 lost feedback; all categorized` | `[log]` |
| Reliability incidents | `unknown` | `unknown` | `0 severity-1/2` | `[health/incident log]` |
| Incremental cost per active project | `unknown` | `unknown` | `measure before pricing` | `[usage + labor]` |

## Defect, support, and recovery log

| ID | Severity | Observed problem | Customer impact | Workaround/recovery | Owner | Status/decision |
|---|---:|---|---|---|---|---|
| `[id]` | `[severity]` | `[observed fact]` | `[impact]` | `[action]` | `[owner]` | `[status]` |

For each launch-blocking defect, link a dated implementation plan and verified
fix. Repeated non-blocking friction may justify an L5 plan. One opinion or a
competitor feature does not.

## Cleanup and retention

- [ ] Revoke expired or disposable shares/tokens and close any labelled test
  delivery artifact.
- [ ] Remove only disposable pilot setup; retain real project feedback according
  to the approved client/Ashbi retention rule.
- [ ] Verify no temporary upload, work directory, secret, or duplicated record
  remains.
- [ ] Record the export location and checksum for any retained pilot evidence
  that must survive product or subscription changes.
- [ ] Recheck application health, worker/cron state, logs, disk, backup, and
  rollback evidence after the window.

## Retrospective and decision

### Observed value

- What became faster, clearer, safer, or easier: `[record]`
- What required support or translation: `[record]`
- What the reviewer chose or avoided without prompting: `[record]`
- What the developer received that the incumbent did not provide: `[record]`
- What evidence contradicts the product hypothesis: `[record]`

### Exit decision

Choose exactly one and record the accountable owner/date:

- [ ] **Customer-validated for this pilot only:** success rules passed; proceed
  to a named second project or 30-day operating window.
- [ ] **Continue with changes:** no data/security failure, but a bounded defect or
  workflow change must be verified before another pilot.
- [ ] **Return to incumbent:** rollback rule fired or the customer outcome does
  not justify continuing.

Decision, evidence, owner, and UTC date: `[record]`

## Second-project or 30-day validation

This section cannot be satisfied by the first pilot.

| Field | Record |
|---|---|
| Validation method | `[second named project / explicit 30-day window]` |
| Start/end | `[UTC]` |
| Independent outcome evidence | `[record/link]` |
| Active incumbent dependencies | `[inventory]` |
| Export and retention verification | `[location/checksum/read-back]` |
| Actual recurring cost eligible for removal | `[invoice value]` |
| Replacement recommendation | `[proceed / continue / reject]` |

Even after this record passes, cancellation requires a separate exact approval
from Cameron and a saved cancellation receipt/final invoice.
