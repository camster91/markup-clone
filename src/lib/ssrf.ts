// SSRF defenses for outbound webhook / integration URLs.
//
// Threat model: a dashboard caller (or a forged Origin under the
// pre-session-gate model) can register an integration webhook that
// the server later `fetch`es when a pin is created. Without host
// checks, that URL can point at link-local metadata endpoints
// (169.254.169.254), RFC1918 ranges, or localhost — turning the
// app into an internal-network proxy.
//
// This module rejects those hosts at validation time AND at resolve
// time (`safeOutboundFetch` DNS-looks up the hostname and rejects
// any private/loopback address). A residual TOCTOU race remains
// between lookup and connect (attacker flips DNS after we check);
// closing that fully needs an undici connect hook. The resolve-time
// check still stops the common rebinding case where a hostname
// initially resolves public then flips to 169.254 before fetch.

import dns from 'node:dns/promises';

export type SsrfCheckResult = { ok: true; url: URL } | { ok: false; error: string };

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.google',
]);

function isIpv4(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}

function ipv4Octets(hostname: string): number[] | null {
  const parts = hostname.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }
  return parts;
}

function isPrivateOrLocalIpv4(hostname: string): boolean {
  const o = ipv4Octets(hostname);
  if (!o) return true; // malformed → reject
  const [a, b] = o;
  // 0.0.0.0/8, 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16, 100.64/10
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isIpv6Literal(hostname: string): boolean {
  return hostname.includes(':');
}

function isBlockedIpv6(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  // Loopback, uniquelocal, link-local
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // fc00::/7
  if (h.startsWith('fe80')) return true;
  if (h.startsWith('::ffff:')) {
    // IPv4-mapped IPv6 — check the embedded v4
    const mapped = h.slice('::ffff:'.length);
    if (isIpv4(mapped)) return isPrivateOrLocalIpv4(mapped);
    return true;
  }
  return false;
}

/**
 * True when `ip` is a private, loopback, link-local, or otherwise
 * blocked address for outbound webhook targets (IPv4 + IPv6).
 */
export function isBlockedResolvedAddress(ip: string): boolean {
  const addr = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (!addr) return true;
  if (isIpv4(addr)) return isPrivateOrLocalIpv4(addr);
  if (isIpv6Literal(addr)) return isBlockedIpv6(addr);
  // Non-IP strings shouldn't appear from dns.lookup({ all: true }),
  // but treat unknowns as blocked rather than open a hole.
  return true;
}

/**
 * Parse `raw` as an absolute http(s) URL and reject hosts that are
 * local, private, or otherwise unsafe as webhook targets.
 */
export function assertSafeOutboundUrl(raw: string): SsrfCheckResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'url must be a valid absolute URL' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: 'url must be http(s)' };
  }

  // Prefer HTTPS for custom webhooks; Slack/Discord inbound URLs are
  // always HTTPS in practice. Allow http only for non-loopback hosts
  // so local-dev operators aren't blocked, but still reject private IPs.
  const host = url.hostname.toLowerCase();

  if (!host) {
    return { ok: false, error: 'url must include a hostname' };
  }

  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.local')) {
    return { ok: false, error: 'url must not target a local or metadata host' };
  }

  if (isIpv4(host) && isPrivateOrLocalIpv4(host)) {
    return { ok: false, error: 'url must not target a private or loopback IP' };
  }

  if (isIpv6Literal(host) && isBlockedIpv6(host)) {
    return { ok: false, error: 'url must not target a private or loopback IP' };
  }

  // Reject credentials in the URL (https://user:pass@host) — they often
  // hide SSRF attempts and end up in logs.
  if (url.username || url.password) {
    return { ok: false, error: 'url must not include userinfo' };
  }

  return { ok: true, url };
}

/**
 * Fetch an outbound URL after validating the URL shape and that every
 * DNS-resolved address is public.
 *
 * Residual TOCTOU: DNS can flip between lookup and connect (classic
 * rebinding). We intentionally do NOT rewrite the URL to a pinned IP
 * (that breaks TLS SNI/certs for Slack/Discord). The pre-fetch lookup
 * still closes the common case where an attacker registers a public
 * A record then flips to 169.254 before we connect.
 */
export async function safeOutboundFetch(
  url: string,
  init?: RequestInit
): Promise<Response> {
  const check = assertSafeOutboundUrl(url);
  if (!check.ok) {
    throw new Error(check.error);
  }

  const hostname = check.url.hostname;
  // Literal IPs were already checked by assertSafeOutboundUrl; still
  // re-check via isBlockedResolvedAddress for a single code path.
  if (isIpv4(hostname) || isIpv6Literal(hostname)) {
    if (isBlockedResolvedAddress(hostname)) {
      throw new Error('resolved address is not allowed');
    }
  } else {
    const records = await dns.lookup(hostname, { all: true });
    if (records.length === 0) {
      throw new Error('resolved address is not allowed');
    }
    for (const rec of records) {
      if (isBlockedResolvedAddress(rec.address)) {
        throw new Error('resolved address is not allowed');
      }
    }
  }

  return fetch(url, init);
}
