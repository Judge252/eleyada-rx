import { redirect } from "next/navigation";
import { DoctorWorkspace } from "@/components/rx/doctor-workspace";
import { getAccount } from "@/lib/auth/server";

// Prescribing requires a signed-in, approved doctor; everyone else goes to the doctor sign-in.
export default async function Home() {
  const account = await getAccount();
  if (!account) redirect("/login");
  if (account.role !== "doctor") redirect("/portal");
  return <DoctorWorkspace />;
}
