import crypto from 'node:crypto';

const VERSION = 'v1';
const AAD = Buffer.from('visual-feedback.integration-credential.v1', 'utf8');

export function loadIntegrationEncryptionKey(
  env: Record<string, string | undefined> = process.env,
): Buffer {
  const raw = env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw) throw new Error('INTEGRATION_ENCRYPTION_KEY is not configured');
  if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY must be a 32-byte base64url value');
  }
  const key = Buffer.from(raw, 'base64url');
  if (key.length !== 32 || key.toString('base64url') !== raw) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY must be a 32-byte base64url value');
  }
  return key;
}

export function encryptIntegrationCredential(plaintext: string, key: Buffer): string {
  if (key.length !== 32) throw new Error('Integration encryption key must be 32 bytes');
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, nonce.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptIntegrationCredential(envelope: string, key: Buffer): string {
  try {
    if (key.length !== 32) throw new Error('invalid key');
    const [version, nonceRaw, tagRaw, ciphertextRaw, extra] = envelope.split('.');
    if (version !== VERSION || !nonceRaw || !tagRaw || !ciphertextRaw || extra !== undefined) {
      throw new Error('invalid envelope');
    }
    const nonce = Buffer.from(nonceRaw, 'base64url');
    const tag = Buffer.from(tagRaw, 'base64url');
    const ciphertext = Buffer.from(ciphertextRaw, 'base64url');
    if (
      nonce.length !== 12 || tag.length !== 16 || ciphertext.length === 0 ||
      nonce.toString('base64url') !== nonceRaw ||
      tag.toString('base64url') !== tagRaw ||
      ciphertext.toString('base64url') !== ciphertextRaw
    ) {
      throw new Error('invalid envelope');
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Integration credential could not be decrypted');
  }
}
