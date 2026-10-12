// Live health: Studionet reads, cross-contract wiring, exact deployed-source byte match,
// and (optionally) the hosted frontend + build provenance.
//   MASS_HEALTH_BASE_URL=https://... EXPECTED_FRONTEND_COMMIT=<sha> node scripts/check-deployment-health.mjs
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const rpc = "https://studio.genlayer.com/api";
const manifest = JSON.parse(readFileSync(new URL("../deployment-manifest.public.json", import.meta.url), "utf8"));
if (Number(manifest.chainId) !== 61999 || manifest.rpc.replace(/\/$/, "") !== rpc) throw new Error("health check refused a non-Studionet manifest");
const C = manifest.contracts;
const lc = (v) => String(v).toLowerCase();
const client = createClient({ chain: studionet, endpoint: rpc });
const read = (address, functionName, args = []) => client.readContract({ address, functionName, args });
const must = (cond, msg) => { if (!cond) throw new Error(`health failed: ${msg}`); };

const rpcResponse = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "gen_getContractSchema", params: [C.protectedTarget] }) });
must(rpcResponse.ok, `Studionet RPC returned HTTP ${rpcResponse.status}`);

const [charters, incidents, capabilities, ledgerRecords, audit] = await Promise.all([
  read(C.charterRegistry, "list_charter_keys"), read(C.massEngine, "list_incident_keys"),
  read(C.capabilityGate, "list_capability_keys"), read(C.evidenceLedger, "list_record_keys"), read(C.massEngine, "get_audit_length"),
]);
const status = JSON.parse(await read(C.protectedTarget, "get_status_json"));
const bindings = JSON.parse(await read(C.massEngine, "get_bindings"));

must(lc(await read(C.capabilityGate, "get_engine_address")) === lc(C.massEngine), "gate is not bound to the engine");
must(lc(await read(C.evidenceLedger, "get_engine_address")) === lc(C.massEngine), "ledger is not bound to the engine");
must(lc(bindings.registry) === lc(C.charterRegistry) && lc(bindings.gate) === lc(C.capabilityGate) && lc(bindings.ledger) === lc(C.evidenceLedger), "engine bindings differ from the manifest");
must(lc(status.gate_address) === lc(C.capabilityGate), "target gate address differs from the manifest");
must(lc(await read(C.protectedTarget, "get_gate_address")) === lc(C.capabilityGate), "target get_gate_address differs");
must(typeof status.paused === "boolean" && typeof status.action_count === "string", "target status is not the current schema");
must(lc(status.governance_address) === lc(manifest.deployer), "target governance wallet is not the manifest deployer");

const baseUrl = process.env.MASS_HEALTH_BASE_URL;
let frontend = "skipped (set MASS_HEALTH_BASE_URL)";
if (baseUrl) {
  for (const route of ["/", "/command", "/target", "/audit"]) {
    const response = await fetch(`${baseUrl}${route}`, { redirect: "follow" });
    const body = await response.text();
    must(response.ok && !/Application error|This page could not load/i.test(body), `frontend ${route} HTTP ${response.status}`);
  }
  const info = await (await fetch(`${baseUrl}/api/build-info`, { cache: "no-store" })).json();
  const expected = process.env.EXPECTED_FRONTEND_COMMIT || manifest.frontend?.sourceCommit || "";
  must(!expected || info.gitCommitSha === expected, `frontend commit ${info.gitCommitSha} != expected ${expected}`);
  must(info.chainId === 61999 && lc(info.contracts.massEngine) === lc(C.massEngine), "frontend build-info points at a different deployment");
  frontend = `ok · commit ${info.gitCommitSha} · deployment ${info.deploymentId}`;
}

const verify = spawnSync(process.execPath, [new URL("./verify-deployed-source.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")], { encoding: "utf8" });
must(verify.status === 0, `deployed source does not match the repository\n${verify.stdout}${verify.stderr}`);

console.log(JSON.stringify({
  network: manifest.network, chainId: manifest.chainId, rpcReachable: true, sourceBytesMatch: true,
  wiring: { gateBoundToEngine: true, ledgerBoundToEngine: true, engineBindings: true, targetGate: true, targetGovernanceIsDeployer: true },
  counts: { charters: charters.length, incidents: incidents.length, capabilities: capabilities.length, ledgerRecords: ledgerRecords.length, auditEntries: Number(audit) },
  targetPaused: status.paused, frontend,
}, null, 2));
