# Sprint 1 — S1-A, S1-B & S1-C DEVTEST đã hoàn tất và nghiệm thu

Status: ACCEPTED (Scope: DEVTEST Synthetic — S1-A TASK-0003, S1-B TASK-0004, S1-C TASK-0005)
Approved scope: S1-A/S1-B/S1-C DEVTEST qua SPRINT-1-APPROVAL.md (2026-11-13) và SPRINT-1-BC-APPROVAL-2026-11-14.md (2026-11-14)
Version: 1.0
Prepared: 2026-11-14 (Asia/Ho_Chi_Minh)
Baseline: main 52843270e7d743d14c40ad287b748847b7097994; TASK-0002, TASK-0003, TASK-0004, TASK-0005 ACCEPTED

Approval package: [D-08/D-09/ADR-002](../decisions/SPRINT-1-APPROVAL.md), ACCEPTED cho DEVTEST 2026-11-13; [image manifest](../decisions/SPRINT-1-IMAGES.md) LOCKED. [TASK-0003](../../tasks/TASK-0003.md) READY chỉ S1-A sau merge; máy Antigravity thiếu runtime phải BLOCKED trước code/install/pull/migrate. Lượt cập nhật này chưa code/deploy.

## 1. Mục tiêu, ranh giới và phân tách Facts / Proposals / Unknowns

### 1.1 Mục tiêu đề xuất cho Sprint 1 (PROPOSAL)

Một người dùng được xác thực qua IdP đã được chủ dự án/IT phê duyệt theo phạm vi; gói DEVTEST đã duyệt Keycloak synthetic, không nghiệm thu SSO doanh nghiệp, được ánh xạ (mapping) tới một hồ sơ nhân sự và phòng ban hợp lệ trong chi nhánh, chỉ được phép thực hiện đúng hành động và chỉ nhìn thấy dữ liệu thuộc phạm vi (scope) được cấp bởi backend. Ưu tiên triển khai theo các phần nhỏ (slices) có thể kiểm thử và nghiệm thu độc lập, không dựng nhiều màn hình trước khi chốt quyền.

### 1.2 Phân tách trạng thái thông tin

