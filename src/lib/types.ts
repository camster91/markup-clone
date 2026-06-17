// Shared types for the dashboard components.
// Mirror the Prisma schema so we don't have to import @prisma/client in client components.
// Names use the "Feedback" prefix to avoid collisions with browser globals (e.g. DOM `Comment`).

export type FeedbackComment = {
  id: string;
  text: string;
  author: string;
  authorRole: string;
  createdAt: string;
};

export type Pin = {
  id: string;
  xPercent: number;
  yPercent: number;
  status: string;
  elementXPath?: string | null;
  elementHTML?: string | null;
  createdAt: string;
  comments: FeedbackComment[];
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
  apiKey: string;
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
  pages: PageWithScreenshots[];
};
