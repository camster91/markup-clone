import { describe, expect, it } from 'vitest';
import { INTEGRATION_KINDS } from '@/lib/integrations/types';
import { validateConfig, validateStoredConfig } from '@/lib/integrations/validate';

describe('GitHub integration configuration', () => {
  it('is part of the closed integration kind set', () => {
    expect(INTEGRATION_KINDS).toContain('github');
  });

  it('normalizes an explicit repository, bounded labels, and credential', () => {
    expect(validateConfig('github', {
      owner: ' Ashbi-Agency ',
      repo: ' client-site ',
      labels: [' visual-feedback ', 'Bug', 'bug'],
      token: 'github_pat_abcdefghijklmnopqrstuvwxyz',
    })).toEqual({
      ok: true,
      value: {
        owner: 'Ashbi-Agency',
        repo: 'client-site',
        labels: ['visual-feedback', 'Bug'],
        token: 'github_pat_abcdefghijklmnopqrstuvwxyz',
      },
    });
  });

  it.each([
    [{ owner: 'a/b', repo: 'site', token: 'github_pat_abcdefghijklmnopqrstuvwxyz' }, 'github owner'],
    [{ owner: 'ashbi', repo: '..', token: 'github_pat_abcdefghijklmnopqrstuvwxyz' }, 'github repo'],
    [{ owner: 'ashbi', repo: 'site', token: 'short' }, 'github token'],
    [{ owner: 'ashbi', repo: 'site', token: 'github_pat_abcdefghijklmnopqrstuvwxyz', labels: Array(11).fill('bug') }, 'github labels'],
  ])('rejects unsafe or unbounded input %#', (config, message) => {
    const result = validateConfig('github', config);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });

  it('accepts only secret-free GitHub configuration from storage', () => {
    expect(validateStoredConfig('github', {
      owner: 'ashbi', repo: 'client-site', labels: ['visual-feedback'],
    })).toEqual({
      ok: true,
      value: { owner: 'ashbi', repo: 'client-site', labels: ['visual-feedback'] },
    });

    const leaked = validateStoredConfig('github', {
      owner: 'ashbi', repo: 'client-site', labels: [], token: 'github_pat_abcdefghijklmnopqrstuvwxyz',
    });
    expect(leaked.ok).toBe(false);
  });
});
