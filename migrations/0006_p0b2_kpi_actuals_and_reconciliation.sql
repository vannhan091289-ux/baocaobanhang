-- 0006_p0b2_kpi_actuals_and_reconciliation.sql (APPROVED 2026-11-14, DEVTEST synthetic only; TASK-0008 P0B-2)
-- Slice P0B-2: KPI Actual Records (PROVISIONAL / RECONCILED / FINAL + nullable actual_value for MISSING_DATA)
-- and Immutable Retrospective Adjustment History (kpi_actual_adjustments).

CREATE TABLE kpi_actual_records (
  id UUID PRIMARY KEY,
  kpi_definition_id UUID NOT NULL REFERENCES kpi_definitions (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  period_type VARCHAR(16) NOT NULL CHECK (
    period_type IN ('YEAR', 'MONTH', 'WEEK', 'DAY')
  ),
  period_key VARCHAR(32) NOT NULL CHECK (length(trim(period_key)) > 0),
  as_of_date DATE NOT NULL,
  department_id UUID NOT NULL REFERENCES departments (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  primary_staff_id UUID NOT NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  referrer_staff_id UUID NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  actual_value NUMERIC(20, 2) NULL,
  reconciliation_status VARCHAR(16) NOT NULL DEFAULT 'PROVISIONAL' CHECK (
    reconciliation_status IN ('PROVISIONAL', 'RECONCILED', 'FINAL')
  ),
  source_code VARCHAR(64) NOT NULL DEFAULT 'SYNTHETIC_DEVTEST' CHECK (length(trim(source_code)) > 0),
  source_ref VARCHAR(160) NULL,
  notes VARCHAR(500) NULL,
  recorded_by_staff_id UUID NOT NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  reconciled_by_staff_id UUID NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  reconciled_at TIMESTAMPTZ NULL,
  finalized_by_staff_id UUID NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  finalized_at TIMESTAMPTZ NULL,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_kpi_actual_no_self_referrer CHECK (
    referrer_staff_id IS NULL OR referrer_staff_id <> primary_staff_id
  ),
  CONSTRAINT chk_kpi_actual_reconciled_state CHECK (
    (reconciliation_status = 'PROVISIONAL')
    OR (
      reconciliation_status = 'RECONCILED'
      AND reconciled_by_staff_id IS NOT NULL
      AND reconciled_at IS NOT NULL
    )
    OR (
      reconciliation_status = 'FINAL'
      AND reconciled_by_staff_id IS NOT NULL
      AND reconciled_at IS NOT NULL
      AND finalized_by_staff_id IS NOT NULL
      AND finalized_at IS NOT NULL
    )
  )
);

CREATE INDEX idx_kpi_actual_def_period ON kpi_actual_records (kpi_definition_id, period_type, period_key);
CREATE INDEX idx_kpi_actual_dept_staff_date ON kpi_actual_records (department_id, primary_staff_id, as_of_date);
CREATE INDEX idx_kpi_actual_status ON kpi_actual_records (reconciliation_status);

CREATE TRIGGER bump_kpi_actual_records_row_version
  BEFORE UPDATE ON kpi_actual_records
  FOR EACH ROW EXECUTE FUNCTION bump_s1b_row_version();

CREATE TABLE kpi_actual_adjustments (
  id UUID PRIMARY KEY,
  actual_record_id UUID NOT NULL REFERENCES kpi_actual_records (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  previous_actual_value NUMERIC(20, 2) NULL,
  new_actual_value NUMERIC(20, 2) NULL,
  previous_status VARCHAR(16) NOT NULL CHECK (
    previous_status IN ('PROVISIONAL', 'RECONCILED', 'FINAL')
  ),
  new_status VARCHAR(16) NOT NULL CHECK (
    new_status IN ('PROVISIONAL', 'RECONCILED', 'FINAL')
  ),
  adjustment_reason VARCHAR(500) NOT NULL CHECK (length(trim(adjustment_reason)) > 0),
  source_ref VARCHAR(160) NULL,
  adjusted_by_staff_id UUID NOT NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  approved_by_staff_id UUID NOT NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_kpi_adj_no_self_approve CHECK (
    adjusted_by_staff_id <> approved_by_staff_id
  )
);

CREATE INDEX idx_kpi_actual_adj_record ON kpi_actual_adjustments (actual_record_id, created_at);

GRANT SELECT, INSERT, UPDATE ON kpi_actual_records TO app_runtime_role;
GRANT SELECT, INSERT ON kpi_actual_adjustments TO app_runtime_role;
