# Sprint 1 — Đặc tả dự thảo và phương án cần duyệt

Status: DRAFT — chưa duyệt implementation
Version: 0.2
Prepared: 2026-11-13 (Asia/Ho_Chi_Minh)
Baseline: main bac54ba921aeddd37fbf19e35e11104e69a3f791; TASK-0001 ACCEPTED
Preparation task: [TASK-0002](../../tasks/TASK-0002.md), READY chỉ cho `DOCUMENTATION_ONLY`

## 1. Mục tiêu, ranh giới và phân tách Facts / Proposals / Unknowns

### 1.1 Mục tiêu đề xuất cho Sprint 1 (PROPOSAL)

Một người dùng được xác thực qua cơ chế doanh nghiệp đã được chủ dự án/IT phê duyệt, được ánh xạ (mapping) tới một hồ sơ nhân sự và phòng ban hợp lệ trong chi nhánh, chỉ được phép thực hiện đúng hành động và chỉ nhìn thấy dữ liệu thuộc phạm vi (scope) được cấp bởi backend. Ưu tiên triển khai theo các phần nhỏ (slices) có thể kiểm thử và nghiệm thu độc lập, không dựng nhiều màn hình trước khi chốt quyền.

### 1.2 Phân tách trạng thái thông tin

- **Facts (Sự thật hiện có trên repo tại `main` `bac54ba921aeddd37fbf19e35e11104e69a3f791`):**
  - Scaffold kỹ thuật và bộ cổng kiểm tra chất lượng/bảo mật của Sprint 0 (`TASK-0001`) đã `ACCEPTED` và hợp nhất qua [PR #3](https://github.com/vannhan091289-ux/baocaobanhang/pull/3).
  - Mã nguồn ứng dụng hiện tại chỉ gồm `src/app/layout.tsx`, `src/app/page.tsx` và `src/app/globals.css` hiển thị trạng thái tĩnh trung tính.
  - Chưa có mã nguồn xác thực/SSO, quản lý phiên, cơ sở dữ liệu, ORM, schema, migration, danh mục phòng/nhân viên hay kiểm tra quyền RBAC tại runtime.
  - Chính sách nội bộ của tổ chức về IdP, tiêu chuẩn phiên đăng nhập, phân loại dữ liệu và hạ tầng lưu trữ **chưa được cung cấp** trong repository.
- **Proposals (Đề xuất trong tài liệu này — `DRAFT` / `PROPOSED`):**
  - Мо hình thực thể tối thiểu (`Department`, `Staff`, `IdentityLink`, `RoleAssignment`, `AuditEvent`), luồng nghiệp vụ nền tảng (`S1-A`, `S1-B`, `S1-C`), hai phương án cho `D-08` và hai phương án cho `D-09`.
  - Quy tắc kiểm tra quyền mặc định từ chối (`default-deny`) và ma trận quyền chi tiết được đặt duy nhất tại [ADR-002](../adr/ADR-002-authorization.md) (`PROPOSED`).
- **Unknowns / Open Decisions (`OPEN` — chờ chủ dự án/IT chốt trước khi code):**
  - `D-08` (`OPEN` / `DEFERRED` từ Sprint 0): loại IdP, giao thức xác thực, thời hạn phiên, cơ chế thu hồi phiên (revocation window) và chính sách đăng xuất.
  - `D-09` (`OPEN`): môi trường PostgreSQL dev/test, chiến lược truy cập dữ liệu (data layer/ORM) và quy trình duyệt schema/migration.
  - Các câu hỏi chính sách trong `ADR-002` (`PROPOSED`): thẩm quyền gán/duyệt role, cơ chế khởi tạo quản trị viên đầu tiên (bootstrap admin), quy tắc xử lý người dùng có nhiều vai trò đồng thời, hiệu lực thời gian khi chuyển phòng và mã phản hồi HTTP khi từ chối truy cập.

### 1.3 Ngoài phạm vi Sprint 1 (Out of Scope)

- Công thức và tính toán 7 nhóm KPI, phân bổ chỉ tiêu (`Target`), ghi nhận/đối soát kết quả (`Actual`), tính điểm tổng hợp (`D-01`..`D-04`, `D-07`).
- Màn hình Dashboard điều hành, kế hoạch tuần/ngày, nhật ký hoạt động bán hàng.
- Quản lý `Prospect`, `Lead`, `Opportunity`, `Customer 360` và hệ thống cảnh báo (`Alert`).
- Kết nối Core Banking, tích hợp AI/chatbot, gửi email/tin nhắn ra ngoài, mô hình đa chi nhánh và dữ liệu khách hàng/nhân sự thật (`D-05`).
- Tài liệu này **không** cấp quyền viết code xác thực/database, cài đặt dependency, tạo migration hay triển khai hạ tầng.

---

## 2. Actors và mô hình dữ liệu tối thiểu đề xuất (PROPOSAL — chưa phải schema)

### 2.1 Các tác nhân (Actors)

Theo [Product baseline](../PRODUCT.md):

1. **Ban Giám đốc (`EXECUTIVE`):** phạm vi toàn chi nhánh theo các hành động được phê duyệt.
2. **Quản lý phòng (`DEPARTMENT_MANAGER`):** phạm vi giới hạn trong phòng được phân công (Cá nhân / Doanh nghiệp / Dịch vụ KH) và nhân sự thuộc phòng đó.
3. **Nhân viên (`STAFF` — KHCN, KHDN, DVKH):** phạm vi cá nhân và danh mục tham chiếu tối thiểu được phép.
4. **Admin cấu hình (`CONFIG_ADMIN`):** quản trị cấu hình tổ chức/danh mục theo thẩm quyền; **không** mặc nhiên có quyền xem dữ liệu khách hàng hoặc tự nâng quyền nghiệp vụ.
5. **Tác nhân chưa xác thực / chưa ánh xạ / ngừng hoạt động (`ANONYMOUS` / `UNMAPPED` / `INACTIVE`):** bị từ chối truy cập mọi tài nguyên nội bộ.

> Ma trận quyền chi tiết theo từng `Actor × Action × Resource × Scope` được định nghĩa chuẩn hóa tại [ADR-002](../adr/ADR-002-authorization.md).

### 2.2 Thực thể dữ liệu tối thiểu để thảo luận (Synthetic-only)

Các khái niệm dưới đây chỉ nhằm làm rõ ranh giới nghiệp vụ trước khi thiết kế schema:

| Thực thể đề xuất | Thuộc tính cốt lõi (dự kiến) | Ràng buộc nghiệp vụ & bảo mật |
|---|---|---|
| `Department` | `department_id` (stable ID), `code`, `name`, `status` (`ACTIVE`/`INACTIVE`), `created_at`, `updated_at` | Đại diện 3 phòng nghiệp vụ (KHCN, KHDN, DVKH) và khối điều hành chi nhánh; không xóa vật lý khi đã có lịch sử gắn nhân sự. |
| `Staff` | `staff_id` (stable ID), `staff_code`, `display_name` (synthetic), `department_id`, `status` (`ACTIVE`/`INACTIVE`), `effective_from`, `effective_to` | Hồ sơ nhân sự nội bộ dùng dữ liệu synthetic trong dev/test; không dùng email/tên nhân sự thật khi chưa có phê duyệt `D-05`. |
| `IdentityLink` | `identity_link_id`, `provider_issuer`, `provider_subject`, `staff_id`, `status` (`ACTIVE`/`REVOKED`), `linked_at`, `linked_by` | Liên kết 1-1 giữa định danh từ IdP (`iss` + `sub`) với `staff_id`; không dùng địa chỉ email có thể thay đổi làm khóa định danh duy nhất. |
| `RoleAssignment` | `assignment_id`, `staff_id`, `role_code`, `scope_type` (`BRANCH`/`DEPARTMENT`/`SELF`), `scope_department_id` (nullable), `status`, `effective_from`, `effective_to`, `approved_by` | Xác định quyền và phạm vi có thời hạn hiệu lực; bắt buộc kiểm tra đồng thời trạng thái `Staff` và khoảng thời gian hiệu lực tại thời điểm gọi API. |
| `AuditEvent` | `event_id`, `occurred_at`, `actor_staff_id` / `actor_subject_ref`, `action`, `resource_type`, `resource_id`, `scope_context`, `decision` (`ALLOW`/`DENY`), `reason_code`, `policy_version` | Ghi nhận bất biến cho thao tác đăng nhập, thay đổi cơ cấu/quyền và các lần từ chối truy cập quan trọng; tuyệt đối không lưu token, mật khẩu hay PII nhạy cảm. |

---

## 3. Đặc tả các luồng chức năng cốt lõi và trường hợp từ chối (PROPOSAL)

| Luồng | Điều kiện đầu vào | Kết quả thành công cần đạt (Allow / Happy Path) | Trường hợp từ chối & biên bắt buộc kiểm soát (Deny / Edge Cases) |
|---|---|---|---|
| **1. Đăng nhập (Authentication)** | Người dùng truy cập ứng dụng và thực hiện xác thực qua IdP đã được phê duyệt theo `D-08` | Backend xác minh hợp lệ phản hồi từ IdP, đối chiếu `IdentityLink` đang `ACTIVE` và `Staff` đang `ACTIVE`, khởi tạo phiên an toàn ở backend. | - Sai `iss`, `aud`, chữ ký token, `nonce`/`state` hoặc `redirect_uri` không khớp chính xác.<br>- Định danh IdP hợp lệ nhưng chưa có `IdentityLink` (`UNMAPPED`) hoặc `Staff`/`RoleAssignment` ở trạng thái `INACTIVE`/hết hạn → từ chối cấp phiên nghiệp vụ (`default-deny`), không tự động tạo nhân sự mới. |
| **2. Quản lý phiên & Đăng xuất (Session / Logout)** | Request kèm thông tin phiên hợp lệ hoặc yêu cầu đăng xuất | Backend đọc phiên từ nguồn tin cậy phía server, kiểm tra hạn dùng và trạng thái thu hồi; khi logout thì hủy phiên phía server và xóa cookie/session state theo contract. | - Phiên hết hạn (`expired`), đã bị thu hồi (`revoked`), thiếu thông tin xác thực hoặc gửi lại authorization code cũ (replay callback).<br>- Khi nhân sự bị chuyển sang `INACTIVE` hoặc thu hồi quyền: hiệu lực thu hồi phiên phải tuân theo `revocation window` được chủ dự án chốt. |
| **3. Cơ cấu phòng & Nhân sự (Organization)** | Tác nhân đã xác thực yêu cầu xem hoặc cập nhật danh mục phòng/nhân sự | - Tác nhân đọc được đúng danh sách phòng/nhân sự trong `scope` được cấp.<br>- `CONFIG_ADMIN` (hoặc vai trò được duyệt) tạo/cập nhật phòng hoặc hồ sơ nhân sự synthetic hợp lệ, ghi nhận `AuditEvent`. | - Truyền `department_id`/`staff_id` không tồn tại, trùng mã, hoặc gán nhân sự vào phòng `INACTIVE`.<br>- `DEPARTMENT_MANAGER` hoặc `STAFF` cố đọc/sửa nhân sự thuộc phòng khác.<br>- Chuyển phòng cho nhân sự nhưng chưa xử lý hiệu lực `RoleAssignment` cũ (phải chặn hoặc đóng hiệu lực cũ theo policy). |
| **4. Kiểm tra quyền (Authorization Enforcement)** | Mọi lệnh gọi đọc/ghi (list, search, detail, create, update) tới backend | Backend đánh giá đồng thời `subject + action + resource + scope + effective_time` theo [ADR-002](../adr/ADR-002-authorization.md) và chỉ trả về bản ghi/trường dữ liệu nằm trong phạm vi. | - Gửi request trực tiếp tới API/URL bỏ qua giao diện (forced browsing).<br>- Client tự chèn hoặc sửa tham số `role`, `department_id`, `staff_id` trong body/query/header để vượt quyền.<br>- `CONFIG_ADMIN` cố truy cập dữ liệu nghiệp vụ ngoài phạm vi cấu hình hoặc tự gán/duyệt quyền cho chính mình (self-escalation). |
| **5. Ghi vết kiểm toán (Audit Trail)** | Sự kiện xác thực, thay đổi tổ chức/role hoặc quyết định từ chối truy cập | Ghi nhận đầy đủ bản ghi `AuditEvent` với mã lý do (`reason_code`) và `policy_version`; truy vết được ai thực hiện, lúc nào, trên tài nguyên nào. | - Không ghi nhận thành công khi thao tác nghiệp vụ thất bại (transactional consistency).<br>- Cấm ghi `access_token`, `id_token`, `refresh_token`, secret, mật khẩu hoặc toàn bộ payload claims chưa lọc vào log/audit/CI artifacts. |

---

## 4. Phân tích phương án cho các quyết định mở `D-08` và `D-09` (OPEN)

### 4.1 Quyết định `D-08` — Xác thực doanh nghiệp (SSO / IdP & Session Policy)

Trạng thái: **OPEN** (hoãn từ Sprint 0 theo [DECISIONS.md](../DECISIONS.md); chưa chọn IdP, thư viện hay giao thức).

| Tiêu chí so sánh | Phương án A — Tích hợp trực tiếp IdP doanh nghiệp hiện có (Non-prod/Test Tenant của tổ chức) | Phương án B — Môi trường IdP/OIDC chuẩn hóa tách biệt cho dev/test (chỉ dữ liệu synthetic) |
|---|---|---|
| **Mô tả** | Kết nối ứng dụng ở môi trường phát triển/kiểm thử vào tenant test/staging thuộc hệ thống IdP doanh nghiệp sẵn có của ngân hàng/chi nhánh. | Sử dụng một OpenID Provider chuẩn OIDC tách biệt được tổ chức cho phép dùng trong dev/test/CI với tài khoản synthetic, giữ nguyên contract để chuyển sang IdP doanh nghiệp khi sẵn sàng. |
| **Điều kiện áp dụng** | IT xác nhận tên IdP, giao thức (ví dụ OIDC), cấp `client_id`/metadata cho môi trường test, phê duyệt `redirect_uri` và quy tắc mạng. | Chủ dự án và IT cho phép dùng OIDC test provider trong giai đoạn phát triển, thống nhất bộ claims tối thiểu (`iss`, `sub`) và lộ trình chuyển đổi sang IdP chính thức. |
| **Ưu điểm** | Kiểm chứng sớm cấu hình claims, chính sách phiên và luồng đăng xuất sát với môi trường vận hành thực tế của tổ chức. | Chủ động kiểm thử tự động (integration/E2E) trên local và CI mà không phụ thuộc kết nối mạng nội bộ hay tiến độ cấp phát tenant của IT. |
| **Rủi ro & Đánh đổi** | Phụ thuộc thời gian phê duyệt/cấu hình của bộ phận IT; CI trên GitHub có thể không kết nối được nếu IdP test chỉ mở trong mạng nội bộ. | Có rủi ro sai khác cấu hình chi tiết (claims phụ, logout endpoint) khi chuyển sang IdP thật nếu không khóa chặt contract ngay từ đầu. |
| **Việc Chủ dự án / IT cần xác nhận** | 1. Tổ chức hiện dùng IdP nào và có cấp được môi trường test cho dự án không?<br>2. Chính sách thời hạn phiên (idle/absolute timeout) và cơ chế logout chuẩn là gì? | 1. Có chấp thuận dùng OIDC test provider (chỉ synthetic) để mở khóa Sprint 1 trong khi chờ IdP doanh nghiệp không?<br>2. Ai chịu trách nhiệm phê duyệt contract chuyển đổi sang IdP chính thức? |

- **Đề xuất có điều kiện của người soạn:**
  - Chọn **Phương án A** nếu bộ phận IT có sẵn non-prod tenant của IdP doanh nghiệp và cho phép kết nối kiểm thử.
  - Chọn **Phương án B** nếu chưa thể cấp kết nối IdP doanh nghiệp ngay nhưng chủ dự án muốn kiểm chứng toàn bộ luồng xác thực, gắn nhân sự và phân quyền backend bằng dữ liệu synthetic theo chuẩn OIDC.
  - **Ranh giới bảo mật bắt buộc:** Tuyệt đối không tự tạo cơ chế đăng nhập giả bằng biến môi trường, mật khẩu hardcode hay trang chọn role tạm thời không qua xác thực để thay thế `D-08`.
- **Yêu cầu kỹ thuật theo chuẩn chính thức (khi áp dụng OIDC / OAuth 2.0):**
  - Sử dụng **Authorization Code Flow** kết hợp **PKCE (`S256`)** cho mọi loại client, khớp chính xác (`exact match`) `redirect_uri` đã đăng ký và chống tấn công hạ cấp PKCE theo **RFC 9700** (*OAuth 2.0 Security Best Current Practice*, mục 2.1.1 & 4.1.1 — nguồn: https://www.rfc-editor.org/rfc/rfc9700.html, đọc ngày `2026-11-13`).
  - Xác minh chặt chẽ **ID Token** ở backend gồm chữ ký số qua JWKS của Issuer, khớp chính xác `iss` (Issuer Identifier), kiểm tra `aud` chứa `client_id` (và `azp` nếu có nhiều audience), kiểm tra hạn `exp`/`iat` và đối chiếu `nonce` nếu gửi trong yêu cầu xác thực theo **OpenID Connect Core 1.0** (mục 3.1.3.7 *ID Token Validation* — nguồn: https://openid.net/specs/openid-connect-core-1_0.html, đọc ngày `2026-11-13`).

### 4.2 Quyết định `D-09` — Cơ sở dữ liệu & Data Layer cho môi trường dev/test

Trạng thái: **OPEN** (PostgreSQL mới là định hướng trong [ARCHITECTURE.md](../ARCHITECTURE.md), chưa phê duyệt triển khai).

| Tiêu chí so sánh | Phương án A — PostgreSQL khởi chạy cục bộ & trên CI runner (Local / Ephemeral Container, chỉ synthetic) | Phương án B — PostgreSQL dev/test tập trung do tổ chức cung cấp |
|---|---|---|
| **Mô tả** | Chạy PostgreSQL phiên bản cố định ngay trên máy phát triển và service container tạm thời trên GitHub Actions CI; khởi tạo từ đầu bằng migration và fixture synthetic trong mỗi lần test. | Kết nối tới một cơ sở dữ liệu PostgreSQL dev/test do bộ phận IT của tổ chức quản lý và cấp quyền riêng cho dự án. |
| **Điều kiện áp dụng** | Chủ dự án duyệt phiên bản PostgreSQL, cách chạy local/CI và công cụ quản lý schema/migration trước khi thêm dependency. | IT cấp endpoint, cơ chế kết nối an toàn, phân quyền tài khoản DB tối thiểu (least privilege) và quy định quản lý thông tin kết nối. |
| **Ưu điểm** | Tái lập 100% giữa local và CI, cô lập hoàn toàn, không phát sinh chi phí hạ tầng ngoài, không cần lưu trữ connection secret lâu dài trên repo. | Phản ánh sát cấu hình hệ quản trị cơ sở dữ liệu, quyền DB user và chính sách vận hành của tổ chức. |
| **Rủi ro & Đánh đổi** | Lập trình viên cần cài đặt PostgreSQL hoặc container runtime ở local theo đúng phiên bản đã pin. | Phụ thuộc hạ tầng mạng/firewall khi chạy CI; rủi ro lộ thông tin kết nối nếu quản lý secret không chặt hoặc dùng chung môi trường giữa nhiều nhánh test. |
| **Việc Chủ dự án / IT cần xác nhận** | 1. Có đồng ý dùng PostgreSQL local/CI ephemeral cho giai đoạn dữ liệu synthetic không?<br>2. Chọn phiên bản PostgreSQL nào và chọn SQL query layer mỏng hay ORM nào? | 1. Tổ chức có yêu cầu bắt buộc dùng DB test tập trung ngay từ Sprint 1 không?<br>2. Cơ chế cấp phát/xoay vòng thông tin kết nối và giới hạn mạng cho CI được quy định thế nào? |

- **Đề xuất có điều kiện của người soạn:**
  - Ưu tiên **Phương án A** cho Sprint 1 (với dữ liệu 100% synthetic) để đảm bảo khả năng kiểm thử tự động, độc lập và tái lập trên CI mà không cần cấu hình bí mật hạ tầng ngoài. Chuyển sang hoặc bổ sung **Phương án B** khi tổ chức cấp môi trường staging/UAT.
  - Về tầng truy cập dữ liệu (data layer): chờ chủ dự án duyệt giữa (1) driver PostgreSQL kèm câu lệnh SQL tường minh/kiểm tra kiểu và (2) ORM/query builder có quản lý migration chặt chẽ; chỉ cài đặt package sau khi quyết định được chốt và có task implementation `READY`.
- **Lưu ý bảo mật từ nguồn chính thức về Row-Level Security (RLS):**
  - Theo tài liệu chính thức **PostgreSQL Row Security Policies** (mục 5.8 — nguồn: https://www.postgresql.org/docs/current/ddl-rowsecurity.html, đọc ngày `2026-11-13`), các vai trò `SUPERUSER`, vai trò có thuộc tính `BYPASSRLS` và mặc định cả **chủ sở hữu bảng (`table owner`)** đều bỏ qua RLS (trừ khi bật `FORCE ROW LEVEL SECURITY`, nhưng `SUPERUSER` và `BYPASSRLS` vẫn luôn vượt qua).
  - Do đó, kiểm tra quyền ở **backend ứng dụng là bắt buộc**; nếu sử dụng RLS trong tương lai thì chỉ đóng vai trò lớp phòng thủ bổ sung (defense-in-depth) và tài khoản kết nối runtime của ứng dụng tuyệt đối không được là `superuser`, không có `BYPASSRLS` và nên tách biệt với tài khoản chạy migration sở hữu bảng.
  - Việc chốt `D-09` cho môi trường synthetic **không** thay thế hay đóng quyết định `D-05` về hạ tầng lưu trữ và bảo vệ dữ liệu khách hàng thật.

---

## 5. Phân nhỏ lộ trình Sprint 1 theo phụ thuộc (Proposed Vertical Slices)

Các phần việc dưới đây là đề xuất chia nhỏ để giảm rủi ro; **chưa phải là các task `READY` để viết code**:

| Mã phần việc (Dự kiến) | Mục tiêu & Phạm vi hẹp | Phụ thuộc & Gate bắt buộc trước khi chuyển `READY` | Kết quả nghiệm thu & Khả năng hoàn tác (Rollback) |
|---|---|---|---|
| **S1-A: Xác thực & Phiên cơ bản (Identity & Session Foundation)** | Xác thực qua cơ chế được chọn ở `D-08`, tạo/kiểm tra/hủy phiên ở backend, chặn truy cập chưa xác thực hoặc chưa ánh xạ nhân sự. | - `D-08` được phê duyệt.<br>- `ADR-002` được phê duyệt `ACCEPTED` đầy đủ.<br>- `D-09` được duyệt nếu lưu phiên/identity link trong DB.<br>- Có task triển khai riêng ở trạng thái `READY`. | - **Nghiệm thu:** Unit + integration + E2E chứng minh đăng nhập hợp lệ, đăng xuất và từ chối token/phiên sai/hết hạn.<br>- **Rollback:** Revert PR của `S1-A`, giữ nguyên nền tảng Sprint 0. |
| **S1-B: Cơ cấu Phòng & Nhân sự tối thiểu (Organization Baseline)** | Quản lý danh mục `Department`, `Staff` và `IdentityLink` với dữ liệu synthetic, kiểm tra trạng thái `ACTIVE`/`INACTIVE` và lịch sử hiệu lực. | - `ADR-002` được phê duyệt `ACCEPTED` đầy đủ.<br>- `D-09` và kế hoạch schema/migration được phê duyệt.<br>- Có task triển khai riêng ở trạng thái `READY`. | - **Nghiệm thu:** Migration tiến/lùi (up/down) chạy sạch trên DB trống; kiểm thử ràng buộc toàn vẹn và lọc theo scope.<br>- **Rollback:** Chạy down-migration trên môi trường dev/test và revert PR. |
| **S1-C: Thực thi Phân quyền & Kiểm toán (RBAC Enforcement & Audit)** | Áp dụng bộ kiểm tra `role + action + resource + scope + effective_time` tại backend theo `ADR-002` và ghi nhận `AuditEvent` cho các thao tác/từ chối. | - `ADR-002` được phê duyệt `ACCEPTED` đầy đủ.<br>- Contract của `S1-A` và `S1-B` đã hoàn tất nghiệm thu.<br>- Có task triển khai riêng ở trạng thái `READY`. | - **Nghiệm thu:** Bộ kiểm thử đầy đủ cho toàn bộ các ô allow/deny trong ma trận `ADR-002` và kiểm tra nhật ký `AuditEvent` không rò rỉ bí mật.<br>- **Rollback:** Revert PR của `S1-C` về trạng thái cuối `S1-B`. |

---

## 6. Kế hoạch kiểm thử, bảo mật, quyền riêng tư và hoàn tác (Test, Privacy & Rollback Plan)

### 6.1 Các nhóm kịch bản kiểm thử bắt buộc khi triển khai

1. **Positive cases (Trường hợp cho phép):**
   - Người dùng có `IdentityLink` đang `ACTIVE`, `Staff` đang `ACTIVE`, `RoleAssignment` còn hiệu lực thời gian và đúng `scope` (`BRANCH` / `DEPARTMENT` / `SELF`) thực hiện được đúng `action` được cấp trong [ADR-002](../adr/ADR-002-authorization.md).
2. **Negative cases (Trường hợp từ chối — bắt buộc có test tự động cho từng trường hợp):**
   - Truy cập khi chưa đăng nhập (`ANONYMOUS`), phiên hết hạn hoặc đã thu hồi (`REVOKED`), định danh IdP chưa gắn nhân sự (`UNMAPPED`), hoặc hồ sơ nhân sự ở trạng thái `INACTIVE`.
   - `STAFF` hoặc `DEPARTMENT_MANAGER` truy vấn/chỉnh sửa dữ liệu thuộc phòng ban khác (`cross-department access attempt`).
   - Gửi trực tiếp HTTP request tới endpoint cấu hình/quản trị hoặc giả mạo `role`/`department_id` trong payload/query/header.
   - `CONFIG_ADMIN` cố truy cập dữ liệu ngoài phạm vi cấu hình hoặc tự gán/phê duyệt role cho chính mình (`self-escalation attempt`).
3. **Boundary & Temporal cases (Trường hợp biên và thời gian hiệu lực):**
   - `RoleAssignment` chưa tới thời điểm `effective_from` hoặc đã qua thời điểm `effective_to` (theo múi giờ chuẩn của hệ thống do chủ dự án chốt).
   - Nhân sự đổi phòng ban hoặc bị thu hồi quyền khi phiên đăng nhập vẫn đang mở.
   - Xung đột dữ liệu khi tạo trùng mã phòng/nhân sự, trùng `IdentityLink` (`iss` + `sub`) hoặc cập nhật đồng thời.

### 6.2 Kiểm soát Audit, Bảo mật và Quyền riêng tư (Privacy & Security Guardrails)

- **Dữ liệu kiểm thử:** 100% dữ liệu trong mã nguồn, seed, test fixtures, screenshots và CI logs phải là dữ liệu giả lập (`synthetic`), sử dụng tên/mã/email miền giả định (ví dụ `@example.invalid`).
- **Bảo vệ thông tin nhạy cảm trong log/audit:** Nhật ký ứng dụng và bảng `AuditEvent` không được chứa mật khẩu, session cookie, `id_token`, `access_token`, `refresh_token`, khóa bí mật hoặc toàn bộ claims thô từ IdP.
- **Chống rò rỉ thông tin ngoài phạm vi:** Phản hồi lỗi khi từ chối quyền không được làm lộ nội dung hoặc thông tin nhạy cảm của bản ghi thuộc phòng ban khác.
- **Giữ vững cổng kiểm tra Sprint 0:** Mọi PR triển khai Sprint 1 phải tiếp tục vượt qua toàn bộ các gate hiện có (`npm ci`, `lint`, `format:check`, `typecheck`, `test:unit`, `build`, `test:e2e`, `security` với Gitleaks `8.30.1` + `npm audit`, và `git diff --check`).

### 6.3 Rủi ro và Kế hoạch hoàn tác (Rollback Plan)

- **Trong giai đoạn đặc tả hiện tại (`TASK-0002`):** Chỉ thay đổi tài liệu Markdown; nếu cần hoàn tác, đóng PR hoặc revert commit tài liệu trên nhánh `feat/TASK-0002-sprint-1-spec`.
- **Trong giai đoạn triển khai tương lai (`S1-A`..`S1-C`):** Mỗi slice đi kèm PR độc lập; mọi thay đổi cấu trúc cơ sở dữ liệu (sau khi `D-09` được duyệt) phải có kịch bản hạ cấp/hoàn tác (`down migration`) được kiểm thử trên dữ liệu synthetic trước khi hợp nhất.

---

## 7. Danh sách câu hỏi ngắn gọn trình Chủ dự án / IT phê duyệt

Để có thể đóng các quyết định mở và tạo task triển khai đầu tiên cho Sprint 1, đề nghị Chủ dự án / bộ phận IT phản hồi các điểm sau (không cần gửi kèm mật khẩu, khóa bí mật hay dữ liệu thật):

1. **Chốt `D-08` (Xác thực & Phiên):**
   - Chọn **Phương án A** (tích hợp non-prod tenant của IdP doanh nghiệp hiện có) hay **Phương án B** (dùng OIDC test provider chuẩn hóa với dữ liệu synthetic cho dev/test)?
   - Quy định về thời hạn phiên đăng nhập (idle/absolute timeout) và thời gian tối đa để thu hồi phiên khi nhân sự nghỉ việc/đổi quyền là bao lâu?
2. **Chốt `D-09` (Cơ sở dữ liệu & Data Layer cho dev/test):**
   - Chọn **Phương án A** (PostgreSQL local & ephemeral CI container, chỉ synthetic) hay **Phương án B** (PostgreSQL test tập trung do tổ chức cấp)?
   - Phiên bản PostgreSQL và công cụ truy cập dữ liệu/migration nào được phê duyệt đưa vào dự án?
3. **Chốt `ADR-002` (Ma trận phân quyền & Quản trị tổ chức):**
   - Ai có thẩm quyền gán/phê duyệt `RoleAssignment` (Ban Giám đốc, Admin cấu hình cần phê duyệt kép, hay quy trình khác) và tài khoản quản trị đầu tiên (`bootstrap admin`) được khởi tạo theo quy trình nào?
   - Một nhân sự có được giữ nhiều vai trò đồng thời không (nếu có, áp dụng quy tắc chọn vai trò đang hoạt động hay hợp nhất quyền trong phạm vi nào), và khi chuyển phòng thì quyền ở phòng cũ chấm dứt ngay lập tức hay theo ngày hiệu lực?
   - Mã phản hồi HTTP khi truy cập tài nguyên ngoài phạm vi phòng ban sẽ dùng `403 Forbidden` thống nhất hay `404 Not Found` (để ẩn sự tồn tại của bản ghi ngoài scope)?
