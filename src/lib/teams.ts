// Team-access helpers for the multi-tenant layer (org → teams → projects).
//
// The /api/projects GET filter is "projects whose team is one the caller
// is a member of". This file centralises the lookup so every route that
// scopes by team membership uses the same query, and tests can mock the
// helper without faking the prisma call site.
//
// The transitional behaviour: an authenticated non-operator with ZERO
// team memberships still sees the "legacy / unscoped" projects.
// The intent is that the existing single-project dashboard keeps
// working until every existing User has been invited to at least one
// team. Once that migration is done (out of scope for this commit),
// the helper can be flipped to "no teams → no projects".

import { prisma } from './prisma';
import { requireAuth } from './auth';
import type { Prisma } from '@prisma/client';

/**
 * Resolve the caller's session user, or null when no session is active.
 * Wraps `requireAuth` so the route layer doesn't have to import two
 * helpers for the same request.
 */
export async function getCallerUser(): Promise<{ id: string; email: string; role: string } | null> {
  return requireAuth();
}

export type TeamRole = 'owner' | 'contributor' | 'client' | 'guest';
type StoredTeamRole = TeamRole | 'reviewer';
export type CallerUser = { id: string; email: string; role: string };

/** Map the pre-migration reviewer role to its canonical client equivalent. */
export function normalizeTeamRole(role: string): TeamRole | null {
  if (role === 'reviewer') return 'client';
  if (role === 'owner' || role === 'contributor' || role === 'client' || role === 'guest') {
    return role;
  }
  return null;
}

export function canSignOffProject(role: TeamRole | 'operator' | 'legacy-reviewer'): boolean {
  return role !== 'guest';
}

/** Restrict global workspace administration to operator accounts. */
export async function assertOperator(): Promise<
  | { ok: true; caller: CallerUser }
  | { ok: false; status: 403; error: string }
> {
  const caller = await getCallerUser();
  if (!caller || caller.role !== 'operator') {
    return { ok: false, status: 403, error: 'Operator role required' };
  }
  return { ok: true, caller };
}

/**
 * Build the workspace list/detail scope for a caller. Operators can see the
 * install-wide workspace list; reviewers see only workspaces containing a
 * team they belong to. Anonymous callers receive an impossible filter.
 */
export function getWorkspaceScopeWhere(caller: CallerUser | null): Prisma.WorkspaceWhereInput {
  if (!caller) return { id: { in: [] } };
  if (caller.role === 'operator') return {};
  return {
    teams: {
      some: {
        members: { some: { userId: caller.id } },
      },
    },
  };
}

/**
 * Authorize an operation against a concrete team.
 *
 * Global operators can administer every team. Other users must have a
 * TeamMember row in the requested workspace/team pair, and its role must be
 * present in `allowedRoles`. Keeping this check beside the project-access
 * helpers prevents route handlers from treating authentication as sufficient
 * authorization.
 */
export async function assertTeamRole(
  workspaceId: string,
  teamId: string,
  allowedRoles: readonly TeamRole[] = ['owner', 'contributor', 'client', 'guest']
): Promise<
  | {
      ok: true;
      teamId: string;
      workspaceId: string;
      caller: { id: string; email: string; role: string };
      membershipRole: TeamRole | 'operator';
      membershipProjectId: string | null;
    }
  | { ok: false; status: 403 | 404; error: string }
> {
  const team = await prisma.team.findFirst({
    where: { id: teamId, workspaceId },
    select: { id: true, workspaceId: true },
  });
  if (!team) return { ok: false, status: 404, error: 'Team not found' };

  const caller = await getCallerUser();
  if (!caller) return { ok: false, status: 403, error: 'Authentication required' };

  if (caller.role === 'operator') {
    return {
      ok: true,
      teamId: team.id,
      workspaceId: team.workspaceId,
      caller,
      membershipRole: 'operator',
      membershipProjectId: null,
    };
  }

  const membership = await prisma.teamMember.findFirst({
    where: { userId: caller.id, teamId: team.id },
    select: { id: true, role: true, projectId: true },
  });
  if (!membership) {
    return { ok: false, status: 403, error: "Not a member of this team" };
  }
  const role = normalizeTeamRole(membership.role as StoredTeamRole);
  if (!role || !allowedRoles.includes(role)) {
    const error = allowedRoles.length === 1 && allowedRoles[0] === 'owner'
      ? 'Owner role required'
      : 'Required team role missing';
    return { ok: false, status: 403, error };
  }

  return {
    ok: true,
    teamId: team.id,
    workspaceId: team.workspaceId,
    caller,
    membershipRole: role,
    membershipProjectId: membership.projectId,
  };
}

