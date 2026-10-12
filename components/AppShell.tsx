"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { NETWORK } from "@/lib/config";
import { shortHex } from "@/lib/policy";
import { NavLink, Notice } from "@/components/ui";
import { WalletProvider, useWallet } from "@/components/WalletProvider";

const NAV = [
  ["/command", "Command"],
  ["/charter/new", "Charter"],
  ["/incident/new", "Incident"],
  ["/target", "Target"],
  ["/audit", "Audit"],
] as const;

const segment = (p: string) => "/" + (p.split("/")[1] ?? "");
// Capabilities live under the incident flow, so /capability/* keeps "Incident" highlighted.
const isActive = (path: string, href: string) =>
  segment(path) === segment(href) || (segment(href) === "/incident" && segment(path) === "/capability");

function WalletBar() {
  const { status, address, connect, switchNetwork } = useWallet();
  return (
    <div className="flex flex-wrap items-center gap-3">
      {status === "ready" && <span className="mono text-xs text-verified" data-testid="wallet-address">● {shortHex(address)}</span>}
      {status === "no-wallet" && <span className="mono text-xs text-dim" data-testid="wallet-missing">No wallet</span>}
      {status === "wrong-network" && (
        <button className="btn border-rejected text-rejected" onClick={() => void switchNetwork()} data-testid="switch-network">Switch to Studionet</button>
      )}
      {(status === "disconnected" || status === "connecting" || status === "no-wallet") && (
        <button className="btn" onClick={() => void connect()} disabled={status === "connecting"} data-testid="connect-wallet">
          {status === "connecting" ? "Connecting…" : "Connect wallet"}
        </button>
      )}
    </div>
  );
}

function NetworkBanner() {
  const { status, chainId, error } = useWallet();
  if (status === "no-wallet")
    return <Notice tone="pending" title="No injected wallet detected">Mass reads the chain without a wallet, but publishing, assessing and executing need an injected EIP-1193 wallet (MetaMask, Rabby, Brave). {error}</Notice>;
  if (status === "wrong-network")
    return <Notice tone="rejected" title={`Wrong network · wallet is on ${chainId || "unknown"}`}>Mass runs only on Studionet (chain {NETWORK.chainId}). Writes are blocked until you switch.</Notice>;
  if (error) return <Notice tone="rejected" title="Wallet error">{error}</Notice>;
  return null;
}

function Shell({ children }: { children: ReactNode }) {
  const path = usePathname() ?? "/";
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line py-4">
        <Link href="/" className="flex items-baseline gap-3" aria-label="Mass home">
          <span className="display text-2xl tracking-tight">Mass</span>
          <span className="eyebrow max-sm:hidden">Emergency authority · Studionet {NETWORK.chainId}</span>
        </Link>
        <WalletBar />
      </header>
      <nav aria-label="Primary" className="-mx-3 flex overflow-x-auto border-b border-line">
        {NAV.map(([href, label]) => <NavLink key={href} href={href} active={isActive(path, href)}>{label}</NavLink>)}
      </nav>
      <div className="mt-4 empty:hidden"><NetworkBanner /></div>
      <main className="flex-1 py-10">{children}</main>
      <footer className="mono border-t border-line py-6 text-xs text-faint">
        Mass of evidence. Mass of consensus. Zero self-certification. · <a className="hover:text-dim" href="/api/build-info">build-info</a>
      </footer>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return <WalletProvider><Shell>{children}</Shell></WalletProvider>;
}
