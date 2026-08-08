import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('administrator API-key responsive contract', () => {
  it.each([
    ['project detail', 'src/components/ProjectDetail.tsx'],
    ['dashboard card', 'src/components/DashboardProjects.tsx'],
  ])('allows the long key to wrap inside the %s card', (_label, file) => {
    const source = readFileSync(file, 'utf8');
    const apiKeyCode = source.match(/<code className="([^"]*break-all[^"]*)">\{project\.apiKey\}<\/code>/);
    expect(apiKeyCode?.[1]).toContain('min-w-0');
    expect(apiKeyCode?.[1]).toContain('break-all');
  });
});