/**
 * Assert the caller may access a project.
 *
 * Returns 404 when the project is missing, 403 when it exists but the
 * caller is not a member of its team. Legacy / unscoped projects
 * (teamId IS NULL) remain open to authenticated dashboard callers
 * during the transitional single-project install. Global operators
 * can access every project.
 *
 * Exported so every project-scoped route (subscribers, share,
 * integrations, pins, screenshots, …) can reuse the same gate —
 * previously only PATCH/DELETE /api/projects/[id] enforced it.
 */
export async function assertProjectAccessible(projectId: string): Promise<
  | {
      ok: true;
      projectId: string;
      teamId: string | null;
      caller: CallerUser;
      membershipRole: TeamRole | 'operator' | 'legacy-reviewer';
    }
  | { ok: false; status: 403 | 404; error: string }
> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, teamId: true },
  });
  if (!project) return { ok: false, status: 404, error: 'Project not found' };

  const caller = await getCallerUser();
  if (!caller) {
    return { ok: false, status: 403, error: 'Authentication required' };
  }

  if (caller.role === 'operator') {
    return { ok: true, projectId: project.id, teamId: project.teamId, caller, membershipRole: 'operator' };
  }

  if (project.teamId === null) {
    return { ok: true, projectId: project.id, teamId: null, caller, membershipRole: 'legacy-reviewer' };
  }

  const membership = await prisma.teamMember.findFirst({
    where: { userId: caller.id, teamId: project.teamId },
    select: { id: true, role: true, projectId: true },
  });
  const role = membership ? normalizeTeamRole(membership.role as StoredTeamRole) : null;
  if (!membership || !role || (role === 'guest' && membership.projectId !== project.id)) {
    return { ok: false, status: 403, error: "Not a member of this project's team" };
  }
  return {
    ok: true,
    projectId: project.id,
    teamId: project.teamId,
    caller,
    membershipRole: role,
  };
}

/** Restrict project administration to global operators or team owners. */
export async function assertProjectAdmin(projectId: string): Promise<
  | {
      ok: true;
      projectId: string;
      teamId: string | null;
      caller: CallerUser;
      membershipRole: 'owner' | 'contributor' | 'operator';
    }
  | { ok: false; status: 403 | 404; error: string }
> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, teamId: true },
  });
  if (!project) return { ok: false, status: 404, error: 'Project not found' };

  const caller = await getCallerUser();
  if (!caller) return { ok: false, status: 403, error: 'Authentication required' };
  if (caller.role === 'operator') {
    return {
      ok: true,
      projectId: project.id,
      teamId: project.teamId,
      caller,
      membershipRole: 'operator',
    };
  }
  if (project.teamId === null) {
    return { ok: false, status: 403, error: 'Owner or operator role required' };
  }

  const membership = await prisma.teamMember.findFirst({
    where: { userId: caller.id, teamId: project.teamId },
    select: { id: true, role: true, projectId: true },
  });
  const role = membership ? normalizeTeamRole(membership.role as StoredTeamRole) : null;
  if (!membership || (role !== 'owner' && role !== 'contributor') || membership.projectId !== null) {
    return { ok: false, status: 403, error: 'Owner or operator role required' };
  }
  return {
    ok: true,
    projectId: project.id,
    teamId: project.teamId,
    caller,
    membershipRole: role,
  };
}

/** Authorize creation of a project in a team or as an unscoped project. */
export async function assertProjectCreateAdmin(teamId: string | null): Promise<
  | { ok: true; teamId: string | null; caller: CallerUser; membershipRole: 'owner' | 'contributor' | 'operator' }
  | { ok: false; status: 403 | 404; error: string }
