import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import type { GenLayerClient, TransactionHash } from "genlayer-js/types";

const CHAIN_ID = 61999;
const RPC = "https://studio.genlayer.com/api";
const EXPLORER = "https://explorer-studio.genlayer.com";

const FILES = {
  evidenceLedger: "evidence_ledger.py",
  capabilityGate: "capability_gate.py",
  charterRegistry: "charter_registry.py",
  massEngine: "mass_engine.py",
  protectedTarget: "protected_target.py",
} as const;

const sourcePath = (file: string) => path.resolve(process.cwd(), "contracts", file);
const sourceBytes = (file: string) => new Uint8Array(readFileSync(sourcePath(file)));
const sha256 = (file: string) => createHash("sha256").update(readFileSync(sourcePath(file))).digest("hex");

async function waitFinal(client: GenLayerClient<any>, hash: TransactionHash) {
  const receipt: any = await client.waitForTransactionReceipt({
    hash,
    status: "FINALIZED",
    retries: 360,
    interval: 5000,
    fullTransaction: true,
  } as any);
  const leader = receipt?.consensus_data?.leader_receipt?.find((e: any) => e?.execution_result)?.execution_result;
  const result = receipt?.txExecutionResultName ?? (leader === "SUCCESS" ? "FINISHED_WITH_RETURN" : leader === "ERROR" ? "FINISHED_WITH_ERROR" : undefined);
  if (result !== "FINISHED_WITH_RETURN") {
    throw new Error(`Finalized transaction did not prove successful execution: ${String(hash)} (${String(result ?? "unknown")})`);
  }
  return receipt;
}

async function deployOne(client: GenLayerClient<any>, file: string, args: unknown[]) {
  const txId = await client.deployContract({ code: sourceBytes(file), args: args as any[] });
  console.log(`[deploy] ${file}: ${txId}`);
  const receipt = await waitFinal(client, txId as TransactionHash);
  const address = receipt?.data?.contract_address ?? receipt?.txDataDecoded?.contractAddress;
  if (!address) throw new Error(`Deployment finalized but no address was decoded for ${file}`);
  console.log(`[finalized] ${file}: ${address}`);
  return { address: String(address), txId: String(txId), sha256: sha256(file) };
}

async function write(client: GenLayerClient<any>, address: string, functionName: string, args: unknown[]) {
  const txId = await client.writeContract({ address: address as `0x${string}`, functionName, args: args as any[], value: 0n } as any);
  console.log(`[write] ${functionName}: ${txId}`);
  await waitFinal(client, txId as TransactionHash);
  console.log(`[finalized] ${functionName}: ${txId}`);
  return String(txId);
}

function gitCommit(): string {
  try {
    const head = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const dirty = execSync("git status --porcelain -- contracts", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    // A dirty contracts/ directory means HEAD does not describe the deployed bytes; say so.
    return dirty ? `${head}+uncommitted-contract-changes` : head;
  } catch {
    return "unknown";
  }
}

export default async function main(client: GenLayerClient<any>) {
  // Hard refusal: Mass exists only on stable Studionet.
  if (Number(client.chain?.id) !== CHAIN_ID) {
    throw new Error(`Mass deploys only to Studionet ${CHAIN_ID}; connected chain is ${client.chain?.id}. Refusing.`);
  }
  console.log(`Mass deployment target: Studionet ${CHAIN_ID} (${RPC})`);
  await client.initializeConsensusSmartContract();

  const deployer = String((client as any).account?.address ?? "");
  const ledger = await deployOne(client, FILES.evidenceLedger, []);
  const gate = await deployOne(client, FILES.capabilityGate, []);
  const registry = await deployOne(client, FILES.charterRegistry, []);
  const engine = await deployOne(client, FILES.massEngine, [registry.address, gate.address, ledger.address]);
  const bindGate = await write(client, gate.address, "bind_engine", [engine.address]);
  const bindLedger = await write(client, ledger.address, "bind_engine", [engine.address]);
  const target = await deployOne(client, FILES.protectedTarget, [gate.address]);

  const env = [
    "NEXT_PUBLIC_GENLAYER_CHAIN_ID=61999",
    `NEXT_PUBLIC_GENLAYER_RPC_URL=${RPC}`,
    `NEXT_PUBLIC_GENLAYER_EXPLORER=${EXPLORER}`,
    `NEXT_PUBLIC_CHARTER_REGISTRY_ADDRESS=${registry.address}`,
    `NEXT_PUBLIC_MASS_ENGINE_ADDRESS=${engine.address}`,
    `NEXT_PUBLIC_CAPABILITY_GATE_ADDRESS=${gate.address}`,
    `NEXT_PUBLIC_PROTECTED_TARGET_ADDRESS=${target.address}`,
    `NEXT_PUBLIC_EVIDENCE_LEDGER_ADDRESS=${ledger.address}`,
    "",
  ].join("\n");
  writeFileSync(path.resolve(process.cwd(), ".env.generated"), env);

  const manifest = {
    project: "Mass",
    network: "studionet",
    chainId: CHAIN_ID,
    rpc: RPC,
    explorer: EXPLORER,
    deployer,
    genvmRunner: "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6",
    contracts: {
      charterRegistry: registry.address,
      massEngine: engine.address,
      capabilityGate: gate.address,
      protectedTarget: target.address,
      evidenceLedger: ledger.address,
    },
    sources: {
      charterRegistry: { path: `contracts/${FILES.charterRegistry}`, sha256: registry.sha256 },
      massEngine: { path: `contracts/${FILES.massEngine}`, sha256: engine.sha256 },
      capabilityGate: { path: `contracts/${FILES.capabilityGate}`, sha256: gate.sha256 },
      protectedTarget: { path: `contracts/${FILES.protectedTarget}`, sha256: target.sha256 },
      evidenceLedger: { path: `contracts/${FILES.evidenceLedger}`, sha256: ledger.sha256 },
    },
    deploymentTransactions: {
      evidenceLedger: ledger.txId,
      capabilityGate: gate.txId,
      charterRegistry: registry.txId,
      massEngine: engine.txId,
      protectedTarget: target.txId,
    },
    bindTransactions: { gateBindEngine: bindGate, ledgerBindEngine: bindLedger },
    repositoryCommit: gitCommit(),
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(path.resolve(process.cwd(), "deployment-manifest.generated.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify(manifest, null, 2));
}
