import { readFile } from "node:fs/promises";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { uiSignIn } from "./auth-helpers";

async function invoke(
  request: APIRequestContext,
  name: string,
  args: unknown[],
) {
  const manifest = JSON.parse(
    await readFile(".next/server/server-reference-manifest.json", "utf8"),
  );
  const entry = Object.entries(manifest.node).find(
    ([, value]) => (value as { exportedName?: string }).exportedName === name,
  );
  if (!entry)
    throw new Error(
      "Expected draft server action is absent from production build.",
    );
  return request.post("/doctor", {
    headers: {
      "Next-Action": entry[0],
      "Content-Type": "text/plain;charset=UTF-8",
      Origin: "http://127.0.0.1:3107",
    },
    data: JSON.stringify(args),
    maxRedirects: 0,
  });
}
test("anonymous direct draft/patient server actions require session before reading input", async ({
  request,
}) => {
  for (const [action, args] of [
    ["saveDraft", [null]],
    ["deleteDraft", [null, null]],
    ["findPatients", [""]],
  ] as const) {
    const response = await invoke(request, action, [...args]);
    const target =
      response.headers()["x-action-redirect"] ??
      response.headers().location ??
      "";
    expect(target.includes("/login")).toBe(true);
  }
});
test("real pharmacist cannot invoke doctor draft/patient actions directly", async ({
  page,
}) => {
  await uiSignIn(page, "pharmacist");
  for (const [action, args] of [
    ["saveDraft", [null]],
    ["deleteDraft", [null, null]],
    ["findPatients", [""]],
  ] as const) {
    const response = await invoke(page.request, action, [...args]);
    const target =
      response.headers()["x-action-redirect"] ??
      response.headers().location ??
      "";
    expect(target.includes("/pharmacy")).toBe(true);
  }
});
test("real doctor server action rejects malformed input without relying on browser validation", async ({
  page,
}) => {
  await uiSignIn(page, "doctor");
  const invalid = await invoke(page.request, "saveDraft", [
    { requestId: "not-uuid", doctor_user_id: "spoof", items: [] },
  ]);
  const body = await invalid.text();
  expect(
    body.includes("بيانات المسودة غير صحيحة") || body.includes("صحّح الحقول"),
  ).toBe(true);
  const deletion = await invoke(page.request, "deleteDraft", [
    "invalid",
    "invalid",
  ]);
  expect(
    (await deletion.text()).includes("معرّف أو نسخة المسودة غير صحيحة"),
  ).toBe(true);
});
