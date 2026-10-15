// Every index the migrations leave in place must be declared in
// prisma/schema.prisma. An index that exists only in a migration is
// invisible to Prisma, so the next `prisma migrate dev` generates a
// DROP INDEX for it. Pin.screenshotId, Screenshot.pageId, Comment.pinId
// and Project.teamId were missing this way.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const MIGRATIONS = join(ROOT, 'prisma/migrations');

function liveMigrationIndexes(): Map<string, { table: string; columns: string[] }> {
  const live = new Map<string, { table: string; columns: string[] }>();
  const dirs = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const dir of dirs) {
    const sql = readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
    const statements = sql.replace(/--.*$/gm, '').split(';');
    for (const stmt of statements) {
      const create = stmt.match(
        /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF NOT EXISTS\s+)?"([^"]+)"\s+ON\s+"([^"]+)"\s*(?:USING\s+\w+\s*)?\(([^)]*)\)/i
      );
      if (create) {
        const columns = create[3].split(',').map((c) => c.trim().replace(/^"|"(\s+\w+)*$/g, ''));
        live.set(create[1], { table: create[2], columns });
        continue;
      }
      const drop = stmt.match(/DROP\s+INDEX\s+(?:IF EXISTS\s+)?"([^"]+)"/i);
      if (drop) live.delete(drop[1]);
      const rename = stmt.match(/ALTER\s+INDEX\s+"([^"]+)"\s+RENAME\s+TO\s+"([^"]+)"/i);
      if (rename && live.has(rename[1])) {
        live.set(rename[2], live.get(rename[1])!);
        live.delete(rename[1]);
      }
      const dropTable = stmt.match(/DROP\s+TABLE\s+(?:IF EXISTS\s+)?"([^"]+)"/i);
      if (dropTable) {
        for (const [name, idx] of live) if (idx.table === dropTable[1]) live.delete(name);
      }
    }
  }
  return live;
}

function declaredIndexes(): Set<string> {
  const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8');
  const declared = new Set<string>();
  for (const model of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const [, name, body] = model;
    for (const attr of body.matchAll(/@@(?:index|unique|id)\(\s*\[([^\]]*)\]/g)) {
      const cols = attr[1].split(',').map((c) => c.trim().replace(/\(.*\)$/, ''));
      declared.add(`${name}(${cols.join(',')})`);
    }
    for (const field of body.matchAll(/^\s*(\w+)\s+\S+.*@(?:unique|id)\b/gm)) {
      declared.add(`${name}(${field[1]})`);
    }
  }
  return declared;
}

describe('schema.prisma declares every migration index', () => {
  it('has no index that exists only in migrations', () => {
    const declared = declaredIndexes();
    const missing = [...liveMigrationIndexes()]
      .filter(([, idx]) => !declared.has(`${idx.table}(${idx.columns.join(',')})`))
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });
});