1. **Facts (Sự thật hiện có trên repo tại `main` `d8a7bd9c4b8bbebb738dd84f7369a9446e46b2dc`):**
  - Scaffold kỹ thuật và bộ cổng kiểm tra chất lượng/bảo mật của Sprint 0 (`TASK-0001`) đã `ACCEPTED` và hợp nhất qua [PR #3](https://github.com/vannhan091289-ux/baocaobanhang/pull/3).
  - Slice `S1-A` (`TASK-0003`: xác thực Keycloak OIDC + PKCE S256, phiên server-side, 7 bảng nền PostgreSQL 18.7, least-privilege `app_runtime_role`, `/api/me`, `/workspace` và thu hồi phiên nguyên tử qua migrations `0001`+`0002`) đã được nghiệm thu `ACCEPTED` và hợp nhất qua [PR #6](https://github.com/vannhan091289-ux/baocaobanhang/pull/6).
  - Chưa mở các endpoints CRUD danh mục tổ chức (`S1-B`) và luồng đề nghị/phê duyệt phân quyền Maker-Checker (`S1-B`/`S1-C`); gói đặc tả chi tiết và đề xuất migration `0003` đã được soạn tại [tasks/TASK-0004.md](../../tasks/TASK-0004.md), [tasks/TASK-0005.md](../../tasks/TASK-0005.md) và [docs/decisions/SPRINT-1-BC-PROPOSAL.md](../decisions/SPRINT-1-BC-PROPOSAL.md) để trình duyệt chuyển sang `READY`.
  - Chính sách nội bộ của tổ chức về IdP thật, tiêu chuẩn phiên đăng nhập vận hành thật, phân loại dữ liệu và hạ tầng lưu trữ thật (`D-05`, `D-10`) **chưa được cung cấp** trong repository.
- **Proposals (Đề xuất trong tài liệu này — `DRAFT` / `PROPOSED`):**
  - Mô hình thực thể tối thiểu (`Department`, `Staff`, `IdentityLink`, `RoleAssignment`, `AuditEvent`), luồng nghiệp vụ nền tảng (`S1-A`, `S1-B`, `S1-C`), hai phương án cho `D-08` và hai phương án cho `D-09`.
  - Quy tắc kiểm tra quyền mặc định từ chối (`default-deny`) và ma trận quyền chi tiết được đặt duy nhất tại [ADR-002](../adr/ADR-002-authorization.md) (`ACCEPTED`, Scope: DEVTEST).
- **Approved decisions / remaining gates:**
  - D-08 B, D-09 A và ADR-002 v0.3 được duyệt cho DEVTEST/S1-A theo approval package; session/role/error/schema/rollback dùng đúng nguồn chuẩn đã liên kết.
  - D-05/D-10 vẫn OPEN cho real data/hosting/IdP doanh nghiệp/MFA/global logout; không suy ra từ DEVTEST.
  - Local Antigravity thiếu container runtime theo báo cáo được cung cấp: phải qua execution preflight, không tự cài global. S1-B/C chưa có task READY, vẫn dự thảo.

### 1.3 Ngoài phạm vi Sprint 1 (Out of Scope)

- Công thức và tính toán 7 nhóm KPI, phân bổ chỉ tiêu (`Target`), ghi nhận/đối soát kết quả (`Actual`), tính điểm tổng hợp (`D-01`..`D-04`, `D-07`).
- Màn hình Dashboard điều hành, kế hoạch tuần/ngày, nhật ký hoạt động bán hàng.
- Quản lý `Prospect`, `Lead`, `Opportunity`, `Customer 360` và hệ thống cảnh báo (`Alert`).
- Kết nối Core Banking, tích hợp AI/chatbot, gửi email/tin nhắn ra ngoài, mô hình đa chi nhánh và dữ liệu khách hàng/nhân sự thật (`D-05`).
- Tài liệu này **không** cấp quyền viết code xác thực/database, cài đặt dependency, tạo migration hay triển khai hạ tầng.

---

## 2. Actors và mô hình khái niệm tối thiểu

Mục này giữ mô hình khái niệm của toàn Sprint 1; schema bảy bảng S1-A dùng duy nhất approval package mục 3. Không tạo thêm bảng/trường ngoài task từ mô hình tổng quan.

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

## 4. Phân tích phương án đã dùng để duyệt D-08 B / D-09 A (DEVTEST)

### 4.1 Quyết định `D-08` — Xác thực doanh nghiệp (SSO / IdP & Session Policy)

Trạng thái: **ACCEPTED, Scope: DEVTEST** — D-08 B theo [approval package](../decisions/SPRINT-1-APPROVAL.md); D-10 giữ nghĩa vụ enterprise SSO. Bảng A/B bên dưới lưu phân tích, không cho phép tự đổi lựa chọn.

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
- **Tham chiếu chuẩn và lý do chọn profile D-08 đã duyệt:**
  - Đề xuất dự án dùng **Authorization Code Flow + PKCE (`S256`)** cho mọi client được chọn, exact-match `redirect_uri` và chống hạ cấp PKCE. **RFC 9700** mục 2.1.1 bắt buộc PKCE với public clients và khuyến nghị với confidential clients; yêu cầu cho mọi client ở đây là profile dự án nghiêm hơn đã được duyệt cho DEVTEST, không phải trích dẫn rằng RFC bắt buộc như nhau với mọi client. [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html#section-2.1.1), đối chiếu ngày `2026-11-13`.
  - Validation ID Token dựa trên thuật toán/khóa và profile IdP được duyệt; JWKS áp dụng cho khóa bất đối xứng tương ứng, không mặc định mọi provider dùng cùng cơ chế ký. Kiểm tra `iss`, `aud`, `exp`, `nonce` nếu đã gửi; `azp` theo extension/profile và khoảng chấp nhận `iat` phải được xác định trước code. Không tự chọn library/provider hay dùng kiểm tra email thay identity validation. [OIDC Core 1.0 — 3.1.3.7](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation), đối chiếu ngày `2026-11-13`.

### 4.2 Quyết định `D-09` — Cơ sở dữ liệu & Data Layer cho môi trường dev/test

Trạng thái: **ACCEPTED, Scope: DEVTEST** — D-09 A theo [approval package](../decisions/SPRINT-1-APPROVAL.md); schema/rollback chỉ trong TASK-0003. Bảng A/B dưới lưu phân tích, không cho phép tự đổi lựa chọn.

| Tiêu chí so sánh | Phương án A — PostgreSQL khởi chạy cục bộ & trên CI runner (Local / Ephemeral Container, chỉ synthetic) | Phương án B — PostgreSQL dev/test tập trung do tổ chức cung cấp |
|---|---|---|
| **Mô tả** | Chạy PostgreSQL phiên bản cố định ngay trên máy phát triển và service container tạm thời trên GitHub Actions CI; khởi tạo từ đầu bằng migration và fixture synthetic trong mỗi lần test. | Kết nối tới một cơ sở dữ liệu PostgreSQL dev/test do bộ phận IT của tổ chức quản lý và cấp quyền riêng cho dự án. |
| **Điều kiện áp dụng** | Chủ dự án duyệt phiên bản PostgreSQL, cách chạy local/CI và công cụ quản lý schema/migration trước khi thêm dependency. | IT cấp endpoint, cơ chế kết nối an toàn, phân quyền tài khoản DB tối thiểu (least privilege) và quy định quản lý thông tin kết nối. |
| **Ưu điểm** | Tái lập 100% giữa local và CI, cô lập hoàn toàn, không phát sinh chi phí hạ tầng ngoài, không cần lưu trữ connection secret lâu dài trên repo. | Phản ánh sát cấu hình hệ quản trị cơ sở dữ liệu, quyền DB user và chính sách vận hành của tổ chức. |
| **Rủi ro & Đánh đổi** | Lập trình viên cần cài đặt PostgreSQL hoặc container runtime ở local theo đúng phiên bản đã pin. | Phụ thuộc hạ tầng mạng/firewall khi chạy CI; rủi ro lộ thông tin kết nối nếu quản lý secret không chặt hoặc dùng chung môi trường giữa nhiều nhánh test. |
| **Việc Chủ dự án / IT cần xác nhận** | 1. Có đồng ý dùng PostgreSQL local/CI ephemeral cho giai đoạn dữ liệu synthetic không?<br>2. Chọn phiên bản PostgreSQL nào và chọn SQL query layer mỏng hay ORM nào? | 1. Tổ chức có yêu cầu bắt buộc dùng DB test tập trung ngay từ Sprint 1 không?<br>2. Cơ chế cấp phát/xoay vòng thông tin kết nối và giới hạn mạng cho CI được quy định thế nào? |

- **Đề xuất có điều kiện của người soạn:**
  - Ưu tiên **Phương án A** cho Sprint 1 (với dữ liệu 100% synthetic) để đảm bảo khả năng kiểm thử tự động, độc lập và tái lập trên CI mà không cần cấu hình bí mật hạ tầng ngoài. Chuyển sang hoặc bổ sung **Phương án B** khi tổ chức cấp môi trường staging/UAT.
  - Về data layer: D-09 A đã chọn pg + SQL tham số hóa, node-pg-migrate, chưa ORM; dùng pins trong approval package. Chỉ cài package sau READY và execution preflight PASS; không tự đổi sang ORM/query builder.
- **Lưu ý bảo mật từ nguồn chính thức về Row-Level Security (RLS):**
  - Theo tài liệu chính thức **PostgreSQL Row Security Policies** (mục 5.9 của PostgreSQL 18 — nguồn: https://www.postgresql.org/docs/18/ddl-rowsecurity.html, đối chiếu ngày `2026-11-13`), các vai trò `SUPERUSER`, vai trò có thuộc tính `BYPASSRLS` và mặc định cả **chủ sở hữu bảng (`table owner`)** đều bỏ qua RLS (trừ khi bật `FORCE ROW LEVEL SECURITY`, nhưng `SUPERUSER` và `BYPASSRLS` vẫn luôn vượt qua).
  - Do đó, kiểm tra quyền ở **backend ứng dụng là bắt buộc**; nếu sử dụng RLS trong tương lai thì chỉ đóng vai trò lớp phòng thủ bổ sung (defense-in-depth) và tài khoản kết nối runtime của ứng dụng tuyệt đối không được là `superuser`, không có `BYPASSRLS` và nên tách biệt với tài khoản chạy migration sở hữu bảng.
  - Việc chốt `D-09` cho môi trường synthetic **không** thay thế hay đóng quyết định `D-05` về hạ tầng lưu trữ và bảo vệ dữ liệu khách hàng thật.

---

## 5. Phân nhỏ lộ trình Sprint 1 theo phụ thuộc (Proposed Vertical Slices)

Các slices dưới giữ trình tự giảm rủi ro: S1-A được duyệt riêng qua TASK-0003 READY sau merge PR #5 và preflight PASS; S1-B/C vẫn cần task/approval riêng.

**Baseline bảo mật không được trì hoãn:** Slice đầu tạo endpoint nội bộ phải có xác thực phù hợp, default-deny, kiểm tra role/action/scope và audit tối thiểu ngay trong slice đó. Mapping `IdentityLink`/`Staff`/`RoleAssignment` tối thiểu phải có từ S1-A theo D-09/schema đã duyệt, không chờ CRUD ở S1-B hoặc giả lập danh tính để vượt gate. S1-C chỉ hoàn thiện độ phủ/kiểm soát; không phải thời điểm bắt đầu bảo vệ các endpoint đã tồn tại.

| Mã phần việc (Dự kiến) | Mục tiêu & Phạm vi hẹp | Phụ thuộc & Gate bắt buộc trước khi chuyển `READY` | Kết quả nghiệm thu & Khả năng hoàn tác (Rollback) |
|---|---|---|---|
| **S1-A: Xác thực & Phiên cơ bản (Identity & Session Foundation)** | Xác thực qua `D-08`, nguồn mapping/nhân sự/quyền synthetic tối thiểu theo schema được duyệt, tạo/kiểm tra/hủy phiên; chặn chưa xác thực/chưa map, có policy deny và audit nền. Chưa có CRUD quản trị tổ chức. | - `D-08`, `D-09` và schema/migration plan tối thiểu được phê duyệt.<br>- `ADR-002` `ACCEPTED` đầy đủ.<br>- Task triển khai riêng `READY`. | - **Nghiệm thu:** Unit/integration/E2E cho login/logout/deny và audit, không có endpoint không được bảo vệ.<br>- **Rollback:** Giữ baseline bảo mật hoặc tắt các endpoint phụ thuộc; hoàn tác code/data theo kế hoạch được duyệt, không xóa audit. |
| **S1-B: Cơ cấu Phòng & Nhân sự tối thiểu (Organization Baseline)** | CRUD `Department`/`Staff`/`IdentityLink` synthetic với validation, effective time, role/action/scope và audit có ngay khi tạo endpoint; tái sử dụng nền S1-A. | - S1-A đã nghiệm thu.<br>- `ADR-002` `ACCEPTED` đầy đủ; `D-09` và mọi schema/migration bổ sung được duyệt.<br>- Task triển khai riêng `READY`. | - **Nghiệm thu:** Toàn vẹn dữ liệu, allow/deny và lọc scope trên từng endpoint; kế hoạch schema rollback/restore được thử với synthetic.<br>- **Rollback:** Giữ kiểm soát quyền/audit hoặc tắt endpoint bị ảnh hưởng; không chạy down-migration mất dữ liệu như thao tác mặc định. |
| **S1-C: Hoàn thiện Phân quyền & Kiểm toán (Authorization & Audit Completion)** | Hoàn thiện độ phủ ma trận, temporal/concurrency cases và audit trên nền bảo mật đã có ở S1-A/S1-B; không hoãn enforcement tới slice này. | - `ADR-002` `ACCEPTED` đầy đủ.<br>- S1-A/S1-B đã nghiệm thu; task triển khai riêng `READY`. | - **Nghiệm thu:** Đủ allow/deny theo ma trận và audit không lộ bí mật, regression không mất baseline.<br>- **Rollback:** Chỉ quay về S1-B đã có bảo mật; nếu phiên bản cũ không còn đáp ứng contract, tắt endpoint liên quan thay vì giữ API thiếu authz/audit. |

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
- **Trong giai đoạn triển khai tương lai (`S1-A`..`S1-C`):** Mỗi slice có PR và rollback plan riêng, được thử trên synthetic trước merge. Kế hoạch schema có thể dùng down-migration an toàn hoặc restore/roll-forward đã duyệt; không ép down-migration nếu làm mất mapping/audit/lịch sử. Rollback không được để endpoint hoạt động khi thiếu baseline auth/role/action/scope/audit; giữ kiểm soát hoặc tắt endpoint phụ thuộc. Mọi thao tác migration/data cần phê duyệt riêng, chưa được thực hiện ở TASK-0002.

---

## 7. Quyết định đã duyệt và bước tiếp theo

Chủ dự án đã duyệt D-08 B / D-09 A / ADR-002 v0.3 / S1-A vào 2026-11-13; nguyên văn/reference tại [approval package](../decisions/SPRINT-1-APPROVAL.md) mục 6. [TASK-0003](../../tasks/TASK-0003.md) (`S1-A`) đã được triển khai, kiểm chứng toàn bộ `AC-01`..`AC-10` trên Colima ARM64 local và GitHub Actions CI (`linux/amd64`), được nghiệm thu `ACCEPTED` và hợp nhất vào `main` qua [PR #6](https://github.com/vannhan091289-ux/baocaobanhang/pull/6) tại SHA `d8a7bd9c4b8bbebb738dd84f7369a9446e46b2dc`.

Đối với `S1-B` và `S1-C`: Chủ dự án đã phê duyệt chính thức gói đề xuất [docs/decisions/SPRINT-1-BC-PROPOSAL.md](../decisions/SPRINT-1-BC-PROPOSAL.md) v0.2 tại [docs/decisions/SPRINT-1-BC-APPROVAL-2026-11-14.md](../decisions/SPRINT-1-BC-APPROVAL-2026-11-14.md) vào ngày 2026-11-14. [TASK-0004](../../tasks/TASK-0004.md) (`S1-B`) đã được triển khai, nghiệm thu `ACCEPTED` và hợp nhất qua [PR #11](https://github.com/vannhan091289-ux/baocaobanhang/pull/11) tại SHA `52843270e7d743d14c40ad287b748847b7097994`. [TASK-0005](../../tasks/TASK-0005.md) (`S1-C`) hoàn tất chứng nhận ma trận phân quyền vét cạn, kiểm soát lọc phạm vi/tìm kiếm/phân trang chống suy diễn, biên thời gian chuyển giao quyền tuần tự, tranh chấp đồng thời trên PostgreSQL 18.7 và kiểm toán `AuditEvent` toàn diện (`AC-01`..`AC-10` `PASS`). Các quyết định `D-05` và `D-10` tiếp tục giữ trạng thái `OPEN`.
