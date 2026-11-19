// User media (screenshots, comment attachments, review images).
//
// On Cloudflare, files live in the MEDIA R2 bucket. Locally and in tests,
// they still use the filesystem directories in storage-dirs.ts so existing
// fs/promises mocks keep working.

import { mkdir, readFile, rename, stat, unlink, writeFile } from 'fs/promises';
import path from 'node:path';
import { attachmentsDir, screenshotsDir } from '@/lib/storage-dirs';

export type MediaKind = 'screenshots' | 'attachments';

type R2BucketLike = {
  put: (key: string, value: ArrayBuffer | Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) => Promise<unknown>;
  get: (key: string) => Promise<{ arrayBuffer: () => Promise<ArrayBuffer>; httpMetadata?: { contentType?: string }; size?: number; uploaded?: Date } | null>;
  delete: (key: string) => Promise<unknown>;
  head: (key: string) => Promise<{ size?: number; uploaded?: Date } | null>;
};

function dirFor(kind: MediaKind): string {
  return kind === 'attachments' ? attachmentsDir() : screenshotsDir();
}

function r2Key(kind: MediaKind, name: string): string {
  return `${kind}/${name}`;
}

async function mediaBucket(): Promise<R2BucketLike | undefined> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const { env } = await getCloudflareContext({ async: true });
    return (env as { MEDIA?: R2BucketLike } | undefined)?.MEDIA;
  } catch {
    return undefined;
  }
}

export async function writeStoredFile(
  kind: MediaKind,
  name: string,
  bytes: Uint8Array,
  contentType?: string,
): Promise<void> {
  const bucket = await mediaBucket();
  if (bucket) {
    await bucket.put(r2Key(kind, name), bytes, contentType ? { httpMetadata: { contentType } } : undefined);
    return;
  }
  const dir = dirFor(kind);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), bytes);
}

export async function renameStoredFile(kind: MediaKind, from: string, to: string): Promise<void> {
  const bucket = await mediaBucket();
  if (bucket) {
    const object = await bucket.get(r2Key(kind, from));
    if (!object) throw new Error(`missing media object ${from}`);
    const bytes = new Uint8Array(await object.arrayBuffer());
    await bucket.put(r2Key(kind, to), bytes, object.httpMetadata?.contentType ? { httpMetadata: { contentType: object.httpMetadata.contentType } } : undefined);
    await bucket.delete(r2Key(kind, from));
    return;
  }
  const dir = dirFor(kind);
  await rename(path.join(dir, from), path.join(dir, to));
}

export async function readStoredFile(kind: MediaKind, name: string): Promise<{ bytes: Uint8Array; contentType?: string } | null> {
  const bucket = await mediaBucket();
  if (bucket) {
    const object = await bucket.get(r2Key(kind, name));
    if (!object) return null;
    return {
      bytes: new Uint8Array(await object.arrayBuffer()),
      contentType: object.httpMetadata?.contentType,
    };
  }
  try {
    const bytes = new Uint8Array(await readFile(path.join(dirFor(kind), name)));
    return { bytes };
  } catch {
    return null;
  }
}

export async function statStoredFile(kind: MediaKind, name: string): Promise<{ size: number; mtime: Date } | null> {
  const bucket = await mediaBucket();
  if (bucket) {
    const object = await bucket.head(r2Key(kind, name));
    if (!object) return null;
    return { size: object.size ?? 0, mtime: object.uploaded ?? new Date() };
  }
  try {
    const info = await stat(path.join(dirFor(kind), name));
    return { size: info.size, mtime: info.mtime };
  } catch {
    return null;
  }
}

export async function deleteStoredFile(kind: MediaKind, name: string): Promise<void> {
  const bucket = await mediaBucket();
  if (bucket) {
    await bucket.delete(r2Key(kind, name));
    return;
  }
  await unlink(path.join(dirFor(kind), name));
}
