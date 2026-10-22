// Transient test credentials enter through non-echoed stdin, never a source/env file.
import { spawn } from "node:child_process";
import { privateLine } from "./private-input.mjs";
console.log(
  "Waiting for approved test credentials as private JSON stdin (doctor/pharmacist email/password).",
);
let values = JSON.parse(await privateLine());
const child = spawn(
  process.execPath,
  [
    "node_modules/@playwright/test/cli.js",
    "test",
    "--max-failures=1",
    ...process.argv.slice(2),
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      E2E_DOCTOR_EMAIL: values.doctor.email,
      E2E_DOCTOR_PASSWORD: values.doctor.password,
      E2E_PHARMACIST_EMAIL: values.pharmacist.email,
      E2E_PHARMACIST_PASSWORD: values.pharmacist.password,
      E2E_ADMIN_CHECKS: values.adminChecks === true ? "1" : "0",
      // No hosted draft writes/deletions unless separately approved by the owner.
      E2E_DRAFT_WRITES: values.draftWritesApproved === true ? "1" : "0",
      E2E_DRAFT_CONFLICT_FIX:
        values.draftConflictFixApplied === true ? "1" : "0",
    },
  },
);
values = null;
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
