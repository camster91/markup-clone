// Integration tests for the /projects/[id] RSC page (the per-project
// detail view that backs the dashboard's "split into per-project
// pages" refactor).
//
// Coverage:
//   - Renders the project header / pages / screenshots / pins
//     when the project exists.
//   - Calls Next.js's notFound() (and throws the marker error)
//     when the project is missing.
//   - Threads the right include shape into prisma.project.findUnique
//     (pages → screenshots → pins → comments + annotations), so
//     the per-project page keeps working if the include path
//     drifts in a future refactor.
//   - The serialized tree handed to <ProjectDetail> is in the
//     ProjectWithPages shape: Date fields are ISO strings, and
//     annotation.pathJson is parsed into a number[][] `path`.
//   - The back-link to "/" is present in the rendered output.
//
// The page is a React Server Component. We invoke it as a plain
// async function (RSCs are just async functions that return JSX),
// and assert on the serialized JSX shape — same pattern as
// tests/integration/share.test.ts.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  project: {
    findUnique: vi.fn(),
  },
  // The page calls getCallerUser() to look up the caller's session
  // before checking team membership. The mock returns null (no
  // session), which the page treats as "no caller" — projects with
  // teamId = NULL remain accessible (the legacy / unscoped branch).
  // Tests that exercise the team-scope gate override the session
  // mock per-test.
  session: {
    findUnique: vi.fn().mockResolvedValue(null),
  },
  // Team membership lookup. Default: no membership (every team
  // membership check returns null). Tests that exercise the
  // team-scope gate override per-test.
  teamMember: {
    findFirst: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: mocks,
}));

// next/navigation's notFound() throws a special error. We catch
// and re-throw a sentinel so the test can assert on it without
// importing the next-internal symbol. The real App Router
// catches NEXT_HTTP_ERROR_FALLBACK;404 and renders
// not-found.tsx; we just throw a plain Error with a marker.
const notFoundCalls: unknown[] = [];
vi.mock('next/navigation', () => ({
  notFound: () => {
    notFoundCalls.push(true);
    const err = new Error('NEXT_NOT_FOUND');
    (err as Error & { __notFound: boolean }).__notFound = true;
    throw err;
  },
}));

import ProjectDetailPage from '../../src/app/projects/[id]/page';

// Replacer that walks past the circular `default` self-reference
// Next 16 puts on client-component module records. JSON.stringify
// of a React element tree that mounts a client component trips
// over that cycle; replacing it with a marker lets the rest of
// the tree serialize.
function getCircularReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>();
  return (_key, value) => {
    if (typeof value === 'function') {
      // Don't recurse into function values; replace with a stable
      // marker so the assertion can still detect a function
      // reference if it ever matters.
      return '[fn]';
    }
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[cycle]';
      seen.add(value);
    }
    return value;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  notFoundCalls.length = 0;
  // The page calls project.findUnique TWICE: once for the
  // { id, teamId } meta (the team-scope gate) and once for the
  // full tree (the actual render). The second call uses a wide
  // `include` shape; the first uses a narrow `select`. We
  // dispatch on the call args: the call with a `select: { id,
  // teamId }` shape returns the meta row, the call with an
  // `include` returns the full tree. Tests that want a custom
  // meta (e.g. teamId = 'team-1') override the implementation.
  mocks.project.findUnique.mockImplementation(async (args: any) => {
    if (args && args.select && Object.keys(args.select).sort().join(',') === 'id,teamId') {
      return { id: args.where.id, teamId: null };
    }
    return null;
  });
  mocks.session.findUnique.mockResolvedValue(null);
  mocks.teamMember.findFirst.mockResolvedValue(null);
});

// Helper: configure the full-tree findUnique to return the given
// project tree. The page makes two findUnique calls (meta + tree);
// the meta call is already wired to return a `teamId: null` row by
// the beforeEach. Tests that need a non-null teamId override the
// implementation per-test.
function setFullTree(tree: unknown) {
  const original = mocks.project.findUnique.getMockImplementation();
  mocks.project.findUnique.mockImplementation(async (args: any) => {
    if (args && args.select && Object.keys(args.select).sort().join(',') === 'id,teamId') {
      return { id: args.where.id, teamId: null };
    }
    return tree;
  });
  // Preserve a reference so a test can introspect if it wants to
  void original;
}

