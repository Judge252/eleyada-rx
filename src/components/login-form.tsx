"use client";
import Link from "next/link";
import { useActionState, useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n/client";
import { signIn } from "@/lib/auth/actions";
import { Notice, Shell } from "@/components/rx/shell";

// Doctor/clinic sign-in only. Pharmacy lookup is a separate, public screen.
export function LoginForm({
  accessDenied = false,
}: {
  accessDenied?: boolean;
}) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(signIn, { message: "" });
  const [missing, setMissing] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    const values = new FormData(event.currentTarget);
    if (
      !String(values.get("username") ?? "").trim() ||
      !String(values.get("password") ?? "")
    ) {
      event.preventDefault();
      setMissing(true);
    } else setMissing(false);
  }
  const message = missing
    ? "rx_login_required"
    : state.message ||
      (accessDenied
        ? "سجّل الدخول بحساب معتمد ونشط للوصول إلى هذه الصفحة."
        : "");

  return (
    <Shell active="doctor" narrow>
      <h1 className="cx-title">{t("rx_login_title")}</h1>
      <p className="cx-lede">{t("rx_login_lede")}</p>
      {message && <Notice tone="error">{t(message)}</Notice>}
      <form
        className="cx-panel"
        action={action}
        onSubmit={submit}
        noValidate
        aria-busy={pending}
      >
        <div className="cx-grid" style={{ gridTemplateColumns: "1fr" }}>
          <label className="cx-field" htmlFor="username">
            <span>{t("rx_username")}</span>
            <input
              id="username"
              name="username"
              className="cx-input cx-ltr"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={32}
              aria-invalid={missing}
            />
          </label>
          <label className="cx-field" htmlFor="password">
            <span>{t("rx_password")}</span>
            <input
              id="password"
              name="password"
              className="cx-input cx-ltr"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              maxLength={1024}
              aria-invalid={missing}
            />
          </label>
          <label className="cx-check">
            <input
              type="checkbox"
              checked={showPassword}
              onChange={(e) => setShowPassword(e.target.checked)}
            />
            <span>{t("إظهار كلمة المرور")}</span>
          </label>
        </div>
        <div className="cx-actions">
          <button className="cx-btn" type="submit" disabled={pending}>
            {pending ? t("rx_signing_in") : t("rx_signin")}
          </button>
        </div>
        <p className="cx-hint">{t("rx_login_forgot")}</p>
      </form>
      <p className="cx-hint">
        {t("rx_login_pharmacy")}{" "}
        <Link className="cx-link" href="/portal">
          {t("rx_login_pharmacy_link")}
        </Link>
      </p>
    </Shell>
  );
}
