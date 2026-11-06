import { localizeMessages } from "@/lib/i18n/server";
import { NextResponse } from "next/server";
import { getAccount } from "@/lib/auth/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/issuance/validation";
import { validatePharmacy, pharmacyError } from "@/lib/pharmacy/validation";
export const dynamic = "force-dynamic";
async function response(body: unknown, status = 200) {
  return NextResponse.json(await localizeMessages(body), {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      Vary: "Cookie, Origin",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
    },
  });
}
const errorStatus = (code?: string) =>
  code === "42501"
    ? 403
    : code === "PT404"
      ? 404
      : code === "PT409"
        ? 409
        : code === "PT429"
          ? 429
          : code === "22023"
            ? 400
            : 503;
export async function POST(request: Request) {
  if (
    !sameOrigin(
      request.headers.get("origin"),
      request.headers.get("host"),
      request.headers.get("x-forwarded-proto") ??
        new URL(request.url).protocol.slice(0, -1),
    ) ||
    !request.headers.get("content-type")?.startsWith("application/json")
  )
    return response({ message: "طلب غير مسموح." }, 403);
  const account = await getAccount();
  if (!account || account.role !== "pharmacist" || !account.pharmacy)
    return response({ message: pharmacyError("42501") }, 403);
  let input;
  try {
    const reader = request.body?.getReader();
    if (!reader) return response({ message: pharmacyError("22023") }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 2048) {
        await reader.cancel();
        return response({ message: pharmacyError("22023") }, 413);
      }
      chunks.push(next.value);
    }
    input = validatePharmacy(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
  } catch {
    return response({ message: pharmacyError("22023") }, 400);
  }
  if (!input) return response({ message: pharmacyError("22023") }, 400);
  try {
    const client = await createServerSupabaseClient();
    const rpc =
      input.operation === "lookup"
        ? client.rpc("lookup_pharmacy_prescription", {
            p_reference: input.reference,
          })
        : client.rpc("dispense_pharmacy_prescription", {
            p_lookup_id: input.lookupId,
            p_prescription_id: input.prescriptionId,
            p_request_id: input.requestId,
            p_identity_confirmed: input.identityConfirmed,
            p_full_confirmed: input.fullConfirmed,
          });
    const result = await rpc.abortSignal(AbortSignal.timeout(10000));
    const envelope = result.data as { code?: string; state?: string } | null;
    const code = result.error?.code ?? envelope?.code;
    if (code)
      return response({ message: pharmacyError(code) }, errorStatus(code));
    if (
      !envelope ||
      !["eligible", "cancelled", "expired", "dispensed"].includes(
        envelope.state ?? "",
      )
    )
      return response({ message: pharmacyError() }, 503);
    return response({ result: result.data });
  } catch {
    return response({ message: pharmacyError() }, 503);
  }
}
export function GET() {
  return response({ message: "استخدم طلب POST المصرح به." }, 405);
}
export const HEAD = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
