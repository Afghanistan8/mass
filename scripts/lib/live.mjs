// Shared helpers for live Studionet demonstrations. Every write is waited to FINALIZED and recorded with its GenVM
// outcome (return / rollback + message), consensus result, the child transactions it triggered, and an explorer link.
// Contract state is read back from the latest FINALIZED state. Nothing here prints or stores key material.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionHashVariant } from "genlayer-js/types";

export const RPC = "https://studio.genlayer.com/api";
export const EXPLORER = "https://explorer-studio.genlayer.com";
export const manifest = JSON.parse(readFileSync(new URL("../../deployment-manifest.public.json", import.meta.url), "utf8"));
if (Number(manifest.chainId) !== 61999) throw new Error(`Refusing to run against chain ${manifest.chainId}`);
export const C = manifest.contracts;
export const reader = createClient({ chain: studionet, endpoint: RPC });
const CLI_ENTRY = fileURLToPath(new URL("../../node_modules/genlayer/dist/index.js", import.meta.url));
export const NONE = "null"; // the CLI's documented absent value (a bare "" becomes the integer 0)

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const big = (_k, v) => (typeof v === "bigint" ? v.toString() : v);

// Transport failures on the public RPC are retried; contract results never are.
export async function retry(fn, tries = 8) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try { return await fn(); } catch (e) { last = e; await sleep(3000 * (i + 1)); }
  }
  throw last;
}

