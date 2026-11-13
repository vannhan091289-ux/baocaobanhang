# ADR-002 — Authorization và data scope đề xuất cho Sprint 1

Status: PROPOSED — chưa phê duyệt implementation
Version: 0.3
Prepared: 2026-11-13 (Asia/Ho_Chi_Minh)
Approved by: — (chờ Chủ dự án phê duyệt)
Applies to: Đặc tả Sprint 1 ([docs/specs/SPRINT-1.md](../specs/SPRINT-1.md)); không thay thế [ADR-001](ADR-001-stack.md) đã duyệt cho Sprint 0

## 1. Bối cảnh, nguồn chuẩn và giới hạn phạm vi

- Đề xuất này cụ thể hóa nguyên tắc kiểm soát truy cập trong [Product](../PRODUCT.md), [Security](../SECURITY.md), [Architecture](../ARCHITECTURE.md) và [Decisions](../DECISIONS.md).
- Kế thừa [TASK-0002](../../tasks/TASK-0002.md) (`DOCUMENTATION_ONLY`), tài liệu này là nguồn chuẩn duy nhất cho mô hình phân quyền, phạm vi dữ liệu (`data scope`) và ma trận quyết định quyền đề xuất của Sprint 1.
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
5. **Các lựa chọn đang xin duyệt (chưa có hiệu lực):**
   - Chính xác một `RoleAssignment` hiệu lực trên mỗi Staff; không union/chọn tùy tiện. Nhiều assignment đồng thời phải DENY; cho phép lịch sử tuần tự. Interval UTC `[effective_from,effective_to)`, `effective_to=null` nghĩa chưa ấn định hết hạn.
   - Role/scope hợp lệ: EXECUTIVE và CONFIG_ADMIN → BRANCH; DEPARTMENT_MANAGER → DEPARTMENT có scope_department_id bằng phòng ACTIVE của Staff; STAFF → SELF. Mọi tổ hợp khác DENY.
   - Session/profile và revocation window nằm duy nhất ở [gói phê duyệt](../decisions/SPRINT-1-APPROVAL.md), mục 2; không cache ALLOW. Thu hồi/inactive/chuyển phòng được kiểm tra lại từ request kế tiếp sau commit. Session ràng buộc assignment ban đầu; role mới không tái dùng session cũ.

## 3. Ma trận phân quyền và phạm vi dữ liệu đề xuất (PROPOSED — cần Chủ dự án duyệt)

| Actor (Vai trò) | Đọc danh mục Phòng ban (`org.department.read`) | Đọc hồ sơ Nhân sự tối thiểu (`org.staff.read`) | Tạo / Cập nhật Phòng ban & Nhân sự (`org.department.write`, `org.staff.write`) | Xem phân quyền (`authz.role.read`) | Gán / Thu hồi phân quyền (`authz.role.assign`) | Truy cập dữ liệu Khách hàng / KPI / Lead (`customer.*`, `kpi.*`) |
|---|---|---|---|---|---|---|
| **Ban Giám đốc (`EXECUTIVE`)** | `ALLOW` — Scope: `BRANCH` | `ALLOW` — Scope: `BRANCH` (chỉ các trường quản trị được duyệt) | `DENY` (Sprint 1 chưa đề xuất Ban Giám đốc trực tiếp sửa danh mục) | `ALLOW` — Scope: `BRANCH` | `PROPOSED`: chỉ phê duyệt đề nghị của CONFIG_ADMIN cho người khác; cấm tự duyệt; chưa có endpoint trong TASK-0003 | **Ngoài phạm vi Sprint 1** (chưa mở API/grant; mặc định `DENY`) |
| **Quản lý phòng (`DEPARTMENT_MANAGER`)** | `ALLOW` — Scope: `BRANCH` (danh mục phòng cơ bản) | `ALLOW` — Scope: `DEPARTMENT` (chỉ nhân sự thuộc phòng được giao; `DENY` phòng khác) | `DENY` | `ALLOW` — Scope: `DEPARTMENT` (chỉ xem vai trò nhân sự trong phòng) | `DENY` | **Ngoài phạm vi Sprint 1** (mặc định `DENY`) |
| **Nhân viên (`STAFF` — KHCN/KHDN/DVKH)** | `ALLOW` — Scope: `BRANCH` (danh mục tên/mã phòng tối thiểu) | `ALLOW` — Scope: `SELF` (chỉ bản thân; `DENY` hồ sơ chi tiết nhân sự khác) | `DENY` | `ALLOW` — Scope: `SELF` | `DENY` | **Ngoài phạm vi Sprint 1** (mặc định `DENY`) |
| **Admin cấu hình (`CONFIG_ADMIN`)** | `ALLOW` — Scope: `BRANCH` | `ALLOW` — Scope: `BRANCH` (chỉ các trường cấu hình; không gồm dữ liệu nghiệp vụ/KH) | `ALLOW` (Đề xuất) — Scope: `BRANCH`, bắt buộc ghi `AuditEvent` | `ALLOW` — Scope: `BRANCH` | `PROPOSED`: đề nghị thay đổi cho người khác, cần EXECUTIVE duyệt; cấm tự đề nghị/duyệt; chưa có endpoint trong TASK-0003 | **`DENY` tuyệt đối** (Admin không mặc nhiên có quyền xem dữ liệu KH/nghiệp vụ) |
| **Chưa xác thực / Chưa map / Ngừng hoạt động (`ANONYMOUS` / `UNMAPPED` / `INACTIVE`)** | `DENY` | `DENY` | `DENY` | `DENY` | `DENY` | `DENY` |

