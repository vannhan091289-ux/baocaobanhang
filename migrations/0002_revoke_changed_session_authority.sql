-- Serialize issuance with every authority-changing statement before row locks.
-- One database-local advisory lock is sufficient for this single-branch DEVTEST slice.
CREATE FUNCTION lock_s1a_authority() RETURNS void
LANGUAGE sql AS 'SELECT pg_advisory_xact_lock(706031003::bigint)';

CREATE FUNCTION lock_s1a_authority_statement() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN PERFORM lock_s1a_authority(); RETURN NULL; END $$;

CREATE TRIGGER serialize_staff_authority BEFORE INSERT OR UPDATE OR DELETE ON staff
FOR EACH STATEMENT EXECUTE FUNCTION lock_s1a_authority_statement();
CREATE TRIGGER serialize_role_authority BEFORE INSERT OR UPDATE OR DELETE ON role_assignments
FOR EACH STATEMENT EXECUTE FUNCTION lock_s1a_authority_statement();
CREATE TRIGGER serialize_identity_authority BEFORE INSERT OR UPDATE OR DELETE ON identity_links
FOR EACH STATEMENT EXECUTE FUNCTION lock_s1a_authority_statement();
CREATE TRIGGER serialize_department_authority BEFORE INSERT OR UPDATE OR DELETE ON departments
FOR EACH STATEMENT EXECUTE FUNCTION lock_s1a_authority_statement();

-- S1-A: a session must never adopt a changed role, mapping or department.
-- Additive migration: keeps all mappings/audit rows and revokes affected sessions.
CREATE FUNCTION revoke_changed_session_authority() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'staff' THEN
    IF (OLD.department_id, OLD.status) IS DISTINCT FROM
       (NEW.department_id, NEW.status) THEN
      UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP,
        revoked_reason = 'STAFF_AUTHORITY_CHANGED'
      WHERE staff_id = OLD.id AND revoked_at IS NULL;
    END IF;
  ELSIF TG_TABLE_NAME = 'role_assignments' THEN
    IF (OLD.staff_id, OLD.role_code, OLD.scope_type, OLD.scope_department_id,
        OLD.effective_from, OLD.effective_to, OLD.status) IS DISTINCT FROM
       (NEW.staff_id, NEW.role_code, NEW.scope_type, NEW.scope_department_id,
        NEW.effective_from, NEW.effective_to, NEW.status) THEN
      UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP,
        revoked_reason = 'ROLE_AUTHORITY_CHANGED'
      WHERE staff_id IN (OLD.staff_id, NEW.staff_id) AND revoked_at IS NULL;
    END IF;
  ELSIF TG_TABLE_NAME = 'identity_links' THEN
    IF (OLD.staff_id, OLD.issuer, OLD.subject, OLD.status) IS DISTINCT FROM
       (NEW.staff_id, NEW.issuer, NEW.subject, NEW.status) THEN
      UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP,
        revoked_reason = 'IDENTITY_AUTHORITY_CHANGED'
      WHERE identity_link_id = OLD.id AND revoked_at IS NULL;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER revoke_staff_sessions_on_authority_change
AFTER UPDATE OF department_id, status ON staff
FOR EACH ROW EXECUTE FUNCTION revoke_changed_session_authority();

CREATE TRIGGER revoke_role_sessions_on_authority_change
AFTER UPDATE OF staff_id, role_code, scope_type, scope_department_id,
  effective_from, effective_to, status ON role_assignments
FOR EACH ROW EXECUTE FUNCTION revoke_changed_session_authority();

CREATE TRIGGER revoke_identity_sessions_on_authority_change
AFTER UPDATE OF staff_id, issuer, subject, status ON identity_links
FOR EACH ROW EXECUTE FUNCTION revoke_changed_session_authority();

-- Verification reads use the migrator/test connection; runtime only appends audit.
REVOKE SELECT ON TABLE audit_events FROM app_runtime_role;
