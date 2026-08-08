import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('production build warning contract', () => {
  it('does not ask Vite to read from the same public directory it writes', () => {
    const config = readFileSync(resolve('vite.config.ts'), 'utf8');
    expect(config).toContain('publicDir: false');
  });

  it.each([
    'src/app/api/attachments/[id]/route.ts',
    'src/app/api/screenshots/[id]/image/route.ts',
  ])('marks externally mounted runtime media reads as excluded from tracing in %s', (file) => {
    const source = readFileSync(resolve(file), 'utf8');
    expect(source.match(/\/\*\s*turbopackIgnore:\s*true\s*\*\//g)).toHaveLength(3);
  });
});
