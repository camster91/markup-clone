/**
 * Fire-and-forget audit log.
 *
 * Semantics (verified 2026-06-13):
 *   - `audit()` returns a *promise that the route does not await*. The route's
 *     response is sent to the client before the audit row is written. This is
 *     intentional — a slow or unreachable audit table must never block a user
 *     request or wedge the worker.
 *   - If `prisma.auditLog.create` rejects, the rejection is caught and logged
 *     via `console.error` (which goes to stderr / container logs). The caller
 *     never sees the error. In practice this means the only signal an operator
 *     has that audit writes are failing is the log itself — there is no
 *     health-check endpoint, no metric, and no retry queue. If you need
 *     durable audit, do not rely on this helper.
 *   - Ordering is best-effort: under load, audit writes for a burst of
 *     concurrent requests may interleave. There is no "transactional outbox"
 *     guarantee that the audit row is committed atomically with the business
 *     write it describes. Read audit rows for forensics, not for
 *     serialization.
 */
import { prisma } from './prisma';

export type AuditAction =
  | 'project.create' | 'project.delete' | 'project.update'
  | 'pin.create' | 'pin.delete' | 'screenshot.recapture'
  | 'subscriber.add' | 'subscriber.remove';

export interface AuditEntry {
  actor: string;
  action: AuditAction;
  target: string;
  metadata?: Record<string, unknown>;
}

/**
 * Fire-and-forget audit log. NEVER blocks the request and NEVER throws.
 * If the DB is down, we log to stderr and move on.
 */
export function audit(entry: AuditEntry): void {
  // Intentionally not awaited.
  prisma.auditLog.create({
    data: {
      actor: entry.actor,
      action: entry.action,
      target: entry.target,
      metadata: entry.metadata as object | undefined,
    },
  }).catch((err) => {
    // Use console.error so it shows up in container logs.
    console.error('Audit log failed:', err.message ?? err);
  });
}
