# Conformance & Independent Review Report — Branch Sales OS V3.0

- **Task:** `TASK-0015` (Giai đoạn A–E hoàn tất kiểm chứng)
- **Main SHA tại thời điểm rà soát:** `d9d9e6fe88f5f710014627953d4aca72d181c1ea` (đã merge `TASK-0014` PR #21; CI `main` PASS: `https://github.com/vannhan091289-ux/baocaobanhang/actions/runs/43674516734`)
- **Môi trường xác minh:** Node `v24.22.2`, npm `11.19.1`, Docker `29.5.2` (Colima profile `baocaobanhang`)
- **Trạng thái hiện tại:** `READY FOR OWNER UAT` (Giai đoạn B–D đã hoàn tất trên nhánh `fix/TASK-0015-conformance-handover`; A5 Independent Review `VERDICT: PASS` với `0 Critical, 0 High, 0 P1, 0 P2`).

---

## 1. Xác minh các sai lệch đã biết (`A3(a)` .. `A3(d)`)

### A3(a) Lệnh `npm run` trong tài liệu `.md` không tồn tại trong `package.json`
Qua quét toàn bộ `*.md`, `docs/**/*.md`, `tasks/**/*.md` đối chiếu với `package.json#scripts`:
- **`docs/runbooks/DEVTEST-OPERATIONS-AND-BACKUP.md:20-21`:** trước khi sửa dùng script `env:test:up` và `env:test:migrate` (KHÔNG tồn tại trong `package.json`; tên đúng là `npm run env:test:start` và `npm run db:migrate:up`).
- **`docs/runbooks/UAT-HANDOVER-REPORT.md:31`:** trước khi sửa dùng `env:test:up && env:test:migrate` (KHÔNG tồn tại trong `package.json`).
- Toàn bộ lệnh `npm run` trong `README.md`, `tasks/TASK-0001..0012.md`, `tasks/evidence/*.txt` khớp `package.json`.

### A3(b) Sai lệch trạng thái bàn giao trong `UAT-HANDOVER-REPORT.md` & `README.md`
- `docs/runbooks/UAT-HANDOVER-REPORT.md:4,22`: tiêu đề Baseline chỉ ghi `TASK-0001`..`TASK-0011` (`feat/TASK-0011-uat-hardening-handover`) và ghi `TASK-0011` là `"Pending PR"`, trong khi thực tế `TASK-0011` đã merge qua PR #18 (`e82e2af`), `TASK-0012` đã merge qua PR #19 (`0535756`), và `TASK-0014` đã merge qua PR #21 (`d9d9e6f`).
- `README.md:3`: vẫn ghi trạng thái ở mức Sprint 1 (`TASK-0003`..`TASK-0005` hoàn tất, sẵn sàng triển khai `P0A`..`P0D`), chưa cập nhật đã hoàn tất `P0A`..`P0D`, `TASK-0011`, `TASK-0012`, `TASK-0014` ở phạm vi `DEVTEST`.

### A3(c) Xác minh SHA `b04b69d1c63ae9f0a9aa5259446e46b838476ef0` (PR #4, `TASK-0002`)
- Đối chiếu trực tiếp trên GitHub (`gh pr view 4 --json mergeCommit,commits`) và lịch sử git đầy đủ cục bộ (`git log --grep="TASK-0002"`):
  - `b04b69d1c63ae9f0a9aa5259446e46b838476ef0` **CHÍNH XÁC LÀ** `mergeCommit.oid` của PR #4 (`Merge PR #4: accepted TASK-0002 documentation and Sprint 1 decision options`, merged `2026-11-13T13:26:06Z`).
  - Nguyên nhân lần rà soát trước không thấy trong git cục bộ là do clone nông (`shallow clone`), không phải lỗi chép hay bịa SHA.

### A3(d) Trạng thái các hạng mục audit trước (`TASK-0013` & `TASK-0014`)
- **`A-02`, `A-03`, `A-06`, `A-08`:** Đã xử lý đầy đủ qua `TASK-0014` (PR #21, merged vào `main` tại `d9d9e6fe88f5f710014627953d4aca72d181c1ea`).
- **`A-01`, `A-04`, `A-05`:** Đang ghi nhận `BLOCKED` chờ quyết định chủ dự án tại `tasks/TASK-0013.md` trên nhánh `fix/TASK-0013-audit-hardening-2` (Draft PR #22) và Issue #8 (`#issuecomment-6888762647`). **Lưu ý:** trên `main` hiện tại chưa có `tasks/TASK-0013.md` vì PR #22 đang ở trạng thái Draft chờ quyết định. Không tự sửa trong `TASK-0015`.
- **`A-07`:** 10 cảnh báo mức `moderate` ở devDependencies (`glob`/`minimatch`) chỉ theo dõi, không nâng cấp.

---

## 2. Kết quả rà soát độc lập 4 service lớn (`A3(e)`)

Thực hiện bởi subagent đọc độc lập (A5 Reviewer, khác người triển khai), kiểm tra từng dòng `src/server/kpi/p0a-service.ts`, `src/server/planning/p0b1-service.ts`, `src/server/pipeline/p0c-pipeline-service.ts`, `src/server/kpi/p0b2-service.ts` và 13 API route gọi chúng qua `handleApi`:

1. **`p0a-service.ts`:**
   - **High (`H-01`, dòng 2170-2219, `approveKpiTarget`):** Kiểm tra Separation of Duties (`row.proposed_by_staff_id === current.staff_id`) ở dòng 2203 chỉ nằm trong nhánh `if (currentRole === "DEPARTMENT_MANAGER")`. `EXECUTIVE` gọi `authorize()` ở dòng 2090 trước khi đọc DB nên không truyền `proposerStaffId` và không bị chặn tự phê duyệt chỉ tiêu do chính mình đề xuất.
   - **Low (`L-01`, dòng 1681-1705, `createKpiTarget`):** Truy vấn `parent_target_id` không lọc theo `department_id`, cho phép liên kết tới `parent_target_id` của phòng khác.
   - AuditEvent, chặn `CONFIG_ADMIN` (403), không trả dữ liệu KH, không tin scope từ client: **ĐẠT**.
2. **`p0b1-service.ts`:**
   - **Medium (`M-01`, dòng 1915-1930, `createMondayReviewOrDirective` nhánh `create_directive`):** Không kiểm tra `review.department_id` đối với `DEPARTMENT_MANAGER`, cho phép gắn `directive_task` vào `monday_review` của phòng khác.
   - **Medium (`M-04`, dòng 227-228 & 1095, `resolveWeekBoundsVn`):** Dùng khoảng đóng `[Mon 00:00:00.000+07:00, Sun 23:59:59.999+07:00]` với `<=` thay vì khoảng nửa mở `[Mon 00:00, next Mon 00:00)` (`<`).
   - AuditEvent, kiểm tra vai trò, không rò rỉ KH ngoài phạm vi, không tin scope từ client: **ĐẠT**.
3. **`p0c-pipeline-service.ts`:**
   - **Low (`L-02`, dòng 866-883 & 1373-1391, `createLead` & `createOpportunity`):** Không kiểm tra `prospect_id` / `lead_id` tham chiếu có thuộc phạm vi `department_id` / `owner_staff_id` của actor hay không.
   - Kiểm tra vai trò, AuditEvent, phạm vi `customer_ref` & `CONFIG_ADMIN` 403, đối chiếu scope: **ĐẠT**.
4. **`p0b2-service.ts`:**
   - **High (`H-02`, dòng 1018-1042, `reconcileKpiActual` nhánh `ADJUST_FINAL`):** Truy vấn role của `approved_by_staff_id` thiếu `ra.status = 'ACTIVE' AND ra.effective_from <= CURRENT_TIMESTAMP` (và kiểm tra `effective_to`), đồng thời không kiểm tra `s.department_id === existing.department_id` nếu `approverRole === 'DEPARTMENT_MANAGER'`.
   - **Medium (`M-02`, dòng 1214-1260, `getDashboardOverview`):** 4 câu SQL tải toàn bộ `kpi_targets`, `kpi_actual_records`, `staff`, `departments` của chi nhánh vào Node.js trước khi lọc JS (thiếu lọc `WHERE` ở tầng SQL cho `DEPARTMENT_MANAGER`/`STAFF`).
   - **Medium (`M-03`, dòng 885-891 & 1018-1068, `reconcileKpiActual` nhánh `ADJUST_FINAL`):** Tin `approved_by_staff_id` do client gửi trong `body` mà chưa tách luồng phê duyệt 2 bước theo session người duyệt thứ 2.
   - AuditEvent, chặn `CONFIG_ADMIN` 403, không trả dữ liệu KH: **ĐẠT**.

---

## 3. Bảng tổng hợp phát hiện phân loại (`A4`)

| Mã | Mức độ | Tệp & dòng liên quan | Mô tả vấn đề | Cách khắc phục đề xuất | Trạng thái xử lý |
|---|---|---|---|---|---|
| `H-01` | **High** | `src/server/kpi/p0a-service.ts:2218-2233` | `approveKpiTarget` bỏ sót kiểm tra `proposed_by_staff_id === current.staff_id` khi actor là `EXECUTIVE` | Áp dụng kiểm tra SoD `proposed_by_staff_id === current.staff_id` cho mọi vai trò (kể cả `EXECUTIVE`) + bổ sung integration test | **ĐÃ SỬA (`TASK-0015`)** |
| `H-02` | **High** | `src/server/kpi/p0b2-service.ts:1018-1106` | `reconcileKpiActual` (`ADJUST_FINAL`) không kiểm tra `ra.status = 'ACTIVE'`, `effective_from <= CURRENT_TIMESTAMP` và `department_id` của `DEPARTMENT_MANAGER` approver | Bổ sung điều kiện hiệu lực role & phòng ban trong SQL + `denyAudit` + integration test | **ĐÃ SỬA (`TASK-0015`)** |
| `M-01` | **Medium** | `src/server/planning/p0b1-service.ts:1934-1955` | `DEPARTMENT_MANAGER` có thể tạo `directive_task` trỏ vào `monday_review` của phòng ban khác | Kiểm tra `review.department_id === current.department.id` (khi `review.department_id !== null`) + `denyAudit` + integration test 404 | **ĐÃ SỬA (`TASK-0015`)** |
| `M-02` | **Medium** | `src/server/kpi/p0b2-service.ts:1214-1260` | `getDashboardOverview` đọc toàn bộ bảng vào bộ nhớ Node.js trước khi lọc JS theo `viewerScope` | Đẩy bộ lọc `department_id` (`DEPARTMENT_MANAGER`) và `staff_id` (`STAFF`) xuống mệnh đề `WHERE` của 4 truy vấn SQL | **CHUYỂN `TASK-0016` (`REVIEWED`)** |
| `M-03` | **Medium** | `src/server/kpi/p0b2-service.ts:885-891,1018-1068` | Nhánh `ADJUST_FINAL` nhận `approved_by_staff_id` từ client `body` thay vì 2-step approval theo session người duyệt thứ 2 | Chuyển sang quy trình đề xuất `PENDING` + endpoint phê duyệt riêng (lưu ý: thay đổi contract API `POST /api/kpi/actuals/[id]/reconcile`) | **CHỜ QUYẾT ĐỊNH CHỦ DỰ ÁN (Issue #8)** |
| `M-04` | **Medium** | `src/server/planning/p0b1-service.ts:200-239,1096-1099,1666-1668` | `resolveWeekBoundsVn` dùng khoảng đóng `[Mon 00:00, Sun 23:59:59.999]` (`<=`) thay vì nửa mở `[Mon 00:00, next Mon 00:00)` (`<`) | Trả về `nextMondayUtc` và dùng `<` trong SQL; cập nhật `tests/unit/p0b1-planning-policy.test.ts` + test biên microsecond | **ĐÃ SỬA (`TASK-0015`)** |
| `M-05` | **Medium** | `src/server/alerts/p0c-alerts-service.ts:431-776` | Chưa có logic tự động gán `escalated_to_staff_id` khi cảnh báo `OPEN` quá `escalation_after_working_days` | Bổ sung bước evaluate/update `escalated_to_staff_id` (lên `DEPARTMENT_MANAGER` / `EXECUTIVE` cùng phạm vi) dựa trên `escalation_after_working_days` + test | **CHUYỂN `TASK-0016` (`REVIEWED`)** |
| `M-06` | **Medium** | `src/app/workspace/page.tsx:151-197`, `src/app/workspace/dashboard/dashboard-panel.tsx` | Điều hướng `/workspace` chưa phân 5 nhóm & chưa ẩn link nghiệp vụ cho `CONFIG_ADMIN`; `dashboard-panel.tsx` chưa gọi `/api/dashboard/drilldown` và chưa có khối ưu tiên/lịch hẹn/Lead cho `STAFF`; thiếu UI đọc `audit_events` | Tổ chức sidebar/menu theo 5 nhóm đúng quyền vai trò; tích hợp interactive drilldown và khối `STAFF` trên dashboard | **CHUYỂN `TASK-0016` (`REVIEWED`)** |
| `M-07` | **Medium** | `docs/runbooks/DEVTEST-OPERATIONS-AND-BACKUP.md:20-23`, `UAT-HANDOVER-REPORT.md`, `README.md` | Sai tên lệnh `env:test:up`, `env:test:migrate`; trạng thái `TASK-0011` "Pending PR", thiếu `TASK-0012`/`TASK-0014` | Sửa đúng `env:test:start`, `db:migrate:up`; cập nhật đầy đủ ma trận & thêm `tests/unit/docs-npm-scripts.test.ts` | **ĐÃ SỬA (`TASK-0015`)** |
| `L-01` | **Low** | `src/server/kpi/p0a-service.ts:1681-1718` | `createKpiTarget` không kiểm tra phạm vi `department_id` của `parent_target_id` | Bổ sung kiểm tra `department_id` của `parent_target_id` khi `currentRole !== 'EXECUTIVE'` + `denyAudit` + test | **ĐÃ SỬA (`TASK-0015`)** |
| `L-02` | **Low** | `src/server/pipeline/p0c-pipeline-service.ts:745-761,883-907,1417-1440` | `createLead` / `createOpportunity` không kiểm tra phạm vi `department_id`/`owner_staff_id` của `prospect_id`/`lead_id` | Tách `isScopedParentInActorScope` + `denyAudit` + test | **ĐÃ SỬA (`TASK-0015`)** |
| `L-03` | **Low** | `tests/integration/p0c-pipeline-alerts-integration.test.ts:432-530` | Thiếu test negative chuyên biệt cho `409 VERSION_CONFLICT`, `403` CSRF/Origin và audit rollback trên P0C | Bổ sung các test negative/concurrency/audit rollback vào `p0c-pipeline-alerts-integration.test.ts` | **ĐÃ SỬA (`TASK-0015`)** |
| `L-04` | **Low** | `src/server/config.ts`, `src/server/body-reader.ts` | `parsed` dùng `{}` thay `Object.create(null)`; non-JSON không có `Content-Length` đọc tối đa 16 KB trước khi báo `415` | Không có rủi ro khai thác thực tế (value luôn là `string`, trần 16 KB) | **Chuyển theo dõi** |
| `T-01` | **Tracking** | `tasks/TASK-0013.md` (nhánh `fix/TASK-0013-audit-hardening-2`), Issue #8 | `A-01` (rate limit dùng chung bộ đếm), `A-04` (retention `sessions`/`audit_events`), `A-05` (cấu hình ngoài DEVTEST) | Chờ chủ dự án quyết định tại `TASK-0013` | **Cần quyết định chủ dự án** |
| `T-02` | **Tracking** | `package-lock.json`, `next.config.ts` | `A-07` (10 cảnh báo `moderate` ở devDependencies), `V-01` (CSP nonce), `V-02` | Theo dõi, không nâng cấp dependency trong `TASK-0015` | **Chuyển theo dõi** |
