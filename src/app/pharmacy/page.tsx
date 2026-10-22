import { PharmacyDashboard } from "@/components/pharmacy/pharmacy-dashboard";
import { requireRole } from "@/lib/auth/server";

export default async function Pharmacy() {
  const account = await requireRole("pharmacist");
  return <PharmacyDashboard pharmacyName={account.pharmacy!.name} />;
}
