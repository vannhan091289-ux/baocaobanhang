# Decision register

| ID | Quyết định cần chốt | Đề xuất hiện tại | Gate |
|---|---|---|---|
| D-01 | Công thức/nguồn KPI | ACCEPTED (synthetic DEVTEST) — Option A, seven typed KPI groups/metric aggregation; not bank official policy | Development-only approval recorded [2026-11-14](decisions/SPRINT-1-BC-APPROVAL-2026-11-14.md); real data/production excluded |
| D-02 | Ghi nhận bán chéo nhiều nhân sự | ACCEPTED (synthetic DEVTEST) — Option A, attribution weights by metric, no duplicate branch counts | Development-only approval recorded [2026-11-14](decisions/SPRINT-1-BC-APPROVAL-2026-11-14.md); real data/production excluded |
| D-03 | Lịch ngày làm việc, kỳ tuần | ACCEPTED (synthetic DEVTEST) — Option A, Asia/Ho_Chi_Minh working calendar and weekly review | Development-only approval recorded [2026-11-14](decisions/SPRINT-1-BC-APPROVAL-2026-11-14.md); real data/production excluded |
| D-04 | SLA cảnh báo và escalation | ACCEPTED (synthetic DEVTEST) — Option A, configurable in-app alerts and sample test-only thresholds | Development-only approval recorded [2026-11-14](decisions/SPRINT-1-BC-APPROVAL-2026-11-14.md); real data/production excluded |
| D-05 | Dữ liệu KH và hosting | OPEN — Synthetic only | Trước real-data pilot |
| D-06 | Stack scaffold Sprint 0 và ranh giới SSO | ACCEPTED cho Sprint 0 — [ADR-001](adr/ADR-001-stack.md) v1.0; SSO/auth hoãn sang D-08 | Scaffold được mở khóa bởi [TASK-0001](../tasks/TASK-0001.md) ACCEPTED; chưa duyệt stack production |
| D-07 | Điểm tổng hợp KPI chi nhánh | ACCEPTED (synthetic DEVTEST) — no composite score, seven independent KPI group statuses | Development-only approval recorded [2026-11-14](decisions/SPRINT-1-BC-APPROVAL-2026-11-14.md); real data/production excluded |
| D-08 | SSO/auth doanh nghiệp: IdP, giao thức, session/token/logout | ACCEPTED (Scope: DEVTEST) — B: Keycloak OIDC test + profile/session tại [gói phê duyệt](decisions/SPRINT-1-APPROVAL.md) v1.0; chủ dự án duyệt 2026-11-13 | Phải duyệt cùng [ADR-002](adr/ADR-002-authorization.md) trước bất kỳ code auth/Sprint 1 (`S1-A`) nào; không chặn scaffold không auth |
| D-09 | Database engine/ORM và môi trường dev/test cho Sprint 1 | ACCEPTED (synthetic DEVTEST) — PostgreSQL + additive migration 0003 v0.2 including TIMESTAMPTZ default corrections | Development-only approval recorded [2026-11-14](decisions/SPRINT-1-BC-APPROVAL-2026-11-14.md); real data/production excluded |
| D-10 | Chuyển từ DEVTEST sang IdP doanh nghiệp/vận hành | OPEN — Đề xuất tách nghĩa vụ còn lại: IdP thật, MFA/re-auth/global logout, vận hành; D-08 DEVTEST không thay quyết định này | Phải có IT/owner approval và task riêng trước enterprise SSO; D-05 vẫn chặn real data/hosting |

## Audit, Hardening & Conformance Handover — 2026-11-15 (DEVTEST Synthetic)

