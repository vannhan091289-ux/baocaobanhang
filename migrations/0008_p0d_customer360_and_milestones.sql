-- P0D (TASK-0010): Scoped Synthetic Customer 360 & Milestones (ADR-005, D-05 OPEN)
-- Additive migration only. Strictly stores synthetic reference codes and limited CRM metadata (NO PII).

CREATE TABLE customer_references (
  id UUID PRIMARY KEY,
  customer_ref_code VARCHAR(64) NOT NULL UNIQUE CHECK (
    customer_ref_code ~ '^SYN-CIF-[A-Z0-9_-]{3,56}$'
  ),
  segment_code VARCHAR(16) NOT NULL CHECK (segment_code IN ('KHCN', 'KHDN', 'HKD')),
  display_name VARCHAR(160) NOT NULL CHECK (length(trim(display_name)) > 0),
  managing_department_id UUID NOT NULL REFERENCES departments (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  assigned_staff_id UUID NOT NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  maturity_date DATE NULL,
  renewal_date DATE NULL,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_customer_references_dept_staff
  ON customer_references (managing_department_id, assigned_staff_id, status);

CREATE TRIGGER bump_customer_references_row_version
  BEFORE UPDATE ON customer_references
  FOR EACH ROW EXECUTE FUNCTION bump_s1b_row_version();

CREATE TABLE customer_milestones (
  id UUID PRIMARY KEY,
  customer_reference_id UUID NOT NULL REFERENCES customer_references (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  milestone_type VARCHAR(24) NOT NULL CHECK (milestone_type IN ('MATURITY', 'RENEWAL', 'REVIEW')),
  due_date DATE NOT NULL,
  title VARCHAR(200) NOT NULL CHECK (length(trim(title)) > 0),
  status VARCHAR(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'COMPLETED', 'CANCELLED')),
  note VARCHAR(500) NULL,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_customer_milestones_ref_due
  ON customer_milestones (customer_reference_id, status, due_date);

CREATE TRIGGER bump_customer_milestones_row_version
  BEFORE UPDATE ON customer_milestones
  FOR EACH ROW EXECUTE FUNCTION bump_s1b_row_version();

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS customer_reference_id UUID NULL REFERENCES customer_references (id) ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_opportunities_customer_ref_id
  ON opportunities (customer_reference_id);

ALTER TABLE activity_logs
  ADD COLUMN IF NOT EXISTS customer_reference_id UUID NULL REFERENCES customer_references (id) ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_activity_logs_customer_ref_id
  ON activity_logs (customer_reference_id);

GRANT SELECT, INSERT, UPDATE ON customer_references TO app_runtime_role;
GRANT SELECT, INSERT, UPDATE ON customer_milestones TO app_runtime_role;
