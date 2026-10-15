import type { IssueHandoffV1 } from '@/lib/issue-handoff';
import type { IntegrationKind } from './types';
import type { PinCreatedEventV1 } from './events';
import { buildPinCreatedEventV1, serializeIntegrationEvent } from './events';
import { dispatchDelivery, type DeliveryDispatchResult } from './dispatcher';
import { isIntegrationKind } from './types';
import { nextRetryAt } from './retry';
import { decryptIntegrationCredential, loadIntegrationEncryptionKey } from './credential-crypto';
import { validateStoredConfig } from './validate';

type OutboxTransaction = {
  integration: {
    findMany(args: {
      where: { projectId: string };
      select: { id: true };
    }): Promise<Array<{ id: string }>>;
  };
  integrationEvent: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
};

export async function enqueuePinCreatedEvent(
  tx: OutboxTransaction,
  input: {
    projectId: string;
    eventId: string;
    occurredAt: string;
    issue: IssueHandoffV1 | (() => IssueHandoffV1);
  },
): Promise<{ eventId: string; deliveryCount: number } | null> {
  const integrations = await tx.integration.findMany({
    where: { projectId: input.projectId },
    select: { id: true },
  });
  if (integrations.length === 0) return null;

  const issue = typeof input.issue === 'function' ? input.issue() : input.issue;
  if (issue.project.id !== input.projectId) {
    throw new Error('Integration event project does not match the outbox project');
  }
  const event = buildPinCreatedEventV1({
    eventId: input.eventId,
    occurredAt: input.occurredAt,
    issue,
  });
  await tx.integrationEvent.create({
    data: {
      id: event.id,
      projectId: event.project.id,
      schema: event.schema,
      type: event.type,
      occurredAt: new Date(event.occurredAt),
      payloadJson: serializeIntegrationEvent(event),
      deliveries: {
        create: integrations.map(({ id }) => ({ integrationId: id })),
      },
    },
  });
  return { eventId: event.id, deliveryCount: integrations.length };
}

export type DeliveryClaim = {
  id: string;
  attemptCount: number;
  retryCycle: number;
  lockedBy: string;
  integration: {
    id: string;
    kind: string;
    configJson: string;
    signingSecret: string | null;
    credentialCiphertext: string | null;
  };
  event: {
    id: string;
    type: string;
    payloadJson: string;
  };
};

export type DeliveryRecordedOutcome = {
  status: 'SUCCEEDED' | 'RETRY_SCHEDULED' | 'DEAD_LETTER';
  attemptNumber: number;
  startedAt: Date;
  completedAt: Date;
  statusCode: number | null;
  error: string | null;
  nextAttemptAt: Date | null;
  externalId: string | null;
  externalUrl: string | null;
};

/**
 * Thrown by `DeliveryStore.recordOutcome` when the row is no longer
 * PROCESSING under this claim's `lockedBy` (another worker reclaimed it
 * after the stale-claim window). The outcome is NOT written — that is
 * the ownership-safety guarantee — but the rest of the batch carries on.
 */
export class DeliveryClaimLostError extends Error {
  constructor(readonly deliveryId: string) {
    super(`Integration delivery claim ownership was lost for ${deliveryId}`);
    this.name = 'DeliveryClaimLostError';
  }
}

export interface DeliveryStore {
  claimDue(input: { workerId: string; now: Date; batchSize: number }): Promise<DeliveryClaim[]>;
  recordOutcome(claim: DeliveryClaim, outcome: DeliveryRecordedOutcome): Promise<void>;
  /**
   * Re-stamp the claim's lock time just before a slow outbound send so
   * items late in a sequentially processed batch do not age past the
   * stale-claim window and get reclaimed (→ duplicate delivery).
   * Resolves false when this worker no longer owns the claim; the item
   * is then skipped without sending. Optional so in-memory test stores
   * need not implement it.
   */
  renewClaim?(claim: DeliveryClaim, now: Date): Promise<boolean>;
}

const MAX_ATTEMPTS = 5;

type DeliveryDispatch = (
  kind: IntegrationKind,
  config: unknown,
  payload: {
    event: PinCreatedEventV1;
    payloadJson: string;
    deliveryId: string;
    signingSecret: string | null;
    timestamp: string;
  },
) => Promise<DeliveryDispatchResult>;

