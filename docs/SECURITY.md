# Security & banking data — fail closed

Chỉ dùng dữ liệu synthetic hoặc ẩn danh được phép cho đến khi có phê duyệt của tổ chức. Không commit hoặc đưa vào task, prompt, AI bên ngoài: PII KH thật, tài khoản, số dư, tài liệu tín dụng, mật khẩu, secrets. Không mặc nhiên được phép truy xuất Core Banking.

## Kiểm soát
- Xác thực/session theo cơ chế doanh nghiệp được chấp thuận; token an toàn, thu hồi phiên, least privilege.
- Phân quyền backend theo role + phòng + người phụ trách + field/action. Kiểm thử từ chối ở list/search/detail/edit/import/export/reassign.
- Tách người giao/phê duyệt target và người sửa/đối soát Actual theo thẩm quyền.
- Validate input/import, chống injection/XSS/CSRF, rate limiting, kiểm tra file upload; audit thay đổi và xuất dữ liệu.
- Secrets qua cấu hình an toàn, không trong code/log/screenshot/CI artifacts.
- Cảnh báo trong ứng dụng chỉ hiện dữ liệu KH tối thiểu theo quyền. Email/chat phải phê duyệt riêng.
- Chốt classification, hosting/region, retention, backup/restore, deletion, monitoring/incident response trước pilot dữ liệu thật.

Thiếu chính sách hoặc nguồn quyền = BLOCKED cho dữ liệu thật; vẫn có thể phát triển bằng fixture synthetic.
