import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('supported developer contract documentation', () => {
  it('checks in an OpenAPI 3.1 read-only issue contract with bearer auth and pagination', () => {
    const spec = readFileSync(resolve('docs/api/openapi-v1.yaml'), 'utf8');
    expect(spec).toContain('openapi: 3.1.0');
    expect(spec).toContain('/api/v1/projects/{projectId}/issues:');
    expect(spec).toContain('type: http');
    expect(spec).toContain('scheme: bearer');
    expect(spec).toContain('nextCursor');
    expect(spec).toContain('visual-feedback.issue.v1');
    expect(spec).not.toMatch(/^\s+(post|put|patch|delete):/m);
  });

  it('documents credential separation, rotation, CSP, SPA cleanup, and no npm publish claim', () => {
    const api = readFileSync(resolve('docs/developer-api-v1.md'), 'utf8');
    const sdk = readFileSync(resolve('packages/markup-sdk/README.md'), 'utf8');
    expect(api).toMatch(/widget key[\s\S]*must not[\s\S]*read/i);
    expect(api).toMatch(/shown once/i);
    expect(api).toMatch(/revoke/i);
    expect(sdk).toContain('script-src');
    expect(sdk).toContain('connect-src');
    expect(sdk).toContain('destroy()');
    expect(sdk).toMatch(/not yet published/i);
  });
});
