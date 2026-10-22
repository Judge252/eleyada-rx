"use client";

import { useActionState, useEffect } from "react";
import { LogOut } from "lucide-react";
import { signOut } from "@/lib/auth/actions";
import { roleHome, type AppRole } from "@/lib/auth/access";

export function SignOutButton() {
  const [state, action, pending] = useActionState(signOut, { message: "" });
  return <form action={action}>
    <button type="submit" className="nav-link exit-link" disabled={pending}>
      <LogOut size={18} aria-hidden="true" />
      {pending ? "جارٍ إنهاء الجلسة…" : "تسجيل الخروج"}
    </button>
    {state.message && <p className="field-error" role="alert">{state.message}</p>}
  </form>;
}

// Revalidate restored documents. Server pages/actions remain the authority.
export function SessionGuard({ role }: { role: AppRole }) {
  useEffect(() => {
    const hide = () => { document.body.style.visibility = "hidden"; };
    const check = async () => {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        if (!response.ok) { window.location.replace("/login?reason=access"); return; }
        const session: { role: AppRole } = await response.json();
        if (session.role !== role) { window.location.replace(roleHome(session.role)); return; }
        document.body.style.visibility = "";
      } catch { window.location.replace("/login?reason=access"); }
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) { hide(); void check(); }
    };
    const focus = () => { hide(); void check(); };
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", restore);
    window.addEventListener("focus", focus);
    return () => {
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", restore);
      window.removeEventListener("focus", focus);
      document.body.style.visibility = "";
    };
  }, [role]);
  return null;
}
