import "server-only";
import { requireRole } from "@/lib/auth/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { type Review, type Lifecycle, lifecycleError } from "./validation";
export async function getIssueReview(
  id: string,
): Promise<{ review?: Review; message?: string }> {
  await requireRole("doctor");
  try {
    const client = await createServerSupabaseClient();
    const result = await client
      .rpc("get_doctor_issue_review", { p_id: id })
      .abortSignal(AbortSignal.timeout(10_000));
    if (result.error) return { message: lifecycleError(result.error.code) };
    return { review: result.data as unknown as Review };
  } catch {
    return { message: lifecycleError() };
  }
}
export async function getLifecycle(id: string): Promise<Lifecycle | null> {
  await requireRole("doctor");
  try {
    const client = await createServerSupabaseClient();
    const result = await client
      .rpc("get_doctor_lifecycle", { p_id: id })
      .abortSignal(AbortSignal.timeout(10_000));
    return result.error ? null : (result.data as unknown as Lifecycle);
  } catch {
    return null;
  }
}
