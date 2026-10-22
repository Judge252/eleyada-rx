"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Search, ClipboardCheck, Store, LockKeyhole } from "lucide-react";
import { Button, Field, PageHeading } from "@/components/ui";
import {
  pharmacyError,
  type PharmacyInput,
  type PharmacyResult,
} from "@/lib/pharmacy/validation";
const time = (value: string) =>
  new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "long",
    timeZone: "Africa/Cairo",
  }).format(new Date(value));
export function PharmacyDashboard({ pharmacyName }: { pharmacyName: string }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<PharmacyResult | null>(null);
  const [message, setMessage] = useState("");
  const [identity, setIdentity] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [full, setFull] = useState(false);
  const [pending, setPending] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const busy = useRef(false),
    generation = useRef(0);
  const sealed = useRef<PharmacyInput | null>(null);
  const clear = useCallback(() => {
    generation.current++;
    setQuery("");
    setResult(null);
    setIdentity(false);
    setConfirming(false);
    setFull(false);
    setAttempted(false);
    sealed.current = null;
  }, []);
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === "hidden") clear();
    };
    window.addEventListener("pagehide", clear);
    window.addEventListener("pageshow", clear);
    document.addEventListener("visibilitychange", hide);
    return () => {
      clear();
      window.removeEventListener("pagehide", clear);
      window.removeEventListener("pageshow", clear);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [clear]);
  useEffect(() => {
    if (result?.state !== "eligible") return;
    const delay = Math.max(
      0,
      Math.min(
        Date.parse(result.confirmation_expires_at),
        Date.parse(result.expires_at),
      ) - Date.parse(result.database_time),
    );
    const timer = setTimeout(
      () => {
        clear();
        setMessage("انتهت مهلة المراجعة. أعد البحث قبل التأكيد.");
      },
      Math.min(delay, 2147483647),
    );
    return () => clearTimeout(timer);
  }, [result, clear]);
  async function perform(input: PharmacyInput) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setMessage("");
    const current = generation.current;
    try {
      const response = await fetch("/api/pharmacy/prescriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(12000),
      });
      const body = await response.json();
      if (generation.current !== current) return;
      if (!response.ok) {
        setMessage(body.message ?? pharmacyError());
        return;
      }
      setResult(body.result as PharmacyResult);
      if (input.operation === "dispense") {
        setIdentity(false);
        setConfirming(false);
        setFull(false);
        sealed.current = null;
      }
    } catch {
      if (generation.current === current) setMessage(pharmacyError());
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  function search(event: FormEvent) {
    event.preventDefault();
    if (busy.current || !query.trim()) return;
    const reference = query;
    clear();
    void perform({ operation: "lookup", reference });
  }
  function dispense() {
    if (busy.current || result?.state !== "eligible" || !identity || !full)
      return;
    if (!sealed.current)
      sealed.current = {
        operation: "dispense",
        lookupId: result.lookup_id,
        prescriptionId: result.prescription_id,
        requestId: crypto.randomUUID(),
        identityConfirmed: true,
        fullConfirmed: true,
      };
    setAttempted(true);
    void perform(sealed.current);
  }
  return (
    <>
      <PageHeading
        eyebrow="مساحة الصيدلي"
        title="التحقق من وصفة وصرفها"
        description="أدخل الرمز المقدم من المريض. الصرف كامل فقط بعد مراجعة الهوية وجميع الأدوية."
      />
      <div className="pharmacy-account">
        <Store size={24} />
        <div>
          <strong>{pharmacyName}</strong>
          <p>حساب صيدلي معتمد • صرف كامل مسجل</p>
        </div>
      </div>
      <section className="panel code-search-panel">
        <h2>البحث بالرمز المرجعي</h2>
        <p>الرمز سري. لا تضعه في رابط ولا تشاركه خارج التحقق المصرح به.</p>
        <form
          className="code-search-form"
          autoComplete="off"
          noValidate
          onSubmit={search}
        >
          <Field id="reference-code" label="الرمز المرجعي">
            <input
              id="reference-code"
              className="input code-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={80}
              autoComplete="off"
              spellCheck={false}
              dir="ltr"
              disabled={pending}
            />
          </Field>
          <Button type="submit" disabled={pending || !query.trim()}>
            <Search size={18} />
            {pending ? "جارٍ التحقق…" : "بحث عن الوصفة"}
          </Button>
        </form>
        <p>
          عند إعادة التحميل أو الدخول من جديد، أعد إدخال الرمز للتحقق من الحالة
          الحالية.
        </p>
      </section>
      {message && (
        <p className="feedback-message" role="alert">
          {message}
        </p>
      )}
      {!result && (
        <section className="pharmacy-empty">
          <h2>لا توجد وصفة معروضة</h2>
          <p>لن تظهر بيانات المريض إلا بعد بحث مصرح به برمز صحيح.</p>
        </section>
      )}
      {result?.state === "eligible" && (
        <div className="pharmacy-result">
          <section className="panel form-section">
            <h2>مراجعة الوصفة</h2>
            <p className="readonly-note">
              <LockKeyhole size={16} />
              الأدوية والكميات للقراءة فقط. الأهلية يعاد التحقق منها عند تأكيد
              الصرف.
            </p>
            <div className="document-patient">
              <div>
                <span>اسم المريض</span>
                <strong>{result.patient.name}</strong>
              </div>
              <div>
                <span>معرّف المريض</span>
                <strong>
                  {result.patient.patient_identifier ||
                    "غير مسجل — تحقق من الهوية مباشرة"}
                </strong>
              </div>
              <div>
                <span>الإصدار</span>
                <strong>{time(result.issued_at)}</strong>
              </div>
              <div>
                <span>انتهاء الصلاحية</span>
                <strong>{time(result.expires_at)}</strong>
              </div>
            </div>
            <h3>الأدوية ({result.items.length})</h3>
            {result.items.map((item, index) => (
              <div className="document-medication" key={index}>
                <div className="medication-name">
                  <span className="medication-number">{index + 1}</span>
                  <h3>{item.medication_name}</h3>
                  <span>{item.strength}</span>
                </div>
                <dl className="medication-properties">
                  {[
                    ["الجرعة", item.dose],
                    ["التكرار", item.frequency],
                    ["المدة", item.duration],
                    ["الكمية", item.quantity],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                {item.special_instructions && (
                  <p>{item.special_instructions}</p>
                )}
              </div>
            ))}
          </section>
          <section className="panel dispensing-panel">
            <h2>صرف جميع الأدوية</h2>
            <label className="identity-check">
              <input
                type="checkbox"
                checked={identity}
                disabled={pending || attempted}
                onChange={(e) => {
                  setIdentity(e.target.checked);
                  setConfirming(false);
                  setFull(false);
                }}
              />
              <span>راجعت هوية المريض ومطابقتها للوصفة المعروضة.</span>
            </label>
            {!confirming ? (
              <Button
                disabled={!identity || pending}
                onClick={() => setConfirming(true)}
              >
                <ClipboardCheck size={18} />
                متابعة تأكيد الصرف الكامل
              </Button>
            ) : (
              <div className="confirmation-box">
                <h3>تأكيد صرف الوصفة بالكامل؟</h3>
                <p>
                  سيُسجل الصرف باسم حسابك وصيدليتك، ولا يمكن تعديله أو تكراره.
                  لا يوجد صرف جزئي.
                </p>
                <label className="identity-check">
                  <input
                    type="checkbox"
                    checked={full}
                    disabled={pending || attempted}
                    onChange={(e) => setFull(e.target.checked)}
                  />
                  <span>
                    أؤكد صرف جميع الأدوية والكميات المعروضة دون تعديل.
                  </span>
                </label>
                <Button
                  disabled={!identity || !full || pending}
                  onClick={dispense}
                >
                  {pending
                    ? "جارٍ تأكيد الصرف…"
                    : attempted
                      ? "إعادة محاولة طلب الصرف نفسه"
                      : "تأكيد الصرف الكامل"}
                </Button>
              </div>
            )}
          </section>
        </div>
      )}
      {result && result.state !== "eligible" && (
        <section
          className={
            result.state === "dispensed"
              ? "panel success-message"
              : "panel review-notice"
          }
          role="status"
        >
          <div>
            <h2>
              {result.state === "dispensed"
                ? "الوصفة مصروفة بالكامل"
                : result.state === "cancelled"
                  ? "الوصفة ملغاة — غير صالحة للصرف"
                  : "الوصفة منتهية الصلاحية — غير صالحة للصرف"}
            </h2>
            {result.state === "dispensed" && (
              <p>وقت الصرف المسجل: {time(result.dispensed_at)}</p>
            )}
            <p>لا يمكن تسجيل صرف إضافي لهذه الوصفة.</p>
          </div>
        </section>
      )}
      {result && (
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => {
            clear();
            setMessage("");
          }}
        >
          بدء بحث جديد وإخفاء البيانات
        </Button>
      )}
    </>
  );
}
