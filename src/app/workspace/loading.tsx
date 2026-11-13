export default function WorkspaceLoading() {
  return (
    <main
      className="scaffold-container"
      aria-busy="true"
      aria-labelledby="workspace-loading-heading"
    >
      <header className="scaffold-header">
        <p className="scaffold-badge">Đang kiểm tra phiên làm việc...</p>
        <h1 id="workspace-loading-heading">
          Đang tải ngữ cảnh nhân sự và phân quyền
        </h1>
      </header>
      <section className="scaffold-status">
        <p>
          Hệ thống đang đối chiếu trạng thái phiên làm việc, liên kết định danh
          và quyền hiệu lực tại máy chủ...
        </p>
      </section>
    </main>
  );
}
