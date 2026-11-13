export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<{ logged_out?: string }>;
}) {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const loggedOut = resolvedParams?.logged_out === "1";

  return (
    <main className="scaffold-container" aria-labelledby="scaffold-heading">
      <header className="scaffold-header">
        <p className="scaffold-badge">
          Sprint 1 (S1-A) — Synthetic Identity &amp; Session Foundation
        </p>
        <h1 id="scaffold-heading">
          Branch Sales OS — Báo cáo và quản trị bán hàng chi nhánh
        </h1>
      </header>

      {loggedOut ? (
        <section
          className="scaffold-notice"
          role="status"
          aria-labelledby="logout-notice-heading"
        >
          <h2 id="logout-notice-heading">Phiên ứng dụng đã đóng</h2>
          <p>
            Bạn đã đăng xuất khỏi phiên làm việc của ứng dụng Branch Sales OS.
            Lưu ý: thao tác này chỉ đóng phiên trên ứng dụng (chưa hủy phiên SSO
            toàn cục tại IdP); lần đăng nhập tiếp theo vẫn bắt buộc đi qua luồng
            OIDC và kiểm tra lại liên kết nhân sự cùng phân quyền đang có hiệu
            lực.
          </p>
        </section>
      ) : null}

      <section className="scaffold-status" aria-labelledby="status-heading">
        <h2 id="status-heading">Trạng thái hệ thống hiện tại</h2>
        <p>
          Ứng dụng đang ở chặng{" "}
          <strong>Sprint 1 — Slice S1-A (DEVTEST Synthetic)</strong>: đã kích
          hoạt xác thực OIDC qua Keycloak test, phiên làm việc server-side, kiểm
          tra phân quyền mặc định từ chối (<code>default-deny</code>) và nền dữ
          liệu 7 bảng synthetic. Chưa triển khai chức năng nghiệp vụ KPI,
          Actual, Target, Dashboard, Lead/Customer hay API quản trị danh mục
          (thuộc các task tiếp theo).
        </p>
        <ul className="scaffold-details">
          <li>
            Môi trường dữ liệu: Chỉ dùng dữ liệu synthetic trên PostgreSQL 18.7
            &amp; Keycloak 26.8.2 local/CI.
          </li>
          <li>
            Kiểm soát truy cập: Đánh giá tại backend theo đúng một vai trò hiệu
            lực (<code>ADR-002 v0.3</code>) và ghi nhận <code>AuditEvent</code>.
          </li>
          <li>
            Phạm vi S1-A: Đăng nhập OIDC (Authorization Code + PKCE S256), xem
            ngữ cảnh cá nhân tại <code>/workspace</code> và <code>/api/me</code>
            , đăng xuất an toàn qua <code>POST /auth/logout</code>.
          </li>
        </ul>

        <div className="scaffold-actions">
          <a className="scaffold-button" href="/auth/login">
            Đăng nhập qua OIDC (Synthetic DEVTEST)
          </a>
          <a className="scaffold-link" href="/workspace">
            Truy cập không gian làm việc (/workspace)
          </a>
        </div>
      </section>
    </main>
  );
}
