"use client";
import Link from "next/link";
import { Button } from "@/components/ui";
export default function DoctorError({ reset }: { reset: () => void }) {
  return (
    <section className="panel form-section" role="alert">
      <h1>تعذّر تحميل سجلات الطبيب</h1>
      <p>لم تُعرض بيانات بديلة أو وهمية. تحقق من الاتصال ثم أعد المحاولة.</p>
      <Button onClick={reset}>إعادة المحاولة</Button>
      <Link href="/doctor">العودة إلى لوحة الطبيب</Link>
    </section>
  );
}
