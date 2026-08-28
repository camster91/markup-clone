/*
 * Provision the first production operator without putting a plaintext password
 * in argv, environment variables, repository files, or container configuration.
 * Input is exactly two newline-delimited stdin fields: email, then password.
 *
 * Run inside the application container (scripts is mounted read-only):
 *   printf '%s\n%s\n' "$OPERATOR_EMAIL" "$OPERATOR_PASSWORD" |
 *     docker exec -i markup-clone node /opt/app-scripts/provision-operator.cjs
 *
 * Re-running with the same credentials is a no-op. A different password is
 * refused unless --rotate is explicit.
 */
const { createRequire } = require('node:module');
const { randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');

const N = 16384;
const R = 8;
const P = 1;
const HASH_BYTES = 64;

function validateInput(emailInput, passwordInput) {
  const email = String(emailInput || '').trim().toLowerCase();
  const password = String(passwordInput || '');
  if (!email || email.length > 320 || !email.includes('@') || /[\u0000-\u001f\u007f\s]/.test(email)) {
    throw new Error('operator email is invalid');
  }
  if (password.length < 12 || password.length > 128 || /[\u0000-\u001f\u007f]/.test(password)) {
    throw new Error('operator password must be 12 to 128 characters without control characters');
  }
  return { email, password };
}

function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, HASH_BYTES, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p) || expected.length !== HASH_BYTES) return false;
  try {
    const actual = scryptSync(password, salt, HASH_BYTES, { N: n, r, p });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

async function provisionOperator(userStore, email, password, rotate = false) {
  const existing = await userStore.findUnique({ where: { email } });
  if (!existing) {
    const created = await userStore.create({
      data: { email, passwordHash: hashPassword(password), role: 'operator' },
      select: { id: true, email: true, role: true },
    });
    return { status: 'created', user: created };
  }
  if (existing.role !== 'operator') {
    throw new Error('email belongs to a non-operator account; refusing implicit privilege escalation');
  }
  if (verifyPassword(password, existing.passwordHash)) {
    return { status: 'unchanged', user: { id: existing.id, email: existing.email, role: existing.role } };
  }
  if (!rotate) throw new Error('operator exists with a different password; rerun with --rotate to replace it');
  const updated = await userStore.update({
    where: { id: existing.id },
    data: { passwordHash: hashPassword(password) },
    select: { id: true, email: true, role: true },
  });
  return { status: 'rotated', user: updated };
}

async function main() {
  if (process.argv.slice(2).some((argument) => argument !== '--rotate')) {
    throw new Error('only the optional --rotate argument is supported');
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const fields = Buffer.concat(chunks).toString('utf8').split(/\r?\n/);
  if (fields.length < 2) throw new Error('expected operator email and password on separate stdin lines');
  const { email, password } = validateInput(fields[0], fields[1]);
  fields.fill('');
  chunks.fill(Buffer.alloc(0));

  const requireFromApp = createRequire('/app/server.js');
  const { PrismaClient } = requireFromApp('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const result = await provisionOperator(prisma.user, email, password, process.argv.includes('--rotate'));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = { hashPassword, provisionOperator, validateInput, verifyPassword };

if (require.main === module) {
  main().catch((error) => {
    console.error(`Operator provisioning failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  });
}
