import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  DeliveryClaim,
  DeliveryRecordedOutcome,
  DeliveryStore,
} from './delivery-queue';

const STALE_CLAIM_MS = 5 * 60_000;

export class PrismaDeliveryStore implements DeliveryStore {
  constructor(private readonly prisma: PrismaClient) {}

  async claimDue(input: {
    workerId: string;
    now: Date;
    batchSize: number;
  }): Promise<DeliveryClaim[]> {
    const staleBefore = new Date(input.now.getTime() - STALE_CLAIM_MS);
    const ids = await this.prisma.$transaction(async (tx) => tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        WITH candidates AS (
          SELECT "id"
          FROM "IntegrationDelivery"
          WHERE (
            ("status" IN ('PENDING', 'RETRY_SCHEDULED') AND "nextAttemptAt" <= ${input.now})
            OR ("status" = 'PROCESSING' AND "lockedAt" <= ${staleBefore})
          )
          ORDER BY "nextAttemptAt" ASC, "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${input.batchSize}
        )
        UPDATE "IntegrationDelivery" AS delivery
        SET "status" = 'PROCESSING',
            "lockedAt" = ${input.now},
            "lockedBy" = ${input.workerId},
            "updatedAt" = ${input.now}
        FROM candidates
        WHERE delivery."id" = candidates."id"
        RETURNING delivery."id"
      `,
    ));
    if (ids.length === 0) return [];

    const deliveries = await this.prisma.integrationDelivery.findMany({
      where: {
        id: { in: ids.map(({ id }) => id) },
        lockedBy: input.workerId,
        status: 'PROCESSING',
      },
      include: {
        integration: {
          select: {
            id: true, kind: true, configJson: true, signingSecret: true,
            credentialCiphertext: true,
          },
        },
        event: { select: { id: true, type: true, payloadJson: true } },
      },
    });
    const byId = new Map(deliveries.map((delivery) => [delivery.id, delivery]));
    return ids.flatMap(({ id }) => {
      const delivery = byId.get(id);
      if (!delivery) return [];
      return [{
        id: delivery.id,
        attemptCount: delivery.attemptCount,
        retryCycle: delivery.retryCycle,
        lockedBy: delivery.lockedBy ?? input.workerId,
        integration: delivery.integration,
        event: delivery.event,
      }];
    });
  }

  async recordOutcome(
    claim: DeliveryClaim,
    outcome: DeliveryRecordedOutcome,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.integrationDelivery.updateMany({
        where: { id: claim.id, status: 'PROCESSING', lockedBy: claim.lockedBy },
        data: {
          status: outcome.status,
          attemptCount: outcome.attemptNumber,
          nextAttemptAt: outcome.nextAttemptAt ?? outcome.completedAt,
          lockedAt: null,
          lockedBy: null,
          deliveredAt: outcome.status === 'SUCCEEDED' ? outcome.completedAt : null,
          lastStatusCode: outcome.statusCode,
          lastError: outcome.error,
          externalId: outcome.externalId,
          externalUrl: outcome.externalUrl,
        },
      });
      if (updated.count !== 1) {
        throw new Error(`Integration delivery claim ownership was lost for ${claim.id}`);
      }

      await tx.integrationDeliveryAttempt.create({
        data: {
          deliveryId: claim.id,
          cycle: claim.retryCycle,
          attemptNumber: outcome.attemptNumber,
          status: outcome.status,
          startedAt: outcome.startedAt,
          completedAt: outcome.completedAt,
          responseStatus: outcome.statusCode,
          error: outcome.error,
          durationMs: Math.max(0, outcome.completedAt.getTime() - outcome.startedAt.getTime()),
        },
      });

      if (outcome.status === 'SUCCEEDED') {
        await tx.integration.update({
          where: { id: claim.integration.id },
          data: {
            lastSuccessAt: outcome.completedAt,
            lastError: null,
            lastErrorAt: null,
          },
        });
      } else {
        await tx.integration.update({
          where: { id: claim.integration.id },
          data: { lastError: outcome.error, lastErrorAt: outcome.completedAt },
        });
      }
    });
  }
}
