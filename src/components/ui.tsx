import Image from "next/image";
import Link from "next/link";
import { FlaskConical, ArrowRight, Check, Circle, Clock3 } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { statusLabels } from "@/lib/mock-data";
import type { PrescriptionStatus } from "@/types/prescription";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`}>
      <div className="brand-logo">
        <Image
          src="/branding/logo.png"
          width={2158}
          height={817}
          alt="العيادة — استثمر في صحتك"
          priority
        />
      </div>
      <span className="brand-caption" dir="ltr">
        Al-Eyada <strong>Rx</strong>
      </span>
    </div>
  );
}

export function DemoNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`demo-notice ${compact ? "compact" : ""}`}>
      <FlaskConical size={17} aria-hidden="true" />
      <p>
        <strong>اختبار برمجي خاص — غير معتمد للاستخدام الطبي</strong>
        <span>
          {compact
            ? "بيانات وهمية فقط"
            : "حفظ المسودات والإصدار والصرف عبر التحقق المصرح به. لا تفترض نجاح أي عملية دون تأكيدها. استخدم بيانات اصطناعية فقط."}
        </span>
      </p>
    </div>
  );
}

export function StatusBadge({ status }: { status: PrescriptionStatus }) {
  const Icon =
    status === "ready" ? Circle : status === "dispensed" ? Check : Clock3;
  return (
    <span className={`status-badge status-${status}`}>
      <Icon size={13} aria-hidden="true" />
      {statusLabels[status]}
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
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

export function BackLink({
  href = "/doctor",
  children = "العودة إلى لوحة الطبيب",
}: {
  href?: string;
  children?: ReactNode;
}) {
  return (
    <Link className="back-link no-print" href={href}>
      <ArrowRight size={16} aria-hidden="true" />
      {children}
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
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
