// Actual isolated components + controlled HTTP. Never hosted acceptance.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { chromium } from "playwright";
const require = createRequire(import.meta.url),
  { webpack } = require("next/dist/compiled/webpack/webpack");
// A raw Playwright rejection can contain headers. Never log caught/uncaught error objects.
for (const event of ["uncaughtException", "unhandledRejection"])
  process.on(event, () => {
    process.stderr.write("PHARMACY_UI_UNCAUGHT_SANITIZED\n");
    process.exit(1);
  });
let browser,
  server,
  routeFailure = false,
  checks = 0;
const check = (b, label) => {
  assert.ok(b, label);
  checks++;
};
try {
  const output = resolve(".local/pharmacy-ui");
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
        error || stats.hasErrors() ? reject(Error("UI_BUNDLE_FAILED")) : done(),
      ),
    );
  });
  const bundle = await readFile(join(output, "test.js"));
  const styles = async (dir) => {
    let css = "";
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) css += await styles(p);
      else if (e.name.endsWith(".css")) css += await readFile(p, "utf8");
    }
    return css;
  };
  const css = await styles(".next/static");
  server = createServer((req, res) => {
    if (req.url === "/test.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(bundle);
    } else {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        `<!doctype html><html dir="rtl" lang="ar"><head><style>${css}</style></head><body><main id="root" class="main-content"></main><script src="/test.js"></script></body></html>`,
      );
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    locale: "ar-EG",
  });
  page.on("pageerror", () => (routeFailure = true));
  page.setDefaultTimeout(10000);
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(base);
  const reference =
    "RX1-K1-" + randomBytes(20).toString("hex").slice(0, 32).toUpperCase();
  const now = new Date().toISOString(),
    future = new Date(Date.now() + 600000).toISOString();
  const eligible = {
    state: "eligible",
    prescription_id: randomUUID(),
    lookup_id: randomUUID(),
    confirmation_expires_at: future,
    issued_at: now,
    expires_at: future,
    database_time: now,
    patient: {
      name: "SYNTHETIC SUBJECT",
      patient_identifier: "SYNTHETIC ONLY",
    },
    items: [1, 2].map((n) => ({
      medication_name: `SYNTHETIC ITEM ${n}`,
      strength: `test ${n}`,
      dose: "test",
      frequency: "test",
      duration: "test",
      quantity: n,
      special_instructions: "SYNTHETIC ONLY",
    })),
  };
  let mode = "lost",
    submitted = [],
    lookupBody,
    completeCalls = 0;
  await page.route("**/api/pharmacy/prescriptions", async (route) => {
    try {
      const request = route.request(),
        body = request.postDataJSON();
      check(
        request.method() === "POST" && !request.url().includes(reference),
        "REFERENCE_URL_OR_METHOD",
      );
      if (body.operation === "lookup") {
        lookupBody = body;
        const states = {
          cancelled: { state: "cancelled", database_time: now },
          expired: { state: "expired", database_time: now },
          dispensed: { state: "dispensed", dispensed_at: now },
        };
        if (mode === "notfound" || mode === "limit" || mode === "unavailable")
          return route.fulfill({
            status: mode === "notfound" ? 404 : mode === "limit" ? 429 : 503,
            json: {
              message:
                mode === "limit" ? "بلغت الحد المسموح" : "خدمة غير متاحة",
            },
          });
        return route.fulfill({
          json: { result: states[mode] ?? eligible },
          headers: { "Cache-Control": "private, no-store" },
        });
      }
      submitted.push(body);
      completeCalls++;
      if (mode === "stale")
        return route.fulfill({
          status: 409,
          json: { message: "تغيّرت الأهلية" },
        });
      if (completeCalls === 1) return route.abort("failed");
      return route.fulfill({
        json: {
          result: { state: "dispensed", dispensed_at: now, replayed: true },
        },
      });
    } catch {
      routeFailure = true;
      await route.abort("failed").catch(() => {});
    }
  });
  const mount = async () => {
    await page.evaluate((key) => window.renderPharmacyUI(key), randomUUID());
    await page.getByLabel("الرمز المرجعي", { exact: true }).waitFor();
  };
  const lookup = async () => {
    await page.getByLabel("الرمز المرجعي", { exact: true }).fill(reference);
    await page
      .getByRole("button", { name: "بحث عن الوصفة", exact: true })
      .click();
  };
  const confirm = async () => {
    await page
      .getByLabel("راجعت هوية المريض ومطابقتها للوصفة المعروضة.", {
        exact: true,
      })
      .check();
    await page
      .getByRole("button", { name: "متابعة تأكيد الصرف الكامل", exact: true })
      .click();
    await page
      .getByLabel("أؤكد صرف جميع الأدوية والكميات المعروضة دون تعديل.", {
        exact: true,
      })
      .check();
  };
  await mount();
  await lookup();
  await page.locator(".pharmacy-result").waitFor();
  check(lookupBody.reference === reference, "LOOKUP_BODY_CHANGED");
  check(
    (await page.getByLabel("الرمز المرجعي", { exact: true }).inputValue()) ===
      "",
    "REFERENCE_NOT_CLEARED",
  );
  check(
    (await page.locator(".document-medication").count()) === 2,
    "MEDICATION_COUNT",
  );
  check(
    (await page.locator(".document-medication input").count()) === 0,
    "EDITABLE_MEDICATIONS",
  );
  check(
    await page
      .getByRole("button", { name: "متابعة تأكيد الصرف الكامل", exact: true })
      .isDisabled(),
    "IDENTITY_CONFIRMATION_REQUIRED",
  );
  await confirm();
  await page
    .getByRole("button", { name: "تأكيد الصرف الكامل", exact: true })
    .evaluate((button) => {
      button.click();
      button.click();
    });
  await page.getByRole("alert").waitFor();
  check(completeCalls === 1, "DUPLICATE_CLICK");
  await page
    .getByRole("button", { name: "إعادة محاولة طلب الصرف نفسه", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "الوصفة مصروفة بالكامل", exact: true })
    .waitFor();
  check(
    submitted.length === 2 &&
      JSON.stringify(submitted[0]) === JSON.stringify(submitted[1]),
    "RETRY_PAYLOAD_CHANGED",
  );
  check(
    !(await page.evaluate(
      (code) =>
        JSON.stringify({ ...localStorage, ...sessionStorage }).includes(code),
      reference,
    )),
    "REFERENCE_PERSISTENCE",
  );
  mode = "stale";
  submitted = [];
  await mount();
  await lookup();
  await page.locator(".pharmacy-result").waitFor();
  await confirm();
  for (let n = 0; n < 2; n++) {
    await page
      .getByRole("button", {
        name: n ? "إعادة محاولة طلب الصرف نفسه" : "تأكيد الصرف الكامل",
        exact: true,
      })
      .click();
    await page.getByRole("alert").waitFor();
  }
  check(
    submitted.length === 2 &&
      JSON.stringify(submitted[0]) === JSON.stringify(submitted[1]),
    "STALE_PRECONDITION_CHANGED",
  );
  for (const state of ["cancelled", "expired", "dispensed"]) {
    mode = state;
    await mount();
    await lookup();
    await page.locator("section[role=status]").waitFor();
    check(
      (await page.locator(".pharmacy-result").count()) === 0,
      "TERMINAL_CLINICAL_DISCLOSURE",
    );
  }
  for (const state of ["notfound", "limit", "unavailable"]) {
    mode = state;
    await mount();
    await lookup();
    await page.getByRole("alert").waitFor();
    check(
      (await page.locator(".pharmacy-result").count()) === 0,
      "FAKE_FALLBACK",
    );
  }
  mode = "eligible";
  eligible.patient.name = "SYNTHETIC".repeat(22);
  eligible.patient.patient_identifier = "X".repeat(120);
  eligible.items[0].medication_name = "X".repeat(200);
  eligible.items[0].dose = "X".repeat(200);
  await mount();
  await lookup();
  await page.locator(".pharmacy-result").waitFor();
  await page.setViewportSize({ width: 320, height: 1000 });
  check(
    await page.evaluate(
      () =>
        document.documentElement.dir === "rtl" &&
        document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "MOBILE_RTL_OVERFLOW",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await page.locator(".pharmacy-result").waitFor({ state: "detached" });
  check(
    (await page.getByLabel("الرمز المرجعي", { exact: true }).inputValue()) ===
      "",
    "PAGEHIDE_REFERENCE",
  );
  check(!routeFailure, "CAUGHT_BROWSER_FAILURE");
  console.log(
    `PASS ${checks} isolated pharmacy component checks; controlled HTTP, not hosted Auth/API acceptance. No secret artifacts.`,
  );
} catch {
  process.stderr.write("PHARMACY_UI_FAILED_SANITIZED\n");
  process.exitCode = 1;
} finally {
  if (browser) {
    for (const ctx of browser.contexts())
      await ctx.unrouteAll({ behavior: "wait" }).catch(() => {});
    await browser.close();
  }
  if (server) await new Promise((r) => server.close(r));
}
