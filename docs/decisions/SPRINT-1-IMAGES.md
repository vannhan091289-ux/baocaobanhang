# Sprint 1 — Official image manifest lock

Status: LOCKED — metadata verified; runtime NOT RUN
Scope: TASK-0003 S1-A, DEVTEST local/CI synthetic only
Verified at UTC: 2026-11-13T14:18:10.364871+00:00
Approved by: Chủ dự án, 2026-11-13; [approval record](SPRINT-1-APPROVAL.md#6-bản-ghi-phê-duyệt-thực-tế--2026-11-13)

## Immutable references theo platform — nguồn chuẩn duy nhất

App chạy trên host Node; containers dùng Linux image qua runtime được phép. CI Ubuntu amd64 dùng linux/amd64; Apple Silicon dùng linux/arm64 (PostgreSQL descriptor variant v8). Chọn đúng row theo runtime server platform, không suy ra chỉ từ host uname; không ép QEMU/emulation hoặc platform khác khi chưa được review. Chưa xác minh Windows containers/kiến trúc khác.

| Image/version | Platform | Immutable reference cần dùng |
|---|---|---|
| keycloak 26.8.2 | linux/amd64 | `quay.io/keycloak/keycloak@sha256:4da21f9a53bcbac1026a0d654b740a81e98e5de4c45457076acc74b4d94b1551` |
| keycloak 26.8.2 | linux/arm64 | `quay.io/keycloak/keycloak@sha256:923a431c08971d49727a857e64870d8d63b5bf294a730e5dde729b5138c26c9e` |
| postgres 18.7 | linux/amd64 | `docker.io/library/postgres@sha256:c7fedce47eff6a78cb35dad6b627f0d684107f75ab15c0870e40c093766ba452` |
| postgres 18.7 | linux/arm64/v8 | `docker.io/library/postgres@sha256:ede0133b5b300f7609629c2bd8ac2cf8cbaf830527200ea2cbecf80f4481f2d3` |

## Index provenance và kiểm chứng

| Source tag đọc bằng HTTPS | Index SHA-256 |
|---|---|
| [keycloak:26.8.2](https://quay.io/v2/keycloak/keycloak/manifests/26.8.2) | `sha256:c68e286cacd87b942ac1939a0a1481461109d6acd3a57dc496969a319a76bbf0` |
| [postgres:18.7](https://registry-1.docker.io/v2/library/postgres/manifests/18.7) | `sha256:9f4fd4aa918f52ae3d6f3b687f1de90d8f867cd4d520021545a9a50c120eae3b` |

Registry V2 GET chỉ đọc index/manifests; Docker Hub dùng anonymous public pull token (không credentials tài khoản, không lưu token). Tính SHA-256 trên raw response bytes của index, đọc lại index theo digest và so sánh bytes; chọn đúng OS/architecture descriptor, GET child theo digest rồi kiểm SHA-256 và descriptor size. Không tải config/layer blobs, không docker pull, không chạy container; do đó không chứng nhận vulnerability/runtime compatibility. Các digest không phải secrets.

Khi triển khai, không dùng tag latest hoặc resolve tag lại thay digest; kiểm platform/RepoDigests từ runtime sau pull được phép, ghi evidence. Nếu digest mất khả dụng/security scan fail thì BLOCKED; không tự fallback image/tag/platform. Refresh lock cần scoped review và commit, không thay pins âm thầm.

Nguồn: [Docker Registry API V2](https://docs.docker.com/reference/api/registry/latest/), [Keycloak official container guide](https://www.keycloak.org/server/containers), [Postgres Official Image](https://hub.docker.com/_/postgres). PostgreSQL 18 có quy ước PGDATA/volume riêng: theo đúng hướng dẫn phiên bản 18, không dùng volume/dữ liệu của project khác hoặc mount dữ liệu thật. Storage nội bộ IdP test tách khỏi schema app; runtime app không có quyền quản trị IdP.
