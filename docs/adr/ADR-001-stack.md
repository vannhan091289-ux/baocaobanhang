# ADR-001 — Stack và cấu trúc Sprint 0

Status: ACCEPTED — chỉ phạm vi Sprint 0
Version: 1.0
Decision date: 2026-11-11 (Asia/Ho_Chi_Minh)
Approved by: Chủ dự án — người dùng trong chat điều phối
Approval record: PR #2, mục Phê duyệt; yêu cầu trực tiếp của người dùng ngày 2026-11-11 được chép dưới đây
Applies to: TASK-0001; repository vannhan091289-ux/baocaobanhang

## Bối cảnh và thẩm quyền

PR #1 đã đưa baseline tài liệu vào main tại 1ab2f2020b2dff47fb4a9f7dd3b129b4923044e6. D-06 trước đây chặn scaffold do chưa duyệt stack/SSO. Chủ dự án chỉ dẫn:

> Tôi duyệt stack đề xuất và hoãn SSO khỏi Sprint 0. Hoàn thiện D-06/ADR-001, cập nhật TASK-0001 sang READY, review và merge PR #2, rồi viết lệnh ngắn giao Antigravity thực thi; chưa code hay deploy.

Chỉ dẫn này duyệt stack và giao việc Sprint 0 cho Antigravity qua task READY. Codex trong lượt hiện tại chỉ sửa/review/merge tài liệu và viết lệnh bàn giao. Việc triển khai chưa bắt đầu. Phê duyệt không bao gồm dữ liệu thật, auth/SSO/RBAC, database, hạ tầng, billing, merge PR triển khai hoặc deploy.

## Quyết định

- Một ứng dụng Next.js App Router + React + TypeScript strict trong repo hiện tại; npm với một package-lock.json. Cấu trúc tối thiểu src/app/{layout.tsx,page.tsx,globals.css}, tests/unit/, tests/e2e/ và cấu hình root cần dùng. Một trang scaffold trung tính; không domain module rỗng, demo CRUD hay API nghiệp vụ.
- Plain CSS; không thêm Tailwind, UI kit, React Compiler hoặc plugin không cần thiết. Dùng scaffold thủ công theo tài liệu Next.js, hoặc create-next-app cùng phiên bản Next trong thư mục tạm rồi chép đúng file cần; giữ nguyên AGENTS.md và tài liệu hiện có.
- ESLint + eslint-config-next, Prettier; Vitest + Vite + Testing Library/jsdom cho component smoke đồng bộ; Playwright chỉ Chromium cho HTTP/browser smoke. Không thêm @vitejs/plugin-react khi test TSX mặc định đã đáp ứng; chỉ dependency trong bảng hoặc dependency bắc cầu cần thiết qua lockfile.
- Gitleaks CLI và npm audit là security gates. GitHub Actions chỉ kiểm tra chất lượng với quyền đọc; pin action bằng full commit SHA và scanner checksum khi triển khai. Không deploy job, secrets hoặc dịch vụ trả phí; thiếu quota/quyền thì dừng báo BLOCKED.
- Không cài hoặc đổi cấu hình global để thực hiện task. Dùng toolchain theo repo và môi trường local/CI được phép.

## Version baseline — xác minh metadata ngày 2026-11-11

Đây là lựa chọn kỹ thuật trong stack đã duyệt, chưa phải chứng nhận chạy tương thích hay an toàn. Các nguồn dưới đây là metadata công bố của dự án/package, không phải bằng chứng đã cài đặt hoặc chạy test.

