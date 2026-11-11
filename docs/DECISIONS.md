# Decision register

| ID | Quyết định cần chốt | Đề xuất hiện tại | Gate |
|---|---|---|---|
| D-01 | Công thức/nguồn KPI | Không hardcode khi thiếu | Trước KPI implementation |
| D-02 | Ghi nhận bán chéo nhiều nhân sự | Attribution theo từng metric | Trước Actual reconciliation |
| D-03 | Lịch ngày làm việc, kỳ tuần | Calendar cấu hình | Trước reminder/report |
| D-04 | SLA cảnh báo và escalation | Ngưỡng đề xuất, chưa phê duyệt | Trước alert production |
| D-05 | Dữ liệu KH và hosting | Synthetic only | Trước real-data pilot |
| D-06 | Stack scaffold Sprint 0 và ranh giới SSO | ACCEPTED cho Sprint 0 — ADR-001 v1.0; SSO/auth hoãn sang D-08 | Scaffold được mở khóa bởi TASK-0001 READY; chưa duyệt stack production |
| D-07 | Điểm tổng hợp KPI chi nhánh | Không tự tạo trung bình | Trước executive composite |
| D-08 | SSO/auth doanh nghiệp: IdP, giao thức, session/token/logout | DEFERRED khỏi Sprint 0, chưa chọn giải pháp | Phải duyệt trước auth/Sprint 1; không chặn scaffold không auth |

## D-06 — quyết định ngày 2026-11-11, version 1.0

Người phê duyệt: chủ dự án qua yêu cầu trực tiếp trong chat điều phối, được ghi lại tại [ADR-001](adr/ADR-001-stack.md) và PR #2. Chấp nhận stack đã đề xuất cho Sprint 0; hoãn SSO/auth, chỉ tạo scaffold/tooling/CI/test baseline không DB, không dữ liệu thật. Lý do: chuẩn bị nền phát triển mà không tự quyết định cơ chế xác thực doanh nghiệp. Version/toolchain/cấu trúc và giới hạn nằm tại ADR-001 làm nguồn chuẩn. TASK-0001 được duyệt READY; lượt hiện tại chỉ hoàn thiện và merge tài liệu, chưa triển khai code.

D-08 là nghĩa vụ còn mở được tách từ D-06, không phải phê duyệt hoặc miễn kiểm soát SSO. D-01..D-05, D-07 và các ADR khác không được tự đóng bởi quyết định này.

Quyết định trọng yếu phải có người phê duyệt, ngày, version, lý do. ADR kiến trúc được tạo/duyệt riêng; tài liệu này không thay thế thẩm quyền.