function parseEvent(claim: DeliveryClaim): PinCreatedEventV1 | null {
  try {
    const parsed = JSON.parse(claim.event.payloadJson) as Partial<PinCreatedEventV1>;
    if (
      parsed.schema !== 'visual-feedback.event.v1' ||
      parsed.id !== claim.event.id ||
      parsed.type !== 'pin.created' ||
      typeof parsed.occurredAt !== 'string' ||
      !parsed.project ||
      !parsed.data?.issue
    ) return null;
    return parsed as PinCreatedEventV1;
  } catch {
    return null;
  }
}

function collectSensitiveValues(value: unknown, target: string[]): void {
  if (typeof value === 'string') {
    if (value.length >= 4) target.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSensitiveValues(item, target);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectSensitiveValues(item, target);
  }
}

function safeError(claim: DeliveryClaim, message: string, config: unknown): string {
  const sensitive = [claim.integration.signingSecret, claim.event.payloadJson]
    .filter((value): value is string => Boolean(value));
  collectSensitiveValues(config, sensitive);
  let normalized = message
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const secret of [...new Set(sensitive)].sort((a, b) => b.length - a.length)) {
    normalized = normalized.split(secret).join('[REDACTED]');
  }
  return normalized.slice(0, 1000) || 'Integration delivery failed';
}

function terminalOutcome(
  attemptNumber: number,
  startedAt: Date,
  completedAt: Date,
  error: string,
  statusCode: number | null = null,
): DeliveryRecordedOutcome {
  return {
    status: 'DEAD_LETTER',
    attemptNumber,
    startedAt,
    completedAt,
    statusCode,
    error,
    nextAttemptAt: null,
    externalId: null,
    externalUrl: null,
  };
}

export type DeliveryBatchSummary = {
  claimed: number;
  succeeded: number;
  retryScheduled: number;
  deadLettered: number;
  /** Items skipped because another worker reclaimed them mid-batch. */
  claimLost: number;
};

