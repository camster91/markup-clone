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
//     (blocks hostnames that statically resolve to a private IP,
//     e.g. 127.0.0.1.nip.io)
//
// DNS rebinding (TOCTOU): `assertSafeOutboundUrl` resolves the hostname,
// then the connection resolves it AGAIN, so a hostile authoritative server
// with a 0-TTL record could answer the check with a public IP and the
// connection with a private one. `safeFetch` closes that gap: its
// dispatcher re-checks every address at connect time, so the address the
// socket actually uses is the one that was checked. `redirect: 'error'` on
// every adapter closes the redirect variant.
//
// Callers pass the raw URL string; on success they get a normalized
// absolute URL string ready to store / fetch.

import { isIP } from 'net';
import dns from 'dns';
import { lookup } from 'dns/promises';
import { Agent } from 'undici';

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

/**
 * Parse an IPv6 literal into eight 16-bit groups. Handles `::`
 * compression, a trailing dotted-quad (`::ffff:1.2.3.4`) and a zone id
 * (`fe80::1%eth0`). Returns null when the string is not valid IPv6.
 */
export function parseIpv6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);

  // Fold a trailing embedded IPv4 into two hex groups.
  const lastColon = s.lastIndexOf(':');
  if (lastColon < 0) return null;
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    const octets = tail.split('.');
    if (octets.length !== 4 || octets.some((o) => !/^\d{1,3}$/.test(o) || Number(o) > 255)) {
      return null;
    }
    const [a, b, c, d] = octets.map(Number) as [number, number, number, number];
    s = `${s.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  let groups: string[];
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    groups = head;
  } else {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...Array<string>(fill).fill('0'), ...rest];
  }
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

function embeddedIpv4(groups: number[]): string {
  const hi = groups[6]!;
  const lo = groups[7]!;
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/**
 * True if an IPv6 address is loopback / unspecified / link-local /
 * site-local / ULA / multicast, an IPv4-embedding form (mapped,
 * translated, compatible) whose IPv4 is blocked, or a transition
 * prefix that can tunnel to arbitrary IPv4 (NAT64, 6to4, Teredo).
 */
export function isBlockedIpv6(ip: string): boolean {
  const g = parseIpv6(ip);
  if (!g) return true; // unparseable → treat as blocked
  const [g0, g1, g2, g3, g4, g5] = g as [number, number, number, number, number, number];
  const first96Zero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;

  // ::/128 unspecified, ::1/128 loopback, and IPv4-compatible ::a.b.c.d
  if (first96Zero && g5 === 0) {
    if (g[6] === 0 && (g[7] === 0 || g[7] === 1)) return true;
    return isBlockedIpv4(embeddedIpv4(g));
  }
  // ::ffff:0:0/96 IPv4-mapped (dotted or hex form, e.g. ::ffff:7f00:1)
  if (first96Zero && g5 === 0xffff) return isBlockedIpv4(embeddedIpv4(g));
  // ::ffff:0:a.b.c.d/96 IPv4-translated (RFC 2765)
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0xffff && g5 === 0) {
    return isBlockedIpv4(embeddedIpv4(g));
  }
  // 64:ff9b::/96 NAT64 well-known prefix and 64:ff9b:1::/48 local-use NAT64
  if (g0 === 0x64 && g1 === 0xff9b) return true;
  // 2002::/16 6to4 (embeds an arbitrary IPv4 in bits 16-48)
  if (g0 === 0x2002) return true;
  // 2001:0::/32 Teredo (embeds an obfuscated IPv4)
  if (g0 === 0x2001 && g1 === 0) return true;
  // 2001:db8::/32 documentation
  if (g0 === 0x2001 && g1 === 0xdb8) return true;
  // 100::/64 discard-only
  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return true;
  // fe80::/10 link-local and fec0::/10 site-local (deprecated) → fe80::/9
  if ((g0 & 0xff80) === 0xfe80) return true;
  // fc00::/7 unique-local
  if ((g0 & 0xfe00) === 0xfc00) return true;
  // ff00::/8 multicast
  if ((g0 & 0xff00) === 0xff00) return true;
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

  // `URL.hostname` keeps the brackets on IPv6 literals ("[::1]"), which
  // `isIP` does not recognise — strip them for the checks below. Also
  // drop a single trailing root dot so "localhost." matches the denylist.
  let host = url.hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host.endsWith('.')) host = host.slice(0, -1);
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
  if (isIP(host) || host.includes(':')) {
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

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

/**
 * A `lookup` for socket connects that refuses blocked addresses. It runs
 * at connect time, on the exact resolution the socket will use, which is
 * what defeats DNS rebinding. `isBlocked` is injectable for tests.
 */
export function guardedLookup(isBlocked: (ip: string) => boolean = isBlockedIp) {
  return (hostname: string, options: dns.LookupOptions, callback: LookupCallback): void => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) {
        callback(err, '');
        return;
      }
      if (addresses.length === 0 || addresses.some((a) => isBlocked(a.address))) {
        const blocked: NodeJS.ErrnoException = new Error(
          `refusing to connect to ${hostname}: it resolves to a private/reserved address`,
        );
        blocked.code = 'EADDRBLOCKED';
        callback(blocked, '');
        return;
      }
      if (options.all) {
        callback(null, addresses);
        return;
      }
      callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  };
}

const outboundAgent = new Agent({ connect: { lookup: guardedLookup() } });

/**
 * `fetch` for operator-supplied URLs. Call `assertSafeOutboundUrl` first
 * for a clear rejection message; this adds the connect-time check that
 * the pre-flight lookup cannot give.
 */
export function safeFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, dispatcher: outboundAgent } as RequestInit);
}
