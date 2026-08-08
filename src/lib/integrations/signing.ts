import { createHmac, randomBytes } from 'node:crypto';

const RESERVED_HEADERS = new Set([
  'content-type',
  'x-visual-feedback-event',
  'x-visual-feedback-event-id',
  'x-visual-feedback-delivery',
  'x-visual-feedback-timestamp',
  'x-visual-feedback-signature',
]);

export function generateWebhookSigningSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function signWebhookPayload(
  secret: string,
  timestamp: string,
  payloadJson: string,
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${payloadJson}`, 'utf8')
    .digest('hex');
}

type SignedWebhookHeadersInput = {
  operatorHeaders?: Record<string, string>;
  secret: string;
  timestamp: string;
  payloadJson: string;
  eventId: string;
  eventType: string;
  deliveryId: string;
};

export function buildSignedWebhookHeaders(
  input: SignedWebhookHeadersInput,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.operatorHeaders ?? {})) {
    if (!RESERVED_HEADERS.has(key.toLowerCase())) headers[key] = value;
  }

  headers['Content-Type'] = 'application/json';
  headers['X-Visual-Feedback-Event'] = input.eventType;
  headers['X-Visual-Feedback-Event-Id'] = input.eventId;
  headers['X-Visual-Feedback-Delivery'] = input.deliveryId;
  headers['X-Visual-Feedback-Timestamp'] = input.timestamp;
  headers['X-Visual-Feedback-Signature'] =
    `v1=${signWebhookPayload(input.secret, input.timestamp, input.payloadJson)}`;
  return headers;
}
