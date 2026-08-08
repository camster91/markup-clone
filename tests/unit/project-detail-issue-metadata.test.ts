import { describe, expect, it } from 'vitest';
import { serializeProjectDetail } from '@/lib/project-detail-dto';

const project = {
  id: 'project-1', name: 'Acme', domain: 'example.com', apiKey: 'mk_secret', shareToken: null,
  subscribers: [],
  tags: [
    { id: 'tag-2', name: 'QA', key: 'qa' },
    { id: 'tag-1', name: 'Front End', key: 'front end' },
  ],
  team: {
    members: [
      { user: { id: 'user-2', email: 'zoe@example.com' } },
      { user: { id: 'user-1', email: 'alex@example.com' } },
      { user: { id: 'user-1', email: 'alex@example.com' } },
    ],
  },
  pages: [{
    id: 'page-1', path: '/',
    screenshots: [{
      id: 'shot-1', pageId: 'page-1', storageKey: 'shot.png', width: 1440, height: 900,
      capturedAt: new Date('2026-08-08T00:00:00Z'),
      pins: [{
        id: 'pin-1', xPercent: 25, yPercent: 30, status: 'OPEN', priority: 'URGENT',
        assignee: { id: 'user-1', email: 'alex@example.com' },
        tags: [{ tag: { id: 'tag-1', name: 'Front End', key: 'front end' } }],
        elementXPath: null, elementHTML: null, pageUrl: null, viewportWidth: null,
        viewportHeight: null, devicePixelRatio: null, userAgent: null, platform: null,
        selectorCandidatesJson: null, reviewRound: null,
        createdAt: new Date('2026-08-08T00:01:00Z'), comments: [], annotations: [],
      }],
    }],
  }],
} as any;

describe('project detail internal issue metadata DTO', () => {
  it('gives administrators safe pin metadata and reusable filter options', () => {
    const result = serializeProjectDetail(project, true);
    const pin = result.pages[0].screenshots[0].pins[0];

    expect(pin).toMatchObject({
      priority: 'URGENT',
      assignee: { id: 'user-1', email: 'alex@example.com' },
      tags: [{ id: 'tag-1', name: 'Front End', key: 'front end' }],
    });
    expect(result.issueOptions).toEqual({
      assignees: [
        { id: 'user-1', email: 'alex@example.com' },
        { id: 'user-2', email: 'zoe@example.com' },
      ],
      tags: [
        { id: 'tag-1', name: 'Front End', key: 'front end' },
        { id: 'tag-2', name: 'QA', key: 'qa' },
      ],
    });
  });

  it('omits internal workflow data from reviewer payloads', () => {
    const result = serializeProjectDetail(project, false);
    const payload = JSON.stringify(result);

    expect(result).not.toHaveProperty('issueOptions');
    expect(result.pages[0].screenshots[0].pins[0]).not.toHaveProperty('priority');
    expect(result.pages[0].screenshots[0].pins[0]).not.toHaveProperty('assignee');
    expect(result.pages[0].screenshots[0].pins[0]).not.toHaveProperty('tags');
    expect(payload).not.toContain('alex@example.com');
    expect(payload).not.toContain('Front End');
    expect(payload).not.toContain('URGENT');
  });

  it('defaults legacy admin rows to no priority and no assignment or tags', () => {
    const legacy = structuredClone(project);
    delete legacy.pages[0].screenshots[0].pins[0].priority;
    delete legacy.pages[0].screenshots[0].pins[0].assignee;
    delete legacy.pages[0].screenshots[0].pins[0].tags;

    expect(serializeProjectDetail(legacy, true).pages[0].screenshots[0].pins[0]).toMatchObject({
      priority: 'NONE', assignee: null, tags: [],
    });
  });
});
