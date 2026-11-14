export default function KpiTargetsLoading() {
  return (
    <main
      className="scaffold-container"
      aria-busy="true"
      aria-labelledby="kpi-targets-loading-heading"
    >
      <header className="scaffold-header">
        <p className="scaffold-badge">Đang tải dữ liệu P0A...</p>
        <h1 id="kpi-targets-loading-heading">
          Đang tải Từ điển 7 nhóm KPI, Lịch làm việc &amp; Chỉ tiêu...
        </h1>
      </header>
    </main>
  );
}
