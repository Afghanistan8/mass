import { readdirSync } from "node:fs";
import { join } from "node:path";
import { python, venvBin, root, run } from "./py.mjs";

const lint = join(venvBin, process.platform === "win32" ? "genvm-lint.exe" : "genvm-lint");
const contracts = readdirSync(join(root, "contracts")).filter((f) => f.endsWith(".py")).sort();
let failed = 0;
for (const c of contracts) failed += run(python, ["-m", "py_compile", join("contracts", c)]) === 0 ? 0 : 1;
if (!process.argv.includes("--compile-only")) {
  for (const c of contracts) {
    const p = join("contracts", c);
    console.log(`===== ${p}: genvm-lint check (lint + validate, GenVM v0.2.16) =====`);
    failed += run(lint, ["check", p]) === 0 ? 0 : 1;
  }
}
if (failed) { console.error(`${failed} contract check(s) failed`); process.exit(1); }
console.log(`OK: ${contracts.length} contracts`);
