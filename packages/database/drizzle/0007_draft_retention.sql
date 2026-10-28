-- Keep newer refinements when an older draft reaches its retention limit.
ALTER TABLE lead.campaign_drafts DROP CONSTRAINT draft_parent;
ALTER TABLE lead.campaign_drafts ADD CONSTRAINT draft_parent
  FOREIGN KEY(parent_id,workspace_id) REFERENCES lead.campaign_drafts(id,workspace_id)
  ON DELETE SET NULL (parent_id);
