# Gói phê duyệt DEVTEST — D-08 / D-09 / ADR-002

Status: ACCEPTED
Scope: DEVTEST — chỉ S1-A local/CI synthetic; không production hoặc IdP thật
Version: 1.0
Prepared: 2026-11-13
Baseline: main b04b69d1c63ae9f0a9aa525944c15056efe76ef0, TASK-0002 ACCEPTED
Approved by / date / approval reference: Chủ dự án — chỉ dẫn trực tiếp trong chat điều phối, 2026-11-13; bản ghi nguyên văn tại docs/decisions/SPRINT-1-APPROVAL.md mục 6, PR #5
Approved scope: S1-A trong Sprint 1, chỉ local/CI + synthetic; không production hoặc IdP doanh nghiệp thật

## 1. Lựa chọn đã được chủ dự án duyệt

| Quyết định | Đề xuất cụ thể | Phương án thay thế và khi dùng |
|---|---|---|
| D-08 | B: Keycloak local/CI làm IdP OIDC test; app dùng Authorization Code + PKCE S256, state, nonce; openid-client phía server | A: IdP doanh nghiệp non-prod nếu IT đã cung cấp/cho phép. Khi đó phải sửa profile, metadata và test contract; không đoán provider/credentials |
| D-09 | A: PostgreSQL 18.7 local/CI ephemeral, pg + SQL tham số hóa, node-pg-migrate; chưa ORM | B: DB test tổ chức cấp nếu policy bắt buộc; cần endpoint/quyền/network và approval riêng. Không tự tạo dịch vụ ngoài |
| ADR-002 | Một role assignment hiệu lực mỗi người ở Sprint 1; role/action/scope từ DB, default-deny; quyền cấu hình tách quyền nghiệp vụ | Multi-role/union không chọn ở Sprint 1 để giảm khả năng cộng quyền ngoài ý muốn. Muốn mở cần sửa ADR và bộ test trước |

Chủ dự án duyệt D-08 B, D-09 A, ADR-002 v0.3 và phạm vi S1-A theo bản ghi mục 6. Đây là contract DEVTEST của dự án, không phải chính sách ngân hàng đã cung cấp hoặc nghiệm thu SSO doanh nghiệp. D-08/D-09 và ADR-002 ACCEPTED chỉ với Scope: DEVTEST; D-10 và D-05 vẫn OPEN cho IdP thật/MFA/re-auth/global logout/real-data/hosting. Các phương án thay thế trong bảng chỉ lưu lý do, không được tự chuyển sang.

## 2. D-08 — Profile identity/session được duyệt

- IdP test: Keycloak, realm branch-sales-dev, confidential web client branch-sales-web. Giữ tách realm quản trị; không dùng master realm cho app. Không dùng fake login, role picker không xác thực hoặc password hardcode trong ứng dụng.
- Protocol: Authorization Code + PKCE S256 + state + nonce cho mỗi lần đăng nhập. Issuer, client/audience, callback và post-login destination từ cấu hình server allowlist; không lấy issuer từ request/client. Return destination chỉ /workspace trong S1-A.
- Mặc định local/CI: app origin http://127.0.0.1:3100; issuer http://127.0.0.1:8080/realms/branch-sales-dev. Callback cố định /auth/callback. Bind cổng host vào loopback; không expose ra LAN/Internet. Hỗ trợ HTTP chỉ khi APP_ENV=dev hoặc test, origin/issuer thuộc loopback allowlist; ngoài profile này app phải fail closed. NODE_ENV=production dùng cho local production build không phải quyền production release.
- openid-client làm discovery, exchange và validation theo metadata/profile đã pin; không tự viết JWT/OIDC verifier. Kiểm tra issuer/audience/signature/expiry, state/nonce/PKCE và callback một lần; không tự tạo Staff hoặc gán role từ claims. Mapping theo iss + sub, không theo email.
- Chỉ cấp phiên nếu IdentityLink và Staff ACTIVE, đúng một RoleAssignment hiệu lực và scope hợp lệ. Unknown, inactive, không role hoặc nhiều role đồng thời đều DENY.
- Phiên app: opaque random token tối thiểu 256 bit; DB chỉ lưu hash token. Cookie HttpOnly, SameSite=Lax, Path=/, không Domain; Secure bắt buộc khi HTTPS. Ngoại lệ Secure=false chỉ cho loopback HTTP ở profile DEVTEST trên; không dùng cookie __Host- khi không Secure. Token/claims không vào localStorage hoặc client bundle.
- Timeout được duyệt: idle 15 phút, absolute 8 giờ, auth transaction 5 phút/one-use. Tính giờ ở server bằng UTC và test đúng biên [start,end); refresh phiên không kéo dài absolute expiry.
- Mỗi protected request đọc trạng thái session/identity/staff/role từ DB, không cache quyết định ALLOW. Quyền bị thu hồi/người dùng inactive bị từ chối từ lần kiểm tra request kế tiếp sau khi thay đổi đã commit; không chờ JWT hết hạn. Lệnh ghi tương lai phải kiểm tra quyền trong transaction phù hợp, không dựa vào UI.
- Logout S1-A: POST có CSRF và Origin kiểm tra; revoke app session bền vững rồi xóa cookie. Chỉ cam kết logout khỏi app. Không cam kết hủy SSO session toàn IdP; giao diện nói rõ phiên ứng dụng đã đóng, lần login sau vẫn phải qua OIDC và mapping/role hiện hành. Global logout/MFA/re-auth doanh nghiệp thuộc D-10.
- CSRF: login state/nonce ràng buộc với browser transaction; callback atomic consume, replay bị từ chối. Logout không cho GET mutation; Origin phải khớp app và có CSRF token. Auth-start có throttle 30 lần/phút/IP trực tiếp ở profile một Node DEVTEST; không tin X-Forwarded-For tùy ý. Không coi throttle này là thiết kế production.
- Secrets IdP/bootstrap/client/encryption sinh ngẫu nhiên riêng mỗi môi trường/run, mask trong CI, lưu local ở file ignored nếu cần; không GitHub secrets mới hoặc mật khẩu mặc định. AuthTransaction lưu verifier server-side, mã hóa AES-256-GCM bằng node:crypto (key 256 bit ở env, IV ngẫu nhiên 96 bit, auth tag kiểm tra); không lưu token IdP lâu dài, không log verifier/cookie/state/code/claims. Key/ciphertext không cùng nơi lưu; transaction hết hạn/đã dùng phải được dọn.

