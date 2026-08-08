import { renderIssueHandoffMarkdown } from '@/lib/issue-handoff';
import { IntegrationHttpError } from './errors';
import type { GitHubConfig, IntegrationDeliveryPayload } from './types';

const GITHUB_API = 'https://api.github.com';
const API_VERSION = '2026-03-10';
const TIMEOUT_MS = 10_000;

type GitHubIssueReference = {
  statusCode: number;
  externalId: string;
  externalUrl: string;
};

export function githubEventMarker(eventId: string): string {
  return `<!-- visual-feedback-event:${eventId} -->`;
}

function githubHeaders(config: GitHubConfig): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${config.token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'visual-feedback-tool',
    'X-GitHub-Api-Version': API_VERSION,
  };
}

async function request(config: GitHubConfig, url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: githubHeaders(config),
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new IntegrationHttpError('GitHub', response.status, response.headers.get('retry-after'));
  }
  return response;
}

function issueReference(
  value: unknown,
  config: GitHubConfig,
  statusCode: number,
): GitHubIssueReference | null {
  if (!value || typeof value !== 'object') return null;
  const issue = value as Record<string, unknown>;
  if (!Number.isSafeInteger(issue.number) || (issue.number as number) < 1) return null;
  if (typeof issue.html_url !== 'string') return null;
  const expected = `https://github.com/${config.owner}/${config.repo}/issues/${issue.number}`;
  if (issue.html_url.toLocaleLowerCase('en-US') !== expected.toLocaleLowerCase('en-US')) return null;
  return { statusCode, externalId: String(issue.number), externalUrl: expected };
}

export async function verifyGithubRepository(config: GitHubConfig): Promise<number> {
  const response = await request(
    config,
    `${GITHUB_API}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`,
    { method: 'GET' },
  );
  const value = await response.json().catch(() => null) as Record<string, unknown> | null;
  const expected = `${config.owner}/${config.repo}`;
  if (!value || typeof value.full_name !== 'string' ||
      value.full_name.toLocaleLowerCase('en-US') !== expected.toLocaleLowerCase('en-US')) {
    throw new IntegrationHttpError('GitHub', 502, null);
  }
  if (value.has_issues !== true) throw new IntegrationHttpError('GitHub', 410, null);
  return response.status;
}

export async function postEvent(
  config: GitHubConfig,
  delivery: IntegrationDeliveryPayload,
): Promise<GitHubIssueReference> {
  const owner = encodeURIComponent(config.owner);
  const repo = encodeURIComponent(config.repo);
  const marker = githubEventMarker(delivery.event.id);
  const issuesUrl = `${GITHUB_API}/repos/${owner}/${repo}/issues`;
  const recent = await request(
    config,
    `${issuesUrl}?state=all&sort=created&direction=desc&per_page=100`,
    { method: 'GET' },
  );
  const recentIssues = await recent.json().catch(() => null);
  if (!Array.isArray(recentIssues)) throw new IntegrationHttpError('GitHub', 502, null);
  for (const issue of recentIssues) {
    if (!issue || typeof issue !== 'object') continue;
    const candidate = issue as Record<string, unknown>;
    if (typeof candidate.body !== 'string' || !candidate.body.includes(marker)) continue;
    const reference = issueReference(candidate, config, 200);
    if (reference) return reference;
  }

  const issue = delivery.event.data.issue;
  const body = `${renderIssueHandoffMarkdown(issue).trimEnd()}\n\n${marker}\n`;
  const created = await request(config, issuesUrl, {
    method: 'POST',
    body: JSON.stringify({ title: issue.title, body, labels: config.labels }),
  });
  const createdIssue = await created.json().catch(() => null);
  const reference = issueReference(createdIssue, config, created.status);
  if (!reference) throw new IntegrationHttpError('GitHub', 502, null);
  return reference;
}
