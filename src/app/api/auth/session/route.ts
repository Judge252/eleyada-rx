import { getAccount } from "@/lib/auth/server";
export const dynamic = "force-dynamic";

export async function GET() {
  const account = await getAccount();
  return Response.json(
    account
      ? { role: account.role, id: account.id }
      : { error: "unauthorized" },
    {
      status: account ? 200 : 401,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        Vary: "Cookie",
      },
    },
  );
}
