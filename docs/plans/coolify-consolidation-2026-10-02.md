# Coolify consolidation — October 2, 2026

Status: configuration preparation; no live cutover.
Scope: Cameron's approved VPS consolidation, separate from the product launch.

1. Preserve verified PostgreSQL/screenshot/script backups and preceding images.
2. Prepare raw Compose application deployment and host pre-deploy backup guard.
3. Validate an isolated private candidate without provider sends or live writes.
4. Adopt the application with the current database first; preserve origin/port,
   encryption keys, script access, delivery worker and screenshot retention.
5. Adopt PostgreSQL separately after restore, app compatibility and rollback
   checks. Preserve the original database container while its image is unavailable.
6. Verify signed GitHub main auto-deploy, then retire proven redundant copies.

Acceptance and prerequisites: `deploy/COOLIFY.md`. Neither application adoption
alone nor local tests satisfy full-stack migration and automatic deployment.
