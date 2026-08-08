import { describe, expect, it } from 'vitest';
import {
  decryptIntegrationCredential,
  encryptIntegrationCredential,
  loadIntegrationEncryptionKey,
} from '@/lib/integrations/credential-crypto';

const key = Buffer.alloc(32, 7);
const otherKey = Buffer.alloc(32, 9);

describe('integration credential encryption', () => {
  it('round-trips a credential through an authenticated versioned envelope', () => {
    const encrypted = encryptIntegrationCredential('github_pat_private', key);

    expect(encrypted).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(encrypted).not.toContain('github_pat_private');
    expect(decryptIntegrationCredential(encrypted, key)).toBe('github_pat_private');
  });

  it('uses a fresh nonce for the same credential', () => {
    expect(encryptIntegrationCredential('same-token', key))
      .not.toBe(encryptIntegrationCredential('same-token', key));
  });

  it('rejects the wrong key and tampered ciphertext', () => {
    const encrypted = encryptIntegrationCredential('github_pat_private', key);

    expect(() => decryptIntegrationCredential(encrypted, otherKey))
      .toThrow('Integration credential could not be decrypted');
    expect(() => decryptIntegrationCredential(`${encrypted}x`, key))
      .toThrow('Integration credential could not be decrypted');
  });

  it('loads only an exact 32-byte base64url server key', () => {
    const encoded = key.toString('base64url');
    expect(loadIntegrationEncryptionKey({ INTEGRATION_ENCRYPTION_KEY: encoded }))
      .toEqual(key);
    expect(() => loadIntegrationEncryptionKey({})).toThrow('INTEGRATION_ENCRYPTION_KEY is not configured');
    expect(() => loadIntegrationEncryptionKey({ INTEGRATION_ENCRYPTION_KEY: 'short' }))
      .toThrow('INTEGRATION_ENCRYPTION_KEY must be a 32-byte base64url value');
  });
});
