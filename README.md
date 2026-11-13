# Branch Sales OS — Báo cáo và quản trị bán hàng chi nhánh

**Trạng thái:** Sprint 1 — Slice `S1-A` (`TASK-0003`: Synthetic Identity, Session, 7-Table Schema & Default-Deny Authorization Foundation). Đã kích hoạt luồng đăng nhập OIDC qua Keycloak 26.8.2 test, phiên làm việc server-side trên PostgreSQL 18.7, đánh giá đúng 1 vai trò hiệu lực (`ADR-002 v0.3`) và ghi nhận `AuditEvent`. Chưa triển khai Org CRUD (`S1-B`), workflow gán quyền (`S1-B/C`), chỉ tiêu KPI (`P0A`), kế hoạch/Actual/Dashboard (`P0B`), hay Lead/Customer/cảnh báo (`P0C/D`).

Ứng dụng quản trị bán hàng tinh gọn cho ba phòng: Cá nhân (`KHCN`), Doanh nghiệp (`KHDN`), Dịch vụ KH (`DVKH`).

## Phân công

- **Chủ dự án:** phê duyệt nghiệp vụ, kiến trúc quan trọng, hợp nhất và vận hành.
- **ChatGPT:** đặc tả nhiệm vụ, quản lý tài liệu và đánh giá bằng chứng.
- **Antigravity:** chỉ thực thi task `READY` trên nhánh riêng; kiểm thử và mở Draft PR.
- **GitHub:** nguồn sự thật cho tài liệu, nhiệm vụ, code và lịch sử thay đổi.

## Đọc theo thứ tự

1. [AGENTS.md](AGENTS.md) — quy tắc bắt buộc cho coding agent.
2. [docs/PRODUCT.md](docs/PRODUCT.md) — phạm vi và điều hướng sản phẩm.
3. [docs/BUSINESS_RULES.md](docs/BUSINESS_RULES.md) — quy tắc KPI, Lead, báo cáo, cảnh báo.
4. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/adr/ADR-001-stack.md](docs/adr/ADR-001-stack.md), [docs/adr/ADR-002-authorization.md](docs/adr/ADR-002-authorization.md) — ranh giới module, stack Sprint 0 và mô hình phân quyền `DEVTEST` Sprint 1.
5. [docs/decisions/SPRINT-1-APPROVAL.md](docs/decisions/SPRINT-1-APPROVAL.md), [docs/decisions/SPRINT-1-IMAGES.md](docs/decisions/SPRINT-1-IMAGES.md) — gói phê duyệt `D-08`/`D-09`/`ADR-002` và khóa digest container images cho `S1-A`.
6. [docs/ENGINEERING.md](docs/ENGINEERING.md), [docs/SECURITY.md](docs/SECURITY.md) — tiêu chuẩn code và bảo mật.
7. [docs/WORKFLOW.md](docs/WORKFLOW.md), [tasks/TEMPLATE.md](tasks/TEMPLATE.md) — cách giao việc và nghiệm thu.
8. [docs/DECISIONS.md](docs/DECISIONS.md) — các quyết định còn mở (`D-01`..`D-05`, `D-07`, `D-10`).

## Toolchain & Container Images đã khóa (`ADR-001` & `SPRINT-1-APPROVAL` / `SPRINT-1-IMAGES`)