export async function processDeliveryBatch(input: {
  store: DeliveryStore;
  workerId: string;
  now?: Date;
  batchSize?: number;
  dispatch?: DeliveryDispatch;
  credentialKey?: Buffer;
}): Promise<DeliveryBatchSummary> {
  const fixedNow = input.now;
  const now = fixedNow ?? new Date();
  const completed = () => fixedNow ? new Date(fixedNow) : new Date();
  const batchSize = Math.max(1, Math.min(50, Math.floor(input.batchSize ?? 20)));
  const claims = await input.store.claimDue({ workerId: input.workerId, now, batchSize });
  const summary: DeliveryBatchSummary = {
    claimed: claims.length, succeeded: 0, retryScheduled: 0, deadLettered: 0, claimLost: 0,
  };
  const deliver = input.dispatch ?? dispatchDelivery;

  const claimLost = (claim: DeliveryClaim, stage: string) => {
    console.warn(
      `[integrations] delivery ${claim.id} was reclaimed by another worker (${stage}); ` +
      `worker ${input.workerId} skipped it`,
    );
    summary.claimLost += 1;
  };

  // Record and tally an outcome. A lost claim is logged and counted, and
  // the batch continues; any other store failure propagates.
  const record = async (claim: DeliveryClaim, outcome: DeliveryRecordedOutcome) => {
    try {
      await input.store.recordOutcome(claim, outcome);
    } catch (error) {
      if (error instanceof DeliveryClaimLostError) {
        claimLost(claim, 'before recording the outcome');
        return;
      }
      throw error;
    }
    if (outcome.status === 'SUCCEEDED') summary.succeeded += 1;
    else if (outcome.status === 'RETRY_SCHEDULED') summary.retryScheduled += 1;
    else summary.deadLettered += 1;
  };

  // Retry with the normal backoff while attempts remain, else dead-letter.
  const failure = (
    attemptNumber: number,
    startedAt: Date,
    completedAt: Date,
    error: string,
    retryable: boolean,
    statusCode: number | null = null,
    retryAfter?: string | null,
  ): DeliveryRecordedOutcome => {
    if (retryable && attemptNumber < MAX_ATTEMPTS) {
      return {
        status: 'RETRY_SCHEDULED',
        attemptNumber,
        startedAt,
        completedAt,
        statusCode,
        error,
        nextAttemptAt: nextRetryAt(attemptNumber, completedAt, retryAfter),
        externalId: null,
        externalUrl: null,
      };
    }
    return terminalOutcome(attemptNumber, startedAt, completedAt, error, statusCode);
  };

  for (const claim of claims) {
    const startedAt = new Date(now);
    const attemptNumber = claim.attemptCount + 1;
    const event = parseEvent(claim);
    if (!event) {
      await record(
        claim,
        terminalOutcome(attemptNumber, startedAt, completed(), 'Stored event payload is invalid'),
      );
      continue;
    }
    if (!isIntegrationKind(claim.integration.kind)) {
      await record(
        claim,
        terminalOutcome(attemptNumber, startedAt, completed(), 'Stored integration kind is invalid'),
      );
      continue;
    }

    let storedConfig: unknown;
    try {
      storedConfig = JSON.parse(claim.integration.configJson);
    } catch {
      await record(
        claim,
        terminalOutcome(attemptNumber, startedAt, completed(), 'Stored integration config is invalid'),
      );
      continue;
    }

    const validatedConfig = validateStoredConfig(claim.integration.kind, storedConfig);
    if (!validatedConfig.ok) {
      await record(
        claim,
        terminalOutcome(attemptNumber, startedAt, completed(), 'Stored integration config is invalid'),
      );
      continue;
    }
    let config: unknown = validatedConfig.value;
    if (claim.integration.kind === 'github') {
      if (!claim.integration.credentialCiphertext) {
        await record(
          claim,
          terminalOutcome(attemptNumber, startedAt, completed(), 'GitHub credential is unavailable'),
        );
        continue;
      }
      // A missing / malformed INTEGRATION_ENCRYPTION_KEY, or a key that
      // does not open the stored envelope (rotated without re-encrypting),
      // is an operator configuration problem, not a property of this
      // delivery. Log it loudly and schedule a normal retry so fixing the
      // env recovers the queue; the attempt cap still dead-letters it if
      // the configuration is never fixed.
      let key: Buffer;
      try {
        key = input.credentialKey ?? loadIntegrationEncryptionKey();
      } catch (error) {
        console.error(
          `[integrations] delivery ${claim.id}: integration encryption key is not usable:`,
          error instanceof Error ? error.message : error,
        );
        await record(
          claim,
          failure(attemptNumber, startedAt, completed(), 'Integration encryption key is not configured', true),
        );
        continue;
      }
      try {
        const token = decryptIntegrationCredential(claim.integration.credentialCiphertext, key);
        config = { ...validatedConfig.value, token };
      } catch (error) {
        console.error(
          `[integrations] delivery ${claim.id}: GitHub credential could not be decrypted ` +
          `(wrong INTEGRATION_ENCRYPTION_KEY or corrupt ciphertext):`,
          error instanceof Error ? error.message : error,
        );
        await record(
          claim,
          failure(attemptNumber, startedAt, completed(), 'GitHub credential is unavailable', true),
        );
        continue;
      }
    }

    // Refresh the claim immediately before the (slow) outbound send. If
    // another worker already reclaimed the row, do not send — that would
    // be the duplicate delivery the stale-claim window exists to avoid.
    if (input.store.renewClaim && !(await input.store.renewClaim(claim, completed()))) {
      claimLost(claim, 'before sending');
      continue;
    }

    const result = await deliver(claim.integration.kind, config, {
      event,
      payloadJson: claim.event.payloadJson,
      deliveryId: claim.id,
      signingSecret: claim.integration.signingSecret,
      timestamp: String(Math.floor(startedAt.getTime() / 1000)),
    });
    const completedAt = completed();
    if (result.ok) {
      await record(claim, {
        status: 'SUCCEEDED',
        attemptNumber,
        startedAt,
        completedAt,
        statusCode: result.statusCode,
        error: null,
        nextAttemptAt: null,
        externalId: result.externalId ?? null,
        externalUrl: result.externalUrl ?? null,
      });
      continue;
    }

    const error = safeError(claim, result.error, config);
    await record(
      claim,
      failure(
        attemptNumber,
        startedAt,
        completedAt,
        error,
        result.retryable,
        result.statusCode ?? null,
        result.retryAfter,
      ),
    );
  }
  return summary;
}
