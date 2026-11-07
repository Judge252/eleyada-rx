"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { useI18n, LanguageSwitcher } from "@/lib/i18n/client";
import { messages } from "@/lib/experience/contracts";

export type Reply = {
  state?: string;
  message?: string;
  result?: unknown;
};
// Single transport for the experience API. A network/timeout failure is reported as "uncertain",
// never as success or as a definite failure.
export async function api(body: object): Promise<Reply> {
  try {
    const response = await fetch("/api/experience", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    return await response.json();
  } catch {
    return { state: "uncertain", message: messages.uncertain };
  }
}
export function rememberRequest(key: string) {
  try {
    const id = sessionStorage.getItem(key);
    if (id) return id;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(key, fresh);
    return fresh;
  } catch {
    return crypto.randomUUID();
  }
}
export function clearRequest(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* storage may be disabled */
  }
}
export function formatDate(value: string | undefined, locale: "he" | "en") {
  return value
    ? new Date(value).toLocaleString(locale === "he" ? "he-IL" : "en-GB")
    : "—";
}
export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "error" | "ok";
  children: ReactNode;
}) {
  return (
    <div
      className={`cx-notice is-${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
export function Shell({
  active,
  children,
  aside,
  narrow = false,
}: {
  active?: "doctor" | "pharmacy";
  children: ReactNode;
  aside?: ReactNode;
  narrow?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="cx-app">
      <a href="#cx-main" className="cx-skip">
        {t("rx_skip")}
      </a>
      <header className="cx-header">
        <div className="cx-header-inner">
          <Link href="/" className="cx-brand" dir="ltr">
            Clinic RX
          </Link>
          <nav className="cx-nav" aria-label={t("rx_main_nav")}>
            <Link
              href="/"
              aria-current={active === "doctor" ? "page" : undefined}
            >
              {t("rx_nav_doctor")}
            </Link>
            <Link
              href="/portal"
              aria-current={active === "pharmacy" ? "page" : undefined}
            >
              {t("rx_nav_pharmacy")}
            </Link>
          </nav>
          <span className="cx-lang">
            <LanguageSwitcher />
          </span>
        </div>
      </header>
      <main id="cx-main" className={`cx-main ${narrow ? "cx-narrow" : ""}`}>
        <div className={`cx-layout ${aside ? "has-aside" : ""}`}>
          <div>{children}</div>
          {aside}
        </div>
      </main>
    </div>
  );
}
