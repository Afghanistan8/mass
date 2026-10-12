"use client";

import { useCallback, useState } from "react";
import type { Address } from "@/lib/config";
import { clearReadCache, errorMessage, submitWrite, waitForFinalization } from "@/lib/genlayer";
import { Hex, Notice } from "@/components/ui";
import { useWallet } from "@/components/WalletProvider";

export type TxState =
  | { phase: "idle" }
  | { phase: "signing" }
  | { phase: "finalizing"; hash: `0x${string}` }
  | { phase: "finalized"; hash: `0x${string}` }
  | { phase: "failed"; message: string; hash?: `0x${string}` };

// A write is never reported as done when it is merely submitted or accepted: only FINALIZED completes it.
export function useTx(onFinalized?: () => void) {
  const { status, address } = useWallet();
  const [state, setState] = useState<TxState>({ phase: "idle" });
  const blocked = status !== "ready" ? (status === "wrong-network" ? "Switch to Studionet to write." : status === "no-wallet" ? "Install an injected wallet to write." : "Connect your wallet to write.") : "";

  const run = useCallback(async (contract: string, fn: string, args: unknown[]) => {
    if (blocked || !address) { setState({ phase: "failed", message: blocked || "Connect your wallet first." }); return; }
    setState({ phase: "signing" });
    let hash: `0x${string}` | undefined;
    try {
      hash = await submitWrite(address as Address, contract, fn, args);
      setState({ phase: "finalizing", hash });
      await waitForFinalization(hash);
      setState({ phase: "finalized", hash });
      clearReadCache();
      onFinalized?.();
    } catch (e) {
      setState({ phase: "failed", message: errorMessage(e), hash });
    }
  }, [address, blocked, onFinalized]);

  return { state, run, blocked, busy: state.phase === "signing" || state.phase === "finalizing" };
}

export function TxStatus({ state }: { state: TxState }) {
  if (state.phase === "idle") return null;
  if (state.phase === "signing") return <Notice tone="pending" title="Awaiting wallet signature" />;
  if (state.phase === "finalizing")
    return <div data-testid="tx-finalizing"><Notice tone="pending" title="Submitted · waiting for FINALIZED">Accepted is not final. Nothing downstream is granted until finality. Tx <Hex value={state.hash} kind="tx" /></Notice></div>;
  if (state.phase === "finalized")
    return <div data-testid="tx-finalized"><Notice tone="verified" title="FINALIZED">Tx <Hex value={state.hash} kind="tx" /></Notice></div>;
  return <div data-testid="tx-failed"><Notice tone="rejected" title="Rejected">{state.message}{state.hash && <> · <Hex value={state.hash} kind="tx" /></>}</Notice></div>;
}
