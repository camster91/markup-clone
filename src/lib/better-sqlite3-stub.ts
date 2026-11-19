// Wrangler aliases native sqlite packages to this stub in the Worker bundle.
// Local Next.js, tests, and scripts still resolve the real packages.
export class PrismaBetterSqlite3 {
  constructor() {
    throw new Error('better-sqlite3 is not available in the Cloudflare Worker runtime');
  }
}

export default PrismaBetterSqlite3;
