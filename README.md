# Visual Feedback Tool (Markup.io Clone)

A self-hosted visual feedback tool for agency client reviews. Clients drop a pin anywhere on a staging site, a PDF, or an uploaded image, and the team triages, discusses and resolves that feedback from one dashboard.

## What it does and why

Collecting website feedback over email and screenshots is slow and loses context. This app gives each project a small script-tag widget. A client clicks on the page, writes a comment, and the widget sends the pin with its X/Y position, a DOM selector and a screenshot. The agency dashboard groups that feedback by client site and review round, keeps a threaded discussion per pin, and can push new feedback to Slack, Discord, a signed webhook or GitHub Issues.

It is built as a self-hosted alternative to hosted tools like Markup.io, with role-aware teams, workspace branding and a versioned developer API.

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
- PDF review (up to 50 pages, rendered server-side) and image review uploads
- Server-side recapture of a page with headless Chromium, with screenshot version history
- Managed public share links for client review without an account
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

- Next.js 16 (App Router, standalone output), React 19, TypeScript
- PostgreSQL with Prisma 6
- Tailwind CSS 4, Heroicons
- Vite for the standalone widget bundle (`public/widget.js`)
- npm workspaces: `packages/markup-core` (shared server helpers) and `packages/markup-sdk` (browser SDK)
- Vitest, Testing Library, jsdom and Supertest for unit and integration tests; Playwright for E2E
- Docker multi-stage build and Docker Compose for local development
- GitHub Actions for build, lint and tests

## Getting started

Requirements: Docker with Compose, or Node.js 20+ and a PostgreSQL database.

### With Docker Compose (recommended)

```bash
cp .env.example .env    # fill in the placeholders
docker compose up --build
```

The stack starts PostgreSQL, runs every Prisma migration in a one-shot `migrate` service, then serves the app at http://localhost:3030 (change it with `APP_PORT`).

### With Node.js

```bash
npm install
cp .env.example .env    # set DATABASE_URL and the other required values
npx prisma migrate deploy
npm run dev
```

All environment variables are documented in `.env.example`. Required at runtime: `DATABASE_URL`, `DASHBOARD_HOST`, `SCREENSHOTS_DIR`, `DELIVERY_WORKER_SECRET` and `INTEGRATION_ENCRYPTION_KEY`. Mailgun settings are optional; email is a no-op without them.

### Useful scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Builds the widget, the workspace packages, then the Next.js app |
| `npm run build:widget` | Builds `public/widget.js` with Vite |
| `npm start` | Runs the production build |
| `npm run lint` | ESLint |

## Embedding the widget

```html
<script
  src="https://<your-host>/widget.js"
  data-api-key="<project apiKey>"
  data-project-id="<project uuid>"></script>
```

The dashboard shows the exact snippet for each project.

## Developer docs

- [Developer API v1](docs/developer-api-v1.md)
- [OpenAPI spec](docs/api/openapi-v1.yaml) (also served at `/api/v1/openapi.json`)
- [Browser SDK](packages/markup-sdk/README.md)
- [Rate limit notes](docs/rate-limit-limitations.md)

## Testing

```bash
npm test                  # Vitest: unit, integration, component and widget tests
npm run test:coverage     # same, with V8 coverage
npm run test:e2e          # Playwright in Chromium, Firefox and WebKit
npm run test:load:local   # local-only pin ingestion load rehearsal (needs the Compose stack)
```

Run `npx playwright install chromium firefox webkit` once before the E2E suite.

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
├── prisma/              # Schema and migrations
├── tests/               # unit, integration, components, widget, e2e
├── docs/                # API docs and plans
├── Dockerfile
└── docker-compose.yml   # Local development stack
```

## License

MIT, see [LICENSE](LICENSE).

---

Built by Cameron Ashley at [Ashbi Design](https://ashbi.ca).
