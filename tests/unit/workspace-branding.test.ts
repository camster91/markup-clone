import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  validateBrandAccentColor,
  validateBrandLogoUrl,
  validateBrandName,
  validateReviewerWelcome,
} from '@/lib/validation';
import { resolveWorkspaceBranding } from '@/lib/branding';

describe('workspace branding schema', () => {
  it('adds optional, constrained branding fields without destructive SQL', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8');
    const sql = readFileSync(
      'prisma/migrations/20260808083000_add_workspace_branding/migration.sql',
      'utf8',
    );
    for (const field of ['brandName', 'logoUrl', 'accentColor', 'reviewerWelcome']) {
      expect(schema).toMatch(new RegExp(`\\b${field}\\s+String\\?`));
      expect(sql).toContain(`ADD COLUMN "${field}" TEXT`);
    }
    expect(sql).toContain('Workspace_accentColor_check');
    expect(sql).toContain('Workspace_logoUrl_check');
    expect(sql).not.toMatch(/\b(DROP|DELETE|TRUNCATE)\b/i);
  });
});

describe('workspace branding validation', () => {
  it('normalizes safe names, accents, HTTPS logos, and welcome copy', () => {
    expect(validateBrandName('  Northstar Studio  ')).toEqual({ ok: true, value: 'Northstar Studio' });
    expect(validateBrandAccentColor(' #4F46E5 ')).toEqual({ ok: true, value: '#4f46e5' });
    expect(validateBrandLogoUrl('https://cdn.example.com/agency-logo.png')).toEqual({
      ok: true, value: 'https://cdn.example.com/agency-logo.png',
    });
    expect(validateReviewerWelcome('  Review the latest build with us.  ')).toEqual({
      ok: true, value: 'Review the latest build with us.',
    });
  });

  it('accepts null to clear optional branding', () => {
    expect(validateBrandName(null)).toEqual({ ok: true, value: null });
    expect(validateBrandLogoUrl('')).toEqual({ ok: true, value: null });
    expect(validateBrandAccentColor(null)).toEqual({ ok: true, value: null });
    expect(validateReviewerWelcome('   ')).toEqual({ ok: true, value: null });
  });

  it('rejects executable or unbounded branding values', () => {
    expect(validateBrandLogoUrl('http://cdn.example.com/logo.png').ok).toBe(false);
    expect(validateBrandLogoUrl('data:image/svg+xml,<svg onload=alert(1)>').ok).toBe(false);
    expect(validateBrandLogoUrl('https://user:secret@cdn.example.com/logo.png').ok).toBe(false);
    expect(validateBrandAccentColor('red').ok).toBe(false);
    expect(validateBrandAccentColor('#fff').ok).toBe(false);
    expect(validateBrandName('a'.repeat(121)).ok).toBe(false);
    expect(validateReviewerWelcome('a'.repeat(281)).ok).toBe(false);
  });
});

describe('workspace branding presentation', () => {
  it('chooses readable text and safe fallbacks for stored branding', () => {
    expect(resolveWorkspaceBranding({ name: 'Agency', brandName: 'Studio', logoUrl: null, accentColor: '#facc15', reviewerWelcome: null }))
      .toMatchObject({ displayName: 'Studio', accentColor: '#facc15', accentText: '#111827' });
    expect(resolveWorkspaceBranding({ name: 'Agency', brandName: null, logoUrl: null, accentColor: '#4f46e5', reviewerWelcome: null }))
      .toMatchObject({ displayName: 'Agency', accentText: '#ffffff' });
    expect(resolveWorkspaceBranding({ name: 'Agency', brandName: null, logoUrl: null, accentColor: 'red', reviewerWelcome: null }))
      .toMatchObject({ accentColor: '#2563eb', accentText: '#ffffff' });
  });
});
