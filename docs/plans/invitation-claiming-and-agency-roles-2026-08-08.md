# Invitation claiming and agency/client roles — implementation plan

**Date:** 2026-08-08
**Status:** Complete locally (production untouched)
**Release boundary:** Local implementation and verification only. Sending real
invitations or deploying remains approval-gated.

## Outcome

Give agencies a complete, role-safe way to invite collaborators and clients,
let invitees claim access without operator intervention, and ensure every role
sees only the projects and controls needed for its work.

## Role contract

| Role | Scope | Capabilities |
|---|---|---|
| `owner` | Entire team | Team/member/invitation administration, project creation and administration, technical context, integrations, issue workflow, review rounds, and sign-off |
| `contributor` | Entire team | Project creation and administration, technical context, integrations, issue workflow, feedback, and review rounds; no team/member/invitation administration |
| `client` | Entire team | Client-facing project review, pins, comments, status changes, and attributable sign-off; no setup, technical context, integration, assignment, or team-member data |
| `guest` | One explicit project | Pins, comments, and ordinary feedback status on the granted project only; no team directory, other projects, technical context, internal workflow, or sign-off authority |

The existing `reviewer` team role is migrated to `client` without changing its
review access. Global `User.role` remains the installation-level
`operator`/`reviewer` distinction; team roles remain the project authorization
source of truth.

## Invitation lifecycle

1. A team owner/operator invites a normalized email with one canonical role.
   Guest invitations require a project belonging to that team; other roles
   cannot carry a project grant.
2. The server generates 32 random bytes, returns the fragment-based acceptance
   URL once, and stores only a SHA-256 token hash. The invite expires after
   seven days and can be revoked before acceptance.
3. Creating a replacement invite revokes any still-pending invite for the same
   team/email. Active members cannot be reinvited through this path.
4. `/invite#<token>` removes the fragment from browser history before sending
   the token in a same-origin JSON request. Tokens never appear in server paths,
   database plaintext, API list responses, rendered markup after inspection,
   audit metadata, or errors.
5. An existing account may accept by matching authenticated email or by proving
   its password. A new invited email may create an account with a validated
   password. Acceptance creates a session and atomically claims membership.
6. Invalid, expired, revoked, and already-used tokens return a generic outcome
   that does not expose team or email metadata. Inspection and acceptance are
   rate-limited.

## Data and authorization

- Add an additive `TeamInvitation` model with token hash, normalized email,
  role, optional guest project, expiry, acceptance/revocation timestamps, and
  inviter attribution.
- Add nullable `TeamMember.projectId`; it is required only for `guest` and
  scopes that membership to one project.
- Add database checks for canonical roles, role/project consistency, token hash
  shape, and chronological state. Existing `reviewer` rows become `client`.
- Centralize role capabilities in `src/lib/teams.ts`. Project reads accept
  team-wide roles or a matching guest grant. Project administration accepts
  owners, contributors, and global operators. Sign-off rejects guests.
- Owners cannot delete or demote the last claimed owner. A member cannot mutate
  a row outside the nested workspace/team boundary.
- Client and guest DTOs/pages do not serialize member emails, invitation data,
  API keys, share tokens, technical context, integrations, assignment, or tags.

## UI contract

- Owners get an accessible team access panel for inviting, copying the one-time
  link, viewing safe pending state/expiry, revoking, changing roles, and removing
  members.
- Contributors get project-creation/admin affordances but no people controls.
- Clients get a clearly labelled client-review experience.
- Guests are routed to their granted project and never receive a team-wide
  project/member listing.
- The invitation page supports loading, invalid/expired, existing-account,
  create-account, success, and retry states with keyboard and screen-reader
  feedback.

## Test-first sequence

1. RED schema/migration tests for invitation fields, role checks, guest project
   consistency, token hashes, and semantic `reviewer` to `client` migration.
2. RED policy tests for owner/contributor/client/guest project, administration,
   sign-off, workspace, and team scopes.
3. RED API tests for invite creation/list/replacement/revocation, token
   redaction, expiry, generic invalid responses, rate limits, account matching,
   new-account creation, session cookies, atomic claim, and last-owner safety.
4. RED component/page tests for role descriptions, guest project selection,
   one-time links, pending state, invite acceptance, and role-redacted views.
5. Run the complete automated gates, fresh/legacy migration rehearsal,
   production Docker runtime, and authenticated owner/contributor/client/guest
   desktop/mobile/keyboard browser QA.

## Non-goals

- SSO, SCIM, social OAuth, domain-based auto-joining, billing seats, or bulk CSV
  invitation.
- Sending a real email during local QA. The one-time acceptance link is the
  verified delivery surface for this slice; email delivery can consume it after
  notification preferences are designed.
- Production data mutation or deployment without explicit approval.

## Completion evidence required

- Every new behavior has an observed RED test before implementation.
- A legacy database with pending/claimed `reviewer` rows migrates without losing
  users, teams, projects, memberships, or invitations.
- Automated tests prove plaintext invitation tokens and protected fields never
  cross read, log, audit, error, or role boundaries.
- Browser QA proves each role's visible navigation and controls at desktop,
  375px, and 320px, including keyboard acceptance and zero horizontal overflow.
- Production remains untouched until explicit approval.

## Completion evidence

- 710 automated tests pass and 3 are intentionally skipped; TypeScript and
  ESLint pass, and both host and Docker production builds complete.
- A fresh database applies all 20 migrations. A separate legacy rehearsal
  converted an existing `reviewer` membership to `client`, preserved its null
  project scope, created `TeamInvitation`, and verified the four role/token
  constraints.
- Authenticated browser QA covered owner, contributor, client, guest, and a
  real invite-only account acceptance at 1280px, 375px, and 320px with zero
  horizontal overflow, console errors, or failed requests.
- Browser inspection caught and fixed a 30px mobile overflow and a contributor
  refresh downgrade. Final screenshots show explicit client and guest access
  labels and redacted guest workspace counts.
- Only fictional `.test` accounts were used locally. No email was sent and
  production was not changed.