- `TASK-0011` ([PR #18](https://github.com/vannhan091289-ux/baocaobanhang/pull/18), `e82e2af5d17008c0384145c2a430d9cd922fda91`), `TASK-0012` ([PR #19](https://github.com/vannhan091289-ux/baocaobanhang/pull/19), `0535756868dd7cebfe8d7e336f38965ecba50b0d`), và `TASK-0014` ([PR #21](https://github.com/vannhan091289-ux/baocaobanhang/pull/21), `d9d9e6fe88f5f710014627953d4aca72d181c1ea`) đã hợp nhất vào `main`.
- `TASK-0015` (nhánh `fix/TASK-0015-conformance-handover`) khắc phục toàn bộ phát hiện `H-01`, `H-02`, `M-01`, `M-04`, `L-01`, `L-02`, `L-03`, `M-07` và làm mới hồ sơ bàn giao `READY FOR OWNER UAT`.
- `TASK-0016` (`Status: REVIEWED`, chưa phê duyệt) theo dõi các hạng mục mở rộng `M-02`, `M-05`, `M-06`.
- `M-03` (`ADJUST_FINAL` 2-step approval theo session người duyệt thứ 2) và `TASK-0013` (`A-01`, `A-04`, `A-05`) tiếp tục chờ quyết định của chủ dự án trên Issue #8. `D-05` và `D-10` giữ nguyên trạng thái `OPEN`.

## DEVTEST approval — 2026-11-14

Chủ dự án đã duyệt [SPRINT-1-BC-PROPOSAL.md v0.2](decisions/SPRINT-1-BC-PROPOSAL.md), bao gồm phương án A cho D-01..D-04, D-07, ADR-003..005; migration 0003; mở rộng D-09/ADR-002 cho S1-B/C. [Approval record](decisions/SPRINT-1-BC-APPROVAL-2026-11-14.md) là nguồn chuẩn cho quyền DEVTEST. D-05 và D-10 **OPEN**; không chứa quyền production hoặc dữ liệu thật. Các đoạn lịch sử dưới đây phản ánh trạng thái trước phê duyệt và không ghi đè quyết định mới.

## Chuẩn bị Sprint 1 — 2026-11-13 (DOCUMENTATION_ONLY)

Chủ dự án đã chọn trực tiếp: “Chuẩn bị đặc tả Sprint 1 và phương án cần duyệt; chưa code đăng nhập/database”.

- [TASK-0002](../tasks/TASK-0002.md) chỉ cho phép thực hiện trong chế độ `DOCUMENTATION_ONLY` trên nhánh `feat/TASK-0002-sprint-1-spec` ([PR #4 đã merge](https://github.com/vannhan091289-ux/baocaobanhang/pull/4)).
- [docs/specs/SPRINT-1.md](specs/SPRINT-1.md) (`DRAFT` v0.5; S1-A DEVTEST được duyệt riêng) trình bày mục tiêu, ranh giới facts/proposals/unknowns, actors, thực thể dữ liệu tối thiểu, các luồng nghiệp vụ/từ chối, phân tích tối đa hai phương án cho `D-08` và `D-09` (kèm nguồn chuẩn chính thức đọc ngày `2026-11-13`), lộ trình chia nhỏ `S1-A`..`S1-C`, kế hoạch kiểm thử/bảo mật/rollback và câu hỏi trình duyệt.
- [docs/adr/ADR-002-authorization.md](adr/ADR-002-authorization.md) (`ACCEPTED` v0.3, Scope: DEVTEST) là nguồn chuẩn duy nhất cho mô hình phân quyền `role + action + resource + scope + effective_time`, nguyên tắc `default-deny`, tách biệt quyền `CONFIG_ADMIN` (không mặc nhiên xem dữ liệu KH, cấm tự nâng quyền), các kịch bản từ chối bắt buộc và quy tắc kiểm toán (`AuditEvent`).
- Nghiệm thu TASK-0002 trước đây không tự duyệt implementation. Phê duyệt mới của chủ dự án được ghi riêng bên dưới; lượt kích hoạt này chỉ thay tài liệu, chưa code/database/deploy.

## D-08 / D-09 / ADR-002 — phê duyệt 2026-11-13; S1-A đã ACCEPTED (PR #6), đề xuất mở khóa S1-B/S1-C & P0A..P0D

Chủ dự án duyệt D-08 B, D-09 A, ADR-002 v0.3 và phạm vi S1-A; [Gói phê duyệt](decisions/SPRINT-1-APPROVAL.md) v1.0 mục 6 là bản ghi owner/date/version/nguyên văn/reference; không phải chính sách ngân hàng hoặc quyền production. [Image manifest](decisions/SPRINT-1-IMAGES.md) là nguồn chuẩn digest theo platform. [TASK-0003](../tasks/TASK-0003.md) (`S1-A`) đã được triển khai, kiểm chứng toàn bộ `AC-01`..`AC-10`, được nghiệm thu `ACCEPTED` và hợp nhất qua [PR #6](https://github.com/vannhan091289-ux/baocaobanhang/pull/6) tại `main` SHA `d8a7bd9c4b8bbebb738dd84f7369a9446e46b2dc`.

Để mở khóa `S1-B` ([TASK-0004](../tasks/TASK-0004.md)) và `S1-C` ([TASK-0005](../tasks/TASK-0005.md)) cùng lộ trình `P0A`..`P0D` & `UAT` ([TASK-0006](../tasks/TASK-0006.md)..[TASK-0011](../tasks/TASK-0011.md)), đề xuất chi tiết về contracts, AC, additive migration `0003_s1b_org_and_role_workflow.sql` (đã khắc phục lỗi lệch múi giờ `CURRENT_TIMESTAMP AT TIME ZONE 'UTC'` trên cột `TIMESTAMPTZ` mà không sửa lịch sử migration `0001`/`0002` đã áp dụng) và phương án cho các quyết định `D-01`..`D-04`, `D-07`, `ADR-003`..`005` được trình tại [docs/decisions/SPRINT-1-BC-PROPOSAL.md](decisions/SPRINT-1-BC-PROPOSAL.md) v0.2 (trạng thái `PROPOSED` / `REVIEWED`). D-05/D-10 vẫn OPEN; chưa viết code `S1-B`/`S1-C` hay `P0A`..`P0D` trước khi task tương ứng được chuyển sang `READY`.

## D-06 — quyết định ngày 2026-11-11, version 1.0

Người phê duyệt: chủ dự án qua yêu cầu trực tiếp trong chat điều phối, được ghi lại tại [ADR-001](adr/ADR-001-stack.md) và PR #2. Chấp nhận stack đã đề xuất cho Sprint 0; hoãn SSO/auth, chỉ tạo scaffold/tooling/CI/test baseline không DB, không dữ liệu thật. Lý do: chuẩn bị nền phát triển mà không tự quyết định cơ chế xác thực doanh nghiệp. Version/toolchain/cấu trúc và giới hạn nằm tại ADR-001 làm nguồn chuẩn. [TASK-0001](../tasks/TASK-0001.md) đã được nghiệm thu `ACCEPTED` và hợp nhất tại [PR #3](https://github.com/vannhan091289-ux/baocaobanhang/pull/3).

D-08 là nghĩa vụ còn mở được tách từ D-06, không phải phê duyệt hoặc miễn kiểm soát SSO. D-01..D-05, D-07, D-09 và các ADR khác không được tự đóng bởi quyết định này.

Quyết định trọng yếu phải có người phê duyệt, ngày, version, lý do. ADR kiến trúc được tạo/duyệt riêng; tài liệu này không thay thế thẩm quyền.
