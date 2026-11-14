-- 0007_p0c_pipeline_and_alerts.sql (APPROVED 2026-11-14, DEVTEST synthetic only; TASK-0009 P0C)
-- Slice P0C: Prospect / Lead / Opportunity Pipeline + Stage/Owner Transitions
-- and 6-Rule P0 In-App Alert Engine (D-04, ADR-004 Option A).

CREATE TABLE prospects (
  id UUID PRIMARY KEY,
  prospect_ref VARCHAR(64) NOT NULL UNIQUE CHECK (prospect_ref ~ '^SYN-[A-Z0-9_-]{3,60}$'),
  display_label VARCHAR(160) NOT NULL CHECK (length(trim(display_label)) > 0),
  segment_code VARCHAR(16) NOT NULL CHECK (segment_code IN ('RETAIL', 'SME', 'CORP')),
  department_id UUID NOT NULL REFERENCES departments (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  owner_staff_id UUID NOT NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  stage VARCHAR(24) NOT NULL DEFAULT 'NEW' CHECK (
    stage IN ('NEW', 'QUALIFIED', 'CONVERTED', 'ARCHIVED')
  ),
  notes VARCHAR(500) NULL,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_prospects_dept_owner ON prospects (department_id, owner_staff_id, stage);
CREATE TRIGGER bump_prospects_row_version
  BEFORE UPDATE ON prospects
  FOR EACH ROW EXECUTE FUNCTION bump_s1b_row_version();

CREATE TABLE leads (
  id UUID PRIMARY KEY,
  lead_ref VARCHAR(64) NOT NULL UNIQUE CHECK (lead_ref ~ '^SYN-[A-Z0-9_-]{3,60}$'),
  prospect_id UUID NULL REFERENCES prospects (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  customer_ref VARCHAR(64) NULL CHECK (customer_ref IS NULL OR customer_ref ~ '^SYN-CIF-[A-Z0-9_-]+$'),
  display_label VARCHAR(160) NOT NULL CHECK (length(trim(display_label)) > 0),
  need_group_code VARCHAR(32) NOT NULL CHECK (
    need_group_code IN (
      'LOAN', 'DEPOSIT', 'CARD', 'TTQT', 'NEW_RETAIL_CIF', 'BIZ_HOUSEHOLD', 'INSURANCE'
    )
  ),
  department_id UUID NOT NULL REFERENCES departments (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  owner_staff_id UUID NOT NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  stage VARCHAR(24) NOT NULL DEFAULT 'NEW' CHECK (
    stage IN ('NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST')
  ),
  due_date DATE NULL,
  last_contacted_at TIMESTAMPTZ NULL,
  notes VARCHAR(500) NULL,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_leads_dept_owner ON leads (department_id, owner_staff_id, stage);
CREATE TRIGGER bump_leads_row_version
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION bump_s1b_row_version();

CREATE TABLE opportunities (
  id UUID PRIMARY KEY,
  opportunity_ref VARCHAR(64) NOT NULL UNIQUE CHECK (opportunity_ref ~ '^SYN-[A-Z0-9_-]{3,60}$'),
  lead_id UUID NULL REFERENCES leads (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  customer_ref VARCHAR(64) NOT NULL CHECK (customer_ref ~ '^SYN-CIF-[A-Z0-9_-]+$'),
  display_label VARCHAR(160) NOT NULL CHECK (length(trim(display_label)) > 0),
  kpi_group_code VARCHAR(32) NOT NULL CHECK (
    kpi_group_code IN (
      'LOAN', 'DEPOSIT', 'CARD', 'TTQT', 'NEW_RETAIL_CIF', 'BIZ_HOUSEHOLD', 'INSURANCE'
    )
  ),
  estimated_value NUMERIC(20, 2) NOT NULL CHECK (estimated_value >= 0),
  department_id UUID NOT NULL REFERENCES departments (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  owner_staff_id UUID NOT NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  stage VARCHAR(24) NOT NULL DEFAULT 'PROPOSAL' CHECK (
    stage IN ('PROPOSAL', 'NEGOTIATION', 'WON', 'LOST')
  ),
  expected_close_date DATE NULL,
  notes VARCHAR(500) NULL,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_opportunities_dept_owner ON opportunities (department_id, owner_staff_id, stage);
CREATE TRIGGER bump_opportunities_row_version
  BEFORE UPDATE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION bump_s1b_row_version();

CREATE TABLE pipeline_stage_transitions (
  id UUID PRIMARY KEY,
  entity_type VARCHAR(16) NOT NULL CHECK (entity_type IN ('PROSPECT', 'LEAD', 'OPPORTUNITY')),
  entity_id UUID NOT NULL,
  from_stage VARCHAR(24) NULL,
  to_stage VARCHAR(24) NOT NULL,
  from_owner_staff_id UUID NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  to_owner_staff_id UUID NOT NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transition_note VARCHAR(500) NULL,
  changed_by_staff_id UUID NOT NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_pipeline_transitions_entity ON pipeline_stage_transitions (entity_type, entity_id, created_at);

-- 2. Configurable 6 P0 Alert Rules (D-04, ADR-004 Option A; managed by CONFIG_ADMIN)
CREATE TABLE alert_rule_configs (
  id UUID PRIMARY KEY,
  rule_code VARCHAR(48) NOT NULL UNIQUE CHECK (
    rule_code IN (
      'KPI_BEHIND_PACE',
      'MISSING_DAILY_REPORT',
      'OVERDUE_PIPELINE_FOLLOWUP',
      'CUSTOMER_RENEWAL_CARE',
      'OVERDUE_DIRECTIVE_TASK',
      'PENDING_APPROVAL_SLA'
    )
  ),
  rule_name VARCHAR(160) NOT NULL CHECK (length(trim(rule_name)) > 0),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  threshold_value NUMERIC(20, 2) NOT NULL DEFAULT 15.00 CHECK (threshold_value >= 0),
  sla_working_days INTEGER NOT NULL DEFAULT 2 CHECK (sla_working_days >= 0),
  severity VARCHAR(16) NOT NULL DEFAULT 'P0' CHECK (severity IN ('P0', 'HIGH', 'MEDIUM')),
  escalation_after_working_days INTEGER NOT NULL DEFAULT 3 CHECK (escalation_after_working_days >= 1),
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  updated_by_staff_id UUID NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER bump_alert_rule_configs_row_version
  BEFORE UPDATE ON alert_rule_configs
  FOR EACH ROW EXECUTE FUNCTION bump_s1b_row_version();

INSERT INTO alert_rule_configs (
  id, rule_code, rule_name, is_enabled, threshold_value, sla_working_days, severity, escalation_after_working_days
) VALUES
  ('90000000-0000-4000-8000-000000000001', 'KPI_BEHIND_PACE', 'KPI chậm tiến độ so với lịch làm việc', TRUE, 15.00, 1, 'P0', 2),
  ('90000000-0000-4000-8000-000000000002', 'MISSING_DAILY_REPORT', 'Chưa ghi nhận hoạt động/báo cáo ngày', TRUE, 1.00, 1, 'P0', 2),
  ('90000000-0000-4000-8000-000000000003', 'OVERDUE_PIPELINE_FOLLOWUP', 'Lead/Opportunity quá hạn chăm sóc', TRUE, 0.00, 1, 'P0', 2),
  ('90000000-0000-4000-8000-000000000004', 'CUSTOMER_RENEWAL_CARE', 'Chăm sóc khách hàng trước tái cấp/đáo hạn', TRUE, 7.00, 2, 'HIGH', 3),
  ('90000000-0000-4000-8000-000000000005', 'OVERDUE_DIRECTIVE_TASK', 'Công việc/chỉ đạo Review Thứ Hai quá hạn', TRUE, 0.00, 1, 'P0', 2),
  ('90000000-0000-4000-8000-000000000006', 'PENDING_APPROVAL_SLA', 'Hồ sơ chờ phê duyệt vượt SLA', TRUE, 2.00, 2, 'HIGH', 3)
ON CONFLICT (rule_code) DO NOTHING;

-- 3. In-App P0 Alerts (dedup_key + read_at separated from resolution_status)
CREATE TABLE in_app_alerts (
  id UUID PRIMARY KEY,
  rule_code VARCHAR(48) NOT NULL REFERENCES alert_rule_configs (rule_code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  dedup_key VARCHAR(160) NOT NULL UNIQUE CHECK (length(trim(dedup_key)) > 0),
  severity VARCHAR(16) NOT NULL CHECK (severity IN ('P0', 'HIGH', 'MEDIUM')),
  target_scope VARCHAR(16) NOT NULL CHECK (target_scope IN ('BRANCH', 'DEPARTMENT', 'SELF')),
  department_id UUID NOT NULL REFERENCES departments (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  owner_staff_id UUID NOT NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  escalated_to_staff_id UUID NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  title VARCHAR(200) NOT NULL CHECK (length(trim(title)) > 0),
  summary VARCHAR(500) NOT NULL CHECK (length(trim(summary)) > 0),
  due_at TIMESTAMPTZ NULL,
  read_at TIMESTAMPTZ NULL,
  resolution_status VARCHAR(16) NOT NULL DEFAULT 'OPEN' CHECK (
    resolution_status IN ('OPEN', 'RESOLVED', 'DISMISSED')
  ),
  resolution_note VARCHAR(500) NULL,
  resolution_evidence_ref VARCHAR(160) NULL,
  resolved_by_staff_id UUID NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  resolved_at TIMESTAMPTZ NULL,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_alert_resolution_evidence CHECK (
    resolution_status = 'OPEN'
    OR (
      resolved_by_staff_id IS NOT NULL
      AND resolved_at IS NOT NULL
      AND (
        length(trim(COALESCE(resolution_evidence_ref, ''))) > 0
        OR length(trim(COALESCE(resolution_note, ''))) > 0
      )
    )
  )
);

CREATE INDEX idx_in_app_alerts_owner_status ON in_app_alerts (department_id, owner_staff_id, resolution_status);

CREATE TRIGGER bump_in_app_alerts_row_version
  BEFORE UPDATE ON in_app_alerts
  FOR EACH ROW EXECUTE FUNCTION bump_s1b_row_version();

GRANT SELECT, INSERT, UPDATE ON prospects TO app_runtime_role;
GRANT SELECT, INSERT, UPDATE ON leads TO app_runtime_role;
GRANT SELECT, INSERT, UPDATE ON opportunities TO app_runtime_role;
GRANT SELECT, INSERT ON pipeline_stage_transitions TO app_runtime_role;
GRANT SELECT, INSERT, UPDATE ON alert_rule_configs TO app_runtime_role;
GRANT SELECT, INSERT, UPDATE ON in_app_alerts TO app_runtime_role;
