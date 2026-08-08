import { createHash, timingSafeEqual } from 'node:crypto';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function authorizeDeliveryWorker(
  authorizationHeader: string | null,
  configuredSecret: string | undefined,
): boolean {
  if (!configuredSecret || configuredSecret.length < 32 || !authorizationHeader) return false;
  const prefix = 'Bearer ';
  if (!authorizationHeader.startsWith(prefix)) return false;
  return timingSafeEqual(
    digest(authorizationHeader.slice(prefix.length)),
    digest(configuredSecret),
  );
}
