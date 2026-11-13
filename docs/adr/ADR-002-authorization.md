# ADR-002 — Authorization và data scope đề xuất cho Sprint 1

Status: PROPOSED — chưa phê duyệt implementation
Version: 0.2
Prepared: 2026-11-13 (Asia/Ho_Chi_Minh)
Approved by: — (chờ Chủ dự án phê duyệt)
Applies to: Đặc tả Sprint 1 ([docs/specs/SPRINT-1.md](../specs/SPRINT-1.md)); không thay thế [ADR-001](ADR-001-stack.md) đã duyệt cho Sprint 0

## 1. Bối cảnh, nguồn chuẩn và giới hạn phạm vi

- Đề xuất này cụ thể hóa nguyên tắc kiểm soát truy cập trong [Product](../PRODUCT.md), [Security](../SECURITY.md), [Architecture](../ARCHITECTURE.md) và [Decisions](../DECISIONS.md).
- Trong khuôn khổ [TASK-0002](../../tasks/TASK-0002.md) (`DOCUMENTATION_ONLY`), tài liệu này là nguồn chuẩn duy nhất cho mô hình phân quyền, phạm vi dữ liệu (`data scope`) và ma trận quyết định quyền đề xuất của Sprint 1.
- Các quyết định `D-08` (IdP/SSO/session) và `D-09` (Database/ORM dev/test) hiện vẫn `OPEN`. Tài liệu này ở trạng thái `PROPOSED`, **không** cấp quyền viết code xác thực/RBAC/database và **không** cấp quyền truy cập dữ liệu khách hàng thật (`D-05`).

## 2. Nguyên tắc và Contract phân quyền đề xuất (PROPOSED)

1. **Thực thi bắt buộc tại Backend (`Backend-first Enforcement`):**
   - Mọi quyết định cho phép hay từ chối (`ALLOW` / `DENY`) phải được đánh giá tại backend dựa trên định danh phiên đã xác thực từ server, liên kết nhân sự (`IdentityLink` → `Staff`) và bản ghi phân quyền (`RoleAssignment`) đang có hiệu lực.
   - Bất kỳ thông tin `role`, `department_id`, `staff_id` hay cờ quyền nào do client gửi lên (qua query, body, header, cookie không ký) chỉ được xem là tham số yêu cầu cần kiểm chứng, tuyệt đối không phải nguồn tin cậy để cấp quyền.
   - Việc ẩn/khóa nút trên giao diện người dùng (UI) chỉ phục vụ trải nghiệm, không thay thế kiểm tra quyền tại backend.
2. **Mô hình quyết định 5 thành phần & Mặc định từ chối (`Default-Deny`):**
   - Mỗi yêu cầu truy cập được đánh giá theo bộ 5 yếu tố: `Subject (Staff + Role)` + `Action` + `Resource` + `Data Scope` + `Effective Time`.
   - Nếu thiếu bất kỳ yếu tố nào (chưa xác thực, chưa map `Staff`, `Staff` ở trạng thái `INACTIVE`, không có `RoleAssignment` khớp hoặc đã hết hạn hiệu lực `effective_to`), kết quả bắt buộc là `DENY`.
3. **Phạm vi dữ liệu đơn chi nhánh (`Single-Branch Data Scope`):**
   - Theo [Product baseline](../PRODUCT.md), hệ thống phục vụ một chi nhánh với 3 phòng nghiệp vụ (Cá nhân, Doanh nghiệp, Dịch vụ KH); không tự thiết kế kiến trúc đa chi nhánh (`multi-branch`/`multi-tenant`).
   - Ba mức phạm vi dữ liệu (`Data Scope`) trong Sprint 1:
     - `BRANCH`: toàn bộ phòng ban và nhân sự thuộc chi nhánh (dành cho hành động được duyệt của Ban Giám đốc hoặc đọc cấu hình của Admin cấu hình).
     - `DEPARTMENT`: chỉ phòng ban mà quản lý được phân công (`scope_department_id`) và các nhân sự thuộc phòng ban đó.
     - `SELF`: chỉ hồ sơ/thông tin gắn với chính `staff_id` của người dùng đang đăng nhập (kèm danh mục phòng ban tối thiểu nếu được phép).
