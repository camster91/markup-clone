import type { FeedbackAttachment, Pin } from './types';
import { ISSUE_PRIORITIES, type IssuePriority } from './issue-metadata';

export const ISSUE_HANDOFF_SCHEMA = 'visual-feedback.issue.v1' as const;

const MAX_TITLE_LENGTH = 120;
const MAX_COMMENTS = 50;
const MAX_COMMENT_LENGTH = 2000;
const MAX_AUTHOR_LENGTH = 120;
const MAX_ATTACHMENTS_PER_COMMENT = 20;

type HandoffScreenshot = {
  id: string;
  width: number;
  height: number;
  capturedAt: string;
};

export type IssueHandoffV1 = {
  schema: typeof ISSUE_HANDOFF_SCHEMA;
  title: string;
  pin: {
    id: string;
    status: string;
    createdAt: string;
    coordinates: { xPercent: number; yPercent: number };
  };
  project: { id: string; name: string; domain: string };
  page: { path: string; url: string | null };
  reviewUrl: string;
  screenshot: HandoffScreenshot;
  reviewRound: { id: string; number: number; name: string | null } | null;
  environment: {
    viewport: { width: number; height: number; devicePixelRatio: number | null } | null;
    browser: string;
    platform: string;
  } | null;
  selectors: string[];
  elementSnippet: string | null;
  internal: {
    priority: IssuePriority;
    assignee: { id: string; email: string } | null;
    tags: Array<{ id: string; name: string; key: string }>;
  };
  commentCount: number;
  commentsTruncated: boolean;
  comments: Array<{
    id: string;
    author: string;
    authorRole: string;
    text: string;
    createdAt: string;
    attachments: Array<Pick<FeedbackAttachment, 'kind' | 'mimeType' | 'size'>>;
  }>;
};

export type BuildIssueHandoffInput = {
  dashboardOrigin: string;
  project: { id: string; name: string; domain: string };
  pagePath: string;
  screenshot: HandoffScreenshot;
  pin: Pin;
};

function bounded(value: string, maximum: number): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, maximum);
}

function titleForPin(pin: Pin): string {
  const firstComment = pin.comments.find((comment) => comment.text.trim().length > 0);
  if (!firstComment) return `Feedback pin ${bounded(pin.id, 64)}`;
  return bounded(firstComment.text.replace(/\s+/g, ' ').trim(), MAX_TITLE_LENGTH);
}

function dashboardOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('dashboardOrigin must be a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('dashboardOrigin must use http or https');
  }
  return parsed.origin;
}

function normalizedHost(value: string): string {
  return value.toLowerCase().replace(/^www\./, '');
}

function safePageUrl(value: string | null | undefined, domain: string, pagePath: string): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (normalizedHost(parsed.hostname) !== normalizedHost(domain)) return null;
    if (parsed.pathname !== pagePath) return null;
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function boundedSelectors(values: readonly string[]): string[] {
  const unique: string[] = [];
  for (const value of values) {
    const selector = bounded(value, 500);
    if (selector && !unique.includes(selector)) unique.push(selector);
    if (unique.length === 5) break;
  }
  return unique;
}

export function buildIssueHandoffV1(input: BuildIssueHandoffInput): IssueHandoffV1 {
  const context = input.pin.developerContext ?? null;
  const projectId = bounded(input.project.id, 128);
  const pinId = bounded(input.pin.id, 128);
  const pagePath = bounded(input.pagePath, 2048);
  const comments = input.pin.comments.slice(-MAX_COMMENTS).map((comment) => ({
    id: bounded(comment.id, 128),
    author: bounded(comment.author, MAX_AUTHOR_LENGTH),
    authorRole: bounded(comment.authorRole, 40),
    text: bounded(comment.text.replace(/\r\n?/g, '\n'), MAX_COMMENT_LENGTH),
    createdAt: comment.createdAt,
    attachments: (comment.attachments ?? []).slice(0, MAX_ATTACHMENTS_PER_COMMENT).map((attachment) => ({
      kind: attachment.kind,
      mimeType: bounded(attachment.mimeType, 120),
      size: attachment.size,
    })),
  }));
  const origin = dashboardOrigin(input.dashboardOrigin);
  const priority = input.pin.priority && (ISSUE_PRIORITIES as readonly string[]).includes(input.pin.priority)
    ? input.pin.priority
    : 'NONE';
  const internalTags = (input.pin.tags ?? []).slice(0, 5).map((tag) => ({
    id: bounded(tag.id, 128),
    name: bounded(tag.name, 32),
    key: bounded(tag.key, 32),
  }));

  return {
    schema: ISSUE_HANDOFF_SCHEMA,
    title: titleForPin(input.pin),
    pin: {
      id: pinId,
      status: bounded(input.pin.status, 40),
      createdAt: input.pin.createdAt,
      coordinates: { xPercent: input.pin.xPercent, yPercent: input.pin.yPercent },
    },
    project: {
      id: projectId,
      name: bounded(input.project.name, 200),
      domain: bounded(input.project.domain, 253),
    },
    page: {
      path: pagePath,
      url: safePageUrl(context?.pageUrl, input.project.domain, pagePath),
    },
    reviewUrl: `${origin}/projects/${encodeURIComponent(projectId)}?pin=${encodeURIComponent(pinId)}`,
    screenshot: { ...input.screenshot },
    reviewRound: context?.reviewRound ? {
      id: bounded(context.reviewRound.id, 128),
      number: context.reviewRound.number,
      name: context.reviewRound.name ? bounded(context.reviewRound.name, 120) : null,
    } : null,
    environment: context ? {
      viewport: context.viewport,
      browser: bounded(context.browser, 128),
      platform: bounded(context.platform, 128),
    } : null,
    selectors: boundedSelectors(context?.selectors ?? []),
    elementSnippet: context?.elementSnippet ? bounded(context.elementSnippet, 4000) : null,
    internal: {
      priority,
      assignee: input.pin.assignee ? {
        id: bounded(input.pin.assignee.id, 128),
        email: bounded(input.pin.assignee.email, 254),
      } : null,
      tags: internalTags,
    },
    commentCount: input.pin.comments.length,
    commentsTruncated: input.pin.comments.length > MAX_COMMENTS,
    comments,
  };
}

