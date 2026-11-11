export default function HomePage() {
  return (
    <main className="scaffold-container" aria-labelledby="scaffold-heading">
      <header className="scaffold-header">
        <p className="scaffold-badge">Sprint 0 — Technical Foundation</p>
        <h1 id="scaffold-heading">
          Branch Sales OS — Báo cáo và quản trị bán hàng chi nhánh
        </h1>
      </header>
      <section className="scaffold-status" aria-labelledby="status-heading">
        <h2 id="status-heading">Trạng thái hệ thống hiện tại</h2>
        <p>
          Ứng dụng đang ở giai đoạn khởi tạo kỹ thuật (Sprint 0). Chưa triển
          khai chức năng nghiệp vụ, cơ sở dữ liệu, chỉ tiêu KPI, phân quyền RBAC
          hay xác thực SSO.
        </p>
        <ul className="scaffold-details">
          <li>Môi trường dữ liệu: Chỉ dùng trạng thái tĩnh / synthetic.</li>
          <li>
            Kết nối ngoài: Không kết nối cơ sở dữ liệu, SSO hoặc dịch vụ ngoài.
          </li>
          <li>
            Phạm vi: Kiểm chứng build, typecheck, lint, unit test, E2E và CI
            gates.
          </li>
        </ul>
      </section>
    </main>
  );
}
