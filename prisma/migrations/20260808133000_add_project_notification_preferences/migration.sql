CREATE TABLE "ProjectNotificationPreference" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "newPinEmail" BOOLEAN NOT NULL DEFAULT false,
    "newCommentEmail" BOOLEAN NOT NULL DEFAULT false,
    "statusChangeEmail" BOOLEAN NOT NULL DEFAULT false,
    "assignmentEmail" BOOLEAN NOT NULL DEFAULT false,
    "mentionEmail" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectNotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectNotificationPreference_projectId_userId_key"
ON "ProjectNotificationPreference"("projectId", "userId");

CREATE INDEX "ProjectNotificationPreference_userId_idx"
ON "ProjectNotificationPreference"("userId");

ALTER TABLE "ProjectNotificationPreference"
ADD CONSTRAINT "ProjectNotificationPreference_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectNotificationPreference"
ADD CONSTRAINT "ProjectNotificationPreference_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
