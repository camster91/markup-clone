import { describe, expect, it, vi } from 'vitest';
import { loadProjectSummaryCounts } from '@/lib/project-summary-counts';

describe('project summary counts', () => {
  it('does not query the database for an empty authorized project set', async () => {
    const queryRaw = vi.fn(async () => []);

    await expect(loadProjectSummaryCounts([], {
      $queryRaw: queryRaw,
    } as never)).resolves.toEqual(new Map());
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
