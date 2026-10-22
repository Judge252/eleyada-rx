import { LoginForm } from "@/components/login-form";
import { getAccount } from "@/lib/auth/server";
import { roleHome } from "@/lib/auth/access";
import { redirect } from "next/navigation";

export default async function Login({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const account = await getAccount();
  if (account) redirect(roleHome(account.role));
  const { reason } = await searchParams;
  return <LoginForm accessDenied={reason === "access"} />;
}
