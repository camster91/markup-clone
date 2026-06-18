// Shared types for the dashboard components.
// Mirror the Prisma schema so we don't have to import @prisma/client in client components.
// Names use the "Feedback" prefix to avoid collisions with browser globals (e.g. DOM `Comment`).

/** A file attached to a Comment. The first surface is images
 *  pasted from the dashboard reviewer's clipboard; the schema
 *  reserves `kind: 'image' | 'voice' | 'video'` so voice / video
 *  replies can be added without a type change. The `url` is a
 *  RELATIVE path — the GET /api/attachments/[id] route accepts
 *  it from the dashboard origin (no extra token needed) and
 *  from a `?share=<token>` URL when embedded in the public
 *  share view. The dashboard's PinThread renders <img> tags
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

export type Pin = {
  id: string;
  xPercent: number;
  yPercent: number;
  status: string;
  elementXPath?: string | null;
  elementHTML?: string | null;
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
