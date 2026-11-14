-- Migration 0005: P0B-1 Weekly/Daily Sales Plans, Single-Source Activity Log & Monday Review (Synthetic DEVTEST)
-- Depends on: 0001_s1a_foundation.sql, 0003_s1b_org_and_role_workflow.sql, 0004_p0a_kpi_dictionary_and_targets.sql
-- Additive-only migration; preserves all S1-A/S1-B/S1-C/P0A tables and rows.
-- All TIMESTAMPTZ columns use CURRENT_TIMESTAMP (zero Asia/Ho_Chi_Minh timezone drift).

CREATE TABLE IF NOT EXISTS sales_plans (
  id UUID PRIMARY KEY,
  staff_id UUID NOT NULL REFERENCES staff(id),
  department_id UUID NOT NULL REFERENCES departments(id),
  period_type TEXT NOT NULL CHECK (period_type IN ('WEEK', 'DAY')),
  period_key TEXT NOT NULL,
  kpi_target_id UUID REFERENCES kpi_targets(id),
  title TEXT NOT NULL,
  focus_notes TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'REVIEWED', 'CLOSED')),
  submitted_at TIMESTAMPTZ,
  reviewed_by_staff_id UUID REFERENCES staff(id),
  reviewed_at TIMESTAMPTZ,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sales_plans_dept_period
  ON sales_plans (department_id, period_key);

CREATE INDEX IF NOT EXISTS idx_sales_plans_staff_period
  ON sales_plans (staff_id, period_key);

DROP TRIGGER IF EXISTS trg_sales_plans_row_version ON sales_plans;
CREATE TRIGGER trg_sales_plans_row_version
  BEFORE UPDATE ON sales_plans
  FOR EACH ROW
  EXECUTE FUNCTION bump_s1b_row_version();

CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY,
  actor_staff_id UUID NOT NULL REFERENCES staff(id),
  department_id UUID NOT NULL REFERENCES departments(id),
  sales_plan_id UUID REFERENCES sales_plans(id),
  kpi_definition_id UUID REFERENCES kpi_definitions(id),
  synthetic_customer_ref TEXT,
  activity_type TEXT NOT NULL CHECK (
    activity_type IN (
      'CUSTOMER_VISIT',
      'CALL',
      'CONSULTATION',
      'LOAN_APP_INTAKE',
      'DEPOSIT_PITCH',
      'CARD_CROSS_SELL',
      'INSURANCE_PITCH',
      'FOLLOW_UP'
    )
  ),
  occurred_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PLANNED', 'COMPLETED', 'CANCELLED', 'FOLLOW_UP_NEEDED')),
  outcome_summary TEXT NOT NULL,
  next_step TEXT,
  next_action_due_at TIMESTAMPTZ,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_dept_occurred
  ON activity_logs (department_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_logs_staff_occurred
  ON activity_logs (actor_staff_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_logs_plan
  ON activity_logs (sales_plan_id);

DROP TRIGGER IF EXISTS trg_activity_logs_row_version ON activity_logs;
CREATE TRIGGER trg_activity_logs_row_version
  BEFORE UPDATE ON activity_logs
  FOR EACH ROW
  EXECUTE FUNCTION bump_s1b_row_version();

CREATE TABLE IF NOT EXISTS monday_reviews (
  id UUID PRIMARY KEY,
  week_period_key TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('BRANCH', 'DEPARTMENT')),
  department_id UUID REFERENCES departments(id),
  conducted_by_staff_id UUID NOT NULL REFERENCES staff(id),
  review_date DATE NOT NULL,
  summary_notes TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'COMPLETED')),
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_monday_review_scope_dept CHECK (
    (scope_type = 'BRANCH' AND department_id IS NULL)
    OR (scope_type = 'DEPARTMENT' AND department_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_monday_reviews_week_scope_dept
  ON monday_reviews (week_period_key, scope_type, COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid));

DROP TRIGGER IF EXISTS trg_monday_reviews_row_version ON monday_reviews;
CREATE TRIGGER trg_monday_reviews_row_version
  BEFORE UPDATE ON monday_reviews
  FOR EACH ROW
  EXECUTE FUNCTION bump_s1b_row_version();

CREATE TABLE IF NOT EXISTS directive_tasks (
  id UUID PRIMARY KEY,
  monday_review_id UUID NOT NULL REFERENCES monday_reviews(id),
  department_id UUID NOT NULL REFERENCES departments(id),
  assignee_staff_id UUID NOT NULL REFERENCES staff(id),
  issued_by_staff_id UUID NOT NULL REFERENCES staff(id),
  title TEXT NOT NULL,
  description TEXT,
  due_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'DONE', 'OVERDUE')),
  completion_note TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_directive_tasks_dept_status
  ON directive_tasks (department_id, status);

CREATE INDEX IF NOT EXISTS idx_directive_tasks_assignee
  ON directive_tasks (assignee_staff_id, status);

DROP TRIGGER IF EXISTS trg_directive_tasks_row_version ON directive_tasks;
CREATE TRIGGER trg_directive_tasks_row_version
  BEFORE UPDATE ON directive_tasks
  FOR EACH ROW
  EXECUTE FUNCTION bump_s1b_row_version();

-- Least-privilege runtime role grants (no DELETE, no DDL)
GRANT SELECT, INSERT, UPDATE ON sales_plans TO app_runtime_role;
GRANT SELECT, INSERT, UPDATE ON activity_logs TO app_runtime_role;
GRANT SELECT, INSERT, UPDATE ON monday_reviews TO app_runtime_role;
GRANT SELECT, INSERT, UPDATE ON directive_tasks TO app_runtime_role;
