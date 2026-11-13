# Sprint 1 — Đặc tả dự thảo và phương án cần duyệt

Status: DRAFT — chưa duyệt implementation
Version: 0.1
Prepared: 2026-11-13
Baseline: main bac54ba921aeddd37fbf19e35e11104e69a3f791; TASK-0001 ACCEPTED
Preparation task: [TASK-0002](../../tasks/TASK-0002.md), READY chỉ cho tài liệu

## Mục tiêu và ranh giới

Mục tiêu đề xuất: một người dùng được xác thực theo cơ chế doanh nghiệp được duyệt, gắn đúng nhân sự/phòng, chỉ thực hiện hành động và nhìn dữ liệu thuộc phạm vi được cấp. Ưu tiên một luồng nhỏ có thể nghiệm thu độc lập, không tạo nhiều màn hình trước khi chốt quyền.

Sự thật hiện có: scaffold và CI Sprint 0 đã nghiệm thu; chưa có auth/SSO, database, schema, cơ cấu nhân sự hoặc RBAC runtime. D-08 chưa chọn IdP/session; database/ORM chưa được duyệt; ADR-002 còn PROPOSED. Không có chính sách đăng nhập/hosting cụ thể của tổ chức được cung cấp trong repo.

Ngoài Sprint 1 dự kiến: công thức KPI/Actual/Target, Dashboard nghiệp vụ, Lead/Customer/alerts, kết nối Core Banking, AI, email/tin nhắn, đa chi nhánh và dữ liệu thật. Không dùng gói thiết kế này làm quyền code, migration hoặc deploy.

## Actors và dữ liệu tối thiểu đề xuất

Ban Giám đốc, quản lý phòng, nhân viên Cá nhân/Doanh nghiệp/DVKH và admin cấu hình theo Product baseline. Quyền cụ thể nằm duy nhất tại [ADR-002](../adr/ADR-002-authorization.md), vẫn cần phê duyệt.

Các đối tượng đề xuất để thảo luận, chưa phải schema: Department, Staff, IdentityLink và RoleAssignment. Dùng stable IDs, trạng thái active/inactive và thời gian hiệu lực khi cần; fixture synthetic, không tên/email nhân sự thật. Không tự ánh xạ quyền bằng email hoặc role do client gửi. Mapping identity và vòng đời quyền phải được chốt cùng D-08/ADR-002.

## Các luồng cần đặc tả trước implementation

| Luồng | Thành công cần đạt | Từ chối/biên phải có |
|---|---|---|
| Đăng nhập | IdP được duyệt xác thực; backend tạo phiên và xác định danh tính ứng dụng hợp lệ | Issuer/audience/token/redirect sai nếu dùng OIDC; tài khoản chưa map hoặc inactive không được tự cấp quyền |
| Phiên/logout | Đọc phiên hợp lệ; đăng xuất theo contract được duyệt | Phiên hết hạn/thu hồi, request thiếu xác thực, callback lặp; thời hạn thu hồi phải do policy quyết định |
| Cơ cấu | Xem danh mục phòng/nhân sự tối thiểu theo quyền; admin thao tác cấu hình được duyệt | ID không hợp lệ/trùng, sửa nhầm phòng, nhân sự inactive, ownership thay đổi; không lộ danh tính ngoài scope |
| Quyền | Backend kiểm tra role + action + scope trên list/detail/write | Gửi trực tiếp URL/request, sửa role phía client, thiếu quyền, khác phòng, role hết hiệu lực; UI ẩn nút không thay kiểm tra backend |
| Audit | Truy được ai làm gì, đối tượng, kết quả, thời điểm và policy version | Log không chứa token, password, full claims hoặc PII không cần thiết; failure không bị báo thành success |

HTTP/error contract, session duration, revocation window, nhiều vai trò đồng thời, người có quyền gán/duyệt role và cách chống tự nâng quyền vẫn là câu hỏi cần duyệt; không tự chọn ngầm.

## D-08 — Hai phương án đăng nhập để chủ dự án/IT chọn

| Phương án | Điều kiện | Đánh đổi |
|---|---|---|
| A — Tích hợp IdP doanh nghiệp hiện có | IT xác nhận provider, protocol, môi trường test và người cấp quyền tích hợp | Phù hợp quản lý tài khoản tập trung; phụ thuộc chính sách, metadata và quyền tích hợp do tổ chức cung cấp |
| B — IdP/test tenant được tổ chức cho phép, chỉ synthetic | Có phê duyệt môi trường test riêng và lộ trình chuyển sang IdP doanh nghiệp | Cho phép kiểm chứng contract sớm; không phải SSO production, không tự chứng minh tích hợp cơ quan đã xong |

Đề xuất của người soạn: ưu tiên A nếu tổ chức đã có IdP và cho phép tích hợp; nếu chưa, chỉ chọn B sau phê duyệt test environment. Chưa chọn provider, library, protocol cụ thể hoặc tạo tenant. Không thay bằng đăng nhập giả, password tự quản hay tài khoản tạm để lách phê duyệt SSO.

