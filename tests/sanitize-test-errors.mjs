// Never let default Playwright/driver diagnostics serialize cookies, bodies or references.
export function sanitizeTestErrors(label) {
  const stop = () => {
    process.stderr.write(`${label}_UNCAUGHT_SANITIZED\n`);
    process.exit(1);
  };
  process.prependListener("uncaughtException", stop);
  process.prependListener("unhandledRejection", stop);
}
