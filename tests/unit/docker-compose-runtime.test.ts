import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('local Docker runtime contract', () => {
  it('binds Next.js to every container interface so its loopback healthcheck works', () => {
    const compose = readFileSync(resolve(process.cwd(), 'docker-compose.yml'), 'utf8');
    expect(compose).toMatch(/HOSTNAME:\s*0\.0\.0\.0/);
    expect(compose).toContain('http://127.0.0.1:3000/api/health');
  });
});
