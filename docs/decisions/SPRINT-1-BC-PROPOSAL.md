# Đề xuất Mở khóa `S1-B` / `S1-C` (`TASK-0004` & `TASK-0005`), Schema Migration `0003` và Gói Quyết định `P0A`..`P0D`

Status: PROPOSED — trình Chủ dự án phê duyệt để chuyển `TASK-0004` (`S1-B`) và `TASK-0005` (`S1-C`) sang `READY`
Scope: DEVTEST — mở rộng từ `S1-A` (`TASK-0003` `ACCEPTED`) sang `S1-B` & `S1-C` local/CI synthetic; kèm gói phương án cho `D-01`..`D-04`, `D-07`, `ADR-003`..`005`
Version: 0.2
Prepared: 2026-11-14 (Asia/Ho_Chi_Minh)
Baseline: main `6751faa4d1100548cddff4ae5efaab30d832047a` (`TASK-0003` `ACCEPTED` tại [PR #6](https://github.com/vannhan091289-ux/baocaobanhang/pull/6); gói đề xuất `S1-B`/`S1-C` v0.1 tại [PR #7](https://github.com/vannhan091289-ux/baocaobanhang/pull/7); điều phối tại [Issue #8](https://github.com/vannhan091289-ux/baocaobanhang/issues/8))
References:
- [docs/runbooks/ANTIGRAVITY-RUN-TO-HANDOVER.md](../runbooks/ANTIGRAVITY-RUN-TO-HANDOVER.md)
- [docs/decisions/SPRINT-1-APPROVAL.md](SPRINT-1-APPROVAL.md)
- [docs/adr/ADR-002-authorization.md](../adr/ADR-002-authorization.md)
- [docs/specs/SPRINT-1.md](../specs/SPRINT-1.md)
- [tasks/TASK-0004.md](../../tasks/TASK-0004.md)
- [tasks/TASK-0005.md](../../tasks/TASK-0005.md)
- [tasks/TASK-0006.md](../../tasks/TASK-0006.md) .. [tasks/TASK-0011.md](../../tasks/TASK-0011.md)

---

## 1. Mục đích của Tài liệu Đề xuất này

Theo [AGENTS.md](../../AGENTS.md) mục 1, 3, 4 và [docs/runbooks/ANTIGRAVITY-RUN-TO-HANDOVER.md](../runbooks/ANTIGRAVITY-RUN-TO-HANDOVER.md):
- `TASK-0003` (`S1-A`) đã được nghiệm thu `ACCEPTED` và hợp nhất vào `main` (`d8a7bd9c4b8bbebb738dd84f7369a9446e46b2dc`).
- Trước khi viết code triển khai `S1-B` (`TASK-0004`) và `S1-C` (`TASK-0005`), hai cổng phê duyệt hiện đang khóa ở phạm vi `chỉ S1-A` trong [SPRINT-1-APPROVAL.md](SPRINT-1-APPROVAL.md) mục 3 & 4 và [ADR-002](../adr/ADR-002-authorization.md) mục 3 cần có đề xuất cụ thể để Chủ dự án duyệt:
  1. Mở rộng phạm vi áp dụng của `ADR-002` v0.3 và `D-09` A (DEVTEST synthetic) sang `S1-B` (`TASK-0004`) và `S1-C` (`TASK-0005`).
  2. Phê duyệt **Additive Migration `0003_s1b_org_and_role_workflow.sql`** (thêm cột kiểm soát đồng thời `row_version`, bảng kỹ thuật `role_assignment_proposals` cho luồng Maker-Checker đã duyệt ở `ADR-002` mục 6.1, và cấp quyền DML tối thiểu `INSERT, UPDATE` — không `DELETE` — cho `app_runtime_role`).
- Đồng thời, mục 4 của tài liệu này gom toàn bộ các quyết định nghiệp vụ còn `OPEN` (`D-01`, `D-02`, `D-03`, `D-04`, `D-07` và `ADR-003`..`005`) kèm phương án, tác động, phụ thuộc và khuyến nghị rõ ràng để Chủ dự án có thể chốt trong một lần cho chuỗi `P0A` → `P0B` → `P0C` → `P0D` → `UAT/Hardening`.

---

## 2. Đề xuất Schema & Quyền DB cho `S1-B` / `S1-C` (`migrations/0003_s1b_org_and_role_workflow.sql`)

### 2.1 Lý do cần Additive Migration `0003` và Khắc phục Lỗi Timezone `TIMESTAMPTZ`
Trong `S1-A` (`0001_s1a_foundation.sql` + `0002_revoke_changed_session_authority.sql`):
- `app_runtime_role` chỉ có quyền `SELECT` trên `departments`, `staff`, `identity_links`, `role_assignments`.
- Bảng `role_assignments` chỉ lưu các bản ghi phân quyền đã được duyệt (`status IN ('ACTIVE', 'REVOKED')`) với `approval_reference NOT NULL`. Để thực thi đúng quy tắc **Maker-Checker** tại `ADR-002` mục 6.1 (*"CONFIG_ADMIN đề nghị thay đổi quyền của người khác, EXECUTIVE phê duyệt; actor đề nghị, actor phê duyệt và Staff đích phải khác nhau"*) mà không làm bẩn bảng `role_assignments` đang có hiệu lực hoặc vi phạm quy tắc *"đúng một RoleAssignment hiệu lực mỗi Staff"*, cần bảng lưu trữ yêu cầu đề nghị thay đổi quyền (`role_assignment_proposals`) cùng cột `row_version` chống lost update.

#### Kết quả Audit Độc lập về Biểu thức `(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')` trên Cột `TIMESTAMPTZ` ([Issue #8](https://github.com/vannhan091289-ux/baocaobanhang/issues/8) Bước 2)
- **Hiện tượng & Nguyên nhân gốc rễ trên PostgreSQL 18.7:**
  - Trong PostgreSQL, `CURRENT_TIMESTAMP` (và `NOW()`) vốn đã trả về kiểu `TIMESTAMPTZ` (`timestamp with time zone`, được lưu nội bộ dưới dạng micro-giây chuẩn UTC tính từ epoch).
  - Khi áp dụng toán tử `AT TIME ZONE 'UTC'` lên một giá trị `TIMESTAMPTZ`, PostgreSQL chuyển đổi giá trị đó sang kiểu **`TIMESTAMP WITHOUT TIME ZONE`** biểu diễn giờ đồng hồ treo tường tại UTC.
  - Khi giá trị `TIMESTAMP WITHOUT TIME ZONE` này được gán ngược vào một cột hoặc biến kiểu `TIMESTAMPTZ` (như trong `DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')` hoặc `NEW.updated_at := CURRENT_TIMESTAMP AT TIME ZONE 'UTC'`), PostgreSQL sẽ **diễn giải lại giờ không múi đó theo `TimeZone` của phiên kết nối hiện tại (`session TimeZone`)**!
- **Bằng chứng thực nghiệm trên container `PostgreSQL 18.7` (`baocaobanhang-s1a-postgres`) với `SET TIME ZONE 'Asia/Ho_Chi_Minh'` (`+07`):**
  ```text
     session_tz     |      correct_utc_instant      |    stripped_without_tz     |  assigned_to_timestamptz_col  | error_offset_seconds
  ------------------+-------------------------------+----------------------------+-------------------------------+----------------------
   Asia/Ho_Chi_Minh | 2026-11-14 09:33:03.641945+07 | 2026-11-14 02:33:03.641945 | 2026-11-14 02:33:03.641945+07 |        -25200.000000
  ```
  - Khi `TimeZone` của phiên là `Asia/Ho_Chi_Minh` (`+07`), biểu thức `(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::timestamptz` làm lệch thời điểm thực tế đi **`-25200` giây (`-7 giờ`)**!
- **Giải pháp khắc phục an toàn, không sửa lịch sử migration đã áp dụng (`0001`, `0002`):**
  1. Giữ nguyên tuyệt đối hai file migration đã áp dụng trên `main` (`migrations/0001_s1a_foundation.sql` và `migrations/0002_revoke_changed_session_authority.sql`) để bảo toàn tính bất biến của lịch sử migration.
  2. Trong bản đề xuất `migrations/0003_s1b_org_and_role_workflow.sql` dưới đây:
     - Dùng trực tiếp `DEFAULT CURRENT_TIMESTAMP` trên `role_assignment_proposals.created_at` và `updated_at`.
     - Trong hàm trigger `bump_s1b_row_version()`, dùng `NEW.updated_at := CURRENT_TIMESTAMP;` (tương đồng với `revoked_at = CURRENT_TIMESTAMP` đã dùng đúng trong `0002_revoke_changed_session_authority.sql`).
     - Bổ sung các lệnh `ALTER TABLE ... ALTER COLUMN ... SET DEFAULT CURRENT_TIMESTAMP;` cho toàn bộ 9 cột `TIMESTAMPTZ` của `0001_s1a_foundation.sql` (`departments.created_at`, `departments.updated_at`, `staff.created_at`, `staff.updated_at`, `identity_links.created_at`, `identity_links.updated_at`, `role_assignments.created_at`, `role_assignments.updated_at`, `audit_events.occurred_at`) để triệt tiêu hoàn toàn nguy cơ lệch múi giờ trên mọi kết nối không phải UTC.

### 2.2 Bản xem trước SQL Đề xuất (`migrations/0003_s1b_org_and_role_workflow.sql` — Chưa thực thi)

```sql
-- 0003_s1b_org_and_role_workflow.sql (PROPOSED — DO NOT EXECUTE BEFORE TASK-0004 READY)
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
```

### 2.3 Kế hoạch Hoàn tác (Rollback) Không Phá hủy cho `0003`
- Migration `0003` chỉ thêm cột có giá trị mặc định (`row_version DEFAULT 1`) và bảng mới (`role_assignment_proposals`), không sửa đổi kiểu dữ liệu hay xóa bất kỳ cột/bảng/trigger nào của `0001` và `0002`.
- Toàn bộ bài kiểm thử và mã nguồn `S1-A` (`TASK-0003`) tiếp tục chạy đúng 100% ngay cả khi `0003` đã được áp dụng.
- Nếu cần hoàn tác `S1-B` về trạng thái chỉ cho phép `S1-A`: đóng các route `/api/org/*` và `/api/role-assignments/*` và thu hồi quyền `INSERT, UPDATE` của `app_runtime_role` trên 5 bảng tổ chức/quyền mà **không** cần `DROP TABLE` hay xóa bất kỳ bản ghi `audit_events` / `identity_links` nào.

---

## 3. Ma trận Tính năng Toàn Chương trình (`PRODUCT.md` Feature Matrix & Roadmap)

Bảng dưới đây ánh xạ toàn bộ 5 nhóm điều hướng của [docs/PRODUCT.md](../PRODUCT.md) sang chuỗi task từ Sprint 0 đến UAT/Hardening:

| Nhóm chức năng (`PRODUCT.md`) | Slice / Mã Task | Vai trò liên quan | Phụ thuộc kỹ thuật & Gate Quyết định | Trạng thái hiện tại |
|---|---|---|---|---|
| **0. Nền tảng Kỹ thuật & Cổng Bảo mật** | **Sprint 0 — `TASK-0001`** | Tất cả | `D-06`, `ADR-001` (`ACCEPTED`) | **`ACCEPTED`** ([PR #3](https://github.com/vannhan091289-ux/baocaobanhang/pull/3), SHA `bac54ba9`) |
| **1A. Đặc tả Sprint 1 & Ma trận Phân quyền** | **Sprint 1 Spec — `TASK-0002` + `PR #5`** | Tất cả | `D-08 B`, `D-09 A`, `ADR-002` v0.3 (`ACCEPTED` cho DEVTEST) | **`ACCEPTED`** ([PR #4](https://github.com/vannhan091289-ux/baocaobanhang/pull/4), [PR #5](https://github.com/vannhan091289-ux/baocaobanhang/pull/5)) |
| **1B. Định danh OIDC, Phiên Server-Side & 7 Bảng Nền** | **Sprint 1 `S1-A` — `TASK-0003`** | `EXECUTIVE`, `CONFIG_ADMIN`, `DEPARTMENT_MANAGER`, `STAFF`, `ANONYMOUS`/`DENY` | Colima ARM64 preflight PASS, `SPRINT-1-IMAGES.md` LOCKED | **`ACCEPTED`** ([PR #6](https://github.com/vannhan091289-ux/baocaobanhang/pull/6), `main` SHA `d8a7bd9c`, CI `43468523124` PASS) |
| **5A. Quản trị Danh mục Tổ chức & Maker-Checker Phân quyền** | **Sprint 1 `S1-B` — `TASK-0004`** | `CONFIG_ADMIN` (CRUD Org + đề nghị role), `EXECUTIVE` (duyệt role), `DEPARTMENT_MANAGER` / `STAFF` (đọc theo scope) | Cần duyệt mục 2 của đề xuất này (`0003` migration + mở scope `S1-B`) và chuyển `TASK-0004` sang `READY` | **`REVIEWED`** ([tasks/TASK-0004.md](../../tasks/TASK-0004.md) — sẵn sàng chuyển `READY`) |
| **5B. Hoàn thiện Ma trận RBAC, Biên Thời gian/Đồng thời & Kiểm toán** | **Sprint 1 `S1-C` — `TASK-0005`** | Tất cả 4 vai trò + toàn bộ ca từ chối/race conditions | Phụ thuộc `TASK-0004` `ACCEPTED` + chuyển `TASK-0005` sang `READY` | **`REVIEWED`** ([tasks/TASK-0005.md](../../tasks/TASK-0005.md) — sẵn sàng chuyển `READY` sau `S1-B`) |
| **2A. Từ điển 7 Nhóm KPI & Giao/Duyệt Chỉ tiêu Năm/Tháng/Tuần/Ngày** | **MVP `P0A` — `TASK-0006`** | `CONFIG_ADMIN` (cấu hình từ điển KPI), `EXECUTIVE` / `DEPARTMENT_MANAGER` (giao/duyệt Target), `STAFF` (xem Target) | Phụ thuộc `TASK-0005` `ACCEPTED` + chốt **`D-01`, `D-03`, `ADR-003`** (mục 4.1 bên dưới) | **`PROPOSED`** (Chờ chốt `D-01`, `D-03`, `ADR-003`) |
| **3. Kế hoạch Bán hàng Tuần/Ngày, Nhật ký Một Nguồn & Review Thứ Hai** | **MVP `P0B-1` — `TASK-0007`** | `STAFF` (lập kế hoạch, ghi nhật ký), `DEPARTMENT_MANAGER` / `EXECUTIVE` (review tuần) | Phụ thuộc `TASK-0006` `ACCEPTED` + chốt **`D-03`** | **`PROPOSED`** (Chờ chốt `D-03`) |
| **1 & 2B. Ghi nhận/Đối soát `Actual` (`PROVISIONAL`/`RECONCILED`/`FINAL`) & Dashboard Đa lớp** | **MVP `P0B-2` — `TASK-0008`** | `EXECUTIVE` (Chi nhánh → Phòng → NV), `DEPARTMENT_MANAGER` (Phòng → NV), `STAFF` (Cá nhân), `CONFIG_ADMIN` (`DENY` dữ liệu KH/KPI) | Phụ thuộc `TASK-0006`, `TASK-0007` `ACCEPTED` + chốt **`D-01`, `D-02`, `D-07`, `ADR-003`** | **`PROPOSED`** (Chờ chốt `D-01`, `D-02`, `D-07`) |
| **4A & Cảnh báo P0. Pipeline `Prospect` → `Lead` → `Opportunity` & Engine Cảnh báo In-App** | **MVP `P0C` — `TASK-0009`** | `STAFF`, `DEPARTMENT_MANAGER`, `EXECUTIVE` (`CONFIG_ADMIN` chỉ xem cấu hình rule cảnh báo, không xem dữ liệu KH) | Phụ thuộc `TASK-0007`, `TASK-0008` `ACCEPTED` + chốt **`D-04`, `ADR-004`** | **`PROPOSED`** (Chờ chốt `D-04`, `ADR-004`) |
| **4B. `Customer 360` Giới hạn (Synthetic Ref) & Drill-Down Xuyên suốt** | **MVP `P0D` — `TASK-0010`** | `EXECUTIVE`, `DEPARTMENT_MANAGER`, `STAFF` (`CONFIG_ADMIN` bị `DENY` tuyệt đối) | Phụ thuộc `TASK-0008`, `TASK-0009` `ACCEPTED` + chốt **`ADR-005`** | **`PROPOSED`** (Chờ chốt `ADR-005`) |
| **Nghiệm thu Tổng thể. E2E Multi-Role Journeys, Backup/Restore & Security Hardening** | **MVP `UAT` — `TASK-0011`** | Toàn bộ vai trò | Phụ thuộc `TASK-0010` `ACCEPTED` | **`PROPOSED`** (Cuối chuỗi MVP synthetic) |

---

## 4. Gói Quyết định Mở Tập trung (`D-01`..`D-04`, `D-07`, `ADR-003`..`005`) — Kèm Phương án & Khuyến nghị

> **Lưu ý quan trọng:** Các đề xuất dưới đây chỉ là **phương án trình duyệt** (`PROPOSED`) cho môi trường **DEVTEST synthetic**, tuyệt đối không tự diễn giải thành chính sách đã duyệt khi chưa có xác nhận của Chủ dự án. `D-05` (dữ liệu thật/hosting) và `D-10` (IdP doanh nghiệp thật) tiếp tục giữ `OPEN`.

### 4.1 `D-01` & `ADR-003` — Định nghĩa 7 Nhóm KPI, Công thức & Quy tắc Tổng hợp

| Quyết định | Phương án A (Khuyến nghị cho DEVTEST Synthetic MVP) | Phương án B (Chờ bảng quy chuẩn chi tiết từ Ngân hàng) |
|---|---|---|
| **1. Cho vay (`LOAN`)** | Tách 2 chỉ số chuẩn: `LOAN_BALANCE_END` (`STOCK`, dư nợ cuối kỳ, `VND`, lấy mốc `as_of_date` cuối kỳ) và `LOAN_DISBURSEMENT` (`FLOW`, doanh số giải ngân phát sinh trong kỳ, `VND`, cộng theo thời gian). | Chỉ mở cấu trúc bảng `kpi_definitions` trống, chưa seed công thức tính cho đến khi có văn bản nghiệp vụ. |
| **2. Huy động (`DEPOSIT`)** | `DEPOSIT_BALANCE_END` (`STOCK`, số dư huy động cuối kỳ, `VND`, không cộng dồn qua các ngày/tháng) và `DEPOSIT_NET_CHANGE` (`NET_CHANGE`, tăng trưởng ròng so với đầu kỳ, `VND`). | Giữ chờ định nghĩa số dư bình quân (`AVERAGE`) từ nguồn Core. |
| **3. Thẻ tín dụng (`CARD`)** | `CREDIT_CARD_ACTIVATED` (`FLOW`, số lượng thẻ tín dụng phát hành mới và đã kích hoạt trong kỳ, đơn vị `CARD`, cộng tổng theo kỳ/nhân sự). | Tính theo tổng hạn mức thẻ phê duyệt (`VND`). |
| **4. Thanh toán quốc tế (`TTQT`)** | `TTQT_VOLUME_USD` (`FLOW`, doanh số TTQT quy đổi `USD` theo tỷ giá tham chiếu cấu hình của kỳ báo cáo; không tự lấy tỷ giá ngoài mạng). | Tính theo doanh thu phí dịch vụ TTQT (`VND`). |
| **5. KHCN mới (`NEW_RETAIL_CIF`)** | `NEW_RETAIL_CUSTOMER_COUNT` (`FLOW`, số lượng mã tham chiếu KHCN mở mới hợp lệ trong kỳ, chống trùng theo `customer_ref_code`, đơn vị `CUSTOMER`). | Chỉ tính KHCN mới có phát sinh số dư tối thiểu. |
| **6. Hộ kinh doanh (`BIZ_HOUSEHOLD`)** | `BIZ_HOUSEHOLD_LOAN_BALANCE` (`STOCK`, dư nợ cuối kỳ phân khúc Hộ kinh doanh, `VND`) và `BIZ_HOUSEHOLD_NEW_COUNT` (`FLOW`, số hộ kinh doanh mở mới, `CUSTOMER`). | Chỉ theo dõi một chỉ số duy nhất. |
| **7. Bảo hiểm (`INSURANCE`)** | `INSURANCE_FY_PREMIUM` (`FLOW`, phí bảo hiểm năm đầu thực thu đã qua thời gian cân nhắc, đơn vị `VND`, cộng tổng theo kỳ/nhân sự). | Tính theo số lượng hợp đồng bảo hiểm phát hành. |
| **Quy tắc toán học & dữ liệu khuyết (`BUSINESS_RULES.md`)** | - Tiền tệ lưu kiểu `NUMERIC(20, 2)` (không dùng `FLOAT`).<br>- Khi `actual_value IS NULL`: trạng thái là `MISSING_DATA`; **không** thay bằng `0`, **không** tính `gap` hay `completion_pct`, và **không** phát cảnh báo chậm tiến độ KPI.<br>- Khi `actual_value IS NOT NULL`: `gap = actual_value - target_value`; nếu `target_value > 0` thì `completion_pct = ROUND((actual_value / target_value) * 100, 2)`, nếu `target_value <= 0` thì `completion_pct = NULL` (`TARGET_NON_POSITIVE`).<br>- Không bao giờ cộng `STOCK` hoặc cộng `%` giữa các kỳ thời gian. | Giữ nguyên quy tắc này trong mọi phương án vì đã được chốt trong `docs/BUSINESS_RULES.md`. |

### 4.2 `D-02` — Ghi nhận Bán chéo Nhiều Nhân sự (`Cross-Sell Attribution`)

- **Phương án A (Khuyến nghị):** Mỗi bản ghi `Actual` có `primary_staff_id` (mặc định hưởng `100%`) và tùy chọn `referrer_staff_id` kèm tỷ lệ cấu hình theo từng metric trong `kpi_definitions` (ví dụ `primary_weight = 1.00, referrer_weight = 0.00` hoặc tách `70% / 30%` sao cho tổng trọng số quy đổi vào phòng/chi nhánh không bị tính trùng `200%` ở cấp Chi nhánh).
- **Phương án B:** Giai đoạn MVP chỉ ghi nhận `100%` cho một `owner_staff_id` duy nhất; trường `referrer_staff_id` chỉ lưu để tham khảo lịch sử phối hợp, chưa chia tách số liệu KPI.

### 4.3 `D-03` — Lịch Ngày Làm việc & Kỳ Chốt Tuần (`Working Calendar & Weekly Cut-off`)

- **Phương án A (Khuyến nghị):**
  - Múi giờ hiển thị và tính kỳ nghiệp vụ: `Asia/Ho_Chi_Minh` (`UTC+07:00`), lưu trữ timestamp chuẩn `UTC` trong DB.
  - Kỳ tuần: Thứ Hai `00:00:00+07:00` đến Chủ Nhật `23:59:59+07:00`; phiên họp Review tuần diễn ra vào sáng Thứ Hai.
  - Ngày làm việc chuẩn: Thứ Hai đến Thứ Sáu (trừ các ngày nghỉ lễ được cấu hình trong bảng `branch_calendar_days` do `CONFIG_ADMIN` quản trị).

### 4.4 `D-04` & `ADR-004` — Ngưỡng Cảnh báo P0 Trong Ứng dụng (`In-App Alerts & SLA`)

- **Phương án A (Khuyến nghị):** Toàn bộ ngưỡng nằm trong bảng cấu hình `alert_rule_configs` (không hardcode cố định trong code), khởi tạo giá trị synthetic mặc định cho DEVTEST:
  1. `KPI_BEHIND_SCHEDULE`: khi tỷ lệ hoàn thành thực tế `< 80%` so với tiến độ thời gian làm việc đã trôi qua trong kỳ (chỉ tính khi `actual_value IS NOT NULL` và `target_value > 0`).
  2. `DAILY_REPORT_MISSING`: chưa ghi nhận nhật ký/báo cáo ngày sau mốc cut-off cấu hình (`18:00` ngày làm việc).
  3. `LEAD_STALE_OVERDUE`: `Lead` / `Opportunity` đang mở nhưng không có tương tác mới quá `3` ngày làm việc.
  4. `CUSTOMER_MATURITY_UPCOMING`: mốc đáo hạn/tái cấp của `Customer` còn `<= 14` ngày.
  5. `DIRECTIVE_TASK_OVERDUE`: công việc/chỉ đạo quản trị quá hạn `due_at`.
  6. `APPROVAL_PENDING_SLA`: đề nghị phân quyền/chỉ tiêu/đối soát ở trạng thái `PENDING` quá `1` ngày làm việc (`24h`).
  - Mọi cảnh báo có `dedup_key` chống tạo trùng, tách biệt trạng thái `read_at` (đã đọc) với `resolution_status` (`OPEN` / `RESOLVED` / `DISMISSED` kèm bằng chứng hoặc lý do bắt buộc).

### 4.5 `D-07` — Điểm Tổng hợp Chi nhánh (`Executive Composite Score`)

- **Khuyến nghị (Tuân thủ `BUSINESS_RULES.md`):** Giữ trạng thái **không tính điểm trung bình cộng/composite score** trên Dashboard Giám đốc; hiển thị tách biệt từng nhóm trong 7 nhóm KPI kèm trạng thái đối soát (`PROVISIONAL` / `RECONCILED` / `FINAL` / `MISSING_DATA`).

### 4.6 `ADR-005` — Giới hạn Dữ liệu `Customer 360` Tham chiếu (`Scoped Customer Reference`)

- **Phương án A (Khuyến nghị cho DEVTEST Synthetic):**
  - Bảng `customer_references` chỉ lưu: `id`, `customer_ref_code` (mã tham chiếu synthetic, ví dụ `SYN-CIF-KHCN-0001`), `segment` (`KHCN` / `KHDN` / `HKD`), `synthetic_display_name`, `managing_department_id`, `assigned_staff_id`, `status`, và các mốc ngày `maturity_date` / `renewal_date` trong `customer_milestones`.
  - **Cấm tuyệt đối** cột lưu số CCCD/CMND, số điện thoại thật, email thật, địa chỉ nhà, số tài khoản ngân hàng thật hay sao kê giao dịch chi tiết.
  - Thực thi quyền nghiêm ngặt: `CONFIG_ADMIN` nhận `403 CONFIG_ADMIN_CUSTOMER_KPI_FORBIDDEN` trên mọi API `customer.*`, `lead.*`, `opportunity.*`, `kpi.*`.

---

## 5. Khung Phê duyệt Nhanh dành cho Chủ dự án

Chủ dự án có thể phê duyệt mở khóa ngay `S1-B` / `S1-C` (và tùy chọn mở khóa luôn `P0A`..`P0D`) bằng chỉ dẫn ngắn:

1. **Để mở khóa ngay `TASK-0004` (`S1-B`) và `TASK-0005` (`S1-C`):**
   > *"Duyệt `docs/decisions/SPRINT-1-BC-PROPOSAL.md` mục 2 (mở rộng scope DEVTEST sang S1-B/S1-C và migration 0003), chuyển `TASK-0004` sang `READY` (và `TASK-0005` sang `READY` ngay sau khi `TASK-0004` `ACCEPTED`) để Antigravity triển khai."*
2. **Để mở khóa luôn toàn chuỗi `P0A` → `P0D` (không cần dừng hỏi lại sau Sprint 1):**
   > *"Duyệt thêm mục 4 của `docs/decisions/SPRINT-1-BC-PROPOSAL.md` (Phương án A cho `D-01`..`D-04`, `D-07`, `ADR-003`..`005` ở phạm vi DEVTEST synthetic; giữ `D-05` và `D-10` `OPEN`) và cho phép chuyển tuần tự `TASK-0006`..`TASK-0011` sang `READY` theo phụ thuộc."*
