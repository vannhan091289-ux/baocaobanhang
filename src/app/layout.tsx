import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Branch Sales OS — Nền tảng kỹ thuật & Định danh Sprint 1 (S1-A)",
  description:
    "Nền tảng xác thực OIDC synthetic, phiên server-side và kiểm soát truy cập mặc định từ chối (S1-A DEVTEST) cho Branch Sales OS V3.0.",
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