4. **Tách biệt quyền Admin cấu hình và chống tự nâng quyền (`No Self-Escalation & No Implicit Customer Access`):**
   - `CONFIG_ADMIN` chỉ có quyền quản trị cấu hình tổ chức/danh mục theo các hành động được phê duyệt và kiểm toán.
   - `CONFIG_ADMIN` **không** mặc nhiên có quyền xem dữ liệu khách hàng (`Customer` / `Lead` / `Opportunity` / `KPI`) và **cấm** tự gán, tự sửa hoặc tự phê duyệt quyền (`RoleAssignment`) cho chính mình.
5. **Điểm chính sách còn mở (`OPEN` — không tự suy diễn khi chưa duyệt):**
   - Quy tắc hợp nhất hay chọn vai trò khi một nhân sự có nhiều `RoleAssignment` đồng thời, cửa sổ thu hồi phiên (`revocation window`), thẩm quyền phê duyệt gán quyền và cơ chế khởi tạo `bootstrap admin` vẫn ở trạng thái `OPEN` chờ Chủ dự án chốt.

## 3. Ma trận phân quyền và phạm vi dữ liệu đề xuất (PROPOSED — cần Chủ dự án duyệt)

| Actor (Vai trò) | Đọc danh mục Phòng ban (`org.department.read`) | Đọc hồ sơ Nhân sự tối thiểu (`org.staff.read`) | Tạo / Cập nhật Phòng ban & Nhân sự (`org.department.write`, `org.staff.write`) | Xem phân quyền (`authz.role.read`) | Gán / Thu hồi phân quyền (`authz.role.assign`) | Truy cập dữ liệu Khách hàng / KPI / Lead (`customer.*`, `kpi.*`) |
|---|---|---|---|---|---|---|
| **Ban Giám đốc (`EXECUTIVE`)** | `ALLOW` — Scope: `BRANCH` | `ALLOW` — Scope: `BRANCH` (chỉ các trường quản trị được duyệt) | `DENY` (Sprint 1 chưa đề xuất Ban Giám đốc trực tiếp sửa danh mục) | `ALLOW` — Scope: `BRANCH` | `OPEN` — Chờ chốt thẩm quyền phê duyệt/gán role | **Ngoài phạm vi Sprint 1** (chưa mở API/grant; mặc định `DENY`) |
| **Quản lý phòng (`DEPARTMENT_MANAGER`)** | `ALLOW` — Scope: `BRANCH` (danh mục phòng cơ bản) | `ALLOW` — Scope: `DEPARTMENT` (chỉ nhân sự thuộc phòng được giao; `DENY` phòng khác) | `DENY` | `ALLOW` — Scope: `DEPARTMENT` (chỉ xem vai trò nhân sự trong phòng) | `DENY` | **Ngoài phạm vi Sprint 1** (mặc định `DENY`) |
| **Nhân viên (`STAFF` — KHCN/KHDN/DVKH)** | `ALLOW` — Scope: `BRANCH` (danh mục tên/mã phòng tối thiểu) | `ALLOW` — Scope: `SELF` (chỉ bản thân; `DENY` hồ sơ chi tiết nhân sự khác) | `DENY` | `ALLOW` — Scope: `SELF` | `DENY` | **Ngoài phạm vi Sprint 1** (mặc định `DENY`) |
| **Admin cấu hình (`CONFIG_ADMIN`)** | `ALLOW` — Scope: `BRANCH` | `ALLOW` — Scope: `BRANCH` (chỉ các trường cấu hình; không gồm dữ liệu nghiệp vụ/KH) | `ALLOW` (Đề xuất) — Scope: `BRANCH`, bắt buộc ghi `AuditEvent` | `ALLOW` — Scope: `BRANCH` | `OPEN` — Chờ chốt quy trình duyệt; **bắt buộc `DENY` tự gán/nâng quyền cho chính mình** | **`DENY` tuyệt đối** (Admin không mặc nhiên có quyền xem dữ liệu KH/nghiệp vụ) |
| **Chưa xác thực / Chưa map / Ngừng hoạt động (`ANONYMOUS` / `UNMAPPED` / `INACTIVE`)** | `DENY` | `DENY` | `DENY` | `DENY` | `DENY` | `DENY` |

