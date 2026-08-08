import { describe, expect, it } from 'vitest';
import { buildIssueHandoffV1, renderIssueHandoffMarkdown } from '@/lib/issue-handoff';
import type { Pin } from '@/lib/types';

const pin: Pin = {
  id: 'pin-123',
  xPercent: 68.25,
  yPercent: 58.5,
  status: 'OPEN',
  priority: 'HIGH',
  assignee: { id: 'user-1', email: 'dev@example.com' },
  tags: [
    { id: 'tag-1', name: 'Front End', key: 'front end' },
    { id: 'tag-2', name: 'QA', key: 'qa' },
  ],
  createdAt: '2026-08-07T12:01:00.000Z',
  developerContext: {
    pageUrl: 'https://example.com/pricing',
    route: '/pricing',
    viewport: { width: 1440, height: 900, devicePixelRatio: 2 },
    browser: 'Chrome 126',
    platform: 'Windows',
    selectors: ['#pricing-cta', '[data-testid="pricing-cta"]'],
    elementSnippet: '<button>Start ``` project</button>',
    screenshot: { id: 'shot-1', width: 800, height: 600, capturedAt: '2026-08-07T12:00:00.000Z' },
    reviewRound: { id: 'round-1', number: 2, name: 'Launch review' },
  },
  comments: [{
    id: 'comment-1',
    text: '# Align the CTA\n<script>alert(1)</script> [unsafe](javascript:alert(1))',
    author: 'Client <Admin>',
    authorRole: 'client',
    createdAt: '2026-08-07T12:02:00.000Z',
    attachments: [{ id: 'attachment-1', kind: 'image', mimeType: 'image/png', size: 1234, url: '/api/attachments/attachment-1?share=secret' }],
  }],
  annotations: [],
};

const input = {
  dashboardOrigin: 'https://user:password@review.example.test/base?token=secret#fragment',
  project: { id: 'project-1', name: 'Acme Agency Site', domain: 'example.com' },
  pagePath: '/pricing',
  screenshot: { id: 'shot-1', width: 800, height: 600, capturedAt: '2026-08-07T12:00:00.000Z' },
  pin,
};