## 3. D-09 — Database, quyền và migration plan được duyệt

- PostgreSQL 18.7 cho app, môi trường local/CI chỉ synthetic, DB project riêng. Port host dự kiến 127.0.0.1:55432; phát hiện xung đột thì dừng, không thay thế database/container của người khác. Không bind DB công khai, không mount dữ liệu thật.
- Dùng pg, query tham số hóa và các hàm repository nhỏ theo nhu cầu; không generic repository/ORM/event bus/Redis. SQL identifier cố định/allowlist, không nối input thành SQL. Migrations có version, thực hiện bằng node-pg-migrate ở bước riêng; không auto migrate khi app khởi động.
- Tách migrator/seed role với runtime role. Runtime không superuser, không BYPASSRLS, không sở hữu bảng và không quyền DDL. Trong S1-A: runtime chỉ đọc Department/Staff/IdentityLink/RoleAssignment; DML cần thiết cho Session/AuthTransaction và INSERT AuditEvent, không UPDATE/DELETE audit. Gán/đổi role và Org CRUD chưa có endpoint ở TASK-0003.
- Cho phép đề xuất migration local/CI ở TASK-0003 chỉ sau khi chủ dự án duyệt rõ gói schema/rollback này và task READY. Không coi duyệt engine là tự động duyệt mọi migration tương lai. Không chạy SQL/migration trong lượt chuẩn bị hiện tại.

### Schema tối thiểu được duyệt cho S1-A — chưa có file SQL được thực thi

| Bảng | Trường/contract tối thiểu | Kiểm soát |
|---|---|---|
| Department | ID, code, name synthetic, status | Stable ID, code unique; ba phòng KHCN/KHDN/DVKH; không xóa lịch sử nhân sự |
| Staff | ID, staff_code, display_name synthetic, department_id, status | FK Department; không dữ liệu nhân sự thật |
| IdentityLink | ID, issuer, subject, staff_id, status | Unique (issuer,subject), map đúng một Staff; S1-A một identity ACTIVE cho Staff, không tự link theo email |
| RoleAssignment | ID, staff_id, role_code, scope_type, scope_department_id, effective_from/to, status, approval reference | Interval [from,to), to null = chưa có ngày hết; đúng một assignment hiệu lực mới ALLOW; nhiều assignment là DENY, không chọn tùy tiện |
| Session | token_hash, staff/link/assignment IDs, created_at, last_seen_at, absolute_expires_at, revoked_at/reason, CSRF binding | Token không plaintext; phiên ràng buộc assignment đã xác thực; chuyển role/phòng không tái dùng phiên cũ |
| AuthTransaction | opaque transaction reference, browser/state/nonce binding, encrypted verifier+IV/tag, expiry, consumed_at | TTL 5 phút, một lần, consume nguyên tử; không tiết lộ secret trong response/log |
| AuditEvent | event/time UTC, actor reference, action, resource reference, decision/reason, policy version | Append-only đối với runtime role; không token/cookie/full claims/PII thật |

