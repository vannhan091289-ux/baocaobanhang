-- 0004_p0a_kpi_dictionary_and_targets.sql (APPROVED 2026-11-14, DEVTEST synthetic only; TASK-0006 P0A)
-- Slice P0A: Working Calendar (branch_calendar_days, D-03 Option A), 7-Group KPI Dictionary
-- (kpi_definitions, D-01 & ADR-003 Option A), and Multi-Period KPI Targets + Revision History
-- (kpi_targets, kpi_target_revisions).

-- 1. Branch Working Calendar (D-03 Option A: Asia/Ho_Chi_Minh, Monday-Sunday week, Mon-Fri working days)
CREATE TABLE branch_calendar_days (
  calendar_date DATE PRIMARY KEY,
  is_working_day BOOLEAN NOT NULL,
  holiday_name VARCHAR(160) NULL,
  weekly_cutoff_day VARCHAR(16) NOT NULL DEFAULT 'MONDAY' CHECK (
    weekly_cutoff_day IN ('MONDAY', 'SUNDAY')
  ),
  daily_report_cutoff_time VARCHAR(8) NOT NULL DEFAULT '18:00' CHECK (
    daily_report_cutoff_time ~ '^[0-2][0-9]:[0-5][0-9]$'
  ),
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  updated_by_staff_id UUID NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER bump_branch_calendar_days_row_version
  BEFORE UPDATE ON branch_calendar_days
  FOR EACH ROW EXECUTE FUNCTION bump_s1b_row_version();

-- 2. 7-Group KPI Dictionary (D-01 & ADR-003 Option A)
CREATE TABLE kpi_definitions (
  id UUID PRIMARY KEY,
  metric_code VARCHAR(64) NOT NULL CHECK (metric_code ~ '^[A-Z0-9_]{3,64}$'),
  metric_name VARCHAR(160) NOT NULL CHECK (length(trim(metric_name)) > 0),
  group_code VARCHAR(32) NOT NULL CHECK (
    group_code IN (
      'LOAN',
      'DEPOSIT',
      'CARD',
      'TTQT',
      'NEW_RETAIL_CIF',
      'BIZ_HOUSEHOLD',
      'INSURANCE'
    )
  ),
  unit_code VARCHAR(32) NOT NULL CHECK (
    unit_code IN ('VND', 'USD', 'CARD', 'CUSTOMER', 'CONTRACT')
  ),
  currency_code VARCHAR(8) NULL CHECK (
    currency_code IS NULL OR currency_code IN ('VND', 'USD')
  ),
  metric_type VARCHAR(24) NOT NULL CHECK (
    metric_type IN ('FLOW', 'STOCK', 'AVERAGE', 'NET_CHANGE')
  ),
  time_aggregation_rule VARCHAR(32) NOT NULL CHECK (
    time_aggregation_rule IN ('SUM', 'END_OF_PERIOD', 'AVERAGE', 'NET_DELTA')
  ),
  staff_aggregation_rule VARCHAR(32) NOT NULL CHECK (
    staff_aggregation_rule IN ('SUM', 'WEIGHTED_ATTRIBUTION', 'DEDUP_CUSTOMER')
  ),
  attribution_mode VARCHAR(32) NOT NULL DEFAULT 'PRIMARY_ONLY' CHECK (
    attribution_mode IN ('PRIMARY_ONLY', 'PRIMARY_AND_REFERRER')
  ),
  primary_weight NUMERIC(5, 4) NOT NULL DEFAULT 1.0000 CHECK (
    primary_weight >= 0 AND primary_weight <= 1
  ),
  referrer_weight NUMERIC(5, 4) NOT NULL DEFAULT 0.0000 CHECK (
    referrer_weight >= 0 AND referrer_weight <= 1
  ),
  formula_expression VARCHAR(255) NOT NULL CHECK (length(trim(formula_expression)) > 0),
  source_system_code VARCHAR(64) NOT NULL DEFAULT 'SYNTHETIC_DEVTEST',
  cutoff_rule VARCHAR(64) NOT NULL DEFAULT 'EOD_18_00_ICT',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ NULL,
  approval_reference VARCHAR(128) NOT NULL CHECK (length(trim(approval_reference)) > 0),
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_by_staff_id UUID NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_kpi_definitions_code_version UNIQUE (metric_code, version),
  CONSTRAINT chk_kpi_stock_no_sum CHECK (
    NOT (metric_type = 'STOCK' AND time_aggregation_rule = 'SUM')
  ),
  CONSTRAINT chk_kpi_weights_sum CHECK (
    primary_weight + referrer_weight = 1.0000
  ),
  CONSTRAINT chk_kpi_effective_window CHECK (
    effective_to IS NULL OR effective_to > effective_from
  )
);

CREATE INDEX idx_kpi_definitions_group_status ON kpi_definitions (group_code, status);

CREATE TRIGGER bump_kpi_definitions_row_version
  BEFORE UPDATE ON kpi_definitions
  FOR EACH ROW EXECUTE FUNCTION bump_s1b_row_version();

-- 3. Multi-Period KPI Targets (YEAR / MONTH official approved targets, WEEK / DAY planning projections)
CREATE TABLE kpi_targets (
  id UUID PRIMARY KEY,
  kpi_definition_id UUID NOT NULL REFERENCES kpi_definitions (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  period_type VARCHAR(16) NOT NULL CHECK (
    period_type IN ('YEAR', 'MONTH', 'WEEK', 'DAY')
  ),
  period_key VARCHAR(32) NOT NULL CHECK (length(trim(period_key)) > 0),
  scope_type VARCHAR(16) NOT NULL CHECK (
    scope_type IN ('BRANCH', 'DEPARTMENT', 'SELF')
  ),
  department_id UUID NULL REFERENCES departments (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  staff_id UUID NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  parent_target_id UUID NULL REFERENCES kpi_targets (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  target_value NUMERIC(20, 2) NOT NULL CHECK (target_value >= 0),
  status VARCHAR(24) NOT NULL CHECK (
    status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SUPERSEDED')
  ),
  revision_no INTEGER NOT NULL DEFAULT 1 CHECK (revision_no >= 1),
  proposed_by_staff_id UUID NOT NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  approved_by_staff_id UUID NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  approved_at TIMESTAMPTZ NULL,
  approval_reference VARCHAR(128) NULL,
  notes VARCHAR(500) NULL,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_kpi_target_scope_binding CHECK (
    (scope_type = 'BRANCH' AND department_id IS NULL AND staff_id IS NULL)
    OR (scope_type = 'DEPARTMENT' AND department_id IS NOT NULL AND staff_id IS NULL)
    OR (scope_type = 'SELF' AND department_id IS NOT NULL AND staff_id IS NOT NULL)
  ),
  CONSTRAINT chk_kpi_target_approval_state CHECK (
    (status = 'APPROVED' AND approved_by_staff_id IS NOT NULL AND approved_at IS NOT NULL)
    OR (status IN ('DRAFT', 'PENDING_APPROVAL', 'SUPERSEDED'))
  ),
  CONSTRAINT chk_kpi_target_no_self_parent CHECK (
    parent_target_id IS NULL OR parent_target_id <> id
  )
);

CREATE INDEX idx_kpi_targets_def_period ON kpi_targets (kpi_definition_id, period_type, period_key);
CREATE INDEX idx_kpi_targets_scope_dept ON kpi_targets (scope_type, department_id, staff_id);

CREATE TRIGGER bump_kpi_targets_row_version
  BEFORE UPDATE ON kpi_targets
  FOR EACH ROW EXECUTE FUNCTION bump_s1b_row_version();

-- 4. Immutable KPI Target Revision History (AC-02)
CREATE TABLE kpi_target_revisions (
  id UUID PRIMARY KEY,
  target_id UUID NOT NULL REFERENCES kpi_targets (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
  previous_target_value NUMERIC(20, 2) NULL CHECK (
    previous_target_value IS NULL OR previous_target_value >= 0
  ),
  new_target_value NUMERIC(20, 2) NOT NULL CHECK (new_target_value >= 0),
  previous_status VARCHAR(24) NULL,
  new_status VARCHAR(24) NOT NULL,
  change_reason VARCHAR(500) NOT NULL CHECK (length(trim(change_reason)) > 0),
  changed_by_staff_id UUID NOT NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  approved_by_staff_id UUID NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_kpi_target_revisions_target_rev UNIQUE (target_id, revision_no)
);

CREATE INDEX idx_kpi_target_revisions_target ON kpi_target_revisions (target_id, revision_no);

-- 5. Seed canonical 7-Group KPI Dictionary (D-01 & ADR-003 Option A) and Nov 2026 Working Calendar (D-03 Option A)
INSERT INTO kpi_definitions (
  id,
  metric_code,
  metric_name,
  group_code,
  unit_code,
  currency_code,
  metric_type,
  time_aggregation_rule,
  staff_aggregation_rule,
  attribution_mode,
  primary_weight,
  referrer_weight,
  formula_expression,
  source_system_code,
  cutoff_rule,
  version,
  status,
  effective_from,
  effective_to,
  approval_reference
) VALUES
  (
    '55555555-5555-4555-8555-555555555501',
    'LOAN_BALANCE_END',
    'Dư nợ cho vay cuối kỳ (Synthetic)',
    'LOAN',
    'VND',
    'VND',
    'STOCK',
    'END_OF_PERIOD',
    'SUM',
    'PRIMARY_ONLY',
    1.0000,
    0.0000,
    'SNAPSHOT_END_OF_PERIOD(loan_outstanding_vnd)',
    'SYNTHETIC_DEVTEST',
    'EOD_18_00_ICT',
    1,
    'ACTIVE',
    '2026-01-01T00:00:00.000Z',
    NULL,
    'ADR-003-D01-OPTION-A-2026-11-14'
  ),
  (
    '55555555-5555-4555-8555-555555555502',
    'LOAN_DISBURSEMENT',
    'Doanh số giải ngân trong kỳ (Synthetic)',
    'LOAN',
    'VND',
    'VND',
    'FLOW',
    'SUM',
    'WEIGHTED_ATTRIBUTION',
    'PRIMARY_AND_REFERRER',
    0.7000,
    0.3000,
    'SUM(loan_disbursed_vnd * attribution_weight)',
    'SYNTHETIC_DEVTEST',
    'EOD_18_00_ICT',
    1,
    'ACTIVE',
    '2026-01-01T00:00:00.000Z',
    NULL,
    'ADR-003-D01-OPTION-A-2026-11-14'
  ),
  (
    '55555555-5555-4555-8555-555555555503',
    'DEPOSIT_BALANCE_END',
    'Số dư huy động vốn cuối kỳ (Synthetic)',
    'DEPOSIT',
    'VND',
    'VND',
    'STOCK',
    'END_OF_PERIOD',
    'SUM',
    'PRIMARY_ONLY',
    1.0000,
    0.0000,
    'SNAPSHOT_END_OF_PERIOD(deposit_balance_vnd)',
    'SYNTHETIC_DEVTEST',
    'EOD_18_00_ICT',
    1,
    'ACTIVE',
    '2026-01-01T00:00:00.000Z',
    NULL,
    'ADR-003-D01-OPTION-A-2026-11-14'
  ),
  (
    '55555555-5555-4555-8555-555555555504',
    'DEPOSIT_NET_CHANGE',
    'Tăng trưởng ròng huy động vốn (Synthetic)',
    'DEPOSIT',
    'VND',
    'VND',
    'NET_CHANGE',
    'NET_DELTA',
    'SUM',
    'PRIMARY_ONLY',
    1.0000,
    0.0000,
    'END_BALANCE(deposit_vnd) - START_BALANCE(deposit_vnd)',
    'SYNTHETIC_DEVTEST',
    'EOD_18_00_ICT',
    1,
    'ACTIVE',
    '2026-01-01T00:00:00.000Z',
    NULL,
    'ADR-003-D01-OPTION-A-2026-11-14'
  ),
  (
    '55555555-5555-4555-8555-555555555505',
    'CREDIT_CARD_ACTIVATED',
    'Thẻ tín dụng phát hành mới đã kích hoạt (Synthetic)',
    'CARD',
    'CARD',
    NULL,
    'FLOW',
    'SUM',
    'WEIGHTED_ATTRIBUTION',
    'PRIMARY_AND_REFERRER',
    0.7000,
    0.3000,
    'COUNT_ACTIVATED(credit_card_id)',
    'SYNTHETIC_DEVTEST',
    'EOD_18_00_ICT',
    1,
    'ACTIVE',
    '2026-01-01T00:00:00.000Z',
    NULL,
    'ADR-003-D01-OPTION-A-2026-11-14'
  ),
  (
    '55555555-5555-4555-8555-555555555506',
    'TTQT_VOLUME_USD',
    'Doanh số Thanh toán Quốc tế quy đổi USD (Synthetic)',
    'TTQT',
    'USD',
    'USD',
    'FLOW',
    'SUM',
    'WEIGHTED_ATTRIBUTION',
    'PRIMARY_AND_REFERRER',
    0.7000,
    0.3000,
    'SUM(ttqt_volume_usd * attribution_weight)',
    'SYNTHETIC_DEVTEST',
    'EOD_18_00_ICT',
    1,
    'ACTIVE',
    '2026-01-01T00:00:00.000Z',
    NULL,
    'ADR-003-D01-OPTION-A-2026-11-14'
  ),
  (
    '55555555-5555-4555-8555-555555555507',
    'NEW_RETAIL_CUSTOMER_COUNT',
    'Khách hàng Cá nhân (KHCN) mở mới hợp lệ (Synthetic)',
    'NEW_RETAIL_CIF',
    'CUSTOMER',
    NULL,
    'FLOW',
    'SUM',
    'DEDUP_CUSTOMER',
    'PRIMARY_ONLY',
    1.0000,
    0.0000,
    'COUNT_DISTINCT(new_retail_customer_ref_code)',
    'SYNTHETIC_DEVTEST',
    'EOD_18_00_ICT',
    1,
    'ACTIVE',
    '2026-01-01T00:00:00.000Z',
    NULL,
    'ADR-003-D01-OPTION-A-2026-11-14'
  ),
  (
    '55555555-5555-4555-8555-555555555508',
    'BIZ_HOUSEHOLD_LOAN_BALANCE',
    'Dư nợ cho vay Hộ kinh doanh cuối kỳ (Synthetic)',
    'BIZ_HOUSEHOLD',
    'VND',
    'VND',
    'STOCK',
    'END_OF_PERIOD',
    'SUM',
    'PRIMARY_ONLY',
    1.0000,
    0.0000,
    'SNAPSHOT_END_OF_PERIOD(biz_household_loan_vnd)',
    'SYNTHETIC_DEVTEST',
    'EOD_18_00_ICT',
    1,
    'ACTIVE',
    '2026-01-01T00:00:00.000Z',
    NULL,
    'ADR-003-D01-OPTION-A-2026-11-14'
  ),
  (
    '55555555-5555-4555-8555-555555555509',
    'BIZ_HOUSEHOLD_NEW_COUNT',
    'Hộ kinh doanh mở mới hợp lệ (Synthetic)',
    'BIZ_HOUSEHOLD',
    'CUSTOMER',
    NULL,
    'FLOW',
    'SUM',
    'DEDUP_CUSTOMER',
    'PRIMARY_ONLY',
    1.0000,
    0.0000,
    'COUNT_DISTINCT(new_biz_household_ref_code)',
    'SYNTHETIC_DEVTEST',
    'EOD_18_00_ICT',
    1,
    'ACTIVE',
    '2026-01-01T00:00:00.000Z',
    NULL,
    'ADR-003-D01-OPTION-A-2026-11-14'
  ),
  (
    '55555555-5555-4555-8555-555555555510',
    'INSURANCE_FY_PREMIUM',
    'Phí bảo hiểm năm đầu thực thu (FYP Synthetic)',
    'INSURANCE',
    'VND',
    'VND',
    'FLOW',
    'SUM',
    'WEIGHTED_ATTRIBUTION',
    'PRIMARY_AND_REFERRER',
    0.7000,
    0.3000,
    'SUM(insurance_fyp_vnd * attribution_weight)',
    'SYNTHETIC_DEVTEST',
    'EOD_18_00_ICT',
    1,
    'ACTIVE',
    '2026-01-01T00:00:00.000Z',
    NULL,
    'ADR-003-D01-OPTION-A-2026-11-14'
  )
ON CONFLICT (id) DO NOTHING;

-- Seed working calendar for 2026 (full year 2026-01-01..2026-12-31, Mon-Fri working days, Sat-Sun non-working days)
INSERT INTO branch_calendar_days (
  calendar_date,
  is_working_day,
  holiday_name,
  weekly_cutoff_day,
  daily_report_cutoff_time
)
SELECT
  d::date AS calendar_date,
  CASE WHEN EXTRACT(ISODOW FROM d) BETWEEN 1 AND 5 THEN TRUE ELSE FALSE END AS is_working_day,
  CASE WHEN EXTRACT(ISODOW FROM d) IN (6, 7) THEN 'Nghỉ cuối tuần (Synthetic)' ELSE NULL END AS holiday_name,
  'MONDAY',
  '18:00'
FROM generate_series('2026-01-01'::date, '2026-12-31'::date, '1 day'::interval) AS d
ON CONFLICT (calendar_date) DO NOTHING;

-- 6. Least-privilege runtime role grants for P0A:
--    - SELECT, INSERT, UPDATE on branch_calendar_days, kpi_definitions, kpi_targets (NO DELETE)
--    - SELECT, INSERT on kpi_target_revisions (append-only revision history; NO UPDATE, NO DELETE)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime_role') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE
      branch_calendar_days,
      kpi_definitions,
      kpi_targets
    TO app_runtime_role;

    GRANT SELECT, INSERT ON TABLE
      kpi_target_revisions
    TO app_runtime_role;
  END IF;
END
$$;
