CREATE FUNCTION lead.capacity_available(maximum integer) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,lead AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(287427,1);
 RETURN (SELECT count(*) FROM lead.jobs WHERE status IN ('queued','running'))<greatest(1,least(maximum,1000));
END $$;
CREATE OR REPLACE FUNCTION lead.job_identity(job_id uuid) RETURNS TABLE(user_id uuid,email text,workspace_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,lead AS $$ BEGIN
 UPDATE lead.jobs j SET status='cancelled',message='The requesting member no longer has workspace access.',updated_at=now() WHERE j.id=job_id AND NOT EXISTS(SELECT 1 FROM lead.memberships m WHERE m.workspace_id=j.workspace_id AND m.user_id=j.actor_id);
 RETURN QUERY SELECT j.actor_id,u.email,j.workspace_id FROM lead.jobs j JOIN lead.users u ON u.id=j.actor_id JOIN lead.memberships m ON m.workspace_id=j.workspace_id AND m.user_id=j.actor_id WHERE j.id=job_id AND j.status IN ('queued','running');
END $$;
REVOKE EXECUTE ON FUNCTION lead.capacity_available(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lead.capacity_available(integer) TO lead_app;
