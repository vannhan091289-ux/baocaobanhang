import { cookies } from "next/headers";
import Link from "next/link";
import { SESSION_COOKIE_NAME, verifyRequestSession } from "@/server/session";
import { PlanningPanel } from "./planning-panel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PlanningPage() {
  const cookieStore = await cookies();
  const rawSessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const sessionCheck = await verifyRequestSession({ rawSessionToken });

  if (!sessionCheck.authenticated) {
    const isUnauthenticated = sessionCheck.httpStatus === 401;
    return (
      <main
        className="scaffold-container"
        aria-labelledby="planning-denied-heading"
      >
        <header className="scaffold-header">
          <p className="scaffold-badge">
            {isUnauthenticated
              ? "Yêu cầu xác thực (401)"
              : "Từ chối truy cập (403)"}
          </p>
          <h1 id="planning-denied-heading">
            {isUnauthenticated
              ? "Phiên làm việc chưa xác thực hoặc đã hết hạn"
              : "Tài khoản không có quyền truy cập phân hệ Kế hoạch & Hoạt động"}
          </h1>
        </header>
        <section
          className="scaffold-status"
          aria-labelledby="planning-denied-detail-heading"
        >
          <h2 id="planning-denied-detail-heading">
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
    <main className="scaffold-container" aria-labelledby="planning-heading">
      <header className="scaffold-header">
        <p className="scaffold-badge">
          Phân hệ P0B-1 — Kế hoạch Tuần/Ngày, Nhật ký Hoạt động một nguồn &amp;
          Review sáng Thứ Hai (Synthetic)
        </p>
        <h1 id="planning-heading">
          Kế hoạch Bán hàng, Nhật ký Hoạt động Một Nguồn &amp; Review Thứ Hai
        </h1>
        <nav
          aria-label="Điều hướng không gian làm việc"
          className="scaffold-actions"
        >
          <Link
            className="scaffold-link"
            href="/workspace"
            data-testid="nav-back-workspace"
          >
            ← Quay về Không gian làm việc
          </Link>
          <Link
            className="scaffold-link"
            href="/workspace/kpi-targets"
            data-testid="nav-kpi-targets"
          >
            Từ điển 7 Nhóm KPI &amp; Chỉ tiêu (P0A)
          </Link>
        </nav>
      </header>

      <PlanningPanel
        csrfToken={csrfToken}
        actorStaffId={selfContext.staff_id}
        actorDepartmentId={selfContext.department.id}
        actorRoleCode={selfContext.effective_role.role_code}
      />
    </main>
  );
}
