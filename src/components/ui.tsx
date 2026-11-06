"use client";
import { useI18n } from "@/lib/i18n/client";
import Link from "next/link";
import { FlaskConical, ArrowRight, Check, Circle, Clock3 } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { statusLabels } from "@/lib/mock-data";
import type { PrescriptionStatus } from "@/types/prescription";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`}>
      <span className="rx-wordmark" dir="ltr">
        Clinic RX
      </span>
    </div>
  );
}

export function DemoNotice({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <div className={`demo-notice ${compact ? "compact" : ""}`}>
      <FlaskConical size={17} aria-hidden="true" />
      <p>
        <strong>{t("اختبار برمجي خاص — غير معتمد للاستخدام الطبي")}</strong>
        <span>
          {compact
            ? t("بيانات وهمية فقط")
            : t(
                "حفظ المسودات والإصدار والصرف عبر التحقق المصرح به. لا تفترض نجاح أي عملية دون تأكيدها. استخدم بيانات اصطناعية فقط.",
              )}
        </span>
      </p>
    </div>
  );
}

export function StatusBadge({ status }: { status: PrescriptionStatus }) {
  const { t } = useI18n();
  const Icon =
    status === "ready" ? Circle : status === "dispensed" ? Check : Clock3;
  return (
    <span className={`status-badge status-${status}`}>
      <Icon size={13} aria-hidden="true" />
      {t(statusLabels[status])}
    </span>
  );
}

export function Button({
  className = "",
  variant = "primary",
  ...props
}: ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "danger";
}) {
  return (
    <button className={`button button-${variant} ${className}`} {...props} />
  );
}

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{t(eyebrow)}</div>
        <h1>{t(title)}</h1>
        <p>{t(description)}</p>
      </div>
      {action}
    </div>
  );
}

export function BackLink({
  href = "/doctor",
  children = "Back to doctor records",
}: {
  href?: string;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Link className="back-link no-print" href={href}>
      <ArrowRight size={16} aria-hidden="true" />
      {typeof children === "string" ? t(children) : children}
    </Link>
  );
}

export function Field({
  label,
  id,
  error,
  hint,
  children,
}: {
  label: string;
  id: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="field">
      <label htmlFor={id}>{t(label)}</label>
      {children}
      {hint && (
        <p className="field-hint" id={`${id}-hint`}>
          {t(hint)}
        </p>
      )}
      {error && (
        <p className="field-error" id={`${id}-error`} role="alert">
          {t(error)}
        </p>
      )}
    </div>
  );
}
