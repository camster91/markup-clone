export type DeliveryStatusClassification = 'success' | 'retry' | 'permanent';

const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429]);
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000] as const;
const MAX_RETRY_AFTER_MS = 6 * 60 * 60_000;

export function classifyDeliveryStatus(status: number): DeliveryStatusClassification {
  if (status >= 200 && status < 300) return 'success';
  if (RETRYABLE_STATUS_CODES.has(status) || status >= 500) return 'retry';
  return 'permanent';
}

function retryAfterMilliseconds(value: string | null | undefined, now: Date): number | null {
  if (!value) return null;
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) {
    return Math.min(Number(normalized) * 1000, MAX_RETRY_AFTER_MS);
  }
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) return null;
  return Math.min(Math.max(0, date.getTime() - now.getTime()), MAX_RETRY_AFTER_MS);
}

/** attemptNumber is the attempt that just failed (1-4 can be retried). */
export function nextRetryAt(
  attemptNumber: number,
  now: Date,
  retryAfter?: string | null,
): Date {
  const defaultDelay = BACKOFF_MS[attemptNumber - 1];
  if (defaultDelay === undefined) throw new Error('No retry remains after this attempt');
  const receiverDelay = retryAfterMilliseconds(retryAfter, now);
  const delay = Math.max(defaultDelay, receiverDelay ?? 0);
  return new Date(now.getTime() + delay);
}