function escapeMarkdown(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_{}\[\]()#+!|])/g, '\\$1');
}

function codeBlock(content: string, language = 'text'): string {
  const runs = content.match(/`+/g) ?? [];
  const longest = runs.reduce((maximum, run) => Math.max(maximum, run.length), 0);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${content}\n${fence}`;
}

export function renderIssueHandoffMarkdown(payload: IssueHandoffV1): string {
  const lines: string[] = [
    `# ${escapeMarkdown(payload.title)}`,
    '',
    `Schema: \`${payload.schema}\``,
    '',
    `- Status: **${escapeMarkdown(payload.pin.status)}**`,
    `- Project: ${escapeMarkdown(payload.project.name)} (\`${escapeMarkdown(payload.project.domain)}\`)`,
    `- Page: \`${escapeMarkdown(payload.page.path)}\``,
    `- Position: ${payload.pin.coordinates.xPercent}%, ${payload.pin.coordinates.yPercent}%`,
    `- Pin: \`${escapeMarkdown(payload.pin.id)}\``,
    `- Created: ${escapeMarkdown(payload.pin.createdAt)}`,
    `- Screenshot: \`${escapeMarkdown(payload.screenshot.id)}\` · ${payload.screenshot.width} × ${payload.screenshot.height} · ${escapeMarkdown(payload.screenshot.capturedAt)}`,
  ];

  if (payload.page.url) lines.push(`- Captured URL: ${escapeMarkdown(payload.page.url)}`);
  if (payload.reviewRound) {
    const name = payload.reviewRound.name ? ` · ${escapeMarkdown(payload.reviewRound.name)}` : '';
    lines.push(`- Review round: ${payload.reviewRound.number}${name}`);
  }
  lines.push('', `[Open the exact feedback pin](${payload.reviewUrl})`);

  lines.push('', '## Internal workflow', '');
  lines.push(`- Priority: **${escapeMarkdown(payload.internal.priority)}**`);
  lines.push(`- Assignee: ${payload.internal.assignee ? escapeMarkdown(payload.internal.assignee.email) : 'Unassigned'}`);
  lines.push(`- Tags: ${payload.internal.tags.length > 0
    ? payload.internal.tags.map((tag) => escapeMarkdown(tag.name)).join(', ')
    : 'None'}`);

  if (payload.comments.length > 0) {
    lines.push('', '## Conversation', '');
    for (const comment of payload.comments) {
      lines.push(`**${escapeMarkdown(comment.author)}** (${escapeMarkdown(comment.authorRole)}) · ${escapeMarkdown(comment.createdAt)}`);
      for (const line of comment.text.split('\n')) lines.push(`> ${escapeMarkdown(line)}`);
      if (comment.attachments.length > 0) {
        const attachmentText = comment.attachments
          .map((attachment) => `${attachment.kind} ${attachment.mimeType} (${attachment.size} bytes)`)
          .join(', ');
        lines.push(`> Attachments: ${escapeMarkdown(attachmentText)}`);
      }
      lines.push('');
    }
    if (payload.commentsTruncated) {
      lines.push(`_Showing the latest ${payload.comments.length} of ${payload.commentCount} comments._`, '');
    }
  }

  if (payload.environment || payload.selectors.length > 0 || payload.elementSnippet) {
    lines.push('## Developer context', '');
    if (payload.environment?.viewport) {
      const viewport = payload.environment.viewport;
      const dpr = viewport.devicePixelRatio ? ` @ ${viewport.devicePixelRatio}x` : '';
      lines.push(`- Viewport: ${viewport.width} × ${viewport.height}${dpr}`);
    }
    if (payload.environment) {
      lines.push(`- Environment: ${escapeMarkdown(payload.environment.browser)} · ${escapeMarkdown(payload.environment.platform)}`);
    }
    if (payload.selectors.length > 0) {
      lines.push('', '### Selector candidates', '', codeBlock(payload.selectors.join('\n')));
    }
    if (payload.elementSnippet) {
      lines.push('', '### Element snippet', '', codeBlock(payload.elementSnippet, 'html'));
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
