import { localizeMessages } from "@/lib/i18n/server";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAccount } from "@/lib/auth/server";
import { sameOrigin } from "@/lib/issuance/validation";
import { object } from "@/lib/drafts/validation";
import {
  formPayload,
  lookupInput,
  messages,
  validRequestId,
} from "@/lib/experience/contracts";
import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";
async function response(body: unknown, status = 200) {
  return NextResponse.json(await localizeMessages(body), {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      Vary: "Cookie, Origin",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
function failure(code?: string) {
  const state =
    code === "42501"
      ? "unauthorized"
      : code === "PT402"
        ? "inactive"
        : code === "PT429"
          ? "throttled"
          : code === "PT404"
            ? "notFound"
          : code === "PT409"
            ? "conflict"
            : code === "22023" || code?.startsWith("23")
              ? "validation"
              : "unavailable";
  return response(
    { state, message: messages[state] },
    {
      unauthorized: 403,
      inactive: 402,
      throttled: 429,
      conflict: 409,
      notFound: 404,
      validation: 400,
      unavailable: 503,
    }[state],
  );
}
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
    return failure("42501");
  let input: Record<string, unknown>;
  try {
    const reader = request.body?.getReader();
    if (!reader) return failure("22023");
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 98304) {
        await reader.cancel();
        return response(
          { state: "validation", message: messages.validation },
          413,
        );
      }
      chunks.push(part.value);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!object(value)) return failure("22023");
    input = value;
  } catch {
    return failure("22023");
  }
  try {
    const client = await createServerSupabaseClient();
    const exact = (keys: string[]) =>
      Object.keys(input).length === keys.length &&
      Object.keys(input).every((k) => keys.includes(k));
    // Public pharmacy capability: no account. Budgets and proofs live in the database.
    // The client bucket is advisory only (an attacker can rotate it); per-ID/global budgets are authoritative.
    const forwarded = (request.headers.get("x-forwarded-for") ?? "")
      .split(",")[0]
      .trim();
    const bucket = createHash("sha256")
      .update("clinic-rx|client|" + (forwarded || request.headers.get("x-real-ip") || "unknown"))
      .digest("hex");
    if (input.operation === "lookup" && exact(["operation", "identifier", "code"])) {
      const proof = lookupInput(input);
      if (!proof) return failure("22023");
      const result = await client
        .rpc("public_lookup_prescription", {
          p_identifier: proof.identifier,
          p_code: proof.code,
          p_client: bucket,
        })
        .abortSignal(AbortSignal.timeout(10000));
      const data = result.data as { code?: string } | null;
      if (result.error || data?.code)
        return failure(result.error?.code ?? data?.code);
      return response({ result: result.data });
    }
    if (
      input.operation === "dispense" &&
      exact([
        "operation",
        "requestId",
        "lookupId",
        "prescriptionId",
        "identityConfirmed",
        "fullConfirmed",
        "pharmacyLabel",
      ]) &&
      validRequestId(input.requestId) &&
      validRequestId(input.lookupId) &&
      validRequestId(input.prescriptionId) &&
      input.identityConfirmed === true &&
      input.fullConfirmed === true &&
      typeof input.pharmacyLabel === "string" &&
      input.pharmacyLabel.length <= 120
    ) {
      const result = await client
        .rpc("public_dispense_prescription", {
          p_request_id: input.requestId,
          p_lookup_id: input.lookupId,
          p_prescription_id: input.prescriptionId,
          p_identity_confirmed: true,
          p_full_confirmed: true,
          p_pharmacy_label: input.pharmacyLabel,
        })
        .abortSignal(AbortSignal.timeout(10000));
      const data = result.data as { code?: string } | null;
      if (result.error || data?.code)
        return failure(result.error?.code ?? data?.code);
      return response({ result: result.data });
    }
    if (
      input.operation === "recoverDispense" &&
      exact(["operation", "requestId", "lookupId"]) &&
      validRequestId(input.requestId) &&
      validRequestId(input.lookupId)
    ) {
      const result = await client.rpc("public_recover_dispensing", {
        p_request_id: input.requestId,
        p_lookup_id: input.lookupId,
      });
      const data = result.data as { code?: string } | null;
      if (result.error || data?.code)
        return failure(result.error?.code ?? data?.code);
      return response({ result: result.data });
    }
    // Doctor operations: Supabase Auth session + server/database authorization on every call.
    const account = await getAccount();
    if (!account || account.role !== "doctor") return failure("42501");
    let result;
    const reveal = async (id: unknown) => {
      if (typeof id !== "string") return null;
      const revealed = await client.rpc("reveal_doctor_short_code", { p_id: id });
      return revealed.error
        ? null
        : ((revealed.data as { code?: string } | null)?.code ?? null);
    };
    if (input.operation === "context" && exact(["operation"])) {
      result = await client.rpc("get_prescriber_context");
    } else if (
      input.operation === "issue" &&
      exact([
        "operation",
        "requestId",
        "payload",
        "confirmed",
        "reviewedDoctorId",
        "reviewedClinicId",
      ])
    ) {
      const payload = formPayload(input.payload);
      if (
        !payload ||
        !validRequestId(input.requestId) ||
        input.confirmed !== true
      )
        return failure("22023");
      if (input.reviewedDoctorId !== account.id) return failure("42501");
      const reviewedContext = await client.rpc("get_prescriber_context");
      if (
        reviewedContext.error ||
        (reviewedContext.data as { clinic_id?: string } | null)?.clinic_id !==
          input.reviewedClinicId
      )
        return failure("42501");
      result = await client
        .rpc("issue_form_prescription", {
          p_request_id: input.requestId,
          p_payload: payload,
          p_confirmed: true,
        })
        .abortSignal(AbortSignal.timeout(10000));
      const issued = result.data as { id?: string } | null;
      if (!result.error && issued?.id)
        result = {
          ...result,
          data: { ...issued, accessCode: await reveal(issued.id) },
        };
    } else if (
      input.operation === "recoverIssue" &&
      exact(["operation", "requestId"]) &&
      validRequestId(input.requestId)
    ) {
      result = await client.rpc("recover_form_receipt", {
        p_request_id: input.requestId,
      });
      const recovered = result.data as { id?: string; prescription_id?: string } | null;
      const id = recovered?.prescription_id ?? recovered?.id;
      if (!result.error && id)
        result = { ...result, data: { ...recovered, accessCode: await reveal(id) } };
    } else return failure("22023");
    const data = result.data as { code?: string } | null;
    if (result.error || data?.code)
      return failure(result.error?.code ?? data?.code);
    return response({ result: result.data });
  } catch {
    return failure();
  }
}
