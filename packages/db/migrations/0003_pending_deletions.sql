CREATE TABLE "pending_deletions" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"target" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_deletions_kind" CHECK ("pending_deletions"."kind" in ('storage-folder', 'workos-organization', 'workos-user', 'workos-invitation'))
);
