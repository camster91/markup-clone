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
