-- 0001_s1a_foundation.sql
-- Sprint 1 (S1-A) Synthetic Identity, Session & 7-Table Foundation
-- Approved contract: docs/decisions/SPRINT-1-APPROVAL.md §3 & docs/adr/ADR-002-authorization.md v0.3
-- No PostgreSQL extensions required; UUIDs are generated or validated as canonical UUIDs.

-- 1. Department (Danh mục Phòng ban — 3 phòng nghiệp vụ KHCN, KHDN, DVKH)
CREATE TABLE departments (
  id UUID PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_]+$'),
  name VARCHAR(160) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT ( CURRENT_TIMESTAMP AT TIME ZONE 'UTC' ),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT ( CURRENT_TIMESTAMP AT TIME ZONE 'UTC' )
);

-- 2. Staff (Hồ sơ Nhân sự synthetic tối thiểu)
CREATE TABLE staff (
  id UUID PRIMARY KEY,
  staff_code VARCHAR(64) NOT NULL UNIQUE CHECK (staff_code ~ '^[A-Z0-9_-]+$'),
  display_name VARCHAR(160) NOT NULL,
  department_id UUID NOT NULL REFERENCES departments (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status VARCHAR(16) NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT ( CURRENT_TIMESTAMP AT TIME ZONE 'UTC' ),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT ( CURRENT_TIMESTAMP AT TIME ZONE 'UTC' )
);

CREATE INDEX idx_staff_department_id ON staff (department_id);

-- 3. IdentityLink (Liên kết định danh OIDC iss + sub -> Staff)
CREATE TABLE identity_links (
  id UUID PRIMARY KEY,
  issuer VARCHAR(512) NOT NULL CHECK (length(trim(issuer)) > 0),
  subject VARCHAR(255) NOT NULL CHECK (length(trim(subject)) > 0),
  staff_id UUID NOT NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status VARCHAR(16) NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT ( CURRENT_TIMESTAMP AT TIME ZONE 'UTC' ),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT ( CURRENT_TIMESTAMP AT TIME ZONE 'UTC' ),
  CONSTRAINT uq_identity_links_issuer_subject UNIQUE (issuer, subject)
);

-- S1-A: at most one ACTIVE identity link per Staff
CREATE UNIQUE INDEX uq_identity_links_active_staff
  ON identity_links (staff_id)
  WHERE status = 'ACTIVE';

-- 4. RoleAssignment (Phân quyền có thời hạn hiệu lực [effective_from, effective_to))
CREATE TABLE role_assignments (
  id UUID PRIMARY KEY,
  staff_id UUID NOT NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  role_code VARCHAR(32) NOT NULL CHECK (
    role_code IN ('EXECUTIVE', 'CONFIG_ADMIN', 'DEPARTMENT_MANAGER', 'STAFF')
  ),
  scope_type VARCHAR(16) NOT NULL CHECK (
    scope_type IN ('BRANCH', 'DEPARTMENT', 'SELF')
  ),
  scope_department_id UUID NULL REFERENCES departments (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  approval_reference VARCHAR(160) NOT NULL CHECK (length(trim(approval_reference)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT ( CURRENT_TIMESTAMP AT TIME ZONE 'UTC' ),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT ( CURRENT_TIMESTAMP AT TIME ZONE 'UTC' ),
  CONSTRAINT chk_role_assignment_interval CHECK (
    effective_to IS NULL OR effective_to > effective_from
  ),
  CONSTRAINT chk_role_assignment_scope_pair CHECK (
    (role_code IN ('EXECUTIVE', 'CONFIG_ADMIN') AND scope_type = 'BRANCH' AND scope_department_id IS NULL)
    OR (role_code = 'DEPARTMENT_MANAGER' AND scope_type = 'DEPARTMENT' AND scope_department_id IS NOT NULL)
    OR (role_code = 'STAFF' AND scope_type = 'SELF' AND scope_department_id IS NULL)
  )
);

CREATE INDEX idx_role_assignments_staff_id ON role_assignments (staff_id);

-- 5. Session (Phiên làm việc server-side, chỉ lưu token_hash SHA-256)
CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  staff_id UUID NOT NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  identity_link_id UUID NOT NULL REFERENCES identity_links (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  role_assignment_id UUID NOT NULL REFERENCES role_assignments (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  csrf_token VARCHAR(128) NOT NULL CHECK (length(csrf_token) >= 32),
  created_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  revoked_reason VARCHAR(64) NULL,
  CONSTRAINT chk_sessions_expiry CHECK (absolute_expires_at > created_at)
);

CREATE INDEX idx_sessions_staff_id ON sessions (staff_id);

-- 6. AuthTransaction (Giao dịch đăng nhập OIDC 1 lần, TTL 5 phút, verifier mã hóa AES-256-GCM)
CREATE TABLE auth_transactions (
  id UUID PRIMARY KEY,
  tx_cookie_hash CHAR(64) NOT NULL UNIQUE CHECK (tx_cookie_hash ~ '^[0-9a-f]{64}$'),
  state_value VARCHAR(128) NOT NULL UNIQUE CHECK (length(state_value) >= 32),
  nonce_value VARCHAR(128) NOT NULL CHECK (length(nonce_value) >= 32),
  verifier_ciphertext_b64 TEXT NOT NULL,
  verifier_iv_b64 VARCHAR(64) NOT NULL,
  verifier_auth_tag_b64 VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  CONSTRAINT chk_auth_transactions_ttl CHECK (expires_at > created_at)
);

CREATE INDEX idx_auth_transactions_expires_at ON auth_transactions (expires_at);

-- 7. AuditEvent (Sự kiện kiểm toán bất biến đối với runtime role — append-only)
CREATE TABLE audit_events (
  id UUID PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT ( CURRENT_TIMESTAMP AT TIME ZONE 'UTC' ),
  actor_staff_id UUID NULL REFERENCES staff (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  actor_subject_ref VARCHAR(160) NOT NULL,
  action VARCHAR(64) NOT NULL,
  resource_type VARCHAR(64) NOT NULL,
  resource_id VARCHAR(160) NOT NULL,
  scope_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  decision VARCHAR(8) NOT NULL CHECK (decision IN ('ALLOW', 'DENY')),
  reason_code VARCHAR(64) NOT NULL,
  policy_version VARCHAR(32) NOT NULL
);

CREATE INDEX idx_audit_events_occurred_at ON audit_events (occurred_at);
CREATE INDEX idx_audit_events_actor_staff_id ON audit_events (actor_staff_id);

-- Least-privilege runtime role grants (app_runtime_role is provisioned by harness before migration)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime_role') THEN
    REVOKE ALL ON SCHEMA public FROM PUBLIC;
    REVOKE ALL ON SCHEMA public FROM app_runtime_role;
    GRANT USAGE ON SCHEMA public TO app_runtime_role;

    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_runtime_role;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM app_runtime_role;

    -- Read-only on organization, identity, and role assignment tables in S1-A
    GRANT SELECT ON TABLE departments, staff, identity_links, role_assignments TO app_runtime_role;

    -- DML on technical session and auth_transactions tables
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE sessions, auth_transactions TO app_runtime_role;

    -- Strictly append-only (INSERT) + SELECT for verification on audit_events; NO UPDATE or DELETE
    GRANT SELECT, INSERT ON TABLE audit_events TO app_runtime_role;
  END IF;
END
$$;
