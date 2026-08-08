# Developer API v1

The v1 API is a read-only, server-to-server interface for turning visual feedback
into development work. Its contract is served at `/api/v1/openapi.json` and checked
in at `docs/api/openapi-v1.yaml`.

## Credentials and safety

- The **widget key** is embedded in the client website. It may submit feedback and
  must not authorize read access to issues, comments, people, or developer context.
- A **developer token** begins with `mkv1_`, is shown once, and authorizes only its
  project and `issues:read` scope. The server stores a SHA-256 hash, not the secret.

Create tokens from a site's **Developer API access** panel. Put them in a server-side
secret store, never client JavaScript, source control, logs, screenshots, or URLs.
Create a replacement, verify it, then revoke the old token. Revocation is immediate;
optional expiry is capped at 366 days.

```http
GET /api/v1/projects/PROJECT_UUID/issues?status=OPEN&limit=50 HTTP/1.1
Authorization: Bearer mkv1_REDACTED
Accept: application/json
```

Filters are `status`, `priority`, `assigneeId`, `tagId`, and `reviewRoundId`.
`limit` is 1–100. Send a non-null `pagination.nextCursor` as `cursor` for the next
page. Items use `visual-feedback.issue.v1`. Responses are `no-store`; browser CORS
is not enabled. Respect `Retry-After` on `429` responses.
