import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('reliable integration delivery schema', () => {
  it('models immutable events, target deliveries, attempts, and signing secrets', () => {
    const schema = read('prisma/schema.prisma');

    expect(schema).toMatch(/integrationEvents\s+IntegrationEvent\[\]/);
    expect(schema).toMatch(/signingSecret\s+String\?/);
    expect(schema).toContain('model IntegrationEvent {');
    expect(schema).toMatch(/schema\s+String\s+@default\("visual-feedback\.event\.v1"\)/);
    expect(schema).toMatch(/payloadJson\s+String/);
    expect(schema).toContain('model IntegrationDelivery {');
    expect(schema).toMatch(/status\s+String\s+@default\("PENDING"\)/);
    expect(schema).toMatch(/attemptCount\s+Int\s+@default\(0\)/);
    expect(schema).toMatch(/retryCycle\s+Int\s+@default\(0\)/);
    expect(schema).toContain('@@unique([integrationId, eventId])');
    expect(schema).toContain('@@index([status, nextAttemptAt])');
    expect(schema).toContain('model IntegrationDeliveryAttempt {');
    expect(schema).toMatch(/cycle\s+Int\s+@default\(0\)/);
    expect(schema).toContain('@@unique([deliveryId, cycle, attemptNumber])');
  });

  it('uses an additive migration with closed states and bounded attempts', () => {
    const sql = read(
      'prisma/migrations/20260808053000_add_reliable_integration_delivery/migration.sql',
    );

    expect(sql).toContain('ADD COLUMN "signingSecret" TEXT');
    expect(sql).toContain("CHECK (\"status\" IN ('PENDING', 'PROCESSING', 'RETRY_SCHEDULED', 'SUCCEEDED', 'DEAD_LETTER'))");
    expect(sql).toContain('CHECK ("attemptCount" BETWEEN 0 AND 5)');
    expect(sql).toContain('CHECK ("attemptNumber" BETWEEN 1 AND 5)');
    expect(sql).toContain('CHECK ("retryCycle" >= 0)');
    expect(sql).toContain('CHECK ("cycle" >= 0)');
    expect(sql).toContain('CHECK (char_length("lastError") <= 1000)');
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
  });
});
