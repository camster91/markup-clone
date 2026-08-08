import { execFileSync } from 'node:child_process';
import {
  normalizeLoadConfig,
  runPinLoad,
} from './lib/load-harness.mjs';
import {
  LOAD_API_KEY,
  LOAD_PROJECT_ID,
} from './lib/load-fixture.mjs';

const config = normalizeLoadConfig({
  baseUrl: process.env.LOAD_BASE_URL,
  requests: process.env.LOAD_REQUESTS,
  concurrency: process.env.LOAD_CONCURRENCY,
  maxP95Ms: process.env.LOAD_MAX_P95_MS,
});
const fixtureCommand = [
  'exec',
  'markup-clone',
  'node',
  '/opt/app-scripts/local-load-fixture.mjs',
];
const runFixture = (action) => JSON.parse(execFileSync(
  'docker',
  [...fixtureCommand, action],
  { encoding: 'utf8' },
));

let cleanup;
try {
  runFixture('cleanup');
  runFixture('seed');
  const result = await runPinLoad(config, {
    projectId: LOAD_PROJECT_ID,
    apiKey: LOAD_API_KEY,
  });
  console.log(
    `Local pin load: ${result.summary.requestCount} requests at concurrency ${config.concurrency}; `
    + `p95 ${result.summary.p95Ms}ms; ${result.summary.throughputRps.toFixed(2)} req/s`,
  );
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    config,
    summary: result.summary,
    failures: result.failures,
    failedResponses: result.results.filter((row) => row.status !== 201),
  }));
  if (result.failures.length > 0) process.exitCode = 1;
} finally {
  cleanup = runFixture('cleanup');
  console.log(`Cleanup verified: ${JSON.stringify(cleanup)}`);
}