describe('versioned issue handoff', () => {
  it('builds a stable privacy-bounded v1 payload and exact-pin review URL', () => {
    const payload = buildIssueHandoffV1(input);
    expect(payload).toEqual(expect.objectContaining({
      schema: 'visual-feedback.issue.v1',
      title: '# Align the CTA <script>alert(1)</script> [unsafe](javascript:alert(1))',
      pin: {
        id: 'pin-123', status: 'OPEN', createdAt: '2026-08-07T12:01:00.000Z',
        coordinates: { xPercent: 68.25, yPercent: 58.5 },
      },
      project: { id: 'project-1', name: 'Acme Agency Site', domain: 'example.com' },
      page: { path: '/pricing', url: 'https://example.com/pricing' },
      reviewUrl: 'https://review.example.test/projects/project-1?pin=pin-123',
      screenshot: input.screenshot,
      reviewRound: { id: 'round-1', number: 2, name: 'Launch review' },
      environment: { viewport: { width: 1440, height: 900, devicePixelRatio: 2 }, browser: 'Chrome 126', platform: 'Windows' },
      selectors: ['#pricing-cta', '[data-testid="pricing-cta"]'],
      elementSnippet: '<button>Start ``` project</button>',
      internal: {
        priority: 'HIGH',
        assignee: { id: 'user-1', email: 'dev@example.com' },
        tags: [
          { id: 'tag-1', name: 'Front End', key: 'front end' },
          { id: 'tag-2', name: 'QA', key: 'qa' },
        ],
      },
      commentCount: 1,
      commentsTruncated: false,
    }));
    expect(payload.comments[0].attachments).toEqual([{ kind: 'image', mimeType: 'image/png', size: 1234 }]);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('token=secret');
    expect(serialized).not.toContain('share=secret');
    expect(serialized).not.toContain('/api/attachments/');
  });

  it('keeps legacy pins useful without inventing technical context', () => {
    const payload = buildIssueHandoffV1({
      ...input,
      pin: { ...pin, developerContext: null, comments: [] },
    });
    expect(payload.title).toBe('Feedback pin pin-123');
    expect(payload.page).toEqual({ path: '/pricing', url: null });
    expect(payload.environment).toBeNull();
    expect(payload.reviewRound).toBeNull();
    expect(payload.selectors).toEqual([]);
    expect(payload.elementSnippet).toBeNull();
    expect(payload.screenshot).toEqual(input.screenshot);
  });

  it('renders deterministic Markdown without allowing prose or code-fence injection', () => {
    const payload = buildIssueHandoffV1(input);
    const first = renderIssueHandoffMarkdown(payload);
    const second = renderIssueHandoffMarkdown(payload);
    expect(first).toBe(second);
    expect(first).toContain('# \\# Align the CTA &lt;script&gt;alert\\(1\\)&lt;/script&gt; \\[unsafe\\]\\(javascript:alert\\(1\\)\\)');
    expect(first).toContain('Schema: `visual-feedback.issue.v1`');
    expect(first).toContain('## Internal workflow');
    expect(first).toContain('- Priority: **HIGH**');
    expect(first).toContain('- Assignee: dev@example.com');
    expect(first).toContain('- Tags: Front End, QA');
    expect(first).toContain('[Open the exact feedback pin](https://review.example.test/projects/project-1?pin=pin-123)');
    expect(first).toContain('````html\n<button>Start ``` project</button>\n````');
    expect(first).not.toContain('<script>');
    expect(first).not.toContain('\n# Align the CTA\n');
  });

  it('rejects non-HTTP dashboard origins', () => {
    expect(() => buildIssueHandoffV1({ ...input, dashboardOrigin: 'javascript:alert(1)' }))
      .toThrow('dashboardOrigin must use http or https');
  });

  it('re-canonicalizes and bounds technical fields at the handoff boundary', () => {
    const context = pin.developerContext!;
    const payload = buildIssueHandoffV1({
      ...input,
      pin: {
        ...pin,
        developerContext: {
          ...context,
          pageUrl: 'https://user:password@example.com/pricing?token=secret#private',
          browser: `Chrome ${'x'.repeat(300)}`,
          platform: `Windows ${'y'.repeat(300)}`,
          selectors: ['#safe', '#safe', 'z'.repeat(800), '#four', '#five', '#six', '#seven'],
          elementSnippet: 'e'.repeat(5000),
        },
      },
    });

    expect(payload.page.url).toBe('https://example.com/pricing');
    expect(payload.environment?.browser.length).toBeLessThanOrEqual(128);
    expect(payload.environment?.platform.length).toBeLessThanOrEqual(128);
    expect(payload.selectors).toHaveLength(5);
    expect(new Set(payload.selectors).size).toBe(payload.selectors.length);
    expect(Math.max(...payload.selectors.map((selector) => selector.length))).toBeLessThanOrEqual(500);
    expect(payload.elementSnippet).toHaveLength(4000);

    const crossDomain = buildIssueHandoffV1({
      ...input,
      pin: { ...pin, developerContext: { ...context, pageUrl: 'https://evil.example/steal?token=secret' } },
    });
    expect(crossDomain.page.url).toBeNull();
  });

  it('preserves ordinary sentence punctuation in copied feedback', () => {
    const payload = buildIssueHandoffV1({
      ...input,
      pin: {
        ...pin,
        comments: [{ ...pin.comments[0], text: 'Please align this CTA with the pricing copy.' }],
      },
    });
    const markdown = renderIssueHandoffMarkdown(payload);
    expect(markdown).toContain('Please align this CTA with the pricing copy.');
    expect(markdown).not.toContain('pricing copy\\.');
  });

  it('keeps the v1 contract useful for legacy pins without inventing internal fields', () => {
    const payload = buildIssueHandoffV1({
      ...input,
      pin: { ...pin, priority: undefined, assignee: undefined, tags: undefined },
    });
    expect(payload.schema).toBe('visual-feedback.issue.v1');
    expect(payload.internal).toEqual({ priority: 'NONE', assignee: null, tags: [] });
  });
});
