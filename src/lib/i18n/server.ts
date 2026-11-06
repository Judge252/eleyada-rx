import "server-only";
import { cookies } from "next/headers";
import { LANGUAGE_COOKIE, translate, type Locale } from "./core";
export async function getLocale(): Promise<Locale> {
  return (await cookies()).get(LANGUAGE_COOKIE)?.value === "en" ? "en" : "he";
}
export async function getI18n() {
  const locale = await getLocale();
  return { locale, t: (source: string) => translate(source, locale) };
}
export async function localizeMessages(body: unknown) {
  if (!body || typeof body !== "object") return body;
  const result = { ...body } as Record<string, unknown>;
  const { t } = await getI18n();
  if (typeof result.message === "string") result.message = t(result.message);
  if (result.errors && typeof result.errors === "object")
    result.errors = Object.fromEntries(
      Object.entries(result.errors).map(([key, value]) => [
        key,
        typeof value === "string" ? t(value) : value,
      ]),
    );
  return result;
}
