import { localizeMessages } from "@/lib/i18n/server";
import { NextResponse } from "next/server";
import { getAccount } from "@/lib/auth/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { UUID } from "@/lib/drafts/validation";
import {
  validateLifecycle,
  lifecycleError,
  sameOrigin,
} from "@/lib/issuance/validation";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
async function response(body: unknown, status = 200) {
  return NextResponse.json(await localizeMessages(body), {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      Vary: "Cookie, Origin",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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
  if (!account || account.role !== "doctor")
    return response({ message: lifecycleError("42501") }, 403);
  const { id } = await params;
  if (!UUID.test(id))
    return response({ message: lifecycleError("22023") }, 400);
  let value: unknown;
  try {
    // Stop reading oversized bodies; do not buffer arbitrary input or log it.
    const reader = request.body?.getReader();
    if (!reader) return response({ message: lifecycleError("22023") }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2048) {
        await reader.cancel();
        return response({ message: lifecycleError("22023") }, 413);
      }
      chunks.push(value);
    }
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return response({ message: lifecycleError("22023") }, 400);
  }
  const input = validateLifecycle(value);
  if (!input) return response({ message: lifecycleError("22023") }, 400);
  try {
    const client = await createServerSupabaseClient();
    const rpc =
      input.operation === "issue"
        ? client.rpc("issue_doctor_prescription", {
            p_id: id,
            p_expected_updated_at: input.version,
            p_review_fingerprint: input.fingerprint,
            p_request_id: input.requestId,
          })
        : input.operation === "cancel"
          ? client.rpc("cancel_doctor_prescription", {
              p_id: id,
              p_expected_updated_at: input.version,
              p_request_id: input.requestId,
              p_reason: input.reason,
            })
          : client.rpc("reveal_doctor_reference", { p_id: id });
    const result = await rpc.abortSignal(AbortSignal.timeout(10_000));
    if (result.error)
      return response(
        { message: lifecycleError(result.error.code) },
        result.error.code === "PT409"
          ? 409
          : result.error.code === "42501"
            ? 403
            : result.error.code === "22023"
              ? 400
              : 503,
      );
    if (input.operation !== "reveal") revalidatePath("/doctor", "layout");
    return response({ result: result.data });
  } catch {
    return response({ message: lifecycleError() }, 503);
  }
}