> **Lưu ý:** Toàn bộ các ô trong bảng trên là đề xuất thiết kế (`PROPOSED`). Danh sách trường thông tin nhân sự tối thiểu được phép hiển thị ở từng vai trò cần được Chủ dự án xác nhận trước khi triển khai; trong môi trường dev/test chỉ sử dụng dữ liệu `synthetic`.

## 4. Các trường hợp từ chối bắt buộc kiểm thử (Mandatory Negative & Deny Cases)

Khi chuyển sang giai đoạn triển khai (sau khi ADR này được `ACCEPTED`), bộ kiểm thử tự động tại backend bắt buộc phải chứng minh hệ thống từ chối (`DENY`) các kịch bản sau:

1. **Thiếu hoặc sai định danh (`Identity & Session Denial`):**
   - Gọi bất kỳ endpoint nội bộ nào khi không có phiên, phiên hết hạn (`expired`), phiên đã thu hồi (`revoked`) hoặc token không hợp lệ.
   - Tài khoản xác thực thành công tại IdP nhưng chưa có liên kết `IdentityLink` (`UNMAPPED`) hoặc liên kết đã bị thu hồi.
2. **Trạng thái nhân sự hoặc thời hạn quyền không hợp lệ (`Lifecycle & Temporal Denial`):**
   - Hồ sơ `Staff` ở trạng thái `INACTIVE` (dù phiên đăng nhập hoặc `RoleAssignment` chưa hết hạn).
   - Bản ghi `RoleAssignment` có `effective_from` ở tương lai hoặc `effective_to` đã qua tại thời điểm kiểm tra.
3. **Vượt phạm vi dữ liệu giữa các phòng (`Cross-Scope / Cross-Department Denial`):**
   - `DEPARTMENT_MANAGER` của Phòng Cá nhân truy vấn danh sách, tìm kiếm hoặc xem chi tiết nhân sự thuộc Phòng Doanh nghiệp hoặc Phòng Dịch vụ KH.
   - `STAFF` truy vấn hồ sơ chi tiết của một `staff_id` khác trong cùng phòng hoặc khác phòng.
4. **Giả mạo tham số từ Client & Truy cập trực tiếp (`Parameter Tampering & Forced Browsing`):**
   - `STAFF` hoặc `DEPARTMENT_MANAGER` gọi trực tiếp API `org.department.write`, `org.staff.write` hoặc `authz.role.assign` (bỏ qua UI).
   - Client gửi kèm `role=EXECUTIVE`, `scope=BRANCH` hoặc `department_id` của phòng khác trong payload/query nhằm ghi đè ngữ cảnh quyền của phiên.
5. **Tự nâng quyền và Lạm quyền Admin (`Self-Escalation & Admin Boundary Denial`):**
   - `CONFIG_ADMIN` gọi API gán hoặc phê duyệt `RoleAssignment` mà `staff_id` đích trùng với `staff_id` của chính mình.
   - `CONFIG_ADMIN` truy cập bất kỳ tài nguyên dữ liệu khách hàng/nghiệp vụ nào ngoài phạm vi cấu hình tổ chức.

## 5. Quy tắc Kiểm toán (Audit) và Bảo vệ thông tin trên Phản hồi lỗi

- **Bản ghi `AuditEvent` tối thiểu:**
  - Mọi thao tác thay đổi dữ liệu cấu hình (`org.department.write`, `org.staff.write`), thay đổi phân quyền (`authz.role.assign`), sự kiện đăng nhập/đăng xuất và các quyết định từ chối truy cập trái phép phải ghi nhận: `event_id`, `occurred_at` (UTC), `actor_staff_id` (hoặc tham chiếu định danh an toàn nếu `UNMAPPED`), `action`, `resource_type`, `resource_id`, `scope_context`, `decision` (`ALLOW`/`DENY`), `reason_code`, và `policy_version`.
