CREATE TABLE "dazbee_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"invited_by" text,
	"provider_invite_id" text,
	"link" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dazbee_invites" ADD CONSTRAINT "dazbee_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dazbee_invites_email" ON "dazbee_invites" USING btree ("email");