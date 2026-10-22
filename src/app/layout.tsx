import type { Metadata } from "next";
import "@fontsource-variable/noto-sans-arabic";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "العيادة Rx | معاينة تجريبية",
    template: "%s | العيادة Rx",
  },
  description:
    "نموذج واجهات عربي تجريبي لإدارة الوصفات والتحقق منها. لا توجد وصفات طبية صالحة أو بيانات حقيقية.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
