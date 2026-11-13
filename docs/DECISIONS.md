# Decision register

| ID | Quyết định cần chốt | Đề xuất hiện tại | Gate |
|---|---|---|---|
| D-01 | Công thức/nguồn KPI | OPEN — Không hardcode khi thiếu | Trước KPI implementation |
| D-02 | Ghi nhận bán chéo nhiều nhân sự | OPEN — Attribution theo từng metric | Trước Actual reconciliation |
| D-03 | Lịch ngày làm việc, kỳ tuần | OPEN — Calendar cấu hình | Trước reminder/report |
| D-04 | SLA cảnh báo và escalation | OPEN — Ngưỡng đề xuất, chưa phê duyệt | Trước alert production |
| D-05 | Dữ liệu KH và hosting | OPEN — Synthetic only | Trước real-data pilot |
| D-06 | Stack scaffold Sprint 0 và ranh giới SSO | ACCEPTED cho Sprint 0 — [ADR-001](adr/ADR-001-stack.md) v1.0; SSO/auth hoãn sang D-08 | Scaffold được mở khóa bởi [TASK-0001](../tasks/TASK-0001.md) ACCEPTED; chưa duyệt stack production |
| D-07 | Điểm tổng hợp KPI chi nhánh | OPEN — Không tự tạo trung bình | Trước executive composite |
| D-08 | SSO/auth doanh nghiệp: IdP, giao thức, session/token/logout | OPEN (DEFERRED khỏi Sprint 0) — 2 phương án A/B tại [Sprint 1 draft](specs/SPRINT-1.md), chưa chọn IdP/giao thức | Phải duyệt cùng [ADR-002](adr/ADR-002-authorization.md) trước bất kỳ code auth/Sprint 1 (`S1-A`) nào; không chặn scaffold không auth |
| D-09 | Database engine/ORM và môi trường dev/test cho Sprint 1 | OPEN — 2 phương án A (PostgreSQL local/CI synthetic) và B (PostgreSQL test do tổ chức cấp) tại [Sprint 1 draft](specs/SPRINT-1.md), chưa duyệt | Phải duyệt cùng [ADR-002](adr/ADR-002-authorization.md) trước bất kỳ code persistence/schema/migration (`S1-B`) nào; không thay D-05 cho hosting/dữ liệu thật |

## Chuẩn bị Sprint 1 — 2026-11-13 (DOCUMENTATION_ONLY)

Chủ dự án đã chọn trực tiếp: “Chuẩn bị đặc tả Sprint 1 và phương án cần duyệt; chưa code đăng nhập/database”.

- [TASK-0002](../tasks/TASK-0002.md) chỉ cho phép thực hiện trong chế độ `DOCUMENTATION_ONLY` trên nhánh `feat/TASK-0002-sprint-1-spec` ([Draft PR #4](https://github.com/vannhan091289-ux/baocaobanhang/pull/4)).
- [docs/specs/SPRINT-1.md](specs/SPRINT-1.md) (`DRAFT` v0.3) trình bày mục tiêu, ranh giới facts/proposals/unknowns, actors, thực thể dữ liệu tối thiểu, các luồng nghiệp vụ/từ chối, phân tích tối đa hai phương án cho `D-08` và `D-09` (kèm nguồn chuẩn chính thức đọc ngày `2026-11-13`), lộ trình chia nhỏ `S1-A`..`S1-C`, kế hoạch kiểm thử/bảo mật/rollback và câu hỏi trình duyệt.
- [docs/adr/ADR-002-authorization.md](adr/ADR-002-authorization.md) (`PROPOSED` v0.2) là nguồn chuẩn duy nhất cho mô hình phân quyền `role + action + resource + scope + effective_time`, nguyên tắc `default-deny`, tách biệt quyền `CONFIG_ADMIN` (không mặc nhiên xem dữ liệu KH, cấm tự nâng quyền), các kịch bản từ chối bắt buộc và quy tắc kiểm toán (`AuditEvent`).
- Việc hoàn thiện bộ tài liệu này **không** đóng `D-08` hay `D-09`, **không** chuyển `ADR-002` sang `ACCEPTED`, và **không** cấp quyền viết code xác thực, cơ sở dữ liệu hay triển khai Sprint 1.

## D-06 — quyết định ngày 2026-11-11, version 1.0

Người phê duyệt: chủ dự án qua yêu cầu trực tiếp trong chat điều phối, được ghi lại tại [ADR-001](adr/ADR-001-stack.md) và PR #2. Chấp nhận stack đã đề xuất cho Sprint 0; hoãn SSO/auth, chỉ tạo scaffold/tooling/CI/test baseline không DB, không dữ liệu thật. Lý do: chuẩn bị nền phát triển mà không tự quyết định cơ chế xác thực doanh nghiệp. Version/toolchain/cấu trúc và giới hạn nằm tại ADR-001 làm nguồn chuẩn. [TASK-0001](../tasks/TASK-0001.md) đã được nghiệm thu `ACCEPTED` và hợp nhất tại [PR #3](https://github.com/vannhan091289-ux/baocaobanhang/pull/3).

D-08 là nghĩa vụ còn mở được tách từ D-06, không phải phê duyệt hoặc miễn kiểm soát SSO. D-01..D-05, D-07, D-09 và các ADR khác không được tự đóng bởi quyết định này.

Quyết định trọng yếu phải có người phê duyệt, ngày, version, lý do. ADR kiến trúc được tạo/duyệt riêng; tài liệu này không thay thế thẩm quyền.