- **Dữ liệu cấm ghi vào Log / Audit (`Redaction Contract`):**
  - Không bao giờ ghi mật khẩu, session token, `id_token`, `access_token`, `refresh_token`, khóa bí mật hoặc nguyên văn payload claims chưa lọc vào bảng audit, console log hay CI artifacts.
- **Ngữ nghĩa lỗi chống rò rỉ dữ liệu (`Error Semantics`):**
  - Không trả về thông báo lỗi chứa chi tiết dữ liệu của bản ghi ngoài phạm vi (ví dụ tên nhân sự hoặc phòng ban mà người gọi không có quyền xem).
  - Việc chọn trả về mã HTTP `403 Forbidden` thống nhất hay `404 Not Found` cho các bản ghi ngoài `scope` sẽ được khóa theo quyết định của Chủ dự án ở mục 6.

## 6. Các quyết định cần Chủ dự án phê duyệt và Gate trước khi viết code

### 6.1 Các điểm cần Chủ dự án chốt để chuyển `ADR-002` từ `PROPOSED` sang `ACCEPTED`

1. **Xác nhận ma trận quyền & trường dữ liệu:** Ma trận ở Mục 3 và danh mục trường thông tin `Staff`/`Department` tối thiểu đã phù hợp với quy định của chi nhánh chưa?
2. **Thẩm quyền gán/duyệt quyền & Bootstrap Admin:** Vai trò nào được quyền tạo/duyệt `RoleAssignment`, có cần cơ chế tạo-duyệt tách biệt (maker-checker) không, và quản trị viên đầu tiên (`bootstrap admin`) được khởi tạo như thế nào?
3. **Quy tắc đa vai trò & chuyển phòng:** Một nhân sự có thể giữ nhiều vai trò cùng lúc không (nếu có thì chọn ngữ cảnh vai trò khi làm việc hay gộp quyền), và khi nhân sự đổi phòng ban thì quyền cũ hết hiệu lực ngay lập tức hay theo mốc thời gian cấu hình?
4. **Cửa sổ thu hồi phiên & HTTP Error Contract:** Thời gian tối đa từ lúc thu hồi quyền/ngừng kích hoạt nhân sự đến lúc phiên đang mở bị chặn là bao lâu? Khi truy cập bản ghi ngoài `scope`, hệ thống trả về `403` hay `404`?

### 6.2 Điều kiện mở khóa triển khai (Gates before Implementation)

- Không viết code xác thực, phân quyền hay cơ sở dữ liệu khi:
  1. `ADR-002` chưa được Chủ dự án duyệt chuyển sang `ACCEPTED` (kèm tên người duyệt, ngày duyệt, phiên bản).
  2. Quyết định `D-08` (cho phần auth/session) và `D-09` (cho phần persistence/schema) chưa được chốt trong [docs/DECISIONS.md](../DECISIONS.md).
  3. Chưa có task triển khai riêng (`TASK-0003` hoặc tương đương) được duyệt sang trạng thái `READY`.
- Như đã ghi nhận tại [docs/specs/SPRINT-1.md](../specs/SPRINT-1.md), nếu tương lai sử dụng PostgreSQL Row-Level Security (RLS) thì RLS chỉ là lớp bảo vệ bổ sung vì `SUPERUSER`, `BYPASSRLS` và mặc định `table owner` có thể bỏ qua RLS ([PostgreSQL Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), đọc ngày `2026-11-13`); không bao giờ dùng RLS để thay thế kiểm tra quyền tại backend.

## 7. Rủi ro và Kế hoạch hoàn tác (Risks & Rollback)

- **Rủi ro chính nếu thiết kế không chặt:** tự nâng quyền (`self-escalation`), quyền cũ vẫn hoạt động sau khi nhân sự chuyển phòng hoặc nghỉ việc, rò rỉ danh sách nhân sự phòng khác qua API tìm kiếm/lọc, hoặc ghi lộ token vào audit log.
- **Hoàn tác ở giai đoạn đặc tả hiện tại:** Mọi nội dung trong tệp này là đề xuất tài liệu (`PROPOSED`); nếu cần điều chỉnh hoặc hủy bỏ, thực hiện qua commit/revert trên nhánh tài liệu mà không ảnh hưởng tới mã nguồn hay cơ sở dữ liệu.
