CREATE TABLE "lead"."ai_settings" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead"."campaign_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"brief" text NOT NULL,
	"answers" text DEFAULT '' NOT NULL,
	"current_fields" jsonb,
	"parent_id" uuid,
	"input_hash" text NOT NULL,
	"ai_config" jsonb NOT NULL,
	"result" jsonb,
	"job_id" uuid,
	"accepted_campaign_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"message" text DEFAULT 'Queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead"."analyses" ADD COLUMN "provider" text DEFAULT 'groq' NOT NULL;--> statement-breakpoint
ALTER TABLE "lead"."analyses" ADD COLUMN "campaign_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "lead"."usage" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "lead"."usage" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "lead"."usage" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "lead"."usage" ADD COLUMN "latency_ms" integer;--> statement-breakpoint
ALTER TABLE "lead"."usage" ADD COLUMN "response_id" text;--> statement-breakpoint
ALTER TABLE "lead"."usage" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "lead"."ai_settings" ADD CONSTRAINT "ai_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "lead"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead"."campaign_drafts" ADD CONSTRAINT "campaign_drafts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "lead"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead"."campaign_drafts" ADD CONSTRAINT "campaign_drafts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "lead"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead"."campaign_drafts" ADD CONSTRAINT "campaign_drafts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "lead"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead"."campaign_drafts" ADD CONSTRAINT "campaign_drafts_accepted_campaign_id_campaigns_id_fk" FOREIGN KEY ("accepted_campaign_id") REFERENCES "lead"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "draft_tenant" ON "lead"."campaign_drafts" USING btree ("id","workspace_id");