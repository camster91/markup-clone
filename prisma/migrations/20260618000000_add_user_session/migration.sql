-- Migration: add_user_session
-- Add the User + Session models for per-user dashboard identity.
--
-- User holds the email + passwordHash + role. email is unique (login
-- is keyed on it, case-insensitive at the route layer; we store
-- lowercased). passwordHash is a node:crypto scrypt output in the
-- "scrypt$N$r$p$salt$hash" format produced by src/lib/password.ts.
--
-- Session is the server-side record of an issued login cookie. The
-- `token` is a 64-char base64url random string (32 bytes of entropy);
-- the unique index makes the token a globally unique lookup key. The
-- 7-day expiry matches the cookie's maxAge.
--
-- Relationship: Session.userId -> User.id with ON DELETE CASCADE, so
-- removing a user removes their sessions. We do NOT add a FK on
-- Presence.userId today — Presence is still keyed on a client-generated
-- localStorage UUID until the dashboard is fully migrated. F10
-- (session-derived userId) is the follow-up.
--
-- Role: free-form string ("operator" | "reviewer"). Same convention as
-- Pin.status / Annotation.kind — the API + UI enforce the closed set,
-- the DB column is permissive so adding a new role is a single edit.

-- Create User table
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'reviewer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- Email is the login key. Unique index enforces "one account per email".
-- The route layer normalizes email to lowercase before insert/lookup so
-- case-only duplicates cannot slip in via the API. The column itself
-- stores the canonical lowercased form.
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- Create Session table
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- Token is the cookie value. Unique index backs the per-issuance
-- uniqueness guarantee (1 - 2^-256 collision probability for a 32-byte
-- random token). This is the lookup key on every authenticated request.
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- Hot path: requireAuth() does `SELECT ... FROM Session WHERE token = ?`
-- so the unique index on token covers it. The userId index supports a
-- "list my sessions" admin query if we ever add one, and the expiresAt
-- index supports a background sweeper that drops expired rows.
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- Cascade: deleting a user removes their sessions. The reverse is
-- impossible (a session belongs to exactly one user) so we only need
-- the forward cascade.
ALTER TABLE "Session"
 ADD CONSTRAINT "Session_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
