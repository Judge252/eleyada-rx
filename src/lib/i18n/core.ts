import he from "./he.json";
import en from "./en.json";
import sources from "./sources.json";
export type Locale = "he" | "en";
export const LANGUAGE_COOKIE = "clinic_rx_language";
const aliases: Record<string, string> = { ...sources };
for (const [key, value] of Object.entries(en)) {
  aliases[key] = key;
  aliases[value] = key;
  aliases[he[key as keyof typeof he]] = key;
}
export function translate(source: string, locale: Locale = "he"): string {
  const normalized = source.trim().replace(/\s+/g, " ");
  const key = aliases[normalized] as keyof typeof he | undefined;
  if (key) return (locale === "he" ? he : en)[key];
  const validation = normalized.match(
    /^(.*): أدخل قيمة صحيحة لا تتجاوز (\d+) حرفًا\.$/,
  );
  if (validation)
    return (
      translate(validation[1], locale) +
      ": " +
      translate("invalidField", locale).replace("{max}", validation[2])
    );
  return source;
}
export const direction = (locale: Locale) => (locale === "he" ? "rtl" : "ltr");
export const dateLocale = (locale: Locale) =>
  locale === "he" ? "he-IL" : "en-GB";