Session và AuthTransaction là hai bảng kỹ thuật bổ sung cho năm khái niệm nghiệp vụ đã đề xuất, không thêm phân hệ sản phẩm. UUID/timestamps UTC, FK/unique/check constraints cần thiết; không thêm extension PostgreSQL khi chưa chứng minh và được duyệt.

### Audit và failure semantics

Login thành công phải ghi session + audit nhất quán; nếu không ghi được audit thì không cấp phiên. Deny không bao giờ trở thành ALLOW vì audit lỗi. Logout/thu hồi không được khôi phục phiên hoặc giữ quyền chỉ vì audit lỗi: lưu revoke/reason bền vững trước, rồi ghi AuditEvent; khi audit ghi lỗi phải có error code an toàn để truy vết, không log secret và không trả giả rằng audit đã thành công. S1-A không cần queue/outbox tổng quát.

### Migration/rollback boundary

Chỉ tạo schema project mới trên DB synthetic đã xác minh. Cần refusal test cho DB/profile không được allowlist. Migrator giữ lịch sử migration; preview/review SQL trước chạy. CI kiểm tra up trên DB trống và chạy lại không tạo thay đổi ngoài dự kiến. Rollback code phải giữ guard hoặc dừng endpoint. Restore/roll-forward được kiểm thử trên bản sao synthetic riêng, chứng minh giữ mapping/audit; không mặc định down/drop bảng khi rollback. Không cho phép xóa volume, drop DB/schema hoặc reset dữ liệu đang có trong lệnh task này; nếu cần thì xin phê duyệt riêng.

## 4. ADR-002 — Phạm vi được duyệt cùng gói

Ma trận quyền và field scope nằm duy nhất ở [ADR-002](../adr/ADR-002-authorization.md). Đã duyệt: một role hiệu lực/Staff, không union; CONFIG_ADMIN đề nghị thay đổi quyền của người khác và EXECUTIVE phê duyệt, không tự đề nghị/phê duyệt quyền cho mình. TASK-0003 chưa xây workflow cấp quyền này, chỉ seed synthetic và thực thi policy deny.

Bootstrap DEVTEST tạo hai identity synthetic riêng (EXECUTIVE và CONFIG_ADMIN), cùng fixtures manager/staff của ít nhất hai phòng, bằng migrator/seed step có cấu hình sinh secret ngẫu nhiên; không endpoint bootstrap hoặc auto-admin khi user lần đầu login. Không áp dụng bootstrap này cho tổ chức thật.

Đổi phòng: kết thúc assignment cũ, revoke mọi phiên app của Staff, assignment mới chỉ hiệu lực sau phê duyệt; không carry-over quyền phòng cũ. HTTP: 401 cho chưa xác thực/phiên không hợp lệ; 403 khi danh tính hợp lệ nhưng action không được phép; 404 cho lookup ID không tồn tại hoặc ngoài scope, cùng error envelope để hạn chế dò dữ liệu. Các giá trị này đã được duyệt cho DEVTEST.

## 5. Version pins được duyệt — metadata đã đọc, chưa install/audit/runtime

