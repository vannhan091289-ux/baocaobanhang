import { cookies } from "next/headers";
import Link from "next/link";
import { SESSION_COOKIE_NAME, verifyRequestSession } from "@/server/session";
import { AuditViewerPanel } from "./audit-viewer-panel";
import { OrgManagementPanel } from "./org-management-panel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<string, string> = {
  EXECUTIVE: "Ban Giám đốc (EXECUTIVE)",
  CONFIG_ADMIN: "Quản trị Cấu hình (CONFIG_ADMIN)",
  DEPARTMENT_MANAGER: "Trưởng phòng (DEPARTMENT_MANAGER)",
  STAFF: "Chuyên viên (STAFF)",
};

const SCOPE_LABELS: Record<string, string> = {
  BRANCH: "Toàn chi nhánh (BRANCH)",
  DEPARTMENT: "Phòng ban được giao (DEPARTMENT)",
  SELF: "Cá nhân (SELF)",
};

export default async function WorkspacePage() {
  const cookieStore = await cookies();
  const rawSessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const sessionCheck = await verifyRequestSession({ rawSessionToken });

  if (!sessionCheck.authenticated) {
    const isUnauthenticated = sessionCheck.httpStatus === 401;
    return (
      <main
        className="scaffold-container"
        aria-labelledby="workspace-denied-heading"
      >
        <header className="scaffold-header">
          <p className="scaffold-badge">
            {isUnauthenticated
              ? "Yêu cầu xác thực (401)"
              : "Từ chối truy cập (403)"}
          </p>
          <h1 id="workspace-denied-heading">
            {isUnauthenticated
              ? "Phiên làm việc chưa xác thực hoặc đã hết hạn"
              : "Tài khoản không có quyền truy cập không gian làm việc"}
          </h1>
        </header>
        <section
          className="scaffold-status"
          aria-labelledby="denied-detail-heading"
        >
          <h2 id="denied-detail-heading">Thông tin kiểm soát truy cập</h2>
          <p>
            {isUnauthenticated
              ? "Vui lòng đăng nhập qua cổng xác thực OIDC để thiết lập phiên làm việc hợp lệ."
              : "Tài khoản của bạn đã xác thực nhưng không thỏa mãn điều kiện liên kết nhân sự ACTIVE hoặc phân quyền hiệu lực duy nhất theo chính sách ADR-002."}
          </p>
          <p>
            Mã trạng thái kiểm tra: <code>{sessionCheck.reasonCode}</code>
          </p>
          <div className="scaffold-actions">
            <a className="scaffold-button" href="/auth/login">
              Đăng nhập lại qua OIDC
            </a>
            <Link className="scaffold-link" href="/">
              Quay về trang chủ
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const { selfContext, csrfToken } = sessionCheck;
  const roleCode = selfContext.effective_role.role_code;
  const isConfigAdmin = roleCode === "CONFIG_ADMIN";
  const canViewAudit = roleCode === "CONFIG_ADMIN" || roleCode === "EXECUTIVE";

  return (
    <main className="scaffold-container" aria-labelledby="workspace-heading">
      <header className="scaffold-header">
        <p className="scaffold-badge">
          Không gian làm việc đã bảo vệ — Sprint 1 (S1-A Synthetic)
        </p>
        <h1 id="workspace-heading">
          Xin chào, {selfContext.display_name} ({selfContext.staff_code})
        </h1>
      </header>

      <section
        className="scaffold-status"
        aria-labelledby="self-context-heading"
      >
        <h2 id="self-context-heading">
          Hồ sơ nhân sự &amp; phạm vi quyền hiệu lực của bạn
        </h2>
        <p>
          Thông tin dưới đây được xác thực và kiểm tra trực tiếp từ cơ sở dữ
          liệu backend trên mỗi yêu cầu (không lưu đệm quyết định cấp quyền):
        </p>

        <dl className="workspace-grid">
          <div className="workspace-field">
            <dt>Mã nhân sự</dt>
            <dd data-testid="self-staff-code">{selfContext.staff_code}</dd>
          </div>
          <div className="workspace-field">
            <dt>Họ và tên (Synthetic)</dt>
            <dd data-testid="self-display-name">{selfContext.display_name}</dd>
          </div>
          <div className="workspace-field">
            <dt>Trạng thái nhân sự</dt>
            <dd data-testid="self-status">{selfContext.status}</dd>
          </div>
          <div className="workspace-field">
            <dt>Phòng ban trực thuộc</dt>
            <dd data-testid="self-department">
              {selfContext.department.name} ({selfContext.department.code})
            </dd>
          </div>
          <div className="workspace-field">
            <dt>Vai trò hiệu lực</dt>
            <dd data-testid="self-role-code">
              {ROLE_LABELS[selfContext.effective_role.role_code] ??
                selfContext.effective_role.role_code}
            </dd>
          </div>
          <div className="workspace-field">
            <dt>Phạm vi dữ liệu (Data Scope)</dt>
            <dd data-testid="self-scope-type">
              {SCOPE_LABELS[selfContext.effective_role.scope_type] ??
                selfContext.effective_role.scope_type}
            </dd>
          </div>
        </dl>
      </section>

      <OrgManagementPanel
        csrfToken={csrfToken}
        actorStaffId={selfContext.staff_id}
        actorRoleCode={selfContext.effective_role.role_code}
        actorScopeType={selfContext.effective_role.scope_type}
      />

      <section
        className="scaffold-status"
        aria-labelledby="module-empty-heading"
      >
        <h2 id="module-empty-heading">Điều hướng 5 nhóm phân hệ</h2>
        <p>
          Hệ thống phân chia điều hướng theo 5 nhóm chức năng và chỉ hiển thị
          liên kết phù hợp với vai trò hiệu lực (<code>{roleCode}</code>).
        </p>
        <nav
          aria-label="Điều hướng phân hệ nghiệp vụ"
          data-testid="workspace-nav-groups"
        >
          {!isConfigAdmin ? (
            <div className="workspace-nav-groups">
              <div data-testid="nav-group-overview">
                <h3>1. Tổng quan &amp; Điều hành</h3>
                <div className="scaffold-actions">
                  <Link
                    className="scaffold-button"
                    href="/workspace/dashboard"
                    data-testid="nav-dashboard"
                  >
                    Dashboard Đa lớp &amp; Đối soát Actual (P0B-2)
                  </Link>
                  <Link
                    className="scaffold-button"
                    href="/workspace/alerts"
                    data-testid="nav-alerts"
                  >
                    Trung tâm Cảnh báo P0 (P0C)
                  </Link>
                </div>
              </div>

              <div data-testid="nav-group-kpi">
                <h3>2. Chỉ tiêu &amp; Kết quả</h3>
                <div className="scaffold-actions">
                  <Link
                    className="scaffold-button"
                    href="/workspace/kpi-targets"
                    data-testid="nav-kpi-targets"
                  >
                    Từ điển 7 Nhóm KPI &amp; Chỉ tiêu (P0A)
                  </Link>
                </div>
              </div>

              <div data-testid="nav-group-planning">
                <h3>3. Kế hoạch bán hàng</h3>
                <div className="scaffold-actions">
                  <Link
                    className="scaffold-button"
                    href="/workspace/planning"
                    data-testid="nav-planning"
                  >
                    Kế hoạch Bán hàng &amp; Review Thứ Hai (P0B-1)
                  </Link>
                </div>
              </div>

              <div data-testid="nav-group-customers">
                <h3>4. Khách hàng &amp; Cơ hội</h3>
                <div className="scaffold-actions">
                  <Link
                    className="scaffold-button"
                    href="/workspace/pipeline"
                    data-testid="nav-pipeline"
                  >
                    Pipeline Prospect / Lead / Opportunity (P0C)
                  </Link>
                  <Link
                    className="scaffold-button"
                    href="/workspace/customers"
                    data-testid="nav-customers"
                  >
                    Customer 360 Synthetic (P0D)
                  </Link>
                </div>
              </div>
            </div>
          ) : null}

          <div data-testid="nav-group-admin">
            <h3>5. Quản trị &amp; Cấu hình</h3>
            <div className="scaffold-actions">
              {isConfigAdmin ? (
                <Link
                  className="scaffold-button"
                  href="/workspace/kpi-targets"
                  data-testid="nav-kpi-targets"
                >
                  Quản trị Từ điển 7 Nhóm KPI &amp; Lịch làm việc (P0A)
                </Link>
              ) : null}
              <a className="scaffold-button" href="#org-management">
                Quản trị Tổ chức &amp; Phân quyền (S1-B/S1-C)
              </a>
              {canViewAudit ? (
                <a
                  className="scaffold-button"
                  href="#audit-events"
                  data-testid="nav-audit-events"
                >
                  Nhật ký Kiểm toán (Audit Events)
                </a>
              ) : null}
            </div>
          </div>
        </nav>

        <form action="/auth/logout" method="POST" className="logout-form">
          <input type="hidden" name="csrf_token" value={csrfToken} />
          <button type="submit" className="scaffold-button">
            Đăng xuất khỏi ứng dụng
          </button>
        </form>
      </section>

      {canViewAudit ? <AuditViewerPanel /> : null}
    </main>
  );
}
