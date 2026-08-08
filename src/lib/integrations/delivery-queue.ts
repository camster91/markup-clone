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

export interface DeliveryStore {
  claimDue(input: { workerId: string; now: Date; batchSize: number }): Promise<DeliveryClaim[]>;
  recordOutcome(claim: DeliveryClaim, outcome: DeliveryRecordedOutcome): Promise<void>;
}

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

export async function processDeliveryBatch(input: {
  store: DeliveryStore;
  workerId: string;
  now?: Date;
  batchSize?: number;
  dispatch?: DeliveryDispatch;
  credentialKey?: Buffer;
}): Promise<{ claimed: number; succeeded: number; retryScheduled: number; deadLettered: number }> {
  const fixedNow = input.now;
  const now = fixedNow ?? new Date();
  const completed = () => fixedNow ? new Date(fixedNow) : new Date();
  const batchSize = Math.max(1, Math.min(50, Math.floor(input.batchSize ?? 20)));
  const claims = await input.store.claimDue({ workerId: input.workerId, now, batchSize });
  const summary = { claimed: claims.length, succeeded: 0, retryScheduled: 0, deadLettered: 0 };
  const deliver = input.dispatch ?? dispatchDelivery;

  for (const claim of claims) {
    const startedAt = new Date(now);
    const attemptNumber = claim.attemptCount + 1;
    const event = parseEvent(claim);
    if (!event) {
      await input.store.recordOutcome(
        claim,
        terminalOutcome(attemptNumber, startedAt, completed(), 'Stored event payload is invalid'),
      );
      summary.deadLettered += 1;
      continue;
    }
    if (!isIntegrationKind(claim.integration.kind)) {
      await input.store.recordOutcome(
        claim,
        terminalOutcome(attemptNumber, startedAt, completed(), 'Stored integration kind is invalid'),
      );
      summary.deadLettered += 1;
      continue;
    }

    let storedConfig: unknown;
    try {
      storedConfig = JSON.parse(claim.integration.configJson);
    } catch {
      await input.store.recordOutcome(
        claim,
        terminalOutcome(attemptNumber, startedAt, completed(), 'Stored integration config is invalid'),
      );
      summary.deadLettered += 1;
      continue;
    }

    const validatedConfig = validateStoredConfig(claim.integration.kind, storedConfig);
    if (!validatedConfig.ok) {
      await input.store.recordOutcome(
        claim,
        terminalOutcome(attemptNumber, startedAt, completed(), 'Stored integration config is invalid'),
      );
      summary.deadLettered += 1;
      continue;
    }
    let config: unknown = validatedConfig.value;
    if (claim.integration.kind === 'github') {
      if (!claim.integration.credentialCiphertext) {
        await input.store.recordOutcome(
          claim,
          terminalOutcome(attemptNumber, startedAt, completed(), 'GitHub credential is unavailable'),
        );
        summary.deadLettered += 1;
        continue;
      }
      try {
        const key = input.credentialKey ?? loadIntegrationEncryptionKey();
        const token = decryptIntegrationCredential(claim.integration.credentialCiphertext, key);
        config = { ...validatedConfig.value, token };
      } catch {
        await input.store.recordOutcome(
          claim,
          terminalOutcome(attemptNumber, startedAt, completed(), 'GitHub credential is unavailable'),
        );
        summary.deadLettered += 1;
        continue;
      }
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
      await input.store.recordOutcome(claim, {
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
      summary.succeeded += 1;
      continue;
    }

    const error = safeError(claim, result.error, config);
    if (result.retryable && attemptNumber < 5) {
      await input.store.recordOutcome(claim, {
        status: 'RETRY_SCHEDULED',
        attemptNumber,
        startedAt,
        completedAt,
        statusCode: result.statusCode ?? null,
        error,
        nextAttemptAt: nextRetryAt(attemptNumber, completedAt, result.retryAfter),
        externalId: null,
        externalUrl: null,
      });
      summary.retryScheduled += 1;
    } else {
      await input.store.recordOutcome(
        claim,
        terminalOutcome(
          attemptNumber,
          startedAt,
          completedAt,
          error,
          result.statusCode ?? null,
        ),
      );
      summary.deadLettered += 1;
    }
  }
  return summary;
}
