import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('@ashbi/markup-sdk package contract', () => {
  it('is a publishable typed dependency-free 1.x package with deterministic build output', () => {
    const pkg = JSON.parse(readFileSync(resolve('packages/markup-sdk/package.json'), 'utf8'));
    expect(pkg).toMatchObject({
      name: '@ashbi/markup-sdk', version: '1.0.0', type: 'module', sideEffects: false,
      main: './dist/index.js', types: './dist/index.d.ts',
    });
    expect(pkg.private).not.toBe(true);
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.files).toContain('dist');
  });
});
