"use client";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useState,
  type ReactNode,
  type FormEvent,
  type JSX,
} from "react";
import { direction, LANGUAGE_COOKIE, translate, type Locale } from "./core";
const Context = createContext({
  locale: "he" as Locale,
  setLocale: (_locale: Locale) => {
    void _locale;
  },
});
export function LanguageProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const [locale, setState] = useState(initialLocale);
  function setLocale(next: Locale) {
    document.cookie = `${LANGUAGE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    document.documentElement.lang = next;
    document.documentElement.dir = direction(next);
    document.title = translate("text_38", next);
    const description = document.querySelector('meta[name="description"]');
    description?.setAttribute("content", translate("text_40", next));
    setState(next);
  }
  function invalid(event: FormEvent<HTMLDivElement>) {
    const input = event.target;
    if (
      input instanceof HTMLInputElement ||
      input instanceof HTMLSelectElement ||
      input instanceof HTMLTextAreaElement
    )
      input.setCustomValidity(
        translate(input.validity.valueMissing ? "required" : "invalid", locale),
      );
  }
  return (
    <Context.Provider value={{ locale, setLocale }}>
      <div
        style={{ display: "contents" }}
        onInvalidCapture={invalid}
        onInputCapture={(e) => {
          const input = e.target;
          if (
            input instanceof HTMLInputElement ||
            input instanceof HTMLSelectElement ||
            input instanceof HTMLTextAreaElement
          )
            input.setCustomValidity("");
        }}
      >
        {children}
      </div>
    </Context.Provider>
  );
}
export function useI18n() {
  const context = useContext(Context);
  const t = useCallback(
    (source: string | number | null | undefined) =>
      typeof source === "string"
        ? translate(source, context.locale)
        : String(source ?? ""),
    [context.locale],
  );
  return { ...context, t };
}
export function T({ text }: { text: string | undefined }) {
  const { t } = useI18n();
  return t(text);
}
export function LocalizedElement({
  as,
  children,
  ...props
}: {
  as: keyof JSX.IntrinsicElements;
  children?: ReactNode;
  [key: string]: unknown;
}) {
  const { t } = useI18n();
  const attributes = { ...props };
  for (const key of ["aria-label", "title", "placeholder"])
    if (typeof attributes[key] === "string")
      attributes[key] = t(attributes[key] as string);
  return createElement(as, attributes, children);
}
export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className="language-switcher">
      <span>{t("language")}</span>
      <select
        aria-label={t("language")}
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
      >
        <option value="he" lang="he">
          עברית
        </option>
        <option value="en" lang="en">
          English
        </option>
      </select>
    </label>
  );
}
