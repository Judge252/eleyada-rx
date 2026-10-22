import Link from "next/link";
import { Brand } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="standalone-state">
      <Brand />
      <span className="eyebrow">٤٠٤ • الصفحة غير موجودة</span>
      <h1>لم نعثر على هذه الصفحة</h1>
      <p>
        قد يكون رابط الوصفة غير صحيح. عُد إلى لوحة الطبيب لعرض البيانات
        التجريبية.
      </p>
      <Link className="button button-primary" href="/doctor">
        العودة إلى لوحة الطبيب
      </Link>
    </main>
  );
}
