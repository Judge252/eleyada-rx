import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { chromium } from "@playwright/test";
import { sanitizeTestErrors } from "../sanitize-test-errors.mjs";
sanitizeTestErrors("ISSUANCE_UI");
const require = createRequire(import.meta.url),
  { webpack } = require("next/dist/compiled/webpack/webpack");
const output = resolve(".local/issuance-ui");
await mkdir(output, { recursive: true });
await new Promise((done, reject) => {
  const compiler = webpack({
    plugins: [
      new webpack.DefinePlugin({
        "process.env": JSON.stringify({ NODE_ENV: "production" }),
      }),
    ],
    mode: "production",
    devtool: false,
    entry: resolve("tests/ui/entry.tsx"),
    output: { path: output, filename: "test.js" },
    resolve: {
      extensions: [".tsx", ".ts", ".js"],
      alias: {
        "@": resolve("src"),
        "next/navigation": resolve("tests/ui/router-shim.ts"),
      },
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          exclude: /node_modules/,
          use: [{ loader: resolve("tests/ui/ts-loader.cjs") }],
        },
      ],
    },
    optimization: { minimize: false },
  });
  compiler.run((error, stats) =>
    compiler.close(() =>
      error
        ? reject(error)
        : stats.hasErrors()
          ? reject(new Error(stats.toString({ all: false, errors: true })))
          : done(),
    ),
  );
});
const bundle = await readFile(join(output, "test.js"));
async function styles(dir) {
  let result = "";
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result += await styles(path);
    else if (entry.name.endsWith(".css"))
      result += await readFile(path, "utf8");
  }
  return result;
}
const css = await styles(".next/static");
const server = createServer(async (req, res) => {
  if (req.url === "/test.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(bundle);
    return;
  }
  if (req.url.startsWith("/branding/") || req.url.startsWith("/_next/image")) {
    res.setHeader("Content-Type", "image/png");
    res.end(await readFile("public/branding/logo.png"));
    return;
  }
  if (req.url.startsWith("/_next/static/")) {
    try {
      const safe = resolve(
        ".next/static",
        decodeURIComponent(req.url.slice("/_next/static/".length)),
      );
      if (!safe.startsWith(resolve(".next/static") + "\\")) throw Error();
      res.end(await readFile(safe));
    } catch {
      res.statusCode = 404;
      res.end();
    }
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(
    `<!doctype html><html dir="rtl" lang="ar"><head><style>${css}</style></head><body><main id="root" class="main-content"></main><script src="/test.js"></script></body></html>`,
  );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  locale: "ar-EG",
});
let pageFailure = false;
page.on("pageerror", () => {
  pageFailure = true;
});
const base = `http://127.0.0.1:${server.address().port}`;
const id = randomUUID(),
  stamp = new Date().toISOString(),
  version = "2026-10-22T01:01:01.123456Z";
const medication = (n) => ({
  medication_name: `SYNTHETIC LOCAL ${n}`,
  strength: "test",
  dose: "test",
  frequency: "test",
  duration: "test",
  quantity: n,
  special_instructions: "",
});
const record = {
  id,
  patient_id: randomUUID(),
  status: "issued",
  created_at: stamp,
  updated_at: version,
  doctor_notes: "",
  patient: {
    id: randomUUID(),
    name: "SYNTHETIC UI SUBJECT",
    patient_identifier: "TEST",
  },
  items: [medication(1), medication(2)],
  issued_at: stamp,
  expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
};
const lifecycle = {
  status: "issued",
  issued_at: record.issued_at,
  expires_at: record.expires_at,
  database_time: stamp,
  cancellation: null,
  dispensed: false,
};
const reference =
  "RX1-K1-" +
  Array.from({ length: 8 }, () =>
    randomBytes(2).toString("hex").toUpperCase(),
  ).join("-");
const review = {
  fingerprint: "a".repeat(64),
  payload: { ...record, updated_at: version },
};
let checks = 0;
const check = (condition) => {
  assert.ok(condition, "Component check failed (values redacted)");
  checks++;
};
async function render(props) {
  await page.goto(base);
  await page.waitForFunction(() => !!window.renderIssuanceUI);
  await page.evaluate((props) => window.renderIssuanceUI(props), props);
  await page.waitForSelector("button");
}
try {
  let requests = [];
  let status = 409;
  await page.route(
    "**/api/doctor/prescriptions/**/lifecycle",
    async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        status,
        contentType: "application/json",
        headers: { "Cache-Control": "no-store" },
        body: JSON.stringify(
          status === 200
            ? { result: { ...lifecycle, id, reference } }
            : { message: "SYNTHETIC CONFLICT" },
        ),
      });
    },
  );
  await render({ review });
  const button = page.getByRole("button", { name: "تأكيد الإصدار النهائي" });
  check(await button.isDisabled());
  await page.getByRole("checkbox").check();
  await button.click();
  await page.getByRole("alert").waitFor();
  await page.evaluate((r) => window.renderIssuanceUI(r), {
    review: {
      ...review,
      payload: { ...review.payload, updated_at: new Date().toISOString() },
      fingerprint: "b".repeat(64),
    },
  });
  await button.click();
  await page.waitForFunction(
    () =>
      document.querySelector('[role="alert"]')?.textContent ===
      "SYNTHETIC CONFLICT",
  );
  check(
    requests.length === 2 &&
      JSON.stringify(requests[0]) === JSON.stringify(requests[1]),
  );
  check(await page.getByRole("checkbox").isChecked());
  // True overlapping clicks while the first response is held: exactly one POST.
  requests = [];
  await page.unroute("**/api/doctor/prescriptions/**/lifecycle");
  let release;
  await page.route(
    "**/api/doctor/prescriptions/**/lifecycle",
    async (route) => {
      requests.push(route.request().postDataJSON());
      await new Promise((done) => {
        release = done;
      });
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "SYNTHETIC UNAVAILABLE" }),
      });
    },
  );
  await button.evaluate((b) => {
    b.click();
    b.click();
  });
  await page.waitForFunction(
    () => document.querySelector("button")?.disabled === true,
  );
  await new Promise((done) => setTimeout(done, 100));
  check(requests.length === 1);
  release();
  await page.getByRole("alert").waitFor();
  await page.unroute("**/api/doctor/prescriptions/**/lifecycle");
  requests = [];
  await page.route(
    "**/api/doctor/prescriptions/**/lifecycle",
    async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ result: { ...lifecycle, id, reference } }),
      });
    },
  );
  await render({ record, initial: lifecycle });
  check((await page.locator(".secure-reference").count()) === 0);
  await page.emulateMedia({ media: "print" });
  check(!(await page.locator(".issued-document").isVisible()));
  check(await page.locator(".print-blocked-message").isVisible());
  await page.emulateMedia({ media: "screen" });
  await page
    .getByRole("button", { name: "إظهار الرمز المرجعي", exact: true })
    .click();
  await page.locator(".secure-reference").waitFor();
  check((await page.locator(".secure-reference").textContent()) === reference);
  check(
    await page.evaluate(
      () =>
        !Object.keys(localStorage).length &&
        !Object.keys(sessionStorage).length &&
        !location.href.includes("RX1"),
    ),
  );
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  await page.getByRole("button", { name: "استرجاع النسخة وطباعتها" }).click();
  await page.waitForFunction(() => window.printCount === 1);
  check(
    requests.length === 2 && requests.every((r) => r.operation === "reveal"),
  );
  await page.emulateMedia({ media: "print" });
  check(await page.locator(".issued-document").isVisible());
  check(
    await page
      .locator(".document-warning")
      .textContent()
      .then((t) => t.includes("غير معتمدة للاستخدام الطبي")),
  );
  check((await page.locator(".document-medication").count()) === 2);
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  check((await page.locator(".secure-reference").count()) === 0);
  for (const state of ["cancelled", "expired"]) {
    const initial = {
      ...lifecycle,
      status: state,
      cancellation:
        state === "cancelled"
          ? { reason: "duplicate_prescription", cancelled_at: stamp }
          : null,
    };
    await render({ record, initial });
    check(
      await page
        .locator(".document-warning")
        .first()
        .textContent()
        .then((t) => t.includes("غير صالحة للصرف")),
    );
    check((await page.getByLabel("سبب الإلغاء").count()) === 0);
  }
  await render({ record, initial: lifecycle });
  await page.unroute("**/api/doctor/prescriptions/**/lifecycle");
  requests = [];
  await page.route(
    "**/api/doctor/prescriptions/**/lifecycle",
    async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ message: "SYNTHETIC CONFLICT" }),
      });
    },
  );
  const cancel = page.getByRole("button", {
    name: "تأكيد إلغاء الوصفة",
    exact: true,
  });
  check(await cancel.isDisabled());
  await page.getByLabel("سبب الإلغاء").selectOption("treatment_changed");
  await page.getByRole("checkbox").check();
  await cancel.click();
  await page.getByRole("status").waitFor();
  await page.evaluate((props) => window.renderIssuanceUI(props), {
    record: { ...record, updated_at: new Date().toISOString() },
    initial: lifecycle,
  });
  await page
    .getByRole("button", { name: "إعادة محاولة طلب الإلغاء نفسه" })
    .click();
  await page.getByRole("status").waitFor();
  check(
    requests.length === 2 &&
      JSON.stringify(requests[0]) === JSON.stringify(requests[1]),
  );
  check(await page.getByLabel("سبب الإلغاء").isDisabled());
  await render({
    record: {
      ...record,
      dispensations: [
        {
          id: randomUUID(),
          dispensed_at: stamp,
          pharmacy: { name: "SYNTHETIC PARTNER" },
        },
      ],
    },
    initial: { ...lifecycle, dispensed: true },
  });
  check((await page.getByLabel("سبب الإلغاء").count()) === 0);
  check(
    (await page.locator(".issued-document").innerText()).includes(
      "صرف كامل مسجل",
    ),
  );
  check(!pageFailure);
  console.log(
    `PASS: ${checks} isolated actual-component browser checks. Controlled HTTP/router fixtures; NOT Auth/API/Vault acceptance. No screenshots/traces/PDF/reference artifacts.`,
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
