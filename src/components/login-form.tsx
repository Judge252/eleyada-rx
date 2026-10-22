"use client";

import { useActionState, useState, useRef, type FormEvent } from "react";
import {
  FileText,
  ScanLine,
  ClipboardCheck,
  Eye,
  EyeOff,
  LogIn,
  FlaskConical,
} from "lucide-react";
import { Brand, Button, Field } from "@/components/ui";
import { signIn } from "@/lib/auth/actions";

export function LoginForm({ accessDenied = false }: { accessDenied?: boolean }) {
  const [state, action, pending] = useActionState(signIn, { message: "" });
  const [localErrors, setErrors] = useState<Record<string, string>>({});
  const errors = { ...state.errors, ...localErrors };
  const [showPassword, setShowPassword] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    const values = new FormData(event.currentTarget);
    const nextErrors: Record<string, string> = {};
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        String(values.get("email") ?? "").trim(),
      )
    )
      nextErrors.email = "أدخل بريدًا إلكترونيًا بصيغة صحيحة.";
    if (!String(values.get("password") ?? ""))
      nextErrors.password = "أدخل كلمة المرور.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      event.preventDefault();
      formRef.current
        ?.querySelector<HTMLInputElement>(
          `[name="${Object.keys(nextErrors)[0]}"]`,
        )
        ?.focus();
    }
  }

  return (
    <main className="login-page">
      <section className="login-story">
        <div className="story-top">
          <span dir="ltr">Al-Eyada Rx</span>
          <span className="story-pilot">
            <span />
            تجربة خاصة
          </span>
        </div>
        <div className="story-body">
          <div className="story-mark">
            <FileText size={37} strokeWidth={1.5} />
            <span>Rx</span>
          </div>
          <p className="story-eyebrow">العيادة • الوصفات الرقمية</p>
          <h2>
            رعاية تبدأ بوصفة،
            <br />
            وثقة في كل خطوة.
          </h2>
          <p className="story-description">
            مساحة واحدة لتنظيم وصفات العيادة، ومراجعتها والتحقق منها لدى
            الصيدليات الشريكة.
          </p>
          <div className="story-steps">
            <div>
              <span>
                <FileText size={20} />
              </span>
              <p>
                <strong>وصفة واضحة</strong>
                <small>تفاصيل منظمة يسهل الرجوع إليها</small>
              </p>
            </div>
            <div>
              <span>
                <ScanLine size={20} />
              </span>
              <p>
                <strong>تحقق لدى الصيدلية</strong>
                <small>عرض أصل الوصفة دون تعديل بياناتها</small>
              </p>
            </div>
            <div>
              <span>
                <ClipboardCheck size={20} />
              </span>
              <p>
                <strong>متابعة عملية الصرف</strong>
                <small>ضمن نطاق الصيدليات المشاركة مستقبلًا</small>
              </p>
            </div>
          </div>
        </div>
        <p className="story-footer">
          تصوّر لسير العمل المستقبلي • الميزات غير مُفعّلة في هذه المرحلة
        </p>
      </section>
      <section className="login-form-side">
        <div className="login-inner">
          <Brand />
          <div className="login-title">
            <div className="eyebrow">مرحبًا بك في العيادة</div>
            <h1>تسجيل الدخول</h1>
            <p>واجهة دخول الطبيب والصيدليات الشريكة.</p>
          </div>
          <div className="login-demo">
            <FlaskConical size={19} />
            <p>
              <strong>دخول مخصص للحسابات المعتمدة</strong>
              <span>إنشاء الحسابات لدى مسؤول العيادة فقط. الوصفات والصرف ما زالا تجريبيين.</span>
            </p>
          </div>
          <form
            ref={formRef}
            noValidate
            onSubmit={submit}
            action={action}
            aria-busy={pending}
            className="login-form"
          >
            <Field id="email" label="البريد الإلكتروني" error={errors.email}>
              <input
                className="input"
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                dir="ltr"
                placeholder="name@example.com"
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? "email-error" : undefined}
                spellCheck={false}
              />
            </Field>
            <Field
              id="password"
              label="كلمة المرور"
              error={errors.password}
            >
              <div className="password-input">
                <input
                  className="input"
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  dir="ltr"
                  placeholder="••••••••"
                  aria-invalid={!!errors.password}
                  aria-describedby={
                    errors.password ? "password-error" : undefined
                  }
                />
                <button
                  type="button"
                  aria-label={
                    showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"
                  }
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                </button>
              </div>
            </Field>
            <Button type="submit" className="login-submit" disabled={pending}>
              <LogIn size={18} />
              {pending ? "جارٍ تسجيل الدخول…" : "تسجيل الدخول"}
            </Button>
            {(state.message || accessDenied) && (
              <p className="feedback-message" role="alert">
                {state.message || "سجّل الدخول بحساب معتمد ونشط للوصول إلى هذه الصفحة."}
              </p>
            )}
          </form>
          <p className="login-footer">
            لا تُدخل بيانات مرضى حقيقيين. لاستعادة الوصول، تواصل مع مسؤول العيادة.
          </p>
        </div>
      </section>
    </main>
  );
}
