// Project access control — team membership gate shared by every
// `/api/projects/[id]/*` mutation and sensitive read.
//
// Without this check, a dashboard caller who knows (or guesses) a
// project UUID could mutate subscribers, share links, integrations,
// etc. on a project they do not own. The gate mirrors the one
// already used by DELETE/PATCH `/api/projects/[id]`.

import { prisma } from './prisma';
import { getCallerUser } from './teams';
import { validateUuidParam } from './validation';

export type ProjectAccessResult =
  | { ok: true; projectId: string; teamId: string | null }
  | { ok: false; status: 400 | 403 | 404; error: string };

/**
 * Verify the project exists and the caller may touch it.
 *
 * Semantics:
 *   - Invalid UUID → 400
 *   - Missing project → 404
 *   - teamId IS NULL (legacy/unscoped) → allowed for any authenticated
 *     dashboard caller (transitional single-project install)
 *   - teamId set, no session or not a member → 403
 */
export async function assertProjectAccessible(projectId: string): Promise<ProjectAccessResult> {
  const idRes = validateUuidParam(projectId, 'id');
  if (!idRes.ok) return { ok: false, status: 400, error: idRes.error };

  const project = await prisma.project.findUnique({
    where: { id: idRes.value },
    select: { id: true, teamId: true },
  });
  if (!project) return { ok: false, status: 404, error: 'Project not found' };

  if (project.teamId === null) {
    return { ok: true, projectId: project.id, teamId: null };
  }

  const caller = await getCallerUser();
  if (!caller) {
    return { ok: false, status: 403, error: "Not a member of this project's team" };
  }

  const membership = await prisma.teamMember.findFirst({
    where: { userId: caller.id, teamId: project.teamId },
    select: { id: true },
  });
  if (!membership) {
    return { ok: false, status: 403, error: "Not a member of this project's team" };
  }
  return { ok: true, projectId: project.id, teamId: project.teamId };
}
