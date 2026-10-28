ALTER TABLE "lead"."usage" ALTER COLUMN "tokens" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "lead"."usage" ALTER COLUMN "tokens" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE lead.connections DROP CONSTRAINT connection_provider;
ALTER TABLE lead.connections ADD CONSTRAINT connection_provider CHECK(provider IN ('serpapi','groq','google','compatible','firecrawl'));
ALTER TABLE lead.ai_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_settings_read ON lead.ai_settings FOR SELECT TO lead_app USING(lead.is_member(workspace_id));
CREATE POLICY ai_settings_write ON lead.ai_settings FOR ALL TO lead_app USING(lead.is_admin(workspace_id)) WITH CHECK(lead.is_admin(workspace_id));
ALTER TABLE lead.campaign_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY draft_read ON lead.campaign_drafts FOR SELECT TO lead_app USING(lead.is_member(workspace_id));
CREATE POLICY draft_insert ON lead.campaign_drafts FOR INSERT TO lead_app WITH CHECK(lead.is_member(workspace_id) AND actor_id=lead.user_id());
CREATE POLICY draft_update ON lead.campaign_drafts FOR UPDATE TO lead_app USING(lead.is_member(workspace_id)) WITH CHECK(lead.is_member(workspace_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON lead.ai_settings,lead.campaign_drafts TO lead_app;
ALTER TABLE lead.campaign_drafts ADD CONSTRAINT draft_parent FOREIGN KEY(parent_id,workspace_id) REFERENCES lead.campaign_drafts(id,workspace_id);
ALTER TABLE lead.campaign_drafts ADD CONSTRAINT draft_job_tenant FOREIGN KEY(job_id,workspace_id) REFERENCES lead.jobs(id,workspace_id);
ALTER TABLE lead.campaign_drafts ADD CONSTRAINT draft_campaign_tenant FOREIGN KEY(accepted_campaign_id,workspace_id) REFERENCES lead.campaigns(id,workspace_id);
CREATE INDEX drafts_recent ON lead.campaign_drafts(workspace_id,created_at DESC);
CREATE INDEX drafts_cache ON lead.campaign_drafts(workspace_id,input_hash,created_at DESC);
DROP FUNCTION lead.pending_jobs();
CREATE FUNCTION lead.pending_jobs() RETURNS TABLE(id uuid,workspace_id uuid,kind text) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,lead AS $$ SELECT id,workspace_id,kind FROM lead.jobs WHERE status='queued' AND (dispatched_at IS NULL OR dispatched_at<now()-interval '10 minutes') ORDER BY created_at LIMIT 30 $$;
REVOKE EXECUTE ON FUNCTION lead.pending_jobs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lead.pending_jobs() TO lead_queue_access;
CREATE OR REPLACE FUNCTION lead.prune_history(retention_days integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,lead AS $$ BEGIN
 IF retention_days<7 OR retention_days>3650 THEN RAISE EXCEPTION 'Invalid retention'; END IF;
 DELETE FROM lead.usage WHERE created_at<now()-retention_days*interval '1 day';
 DELETE FROM lead.campaign_drafts d WHERE d.created_at<now()-interval '30 days' AND NOT EXISTS(SELECT 1 FROM lead.jobs j WHERE j.id=d.job_id AND j.status IN ('queued','running','paused'));
 DELETE FROM lead.jobs WHERE created_at<now()-retention_days*interval '1 day' AND status IN ('completed','partial','failed','cancelled');
END $$;
