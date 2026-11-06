import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth/server";

export default async function PharmacyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const account = await requireRole("pharmacist");
  return (
    <AppShell role="pharmacy" account={account}>
      {children}
    </AppShell>
  );
}
