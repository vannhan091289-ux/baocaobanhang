# Architecture baseline — stack Sprint 0 đã duyệt, production còn mở

[ADR-001](adr/ADR-001-stack.md) được `ACCEPTED` ngày 2026-11-11 cho scaffold/toolchain [TASK-0001](../tasks/TASK-0001.md); Next.js App Router + React + TypeScript strict, npm và test/security tooling theo version baseline trong ADR. SSO/auth hoãn khỏi Sprint 0 theo `D-08`; không database hoặc chức năng nghiệp vụ trong nền tảng Sprint 0.

Ưu tiên modular monolith và PostgreSQL/TypeScript nếu phù hợp với stack được phê duyệt. Không xây microservices, message broker hoặc engine AI khi chưa cần.

## Domain boundaries
Organization & Authorization; KPI definitions/Targets/Actuals; WeeklyPlans/Activities; Prospects/Leads/Opportunities; Customer references/Interactions/Milestones; Alert/Notification; Dashboard read models; Audit & Approvals.

## Nguyên tắc
- Stable IDs, effective-dated role/owner, dấu nguồn `source`, `as_of`, timestamp, version khi cần.
- Một nguồn dữ liệu có quyền ghi; snapshot tổng hợp chỉ đọc/đối soát.
- Phân quyền ở backend từng hành động, hàng và trường; admin không mặc nhiên xem thông tin KH.
- API phiên bản hóa, kiểm tra input, pagination, error semantics, optimistic concurrency, idempotent import và alert generation.
- Thay đổi chỉ tiêu, sửa Actual, chuyển Lead, đóng cảnh báo phải audit và có khả năng truy vết.
- Không ấn định đường dẫn code trước khi scaffold/stack được chốt; mỗi TASK sau đó phải xác định file thật và tác động schema/API.

## Trạng thái ADR và đặc tả hiện hành
- [ADR-001](adr/ADR-001-stack.md): stack/cấu trúc Sprint 0 — `ACCEPTED` (chỉ phạm vi Sprint 0; không duyệt kiến trúc production).
- [ADR-002](adr/ADR-002-authorization.md): mô hình phân quyền RBAC, `data scope` (`BRANCH` / `DEPARTMENT` / `SELF`), `default-deny` và kiểm toán cho Sprint 1 — `PROPOSED` (chờ Chủ dự án phê duyệt; chưa cấp quyền viết code).
- `ADR-003` (KPI facts/reconciliation), `ADR-004` (event/notification channels), `ADR-005` (customer reference/data restrictions): vẫn `PROPOSED` / chưa khởi tạo chi tiết.
- [docs/specs/SPRINT-1.md](specs/SPRINT-1.md): đặc tả dự thảo Sprint 1 (`DRAFT`) và phân tích phương án cho các quyết định mở `D-08` (IdP/SSO/session) và `D-09` (Database/ORM dev/test) trong [docs/DECISIONS.md](DECISIONS.md), được thực hiện theo [TASK-0002](../tasks/TASK-0002.md) (`DOCUMENTATION_ONLY`). Cả `D-08`, `D-09` và `ADR-002` đều là gate bắt buộc phải được duyệt trước các task triển khai mã nguồn tương ứng.
