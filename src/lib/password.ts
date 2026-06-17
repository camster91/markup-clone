// Password hashing helpers — node:crypto scrypt.
//
// We use scrypt (built into node:crypto, no new deps) instead of bcrypt
// or argon2. The hashing parameters are chosen to be slow enough to
// make brute-forcing expensive (~100ms on a modern x86 core) while
// keeping legitimate logins snappy.
//
// ## Format
//
// `hashPassword(plain)` returns a single ASCII string of the form:
//
//   scrypt$N$r$p$saltB64$hashB64
//
// where:
//   - N      = scrypt cost (CPU/memory). Default 16384 (2^14).
//   - r      = block size. Default 16.
//   - p      = parallelization. Default 1.
//   - saltB64 = 16 random bytes, base64-encoded (24 chars, no padding).
//   - hashB64 = 64 derived bytes, base64-encoded (88 chars, no padding).
//
// The full self-describing format lets us tune the parameters later
// without a migration — `verifyPassword` parses the cost out of the
// stored hash and uses the same N/r/p, so a row hashed with old
// parameters still verifies after we bump them for new rows.
//
// ## Why scrypt (not bcrypt, not argon2)
//
// - No new dependency. `node:crypto` ships scrypt as `crypto.scryptSync`
//   since Node 10. Adding bcrypt or argon2 would mean auditing the
//   native build chain and the npm tarball pipeline.
// - Memory-hard. scrypt's cost includes a memory component (N*r*128
//   bytes) which makes GPU/ASIC brute-forcing more expensive than
//   bcrypt's CPU-only cost parameter.
// - Standardized. RFC 7914. bcrypt is a well-trodden alternative but
//   has a 72-byte input cap (silently truncates longer passwords) and
//   no memory-hardness; argon2 won the Password Hashing Competition
//   but requires `argon2` (native) or `argon2-browser` (WASM) — both
//   are bigger surfaces than node:crypto.

import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

// scrypt cost parameters. N=2^14 is the OWASP-recommended minimum for
// interactive logins (https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt).
// r=8 and p=1 keep total memory at N*r*128 = 16 MiB which is enough
// to make GPU brute-forcing impractical without slowing the request
// loop on a shared VPS.
const N = 16384;
const R = 8;
const P = 1;
const SALT_BYTES = 16;
const HASH_BYTES = 64;

const VERSION = 'scrypt';

/** Hash a plaintext password. Returns a self-describing string of the
 *  form `scrypt$N$r$p$saltB64$hashB64` that can be passed to
 *  `verifyPassword` to check a candidate. */
export function hashPassword(plain: string): string {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('hashPassword: password must be a non-empty string');
  }
  const salt = randomBytes(SALT_BYTES);
  // salt is passed as a Buffer; scrypt appends it to the input internally.
  const derived = scryptSync(plain, salt, HASH_BYTES, { N, r: R, p: P });
  return [
    VERSION,
    String(N),
    String(R),
    String(P),
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/** Verify a candidate plaintext against a stored hash. Returns true
 *  iff the candidate matches. Uses a constant-time comparison to
 *  avoid leaking the first-matching-byte position.
 *
 *  The function is intentionally tolerant of an invalid stored hash
 *  (returns false rather than throwing) so a corrupt DB row cannot
 *  wedge the login flow. */
export function verifyPassword(plain: string, stored: string): boolean {
  if (typeof plain !== 'string' || plain.length === 0) return false;
  if (typeof stored !== 'string' || stored.length === 0) return false;

  const parts = stored.split('$');
  // Expected: [version, N, r, p, salt, hash]
  if (parts.length !== 6) return false;
  if (parts[0] !== VERSION) return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  if (n <= 0 || r <= 0 || p <= 0) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], 'base64');
    expected = Buffer.from(parts[5], 'base64');
  } catch {
    return false;
  }
  if (expected.length !== HASH_BYTES) return false;

  let derived: Buffer;
  try {
    derived = scryptSync(plain, salt, HASH_BYTES, { N: n, r, p });
  } catch {
    return false;
  }
  // timingSafeEqual requires equal-length buffers; we already enforced
  // that above. The constant-time comparison is the protection against
  // a network-side observer learning the first-differing byte — for a
  // 64-byte hash the leak is academic, but the safer check is free.
  return timingSafeEqual(derived, expected);
}
