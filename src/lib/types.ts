// Shared types for the dashboard components.
// Mirror the Prisma schema so we don't have to import @prisma/client in client components.
// Names use the "Feedback" prefix to avoid collisions with browser globals (e.g. DOM `Comment`).

import type { IssuePriority } from './issue-metadata';

/** A file attached to a Comment. The first surface is images
 *  pasted from the dashboard reviewer's clipboard; the schema
 *  reserves `kind: 'image' | 'voice' | 'video'` so voice / video
 *  replies can be added without a type change. The `url` is a
 *  RELATIVE path — the GET /api/attachments/[id] route accepts
 *  it for an authenticated project member or a browser carrying the
 *  managed review's token-bound HttpOnly cookie. The public URL itself
 *  remains credential-free. The dashboard's PinThread renders <img> tags
 *  directly from the URL. */
export type FeedbackAttachment = {
  id: string;
  kind: 'image' | 'voice' | 'video';
  mimeType: string;
  size: number;
  url: string;
};

export type FeedbackComment = {
  id: string;
  text: string;
  author: string;
  authorRole: string;
  createdAt: string;
  /** Inline attachments. Empty array when the comment has no
   *  attachments — the dashboard's PinThread maps this to
   *  <img> tags (or audio/video elements when voice / video
   *  kinds ship). The shape is `FeedbackAttachment[]` so the
   *  client doesn't need to re-derive the URL. */
  attachments: FeedbackAttachment[];
};

/** A drawn annotation attached to a pin. The `path` is the parsed
 *  [[x,y], ...] array — the server stores it as a JSON string in
 *  `pathJson` and the ScreenshotView parses it on render. The type
 *  is `number[][]` (always a list of 2-element arrays) so the
 *  component code can just `path.map(p => p[0])` without a cast. */
export type FeedbackAnnotation = {
  id: string;
  kind: 'arrow' | 'box' | 'freehand';
  path: number[][];
  createdAt: string;
};

export type DeveloperContext = {
  pageUrl: string | null;
  route: string;
  viewport: { width: number; height: number; devicePixelRatio: number | null } | null;
  browser: string;
  platform: string;
  selectors: string[];
  elementSnippet: string | null;
  screenshot: { id: string; width: number; height: number; capturedAt: string };
  reviewRound: { id: string; number: number; name: string | null } | null;
};

export type IssueAssignee = { id: string; email: string };
export type IssueTag = { id: string; name: string; key: string };
export type IssueOptions = { assignees: IssueAssignee[]; tags: IssueTag[] };

export type Pin = {
  id: string;
  xPercent: number;
  yPercent: number;
  status: string;
  /** Internal agency workflow fields. Omitted from reviewer/public DTOs. */
  priority?: IssuePriority;
  assignee?: IssueAssignee | null;
  tags?: IssueTag[];
  elementXPath?: string | null;
  elementHTML?: string | null;
  developerContext?: DeveloperContext | null;
  createdAt: string;
  comments: FeedbackComment[];
  /** Drawn marks (arrows / boxes / freehand) attached to this pin. */
  annotations: FeedbackAnnotation[];
};

export type ScreenshotWithPins = {
  id: string;
  storageKey: string;
  pageId: string;
  width: number;
  height: number;
  capturedAt: string;
  pins: Pin[];
};

export type PageWithScreenshots = {
  id: string;
  path: string;
  screenshots: ScreenshotWithPins[];
};

export type ProjectWithPages = {
  id: string;
  name: string;
  domain: string;
  archivedAt?: string | null;
  /** Null when the RSC deliberately redacts secrets for anonymous callers. */
  apiKey: string | null;
  /**
   * The active share link token, if any. NULL = sharing is disabled
   * for this project. The dashboard's ShareToggle component reads
   * this to decide which state to render ("Generate" vs "Revoke").
   * The /api/projects route's `include` does NOT carry this field
   * (we never want to leak it via the public /api/projects listing
   * — but wait, /api/projects is dashboard-origin-gated, so it's
   * fine to include it). The actual JSON projection is controlled
   * by the route's `select` clause — see route.ts.
   */
  shareToken: string | null;
  /** Managed-link controls; password hashes never cross the server boundary. */
  shareExpiresAt?: string | null;
  sharePasswordProtected?: boolean;
  /** Whether this caller may manage keys, sharing, subscribers and integrations. */
  canAdmin: boolean;
  /** Precise team access used for clear client/guest review labels. */
  accessRole?: 'owner' | 'contributor' | 'client' | 'guest' | 'operator' | 'legacy-reviewer';
  /** Resolved, presentation-safe workspace identity for client/guest review. */
  reviewBranding?: {
    displayName: string;
    logoUrl: string | null;
    accentColor: string;
    accentText: string;
    welcome: string;
  };
  /** Owner/operator-only choices for assignment, tag editing and filters. */
  issueOptions?: IssueOptions;
  pages: PageWithScreenshots[];
};

/** Compact dashboard-card payload. It never contains capture or feedback bodies. */
export type ProjectSummary = {
  id: string;
  name: string;
  domain: string;
  archivedAt?: string | null;
  apiKey: string | null;
  shareToken: string | null;
  shareExpiresAt?: string | null;
  sharePasswordProtected?: boolean;
  canAdmin: boolean;
  teamId: string | null;
  team: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  totalPages: number;
  totalScreenshots: number;
  totalPins: number;
  openPins: number;
};