| Thành phần | Pin ban đầu | Nguồn xác minh |
|---|---|---|
| Node.js | 24.22.2 LTS (Krypton) | [Node release index](https://nodejs.org/dist/index.json) |
| npm | 11.19.1, đi kèm Node trên | [npm metadata](https://registry.npmjs.org/npm/11.19.1) |
| next / create-next-app / eslint-config-next | 16.4.6 | [Next metadata](https://registry.npmjs.org/next/16.4.6), [CLI](https://registry.npmjs.org/create-next-app/16.4.6), [lint config](https://registry.npmjs.org/eslint-config-next/16.4.6) |
| react / react-dom | 19.3.1 | [React](https://registry.npmjs.org/react/19.3.1), [React DOM](https://registry.npmjs.org/react-dom/19.3.1) |
| typescript | 5.9.3 | [TypeScript](https://registry.npmjs.org/typescript/5.9.3) |
| eslint | 9.39.1 | [ESLint](https://registry.npmjs.org/eslint/9.39.1) |
| prettier | 3.10.0 | [Prettier](https://registry.npmjs.org/prettier/3.10.0) |
| vitest / vite | 5.1.0 / 8.3.8 | [Vitest](https://registry.npmjs.org/vitest/5.1.0), [Vite](https://registry.npmjs.org/vite/8.3.8) |
| @testing-library/react / @testing-library/dom / @testing-library/jest-dom | 16.3.3 / 10.4.2 / 7.0.1 | [React tests](https://registry.npmjs.org/@testing-library%2freact/16.3.3), [DOM](https://registry.npmjs.org/@testing-library%2fdom/10.4.2), [Matchers](https://registry.npmjs.org/@testing-library%2fjest-dom/7.0.1) |
| jsdom | 31.0.0 | [jsdom](https://registry.npmjs.org/jsdom/31.0.0) |
| @playwright/test | 1.65.0; Chromium tương ứng package | [Playwright](https://registry.npmjs.org/@playwright%2ftest/1.65.0) |
| @types/node | 24.19.2, cùng major Node | [Node types](https://registry.npmjs.org/@types%2fnode/24.19.2) |
| @types/react / @types/react-dom | 19.3.0 | [React types](https://registry.npmjs.org/@types%2freact/19.3.0), [DOM types](https://registry.npmjs.org/@types%2freact-dom/19.3.0) |
| Gitleaks CLI | 8.30.1 | [Upstream release](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1) |

Next công bố Node >=20.9; chọn Node 24 LTS cho toolchain ổn định, npm dùng bản đi kèm để tránh nâng global. TypeScript latest được quan sát là 7.0.2, nhưng typescript-eslint 8.72.2 công bố peer >=4.8.4 <6.1.0: chọn TypeScript 5.9.3 và ESLint 9 để giữ tương thích hệ sinh thái lint. Vitest 5.1.0 chấp nhận Vite 8; engines của Vitest/jsdom/npm phù hợp Node 24.22.2. Các nhận định trên chỉ từ manifest; clean install, lint/typecheck/build/runtime và audit vẫn phải thực hiện theo TASK-0001.

Pin trực tiếp bằng version cụ thể, ghi toàn bộ dependency resolution/integrity vào lockfile; không dùng latest hoặc caret cho direct dependency. Khi thực thi, Antigravity được chọn patch/minor trong cùng major nếu cần xử lý lỗi tương thích/lỗ hổng, sau khi kiểm tra nguồn chính thức, ghi lý do/version vào ADR và lockfile rồi chạy lại mọi gate liên quan. Đổi major, thêm công cụ hoặc mở scope cần phê duyệt mới; không dùng --force/legacy-peer-deps hay bỏ security gate để vượt lỗi.

## Hoãn SSO và các gate còn mở

- D-06 được chốt cho scaffold/toolchain Sprint 0 theo ADR này. SSO/auth không được giả lập thành cơ chế an toàn cho dữ liệu thật và không được thay bằng đăng nhập tạm trong Sprint 0.
- D-08 giữ riêng việc chọn IdP, giao thức SSO, session/token/logout và chính sách auth; cần duyệt trước bất kỳ triển khai auth/Sprint 1 nào. RBAC/data scope vẫn thuộc ADR-002 chưa duyệt.
- Database/ORM, PostgreSQL, hosting/region, production architecture và ADR-002..ADR-005 vẫn PROPOSED hoặc chưa quyết định. D-01..D-05/D-07 vẫn mở; chúng không chặn scaffold không dữ liệu nghiệp vụ, nhưng chặn các task tương ứng.

## Hệ quả, rủi ro và xác minh

Giữ codebase nhỏ, local/CI không cần DB/SSO/secrets, tái lập bằng toolchain/lockfile. Rủi ro còn lại: tương thích dependency thực tế, audit transitive dependencies và quyền/quota Actions chưa được kiểm thử. Không ghi PASS cho các nội dung đó ở bước tài liệu.

Builder QA/Challenger QA phải đối chiếu 10 AC của [TASK-0001](../../tasks/TASK-0001.md); quy tắc code tại [ENGINEERING](../ENGINEERING.md), security tại [SECURITY](../SECURITY.md). [Next installation](https://nextjs.org/docs/app/getting-started/installation) và [Node release policy](https://nodejs.org/en/about/previous-releases) là nguồn tham chiếu; không chép nguyên mặc định CLI làm thay đổi quy tắc repo.

Đánh giá lại ADR nếu toolchain không thể đạt gate hoặc scope thay đổi. Hoàn tác tài liệu qua PR sửa/revert có thẩm quyền; không force-push, migration hay deploy trong quyết định này.
