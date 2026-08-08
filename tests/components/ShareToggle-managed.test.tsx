// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import {
  buildShareRequestBody,
  ShareToggle,
} from '@/components/ProjectSettings';

describe('managed public share controls', () => {
  it('renders labelled optional expiry and password controls before creation', () => {
    const html = renderToString(
      <ShareToggle
        projectId="project-1"
        hasShareToken={false}
        shareUrl={null}
        onChange={() => undefined}
      />
    );

    expect(html).toContain('Share link expiry');
    expect(html).toContain('Share link password');
    expect(html).toContain('type="datetime-local"');
    expect(html).toContain('type="password"');
    expect(html).toContain('8 characters minimum');
  });

  it('shows the active link security state without exposing a password hash', () => {
    const html = renderToString(
      <ShareToggle
        projectId="project-1"
        hasShareToken
        shareUrl="/share/token/open"
        shareExpiresAt="2026-08-15T12:00:00.000Z"
        sharePasswordProtected
        onChange={() => undefined}
      />
    );

    expect(html).toContain('Password protected');
    expect(html).toContain('Expires');
    expect(html).toContain('Replace link');
    expect(html).not.toContain('scrypt');
  });

  it('serializes local form values into the API contract', () => {
    const localExpiry = '2026-08-15T12:00';
    expect(buildShareRequestBody('', '')).toEqual({ expiresAt: null, password: null });
    expect(buildShareRequestBody(localExpiry, 'Client review 2026')).toEqual({
      expiresAt: new Date(localExpiry).toISOString(),
      password: 'Client review 2026',
    });
  });
});
