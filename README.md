# Branch Sales OS — Báo cáo và quản trị bán hàng chi nhánh

**Trạng thái:** Sprint 0 — Nền tảng kỹ thuật và kiểm thử (TASK-0001). Chưa triển khai chức năng nghiệp vụ, cơ sở dữ liệu, KPI hay xác thực SSO.

Ứng dụng quản trị bán hàng tinh gọn cho ba phòng: Cá nhân, Doanh nghiệp, Dịch vụ KH. Quản trị bảy nhóm KPI, kế hoạch ngày/tuần, Lead, khách hàng tiềm năng, Customer 360 giới hạn, Dashboard đa tầng và cảnh báo trong ứng dụng.

## Phân công

- **Chủ dự án:** phê duyệt nghiệp vụ, kiến trúc quan trọng, hợp nhất và vận hành.
- **ChatGPT:** đặc tả nhiệm vụ, quản lý tài liệu và đánh giá bằng chứng.
- **Antigravity:** chỉ thực thi task READY trên nhánh riêng; kiểm thử và mở Draft PR.
- **GitHub:** nguồn sự thật cho tài liệu, nhiệm vụ, code và lịch sử thay đổi.

## Đọc theo thứ tự

1. [AGENTS.md](AGENTS.md) — quy tắc bắt buộc cho coding agent.
2. [docs/PRODUCT.md](docs/PRODUCT.md) — phạm vi và điều hướng sản phẩm.
3. [docs/BUSINESS_RULES.md](docs/BUSINESS_RULES.md) — quy tắc KPI, Lead, báo cáo, cảnh báo.
4. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/adr/ADR-001-stack.md](docs/adr/ADR-001-stack.md) — ranh giới module và stack Sprint 0.
5. [docs/ENGINEERING.md](docs/ENGINEERING.md), [docs/SECURITY.md](docs/SECURITY.md) — tiêu chuẩn code và bảo mật.
6. [docs/WORKFLOW.md](docs/WORKFLOW.md), [tasks/TEMPLATE.md](tasks/TEMPLATE.md) — cách giao việc và nghiệm thu.
7. [docs/DECISIONS.md](docs/DECISIONS.md) — các quyết định còn mở.

## Toolchain đã khóa (ADR-001 v1.0)

| Thành phần            | Phiên bản pin                                 | Ghi chú                                                        |
| --------------------- | --------------------------------------------- | -------------------------------------------------------------- |
| Node.js               | `24.22.2` LTS                                 | Khai báo tại `.nvmrc` và `package.json#engines`                |
| npm                   | `11.19.1`                                     | Duy nhất một package manager với `package-lock.json`           |
| Next.js / React       | `16.4.6` / `19.3.1`                           | App Router, TypeScript strict (`5.9.3`), plain CSS             |
| Lint / Format         | ESLint `9.39.1`, Prettier `3.10.0`            | `eslint-config-next@16.4.6`                                    |
| Unit / Component test | Vitest `5.1.0`, Vite `8.3.8`, Testing Library | Môi trường `jsdom@31.0.0`, non-watch, `passWithNoTests: false` |
| E2E test              | `@playwright/test@1.65.0`                     | Chỉ Chromium trên production server local (`127.0.0.1:3100`)   |
| Security scan         | Gitleaks CLI `8.30.1` + `npm audit`           | Quét toàn bộ lịch sử Git và kiểm tra lỗ hổng mức High/Critical |

## Hướng dẫn cài đặt, chạy và kiểm tra từ Clean Checkout

### 1. Chuẩn bị môi trường

Đảm bảo sử dụng đúng phiên bản Node.js `24.22.2` và npm `11.19.1` (cấu hình `.npmrc` bật `engine-strict=true` sẽ từ chối cài đặt nếu sai phiên bản):

```bash
node -v   # v24.22.2
npm -v    # 11.19.1
```

Cài đặt Gitleaks CLI `8.30.1` vào `PATH` để chạy cổng bảo mật (`npm run security`).

### 2. Cài đặt dependencies từ lockfile

```bash
npm ci
git diff --exit-code -- package-lock.json
```

### 3. Phát triển và chạy ứng dụng local

```bash
# Chạy dev server (http://localhost:3000)
npm run dev

# Build bản production
npm run build

# Chạy production server local sau khi build
npm run start
```

### 4. Chạy bộ kiểm tra chất lượng và bảo mật (Quality & Security Gates)

```bash
npm run lint           # Kiểm tra ESLint (max-warnings=0)
npm run format:check   # Kiểm tra định dạng Prettier
npm run typecheck      # Kiểm tra kiểu TypeScript strict (tsc --noEmit)
npm run test:unit      # Chạy unit/component smoke tests (Vitest)
npm run build          # Build production bundle
npx playwright install chromium # Cài đặt trình duyệt Chromium (lần đầu)
npm run test:e2e       # Chạy E2E smoke tests trên production server local
npm run security       # Chạy Gitleaks git scan và npm audit (--audit-level=high)
git diff --check       # Kiểm tra lỗi khoảng trắng trong Git diff
```

## Giả định Synthetic và Giới hạn Sprint 0

- **Chỉ dùng dữ liệu synthetic / trạng thái tĩnh:** Ứng dụng hiện chỉ hiển thị một trang trạng thái trung tính của Sprint 0, không cần biến môi trường bí mật (`.env`), không kết nối cơ sở dữ liệu, không gọi dịch vụ ngoài và không tự tải font từ internet.
- **Chưa có xác thực và phân quyền nghiệp vụ:** SSO/auth doanh nghiệp được hoãn theo quyết định `D-08`; phân quyền RBAC/data scope thuộc `ADR-002` chưa phê duyệt. Không sử dụng bản scaffold này cho dữ liệu khách hàng thật.
- **Chưa triển khai nghiệp vụ:** Công thức KPI (`D-01`..`D-04`, `D-07`), API, schema/migration và cảnh báo vẫn đang mở và sẽ được triển khai ở các Sprint tiếp theo sau khi có task `READY`.

## Xử lý lỗi thường gặp (Troubleshooting)

- **Lỗi `EBADENGINE` khi chạy `npm ci`:** Môi trường hiện tại không đúng Node `24.22.2` / npm `11.19.1`. Chuyển đúng phiên bản theo `.nvmrc` trước khi chạy lại.
- **Lỗi `playwright test` báo thiếu trình duyệt hoặc chưa build:** Chạy `npx playwright install chromium` để tải trình duyệt tương ứng với `@playwright/test@1.65.0`, và chạy `npm run build` trước khi chạy `npm run test:e2e` (do E2E khởi chạy `npm run start`).
- **Lỗi `gitleaks: command not found` khi chạy `npm run security`:** Cài đặt đúng binary `gitleaks` phiên bản `8.30.1` từ bản phát hành chính thức và đưa vào `PATH`.
