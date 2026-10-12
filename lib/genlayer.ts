"use client";

import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { ExecutionResult, TransactionHashVariant } from "genlayer-js/types";
import { NETWORK, type Address } from "@/lib/config";

type ProviderError = Error & { code?: number };
export type InjectedProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  providers?: InjectedProvider[];
  isMetaMask?: boolean;
  isBraveWallet?: boolean;
  isCoinbaseWallet?: boolean;
};

// Test-only seam. Compiled out of behaviour in production builds (NODE_ENV guard below).
type E2eMock = {
  readContract?: (address: string, functionName: string, args: unknown[], pending: boolean) => unknown | Promise<unknown>;
  submitWrite?: (account: string, address: string, functionName: string, args: unknown[]) => `0x${string}` | Promise<`0x${string}`>;
  waitForFinalization?: (hash: `0x${string}`) => unknown | Promise<unknown>;
};

declare global {
  interface Window {
    ethereum?: InjectedProvider;
    __MASS_E2E_MOCK__?: E2eMock;
  }
}

const mock = (): E2eMock | undefined =>
  process.env.NODE_ENV !== "production" && typeof window !== "undefined" ? window.__MASS_E2E_MOCK__ : undefined;

export class WalletError extends Error {
  constructor(public readonly kind: "NO_WALLET" | "NO_ACCOUNT" | "WRONG_NETWORK" | "REJECTED" | "FAILED", message: string) {
    super(message);
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const v = error as { message?: unknown; reason?: unknown; data?: { message?: unknown } };
    for (const c of [v.message, v.reason, v.data?.message]) if (typeof c === "string" && c.trim()) return c;
  }
  return "The operation failed with an unreadable error.";
}

export function getInjectedProvider(): InjectedProvider | undefined {
  if (typeof window === "undefined") return undefined;
  const injected = window.ethereum;
  if (!injected) return undefined;
  const list = injected.providers;
  if (!list?.length) return injected;
  return list.find((p) => p.isMetaMask || p.isBraveWallet || p.isCoinbaseWallet) ?? list[0];
}

export const readClient = () => createClient({ chain: studionet, endpoint: NETWORK.rpc });

export async function currentChainId(): Promise<string | undefined> {
  const provider = getInjectedProvider();
  if (!provider) return undefined;
  return String(await provider.request({ method: "eth_chainId" })).toLowerCase();
}

export async function switchToStudionet(): Promise<void> {
  const provider = getInjectedProvider();
  if (!provider) throw new WalletError("NO_WALLET", "No injected EIP-1193 wallet detected.");
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: NETWORK.chainIdHex }] });
  } catch (error) {
    const e = error as ProviderError;
    if (e.code === 4001) throw new WalletError("REJECTED", "Network switch was rejected in the wallet.");
    if (e.code !== 4902) throw new WalletError("WRONG_NETWORK", `Mass requires Studionet 61999. Switch failed: ${errorMessage(e)}`);
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: NETWORK.chainIdHex,
        chainName: "GenLayer Studionet",
        nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
        rpcUrls: [NETWORK.rpc],
        blockExplorerUrls: [NETWORK.explorer],
      }],
    });
  }
  const after = await currentChainId();
  if (after !== NETWORK.chainIdHex) {
    throw new WalletError("WRONG_NETWORK", `Wallet is on chain ${after}; Mass only supports Studionet 61999 (${NETWORK.chainIdHex}).`);
  }
}

export async function connectWallet(): Promise<Address> {
  const provider = getInjectedProvider();
  if (!provider) throw new WalletError("NO_WALLET", "No injected EIP-1193 wallet detected. Install or unlock a browser wallet.");
  let accounts: string[];
  try {
    accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  } catch (error) {
    if ((error as ProviderError).code === 4001) throw new WalletError("REJECTED", "Connection was rejected in the wallet.");
    throw new WalletError("FAILED", errorMessage(error));
  }
  const address = accounts?.[0];
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new WalletError("NO_ACCOUNT", "The wallet returned no usable account address. Unlock it and try again.");
  return address as Address;
}

export async function readContract<T>(address: string, functionName: string, args: unknown[] = [], pending = false): Promise<T> {
  if (!address) throw new Error("Contract address is not configured for this deployment.");
  const m = mock();
  if (m?.readContract) return (await m.readContract(address, functionName, args, pending)) as T;
  const client = readClient();
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return (await client.readContract({
        address: address as Address,
        functionName,
        args,
        transactionHashVariant: pending ? TransactionHashVariant.LATEST_NONFINAL : TransactionHashVariant.LATEST_FINAL,
      } as never)) as T;
    } catch (error) {
      last = error;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
    }
  }
  throw last instanceof Error ? last : new Error(errorMessage(last));
}

export async function submitWrite(account: Address, address: string, functionName: string, args: unknown[] = []): Promise<`0x${string}`> {
  if (!address) throw new Error("Contract address is not configured for this deployment.");
  const m = mock();
  if (m?.submitWrite) return await m.submitWrite(account, address, functionName, args);
  const chain = await currentChainId();
  if (chain !== NETWORK.chainIdHex) await switchToStudionet();
  const provider = getInjectedProvider();
  if (!provider) throw new WalletError("NO_WALLET", "No injected wallet detected.");
  const client = createClient({ chain: studionet, account, provider: provider as never });
  try {
    return (await client.writeContract({ address: address as Address, functionName, args, value: 0n } as never)) as `0x${string}`;
  } catch (error) {
    if ((error as ProviderError).code === 4001) throw new WalletError("REJECTED", "Transaction was rejected in the wallet.");
    throw error;
  }
}

export async function waitForFinalization(hash: `0x${string}`): Promise<unknown> {
  const m = mock();
  if (m?.waitForFinalization) return await m.waitForFinalization(hash);
  const receipt = await readClient().waitForTransactionReceipt({
    hash: hash as never,
    status: "FINALIZED",
    retries: 360,
    interval: 5000,
    fullTransaction: true,
  } as never);
  const v = receipt as unknown as { txExecutionResultName?: ExecutionResult; consensus_data?: { leader_receipt?: Array<{ execution_result?: string }> } };
  const leader = v.consensus_data?.leader_receipt?.find((e) => e.execution_result)?.execution_result;
  const result = v.txExecutionResultName ?? (leader === "SUCCESS" ? ExecutionResult.FINISHED_WITH_RETURN : leader === "ERROR" ? ExecutionResult.FINISHED_WITH_ERROR : undefined);
  if (result !== ExecutionResult.FINISHED_WITH_RETURN) {
    throw new Error(`Studionet finalized the transaction but the contract did not execute successfully (${hash}). The transaction was rejected on-chain.`);
  }
  return receipt;
}