Nếu tổ chức chọn OIDC, phương án cần đối chiếu Authorization Code flow và các biện pháp bảo vệ hiện hành, gồm PKCE và validation tương ứng theo loại client; không tự viết protocol từ đầu. Nguồn đọc 2026-11-13: [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html), [OAuth Security BCP — RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html). Đây là tham chiếu kỹ thuật, không thay chính sách nội bộ hoặc xác nhận provider hỗ trợ.

## D-09 — Database/ORM cho môi trường phát triển/test

PostgreSQL hiện là định hướng kiến trúc, chưa được chấp thuận triển khai. Hai lựa chọn cùng là đề xuất:

| Phương án | Điều kiện | Đánh đổi |
|---|---|---|
| A — PostgreSQL local/test, chỉ synthetic | Chủ dự án duyệt database engine, cách chạy local/CI, version và công cụ/schema/migration | Dễ cô lập thử nghiệm, chưa cần hosting thật; vẫn cần quản lý môi trường và migration/test đúng engine |
| B — PostgreSQL test do tổ chức cung cấp | Tổ chức duyệt endpoint, network, quyền truy cập, dữ liệu và chi phí nếu có | Gần môi trường đích hơn; không được tự tạo dịch vụ, mở quyền hoặc đưa credentials lên GitHub |

Đề xuất của người soạn: A cho việc phát triển ban đầu nếu chính sách cho phép; lựa chọn B khi môi trường test được cung cấp chính thức. Chưa chốt ORM: so sánh data layer mỏng với SQL tường minh và ORM phù hợp chuẩn nhóm, chỉ thêm dependency khi được duyệt. Không tạo schema/migration trong task tài liệu.

Nếu sau này dùng RLS, nó là lớp bảo vệ bổ sung có các ngoại lệ owner/superuser/BYPASSRLS; không thay kiểm tra quyền backend. [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), đọc 2026-11-13. D-09 không đóng D-05 về hosting/phân loại dữ liệu thật.

## Phân nhỏ và thứ tự đề xuất

| Phần việc tương lai | Gate trước code | Kết quả nghiệm thu dự kiến |
|---|---|---|
| S1-A — Identity/session | D-08 và ADR-002 được ACCEPTED đầy đủ; D-09 nếu persistence cần thiết | Một luồng đăng nhập/phiên/logout và các case từ chối có bằng chứng synthetic |
| S1-B — Organization tối thiểu | ADR-002 ACCEPTED đầy đủ; D-09 và schema/migration plan được duyệt riêng | Phòng/nhân sự synthetic với validation, lịch sử cần thiết và kiểm tra scope |
| S1-C — Authorization/audit | ADR-002 được duyệt, auth/org contracts của phần trước đạt | Ma trận backend đầy đủ allow/deny, audit tối thiểu và regression tests |

Đây là cách chia để thảo luận, chưa phải task code READY; không tạo task implementation cho đến khi chủ dự án chốt scope/dependency/AC và các gate. Những phần không phụ thuộc IdP có thể đặc tả song song nhưng không được giả nhận runtime auth đã hoạt động.

## Test plan và điều kiện nghiệm thu implementation dự kiến

- Positive: danh tính được map, đang active, role hiệu lực và đúng scope thì chỉ được phép đúng action đã duyệt.
- Negative: anonymous/expired/revoked session; unknown/inactive staff; role/department giả từ client; khác phòng; admin tự nâng quyền; không được suy ra thông tin ngoài scope từ list/search/detail/write.
- Boundary: thời điểm bắt đầu/kết thúc role theo timezone đã chốt, đổi phòng hoặc thu hồi quyền trong khi phiên đang tồn tại, duplicate identity/ID và cập nhật đồng thời; quy tắc cụ thể phải được duyệt trước khi test expectation trở thành contract.
- Unit: policy decision với đầu vào/kết quả allow/deny rõ. Integration: backend và database thật đúng engine được duyệt, rollback synthetic test data. E2E: đăng nhập và một luồng xem đúng quyền; chỉ đối tượng synthetic/test tenant được cho phép.
- Giữ toàn bộ gates Sprint 0; bổ sung test theo thay đổi, không dummy coverage. Secrets/PII không xuất hiện trong fixtures/log/artifacts. Kiểm tra scan, least privilege và không self-escalation.

Nghiệm thu Sprint 1 chỉ khi từng requirement được ánh xạ test/evidence tại head SHA, không Critical/High mở và có review security độc lập phù hợp rủi ro HIGH. Không nhận PASS triển khai từ tài liệu này.

## Quyết định cần chủ dự án/IT phản hồi

1. D-08: hiện có hệ thống tài khoản doanh nghiệp nào; A hay B được phép; ai là đầu mối IT cấp môi trường/metadata và chốt session/logout/revocation policy?
2. D-09: local PostgreSQL hay môi trường test do tổ chức cấp; version/cách chạy và data layer nào được chấp thuận; ai duyệt schema/migration plan?
3. ADR-002: ai được quản trị tổ chức/gán/duyệt role, quy tắc đa vai trò và quyền quản lý phạm vi chi nhánh/phòng có được chấp thuận như đề xuất?

Không cần gửi secrets, mật khẩu, dữ liệu KH hoặc cấu hình nhạy cảm để trả lời. Chưa có câu trả lời vẫn hoàn thiện được đặc tả/phương án; chỉ implementation bị chặn.
