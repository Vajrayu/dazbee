CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"sha256" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "assets_brand_sha256" UNIQUE("brand_id","sha256")
);
--> statement-breakpoint
CREATE TABLE "brand_kits" (
	"brand_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"colors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fonts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"logo_asset_id" text,
	"voice" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_id_workspace" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "design_journal" (
	"design_id" text NOT NULL,
	"entry" bigint NOT NULL,
	"kind" text NOT NULL,
	"member" jsonb,
	"body" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_journal_design_id_entry_pk" PRIMARY KEY("design_id","entry"),
	CONSTRAINT "design_journal_kind" CHECK ("design_journal"."kind" in ('issued', 'accepted', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "design_journal_dead" (
	"design_id" text NOT NULL,
	"entry" bigint NOT NULL,
	"kind" text NOT NULL,
	"member" jsonb,
	"body" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text NOT NULL,
	"moved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_journal_dead_design_id_entry_pk" PRIMARY KEY("design_id","entry")
);
--> statement-breakpoint
CREATE TABLE "design_saves" (
	"design_id" text PRIMARY KEY NOT NULL,
	"sync_id" text NOT NULL,
	"entry" bigint NOT NULL,
	"seq" bigint NOT NULL,
	"last_entry" bigint NOT NULL,
	"state" "bytea" NOT NULL,
	"placed" jsonb NOT NULL,
	"tabs" jsonb NOT NULL,
	"next_tab_id" integer NOT NULL,
	"versioned_seq" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"design_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"saved_by" text,
	"sync_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"schema_version" integer NOT NULL,
	"state" "bytea" NOT NULL,
	"thumbnail" "bytea",
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_versions_kind" CHECK ("design_versions"."kind" in ('named', 'auto', 'beforeRestore'))
);
--> statement-breakpoint
CREATE TABLE "designs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"name" text NOT NULL,
	"schema_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "font_faces" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"brand_id" text,
	"source" text NOT NULL,
	"family" text NOT NULL,
	"weight" integer NOT NULL,
	"weight_min" integer,
	"weight_max" integer,
	"style" text NOT NULL,
	"category" text,
	"sha256" text NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "font_faces_face" UNIQUE NULLS NOT DISTINCT("workspace_id","brand_id","family","weight","style"),
	CONSTRAINT "font_faces_weights" CHECK (("font_faces"."weight_min" is null and "font_faces"."weight_max" is null) or ("font_faces"."weight_min" <= "font_faces"."weight" and "font_faces"."weight" <= "font_faces"."weight_max" and "font_faces"."weight_min" < "font_faces"."weight_max")),
	CONSTRAINT "font_faces_scope" CHECK (("font_faces"."source" = 'google' and "font_faces"."workspace_id" is null and "font_faces"."brand_id" is null) or ("font_faces"."source" = 'upload' and "font_faces"."workspace_id" is not null and "font_faces"."brand_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"brand_ids" jsonb,
	"invited_by" text,
	"provider_invite_id" text,
	"link" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_brands" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"brand_id" text NOT NULL,
	CONSTRAINT "membership_brands_workspace_id_user_id_brand_id_pk" PRIMARY KEY("workspace_id","user_id","brand_id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"limited" boolean DEFAULT false NOT NULL,
	CONSTRAINT "memberships_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"brand_id" text,
	"from_brand_id" text NOT NULL,
	"name" text NOT NULL,
	"content" jsonb NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"workos_user_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_workos_user_id_unique" UNIQUE("workos_user_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"workos_organization_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_workos_organization_id_unique" UNIQUE("workos_organization_id")
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_brand_in_workspace" FOREIGN KEY ("brand_id","workspace_id") REFERENCES "public"."brands"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_logo_asset_id_assets_id_fk" FOREIGN KEY ("logo_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_brand_in_workspace" FOREIGN KEY ("brand_id","workspace_id") REFERENCES "public"."brands"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_journal" ADD CONSTRAINT "design_journal_design_id_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."designs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_journal_dead" ADD CONSTRAINT "design_journal_dead_design_id_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."designs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_saves" ADD CONSTRAINT "design_saves_design_id_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."designs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_versions" ADD CONSTRAINT "design_versions_design_id_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."designs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_versions" ADD CONSTRAINT "design_versions_saved_by_users_id_fk" FOREIGN KEY ("saved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "designs" ADD CONSTRAINT "designs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "designs" ADD CONSTRAINT "designs_brand_in_workspace" FOREIGN KEY ("brand_id","workspace_id") REFERENCES "public"."brands"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "font_faces" ADD CONSTRAINT "font_faces_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "font_faces" ADD CONSTRAINT "font_faces_brand_in_workspace" FOREIGN KEY ("brand_id","workspace_id") REFERENCES "public"."brands"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_brands" ADD CONSTRAINT "membership_brands_membership" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_brands" ADD CONSTRAINT "membership_brands_brand_in_workspace" FOREIGN KEY ("brand_id","workspace_id") REFERENCES "public"."brands"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_brand_in_workspace" FOREIGN KEY ("brand_id","workspace_id") REFERENCES "public"."brands"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_from_brand_in_workspace" FOREIGN KEY ("from_brand_id","workspace_id") REFERENCES "public"."brands"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brands_workspace" ON "brands" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "design_versions_design_taken" ON "design_versions" USING btree ("design_id","taken_at");--> statement-breakpoint
CREATE INDEX "designs_workspace_brand" ON "designs" USING btree ("workspace_id","brand_id");--> statement-breakpoint
CREATE INDEX "font_faces_brand" ON "font_faces" USING btree ("workspace_id","brand_id");--> statement-breakpoint
CREATE INDEX "invites_workspace_email" ON "invites" USING btree ("workspace_id","email");--> statement-breakpoint
CREATE INDEX "invites_email" ON "invites" USING btree ("email");--> statement-breakpoint
CREATE INDEX "memberships_user" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_one_owner" ON "memberships" USING btree ("workspace_id") WHERE "memberships"."role" = 'owner';--> statement-breakpoint
CREATE INDEX "templates_workspace" ON "templates" USING btree ("workspace_id");