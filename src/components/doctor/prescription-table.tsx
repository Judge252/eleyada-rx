"use client";
import { useI18n } from "@/lib/i18n/client";
import Link from "next/link";
import { useState } from "react";
import { Search, ArrowUpLeft, FileSearch } from "lucide-react";

export type DoctorRow = {
  id: string;
  status: string;
  created_at: string;
  patient: {
    id: string;
    name: string;
    patient_identifier: string | null;
  } | null;
  items: { id: string }[];
  dispensations?: { id: string; dispensed_at: string }[];
};
export const stateLabel: Record<string, string> = {
  draft: "مسودة غير مُصدرة",
  issued: "مُصدرة — للقراءة فقط",
  cancelled: "ملغاة — للقراءة فقط",
  expired: "منتهية — للقراءة فقط",
};
export function PrescriptionTable({
  rows,
  total,
  page,
}: {
  rows: DoctorRow[];
  total: number;
  page: number;
}) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const filtered = rows.filter(
    (row) =>
      (status === "all" || row.status === status) &&
      `${row.patient?.name ?? ""} ${row.patient?.patient_identifier ?? ""}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <section className="panel prescriptions-panel" id="prescriptions">
      <div className="panel-title">
        <div>
          <h2>
            {t("سجلات الطبيب")} <span className="count-badge">{total}</span>
          </h2>
          <p>
            {t(
              "سجلات قاعدة البيانات — البحث والفلاتر في الصفحة الحالية (٢٥ سجلًا كحد أقصى).",
            )}{" "}
          </p>
        </div>
        <span className="subtle-tag">{t("المسودة غير صالحة للصرف")}</span>
      </div>
      <div className="table-toolbar">
        <div className="search-box">
          <Search size={18} />
          <label className="sr-only" htmlFor="prescription-search">
            {t("البحث في الوصفات")}{" "}
          </label>
          <input
            id="prescription-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={200}
            placeholder={t("اسم أو معرّف المريض في هذه الصفحة…")}
            autoComplete="off"
          />
        </div>
        <div className="filter-control">
          <label htmlFor="status-filter">{t("الحالة")}</label>
          <select
            id="status-filter"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">{t("جميع الحالات")}</option>
            {Object.entries(stateLabel).map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label={t("جدول سجلات الطبيب")}
      >
        <table>
          <caption className="sr-only">
            {t("سجلات محفوظة من قاعدة البيانات")}
          </caption>
          <thead>
            <tr>
              <th>{t("المريض")}</th>
              <th>{t("تاريخ الإنشاء")}</th>
              <th>{t("الأدوية")}</th>
              <th>{t("الحالة")}</th>
              <th>{t("الصرف الكامل")}</th>
              <th>{t("التفاصيل")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, index) => (
              <tr key={row.id}>
                <td>
                  <div className="patient-cell">
                    <span className={`patient-avatar avatar-${index % 3}`}>
                      {row.patient?.name.slice(0, 1)}
                    </span>
                    <div>
                      <strong>{row.patient?.name ?? t("غير متاح")}</strong>
                      <span>
                        {row.patient?.patient_identifier ?? t("بلا معرّف")}
                      </span>
                    </div>
                  </div>
                </td>
                <td>
                  {new Intl.DateTimeFormat(
                    locale === "he" ? "he-IL" : "en-GB",
                    {
                      dateStyle: "medium",
                      timeZone: "Africa/Cairo",
                    },
                  ).format(new Date(row.created_at))}
                </td>
                <td>{row.items.length}</td>
                <td>
                  <span className="subtle-tag">
                    {t(stateLabel[row.status])}
                  </span>
                </td>
                <td>
                  <span className="subtle-tag">
                    {row.dispensations?.length
                      ? t("مصروفة بالكامل")
                      : t("لم يُسجل صرف")}
                  </span>
                </td>
                <td>
                  <Link
                    className="table-action"
                    href={`/doctor/prescriptions/${row.id}`}
                    aria-label={
                      t("عرض مسودة") + " " + (row.patient?.name ?? "")
                    }
                  >
                    <ArrowUpLeft size={19} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 && (
        <div className="empty-state" role="status">
          <FileSearch size={30} />
          <h3>
            {total === 0
              ? t("لا توجد مسودات محفوظة بعد")
              : t("لا توجد سجلات مطابقة في هذه الصفحة")}
          </h3>
          <p>
            {total === 0
              ? t("ابدأ بمسودة جديدة؛ لا توجد بيانات توضيحية في لوحة الطبيب.")
              : t("غيّر البحث أو الفلتر أو انتقل إلى صفحة أخرى.")}
          </p>
          <Link href="/doctor/prescriptions/new">{t("إنشاء مسودة")}</Link>
        </div>
      )}
      <div className="table-footer">
        <span>
          {t("صفحة")} {page}
          {t("• عرض")} {filtered.length}
          {t("من")} {rows.length}
          {t("سجلًا في الصفحة")}{" "}
        </span>
        <nav aria-label={t("صفحات سجلات الطبيب")}>
          {page > 1 && (
            <Link href={`/doctor?page=${page - 1}`}>{t("السابق")}</Link>
          )}
          {page * 25 < total && (
            <Link href={`/doctor?page=${page + 1}`}>{t("التالي")}</Link>
          )}
        </nav>
      </div>
    </section>
  );
}
