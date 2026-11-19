CREATE TABLE "access_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"company" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invited_at" timestamp with time zone,
	CONSTRAINT "access_requests_email_unique" UNIQUE("email")
);
