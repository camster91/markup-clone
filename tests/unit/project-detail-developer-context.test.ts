import { describe, expect, it } from 'vitest';
import { serializeProjectDetail } from '@/lib/project-detail-dto';

const project = {
  id: 'project-1', name: 'Acme', domain: 'example.com', apiKey: 'mk_secret', shareToken: 'share-secret',
  subscribers: [],
  pages: [{
    id: 'page-1', path: '/pricing',
    screenshots: [{
      id: 'shot-1', pageId: 'page-1', storageKey: 'shot.png', width: 2880, height: 1800,
      capturedAt: new Date('2026-08-07T12:00:00Z'),
      pins: [{
        id: 'pin-1', xPercent: 50, yPercent: 50, status: 'OPEN',
        elementXPath: '#hero', elementHTML: '<button>Buy</button>',
        pageUrl: 'https://example.com/pricing', viewportWidth: 1440, viewportHeight: 900,
        devicePixelRatio: 2, userAgent: 'Mozilla/5.0 Chrome/126.0.0.0 Safari/537.36',
        platform: 'Win32', selectorCandidatesJson: JSON.stringify(['#hero', '[data-testid="hero"]']),
        reviewRound: { id: 'round-1', number: 2, name: 'Launch review' },
        createdAt: new Date('2026-08-07T12:01:00Z'), comments: [], annotations: [],
      }],
    }],
  }],
} as any;

describe('project detail developer context DTO', () => {
  it('gives administrators a normalized bounded packet', () => {
    const result = serializeProjectDetail(project, true);
    expect(result.pages[0].screenshots[0].pins[0].developerContext).toEqual({
      pageUrl: 'https://example.com/pricing',
      route: '/pricing',
      viewport: { width: 1440, height: 900, devicePixelRatio: 2 },
      browser: 'Chrome 126',
      platform: 'Windows',
      selectors: ['#hero', '[data-testid="hero"]'],
      elementSnippet: '<button>Buy</button>',
      screenshot: { id: 'shot-1', width: 2880, height: 1800, capturedAt: '2026-08-07T12:00:00.000Z' },
      reviewRound: { id: 'round-1', number: 2, name: 'Launch review' },
    });
  });

  it('redacts selector, element, browser, and environment context from reviewers', () => {
    const result = serializeProjectDetail(project, false);
    const pin = result.pages[0].screenshots[0].pins[0];
    expect(pin.developerContext).toBeNull();
    expect(pin.elementXPath).toBeNull();
    expect(pin.elementHTML).toBeNull();
    const payload = JSON.stringify(result);
    expect(payload).not.toContain('#hero');
    expect(payload).not.toContain('<button>');
    expect(payload).not.toContain('Chrome/126');
    expect(payload).not.toContain('Win32');
  });

  it('labels a legacy pin as having no captured packet', () => {
    const legacy = structuredClone(project);
    Object.assign(legacy.pages[0].screenshots[0].pins[0], {
      elementXPath: null, elementHTML: null, pageUrl: null, viewportWidth: null,
      viewportHeight: null, devicePixelRatio: null, userAgent: null, platform: null,
      selectorCandidatesJson: null, reviewRound: null,
    });
    expect(serializeProjectDetail(legacy, true).pages[0].screenshots[0].pins[0].developerContext).toBeNull();
  });
});
