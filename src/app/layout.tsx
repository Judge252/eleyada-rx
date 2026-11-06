import type { Metadata } from "next";
import "@fontsource-variable/noto-sans-hebrew";
import { getI18n, getLocale } from "@/lib/i18n/server";
import { LanguageProvider } from "@/lib/i18n/client";
import { direction } from "@/lib/i18n/core";
import "./globals.css";
import "./experience.css";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: {
      default: t("text_38"),
      template: "%s — Clinic RX",
    },
    description: t("text_40"),
    robots: { index: false, follow: false },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  return (
    <html lang={locale} dir={direction(locale)}>
      <body>
        <LanguageProvider initialLocale={locale}>{children}</LanguageProvider>
      </body>
    </html>
  );
}
