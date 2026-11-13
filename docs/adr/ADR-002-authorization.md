# ADR-002 — Authorization và data scope đề xuất cho Sprint 1

Status: PROPOSED — chưa phê duyệt implementation
Version: 0.1
Prepared: 2026-11-13
Approved by: —
Applies to: đặc tả Sprint 1; không thay ADR-001 đã duyệt cho Sprint 0

## Nguồn và phạm vi

Đề xuất dựa trên [Product](../PRODUCT.md), [Security](../SECURITY.md), [Architecture](../ARCHITECTURE.md). [TASK-0002](../../tasks/TASK-0002.md) chỉ cho phép chuẩn bị tài liệu. D-08/D-09 vẫn chưa chọn giải pháp runtime; đề xuất này không cho phép code auth/RBAC/database hoặc nhận quyền dùng dữ liệu thật.

## Contract đề xuất

- Quyết định quyền ở backend từ danh tính đã xác thực, mapping nhân sự và role assignment đang có hiệu lực. Dữ liệu role/scope từ client không phải nguồn tin cậy.
- Một quyết định gồm subject + action + resource + scope + effective time; mặc định DENY khi thiếu identity, mapping, policy hoặc scope. Quyền hiển thị UI chỉ phản ánh backend, không thay backend.
- Single branch theo Product; phạm vi phòng/nhân viên là rõ ràng, không tự tạo thiết kế multi-tenant. Stable IDs; record thay đổi quyền/phòng và thời gian hiệu lực khi contract được duyệt.
- Admin cấu hình không mặc nhiên xem thông tin KH hoặc tự cấp vai trò quản lý cho bản thân. Người gán/duyệt role và kiểm soát bootstrap đầu tiên cần chủ dự án chốt.
- Đối với nhiều vai trò, role hết hạn, chuyển phòng và thu hồi phiên: quy tắc gộp/ưu tiên và revocation window vẫn OPEN; không tự chọn union quyền cho tiện triển khai.

## Ma trận sơ bộ — tất cả các ô là đề xuất cần duyệt

| Actor | Đọc thông tin tổ chức/nhân sự tối thiểu | Sửa cấu hình tổ chức/nhân sự | Gán/duyệt role | Dữ liệu KH |
|---|---|---|---|---|
| Ban Giám đốc | Trong chi nhánh theo scope được duyệt | Chưa đề xuất cấp quyền sửa trong Sprint 1 | Chờ chốt thẩm quyền | Ngoài Sprint 1, chưa tạo API/quyền |
| Quản lý phòng | Phòng được phân công, nhân sự thuộc phạm vi | DENY, trừ quyền được duyệt riêng | DENY | Ngoài Sprint 1 |
| Nhân viên | Bản thân và danh mục tối thiểu được duyệt | DENY | DENY | Ngoài Sprint 1 |
| Admin cấu hình | Dữ liệu cấu hình tối thiểu cần cho công việc | Đề xuất cho phép theo action được duyệt; phải audit | Chờ chốt, cấm tự nâng quyền | Không tự được cấp quyền KH |
| Anonymous / unknown / inactive | DENY | DENY | DENY | DENY |

Ma trận chưa phải quy định nhân sự chính thức; quyền xem thuộc tính cá nhân từng field và giới hạn danh mục tối thiểu vẫn phải được chủ dự án phê duyệt. Không tự đưa PII thật vào ví dụ.

## Quy tắc kiểm thử và audit cần đặc tả

Mọi action được cấp phải có ít nhất một allow case và deny cases cho sai subject/action/scope, request trực tiếp bỏ qua UI và assignment hết hiệu lực. List/search/detail/write phải được kiểm tra thống nhất, bao gồm lọc dữ liệu và field nếu có. Không triển khai Customer API chỉ để test cột dữ liệu KH; kiểm chứng ở mức contract rằng không có grant hoặc endpoint trong scope Sprint 1.

Audit tối thiểu đề xuất: identity reference an toàn, action, resource reference, decision/result, thời điểm và policy version. Không log password/token/full claims hay PII không cần thiết. Phương án lỗi trả về phải tránh lộ sự tồn tại của dữ liệu ngoài scope; HTTP contract cụ thể được chốt cùng thiết kế auth/API.

## Phê duyệt còn thiếu và gate

Chủ dự án cần chốt ma trận/field scope, người gán và người duyệt quyền, bootstrap admin, multi-role rule, role effective time/revocation và cách xử lý đổi phòng. Antigravity liệt kê câu hỏi thành nhóm quyết định, không tự điền tên người duyệt hoặc ngày phê duyệt.

Trước code cần ADR này ACCEPTED với owner/ngày/version/lý do, D-08/D-09 tương ứng được duyệt và task implementation READY riêng. Trước dữ liệu thật còn D-05 và các gate bảo mật/hosting khác; RLS nếu chọn chỉ là bổ sung, không thay backend authorization.

## Rủi ro và hoàn tác

Rủi ro thiết kế chính: tự nâng quyền, role cũ còn hiệu lực, phạm vi phòng không đồng nhất và rò rỉ qua list/search/logs. Chỉ lưu đề xuất trong tài liệu; sửa/revert tài liệu qua PR có thẩm quyền. Database migration/rollback và vận hành chỉ được thiết kế sau lựa chọn D-09, chưa thực hiện trong task này.
