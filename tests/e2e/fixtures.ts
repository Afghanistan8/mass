import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";

export const ME = "0x4184bc5e5444f250767e8d33a49817a9b4fb0df3";
export const GUARDIAN = "0x1111111111111111111111111111111111111111";
export const TARGET = "0x70723a681d44ee1d245d01f7622998edb31e729b";
export const CHARTER_DIGEST = "a".repeat(64);
export const URL1 = "https://httpbin.org/base64/QWR2aXNvcnk=";

const sortKeys = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sortKeys)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, sortKeys(x)]))
    : v;
export const actionDigest = (e: Record<string, unknown>) =>
  createHash("sha256").update(JSON.stringify(sortKeys(e))).digest("hex");

export const envelope = (over: Record<string, unknown> = {}) => ({
  incident_key: "INC-E2E-1", charter_digest: CHARTER_DIGEST, target: TARGET,
  action_class: "PAUSE_PROTECTED_ACTION", scope: "*", duration_minutes: 20, ...over,
});

export const sourceState = (over: Record<string, unknown> = {}) => ({
  url: URL1, state: "SUPPORTS_TRIGGER", finding: "Advisory confirms the exploit.", quote: "Confirmed active exploit draining the bridge",
  http_status: 200, content_digest: "c".repeat(64), raw_digest: "d".repeat(64), injection_flagged: false, ...over,
});

export const assessment = (over: Record<string, unknown> = {}) => ({
  decision: "TRIGGER_CONFIRMED", summary: "Approved source confirms an active exploit.",
  trigger_clauses: ["active exploit or critical dependency compromise"], material_findings: ["Funds are leaving the bridge."],
  source_states: [sourceState()], incident_digest: "e".repeat(64), charter_digest: CHARTER_DIGEST,
  action_digest: actionDigest(envelope()), evidence_commitment_digest: "f".repeat(64), assessed_at: 1790000000, attempt: 1, ...over,
});

export const incident = (over: Record<string, unknown> = {}, a: unknown = assessment()) => ({
  incident_key: "INC-E2E-1", charter_key: "CHARTER-E2E", charter_digest: CHARTER_DIGEST, protocol_key: "PROTO-E2E",
  requester: ME, guardian: "", target: TARGET, action_class: "PAUSE_PROTECTED_ACTION", scope: "*", duration_minutes: 20,
  reason: "Operator reports a live exploit.", evidence_urls: [URL1], capability_ttl_minutes: 30, opened_at: 1790000000, expires_at: 1790086400,
  incident_digest: "e".repeat(64), action_digest: actionDigest(envelope()), status: "AUTHORITY_PENDING_FINALITY",
  assessment_json: a ? JSON.stringify(a) : "", assessment_digest: "9".repeat(64), evidence_commitment_digest: "f".repeat(64),
  assessment_count: a ? 1 : 0, capability_key: "CAP-INC-E2E-1", ...over,
});

export const capability = (over: Record<string, unknown> = {}) => ({
  capability_key: "CAP-INC-E2E-1", incident_key: "INC-E2E-1", holder: ME, guardian: "", guardian_approved: false, target: TARGET,
  action_class: "PAUSE_PROTECTED_ACTION", scope: "*", duration_minutes: 20, action_digest: actionDigest(envelope()),
  charter_digest: CHARTER_DIGEST, assessment_digest: "9".repeat(64), issuer: "0x0b60b320066dd972547a6c233e67b99dff522d04",
  issued_at: 1790000100, expires_at: 4102444800, dispatch_status: "ISSUED", dispatch_count: 0, consumed: false, ...over,
});

export const targetStatus = (over: Record<string, unknown> = {}) => ({
  gate_address: "0x0f2bcf7497d73aad9611ad806479fa094ca34e48", governance_address: ME, action_count: "3", paused: false,
  paused_until: 0, lanes: {}, applied_capability_count: 0, last_action_json: "", ...over,
});

type Fixture = Record<string, unknown | ((args: unknown[], pending: boolean) => unknown)>;

/** Installs a stub EIP-1193 wallet. chainId defaults to Studionet. */
export async function installWallet(page: Page, opts: { chainId?: string; accounts?: string[]; rejectConnect?: boolean } = {}) {
  await page.addInitScript(({ chainId, accounts, rejectConnect }) => {
    let chain = chainId;
    const listeners: Record<string, Array<(v: unknown) => void>> = {};
    (window as unknown as { ethereum: unknown }).ethereum = {
      isMetaMask: true,
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        if (method === "eth_accounts") return (window as unknown as { __connected?: boolean }).__connected ? accounts : [];
        if (method === "eth_requestAccounts") {
          if (rejectConnect) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
          (window as unknown as { __connected?: boolean }).__connected = true;
          return accounts;
        }
        if (method === "eth_chainId") return chain;
        if (method === "wallet_switchEthereumChain") { chain = (params as [{ chainId: string }])[0].chainId; (listeners.chainChanged ?? []).forEach((f) => f(chain)); return null; }
        throw new Error(`unsupported ${method}`);
      },
      on: (e: string, f: (v: unknown) => void) => { (listeners[e] ||= []).push(f); },
      removeListener: () => {},
    };
  }, { chainId: opts.chainId ?? "0xf22f", accounts: opts.accounts ?? [ME], rejectConnect: !!opts.rejectConnect });
}

/** Test-only data/write seam. Only honoured when NODE_ENV !== "production". */
export async function installChain(page: Page, fixture: Fixture, writes: { behaviour?: "ok" | "reject"; delayMs?: number } = {}) {
  await page.exposeFunction("__fixture", (fn: string, args: unknown[], pending: boolean) => {
    const v = fixture[fn];
    const out = typeof v === "function" ? (v as (a: unknown[], p: boolean) => unknown)(args, pending) : v;
    return out === undefined ? null : JSON.stringify(out === null ? null : out);
  });
  await page.addInitScript(({ behaviour, delayMs }) => {
    (window as unknown as { __writes: unknown[] }).__writes = [];
    (window as unknown as { __MASS_E2E_MOCK__: unknown }).__MASS_E2E_MOCK__ = {
      readContract: async (_a: string, fn: string, args: unknown[], pending: boolean) => {
        const raw = await (window as unknown as { __fixture: (f: string, a: unknown[], p: boolean) => Promise<string | null> }).__fixture(fn, args, pending);
        if (raw === null) return "";
        const v = JSON.parse(raw);
        // JSON-string getters return the JSON text itself, list/bool getters return native values.
        return typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v;
      },
      submitWrite: async (account: string, address: string, fn: string, args: unknown[]) => {
        (window as unknown as { __writes: unknown[] }).__writes.push({ account, address, fn, args });
        if (behaviour === "reject") throw new Error("User rejected the transaction in the wallet.");
        return "0x" + "ab".repeat(32);
      },
      waitForFinalization: async () => { await new Promise((r) => setTimeout(r, delayMs ?? 400)); return {}; },
    };
  }, { behaviour: writes.behaviour ?? "ok", delayMs: writes.delayMs ?? 400 });
}

export const writesOf = (page: Page) => page.evaluate(() => (window as unknown as { __writes: Array<{ fn: string; args: unknown[] }> }).__writes);