> **Lưu ý:** Toàn bộ ma trận là đề xuất (`PROPOSED`). TASK-0003 chỉ thực thi self-context/workspace và policy tests; các quyền đọc/ghi danh mục hoặc workflow gán quyền không tự mở API ở S1-A. Chỉ dùng synthetic.

### 3.1 Field allowlist đề xuất

- Department read: ID, code, name, status; không metadata/secret IdP.
- Staff read trong scope: ID, staff_code, display_name, department_id, status và role_code hiệu lực; STAFF chỉ thấy chính mình. Không điện thoại, email thật, claims, credentials, token hoặc session identifiers.
- authz.role.read: role_code, scope_type, scope_department_id và effective_from/to trong scope được cấp. TASK-0003 chỉ trả role/scope của chính người gọi qua self-context; không trả grant history/approval reference.
- CONFIG_ADMIN chỉ nhận cùng các trường cấu hình trên; không customer/KPI data. Không audit search/read UI/API trong TASK-0003; runtime chỉ append audit. Thêm trường hoặc quyền đọc audit cần duyệt riêng.

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
  - Contract đề xuất: `401` khi chưa xác thực/phiên không hợp lệ; `403` khi session hợp lệ nhưng action bị cấm; lookup theo ID không tồn tại hoặc ngoài scope trả cùng `404`/error envelope, không để lộ tồn tại. Callback login bị từ chối chỉ trả mã lỗi an toàn, không cấp session. Failure semantics của audit nằm ở [gói phê duyệt](../decisions/SPRINT-1-APPROVAL.md), mục 3.

## 6. Các quyết định cần Chủ dự án phê duyệt và Gate trước khi viết code

### 6.1 Các lựa chọn cụ thể xin duyệt để chuyển `PROPOSED` sang `ACCEPTED` (Scope: DEVTEST)

1. Duyệt ma trận/field allowlist mục 3 và một role hiệu lực mục 2, chỉ synthetic; đây chưa phải xác nhận chính sách ngân hàng.
2. Maker-checker đề xuất: CONFIG_ADMIN đề nghị thay đổi quyền của người khác, EXECUTIVE phê duyệt; actor đề nghị, actor phê duyệt và Staff đích phải khác nhau. Không workflow/API gán quyền trong TASK-0003. Bootstrap DEVTEST bằng seed offline tạo hai identity synthetic riêng EXECUTIVE/CONFIG_ADMIN; không auto-admin user đầu tiên hoặc endpoint bootstrap.
3. Chuyển phòng kết thúc assignment cũ và revoke mọi app session; assignment mới chỉ hiệu lực sau duyệt, không carry-over quyền cũ. TASK-0003 kiểm thử bằng fixture/seed, chưa có Org CRUD.
4. Duyệt revocation/session profile và HTTP contract đã đề xuất, cùng [gói D-08/D-09](../decisions/SPRINT-1-APPROVAL.md). Owner/date/version/approval reference vẫn trống cho đến khi có phê duyệt thực tế.

### 6.2 Điều kiện mở khóa triển khai (Gates before Implementation)

- Không viết code xác thực, phân quyền hay cơ sở dữ liệu khi:
  1. `ADR-002` chưa được Chủ dự án duyệt chuyển sang `ACCEPTED` (kèm tên người duyệt, ngày duyệt, phiên bản).
  2. Quyết định `D-08` (cho phần auth/session) và `D-09` (cho phần persistence/schema) chưa được chốt trong [docs/DECISIONS.md](../DECISIONS.md).
  3. Chưa có task triển khai riêng (`TASK-0003` hoặc tương đương) được duyệt sang trạng thái `READY`.
- Như đã ghi nhận tại [docs/specs/SPRINT-1.md](../specs/SPRINT-1.md), nếu tương lai sử dụng PostgreSQL Row-Level Security (RLS) thì RLS chỉ là lớp bảo vệ bổ sung vì `SUPERUSER`, `BYPASSRLS` và mặc định `table owner` có thể bỏ qua RLS ([PostgreSQL Row Security Policies](https://www.postgresql.org/docs/18/ddl-rowsecurity.html), đọc ngày `2026-11-13`); không bao giờ dùng RLS để thay thế kiểm tra quyền tại backend.

## 7. Rủi ro và Kế hoạch hoàn tác (Risks & Rollback)

- **Rủi ro chính nếu thiết kế không chặt:** tự nâng quyền (`self-escalation`), quyền cũ vẫn hoạt động sau khi nhân sự chuyển phòng hoặc nghỉ việc, rò rỉ danh sách nhân sự phòng khác qua API tìm kiếm/lọc, hoặc ghi lộ token vào audit log.
- **Hoàn tác ở giai đoạn đặc tả hiện tại:** Mọi nội dung trong tệp này là đề xuất tài liệu (`PROPOSED`); nếu cần điều chỉnh hoặc hủy bỏ, thực hiện qua commit/revert trên nhánh tài liệu mà không ảnh hưởng tới mã nguồn hay cơ sở dữ liệu.