> {
  const caller = await getCallerUser();
  if (!caller) return { ok: false, status: 403, error: 'Authentication required' };

  if (teamId !== null) {
    const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
    if (!team) return { ok: false, status: 404, error: 'Team not found' };
  }
  if (caller.role === 'operator') {
    return { ok: true, teamId, caller, membershipRole: 'operator' };
  }
  if (teamId === null) {
    return { ok: false, status: 403, error: 'Owner or operator role required' };
  }

  const membership = await prisma.teamMember.findFirst({
    where: { userId: caller.id, teamId },
    select: { id: true, role: true, projectId: true },
  });
  const role = membership ? normalizeTeamRole(membership.role as StoredTeamRole) : null;
  if (!membership || (role !== 'owner' && role !== 'contributor') || membership.projectId !== null) {
    return { ok: false, status: 403, error: 'Owner or operator role required' };
  }
  return { ok: true, teamId, caller, membershipRole: role };
}

/**
 * Return the set of team ids the caller is a direct member of.
 *
 * The query is the lookup behind every team-scoped route:
 *   - GET /api/projects         — "where teamId IN (callerTeams)"
 *   - GET /api/workspaces/[id]  — "every team in this workspace where
 *                                 the caller has a member row"
 *   - GET /api/projects/[id]    — "is the project.teamId in callerTeams?"
 *
 * A caller with no session gets []. A caller with a session but no
 * team memberships ALSO gets [] — but the project list falls back to
 * "every project with teamId IS NULL" so the legacy single-project
 * dashboard continues to function.
 *
 * The result is a flat array of strings (not a Set) so it's easy to
 * pass directly into a Prisma `where: { teamId: { in: callerTeams } }`
 * clause without re-wrapping.
 */
export async function getCallerTeamIds(callerId: string | null): Promise<string[]> {
  if (!callerId) return [];
  const rows = await prisma.teamMember.findMany({
    where: { userId: callerId, role: { not: 'guest' }, projectId: null },
    select: { teamId: true },
  });
  return rows.map((r) => r.teamId);
}

/** Return only teams the caller owns, used to shape admin-safe read DTOs. */
export async function getCallerOwnedTeamIds(callerId: string | null): Promise<string[]> {
  if (!callerId) return [];
  const rows = await prisma.teamMember.findMany({
    where: { userId: callerId, role: 'owner' },
    select: { teamId: true },
  });
  return rows.map((row) => row.teamId);
}

/** Return team-wide project administration scopes for owners/contributors. */
export async function getCallerAdminTeamIds(callerId: string | null): Promise<string[]> {
  if (!callerId) return [];
  const rows = await prisma.teamMember.findMany({
    where: { userId: callerId, role: { in: ['owner', 'contributor'] }, projectId: null },
    select: { teamId: true },
  });
  return rows.map((row) => row.teamId);
}

/** Decide whether a project may expose its administration fields to a caller. */
export function canAdminProject(
  caller: CallerUser,
  projectTeamId: string | null,
  ownedTeamIds: readonly string[]
): boolean {
  return caller.role === 'operator' || (
    projectTeamId !== null && ownedTeamIds.includes(projectTeamId)
  );
}

/**
 * Build a Prisma `where` clause for the project list filter.
 *
 * The clause has two branches:
 *   - Operator: all projects.
 *   - Reviewer has at least one team membership: only projects in
 *     those teams (legacy / unscoped projects are hidden).
 *   - Caller has zero team memberships: only projects with
 *     teamId IS NULL (the transitional single-project dashboard
 *     behaviour — every pre-workspace project lives in this set).
 *
 * Routes pass this directly into `prisma.project.findMany({ where })`.
 * Tests can assert on the shape by inspecting the mock call args.
 */
export async function getProjectScopeWhere(
  caller: CallerUser | null
): Promise<Prisma.ProjectWhereInput> {
  if (!caller) return { id: { in: [] } };
  if (caller.role === 'operator') return {};
  const memberships = await prisma.teamMember.findMany({
    where: { userId: caller.id },
    select: { teamId: true, role: true, projectId: true },
  });
  if (memberships.length > 0) {
    const teamIds = [...new Set(
      memberships
        .filter((membership) => normalizeTeamRole(membership.role) !== 'guest')
        .map((membership) => membership.teamId),
    )];
    const projectIds = [...new Set(
      memberships
        .filter((membership) => normalizeTeamRole(membership.role) === 'guest')
        .map((membership) => membership.projectId)
        .filter((projectId): projectId is string => Boolean(projectId)),
    )];
    if (teamIds.length > 0 && projectIds.length > 0) {
      return { OR: [{ teamId: { in: teamIds } }, { id: { in: projectIds } }] };
    }
    if (teamIds.length > 0) return { teamId: { in: teamIds } };
    return { id: { in: projectIds } };
  }
  return { teamId: null };
}
