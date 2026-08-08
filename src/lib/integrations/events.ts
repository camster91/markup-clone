import type { IssueHandoffV1 } from '@/lib/issue-handoff';

export const INTEGRATION_EVENT_SCHEMA = 'visual-feedback.event.v1' as const;

export type PinCreatedEventV1 = {
  schema: typeof INTEGRATION_EVENT_SCHEMA;
  id: string;
  type: 'pin.created';
  occurredAt: string;
  project: IssueHandoffV1['project'];
  data: { issue: IssueHandoffV1 };
};

type BuildPinCreatedEventInput = {
  eventId: string;
  occurredAt: string;
  issue: IssueHandoffV1;
};

function boundedIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 128) {
    throw new Error(`${field} must be between 1 and 128 characters`);
  }
  return normalized;
}

function isoTimestamp(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error('occurredAt must be an ISO-8601 timestamp');
  }
  return value;
}

/**
 * Wrap the already privacy-bounded developer handoff in the integration event
 * contract. Cloning through JSON prevents a caller from mutating the stored
 * event after it has been built and strips no valid v1 fields.
 */
export function buildPinCreatedEventV1(input: BuildPinCreatedEventInput): PinCreatedEventV1 {
  const issue = JSON.parse(JSON.stringify(input.issue)) as IssueHandoffV1;
  return {
    schema: INTEGRATION_EVENT_SCHEMA,
    id: boundedIdentifier(input.eventId, 'eventId'),
    type: 'pin.created',
    occurredAt: isoTimestamp(input.occurredAt),
    project: { ...issue.project },
    data: { issue },
  };
}

/** Exact serialized body persisted once and reused for every retry/signature. */
export function serializeIntegrationEvent(event: PinCreatedEventV1): string {
  return JSON.stringify(event);
}
