# Visual Feedback Tool (Markup.io Clone)

A self-hosted visual feedback tool for agency client reviews. Clients drop a pin anywhere on a staging site, a PDF, or an uploaded image, and the team triages, discusses and resolves that feedback from one dashboard.

## What it does and why

Collecting website feedback over email and screenshots is slow and loses context. This app gives each project a small script-tag widget. A client clicks on the page, writes a comment, and the widget sends the pin with its X/Y position, a DOM selector and a screenshot. The agency dashboard groups that feedback by client site and review round, keeps a threaded discussion per pin, and can push new feedback to Slack, Discord, a signed webhook or GitHub Issues.

It is built as a self-hosted alternative to hosted tools like Markup.io, with role-aware teams, workspace branding and a versioned developer API.

## Status

Version 0.1.0. The application code is built and has unit, integration and browser tests. In November 2026 the app was ported from Docker and PostgreSQL on a VPS to Cloudflare Workers (OpenNext), D1 and R2. That move is not finished:

| Area | On Cloudflare Workers today |
|---|---|
| Pins, comments, image review | Ported to D1 and R2 (`src/lib/prisma.ts`, `src/lib/object-store.ts`) |
| PDF review | Not available: it runs the Poppler tools `pdfinfo` and `pdftoppm` |
| Server-side recapture | Not available: it runs a bash, Chromium and `psql` script |
| Outbound delivery processing | Nothing calls the processor: `wrangler.jsonc` has no cron trigger |
| Live updates and rate limits | Kept in memory per process, so not shared between Worker instances |

`Dockerfile`, `docker-compose.yml`, `scripts/deploy.sh`, the host scripts and parts of `docs/` still describe the old PostgreSQL stack. They do not match the current SQLite/D1 Prisma schema, so do not rely on them.

## Key features

**Client widget**
- One `<script>` tag with `data-api-key` and `data-project-id`; no iframe
- Click-to-pin with X/Y coordinates, a DOM selector for re-anchoring, and a screenshot upload
- Keyboard and touch accessible, tested at 320px in Chromium, Firefox and WebKit
- Optional typed browser SDK (`packages/markup-sdk`) with `mount()`, `startFeedback()`, `on()` and `destroy()`

