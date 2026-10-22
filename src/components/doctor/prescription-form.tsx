"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  UserRound,
  Pill,
  Plus,
  Trash2,
  ClipboardCheck,
  Pencil,
  Info,
} from "lucide-react";
import { BackLink, Button, Field, PageHeading } from "@/components/ui";
import { DraftDocument } from "./draft-document";
import { findPatients, saveDraft } from "@/lib/drafts/actions";
import {
  MAX_ITEMS,
  itemFields,
  validateDraft,
  type DraftItem,
  type DraftRecord,
  type PatientOption,
} from "@/lib/drafts/validation";

const blank = (): DraftItem => ({
  medication_name: "",
  strength: "",
  dose: "",
  frequency: "",
  duration: "",
  quantity: 0,
  special_instructions: "",
});

export function PrescriptionForm({
  initial,
  requestId,
  doctorEmail,
}: {
  initial?: DraftRecord;
  requestId: string;
  doctorEmail: string;
}) {
  const router = useRouter();
  const [patientMode, setPatientMode] = useState(initial ? "existing" : "new");
  const [patient, setPatient] = useState<PatientOption | null>(
    initial?.patient ?? null,
  );
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [search, setSearch] = useState("");
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [patientMessage, setPatientMessage] = useState("");
  const [searching, setSearching] = useState(false);
  const [items, setItems] = useState<DraftItem[]>(initial?.items ?? [blank()]);
  const [notes, setNotes] = useState(initial?.doctor_notes ?? "");
  const [reviewing, setReviewing] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const saving = useRef(false);
  const searchingRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  // An action response can refresh server props. Keep the editor's original
  // version and create token until explicit navigation/reload, including failures.
  const [editorIdentity] = useState(() => ({
    requestId,
    expectedUpdatedAt: initial?.updated_at ?? null,
  }));
  const input = {
    requestId: editorIdentity.requestId,
    prescriptionId: initial?.id ?? null,
    expectedUpdatedAt: editorIdentity.expectedUpdatedAt,
    patient:
      patientMode === "existing"
        ? { id: patient?.id ?? "" }
        : { name, patient_identifier: identifier },
    doctorNotes: notes,
    items,
  };
  const [baseline] = useState(() => JSON.stringify(input));
  const dirty = JSON.stringify(input) !== baseline;

  useEffect(() => {
    if (reviewing) {
      reviewHeading.current?.focus();
      window.scrollTo(0, 0);
    }
  }, [reviewing]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      if (!saving.current) event.preventDefault();
    };
    const navigate = (event: MouseEvent) => {
      const anchor = (event.target as Element)?.closest?.("a[href]");
      if (
        anchor &&
        !saving.current &&
        !window.confirm("لديك تغييرات غير محفوظة. مغادرة النموذج؟")
      )
        event.preventDefault();
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty]);
  function review(event: FormEvent) {
    event.preventDefault();
    const result = validateDraft(input);
    setErrors(result.errors);
    setMessage("");
    if (!result.data) {
      setMessage("صحّح الحقول الموضحة قبل المراجعة.");
      const key = Object.keys(result.errors)[0];
      formRef.current?.querySelector<HTMLElement>(`[id="${key}"]`)?.focus();
    } else setReviewing(true);
  }
  async function save() {
    if (saving.current) return;
    saving.current = true;
    setPending(true);
    setMessage("");
    try {
      const result = await saveDraft(input);
      if (result.id) {
        router.replace(`/doctor/prescriptions/${result.id}?saved=1`);
        router.refresh();
        return;
      }
      setErrors(result.errors ?? {});
      setMessage(result.message);
    } catch {
      setMessage(
        "تعذّر تأكيد الحفظ. أعد المحاولة بنفس النموذج؛ لا تنشئ طلبًا جديدًا حتى تتحقق من اللوحة.",
      );
    }
    saving.current = false;
    setPending(false);
  }
  async function searchPatients() {
    if (searchingRef.current) return;
    searchingRef.current = true;
    setSearching(true);
    try {
      const result = await findPatients(search);
      setPatients(result.patients);
      setPatientMessage(result.message);
    } catch {
      setPatientMessage("تعذّر تحميل المرضى. أعد المحاولة.");
    } finally {
      setSearching(false);
      searchingRef.current = false;
    }
  }
  const selected =
    patientMode === "existing"
      ? patient
      : { id: "", name, patient_identifier: identifier };
  if (reviewing)
    return (
      <>
        <BackLink />
        <div className="review-heading">
          <div className="eyebrow">مسودة / مراجعة قبل الحفظ</div>
          <h1 ref={reviewHeading} tabIndex={-1}>
            مراجعة المسودة
          </h1>
          <p>
            {initial
              ? "التعديلات المعروضة لم تُحفظ بعد."
              : "هذه المسودة لم تُحفظ بعد."}{" "}
            الحفظ لا يُصدر وصفة أو رمز صرف.
          </p>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => setReviewing(false)}
          >
            <Pencil size={17} />
            العودة للتعديل
          </Button>
        </div>
        <DraftDocument
          patient={selected!}
          items={items}
          notes={notes}
          doctorEmail={doctorEmail}
          savedAt={null}
        />
        <div className="form-action-bar no-print">
          <p>
            <Info size={18} />
            مسودة غير صالحة للصرف — بيانات اصطناعية فقط خلال الاختبار.
          </p>
          <Button disabled={pending} onClick={save}>
            {pending ? "جارٍ الحفظ…" : "حفظ المسودة"}
          </Button>
        </div>
        {message && (
          <p className="feedback-message" role="alert">
            {message}
          </p>
        )}
        {Object.keys(errors).length > 0 && (
          <p role="alert">ارجع للتعديل لتصحيح الحقول.</p>
        )}
      </>
    );
  return (
    <>
      <BackLink />
      <PageHeading
        eyebrow="مساحة الطبيب / مسودة"
        title={initial ? "تعديل المسودة" : "إنشاء مسودة"}
        description="حفظ فعلي لبيانات المريض والمسودة والأدوية معًا. استخدم بيانات اصطناعية فقط أثناء الاختبار."
      />
      <p className="review-notice" role="status">
        {dirty
          ? "تغييرات غير محفوظة"
          : initial
            ? "النسخة المحفوظة — لم تُصدر"
            : "مسودة جديدة غير محفوظة"}
      </p>
      <form
        ref={formRef}
        noValidate
        onSubmit={review}
        className="prescription-form"
      >
        <section className="panel form-section">
          <div className="section-heading">
            <div className="section-icon">
              <UserRound size={21} />
            </div>
            <div>
              <h2>بيانات المريض</h2>
              <p>
                اختيار المريض لا يغيّر اسمه أو معرّفه في السجل. لا توجد خدمة
                تصحيح هوية في هذه المرحلة.
              </p>
            </div>
          </div>
          <Field id="patientMode" label="اختيار المريض" error={errors.patient}>
            <select
              className="input"
              id="patientMode"
              value={patientMode}
              onChange={(e) => {
                setPatientMode(e.target.value);
                setPatientMessage("");
              }}
            >
              <option value="new">مريض جديد</option>
              <option value="existing">مريض مسجل</option>
            </select>
          </Field>
          {patientMode === "new" ? (
            <div className="form-grid patient-form-grid">
              <Field
                id="patientName"
                label="اسم المريض"
                error={errors.patientName}
              >
                <input
                  className="input"
                  id="patientName"
                  maxLength={200}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="off"
                />
              </Field>
              <Field
                id="patientIdentifier"
                label="معرّف المريض (اختياري)"
                error={errors.patientIdentifier}
                hint="معرّف داخلي اختياري؛ ليس رمز صرف ولا رقمًا قوميًّا مطلوبًا."
              >
                <input
                  className="input"
                  id="patientIdentifier"
                  maxLength={120}
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  autoComplete="off"
                />
              </Field>
              <p>ينشأ سجل المريض فقط عند نجاح حفظ المسودة بالكامل.</p>
            </div>
          ) : (
            <>
              <div className="form-grid patient-form-grid">
                <Field id="patientSearch" label="البحث عن مريض بالاسم">
                  <input
                    className="input"
                    id="patientSearch"
                    value={search}
                    maxLength={120}
                    onChange={(e) => setSearch(e.target.value)}
                    autoComplete="off"
                  />
                </Field>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={searching}
                  onClick={searchPatients}
                >
                  {searching ? "جارٍ البحث…" : "بحث عن مريض"}
                </Button>
              </div>
              <p role="status">{patientMessage}</p>
              {patients.length > 0 && (
                <ul className="patient-options">
                  {patients.map((p) => (
                    <li key={p.id}>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setPatient(p);
                          setPatients([]);
                        }}
                      >
                        {p.name} — {p.patient_identifier ?? "بلا معرّف"}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {patient && (
                <p className="review-notice">
                  المريض المختار: {patient.name} —{" "}
                  {patient.patient_identifier ?? "بلا معرّف"}. حقول الهوية
                  للقراءة فقط.
                </p>
              )}
            </>
          )}
        </section>
        <section className="panel form-section">
          <div className="section-heading">
            <div className="section-icon">
              <Pill size={21} />
            </div>
            <div>
              <h2>الأدوية والتعليمات</h2>
              <p>من دواء واحد إلى ٣٠ دواءً؛ لا توجد عملية إصدار أو صرف.</p>
            </div>
          </div>
          {errors.items && <p role="alert">{errors.items}</p>}
          <div className="medication-editors">
            {items.map((item, index) => (
              <fieldset className="medication-editor" key={index}>
                <legend>الدواء {index + 1}</legend>
                <div className="medication-editor-top">
                  <span>تفاصيل الدواء</span>
                  <Button
                    type="button"
                    variant="danger"
                    disabled={items.length === 1}
                    aria-label={`حذف الدواء ${index + 1}`}
                    onClick={() =>
                      setItems((current) =>
                        current.filter((_, i) => i !== index),
                      )
                    }
                  >
                    <Trash2 size={16} />
                    حذف الدواء
                  </Button>
                </div>
                <div className="form-grid medication-form-grid">
                  {Object.entries(itemFields).map(([key, { label, max }]) => {
                    const field = key as keyof typeof itemFields;
                    const id = `${index}-${key}`;
                    return (
                      <Field key={key} id={id} label={label} error={errors[id]}>
                        <input
                          className="input"
                          id={id}
                          maxLength={max}
                          value={item[field]}
                          autoComplete="off"
                          onChange={(e) =>
                            setItems((current) =>
                              current.map((m, i) =>
                                i === index
                                  ? { ...m, [key]: e.target.value }
                                  : m,
                              ),
                            )
                          }
                        />
                      </Field>
                    );
                  })}
                  <Field
                    id={`${index}-quantity`}
                    label="الكمية"
                    error={errors[`${index}-quantity`]}
                  >
                    <input
                      className="input"
                      id={`${index}-quantity`}
                      type="number"
                      min={1}
                      max={1000000}
                      step={1}
                      value={item.quantity || ""}
                      onChange={(e) =>
                        setItems((current) =>
                          current.map((m, i) =>
                            i === index
                              ? { ...m, quantity: Number(e.target.value) }
                              : m,
                          ),
                        )
                      }
                    />
                  </Field>
                </div>
              </fieldset>
            ))}
          </div>
          <Button
            type="button"
            variant="secondary"
            className="add-medication"
            disabled={items.length >= MAX_ITEMS}
            onClick={() => setItems((current) => [...current, blank()])}
          >
            <Plus size={18} />
            إضافة دواء آخر
          </Button>
        </section>
        <section className="panel form-section">
          <Field
            id="doctorNotes"
            label="ملاحظات الطبيب (اختياري)"
            error={errors.doctorNotes}
          >
            <textarea
              className="input"
              id="doctorNotes"
              maxLength={4000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </Field>
        </section>
        {message && (
          <p className="feedback-message" role="alert">
            {message}
          </p>
        )}
        <div className="form-action-bar">
          <p>
            <Info size={18} />
            المراجعة لا تحفظ التغييرات.
          </p>
          <Button type="submit">
            <ClipboardCheck size={19} />
            مراجعة المسودة
          </Button>
        </div>
      </form>
    </>
  );
}
