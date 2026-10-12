"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { NETWORK, type Address } from "@/lib/config";
import { WalletError, connectWallet, currentChainId, errorMessage, getInjectedProvider, switchToStudionet } from "@/lib/genlayer";

export type WalletStatus = "no-wallet" | "disconnected" | "connecting" | "wrong-network" | "ready";

type WalletContextValue = {
  status: WalletStatus;
  address: Address | "";
  chainId: string;
  error: string;
  connect: () => Promise<void>;
  switchNetwork: () => Promise<void>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address | "">("");
  const [chainId, setChainId] = useState("");
  const [status, setStatus] = useState<WalletStatus>("disconnected");
  const [error, setError] = useState("");

  const refresh = useCallback(async (addr: Address | "") => {
    const provider = getInjectedProvider();
    if (!provider) { setStatus("no-wallet"); return; }
    if (!addr) { setStatus("disconnected"); return; }
    const chain = (await currentChainId()) ?? "";
    setChainId(chain);
    setStatus(chain === NETWORK.chainIdHex ? "ready" : "wrong-network");
  }, []);

  useEffect(() => {
    const provider = getInjectedProvider();
    if (!provider) { setStatus("no-wallet"); return; }
    void (async () => {
      try {
        const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
        const first = (accounts?.[0] ?? "") as Address | "";
        setAddress(first);
        await refresh(first);
      } catch { setStatus("disconnected"); }
    })();
    const onAccounts = (accounts: unknown) => {
      const first = ((accounts as string[])?.[0] ?? "") as Address | "";
      setAddress(first);
      void refresh(first);
    };
    const onChain = () => { void refresh(address); };
    provider.on?.("accountsChanged", onAccounts);
    provider.on?.("chainChanged", onChain);
    return () => {
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, [refresh, address]);

  const connect = useCallback(async () => {
    setError(""); setStatus("connecting");
    try {
      const addr = await connectWallet();
      setAddress(addr);
      await refresh(addr);
    } catch (e) {
      setError(errorMessage(e));
      setStatus(e instanceof WalletError && e.kind === "NO_WALLET" ? "no-wallet" : "disconnected");
    }
  }, [refresh]);

  const switchNetwork = useCallback(async () => {
    setError("");
    try { await switchToStudionet(); await refresh(address); } catch (e) { setError(errorMessage(e)); }
  }, [address, refresh]);

  const value = useMemo(() => ({ status, address, chainId, error, connect, switchNetwork }), [status, address, chainId, error, connect, switchNetwork]);
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
