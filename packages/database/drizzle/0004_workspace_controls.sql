CREATE FUNCTION lead.remove_member(ws uuid,member_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,lead AS $$ BEGIN
 IF NOT lead.is_admin(ws) OR NOT EXISTS(SELECT 1 FROM lead.memberships WHERE workspace_id=ws AND user_id=member_id AND role='member') THEN RAISE EXCEPTION 'Member cannot be removed'; END IF;
 UPDATE lead.entries SET assigned_to=NULL WHERE workspace_id=ws AND assigned_to=member_id;
 DELETE FROM lead.memberships WHERE workspace_id=ws AND user_id=member_id;
 UPDATE lead.jobs SET status='cancelled',message='Workspace access was removed.',updated_at=now() WHERE workspace_id=ws AND actor_id=member_id AND status IN ('queued','running','paused');
END $$;
CREATE FUNCTION lead.delete_workspace(ws uuid,confirmation text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,lead AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM lead.memberships m JOIN lead.workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=ws AND m.user_id=lead.user_id() AND m.role='owner' AND w.name=confirmation) THEN RAISE EXCEPTION 'Workspace confirmation does not match'; END IF;
 DELETE FROM lead.workspaces WHERE id=ws;
END $$;
REVOKE EXECUTE ON FUNCTION lead.remove_member(uuid,uuid),lead.delete_workspace(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lead.remove_member(uuid,uuid),lead.delete_workspace(uuid,text) TO lead_app;
CREATE FUNCTION lead.prune_history(retention_days integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,lead AS $$ BEGIN
 IF retention_days<7 OR retention_days>3650 THEN RAISE EXCEPTION 'Invalid retention'; END IF;
 DELETE FROM lead.usage WHERE created_at<now()-retention_days*interval '1 day';
 DELETE FROM lead.jobs WHERE created_at<now()-retention_days*interval '1 day' AND status IN ('completed','partial','failed','cancelled');
END $$;
REVOKE EXECUTE ON FUNCTION lead.prune_history(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lead.prune_history(integer) TO lead_queue_access;
