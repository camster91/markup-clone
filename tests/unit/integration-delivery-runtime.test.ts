import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('durable integration delivery runtime', () => {
  it('documents a dedicated production worker secret and supplies a local-only Docker value', () => {
    const env = read('.env.example');
    const compose = read('docker-compose.yml');
    expect(env).toContain('DELIVERY_WORKER_SECRET=');
    expect(env).toMatch(/^DELIVERY_WORKER_SECRET=[A-Za-z0-9_-]{32,}$/m);
    expect(compose).toMatch(/DELIVERY_WORKER_SECRET:\s*[A-Za-z0-9_-]{32,}/);
  });

  it('documents a 32-byte credential encryption key and supplies a local-only Docker value', () => {
    const env = read('.env.example');
    const compose = read('docker-compose.yml');
    expect(env).toMatch(/^INTEGRATION_ENCRYPTION_KEY=[A-Za-z0-9_-]{43}$/m);
    expect(compose).toMatch(/INTEGRATION_ENCRYPTION_KEY:\s*[A-Za-z0-9_-]{43}/);
  });

  it('keeps Docker --env-file assignments unquoted', () => {
    const assignments = read('.env.example')
      .split('\n')
      .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line));

    expect(assignments.length).toBeGreaterThan(0);
    expect(assignments).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/^[A-Z][A-Z0-9_]*=["']/),
    ]));
  });

  it('installs an idempotent per-minute worker using a quoted heredoc and in-container secret', () => {
    const script = read('scripts/install-cron.sh');
    expect(script).toContain("cat > /etc/cron.d/markup-integration-delivery <<'EOF'");
    expect(script).toContain('* * * * * root docker exec markup-clone sh -c');
    expect(script).toContain('Authorization: Bearer $DELIVERY_WORKER_SECRET');
    expect(script).toContain('http://127.0.0.1:3000/api/internal/integration-deliveries/process');
    expect(script).toContain('/var/log/markup-integration-delivery.log');
  });

  it('documents the processor, signature headers, retries, and delivery log', () => {
    const readme = read('README.md');
    expect(readme).toContain('/etc/cron.d/markup-integration-delivery');
    expect(readme).toContain('visual-feedback.event.v1');
    expect(readme).toContain('X-Visual-Feedback-Signature');
    expect(readme).toContain('DEAD_LETTER');
    expect(readme).toContain('five attempts');
    expect(readme).toContain('INTEGRATION_ENCRYPTION_KEY');
    expect(readme).toContain('Issues: write');
  });
});
