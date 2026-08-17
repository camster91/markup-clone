import { describe, expect, it } from 'vitest';
import {
  returnDestinationLabel,
  safeReturnPath,
  signInRedirect,
} from '@/lib/sign-in-redirect';

describe('protected-page sign-in redirects', () => {
  it('accepts only the supported same-origin protected paths', () => {
    expect(safeReturnPath('/workspaces')).toBe('/workspaces');
    expect(safeReturnPath('/workspaces/workspace-1')).toBe('/workspaces/workspace-1');
    expect(safeReturnPath('/workspaces/workspace-1/teams/team-1')).toBe(
      '/workspaces/workspace-1/teams/team-1',
    );
    expect(safeReturnPath('/archive')).toBe('/archive');
  });

  it('rejects external, protocol-relative, malformed, and unrelated paths', () => {
    expect(safeReturnPath('https://evil.example')).toBeNull();
    expect(safeReturnPath('//evil.example')).toBeNull();
    expect(safeReturnPath('/workspaces/one/../../admin')).toBeNull();
    expect(safeReturnPath('/projects/private')).toBeNull();
    expect(safeReturnPath(undefined)).toBeNull();
  });

  it('encodes the safe return path and supplies a human destination label', () => {
    expect(signInRedirect('/archive')).toBe('/?next=%2Farchive#sign-in');
    expect(signInRedirect('https://evil.example')).toBe('/#sign-in');
    expect(returnDestinationLabel('/archive')).toBe('archived sites');
    expect(returnDestinationLabel('/workspaces/client-1')).toBe('agency workspaces');
  });
});
