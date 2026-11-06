import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth/server";

export default async function DoctorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const account = await requireRole("doctor");
  return (
    <AppShell role="doctor" account={account}>
      {children}
    </AppShell>
  );
}
