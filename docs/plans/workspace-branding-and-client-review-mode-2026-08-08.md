# Workspace branding and client review mode — implementation plan

**Date:** 2026-08-08
**Status:** Complete locally (production untouched)
**Release boundary:** Local implementation and verification only. Production
deployment and real client communication remain approval-gated.

## Outcome

Let an agency apply a restrained workspace identity and give clients/guests a
project-first review surface that feels like the agency's delivery portal,
while contributors and owners retain the full implementation workspace.

## Branding contract

- Add optional workspace `brandName`, HTTPS `logoUrl`, six-digit `accentColor`,
  and a bounded reviewer welcome message. Workspace name remains the internal
  organizational name and fallback identity.
- Only a global operator may edit workspace branding in this release. Teams
  share one workspace identity, avoiding conflicting brand settings across
  team owners.
- Branding is data, not executable markup: no SVG/XML/data URLs, CSS strings,
  HTML, script, or arbitrary theme tokens. Accent values are validated hex
  colors and logo URLs must use HTTPS.
- Branding appears on invitation inspection and authenticated client/guest
  project review. It never changes authorization, email claims, or API scope.
- Missing or invalid branding always falls back to the product's neutral
  identity and blue accent.

## Client review contract

- Client and guest project pages lead with agency identity, project name,
  current review-round progress, unresolved feedback, and the sign-off flow.
- Client/guest pages continue to hide keys, integrations, subscribers,
  assignments, tags, developer context, team/member data, and internal issue
  controls. Guest sign-off remains forbidden.
- Contributor/owner/operator views retain project administration, developer
  handoff, integrations, issue workflow, and people/navigation affordances.
- The responsive surface must remain usable at 320px and 375px, support
  keyboard focus, and meet contrast requirements for user-selected accents.
  Foreground text is chosen by measured contrast rather than assumption.

## Test-first sequence

1. RED schema and validation tests for additive workspace branding fields,
   bounded copy, HTTPS-only logos, and normalized hex colors.
2. RED API authorization tests for operator-only branding reads/writes and safe
   DTOs.
3. RED server/component tests for branded invitation and client/guest review
   headers, safe fallbacks, role redaction, and contributor/admin preservation.
4. Fresh/legacy migration rehearsal, full automated gates, production Docker
   build, and authenticated desktop/mobile browser QA with no real client data.

## Non-goals

- Uploaded logo storage, custom domains, white-label email delivery, arbitrary
  CSS, multiple brands per team, or removing product attribution entirely.
- Production deployment or emailing real invitations without explicit approval.

## Completion evidence

- 720 automated tests pass and 3 are intentionally skipped; TypeScript,
  ESLint, Prisma validation, host build, and production Docker build pass.
- A fresh database applies all 21 migrations. A legacy rehearsal preserved the
  existing workspace and left new brand fields null while installing all four
  branding constraints.
- Browser QA proved operator-managed branding, a light-accent contrast choice,
  branded invitation acceptance, and branded client/guest project review at
  1280px, 375px, and 320px with zero overflow, console errors, or failed
  requests.
- Visual review removed meaningless presence identifiers from client/guest
  mode while preserving contributor/owner collaboration UI.
- Only fictional `.test` users were used. No real logo was fetched, no email
  was sent, and production was not changed.
