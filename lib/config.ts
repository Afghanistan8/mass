import manifest from "@/deployment-manifest.public.json";

export const NETWORK = {
  name: "Studionet",
  chainId: 61999,
  chainIdHex: "0xf22f",
  rpc: "https://studio.genlayer.com/api",
  explorer: "https://explorer-studio.genlayer.com",
} as const;

export type Address = `0x${string}`;
export type ContractName = "charterRegistry" | "massEngine" | "capabilityGate" | "protectedTarget" | "evidenceLedger";

const pick = (env: string | undefined, fallback: string | undefined): Address | "" => {
  const value = (env || fallback || "").trim();
  return /^0x[0-9a-fA-F]{40}$/.test(value) ? (value as Address) : "";
};

export const ADDRESSES: Record<ContractName, Address | ""> = {
  charterRegistry: pick(process.env.NEXT_PUBLIC_CHARTER_REGISTRY_ADDRESS, manifest.contracts.charterRegistry),
  massEngine: pick(process.env.NEXT_PUBLIC_MASS_ENGINE_ADDRESS, manifest.contracts.massEngine),
  capabilityGate: pick(process.env.NEXT_PUBLIC_CAPABILITY_GATE_ADDRESS, manifest.contracts.capabilityGate),
  protectedTarget: pick(process.env.NEXT_PUBLIC_PROTECTED_TARGET_ADDRESS, manifest.contracts.protectedTarget),
  evidenceLedger: pick(process.env.NEXT_PUBLIC_EVIDENCE_LEDGER_ADDRESS, manifest.contracts.evidenceLedger),
};

export const CONTRACT_LABELS: Record<ContractName, string> = {
  charterRegistry: "CharterRegistry",
  massEngine: "MassEngine",
  capabilityGate: "CapabilityGate",
  protectedTarget: "ProtectedTarget",
  evidenceLedger: "EvidenceLedger",
};

export const ACTION_CLASSES = ["PAUSE_PROTECTED_ACTION", "QUARANTINE_LANE"] as const;
export type ActionClass = (typeof ACTION_CLASSES)[number];

export const explorerAddress = (address: string) => `${NETWORK.explorer}/address/${address}`;
export const explorerTx = (hash: string) => `${NETWORK.explorer}/transactions/${hash}`;
