// Runs the repo-local Python 3.12 venv (never a global interpreter).
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const venvBin = process.platform === "win32" ? join(root, ".python312", "Scripts") : join(root, ".python312", "bin");
export const python = join(venvBin, process.platform === "win32" ? "python.exe" : "python");
export const env = { ...process.env, PYTHONIOENCODING: "utf-8", GENVM_VERSION: "v0.2.16" };

export function run(executable, args) {
  if (!existsSync(executable)) throw new Error(`${executable} not found. Create it with: uv venv --python 3.12 .python312 && uv pip install --python ${python} -r requirements.txt`);
  const r = spawnSync(executable, args, { cwd: root, stdio: "inherit", env });
  if (r.error) throw r.error;
  return r.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(run(python, process.argv.slice(2)));
}
