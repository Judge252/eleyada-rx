"use client";
import { useI18n, LanguageSwitcher } from "@/lib/i18n/client";
import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type InputHTMLAttributes,
} from "react";
import {
  ArrowLeft,
  Check,
  ClipboardList,
  FileText,
  LockKeyhole,
  Plus,
  Search,
  ShieldCheck,
  Stethoscope,
  Store,
  Trash2,
} from "lucide-react";
import { Brand, Button } from "@/components/ui";
import { SessionGuard, SignOutButton } from "@/components/session-controls";
import {
  countryCodes,
  documentTypes,
  formPayload,
  messages,
  type FormPayload,
  type Match,
  type PrescriberContext,
  type Receipt,
  type Selection,
} from "@/lib/experience/contracts";

type Reply = {
  actorId?: string;
  state?: string;
  message?: string;
  result?: unknown;
  context?: PrescriberContext;
  pharmacy?: { name: string };
};
async function api(body: object): Promise<Reply> {
  try {
    const response = await fetch("/api/experience", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    return data;
  } catch {
    return { state: "uncertain", message: messages.uncertain };
  }
}
function Input({
  label,
  id,
  optional = false,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  id: string;
  optional?: boolean;
}) {
  const { t } = useI18n();
  return (
    <label className="rx-field" htmlFor={id}>
      <span>
        {t(label)}
        {!optional && (
          <span className="rx-required" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </span>
      <input
        id={id}
        className="input"
        required={!optional}
        maxLength={120}
        {...props}
      />
    </label>
  );
}
function Section({
  number,
  title,
  hint,
  children,
}: {
  number: string;
  title: string;
  hint: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <section className="rx-card">
      <div className="rx-section-title">
        <span className="rx-number">{number}</span>
        <div>
          <h2>{t(title)}</h2>
          <p>{t(hint)}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="rx-notice" role="status">
      <ShieldCheck size={19} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
function IdentityFields({
  prefix,
  value,
  change,
}: {
  prefix: string;
  value: { country: string; type: string; identifier: string };
  change: (key: "country" | "type" | "identifier", value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <Input
        id={`${prefix}-id`}
        label={t("رقم الهوية")}
        dir="ltr"
        autoComplete="off"
        value={value.identifier}
        onChange={(e) => change("identifier", e.target.value)}
        placeholder={t("مع الاحتفاظ بالأصفار الأولى")}
      />
      <label className="rx-field" htmlFor={`${prefix}-country`}>
        <span>{t("بلد إصدار الهوية *")}</span>
        <select
          id={`${prefix}-country`}
          className="input"
          required
          value={value.country}
          onChange={(e) => change("country", e.target.value)}
        >
          <option value="">{t("اختر البلد")}</option>
          {countryCodes.map((code) => (
            <option value={code} key={code}>
              {t("country_" + code)} ({code})
            </option>
          ))}
        </select>
      </label>
      <label className="rx-field" htmlFor={`${prefix}-type`}>
        <span>{t("نوع الوثيقة *")}</span>
        <select
          id={`${prefix}-type`}
          className="input"
          value={value.type}
          onChange={(e) => change("type", e.target.value)}
        >
          {Object.entries(documentTypes).map(([key, label]) => (
            <option key={key} value={key}>
              {t(label)}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
function rememberRequest(key: string) {
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
function clearRequest(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* storage may be disabled */
  }
}
const date = (value?: string, locale: "he" | "en" = "he") =>
  value
    ? new Date(value).toLocaleString(locale === "he" ? "he-IL" : "en-GB")
    : "—";

export function PrescriptionExperience({
  pharmacy = false,
}: {
  pharmacy?: boolean;
}) {
  const { t } = useI18n();
  const [context, setContext] = useState<PrescriberContext>({
    state: "unauthorized",
  });
  const [pharmacyName, setPharmacyName] = useState("");
  const [pharmacyActor, setPharmacyActor] = useState<string>();
  const [loading, setLoading] = useState(true);
  async function refresh() {
    setLoading(true);
    const response = await api({ operation: "context" });
    if (response.state === "pharmacist") {
      setPharmacyName(response.pharmacy?.name ?? "");
      setPharmacyActor(response.actorId);
    } else if (response.result)
      setContext(response.result as PrescriberContext);
    else setContext({ state: "unauthorized" });
    setLoading(false);
  }
  useEffect(() => {
    let alive = true;
    void api({ operation: "context" }).then((response) => {
      if (!alive) return;
      if (response.state === "pharmacist") {
        setPharmacyName(response.pharmacy?.name ?? "");
        setPharmacyActor(response.actorId);
      } else if (response.result)
        setContext(response.result as PrescriberContext);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <div className="rx-experience">
      <a href="#rx-main" className="skip-link">
        {t("انتقل إلى المحتوى")}{" "}
      </a>
      <header className="rx-header">
        <div className="rx-header-inner">
          <Link href="/" aria-label={t("العيادة Rx — الرئيسية")}>
            <Brand compact />
          </Link>
          <nav aria-label={t("التنقل الرئيسي")}>
            <Link href="/" aria-current={!pharmacy ? "page" : undefined}>
              <Stethoscope size={17} />
              {t("وصفة جديدة")}{" "}
            </Link>
            <Link href="/portal" aria-current={pharmacy ? "page" : undefined}>
              <Store size={17} />
              {t("بوابة الصيدلية")}
              <span className="rx-free">{t("مجانًا")}</span>
            </Link>
          </nav>
          <LanguageSwitcher />
          <span className="rx-header-note">
            <LockKeyhole size={14} />
            {t("رعاية متصلة، بخطوات أبسط")}{" "}
          </span>
        </div>
      </header>
      <main id="rx-main" className="rx-main">
        {(pharmacy ? !!pharmacyName : context.state === "verified") && (
          <SessionGuard
            role={pharmacy ? "pharmacist" : "doctor"}
            identity={pharmacy ? pharmacyActor : context.doctor_id}
          />
        )}
        <div className="rx-intro">
          <div className="rx-eyebrow">
            {t("العيادة Rx /")}{" "}
            {pharmacy ? t("للصيدليات") : t("للأطباء والعيادات")}
          </div>
          <h1>
            {pharmacy
              ? t("الوصفة الصحيحة. للمريض الصحيح.")
              : t("وصفة واضحة، ورعاية تستمر.")}
          </h1>
          <p>
            {pharmacy
              ? t("ابحث بهوية المريض، راجع الوصفة، ثم أكّد الصرف الكامل.")
              : t(
                  "اكتب وصفتك في دقائق. راجع التفاصيل، وأكّد الإصدار من مكان واحد.",
                )}
          </p>
        </div>
        {pharmacy ? (
          <PharmacyFlow name={pharmacyName} loading={loading} />
        ) : (
          <DoctorFlow context={context} loading={loading} refresh={refresh} />
        )}
      </main>
      <footer className="rx-footer">
        <span>
          {t("العيادة Rx · إصدار وصفات إلكترونية موثّقة وتتبع صرفها")}
        </span>
        <span>{t("للأطباء باشتراك مُدار · للصيدليات مجانًا")}</span>
      </footer>
    </div>
  );
}
type Medicine = {
  key: number;
  name: string;
  strength: string;
  dose: string;
  frequency: string;
  duration: string;
  quantity: string;
  instructions: string;
};
const emptyMedicine = (key: number): Medicine => ({
  key,
  name: "",
  strength: "",
  dose: "",
  frequency: "",
  duration: "",
  quantity: "",
  instructions: "",
});
const labels = {
  name: "اسم الدواء",
  strength: "التركيز",
  dose: "الجرعة",
  frequency: "التكرار",
  duration: "المدة",
  quantity: "الكمية",
  instructions: "تعليمات إضافية (اختياري)",
};
function DoctorFlow({
  context,
  loading,
  refresh,
}: {
  context: PrescriberContext;
  loading: boolean;
  refresh: () => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [patient, setPatient] = useState({
    name: "",
    country: "",
    type: "national_id",
    identifier: "",
    notes: "",
  });
  const [medicines, setMedicines] = useState([emptyMedicine(1)]);
  const next = useRef(2);
  const [review, setReview] = useState<FormPayload | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const request = useRef<string | null>(null);
  const frozen = useRef<FormPayload | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    try {
      request.current = sessionStorage.getItem("rx.issue.request");
    } catch {}
  }, []);
  const [auth, setAuth] = useState(false);
  async function issue() {
    if (!review || busy) return;
    setBusy(true);
    setFeedback("");
    request.current ??= rememberRequest("rx.issue.request");
    frozen.current ??= review;
    setSubmitted(true);
    const result = await api({
      operation: "issue",
      reviewedDoctorId: context.doctor_id,
      reviewedClinicId: context.clinic_id,
      requestId: request.current,
      payload: frozen.current,
      confirmed: true,
    });
    setBusy(false);
    if (result.result) {
      setReceipt(result.result as Receipt);
      clearRequest("rx.issue.request");
      setUncertain(false);
    } else {
      setFeedback(result.message ?? messages.unavailable);
      setUncertain(["uncertain", "unavailable"].includes(result.state ?? ""));
      if (
        !uncertain &&
        ["validation", "inactive", "unauthorized"].includes(result.state ?? "")
      ) {
        frozen.current = null;
        setSubmitted(false);
      }
    }
  }
  async function recover() {
    request.current ??= rememberRequest("rx.issue.request");
    setBusy(true);
    const result = await api({
      operation: "recoverIssue",
      requestId: request.current,
    });
    setBusy(false);
    if (result.result) {
      setReceipt(result.result as Receipt);
      clearRequest("rx.issue.request");
      setUncertain(false);
    } else
      setFeedback(
        result.message ??
          t(
            "لا يوجد إيصال مؤكد لهذا الطلب حتى الآن. أعد المحاولة بنفس البيانات والمعرّف؛ لا تُنشئ طلبًا بديلًا.",
          ),
      );
  }
  function prepare(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const payload = formPayload({
      ...patient,
      items: medicines.map((m) => ({
        medication_name: m.name,
        strength: m.strength,
        dose: m.dose,
        frequency: m.frequency,
        duration: m.duration,
        quantity: Number(m.quantity),
        special_instructions: m.instructions,
      })),
    });
    if (!payload) {
      setFeedback(messages.validation);
      return;
    }
    setReview(payload);
    setFeedback("");
    requestAnimationFrame(() => heading.current?.focus());
  }
  const step = receipt ? 2 : review ? 1 : 0;
  return (
    <div className="rx-layout">
      <div className="rx-primary">
        <ol className="rx-steps" aria-label={t("خطوات الوصفة")}>
          {[t("بيانات الوصفة"), t("المراجعة والتأكيد"), t("إيصال الإصدار")].map(
            (text, i) => (
              <li key={text} aria-current={step === i ? "step" : undefined}>
                <span>{i + 1}</span>
                {text}
              </li>
            ),
          )}
        </ol>
        <h2 className="sr-only" ref={heading} tabIndex={-1}>
          {t("مراجعة الوصفة")}{" "}
        </h2>
        {feedback && <Notice>{t(feedback)}</Notice>}
        {!receipt && !review && (
          <form onSubmit={prepare}>
            <Section
              number="01"
              title={t("بيانات المريض")}
              hint={t("أدخل البيانات كما تظهر في وثيقة الهوية.")}
            >
              <div className="rx-grid">
                <Input
                  id="patient-name"
                  label={t("اسم المريض بالكامل")}
                  maxLength={200}
                  value={patient.name}
                  onChange={(e) =>
                    setPatient({ ...patient, name: e.target.value })
                  }
                  autoComplete="off"
                />
                <IdentityFields
                  prefix="patient"
                  value={patient}
                  change={(key, value) =>
                    setPatient({ ...patient, [key]: value })
                  }
                />
              </div>
              <p className="rx-help">
                {t(
                  "تُوحّد الأرقام العربية والفارسية مع حفظ الأصفار. لا تُقبل المسافات الداخلية أو الفواصل. لا نفترض تنسيقًا خاصًا ببلد معين.",
                )}{" "}
              </p>
            </Section>
            <Section
              number="02"
              title={t("الأدوية الموصوفة")}
              hint={t("تفاصيل دقيقة، لتكون تعليمات العلاج واضحة.")}
            >
              {medicines.map((m, i) => (
                <fieldset className="rx-medication" key={m.key}>
                  <legend>
                    {t("الدواء")} {i + 1}
                  </legend>
                  <div className="rx-med-heading">
                    <span>
                      <span className="rx-pill">Rx</span>
                      {t("تفاصيل الدواء")}{" "}
                    </span>
                    {medicines.length > 1 && (
                      <Button
                        type="button"
                        variant="danger"
                        onClick={() =>
                          setMedicines((rows) =>
                            rows.filter((row) => row.key !== m.key),
                          )
                        }
                        aria-label={t("حذف الدواء") + " " + (i + 1)}
                      >
                        <Trash2 size={16} />
                        {t("حذف")}{" "}
                      </Button>
                    )}
                  </div>
                  <div className="rx-med-grid">
                    {(Object.keys(labels) as (keyof typeof labels)[]).map(
                      (field) => (
                        <Input
                          key={field}
                          id={`med-${m.key}-${field}`}
                          label={t(labels[field])}
                          optional={field === "instructions"}
                          dir="auto"
                          maxLength={
                            field === "instructions"
                              ? 2000
                              : field === "strength" || field === "duration"
                                ? 120
                                : 200
                          }
                          value={m[field]}
                          onChange={(e) =>
                            setMedicines((rows) =>
                              rows.map((row) =>
                                row.key === m.key
                                  ? { ...row, [field]: e.target.value }
                                  : row,
                              ),
                            )
                          }
                          type={field === "quantity" ? "number" : "text"}
                          min={field === "quantity" ? 1 : undefined}
                          max={field === "quantity" ? 1000000 : undefined}
                          step={field === "quantity" ? 1 : undefined}
                        />
                      ),
                    )}
                  </div>
                </fieldset>
              ))}
              <Button
                variant="secondary"
                className="rx-add"
                type="button"
                disabled={medicines.length >= 30}
                onClick={() =>
                  setMedicines((rows) => [
                    ...rows,
                    emptyMedicine(next.current++),
                  ])
                }
              >
                <Plus size={17} />
                {t("إضافة دواء آخر")}{" "}
              </Button>
            </Section>
            <Section
              number="03"
              title={t("ملاحظات سريرية")}
              hint={t("اختياري · أضف فقط ما يلزم للوصفة.")}
            >
              <label className="rx-field" htmlFor="notes">
                <span>{t("ملاحظات للطبيب والصيدلي")}</span>
                <textarea
                  id="notes"
                  className="input"
                  rows={3}
                  maxLength={4000}
                  value={patient.notes}
                  onChange={(e) =>
                    setPatient({ ...patient, notes: e.target.value })
                  }
                />
              </label>
            </Section>
            <div className="rx-form-footer">
              <span>
                <LockKeyhole size={15} />
                {t("لن تصدر الوصفة قبل المراجعة والتأكيد.")}{" "}
              </span>
              <Button type="submit">
                {t("مراجعة الوصفة")} <ArrowLeft size={17} />
              </Button>
            </div>
          </form>
        )}
        {review && !receipt && (
          <section className="rx-card">
            <div className="rx-section-title">
              <ClipboardList />
              <div>
                <h2>{t("راجع قبل التأكيد")}</h2>
                <p>
                  {context.doctor_name ?? t("لم يتم التحقق")} ·{" "}
                  {context.clinic_name ?? t("عيادة غير مرتبطة")}
                </p>
              </div>
            </div>
            <dl className="rx-details">
              <div>
                <dt>{t("المريض")}</dt>
                <dd>{review.name}</dd>
              </div>
              <div>
                <dt>{t("الهوية")}</dt>
                <dd>
                  <bdi>{review.identifier}</bdi> · <bdi>{review.country}</bdi> ·{" "}
                  {t(documentTypes[review.type as keyof typeof documentTypes])}
                </dd>
              </div>
            </dl>
            {review.items.map((m, i) => (
              <div className="rx-review-med" key={i}>
                <strong>
                  {i + 1}.{" "}
                  <bdi>
                    {m.medication_name} · {m.strength}
                  </bdi>
                </strong>
                <p>
                  {m.dose} · {m.frequency} · {m.duration}
                  {t("· الكمية")} {m.quantity}
                </p>
                {m.special_instructions && <p>{m.special_instructions}</p>}
              </div>
            ))}
            {review.notes && <p className="rx-review-med">{review.notes}</p>}
            {context.state !== "verified" && (
              <Notice>{t("تحقق من حساب الطبيب المعتمد قبل الإصدار.")}</Notice>
            )}
            {context.state === "verified" && !context.entitled && (
              <Notice>{t(messages.inactive)}</Notice>
            )}
            <div className="rx-actions">
              <Button
                variant="secondary"
                disabled={busy || uncertain || submitted}
                onClick={() => setReview(null)}
              >
                {t("تعديل البيانات")}{" "}
              </Button>
              <Button
                disabled={
                  busy || context.state !== "verified" || !context.entitled
                }
                onClick={issue}
              >
                {busy
                  ? t("جارٍ تأكيد النتيجة…")
                  : uncertain
                    ? t("إعادة نفس طلب الإصدار")
                    : t("تأكيد إصدار الوصفة")}
              </Button>
              <Button
                disabled={busy || context.state !== "verified"}
                variant="secondary"
                onClick={recover}
              >
                {t("استرجاع إيصال الإصدار")}{" "}
              </Button>
            </div>
          </section>
        )}
        {receipt && (
          <section className="rx-card rx-receipt">
            <span className="rx-receipt-icon">
              <FileText size={30} />
            </span>
            <h2>{t("تم إصدار الوصفة")}</h2>
            <p>
              {t(
                "تأكيد محفوظ من قاعدة البيانات. يمكن للصيدلية المعتمدة البحث بهوية المريض.",
              )}{" "}
            </p>
            <dl className="rx-details">
              <div>
                <dt>{t("مرجع داخلي")}</dt>
                <dd>
                  <bdi>{receipt.id}</bdi>
                </dd>
              </div>
              <div>
                <dt>{t("الطبيب والعيادة")}</dt>
                <dd>
                  {receipt.doctor_name} · {receipt.clinic_name}
                </dd>
              </div>
              <div>
                <dt>{t("وقت الإصدار")}</dt>
                <dd>{date(receipt.issued_at, locale)}</dd>
              </div>
              <div>
                <dt>{t("صالحة حتى")}</dt>
                <dd>{date(receipt.expires_at, locale)}</dd>
              </div>
            </dl>
            <Button
              variant="secondary"
              onClick={() => {
                setReceipt(null);
                setReview(null);
                frozen.current = null;
                request.current = null;
                setSubmitted(false);
                setPatient({
                  name: "",
                  country: "",
                  type: "national_id",
                  identifier: "",
                  notes: "",
                });
                setMedicines([emptyMedicine(next.current++)]);
                setFeedback("");
              }}
            >
              {t("وصفة جديدة")}{" "}
            </Button>
          </section>
        )}
      </div>
      <aside className="rx-aside">
        <section className="rx-card rx-context">
          {context.state === "verified" && <SignOutButton />}
          <span className="rx-icon">
            <Stethoscope size={24} />
          </span>
          <h2>{t("وصفة باسمك، بكل وضوح.")}</h2>
          <p>{t("تُنسَب كل وصفة إلى الطبيب المتحقق والعيادة المعتمدة.")}</p>
          <div className="rx-context-row">
            <span>{t("الطبيب")}</span>
            <strong>
              {loading
                ? t("جارٍ التحقق…")
                : (context.doctor_name ?? t("لم يتم التحقق"))}
            </strong>
          </div>
          <div className="rx-context-row">
            <span>{t("العيادة")}</span>
            <strong>{context.clinic_name ?? t("غير مرتبطة")}</strong>
          </div>
          <div className="rx-context-row">
            <span>{t("الاشتراك")}</span>
            <strong>
              {context.entitled ? t("نشط") : t("بانتظار التفعيل")}
            </strong>
          </div>
          <Button variant="secondary" onClick={() => setAuth(!auth)}>
            <LockKeyhole size={16} />
            {t("التحقق / طلب الانضمام")}{" "}
          </Button>
          {auth && <AccessForm verified={refresh} />}
          <Button variant="secondary" disabled={loading} onClick={refresh}>
            {t("تحديث حالة الوصول")}{" "}
          </Button>
          <Button
            variant="secondary"
            disabled={busy || context.state !== "verified"}
            onClick={recover}
          >
            {t("استرجاع إيصال الإصدار")}{" "}
          </Button>
        </section>
        <section className="rx-guidance">
          <h3>
            <ShieldCheck size={18} />
            {t("خطوة بخطوة، بثقة")}{" "}
          </h3>
          <ul>
            <li>
              <Check size={16} />
              {t("راجع بيانات المريض والأدوية.")}{" "}
            </li>
            <li>
              <Check size={16} />
              {t("الإصدار يتطلب جلسة واستحقاقًا نشطين.")}{" "}
            </li>
            <li>
              <Check size={16} />
              {t("تبحث الصيدلية بالهوية، دون رمز وصفة.")}{" "}
            </li>
          </ul>
          <p>{t("الهوية مفتاح للبحث، وليست إثباتًا لهوية حاملها.")}</p>
        </section>
        <div className="rx-small-note">
          {t(
            "الاشتراك يُدار بواسطة المشغّل. لا توجد مدفوعات إلكترونية مدمجة.",
          )}{" "}
        </div>
      </aside>
    </div>
  );
}
function AccessForm({ verified }: { verified: () => Promise<void> }) {
  const { t } = useI18n();
  const [mode, setMode] = useState("challenge");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [clinic, setClinic] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <form
      className="rx-auth"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const response = await api({
          operation: mode,
          email,
          ...(mode === "verify"
            ? { token }
            : mode === "onboard"
              ? { name, clinic }
              : {}),
        });
        setBusy(false);
        if (response.state === "verified") {
          setToken("");
          setMessage(t("تم التحقق من جلسة الطبيب المعتمد."));
          await verified();
        } else if (response.state === "accepted") {
          setMessage(
            t(
              "إن كان الطلب مؤهلًا فستتم معالجته. رمز البريد لا يُعد موافقة مهنية.",
            ),
          );
          if (mode === "challenge") setMode("verify");
        } else setMessage(response.message ?? messages.unavailable);
      }}
    >
      <label className="rx-field" htmlFor="access-mode">
        <span>{t("نوع الطلب")}</span>
        <select
          id="access-mode"
          className="input"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value);
            setMessage("");
            setToken("");
          }}
        >
          <option value="challenge">{t("الدخول برمز بريد")}</option>
          <option value="verify">{t("تأكيد رمز البريد")}</option>
          <option value="onboard">{t("طلب انضمام جديد")}</option>
        </select>
      </label>
      <Input
        id="doctor-email"
        label={t("البريد المهني")}
        type="email"
        maxLength={254}
        dir="ltr"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      {mode === "verify" && (
        <Input
          id="doctor-otp"
          label={t("رمز التحقق")}
          inputMode="numeric"
          autoComplete="one-time-code"
          dir="ltr"
          pattern="[0-9]{6,10}"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      )}{" "}
      {mode === "onboard" && (
        <>
          <Input
            id="doctor-name"
            label={t("اسم الطبيب")}
            value={name}
            maxLength={160}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            id="clinic-name"
            label={t("اسم العيادة")}
            value={clinic}
            maxLength={160}
            onChange={(e) => setClinic(e.target.value)}
          />
        </>
      )}
      <Button disabled={busy} type="submit">
        {busy
          ? t("جارٍ معالجة الطلب…")
          : mode === "challenge"
            ? t("إرسال رمز الدخول")
            : mode === "verify"
              ? t("تأكيد الرمز")
              : t("إرسال طلب الانضمام")}
      </Button>
      <p role="status">{t(message)}</p>
    </form>
  );
}
function PharmacyFlow({ name, loading }: { name: string; loading: boolean }) {
  const { t, locale } = useI18n();
  const [identity, setIdentity] = useState({
    identifier: "",
    country: "",
    type: "national_id",
  });
  const [matches, setMatches] = useState<Match[]>([]);
  const [searchId, setSearchId] = useState("");
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [fullConfirmed, setFullConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const request = useRef<string | null>(null);
  useEffect(() => {
    try {
      request.current = sessionStorage.getItem("rx.dispense.request");
    } catch {}
  }, []);
  async function search(offset = 0) {
    if (uncertain) return;
    setBusy(true);
    setFeedback("");
    setSelected(null);
    setReceipt(null);
    const reply = await api({ operation: "search", ...identity, offset });
    setBusy(false);
    if (reply.result) {
      const result = reply.result as {
        matches: Match[];
        search_id: string;
        next_offset: number | null;
      };
      setMatches(result.matches);
      setSearchId(result.search_id);
      setNextOffset(result.next_offset);
      if (!result.matches.length) setFeedback(t("لا توجد وصفات مؤهلة مطابقة."));
    } else {
      setMatches([]);
      setFeedback(reply.message ?? messages.unavailable);
    }
  }
  async function select(item: Match) {
    setBusy(true);
    setSelected(null);
    setIdentityConfirmed(false);
    setFullConfirmed(false);
    const reply = await api({
      operation: "select",
      searchId,
      prescriptionId: item.id,
    });
    setBusy(false);
    if (reply.result) setSelected(reply.result as Selection);
    else setFeedback(reply.message ?? messages.unavailable);
  }
  async function dispense() {
    if (!selected || busy) return;
    setBusy(true);
    request.current ??= rememberRequest("rx.dispense.request");
    const reply = await api({
      operation: "dispense",
      requestId: request.current,
      lookupId: selected.lookup_id,
      prescriptionId: selected.prescription_id,
      identityConfirmed,
      fullConfirmed,
    });
    setBusy(false);
    if (reply.result) {
      setReceipt(reply.result as Receipt);
      clearRequest("rx.dispense.request");
      request.current = null;
      setUncertain(false);
      setMatches([]);
      setFeedback("");
    } else {
      setUncertain(["unavailable", "uncertain"].includes(reply.state ?? ""));
      setFeedback(reply.message ?? messages.unavailable);
    }
  }
  async function recover() {
    setBusy(true);
    request.current ??= rememberRequest("rx.dispense.request");
    const reply = await api({
      operation: "recoverDispense",
      requestId: request.current,
    });
    setBusy(false);
    if (reply.result) {
      setReceipt(reply.result as Receipt);
      setUncertain(false);
      clearRequest("rx.dispense.request");
      request.current = null;
    } else
      setFeedback(
        reply.message ??
          t(
            "لا يوجد إيصال مؤكد حتى الآن. احتفظ بنفس الطلب ولا تفترض نجاح الصرف.",
          ),
      );
  }
  return (
    <div className="rx-layout">
      <div className="rx-primary">
        {feedback && <Notice>{t(feedback)}</Notice>}
        <section className="rx-card">
          <div className="rx-section-title">
            <span className="rx-icon">
              <Search size={23} />
            </span>
            <div>
              <h2>{t("البحث بهوية المريض")}</h2>
              <p>{t("مطابقة دقيقة للرقم وبلد الإصدار ونوع الوثيقة.")}</p>
            </div>
          </div>
          {!name ? (
            <>
              <Notice>
                {loading
                  ? t("جارٍ التحقق من جلسة الصيدلية…")
                  : t(
                      "يلزم حساب صيدلية نشط ومعتمد للبحث. لا يوجد وصول عام لبيانات المرضى.",
                    )}
              </Notice>
              <Link href="/login" className="button button-primary">
                {t("تسجيل دخول الصيدلية")} <ArrowLeft size={17} />
              </Link>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void search();
              }}
            >
              <fieldset disabled={busy || uncertain} className="rx-medication">
                <legend>{t("هوية المريض")}</legend>
                <div className="rx-grid">
                  <IdentityFields
                    prefix="lookup"
                    value={identity}
                    change={(key, value) => {
                      setIdentity({ ...identity, [key]: value });
                      setMatches([]);
                      setSelected(null);
                      setReceipt(null);
                      setNextOffset(null);
                    }}
                  />
                </div>
              </fieldset>
              <Button type="submit" disabled={busy || uncertain}>
                <Search size={17} />
                {busy ? t("جارٍ البحث…") : t("بحث عن الوصفات")}
              </Button>
            </form>
          )}
        </section>
        {matches.length > 0 && !receipt && (
          <section className="rx-card">
            <h2>{t("الوصفات المؤهلة")}</h2>
            <p className="rx-help">
              {t("اختر حسب الطبيب والعيادة وتاريخ الإصدار.")}
            </p>
            {matches.map((m) => (
              <div className="rx-result" key={m.id}>
                <div>
                  <strong>{m.doctor_name}</strong>
                  <p>
                    {m.clinic_name} · {date(m.issued_at, locale)}
                  </p>
                  <small>
                    {t("صالحة حتى")} {date(m.expires_at, locale)}
                  </small>
                </div>
                <Button
                  disabled={busy || uncertain}
                  variant="secondary"
                  onClick={() => select(m)}
                  aria-pressed={selected?.prescription_id === m.id}
                >
                  {t("اختيار الوصفة")}{" "}
                </Button>
              </div>
            ))}
            {nextOffset !== null && (
              <Button
                disabled={busy || uncertain}
                variant="secondary"
                onClick={() => search(nextOffset)}
              >
                {t("النتائج التالية")}{" "}
              </Button>
            )}
          </section>
        )}
        {selected && !receipt && (
          <section className="rx-card">
            <div className="rx-section-title">
              <ClipboardList />
              <div>
                <h2>{t("مراجعة الوصفة المختارة")}</h2>
                <p>
                  {selected.patient.name} · {date(selected.issued_at, locale)}
                </p>
              </div>
            </div>
            {selected.items.map((m, i) => (
              <div className="rx-review-med" key={i}>
                <strong>
                  <bdi>
                    {m.medication_name} · {m.strength}
                  </bdi>
                </strong>
                <p>
                  {m.dose} · {m.frequency} · {m.duration}
                  {t("· الكمية")} {m.quantity}
                </p>
                <p>{m.special_instructions}</p>
              </div>
            ))}
            <label className="rx-checkbox">
              <input
                type="checkbox"
                checked={identityConfirmed}
                disabled={busy || uncertain}
                onChange={(e) => setIdentityConfirmed(e.target.checked)}
              />
              {t(
                "تحققت من هوية المريض بصورة مستقلة؛ رقم الهوية وحده لا يكفي.",
              )}{" "}
            </label>
            <label className="rx-checkbox">
              <input
                type="checkbox"
                checked={fullConfirmed}
                disabled={busy || uncertain}
                onChange={(e) => setFullConfirmed(e.target.checked)}
              />
              {t(
                "أؤكد صرف جميع الأدوية والكميات كاملة؛ لا يوجد صرف جزئي أو إعادة صرف.",
              )}{" "}
            </label>
            <Button
              disabled={busy || !identityConfirmed || !fullConfirmed}
              onClick={dispense}
            >
              {busy
                ? t("جارٍ تأكيد النتيجة…")
                : uncertain
                  ? t("إعادة نفس طلب الصرف")
                  : t("تأكيد الصرف الكامل")}
            </Button>
          </section>
        )}
        {receipt && (
          <section className="rx-card">
            <h2>{t("تم تأكيد الصرف الكامل")}</h2>
            <p>
              {t(
                "الإيصال محفوظ في قاعدة البيانات. لا يمكن صرف الوصفة مرة أخرى.",
              )}
            </p>
            <dl className="rx-details">
              <div>
                <dt>{t("مرجع الصرف")}</dt>
                <dd>
                  <bdi>{receipt.id}</bdi>
                </dd>
              </div>
              <div>
                <dt>{t("الوصفة")}</dt>
                <dd>
                  <bdi>{receipt.prescription_id}</bdi>
                </dd>
              </div>
            </dl>
          </section>
        )}
      </div>
      <aside className="rx-aside">
        <section className="rx-card rx-context">
          {!!name && <SignOutButton />}
          <span className="rx-icon">
            <Store size={25} />
          </span>
          <h2>{t("رعاية أفضل، بلا رسوم للصيدلية.")}</h2>
          <p>
            {name ||
              t(
                "وصول معتمد للوصفة المطلوبة، دون دليل مرضى أو سجل سريري غير مرتبط.",
              )}
          </p>
          <Button
            variant="secondary"
            disabled={busy || !name}
            onClick={recover}
          >
            {t("استرجاع إيصال الصرف")}{" "}
          </Button>
        </section>
        <section className="rx-guidance">
          <h3>
            <ShieldCheck size={18} />
            {t("قبل الصرف")}{" "}
          </h3>
          <ul>
            <li>
              <Check size={16} />
              {t("اختر الوصفة حسب الطبيب والتاريخ.")}{" "}
            </li>
            <li>
              <Check size={16} />
              {t("تحقق من هوية المريض.")}{" "}
            </li>
            <li>
              <Check size={16} />
              {t("راجع جميع الأدوية والكميات.")}{" "}
            </li>
          </ul>
          <p>{t("تُحسم الصلاحية ومنع تكرار الصرف داخل قاعدة البيانات.")}</p>
        </section>
      </aside>
    </div>
  );
}
