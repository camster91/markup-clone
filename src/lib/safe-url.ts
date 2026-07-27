// SSRF-safe URL validation for outbound integration webhooks and
// any other operator-supplied fetch targets.
//
// Threat model: a dashboard caller who can register a webhook URL
// (or who forges Origin against the pre-session gate) can force
// the server to fetch internal addresses — cloud metadata
// (169.254.169.254), loopback services, RFC1918 hosts, link-local,
// or the Postgres container on the deploy network.
//
// Policy:
//   - https only (no http — blocks cleartext internal probes and
//     most metadata endpoints that only speak http)
//   - reject userinfo (user:pass@host)
//   - reject IP literals (v4 / v6 / hex / octal / decimal forms)
//   - reject known metadata / internal host suffixes
//   - resolve DNS and reject private / reserved resolved addresses
//     (blocks DNS-rebinding to nip.io → private IP)
//
// Callers pass the raw URL string; on success they get a normalized
// absolute URL string ready to store / fetch.

import { isIP } from 'net';
import { lookup } from 'dns/promises';

export type UrlCheckResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

const BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.lan',
  '.intranet',
  '.corp',
  '.private',
  '.svc.cluster.local',
  '.metadata.google.internal',
  '.metadata.azure.com',
];

const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.azure.com',
  'metadata',
]);

/** True if an IPv4 address is loopback / private / link-local / CGNAT / etc. */
export function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // unparseable → treat as blocked
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / IMDS
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

/** True if an IPv6 address is loopback / link-local / ULA / mapped-private. */
export function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80:') || lower.startsWith('fe8') || lower.startsWith('fe9') ||
      lower.startsWith('fea') || lower.startsWith('feb')) return true; // fe80::/10
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 ULA
  // IPv4-mapped :ffff:a.b.c.d
  const mapped = lower.match(/^:ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedIpv4(ip);
  if (version === 6) return isBlockedIpv6(ip);
  return true;
}

/**
 * Shape-only check (no DNS). Used at config-write time so we can
 * reject obviously-bad URLs without awaiting DNS. The fetch path
 * MUST also call `assertSafeOutboundUrl` which resolves.
 */
export function validateOutboundUrlShape(raw: unknown): UrlCheckResult {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, error: 'url must be a non-empty string' };
  }
  if (raw.length > 2048) {
    return { ok: false, error: 'url must be ≤2048 chars' };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'url must be a valid absolute URL' };
  }

  if (url.protocol !== 'https:') {
    return { ok: false, error: 'url must use https' };
  }
  if (url.username || url.password) {
    return { ok: false, error: 'url must not include credentials' };
  }

  const host = url.hostname.toLowerCase();
  if (!host) return { ok: false, error: 'url must have a hostname' };

  if (BLOCKED_HOSTS.has(host)) {
    return { ok: false, error: 'url must not target an internal hostname' };
  }
  for (const suffix of BLOCKED_HOST_SUFFIXES) {
    if (host.endsWith(suffix)) {
      return { ok: false, error: 'url must not target an internal hostname' };
    }
  }

  // Reject IP literals (any form). Hostname regex for domains is
  // enforced indirectly: if isIP() says it's an IP, block it.
  // Also catch hex/octal dotted forms that `new URL` may normalize
  // differently across Node versions — reject any hostname that
  // looks like an address encoding.
  if (isIP(host)) {
    return { ok: false, error: 'url must not be an IP address' };
  }
  if (/^0x[0-9a-f]+$/i.test(host) || /^\d+$/.test(host)) {
    return { ok: false, error: 'url must not be a numeric IP encoding' };
  }
  // Hex / octal dotted quads: 0x7f.0.0.1, 0177.0.0.1
  if (/(?:^|\.)0x[0-9a-f]+/i.test(host) || /(?:^|\.)0[0-7]{3,}/.test(host)) {
    return { ok: false, error: 'url must not be a hex/octal IP encoding' };
  }

  return { ok: true, value: url.toString() };
}

/**
 * Full check: shape + DNS resolve + block private resolved IPs.
 * Use immediately before `fetch()`.
 */
export async function assertSafeOutboundUrl(raw: string): Promise<UrlCheckResult> {
  const shape = validateOutboundUrlShape(raw);
  if (!shape.ok) return shape;

  const url = new URL(shape.value);
  const host = url.hostname;

  let addresses: string[];
  try {
    const results = await lookup(host, { all: true, verbatim: true });
    addresses = results.map((r) => r.address);
  } catch {
    return { ok: false, error: 'url hostname could not be resolved' };
  }

  if (addresses.length === 0) {
    return { ok: false, error: 'url hostname could not be resolved' };
  }

  for (const addr of addresses) {
    if (isBlockedIp(addr)) {
      return { ok: false, error: 'url resolves to a private/reserved address' };
    }
  }

  return { ok: true, value: shape.value };
}
