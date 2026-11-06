import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import ts from "typescript";
const he = JSON.parse(await readFile("src/lib/i18n/he.json", "utf8")),
  en = JSON.parse(await readFile("src/lib/i18n/en.json", "utf8")),
  sources = JSON.parse(await readFile("src/lib/i18n/sources.json", "utf8"));
let code = await readFile("src/lib/i18n/core.ts", "utf8");
code = code
  .replace('import he from "./he.json";', `const he=${JSON.stringify(he)};`)
  .replace('import en from "./en.json";', `const en=${JSON.stringify(en)};`)
  .replace(
    'import sources from "./sources.json";',
    `const sources=${JSON.stringify(sources)};`,
  );
const { translate } = await import(
  "data:text/javascript;base64," +
    Buffer.from(ts.transpile(code, { module: ts.ModuleKind.ESNext })).toString(
      "base64",
    )
);
test("Hebrew/English dictionaries have complete matching coverage and no old visible brand or Arabic", () => {
  assert.deepEqual(Object.keys(he).sort(), Object.keys(en).sort());
  assert.ok(Object.keys(en).length >= 700);
  for (const dict of [he, en])
    for (const value of Object.values(dict)) {
      assert.ok(value.trim());
      assert.ok(!/[\u0600-\u06ff]|Al-Eyada|العيادة/.test(value));
    }
  for (const key of Object.values(sources)) assert.ok(he[key] && en[key]);
});
test("canonical, previously localized and interpolated validation messages switch languages", () => {
  assert.equal(translate("text_45", "en"), "New prescription");
  assert.equal(translate("New prescription", "he"), he.text_45);
  assert.equal(translate(he.text_45, "en"), "New prescription");
  assert.equal(
    translate("التركيز: أدخل قيمة صحيحة لا تتجاوز 120 حرفًا.", "en"),
    "Strength: Enter a valid value of at most 120 characters.",
  );
});
test("UI source has no unlocalized Arabic JSX and never translates clinical data fields", async () => {
  async function scan(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const path = dir + "/" + e.name;
      if (e.isDirectory()) await scan(path);
      else if (path.endsWith(".tsx")) {
        const source = await readFile(path, "utf8"),
          sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
        function visit(n) {
          if (ts.isJsxText(n)) assert.ok(!/[\u0600-\u06ff]/.test(n.text), path);
          if (ts.isCallExpression(n) && n.expression.getText(sf) === "t") {
            const argument = n.arguments[0]?.getText(sf) ?? "";
            assert.ok(
              !/^(patient\.(name|identifier)|m\.(medication_name|instructions)|record\.patient|row\.patient)/.test(
                argument,
              ),
              path,
            );
            if (n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
              const raw = n.arguments[0].text;
              assert.ok(
                !/[\u0600-\u06ff]/.test(translate(raw, "en")),
                path + ": " + raw,
              );
            }
          }
          ts.forEachChild(n, visit);
        }
        visit(sf);
      }
    }
  }
  await scan("src/components");
  await scan("src/app");
});
