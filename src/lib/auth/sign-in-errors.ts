export const signInUnavailable =
  "تعذّر الاتصال بخدمة الدخول. قد تكون الخدمة متوقفة مؤقتًا. حاول لاحقًا أو تواصل مع مسؤول العيادة.";

// Provider/network failures must not be presented as incorrect credentials.
// Never interpolate provider messages, account details or request contents.
export function signInErrorMessage(error: unknown): string {
  const value = error && typeof error === "object" ? error : {};
  const status = "status" in value ? value.status : undefined;
  const name = "name" in value ? value.name : undefined;
  if (status === 429) return "محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.";
  if (
    name === "AuthRetryableFetchError" ||
    status === 0 ||
    (typeof status === "number" && status >= 500)
  )
    return signInUnavailable;
  return "تعذّر تسجيل الدخول. تحقق من بياناتك أو تواصل مع مسؤول العيادة.";
}
