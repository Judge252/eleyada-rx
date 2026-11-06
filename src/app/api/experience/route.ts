import { localizeMessages } from "@/lib/i18n/server";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAccount } from "@/lib/auth/server";
import { sameOrigin } from "@/lib/issuance/validation";
import { object } from "@/lib/drafts/validation";
import {
  accessInput,
  formPayload,
  messages,
  normalizedIdentity,
  validRequestId,
} from "@/lib/experience/contracts";
import { passwordless } from "@/lib/experience/passwordless";

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
    const access = accessInput(input);
    if (["challenge", "verify", "onboard"].includes(String(input.operation))) {
      if (!access) return failure("22023");
      const result = await passwordless(
        client,
        access,
        process.env.RX_PASSWORDLESS_ENABLED === "true",
      );
      if (result.state === "unavailable") return failure();
      if (result.state === "unauthorized") return failure("42501");
      return response(result);
    }
    const account = await getAccount();
    if (!account) return failure("42501");
    let result;
    const exact = (keys: string[]) =>
      Object.keys(input).length === keys.length &&
      Object.keys(input).every((k) => keys.includes(k));
    if (input.operation === "context" && exact(["operation"])) {
      if (account.role === "pharmacist")
        return response({
          state: "pharmacist",
          pharmacy: account.pharmacy,
          actorId: account.id,
        });
      result = await client.rpc("get_prescriber_context");
    } else if (
      input.operation === "issue" &&
      account.role === "doctor" &&
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
    } else if (
      input.operation === "recoverIssue" &&
      account.role === "doctor" &&
      exact(["operation", "requestId"]) &&
      validRequestId(input.requestId)
    ) {
      result = await client.rpc("recover_form_receipt", {
        p_request_id: input.requestId,
      });
    } else if (
      input.operation === "search" &&
      account.role === "pharmacist" &&
      exact(["operation", "country", "type", "identifier", "offset"])
    ) {
      const identity = normalizedIdentity(input);
      if (
        !identity ||
        !Number.isInteger(input.offset) ||
        Number(input.offset) < 0 ||
        Number(input.offset) > 10000
      )
        return failure("22023");
      result = await client
        .rpc("search_pharmacy_identity", {
          p_country: identity.country,
          p_type: identity.type,
          p_identifier: identity.identifier,
          p_offset: Number(input.offset),
        })
        .abortSignal(AbortSignal.timeout(10000));
    } else if (
      input.operation === "select" &&
      account.role === "pharmacist" &&
      exact(["operation", "searchId", "prescriptionId"]) &&
      validRequestId(input.searchId) &&
      validRequestId(input.prescriptionId)
    ) {
      result = await client
        .rpc("select_pharmacy_prescription", {
          p_search_id: input.searchId,
          p_prescription_id: input.prescriptionId,
        })
        .abortSignal(AbortSignal.timeout(10000));
    } else if (
      input.operation === "dispense" &&
      account.role === "pharmacist" &&
      exact([
        "operation",
        "requestId",
        "lookupId",
        "prescriptionId",
        "identityConfirmed",
        "fullConfirmed",
      ]) &&
      validRequestId(input.requestId) &&
      validRequestId(input.lookupId) &&
      validRequestId(input.prescriptionId) &&
      input.identityConfirmed === true &&
      input.fullConfirmed === true
    ) {
      result = await client
        .rpc("dispense_pharmacy_prescription", {
          p_request_id: input.requestId,
          p_lookup_id: input.lookupId,
          p_prescription_id: input.prescriptionId,
          p_identity_confirmed: true,
          p_full_confirmed: true,
        })
        .abortSignal(AbortSignal.timeout(10000));
    } else if (
      input.operation === "recoverDispense" &&
      account.role === "pharmacist" &&
      exact(["operation", "requestId"]) &&
      validRequestId(input.requestId)
    ) {
      result = await client.rpc("recover_dispensing_receipt", {
        p_request_id: input.requestId,
      });
    } else return failure("22023");
    const data = result.data as { code?: string } | null;
    if (result.error || data?.code)
      return failure(result.error?.code ?? data?.code);
    return response({ result: result.data });
  } catch {
    return failure();
  }
}
