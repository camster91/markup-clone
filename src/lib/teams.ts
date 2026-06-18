// Team-access helpers for the multi-tenant layer (org → teams → projects).
//
// The /api/projects GET filter is "projects whose team is one the caller
// is a member of". This file centralises the lookup so every route that
// scopes by team membership uses the same query, and tests can mock the
// helper without faking the prisma call site.
//
// The transitional behaviour: a User with ZERO team memberships still
// sees the "legacy / unscoped" projects (those with teamId IS NULL).
// The intent is that the existing single-project dashboard keeps
// working until every existing User has been invited to at least one
// team. Once that migration is done (out of scope for this commit),
// the helper can be flipped to "no teams → no projects".

import { prisma } from './prisma';
import { requireAuth } from './auth';

/**
 * Resolve the caller's session user, or null when no session is active.
 * Wraps `requireAuth` so the route layer doesn't have to import two
 * helpers for the same request.
 */
export async function getCallerUser(): Promise<{ id: string; email: string; role: string } | null> {
  return requireAuth();
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
    where: { userId: callerId },
    select: { teamId: true },
  });
  return rows.map((r) => r.teamId);
}

/**
 * Build a Prisma `where` clause for the project list filter.
 *
 * The clause has two branches:
 *   - Caller has at least one team membership: only projects in
 *     those teams (legacy / unscoped projects are hidden).
 *   - Caller has zero team memberships: only projects with
 *     teamId IS NULL (the transitional single-project dashboard
 *     behaviour — every pre-workspace project lives in this set).
 *
 * Routes pass this directly into `prisma.project.findMany({ where })`.
 * Tests can assert on the shape by inspecting the mock call args.
 */
export async function getProjectScopeWhere(
  callerId: string | null
): Promise<{ teamId: { in: string[] } } | { teamId: null }> {
  const teamIds = await getCallerTeamIds(callerId);
  if (teamIds.length > 0) {
    return { teamId: { in: teamIds } };
  }
  return { teamId: null };
}
