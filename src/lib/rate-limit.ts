/**
 * In-memory token bucket rate limiter.
 *
 * Each bucket holds up to `maxTokens` tokens and refills at `refillRate`
 * tokens per second. Call `consume(key)` to atomically consume one token;
 * it returns { ok: true, remaining } if a token was available, or
 * { ok: false, retryAfterSec } if the bucket is empty.
 *
 * Old buckets are cleaned up every 5 minutes to avoid memory leaks.
 */

interface Bucket {
  tokens: number;
  lastRefill: number; // unix ms
}

interface ConsumeResult {
  ok: boolean;
  remaining?: number;
  retryAfterSec?: number;
}

interface RateLimiterOptions {
  maxTokens: number;
  refillRate: number; // tokens per second
}

const DEFAULT_OPTIONS: RateLimiterOptions = {
  maxTokens: 60,
  refillRate: 0.5, // 1 token every 2 seconds
};

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const STALE_AGE_MS = 5 * 60 * 1000; // 5 minutes

// Module-level state
const buckets = new Map<string, Bucket>();
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

// ─── Bucket math ─────────────────────────────────────────────────────────────

/**
 * Compute how many tokens are in the bucket after refilling for `elapsedSec`
 * seconds, capped at maxTokens. Does NOT modify the bucket.
 */
function computeRefill(bucket: Bucket, elapsedSec: number, maxTokens: number, refillRate: number): number {
  const newTokens = Math.min(maxTokens, bucket.tokens + elapsedSec * refillRate);
  return Math.min(maxTokens, newTokens);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Consume one token from the bucket identified by `key`.
 * Returns { ok: true, remaining } if a token was available, or
 * { ok: false, retryAfterSec } if the bucket is empty.
 */
export function consume(
  key: string,
  opts: Partial<RateLimiterOptions> = {}
): ConsumeResult {
  const { maxTokens, refillRate } = { ...DEFAULT_OPTIONS, ...opts };
  const now = Date.now();

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: maxTokens, lastRefill: now };
    buckets.set(key, bucket);
  }

  const elapsedSec = (now - bucket.lastRefill) / 1000;
  const tokens = computeRefill(bucket, elapsedSec, maxTokens, refillRate);

  if (tokens < 1) {
    // How many seconds until one token is available?
    const retryAfterSec = (1 - tokens) / refillRate;
    return { ok: false, retryAfterSec: Math.ceil(retryAfterSec) };
  }

  // We have at least 1 token — consume it and update bucket state
  bucket.tokens = tokens - 1;
  bucket.lastRefill = now;
  return { ok: true, remaining: Math.floor(bucket.tokens) };
}

/**
 * Reset a bucket (for testing).
 */
export function _resetBucket(key: string): void {
  buckets.delete(key);
}

/**
 * Number of active buckets (for testing).
 */
export function _bucketCount(): number {
  return buckets.size;
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

function startCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    cleanup();
  }, CLEANUP_INTERVAL_MS);
  // Keep the timer from preventing process exit
  cleanupTimer.unref?.();
}

export function stopCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

/**
 * Run one cleanup pass immediately (for testing).
 */
export function _triggerCleanup(): void {
  cleanup();
}

function cleanup(): void {
  const now = Date.now();
  const keysToDelete: string[] = [];
  buckets.forEach((bucket, key) => {
    if (now - bucket.lastRefill > STALE_AGE_MS) {
      keysToDelete.push(key);
    }
  });
  for (const key of keysToDelete) {
    buckets.delete(key);
  }
}

// Auto-start cleanup on first use
let cleanupStarted = false;
function ensureCleanup(): void {
  if (!cleanupStarted) {
    cleanupStarted = true;
    startCleanup();
  }
}

// ─── Configured limiter factory ───────────────────────────────────────────────

/**
 * Create a rate-limit middleware for a specific configuration.
 * Returns a function that calls consume() with the given options.
 */
export function createRateLimiter(opts: RateLimiterOptions) {
  return (key: string) => {
    ensureCleanup();
    return consume(key, opts);
  };
}