| Thành phần mới | Approved pin | Nguồn chính thức |
|---|---|---|
| Keycloak | 26.8.2, image quay.io/keycloak/keycloak | [Release](https://github.com/keycloak/keycloak/releases/tag/26.8.2), [container guide](https://www.keycloak.org/server/containers) |
| PostgreSQL | 18.7, official postgres image | [Release](https://www.postgresql.org/docs/release/18.7/) |
| openid-client | 6.8.9, runtime | [Metadata](https://registry.npmjs.org/openid-client/6.8.9), [project](https://github.com/panva/openid-client) |
| pg | 8.23.1, runtime | [Metadata](https://registry.npmjs.org/pg/8.23.1), [parameterized queries](https://node-postgres.com/features/queries) |
| server-only | 0.0.1, runtime marker | [Metadata](https://registry.npmjs.org/server-only/0.0.1), [Next server/client boundary](https://nextjs.org/docs/app/getting-started/server-and-client-components#preventing-environment-poisoning) |
| node-pg-migrate | 9.0.0, dev | [Metadata](https://registry.npmjs.org/node-pg-migrate/9.0.0), [v9 README](https://github.com/salsita/node-pg-migrate/blob/v9.0.0/README.md) |
| @types/pg | 8.23.1, dev | [Metadata](https://registry.npmjs.org/@types%2fpg/8.23.1) |

Giữ Node/Next/TS/tooling đã duyệt ở ADR-001; engines của các pins phù hợp Node 24 theo metadata, chưa chứng minh cài đặt/tương thích hoặc không có vulnerability. Docs migration site mặc định đang hiển thị 10 alpha; implementation phải dùng tài liệu phiên bản 9 đã pin. Không beta/alpha, không latest/caret, không nâng major hoặc thêm library khác để lách lỗi.

Official image tags/index/child digests đã chốt trong [image manifest](SPRINT-1-IMAGES.md) bằng HTTPS Registry V2 metadata, SHA-256 và digest-addressed reread; không tải layers hoặc chạy container. Đây là nguồn chuẩn duy nhất cho digest theo platform. Sau READY, dependency resolution/lockfile và image digest phải được ghi đúng nguồn; lỗi tương thích/security cần patch/minor cùng major có giải thích và review, không --force/legacy-peer-deps/suppress. Không High/Critical chưa xử lý; các moderate phải báo rõ, không xóa khỏi evidence.

Nguồn chuẩn auth đối chiếu 2026-11-13: [OIDC Core](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation), [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html#section-2.1.1); crypto dùng [Node 24 API](https://nodejs.org/docs/latest-v24.x/api/crypto.html). Các timeout/roles/môi trường là lựa chọn DEVTEST do chủ dự án duyệt, không được gọi là yêu cầu ngân hàng hoặc mặc nhiên do các chuẩn quy định.

## 6. Bản ghi phê duyệt thực tế — 2026-11-13

Người duyệt: Chủ dự án, chỉ dẫn trực tiếp trong chat điều phối cho repo vannhan091289-ux/baocaobanhang; tham chiếu GitHub [PR #5](https://github.com/vannhan091289-ux/baocaobanhang/pull/5). Đối tượng được duyệt: gói v0.1 tại a5602ee0dff9e95e895d5f53891b1149aa7baf1d và ADR-002 v0.3; v1.0 này ghi nhận approval/digests, không đổi chính sách đã duyệt.

> Tôi duyệt D-08 B, D-09 A, ADR-002 v0.3 và phạm vi S1-A. Chốt image digests, hoàn thiện các gate, chuyển TASK-0003 sang READY, review và merge PR #5 rồi viết lệnh ngắn giao Antigravity; chưa code hay deploy.

- [x] D-08 B: Keycloak test + profile/session/logout DEVTEST của mục 2.
- [x] D-09 A: PostgreSQL/SQL driver/migration tooling, bảy bảng và migration/rollback local/CI synthetic được giới hạn tại mục 3; không destructive down/drop/reset.
- [x] ADR-002 v0.3: một role hiệu lực, field/error contract, maker-checker/bootstrap synthetic; không gán quyền thật.
- [x] Dependency versions của gói, image digests được chốt theo chỉ dẫn hiện tại; chỉ sử dụng container runtime đã có và được phép. Không được suy ra quyền cài global/mua dịch vụ hoặc rằng runtime hiện đã tồn tại.
- [x] D-10 và D-05 vẫn OPEN; không enterprise SSO/real data/production trong TASK-0003.
- [x] TASK-0003 chỉ S1-A; S1-B/C cần task riêng sau nghiệm thu. Chủ dự án cho phép review và merge PR tài liệu #5; không cho phép code/deploy ở lượt kích hoạt này.

## 7. Gate tài liệu và điều kiện môi trường thực thi

Approval/ADR/schema/scope đã có; official image manifest đã chốt, TASK-0003 READY về đặc tả và thẩm quyền. READY trên main chỉ có hiệu lực sau PR #5 được review/CI/merge đúng head, không phải xác nhận AC runtime đã đạt hoặc cho phép bỏ preflight. Hiện AC-01..10 implementation đều NOT RUN.

**Môi trường Antigravity:** báo cáo người dùng cung cấp cho biết máy local chưa có docker/podman/colima/orbstack. Kiểm tra read-only ở máy điều phối cũng không tìm thấy executable/runtime app; chưa thử daemon vì không có executable. Không ghi gate này PASS. Antigravity phải kiểm tra lại đúng execution host; thiếu runtime hoặc daemon không dùng được thì dừng execution và báo BLOCKED, không code/cài package/pull/chạy container/seed/migrate. Không tự cài global, đổi sang DB/cloud/IdP khác, dùng giả lập hoặc nới test để vượt gate.

Docker/Podman đã được phép dùng trên một môi trường sẵn có có thể đáp ứng preflight; việc cài runtime mới/global hoặc chuyển sang dịch vụ ngoài cần chỉ dẫn riêng. Không chạy CI auth/database mới trong PR tài liệu; CI hiện tại chỉ kiểm tra baseline Sprint 0. Không có quyền code/deploy trong lượt hiện tại.
