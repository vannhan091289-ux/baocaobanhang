import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Branch Sales OS — Nền tảng kỹ thuật Sprint 0",
  description:
    "Scaffold kỹ thuật trung tính cho Branch Sales OS V3.0 (Sprint 0). Chưa triển khai dữ liệu nghiệp vụ, cơ sở dữ liệu hay SSO.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
