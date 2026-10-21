# Unscoped project access matches the project list (2026-10-21)

**Status:** implemented on branch `ccr-ff82cc8e-enzsdu`; not yet deployed.
**Source:** 2026-10-15 review item "teamless projects open to all signed-in
users".

## Problem

Projects with `teamId IS NULL` belong to the transitional single-project
dashboard. Two rules disagreed:

- **Project list** (`getProjectScopeWhere`): a caller with any team membership
  sees only their teams' projects. Unscoped projects are shown only to
  callers on no team.
- **Per-project gate** (`assertProjectAccessible`): any signed-in caller could
  open an unscoped project.

So a client or guest invited to one team could read and write an unscoped
project (pins, comments, attachments, presence, events) by its id. Member
emails had the same gap: every subscriber of an unscoped project was
notified.

## Change

- `assertProjectAccessible` admits an unscoped project only for operators
  and callers with no team membership. This is the same set of people who
  see it in their list. Anyone else gets 403.
- `resolveProjectNotificationRecipients` uses the same rule.
- No one loses access to a project they can see in their dashboard.

## Not changed (owner decision)

The transitional rule itself: any signed-in user on no team can open every
unscoped project. Removing it ("no team, no projects") needs every existing
user to be on a team first. It stays tracked in TASK.md.

## Tests

- `tests/unit/teams.test.ts`: allowed for a caller on no team; 403 for a team
  member, client or guest.
- `tests/unit/project-notification-delivery.test.ts`: recipients of an
  unscoped project.
- Four route tests gained the `teamMember` mock the gate now uses.
