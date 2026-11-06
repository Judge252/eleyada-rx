"use client";
import { useI18n, LanguageSwitcher } from "@/lib/i18n/client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FilePlus2,
  ClipboardList,
  Store,
  Stethoscope,
  ChevronLeft,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Brand, DemoNotice } from "@/components/ui";
import { SessionGuard, SignOutButton } from "@/components/session-controls";
import type { Account } from "@/lib/auth/access";

export function AppShell({
  role,
  account,
  children,
}: {
  role: "doctor" | "pharmacy";
  account: Account;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const doctor = role === "doctor";
  const navigation = doctor
    ? [
        { href: "/doctor", label: t("نظرة عامة"), icon: LayoutDashboard },
        {
          href: "/doctor#prescriptions",
          label: t("السجلات المحفوظة"),
          icon: ClipboardList,
        },
        {
          href: "/doctor/prescriptions/new",
          label: t("وصفة جديدة"),
          icon: FilePlus2,
        },
      ]
    : [
        {
          href: "/pharmacy",
          label: t("التحقق من وصفة"),
          icon: LayoutDashboard,
        },
      ];

  return (
    <div className="app-shell">
      <SessionGuard role={account.role} identity={account.id} />
      <a className="skip-link" href="#main-content">
        {t("تخطي إلى المحتوى")}{" "}
      </a>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Brand compact />
          <LanguageSwitcher />
          <span className="pilot-label">{t("النسخة التجريبية الخاصة")}</span>
        </div>
        <button
          className="mobile-menu button"
          type="button"
          aria-expanded={open}
          aria-controls="sidebar-links"
          onClick={() => setOpen(!open)}
        >
          {open ? <PanelRightClose size={20} /> : <PanelRightOpen size={20} />}
          {t("القائمة")}{" "}
        </button>
        <div
          className={`sidebar-content ${open ? "is-open" : ""}`}
          id="sidebar-links"
        >
          <p className="nav-caption">
            {t("مساحة")} {doctor ? t("الطبيب") : t("الصيدلي")}
          </p>
          <nav aria-label={t("التنقل الرئيسي")}>
            {navigation.map(({ href, label, icon: Icon }) => {
              const active = !href.includes("#") && pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={`nav-link ${active ? "active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setOpen(false)}
                >
                  <Icon size={20} aria-hidden="true" />
                  {t(label)}
                  {active && (
                    <ChevronLeft
                      size={16}
                      className="nav-chevron"
                      aria-hidden="true"
                    />
                  )}
                </Link>
              );
            })}
          </nav>
          <div className="sidebar-bottom">
            <SignOutButton />
            <div className="sidebar-footer">
              <span dir="ltr">Al-Eyada Rx</span>
              <span>{t("دخول آمن")}</span>
            </div>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-context">
            {t("العيادة")} <ChevronLeft size={14} aria-hidden="true" />
            <strong>{doctor ? t("لوحة الطبيب") : t("واجهة الصيدلي")}</strong>
          </div>
          <div className="account">
            <div className="avatar">
              {doctor ? <Stethoscope size={20} /> : <Store size={20} />}
            </div>
            <div>
              <strong>
                {doctor ? t("طبيب العيادة") : account.pharmacy?.name}
              </strong>
              <span dir="ltr">{account.email}</span>
            </div>
          </div>
        </header>
        <main id="main-content" className="main-content" tabIndex={-1}>
          <DemoNotice />
          {children}
          <footer className="content-footer">
            <span>{t("العيادة • إدارة الوصفات والتحقق منها")}</span>
            <span>
              {doctor
                ? t("سجل الوصفة والصرف الكامل — تجربة خاصة")
                : t("تحقق وصرف كامل مسجل — تجربة خاصة")}
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
