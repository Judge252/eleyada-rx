export function getSupabasePublicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Phase 1 previews do not require these values.",
    );
  }
  if (!publishableKey.startsWith("sb_publishable_")) {
    throw new Error(
      "Use a Supabase publishable key. Secret and service-role keys are not accepted.",
    );
  }
  const parsedUrl = new URL(url);
  if (
    parsedUrl.protocol !== "https:" &&
    !(
      parsedUrl.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsedUrl.hostname)
    )
  ) {
    throw new Error("Supabase requires HTTPS, except for local development.");
  }
  return { url, publishableKey };
}