| Thành phần                           | Phiên bản / Digest pin                                                                               | Ghi chú                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Node.js / npm                        | `24.22.2` LTS / `11.19.1`                                                                            | Khai báo tại `.nvmrc`, `.npmrc` (`engine-strict=true`) và `package.json#engines` |
| Next.js / React                      | `16.4.6` / `19.3.1`                                                                                  | App Router, TypeScript strict (`5.9.3`), plain CSS                               |
| Runtime Auth / DB                    | `openid-client@6.8.9`, `pg@8.23.1`, `server-only@0.0.1`                                              | Authorization Code + PKCE `S256` + `state` + `nonce`; parameterized SQL          |
| Migration Tooling                    | `node-pg-migrate@9.0.0`, `@types/pg@8.23.1`                                                          | Chạy tách biệt bằng `migrator_role`; không auto-migrate lúc runtime              |
| PostgreSQL `18.7` (`linux/amd64`)    | `docker.io/library/postgres@sha256:c7fedce47eff6a78cb35dad6b627f0d684107f75ab15c0870e40c093766ba452` | Bind loopback `127.0.0.1:55432:5432`                                             |
| PostgreSQL `18.7` (`linux/arm64/v8`) | `docker.io/library/postgres@sha256:ede0133b5b300f7609629c2bd8ac2cf8cbaf830527200ea2cbecf80f4481f2d3` | Bind loopback `127.0.0.1:55432:5432` (macOS Apple Silicon / Colima)              |
| Keycloak `26.8.2` (`linux/amd64`)    | `quay.io/keycloak/keycloak@sha256:4da21f9a53bcbac1026a0d654b740a81e98e5de4c45457076acc74b4d94b1551`  | Bind loopback `127.0.0.1:8080:8080`                                              |
| Keycloak `26.8.2` (`linux/arm64`)    | `quay.io/keycloak/keycloak@sha256:923a431c08971d49727a857e64870d8d63b5bf294a730e5dde729b5138c26c9e`  | Bind loopback `127.0.0.1:8080:8080` (macOS Apple Silicon / Colima)               |
| Lint / Format                        | ESLint `9.39.1`, Prettier `3.10.0`                                                                   | `eslint-config-next@16.4.6`                                                      |
| Unit / Integration / E2E             | Vitest `5.1.0`, `@playwright/test@1.65.0`                                                            | Unit (`jsdom`), Integration (real Postgres + Keycloak), E2E (Chromium)           |
| Security scan                        | Gitleaks CLI `8.30.1` + `npm audit`                                                                  | Quét toàn bộ lịch sử Git và kiểm tra lỗ hổng mức High/Critical                   |

## Hướng dẫn cài đặt, chạy và kiểm tra từ Clean Checkout

### 1. Chuẩn bị môi trường

Đảm bảo sử dụng đúng phiên bản Node.js `24.22.2` và npm `11.19.1`:

```bash
node -v   # v24.22.2
npm -v    # 11.19.1
```

Trên macOS Apple Silicon sử dụng Colima, khởi chạy profile riêng đã duyệt (`baocaobanhang`, `aarch64`, `vz`, `2 CPU`, `3 GiB RAM`, `20 GiB disk`, không Rosetta, không Kubernetes, không đổi default context):

```bash
colima start --profile baocaobanhang --arch aarch64 --vm-type vz --cpus 2 --memory 3 --disk 20 --activate=false
```

### 2. Cài đặt dependencies từ lockfile

```bash
npm ci
git diff --exit-code -- package-lock.json
```

### 3. Khởi chạy môi trường Synthetic (`PostgreSQL 18.7` + `Keycloak 26.8.2`), Migration & Seed

Các script dưới đây tự động phát hiện kiến trúc daemon (`linux/arm64` hoặc `linux/amd64`), kiểm tra digest theo [docs/decisions/SPRINT-1-IMAGES.md](docs/decisions/SPRINT-1-IMAGES.md), kiểm tra cổng `127.0.0.1:55432` và `127.0.0.1:8080` trống, sinh secrets ngẫu nhiên theo phiên vào `.env.devtest.local` (được Git ignore), tạo tách biệt `migrator_role` và `app_runtime_role` (`NOSUPERUSER NOBYPASSRLS`, không quyền DDL/owner/role-write, chỉ append `audit_events`), chạy migration 7 bảng và seed 3 phòng (`KHCN`, `KHDN`, `DVKH`) cùng các tài khoản synthetic:

