// DNS rebinding: the pre-flight check (`assertSafeOutboundUrl`) and the
// connection each resolve the hostname, so a 0-TTL record can answer the
// check with a public IP and the connection with a private one.
// `safeFetch` re-checks the address at connect time. These tests use real
// sockets on localhost.

import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Agent } from 'undici';
import { guardedLookup, safeFetch } from '../../src/lib/safe-url';

let server: http.Server;
let port: number;
let connections = 0;

beforeAll(async () => {
  server = http.createServer((_req, res) => res.end('ok'));
  server.on('connection', () => {
    connections += 1;
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('safeFetch', () => {
  it('refuses to connect when the hostname resolves to a private address', async () => {
    const before = connections;
    // `localhost` stands in for a rebound record: it resolves to 127.0.0.1
    // at connect time.
    const err = await safeFetch(`http://localhost:${port}/`, {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect((err as { cause?: { code?: string } }).cause?.code).toBe('EADDRBLOCKED');
    expect(connections).toBe(before);
  });

  it('connects normally through the guarded lookup when the address is allowed', async () => {
    // Same dispatcher wiring as safeFetch, with the block list switched off,
    // proves Node's fetch accepts the undici Agent and the lookup.
    const agent = new Agent({ connect: { lookup: guardedLookup(() => false) } });
    const res = await fetch(`http://localhost:${port}/`, { dispatcher: agent } as RequestInit);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
    await agent.close();
  });
});

describe('guardedLookup', () => {
  function run(options: { all?: boolean }, isBlocked: (ip: string) => boolean) {
    return new Promise<{ err: NodeJS.ErrnoException | null; address: unknown; family?: number }>((resolve) => {
      guardedLookup(isBlocked)('localhost', options, (err, address, family) =>
        resolve({ err, address, family }),
      );
    });
  }

  it('returns a single address, or all of them when asked', async () => {
    const one = await run({}, () => false);
    expect(one.err).toBeNull();
    expect(typeof one.address).toBe('string');
    const all = await run({ all: true }, () => false);
    expect(Array.isArray(all.address)).toBe(true);
  });

  it('blocks when any resolved address is blocked', async () => {
    const isBlocked = vi.fn((ip: string) => ip === '127.0.0.1' || ip === '::1');
    const res = await run({ all: true }, isBlocked);
    expect(res.err?.code).toBe('EADDRBLOCKED');
    expect(isBlocked).toHaveBeenCalled();
  });
});
