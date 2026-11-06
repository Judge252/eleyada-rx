"use client";
import { useI18n } from "@/lib/i18n/client";
import { useActionState, useEffect } from "react";
import { LogOut } from "lucide-react";
import { signOut } from "@/lib/auth/actions";
import { roleHome, type AppRole } from "@/lib/auth/access";

export function SignOutButton() {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(signOut, { message: "" });
  return (
    <form action={action}>
      <button type="submit" className="nav-link exit-link" disabled={pending}>
        <LogOut size={18} aria-hidden="true" />
        {pending ? t("جارٍ إنهاء الجلسة…") : t("تسجيل الخروج")}
      </button>
      {state.message && (
        <p className="field-error" role="alert">
          {t(state.message)}
        </p>
      )}
    </form>
  );
}

// Revalidate restored documents. Server pages/actions remain the authority.
export function SessionGuard({
  role,
  identity,
}: {
  role: AppRole;
  identity?: string;
}) {
  useEffect(() => {
    const hide = () => {
      document.body.style.visibility = "hidden";
    };
    const check = async () => {
      try {
        const response = await fetch("/api/auth/session", {
          cache: "no-store",
        });
        if (!response.ok) {
          window.location.replace("/login?reason=access");
          return;
        }
        const session: { role: AppRole; id?: string } = await response.json();
        if (identity && session.id !== identity) {
          window.location.replace("/login?reason=access");
          return;
        }
        if (session.role !== role) {
          window.location.replace(roleHome(session.role));
          return;
        }
        document.body.style.visibility = "";
      } catch {
        window.location.replace("/login?reason=access");
      }
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) {
        hide();
        void check();
      }
    };
    const focus = () => {
      hide();
      void check();
    };
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", restore);
    window.addEventListener("focus", focus);
    return () => {
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", restore);
      window.removeEventListener("focus", focus);
      document.body.style.visibility = "";
    };
  }, [role, identity]);
  return null;
}
