"use client";
import { useI18n } from "@/lib/i18n/client";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui";

export function PrintButton() {
  const { t } = useI18n();
  return (
    <Button
      variant="secondary"
      className="no-print"
      onClick={() => window.print()}
    >
      <Printer size={18} />
      {t("طباعة المسودة غير المُصدرة")}{" "}
    </Button>
  );
}
