# Architecture baseline — đề xuất, chưa quyết định stack production

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

## ADR cần quyết định
ADR-001: stack/modular monolith; ADR-002: RBAC/data scope; ADR-003: KPI facts/reconciliation; ADR-004: event/notification channels; ADR-005: customer reference/data restrictions. Tất cả hiện `PROPOSED`.
