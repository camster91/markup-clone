'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { dashboardHeaders } from '@/lib/client-origin';

type TeamRole = 'owner' | 'contributor' | 'client' | 'guest';

type ProjectOption = { id: string; name: string };
type Member = {
  id: string;
  email: string;
  role: TeamRole;
  projectId: string | null;
};
type Invitation = {
  id: string;
  email: string;
  role: TeamRole;
  project: ProjectOption | null;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type Props = {
  workspaceId: string;
  teamId: string;
  projects: ProjectOption[];
  members: Member[];
};

const ROLE_HELP: Record<TeamRole, string> = {
  owner: 'Full team, project, and people management.',
  contributor: 'Creates and manages projects without people access.',
  client: 'Reviews every project in this team and can approve work.',
  guest: 'Reviews one selected project and cannot approve work.',
};

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error || fallback;
}

export default function TeamAccessManager({ workspaceId, teamId, projects, members: initialMembers }: Props) {
  const base = `/api/workspaces/${workspaceId}/teams/${teamId}`;
  const [members, setMembers] = useState(initialMembers);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamRole>('client');
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [oneTimeUrl, setOneTimeUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`${base}/invitations`, { headers: dashboardHeaders(), cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, 'Could not load invitations'));
        return response.json() as Promise<Invitation[]>;
      })
      .then((rows) => { if (active) setInvitations(rows); })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load invitations');
      });
    return () => { active = false; };
  }, [base]);

  const pending = useMemo(
    () => invitations.filter((invitation) => !invitation.acceptedAt && !invitation.revokedAt),
    [invitations],
  );

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setOneTimeUrl(null);
    try {
      const payload: { email: string; role: TeamRole; projectId?: string } = { email, role };
      if (role === 'guest') payload.projectId = projectId;
      const response = await fetch(`${base}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...dashboardHeaders() },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await responseError(response, 'Could not create invitation'));
      const body = await response.json() as { invitation: Invitation; acceptUrl: string };
      setInvitations((current) => [body.invitation, ...current.filter((row) => row.email !== body.invitation.email)]);
      setOneTimeUrl(body.acceptUrl);
      setEmail('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create invitation');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(invitation: Invitation) {
    setError(null);
    const response = await fetch(`${base}/invitations/${invitation.id}`, {
      method: 'DELETE', headers: dashboardHeaders(),
    });
    if (!response.ok) {
      setError(await responseError(response, 'Could not revoke invitation'));
      return;
    }
    setInvitations((current) => current.filter((row) => row.id !== invitation.id));
  }

  async function updateMember(member: Member, nextRole: TeamRole, nextProjectId?: string) {
    setError(null);
    const payload: { role: TeamRole; projectId?: string } = { role: nextRole };
    if (nextRole === 'guest') payload.projectId = nextProjectId || projects[0]?.id;
    const response = await fetch(`${base}/members/${member.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...dashboardHeaders() },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      setError(await responseError(response, 'Could not update member'));
      return;
    }
    const updated = await response.json() as { role: TeamRole; projectId: string | null };
    setMembers((current) => current.map((row) => row.id === member.id
      ? { ...row, role: updated.role, projectId: updated.projectId }
      : row));
  }

  async function removeMember(member: Member) {
    setError(null);
    const response = await fetch(`${base}/members/${member.id}`, {
      method: 'DELETE', headers: dashboardHeaders(),
    });
    if (!response.ok) {
      setError(await responseError(response, 'Could not remove member'));
      return;
    }
    setMembers((current) => current.filter((row) => row.id !== member.id));
  }

  return (
    <aside aria-labelledby="team-access-heading" className="space-y-5">
      <div>
        <h2 id="team-access-heading" className="text-lg font-semibold text-gray-900">People and access</h2>
        <p className="mt-1 text-sm text-gray-600">Invite the right person with only the access they need.</p>
      </div>

      <form onSubmit={invite} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <label className="block text-sm font-medium text-gray-700">
          Email
          <input
            aria-label="Invitation email" type="email" required value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
          />
        </label>
        <label className="block text-sm font-medium text-gray-700">
          Role
          <select
            aria-label="Invitation role" value={role}
            onChange={(event) => setRole(event.target.value as TeamRole)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
          >
            <option value="contributor">Contributor</option>
            <option value="client">Client</option>
            <option value="guest">Guest</option>
            <option value="owner">Owner</option>
          </select>
          <span className="mt-1 block text-xs text-gray-500">{ROLE_HELP[role]}</span>
        </label>
        {role === 'guest' ? (
          <label className="block text-sm font-medium text-gray-700">
            Project
            <select
              aria-label="Guest project" required value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
            >
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
        ) : null}
        <button
          type="submit" disabled={busy || (role === 'guest' && !projectId)}
          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Creating invitation…' : 'Create invitation'}
        </button>
      </form>

      {oneTimeUrl ? (
        <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="font-medium text-amber-950">Copy this invitation link now</p>
          <p className="mt-1 text-xs text-amber-800">It will not be shown again after you leave or dismiss this message.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input readOnly aria-label="One-time invitation link" value={oneTimeUrl} className="w-full min-w-0 rounded border border-amber-300 bg-white px-2 py-1 text-xs sm:flex-1" />
            <button type="button" onClick={() => navigator.clipboard?.writeText(oneTimeUrl)} className="rounded bg-amber-900 px-3 py-1 text-xs font-medium text-white">Copy</button>
            <button type="button" onClick={() => setOneTimeUrl(null)} className="rounded border border-amber-400 px-3 py-1 text-xs font-medium text-amber-950">Dismiss</button>
          </div>
        </div>
      ) : null}

      {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      {pending.length > 0 ? (
        <section aria-labelledby="pending-invitations-heading">
          <h3 id="pending-invitations-heading" className="mb-2 text-sm font-semibold text-gray-900">Pending invitations</h3>
          <ul className="space-y-2">
            {pending.map((invitation) => (
              <li key={invitation.id} className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
                <div className="break-all font-medium text-gray-900">{invitation.email}</div>
                <div className="mt-1 text-xs capitalize text-gray-500">{invitation.role}{invitation.project ? ` · ${invitation.project.name}` : ''}</div>
                <button type="button" aria-label={`Revoke invitation for ${invitation.email}`} onClick={() => revoke(invitation)} className="mt-2 text-xs font-medium text-red-700 hover:underline">Revoke</button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="current-members-heading">
        <h3 id="current-members-heading" className="mb-2 text-sm font-semibold text-gray-900">Current members</h3>
        <ul className="space-y-2">
          {members.map((member) => (
            <li key={member.id} className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="break-all text-sm font-medium text-gray-900">{member.email}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <select
                  aria-label={`Role for ${member.email}`} value={member.role}
                  onChange={(event) => updateMember(member, event.target.value as TeamRole)}
                  className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-xs"
                >
                  <option value="owner">Owner</option>
                  <option value="contributor">Contributor</option>
                  <option value="client">Client</option>
                  <option value="guest">Guest</option>
                </select>
                <button type="button" aria-label={`Remove ${member.email}`} onClick={() => removeMember(member)} className="rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-700">Remove</button>
              </div>
              {member.role === 'guest' ? (
                <select
                  aria-label={`Project for ${member.email}`} value={member.projectId ?? projects[0]?.id ?? ''}
                  onChange={(event) => updateMember(member, 'guest', event.target.value)}
                  className="mt-2 w-full rounded border border-gray-300 px-2 py-1 text-xs"
                >
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
