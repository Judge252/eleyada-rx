// Test-only compilation of the actual client components; no app route or auth bypass.
// Webpack requires a CommonJS loader entry point.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ts = require("typescript");
module.exports = function (source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
};
