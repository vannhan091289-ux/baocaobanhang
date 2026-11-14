import { cookies } from "next/headers";
import Link from "next/link";
import { SESSION_COOKIE_NAME, verifyRequestSession } from "@/server/session";
import { DashboardPanel } from "./dashboard-panel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const rawSessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const sessionCheck = await verifyRequestSession({ rawSessionToken });

  if (!sessionCheck.authenticated) {
    const isUnauthenticated = sessionCheck.httpStatus === 401;
    return (
      <main
        className="scaffold-container"
        aria-labelledby="dashboard-denied-heading"
      >
        <header className="scaffold-header">
          <p className="scaffold-badge">
            {isUnauthenticated
              ? "Yêu cầu xác thực (401)"
              : "Từ chối truy cập (403)"}
          </p>
          <h1 id="dashboard-denied-heading">
            {isUnauthenticated
              ? "Phiên làm việc chưa xác thực hoặc đã hết hạn"
              : "Tài khoản không có quyền truy cập Dashboard điều hành"}
          </h1>
        </header>
        <section
          className="scaffold-status"
          aria-labelledby="dashboard-denied-detail-heading"
        >
          <h2 id="dashboard-denied-detail-heading">
            Thông tin kiểm soát truy cập
          </h2>
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

  return (
    <main className="scaffold-container" aria-labelledby="dashboard-heading">
      <header className="scaffold-header">
        <p className="scaffold-badge">
          {selfContext.effective_role.role_code} • {selfContext.department.code}{" "}
          • {selfContext.staff_code}
        </p>
        <h1 id="dashboard-heading">
          Dashboard điều hành đa lớp &amp; Đối soát Actual (P0B-2)
        </h1>
        <p className="scaffold-subtitle">
          7 nhóm KPI tách biệt (D-07), xử lý khuyết dữ liệu MISSING_DATA
          (AC-01), không cộng dồn STOCK (AC-02), đối soát
          PROVISIONAL/RECONCILED/FINAL (AC-03).
        </p>
        <nav className="scaffold-actions" aria-label="Điều hướng phân hệ">
          <Link className="scaffold-link" href="/workspace">
            Về không gian làm việc
          </Link>
          <Link className="scaffold-link" href="/workspace/planning">
            Kế hoạch &amp; Hoạt động
          </Link>
          <Link className="scaffold-link" href="/workspace/kpi-targets">
            Chỉ tiêu KPI
          </Link>
        </nav>
      </header>

      <DashboardPanel
        actorRoleCode={selfContext.effective_role.role_code}
        actorDepartmentId={selfContext.department.id}
        actorStaffId={selfContext.staff_id}
        csrfToken={csrfToken}
      />
    </main>
  );
}
