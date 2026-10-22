"use client";
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
            سجلات الطبيب <span className="count-badge">{total}</span>
          </h2>
          <p>
            سجلات قاعدة البيانات — البحث والفلاتر في الصفحة الحالية (٢٥ سجلًا
            كحد أقصى).
          </p>
        </div>
        <span className="subtle-tag">المسودة غير صالحة للصرف</span>
      </div>
      <div className="table-toolbar">
        <div className="search-box">
          <Search size={18} />
          <label className="sr-only" htmlFor="prescription-search">
            البحث في الوصفات
          </label>
          <input
            id="prescription-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={200}
            placeholder="اسم أو معرّف المريض في هذه الصفحة…"
            autoComplete="off"
          />
        </div>
        <div className="filter-control">
          <label htmlFor="status-filter">الحالة</label>
          <select
            id="status-filter"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">جميع الحالات</option>
            {Object.entries(stateLabel).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="جدول سجلات الطبيب"
      >
        <table>
          <caption className="sr-only">سجلات محفوظة من قاعدة البيانات</caption>
          <thead>
            <tr>
              <th>المريض</th>
              <th>تاريخ الإنشاء</th>
              <th>الأدوية</th>
              <th>الحالة</th>
              <th>الصرف الكامل</th>
              <th>التفاصيل</th>
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
                      <strong>{row.patient?.name ?? "غير متاح"}</strong>
                      <span>
                        {row.patient?.patient_identifier ?? "بلا معرّف"}
                      </span>
                    </div>
                  </div>
                </td>
                <td>
                  {new Intl.DateTimeFormat("ar-EG", {
                    dateStyle: "medium",
                    timeZone: "Africa/Cairo",
                  }).format(new Date(row.created_at))}
                </td>
                <td>{row.items.length}</td>
                <td>
                  <span className="subtle-tag">{stateLabel[row.status]}</span>
                </td>
                <td>
                  <span className="subtle-tag">
                    {row.dispensations?.length
                      ? "مصروفة بالكامل"
                      : "لم يُسجل صرف"}
                  </span>
                </td>
                <td>
                  <Link
                    className="table-action"
                    href={`/doctor/prescriptions/${row.id}`}
                    aria-label={`عرض مسودة ${row.patient?.name ?? ""}`}
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
              ? "لا توجد مسودات محفوظة بعد"
              : "لا توجد سجلات مطابقة في هذه الصفحة"}
          </h3>
          <p>
            {total === 0
              ? "ابدأ بمسودة جديدة؛ لا توجد بيانات توضيحية في لوحة الطبيب."
              : "غيّر البحث أو الفلتر أو انتقل إلى صفحة أخرى."}
          </p>
          <Link href="/doctor/prescriptions/new">إنشاء مسودة</Link>
        </div>
      )}
      <div className="table-footer">
        <span>
          صفحة {page} • عرض {filtered.length} من {rows.length} سجلًا في الصفحة
        </span>
        <nav aria-label="صفحات سجلات الطبيب">
          {page > 1 && <Link href={`/doctor?page=${page - 1}`}>السابق</Link>}
          {page * 25 < total && (
            <Link href={`/doctor?page=${page + 1}`}>التالي</Link>
          )}
        </nav>
      </div>
    </section>
  );
}
