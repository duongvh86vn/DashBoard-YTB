import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AuthProvider } from "../lib/auth-context";

import "./globals.css";

export const metadata: Metadata = {
  title: "Giám sát YouTube",
  description: "Bảng điều khiển riêng tư theo dõi dữ liệu YouTube công khai.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="vi">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
