import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import DemoPage from '@/app/demo/page';

describe('public product demo', () => {
  it('renders a public read-only demo shell with access and sign-in paths', () => {
    const element = DemoPage();
    const seen = new WeakSet<object>();
    const payload = JSON.stringify(element, (_key, value) => {
      if (typeof value === 'function') return '[fn]';
      if (value && typeof value === 'object') {
        if (seen.has(value)) return '[cycle]';
        seen.add(value);
      }
      return value;
    });
    expect(payload).toContain('See the feedback loop before joining it.');
    expect(payload).toContain('This sample never writes to the live service.');
    expect(payload).toContain('Request access');
    expect(payload).toContain('/#sign-in');
  });

  it('keeps the interactive fixture local and free of API writes', () => {
    const source = readFileSync(
      resolve(__dirname, '../../src/components/DemoReview.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/\/api\//);
    expect(source).toContain("useState(1)");
    expect(source).toContain('aria-pressed');
  });
});
