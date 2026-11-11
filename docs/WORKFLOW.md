# ChatGPT → GitHub → Antigravity workflow

## Quyền hạn
- Product owner: phê duyệt phạm vi, KPI, kiến trúc trọng yếu, dùng dữ liệu, merge và release.
- ChatGPT: duy trì docs, soạn task có acceptance criteria, review PR/evidence và viết lệnh chuyển giao.
- Antigravity: đọc AGENTS + task READY, code/test trong phạm vi, push feature branch và tạo Draft PR khi task cho phép.

## Trạng thái task
`DRAFT → REVIEWED → READY → IN_PROGRESS → REVIEW → ACCEPTED`. Ngoại lệ `BLOCKED / REWORK`. READY cần chỉ dẫn phê duyệt rõ, phạm vi và tiêu chí xác minh. Mỗi task một owner, một nhánh; task sau phụ thuộc task trước đã nghiệm thu.

## Vòng thực hiện
1. ChatGPT viết `tasks/TASK-XXXX.md`, nêu đầu vào, file/tài liệu liên quan, rủi ro, test, phụ thuộc, kết quả.
2. Product owner duyệt READY cho task cần phê duyệt.
3. Antigravity tạo `feat/TASK-ID-short-name` hoặc `fix/TASK-ID-short-name`, thực thi vertical slice nhỏ và kiểm thử.
4. Antigravity đẩy branch, mở Draft PR; báo lệnh chạy, diff, lỗi còn lại.
5. ChatGPT đối chiếu test/security/business rules, đánh dấu REWORK nếu thiếu. Antigravity sửa trên cùng branch; không tự merge.
6. Người có thẩm quyền duyệt hợp nhất và vận hành; cập nhật task/docs.

## Lệnh ngắn giao Antigravity
"Đọc AGENTS.md và tasks/TASK-XXXX.md tại commit hiện hành. Chỉ thực thi nếu task READY. Giữ phạm vi và standards. Chạy test, báo bằng chứng, mở Draft PR nếu được phép; không merge hoặc deploy."

## Chính sách GitHub
Bảo vệ main; ưu tiên review+CI; không push trực tiếp main. Không triển khai production như hậu quả tự động của việc task READY.