describe('GET /projects/[id] — per-project detail page', () => {
  it('renders the project header / pages / screenshots / pins when the project exists', async () => {
    setFullTree({
      id: 'proj-1',
      name: 'Acme Redesign',
      domain: 'acme.com',
      apiKey: 'mk_abc',
      shareToken: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      pages: [
        {
          id: 'page-1',
          projectId: 'proj-1',
          path: '/',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          screenshots: [
            {
              id: 'shot-1',
              pageId: 'page-1',
              storageKey: 'a.png',
              width: 1024,
              height: 768,
              capturedAt: new Date('2026-01-02T00:00:00Z'),
              pins: [
                {
                  id: 'pin-1',
                  screenshotId: 'shot-1',
                  xPercent: 50,
                  yPercent: 50,
                  elementXPath: null,
                  elementHTML: null,
                  authorName: 'Client',
                  status: 'OPEN',
                  createdAt: new Date('2026-01-02T00:00:00Z'),
                  updatedAt: new Date('2026-01-02T00:00:00Z'),
                  comments: [
                    {
                      id: 'cmt-1',
                      pinId: 'pin-1',
                      author: 'Client',
                      authorRole: 'client',
                      text: 'Move the button left',
                      createdAt: new Date('2026-01-02T00:00:00Z'),
                      updatedAt: new Date('2026-01-02T00:00:00Z'),
                    },
                  ],
                  annotations: [
                    {
                      id: 'anno-1',
                      pinId: 'pin-1',
                      kind: 'arrow',
                      pathJson: '[[10,20],[30,40]]',
                      createdAt: new Date('2026-01-02T00:00:00Z'),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const element = await ProjectDetailPage({ params: Promise.resolve({ id: 'proj-1' }) });
    // The page returns a React element tree. The first child is
    // the <div> wrapper, which contains a <header> (back-link +
    // project name) and a <ProjectDetail initialProject={...} />
    // child. We assert on the serialized ProjectDetail props so
    // the test doesn't have to chase a circular `$$typeof` ref
    // (client components in Next 16 carry a self-referential
    // `default` field that breaks JSON.stringify).
    const elementJson = JSON.stringify(element, getCircularReplacer());
    // The header carries the project name and a back-link to "/".
    expect(elementJson).toContain('Acme Redesign');
    expect(elementJson).toContain('acme.com');
    expect(elementJson).toContain('"href":"/"');
    // The serialized initialProject on <ProjectDetail> carries
    // the page path, pin data, and the parsed annotation path.
    expect(elementJson).toContain('"path":"/"');
    expect(elementJson).toContain('Move the button left');
    expect(elementJson).toContain('"id":"anno-1"');
    expect(elementJson).toContain('[[10,20],[30,40]]');
    // notFound() must NOT have been called.
    expect(notFoundCalls).toHaveLength(0);
  });

  it('returns 404 (notFound) when the project does not exist', async () => {
    mocks.project.findUnique.mockResolvedValue(null);
    let threw = false;
    try {
      await ProjectDetailPage({ params: Promise.resolve({ id: 'proj-missing' }) });
    } catch (e) {
      threw = true;
      expect((e as Error & { __notFound?: boolean }).__notFound).toBe(true);
    }
    expect(threw).toBe(true);
    expect(notFoundCalls).toHaveLength(1);
  });

  it('threads the right include shape into prisma.project.findUnique', async () => {
    // Regression: if a future refactor drops the `include` chain
    // (pages → screenshots → pins → comments/annotations), the
    // per-project page would render with empty page/screenshot
    // lists, masking the bug behind a misleading "no pages
    // captured yet" message. Pin the include shape so a refactor
    // can't drift silently.
    setFullTree({
      id: 'proj-1',
      name: 'T',
      domain: 't.com',
      apiKey: 'k',
      shareToken: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      pages: [],
    });
    await ProjectDetailPage({ params: Promise.resolve({ id: 'proj-1' }) });
    expect(mocks.project.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'proj-1' },
        include: expect.objectContaining({
          pages: expect.objectContaining({
            include: expect.objectContaining({
              screenshots: expect.objectContaining({
                include: expect.objectContaining({
                  pins: expect.objectContaining({
                    include: expect.objectContaining({
                      comments: expect.anything(),
                      annotations: expect.anything(),
                    }),
                  }),
                }),
              }),
            }),
          }),
          subscribers: true,
        }),
      })
    );
  });

  it('parses annotation pathJson into a number[][] path on the serialized tree', async () => {
    setFullTree({
      id: 'proj-1',
      name: 'T',
      domain: 't.com',
      apiKey: 'k',
      shareToken: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      pages: [
        {
          id: 'page-1',
          projectId: 'proj-1',
          path: '/',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          screenshots: [
            {
              id: 'shot-1',
              pageId: 'page-1',
              storageKey: 'a.png',
              width: 100,
              height: 100,
              capturedAt: new Date('2026-01-02T00:00:00Z'),
              pins: [
                {
                  id: 'pin-1',
                  screenshotId: 'shot-1',
                  xPercent: 50,
                  yPercent: 50,
                  elementXPath: null,
                  elementHTML: null,
                  authorName: 'Client',
                  status: 'OPEN',
                  createdAt: new Date('2026-01-02T00:00:00Z'),
                  updatedAt: new Date('2026-01-02T00:00:00Z'),
                  comments: [],
                  annotations: [
                    {
                      id: 'anno-1',
                      pinId: 'pin-1',
                      kind: 'arrow',
                      pathJson: '[[10,20],[30,40]]',
                      createdAt: new Date('2026-01-02T00:00:00Z'),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const element = await ProjectDetailPage({ params: Promise.resolve({ id: 'proj-1' }) });
    // The serialized JSX carries the annotation as a JSON-encoded
    // prop on the <ProjectDetail> element. pathJson is a string
    // in the DB; the page MUST have parsed it into a number[][]
    // before handing the tree to the client. We assert on the
    // exact shape: `[[10,20],[30,40]]` in the rendered output.
    const html = JSON.stringify(element, getCircularReplacer());
    expect(html).toContain('[[10,20],[30,40]]');
    // The raw pathJson string must NOT survive serialization —
    // the client FeedbackAnnotation type declares `path` as a
    // parsed number[][], so the page is the conversion boundary.
    expect(html).not.toContain('"pathJson":"[[10,20],[30,40]]"');
  });

  it('falls back to an empty annotation path on malformed pathJson (defense in depth)', async () => {
    // A hand-crafted DB row with garbage in pathJson would have
    // been rejected at write time by the POST /api/annotations
    // validator, but the page is the last line of defense: a
    // bad parse must not throw — it must render with an empty
    // path so the ScreenshotView can still show the pin.
    setFullTree({
      id: 'proj-1',
      name: 'T',
      domain: 't.com',
      apiKey: 'k',
      shareToken: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      pages: [
        {
          id: 'page-1',
          projectId: 'proj-1',
          path: '/',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          screenshots: [
            {
              id: 'shot-1',
              pageId: 'page-1',
              storageKey: 'a.png',
              width: 100,
              height: 100,
              capturedAt: new Date('2026-01-02T00:00:00Z'),
              pins: [
                {
                  id: 'pin-1',
                  screenshotId: 'shot-1',
                  xPercent: 50,
                  yPercent: 50,
                  elementXPath: null,
                  elementHTML: null,
                  authorName: 'Client',
                  status: 'OPEN',
                  createdAt: new Date('2026-01-02T00:00:00Z'),
                  updatedAt: new Date('2026-01-02T00:00:00Z'),
                  comments: [],
                  annotations: [
                    {
                      id: 'anno-1',
                      pinId: 'pin-1',
                      kind: 'arrow',
                      pathJson: '{not valid json',
                      createdAt: new Date('2026-01-02T00:00:00Z'),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    // The page should render without throwing.
    const element = await ProjectDetailPage({ params: Promise.resolve({ id: 'proj-1' }) });
    const html = JSON.stringify(element, getCircularReplacer());
    // The annotation id survives, the path is the empty array.
    expect(html).toContain('anno-1');
    expect(html).toContain('"path":[]');
  });
});
