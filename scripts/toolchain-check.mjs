import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { python, venvBin, env } from "./py.mjs";
import { join } from "node:path";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const need = (name, expected, actual) => { if (actual !== expected) throw new Error(`${name} must be ${expected}; found ${actual ?? "missing"}`); };
need("genlayer CLI (repo-local)", "0.39.1", pkg.devDependencies?.genlayer);
need("genlayer-js", "1.1.8", pkg.dependencies?.["genlayer-js"]);

const installed = JSON.parse(readFileSync(new URL("../node_modules/genlayer/package.json", import.meta.url), "utf8")).version;
need("installed genlayer CLI", "0.39.1", installed);
need("installed genlayer-js", "1.1.8", JSON.parse(readFileSync(new URL("../node_modules/genlayer-js/package.json", import.meta.url), "utf8")).version);

const config = readFileSync(new URL("../lib/config.ts", import.meta.url), "utf8");
if (!config.includes("61999") || !config.includes("https://studio.genlayer.com/api")) throw new Error("frontend is not pinned to Studionet 61999");
if (/6199[0-8]|studio-dev\.genlayer\.com|bradbury|asimov/i.test(config)) throw new Error("non-Studionet network configuration present");
const deploy = readFileSync(new URL("../deploy/deployScript.ts", import.meta.url), "utf8");
if (!deploy.includes("Number(client.chain?.id) !== CHAIN_ID") || !deploy.includes("Refusing")) throw new Error("deploy script does not refuse other chains");

if (!existsSync(python)) throw new Error("repo-local Python 3.12 venv missing (.python312)");
const version = spawnSync(python, ["--version"], { encoding: "utf8" }).stdout.trim();
if (!/^Python 3\.(1[2-9]|[2-9]\d)/.test(version)) throw new Error(`Python 3.12+ required; found ${version}`);
const pip = spawnSync(python, ["-m", "pip", "list", "--format=freeze"], { encoding: "utf8", env }).stdout || spawnSync("uv", ["pip", "freeze", "--python", python], { encoding: "utf8" }).stdout;
if (!/genvm-linter==0\.11\.0/i.test(pip)) throw new Error("genvm-linter 0.11.0 is not installed in .python312");
console.log(`toolchain OK · Studionet 61999 · genlayer ${installed} · genlayer-js 1.1.8 · ${version} · genvm-linter 0.11.0 · GenVM v0.2.16 runner for validation`);