/** Deployer write through the repo-local CLI and its active UNLOCKED account. No shell: arguments arrive verbatim. */
export function cliWrite(address, method, args) {
  const r = spawnSync(process.execPath, [CLI_ENTRY, "write", address, method, "--args", ...args.map(String)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const at = out.indexOf("Write Transaction Hash");
  const m = (at >= 0 ? out.slice(at) : out).match(/0x[0-9a-fA-F]{64}/);
  if (!m) throw new Error(`no transaction hash in CLI output:\n${out.slice(-1500)}`);
  return m[0];
}

/** Write signed by an in-memory account (used for the throwaway guardian key; never persisted). */
export async function accountWrite(signer, address, method, args) {
  return retry(() => signer.writeContract({ address, functionName: method, args, value: 0n }));
}

export function evidenceOf(tx) {
  const lr = tx?.consensus_data?.leader_receipt?.[0];
  const payload = lr?.result?.payload;
  return {
    hash: tx.hash,
    explorer: `${EXPLORER}/tx/${tx.hash}`,
    status: tx.statusName,
    consensus: tx.result_name ?? null,
    leader: lr?.execution_result ?? null,
    genvm: lr?.result?.status ?? null, // "return" or "rollback" (UserError) or "contract_error"
    payload: typeof payload === "string" ? payload : payload?.readable ?? null,
    from: tx.from_address ?? tx.sender ?? null,
    to: tx.to_address ?? tx.recipient ?? null,
    createdAt: tx.created_at ?? null,
    triggeredBy: tx.triggered_by ?? null,
    triggeredOn: tx.triggered_on ?? null,
    children: Array.isArray(tx.triggered_transactions) ? tx.triggered_transactions.map(String) : [],
  };
}

/** Waits for FINALIZED and returns the full, decoded evidence of a transaction. */
export async function settle(hash) {
  await retry(() => reader.waitForTransactionReceipt({ hash, status: "FINALIZED", retries: 400, interval: 5000 }));
  return evidenceOf(await retry(() => reader.getTransaction({ hash })));
}

/** Children (cross-contract deliveries) of a finalized parent, each waited to FINALIZED. */
export async function children(parent, { tries = 60 } = {}) {
  let ids = parent.children;
  for (let i = 0; i < tries && ids.length === 0; i += 1) {
    await sleep(5000);
    ids = evidenceOf(await retry(() => reader.getTransaction({ hash: parent.hash }))).children;
  }
  return Promise.all(ids.map((id) => settle(id)));
}

export async function read(address, fn, args = []) {
  return retry(() => reader.readContract({ address, functionName: fn, args, transactionHashVariant: TransactionHashVariant.LATEST_FINAL }));
}

export async function until(label, probe, { tries = 150, wait = 6000 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    const v = await probe().catch(() => null);
    if (v) return v;
    await sleep(wait);
  }
  throw new Error(`timed out waiting for ${label}`);
}

const consensusAgreed = (e) => e.status === "FINALIZED" && /AGREE/.test(String(e.consensus)) && !/DISAGREE/.test(String(e.consensus));

export function createRecorder(run, title) {
  const steps = [];
  const readbacks = [];
  let failures = 0;
  const line = (pass, label, detail) => console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);

  return {
    /** expect: "return" (succeeds) or "rollback" (UserError containing `message`). */
    async tx(label, send, { expect = "return", message = "" } = {}) {
      const hash = await send();
      const e = await settle(hash);
      const pass = consensusAgreed(e) && e.genvm === expect && (expect !== "rollback" || (!!message && String(e.payload).includes(message)));
      steps.push({ label, expect, expectedMessage: message || null, pass, ...e });
      if (!pass) failures += 1;
      line(pass, label, `${e.status} · ${e.consensus} · genvm ${e.genvm}${e.payload ? ` · “${String(e.payload).slice(0, 90)}”` : ""} · ${e.hash}`);
      return e;
    },
    /** A delivered child transaction that must have the given outcome. */
    child(label, e, { expect = "return", message = "" } = {}) {
      const pass = consensusAgreed(e) && e.genvm === expect && (expect !== "rollback" || String(e.payload).includes(message));
      steps.push({ label, expect, expectedMessage: message || null, pass, ...e });
      if (!pass) failures += 1;
      line(pass, label, `${e.status} · genvm ${e.genvm}${e.payload ? ` · “${String(e.payload).slice(0, 90)}”` : ""} · ${e.hash}`);
      return pass;
    },
    async readback(label, contract, fn, args = []) {
      const value = await read(C[contract], fn, args);
      let parsed = value;
      if (typeof value === "string" && /^[[{]/.test(value)) { try { parsed = JSON.parse(value); } catch { /* keep raw */ } }
      readbacks.push({ label, contract, address: C[contract], fn, args, value: parsed, at: new Date().toISOString() });
      return parsed;
    },
    check(label, pass, detail = "") {
      steps.push({ label, expect: "check", pass, detail });
      if (!pass) failures += 1;
      line(pass, label, detail);
      return pass;
    },
    failures: () => failures,
    write(extra = {}) {
      mkdirSync(new URL("../../docs/live-runs/", import.meta.url), { recursive: true });
      const report = { run, title, network: "studionet", chainId: 61999, contracts: C, generatedAt: new Date().toISOString(), failures, ...extra, steps, readbacks };
      const base = new URL(`../../docs/live-runs/${run}`, import.meta.url);
      writeFileSync(new URL(`${base.href}.json`), JSON.stringify(report, big, 2) + "\n");
      const md = [
        `# ${title}`, "",
        `Run \`${run}\` · Studionet 61999 · generated ${report.generatedAt} · **${failures === 0 ? "ALL EXPECTATIONS MET" : `${failures} UNEXPECTED RESULT(S)`}**`, "",
        ...(extra.notes ?? []).map((n) => `> ${n}`), extra.notes?.length ? "" : null,
        "Every transaction below was waited to **FINALIZED**. *GenVM* is the leader's execution result (`return` = succeeded, `rollback` = the contract raised the quoted error); *consensus* is the validators' verdict.", "",
        "| # | Step | Expected | GenVM | Message / return | Consensus | Transaction |",
        "|---|---|---|---|---|---|---|",
        ...steps.map((s, i) => s.expect === "check"
          ? `| ${i + 1} | ${s.pass ? "✅" : "❌"} ${s.label} | state check | — | ${String(s.detail ?? "").replace(/\|/g, "\\|")} | — | — |`
          : `| ${i + 1} | ${s.pass ? "✅" : "❌"} ${s.label} | ${s.expect}${s.expectedMessage ? `: “${s.expectedMessage}”` : ""} | ${s.genvm} | ${String(s.payload ?? "").slice(0, 120).replace(/\|/g, "\\|")} | ${s.consensus} | [${s.hash.slice(0, 10)}…](${s.explorer}) |`),
        "", "## Authoritative state readbacks (latest FINALIZED state)", "",
        ...readbacks.flatMap((r) => [`**${r.label}** — \`${r.contract}.${r.fn}(${r.args.map((a) => JSON.stringify(a)).join(", ")})\` at ${r.at}`, "", "```json", JSON.stringify(r.value, big, 2), "```", ""]),
      ].filter((l) => l !== null).join("\n");
      writeFileSync(new URL(`${base.href}.md`), md + "\n");
      return report;
    },
  };
}
