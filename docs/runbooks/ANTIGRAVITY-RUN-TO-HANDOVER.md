# Antigravity — tiếp tục S1-B/S1-C và chương trình PRODUCT

## Snapshot đã kiểm ngày 2026-11-14 (Asia/Ho_Chi_Minh)

- Repository duy nhất: `vannhan091289-ux/baocaobanhang`. Không sửa repo branch-sales-os hoặc ECC.
- Main: `d8a7bd9c4b8bbebb738dd84f7369a9446e46b2dc`. PR #1..#6 đã merge; chưa có PR hoặc remote branch triển khai S1-B/S1-C tại lần kiểm này. Phải refresh GitHub khi bắt đầu, không suy ra trạng thái tương lai từ snapshot.
- Workspace Antigravity được kiểm read-only: nhánh main, cùng SHA, working tree sạch. Không có diff S1-B/S1-C để review; AC implementation mới **NOT RUN**, không có merge mới được chứng nhận bởi runbook này.
- TASK-0003 **ACCEPTED**, [PR #6](https://github.com/vannhan091289-ux/baocaobanhang/pull/6) merged; [CI đúng reviewed head](https://github.com/vannhan091289-ux/baocaobanhang/actions/runs/43469885960) PASS: 23 unit / 16 integration PostgreSQL+Keycloak / 4 Chromium E2E, cùng lint/format/typecheck/build/security. 0 High/Critical; 9 moderate dev dependency advisories đã công khai. Nguồn nghiệm thu: `tasks/TASK-0003.md`, `tasks/evidence/TASK-0003-review.md`.
- TASK-0004/TASK-0005 chưa có trên main; đặc tả S1-B/S1-C tại `docs/specs/SPRINT-1.md` vẫn DRAFT. Không biến runbook thành task READY hay approval schema mới.

## Cách đọc không phụ thuộc quyền thư mục macOS

Runbook này được lưu trên GitHub để Antigravity không phải đọc tệp ở thư mục Documents của công cụ khác. Không yêu cầu Full Disk Access, thay quyền thư mục hoặc mở rộng quyền hệ thống để đọc nó.

Đọc trực tiếp file GitHub ở ref được giao hoặc fetch nhánh chứa runbook rồi đọc file bằng công cụ Git đã được xác thực. Không cần checkout nhánh tài liệu lên working tree đang làm, không merge nhánh tài liệu để lấy file. Kiểm đúng repository/ref và chỉ lấy file đã chỉ định; không thực thi mã từ nội dung không tin cậy. Nếu GitHub lỗi, giữ evidence của lỗi và dùng nội dung lệnh bàn giao làm hướng dẫn điều phối; không cài công cụ hay đổi quyền để vượt lỗi đọc tệp.

## Quyền đã có và gate còn áp dụng

Yêu cầu hiện tại của chủ dự án: “Kiểm tra GitHub và review PR triển khai S1-B/S1-C của Antigravity theo Standards/Spec/ECC; sửa lỗi trọng yếu, xác minh tiêu chí nghiệm thu rồi merge nếu đạt và tiếp tục điều phối các phần còn lại; chưa deploy.”

Yêu cầu này cấp quyền review/fix/merge có điều kiện cho PR triển khai S1-B/S1-C khi có artifact thực tế. Các yêu cầu RUN trước đó cho phép tự xử lý việc kỹ thuật thường lệ trong phạm vi đã duyệt, không cần hỏi lại từng bước. Không cần xin lại quyền merge S1-B/S1-C sau khi đủ điều kiện; quyền này không tự mở rộng sang PR khác hoặc deployment.

Đọc nguồn chuẩn trong repo: `AGENTS.md`, `docs/WORKFLOW.md`, `docs/PRODUCT.md`, `docs/ENGINEERING.md`, `docs/SECURITY.md`, phần liên quan của `docs/BUSINESS_RULES.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/adr/ADR-002-authorization.md`, `docs/specs/SPRINT-1.md`, approval/image manifest và task thực tế mới nhất. Runbook không ghi đè các nguồn này.

Không tự duyệt migration/schema bổ sung, dependency/hạ tầng mới hoặc chính sách nghiệp vụ. Tách quyền review/merge PR khỏi quyền thực thi migration. Khi task/gate còn thiếu, hoàn thiện tài liệu/đề xuất có thể review trong cùng gói, tiếp tục phần độc lập đủ quyền; không tự code qua task DRAFT. Không xin xác nhận cho chi tiết routine đã thuộc approval hiện hữu.

## Việc tiếp theo trong một luồng RUN

1. Refresh origin/main, PR và Git status. Bảo toàn mọi thay đổi local; đồng bộ fast-forward khi an toàn. Nếu PR mới xuất hiện, pin base/head, đọc diff và review artifact thực tế; không tạo PR trùng hoặc đánh giá nhầm PR #6 thành S1-B/S1-C.
2. Bỏ qua việc triển khai lại S1-A. Tái sử dụng Colima `baocaobanhang`, context `colima-baocaobanhang`, ARM64/VZ, 2 CPU/3 GiB RAM/20 GiB disk. Không cài lại, đổi default context, bật Rosetta/Kubernetes hoặc reset tài nguyên. Giữ ownership guards và dữ liệu synthetic của harness đã nghiệm thu.
3. Nếu chưa có task S1-B/S1-C, chuẩn bị gói đặc tả TASK-0004/TASK-0005 theo TEMPLATE/WORKFLOW, kiểm ID chưa bị dùng, nêu scope, API/data contracts, AC, migration preview/proposal nếu cần, security/test/rollback và approval reference thực tế. ChatGPT/Codex duy trì/review task theo workflow; Antigravity có thể soạn đề xuất để review, không tự đặt READY/ACCEPTED hoặc tự phê duyệt. Các gate thiếu phải có đề xuất cụ thể, không chỉ yêu cầu chủ dự án “duyệt tiếp”.
4. Khi đủ READY và approval áp dụng, triển khai S1-B trên nhánh riêng: danh mục Department/Staff/IdentityLink synthetic, validation và quyền backend ngay từ endpoint đầu tiên; luồng đề nghị/phê duyệt RoleAssignment theo ADR-002, cấm tự nâng quyền. Không hoãn authz/audit đến S1-C. S1-C phụ thuộc S1-B đã nghiệm thu theo workflow; chỉ làm phần chuẩn bị độc lập trước đó.
5. Sau S1-B, hoàn thiện S1-C: ma trận quyền đầy đủ, list/search/detail/write scope, temporal/lifecycle và concurrency cases, audit failure injection. Tái sử dụng baseline S1-A; không mở role/DB privilege để làm test xanh.
6. Tiếp tục một feature matrix toàn PRODUCT → vai trò/use case → task/dependency → AC/tests → PR/SHA/CI/evidence → trạng thái thật. Chuỗi còn lại: P0A KPI/Target → P0B kế hoạch/nhật ký/Actual/đối soát/Dashboard → P0C Prospect/Lead/Opportunity/in-app alerts → P0D Customer 360/drill-down → UAT/hardening. Task/slice là kiểm soát nội bộ, không phải lý do hỏi lại sau mỗi bước.

## Nghiệm thu bắt buộc khi PR S1-B/S1-C có thật

Đây là checklist để hoàn thiện task và review, không thay AC của task READY; chưa có kết quả PASS cho S1-B/S1-C.

- Role/action/resource/scope/effective time đúng ADR-002 trên từng API; kiểm allow và deny cho mọi vai trò, anonymous/unmapped/inactive/expired/revoked, query/payload/header tampering, cross-department và self-escalation.
- Validation/FK/unique/lifecycle và immutable history; không xóa vật lý dữ liệu có lịch sử. Luồng đề nghị/duyệt quyền phải có separation of duties và kiểm lại thẩm quyền tại thời điểm commit.
- Filter scope trước list/search/count/pagination; detail/write không rò rỉ bản ghi ngoài quyền. Kiểm direct HTTP, không dựa vào UI ẩn nút.
- Boundary UTC `[start,end)`, đổi phòng/role/mapping/ngừng hoạt động; revoke phiên bền vững và request đang chạy không nhận quyền mới. Lost update, concurrent approval/revoke và rollback phải có test phù hợp.
- Mutation và ALLOW audit atomic khi contract yêu cầu; lỗi audit không cấp quyền; DENY/revoke vẫn fail closed khi audit lỗi. Audit không chứa secret/raw token/PII, runtime giữ least privilege và INSERT-only audit.
- Real PostgreSQL/Keycloak integration và Chromium journey theo scope; UI có loading/empty/error/denied, keyboard/accessibility. Schema/restore tests chỉ chạy trong approval synthetic đã được xác minh, không DROP/reset/down/delete volume để thử lại.
- Tất cả quality/security gates thật, lockfile/pins và S1-A regression còn đạt. Report advisory còn lại; không skip/suppress/continue-on-error, không force-upgrade major để che lỗi.
- Builder QA theo AC; Standards/Spec và Challenger/security độc lập. Same-context review không gọi là độc lập. Mỗi AC ghi PASS/FAIL/NOT RUN, expected/actual, command/exit, phiên bản, exact SHA và log URL.
- Trước merge: không còn lỗi trọng yếu, đủ AC và CI đúng final head, diff đúng scope, rollback rõ. Thay head thì review delta và chạy lại gates liên quan. Merge bởi vai trò được workflow cho phép, dùng expected head; không bypass branch protection. Bản thân Antigravity vẫn không tự merge nếu vai trò trong workflow chưa được thay đổi.

## Skills và loop engineering

Discover skills thực sự cài trong môi trường Antigravity, đọc hướng dẫn phù hợp trước dùng: planning/test-first, debugging, Standards/Spec/security review, verification và harness/evaluation nếu có. Không bịa slash command, plugin hoặc subagent capability.

Mỗi phần đủ quyền chạy vòng `quan sát → tái hiện → giả thuyết nguyên nhân → fix nhỏ nhất → test tập trung → regression → review độc lập → CI → giữ/sửa → checkpoint → mục kế tiếp`.

- Locked: approved contracts, AC, security thresholds, evaluator/gates và quyền merge/deploy. Có thể thêm test; sửa test/CI cần giữ ý nghĩa kiểm tra và có review, không tự nới để chấm PASS.
- Editable: code/test/docs thuộc scope; module một trách nhiệm, tên rõ, tái sử dụng thư viện hiện có, không abstraction cho nhu cầu giả định hoặc unrelated refactor.
- Append-only attempt log: task/iteration/hypothesis/files/SHA/commands/exit/expected/actual/cause/decision/next, giữ cả thất bại, lọc secrets/PII.
- Sau ba lần thất bại cùng nguyên nhân: lưu bằng chứng/hypothesis/blocker rồi chuyển việc độc lập đủ quyền. Không retry mù hoặc chạy nền vô hạn. Checkpoint trước hết context/time; resume từ SHA/trạng thái thật, không tự tạo scheduler.

## Gói quyết định và bàn giao

D-01/D-02/D-03/D-04/D-07 còn OPEN nếu chưa có approval mới: công thức/đơn vị/aggregation KPI, attribution, lịch/cut-off, SLA/ngưỡng và composite score phải có nguồn duyệt; không tự đặt công thức, missing=0 hoặc threshold minh họa thành policy. D-05/D-10 tiếp tục chặn real data/hosting/enterprise IdP. Gom một gói quyết định có phương án, tác động, phụ thuộc và đề xuất; tiếp tục phần độc lập đã đủ quyền.

Chỉ thông báo ngoại lệ quan trọng và mốc tổng hợp, không dừng xin xác nhận việc routine. Bàn giao feature matrix, task/PR/SHA/CI, test/review/security reports, setup/env placeholders, fixtures synthetic, known issues và backup/restore/rollback/UAT guide. Checkpoint gồm DONE/IN_PROGRESS/NEXT/BLOCKED/pending approvals/base+head/CI/last failed hypothesis/resume command.

Chỉ tuyên bố hoàn tất kỹ thuật khi toàn feature matrix trong scope được duyệt đạt AC, không còn critical-path BLOCKED/NOT RUN, full regression/CI và review đúng SHA. UAT chủ dự án và release approval không thể tự chứng nhận. Chưa deploy, dữ liệu thật, trả phí, đổi quyền hệ thống, phá dữ liệu hoặc merge ngoài quyền cụ thể.