```bash
npm run env:test:start      # Pull đúng digest, khởi chạy Postgres + Keycloak trên 127.0.0.1 và sinh .env.devtest.local
npm run env:test:health     # Kiểm tra sức khỏe container, kết nối DB và cổng loopback
npm run db:migrate:preview  # Xem trước nội dung SQL migration trên target allowlist
npm run db:migrate:up       # Thực thi migration 7 bảng qua migrator_role
npm run env:test:seed       # Seed realm branch-sales-dev, client branch-sales-web và dữ liệu synthetic
```

### 4. Chạy bộ kiểm tra chất lượng và bảo mật (Quality & Security Gates)

```bash
npm run lint              # Kiểm tra ESLint (max-warnings=0)
npm run format:check      # Kiểm tra định dạng Prettier
npm run typecheck         # Kiểm tra kiểu TypeScript strict (tsc --noEmit)
npm run test:unit         # Chạy unit tests (policy, clock-boundary, AES-256-GCM, config, UI)
npm run test:integration  # Chạy integration tests trên PostgreSQL 18.7 & Keycloak 26.8.2 thật
npm run build             # Build production bundle
npx playwright install chromium # Cài đặt trình duyệt Chromium (lần đầu)
npm run test:e2e          # Chạy E2E tests (đăng nhập OIDC thật qua Keycloak -> /workspace -> /api/me -> POST /auth/logout)
npm run env:test:stop     # Dừng container đã xác minh ownership; giữ dữ liệu và .env.devtest.local
npm run security          # Chạy Gitleaks 8.30.1 full-history scan và npm audit (--audit-level=high)
git diff --check          # Kiểm tra lỗi khoảng trắng trong Git diff
```

## Giả định Synthetic, Giới hạn `S1-A` và Hoàn tác (Rollback)

- **Chỉ dùng dữ liệu synthetic (`Scope: DEVTEST`):** Toàn bộ tài khoản Keycloak (`realm: branch-sales-dev`) và bản ghi nhân sự/phòng ban trong PostgreSQL đều là dữ liệu giả lập phục vụ kiểm thử. Tuyệt đối không kết nối IdP doanh nghiệp thật (`D-10` vẫn `OPEN`) và không nạp dữ liệu nhân sự/khách hàng thật (`D-05` vẫn `OPEN`).
- **Giới hạn Logout `S1-A`:** `POST /auth/logout` (kèm kiểm tra `Origin` và `CSRF token`) thu hồi bền vững phiên làm việc của ứng dụng trong bảng `sessions` và xóa cookie phiên; không cam kết hủy phiên SSO toàn cục tại IdP.
- **Hoàn tác (Rollback) an toàn:** Khi hoàn tác mã nguồn hoặc khôi phục trên bản sao synthetic, hệ thống giữ nguyên lịch sử `identity_links` và `audit_events` (không chạy lệnh `down` phá hủy bảng hay xóa nhật ký kiểm toán).

## Review hardening TASK-0003

Migration additive `0002_revoke_changed_session_authority.sql` thu hồi session ngay trong transaction đổi quyền/phòng/trạng thái/mapping; bảy bảng và audit/mapping được giữ nguyên. Runtime audit chỉ INSERT; verification reads dùng migrator/test connection.

Harness chỉ nhận context/Unix socket local đã duyệt, gắn ownership theo project directory. Start/stop chỉ reuse/stop đúng resources đã xác minh; không rm/reset, không ghi đè container trùng tên. Các container cũ không có label ownership phải được đối chiếu riêng; script từ chối tự nhận quyền sở hữu. Stop giữ private environment để resume. Seed chỉ thêm fixtures thiếu với target guard, không xóa/ghi đè audit, session hoặc mapping hiện có.

AC-10 dùng pg_dump/pg_restore thật sang database synthetic mới duy nhất trong cùng project container, so hash nội dung bảy bảng và constraints; không in dump/token ra log, không drop target hoặc xóa schema có trước. Bản sao được giữ lại để kiểm tra; việc dọn dữ liệu cần chỉ dẫn riêng.
