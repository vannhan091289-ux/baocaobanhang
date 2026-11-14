-- 0003_s1b_org_and_role_workflow.sql (APPROVED 2026-11-14, DEVTEST synthetic only; TASK-0004)
-- Sprint 1 (S1-B / S1-C): Forward-compatible TIMESTAMPTZ default fix, optimistic concurrency (row_version),
-- Maker-Checker role_assignment_proposals, authority serialization triggers, and least-privilege DML grants.

-- 0. Fix TIMESTAMPTZ column defaults from 0001 without altering applied migration files:
--    CURRENT_TIMESTAMP is already TIMESTAMPTZ (UTC instant); avoids -7h drift when session TimeZone <> 'UTC'.
ALTER TABLE departments
  ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE staff
  ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE identity_links
  ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE role_assignments
  ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE audit_events
  ALTER COLUMN occurred_at SET DEFAULT CURRENT_TIMESTAMP;

-- 1. Optimistic concurrency row_version on existing S1-A organization & role tables
ALTER TABLE departments
  ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1);

ALTER TABLE staff
  ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1);

ALTER TABLE identity_links
  ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1);

ALTER TABLE role_assignments
  ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1);

-- 2. Maker-Checker RoleAssignment Proposal table (ADR-002 §6.1 item 2)
CREATE TABLE role_assignment_proposals (
  id UUID PRIMARY KEY,
  target_staff_id UUID NOT NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  propose_action VARCHAR(16) NOT NULL CHECK (propose_action IN ('ASSIGN', 'REVOKE')),
  target_assignment_id UUID NULL REFERENCES role_assignments (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  role_code VARCHAR(32) NOT NULL CHECK (
    role_code IN ('EXECUTIVE', 'CONFIG_ADMIN', 'DEPARTMENT_MANAGER', 'STAFF')
  ),
  scope_type VARCHAR(16) NOT NULL CHECK (
    scope_type IN ('BRANCH', 'DEPARTMENT', 'SELF')
  ),
  scope_department_id UUID NULL REFERENCES departments (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ NULL,
  status VARCHAR(16) NOT NULL CHECK (
    status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')
  ),
  proposer_staff_id UUID NOT NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  proposer_reason VARCHAR(280) NOT NULL CHECK (length(trim(proposer_reason)) > 0),
  approver_staff_id UUID NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decision_reason VARCHAR(280) NULL,
  decided_at TIMESTAMPTZ NULL,
  applied_assignment_id UUID NULL REFERENCES role_assignments (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_proposal_interval CHECK (
    effective_to IS NULL OR effective_to > effective_from
  ),
  CONSTRAINT chk_proposal_scope_pair CHECK (
    (role_code IN ('EXECUTIVE', 'CONFIG_ADMIN') AND scope_type = 'BRANCH' AND scope_department_id IS NULL)
    OR (role_code = 'DEPARTMENT_MANAGER' AND scope_type = 'DEPARTMENT' AND scope_department_id IS NOT NULL)
    OR (role_code = 'STAFF' AND scope_type = 'SELF' AND scope_department_id IS NULL)
  ),
  CONSTRAINT chk_proposal_no_self_propose CHECK (
    proposer_staff_id <> target_staff_id
  ),
  CONSTRAINT chk_proposal_maker_checker CHECK (
    approver_staff_id IS NULL
    OR (approver_staff_id <> proposer_staff_id AND approver_staff_id <> target_staff_id)
  ),
  CONSTRAINT chk_proposal_action_target CHECK (
    (propose_action = 'ASSIGN' AND target_assignment_id IS NULL)
    OR (propose_action = 'REVOKE' AND target_assignment_id IS NOT NULL)
  ),
  CONSTRAINT chk_proposal_decision_state CHECK (
    (status IN ('PENDING', 'CANCELLED') AND approver_staff_id IS NULL AND decided_at IS NULL)
    OR (status IN ('APPROVED', 'REJECTED') AND approver_staff_id IS NOT NULL AND decided_at IS NOT NULL)
  )
);

CREATE INDEX idx_role_proposals_target_staff ON role_assignment_proposals (target_staff_id);
CREATE INDEX idx_role_proposals_status ON role_assignment_proposals (status);

-- At most one PENDING proposal per target Staff at a time to prevent concurrent conflicting approvals
CREATE UNIQUE INDEX uq_role_proposals_pending_staff
  ON role_assignment_proposals (target_staff_id)
  WHERE status = 'PENDING';

-- Monotonic row_version + updated_at enforcement on UPDATE for optimistic concurrency
CREATE FUNCTION bump_s1b_row_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.row_version <= OLD.row_version THEN
    NEW.row_version := OLD.row_version + 1;
  ELSIF NEW.row_version <> OLD.row_version + 1 THEN
    RAISE EXCEPTION 'INVALID_ROW_VERSION_STEP';
  END IF;
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END
$$;

CREATE TRIGGER bump_departments_row_version
  BEFORE UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION bump_s1b_row_version();

CREATE TRIGGER bump_staff_row_version
  BEFORE UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION bump_s1b_row_version();

CREATE TRIGGER bump_identity_links_row_version
  BEFORE UPDATE ON identity_links
  FOR EACH ROW EXECUTE FUNCTION bump_s1b_row_version();

CREATE TRIGGER bump_role_assignments_row_version
  BEFORE UPDATE ON role_assignments
  FOR EACH ROW EXECUTE FUNCTION bump_s1b_row_version();

CREATE TRIGGER bump_role_proposals_row_version
  BEFORE UPDATE ON role_assignment_proposals
  FOR EACH ROW EXECUTE FUNCTION bump_s1b_row_version();

-- Serialize proposal mutations under the same authority lock as staff/roles/departments/identity_links
CREATE TRIGGER serialize_role_proposal_authority
  BEFORE INSERT OR UPDATE OR DELETE ON role_assignment_proposals
  FOR EACH STATEMENT EXECUTE FUNCTION lock_s1a_authority_statement();

-- 3. Least-privilege runtime role grants for S1-B / S1-C:
--    - SELECT, INSERT, UPDATE on organization & role workflow tables (NO DELETE — history is immutable)
--    - INSERT-only on audit_events (NO SELECT, UPDATE, or DELETE for app_runtime_role)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime_role') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE
      departments,
      staff,
      identity_links,
      role_assignments,
      role_assignment_proposals
    TO app_runtime_role;
  END IF;
END
$$;