**Dashboard**
- Workspaces, teams and invitations with role enforcement on every API route
- Client sites with review rounds, sign-offs and reversible archiving
- Per-pin comment threads with `@mentions`, open/resolved status, and internal issue metadata (assignee, priority and similar fields)
- Developer context and structured hand-off on each pin
- Image review uploads, and PDF review (up to 50 pages; needs Poppler, see [Status](#status))
- Server-side recapture of a page with headless Chromium, with screenshot version history (legacy stack only, see [Status](#status))
- Managed, read-only public share links, so a client can view a review without an account
- Workspace branding and a client review mode
- Live updates and presence over server-sent events

**Integrations and API**
- Durable outbound delivery queue for Slack, Discord, generic webhooks and GitHub Issues, with bounded retries and a dead-letter state
- Generic webhooks are signed with HMAC-SHA256 (`X-Visual-Feedback-Signature`)
- GitHub tokens are encrypted at rest with AES-256-GCM and never returned by the API
- Versioned developer API with project-scoped tokens and an OpenAPI 3 spec
- Member email notifications through Mailgun, with per-member, role-aware preferences

**Security**
- Session auth with CSRF and origin checks for the dashboard, project keys for the widget
- Rate limiting on pin, comment and screenshot status routes
- Strict input validation on IDs and uploads, plus an audit log of dashboard writes

## Tech stack

- Next.js 16 (App Router), React 19, TypeScript
- OpenNext on Cloudflare Workers, with D1 (binding `DB`) and R2 (binding `MEDIA`)
- Prisma 7 with the D1 adapter in production and SQLite (`better-sqlite3`) locally
- Tailwind CSS 4, Heroicons
- Vite for the standalone widget bundle (`public/widget.js`)
- npm workspaces: `packages/markup-core` (shared server helpers) and `packages/markup-sdk` (browser SDK)
- Vitest, Testing Library, jsdom and Supertest for unit and integration tests; Playwright for E2E
- GitHub Actions for build, lint and tests

## Getting started

Requirements: Node.js 24 (see `.nvmrc`) and npm. Local development uses a SQLite file; no database server is needed.

```bash
npm install
cp .env.example .env    # then set the values below
npx prisma generate
npx prisma db push      # creates dev.db from prisma/schema.prisma
npm run build:packages  # shared packages the app imports
npm run build:widget    # public/widget.js
npm run dev             # http://localhost:3000
```

For local work, set these in `.env`:

- `DATABASE_URL=file:./dev.db`
- `NODE_ENV`: remove the `production` value that the example sets
- `DASHBOARD_HOST=http://localhost:3000`: dashboard requests from any other origin are rejected
- `SCREENSHOTS_DIR`: a folder you can write to, outside the repo

When there are no users yet, the sign-in page offers to create the first operator. That closes after the first account.

Do not run `prisma migrate deploy`: `prisma/migrations/` holds the old PostgreSQL migrations, kept for schema tests. The D1 schema is in `d1/migrations/`.

### Environment variables

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Local SQLite file. Production uses the D1 binding instead |
| `DASHBOARD_HOST` | Public dashboard host or origin |
| `SCREENSHOTS_DIR`, `ATTACHMENTS_DIR` | Local file storage. Production uses R2 |
| `INTEGRATION_ENCRYPTION_KEY` | Encrypts stored integration credentials |
| `DELIVERY_WORKER_SECRET` | Protects the delivery processor (32 characters or more) |
| `MAILGUN_API_KEY`, `MAILGUN_DOMAIN` | Optional. Email is off without them |
| `TRUSTED_PROXY_HOPS`, `TRUST_X_REAL_IP` | How the client IP is found for rate limits |
| `RECAPTURE_SCRIPT` | Path of the legacy recapture script |

`.env.example` explains each one. Its host and deploy settings belong to the old VPS setup.

### Useful scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Builds the widget, the workspace packages, then the Next.js app |
| `npm run build:cf` | Builds the Cloudflare Worker with OpenNext |
| `npm run preview` | Builds the Worker and runs it locally |
| `npm run build:widget` | Builds `public/widget.js` with Vite |
| `npm start` | Runs the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | Builds the packages, then runs TypeScript |

## Embedding the widget

```html
<script
  src="https://<your-host>/widget.js"
  data-api-key="<project apiKey>"
  data-project-id="<project uuid>"></script>
```

The dashboard shows the exact snippet for each project.

## Developer docs

- [Operations](docs/OPERATIONS.md) (written for the old VPS stack)
- [Developer API v1](docs/developer-api-v1.md)
- [OpenAPI spec](docs/api/openapi-v1.yaml) (also served at `/api/v1/openapi.json`)
- [Browser SDK](packages/markup-sdk/README.md)
- [Rate limit notes](docs/rate-limit-limitations.md)

## Deployment

The Worker is named `markup` and is configured in `wrangler.jsonc`, which sets D1, R2 and a `workers.dev` address but no custom domain.

`npm run deploy` builds with OpenNext and deploys. Cloudflare Workers Builds is the intended route from `main`, with Node 24, build command `npm run build:cf` and deploy command `npx wrangler deploy`.

- Deploying does not apply database changes. Apply them with `npx wrangler d1 migrations apply markup --remote`.
- Set secrets with `npx wrangler secret put NAME`: `INTEGRATION_ENCRYPTION_KEY`, and if used `DELIVERY_WORKER_SECRET`, `MAILGUN_API_KEY` and `MAILGUN_DOMAIN`.
- Set `DASHBOARD_HOST` to the address people use. `wrangler.jsonc` does not set it.
- Something must call `POST /api/internal/integration-deliveries/process` with the bearer secret for outbound deliveries to be sent. This is not set up for the Worker yet.

The old VPS steps are in the [deploy runbook](docs/DEPLOY-RUNBOOK.md). Its host cron jobs (screenshot pruning, delivery processing through `/etc/cron.d/markup-integration-delivery`, and backups) do not run on Cloudflare, and no D1 or R2 backup is configured in this repo.

### Outbound integrations

Pin creation writes an immutable `visual-feedback.event.v1` envelope and one
delivery per configured target in the same transaction. Generic webhooks are
signed: `X-Visual-Feedback-Signature` is `v1=` plus the HMAC-SHA256 of
`timestamp.payload`. Retryable failures use a bounded schedule of five attempts;
permanent failures or an exhausted budget enter `DEAD_LETTER`, and project
admins can retry from the delivery log. GitHub Issues delivery needs a
fine-grained token limited to one repository with **Metadata: read** and
**Issues: write**; it is encrypted under `INTEGRATION_ENCRYPTION_KEY` and never
returned by the API.

## Testing

```bash
npm test                  # Vitest: unit, integration, component and widget tests
npm run test:coverage     # same, with V8 coverage
npm run test:e2e          # Playwright in Chromium, Firefox and WebKit
npm run test:load:local   # pin ingestion load rehearsal (needs the legacy Compose stack)
```

Run `npx playwright install chromium firefox webkit` once before the E2E suite.
CI runs lint, the type check, `npm test` and the build. It does not run the E2E suite.
`npm run test:smoke` creates data on the production host unless you set `HOST`.

## Project structure

```
.
├── src/
│   ├── app/             # Next.js App Router pages and API routes
│   ├── components/      # Dashboard UI
│   ├── lib/             # Auth, validation, integrations, review workflow, email
│   └── widget/          # Source for the embeddable widget
├── packages/
│   ├── markup-core/     # Shared server helpers
│   └── markup-sdk/      # Typed browser SDK
├── prisma/              # Schema, and the old PostgreSQL migrations
├── d1/migrations/       # Current D1 schema
├── tests/               # unit, integration, components, widget, e2e
├── docs/                # API docs and plans
├── wrangler.jsonc       # Cloudflare Worker, D1 and R2 config
└── Dockerfile, docker-compose.yml   # Legacy stack
```

## License

MIT, see [LICENSE](LICENSE).

---

Built by Cameron Ashley at [Ashbi Design](https://ashbi.ca).
