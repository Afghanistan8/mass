"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { explorerAddress, explorerTx } from "@/lib/config";
import { shortHex, type Tone } from "@/lib/policy";

const toneClass: Record<Tone, string> = {
  verified: "text-verified border-verified/60 bg-verified/10",
  pending: "text-pending border-pending/60 bg-pending/10",
  rejected: "text-rejected border-rejected/60 bg-rejected/10",
  neutral: "text-dim border-line-strong bg-raise",
};

export function Pill({ tone, children, pulse }: { tone: Tone; children: ReactNode; pulse?: boolean }) {
  return (
    <span className={`mono inline-flex items-center gap-2 border px-2 py-0.5 text-[0.7rem] uppercase tracking-widest ${toneClass[tone]}`}>
      <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full bg-current ${pulse ? "pulse-pending" : ""}`} />
      {children}
    </span>
  );
}

export function Panel({ title, eyebrow, children, tone, className = "" }: { title?: string; eyebrow?: string; children: ReactNode; tone?: Tone; className?: string }) {
  const edge = tone === "verified" ? "border-verified/50" : tone === "pending" ? "border-pending/50" : tone === "rejected" ? "border-rejected/50" : "border-line";
  return (
    <section className={`tick border ${edge} bg-panel/90 p-5 ${className}`}>
      {(eyebrow || title) && (
        <header className="mb-4">
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          {title && <h2 className="display mt-1 text-xl">{title}</h2>}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageIntro({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-8 max-w-3xl">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="display mt-2 text-4xl leading-tight sm:text-5xl">{title}</h1>
      {children && <div className="mt-3 text-dim leading-relaxed">{children}</div>}
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="eyebrow">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && !error && <span className="mt-1 block text-xs text-faint">{hint}</span>}
      {error && <span role="alert" className="mt-1 block text-xs text-rejected">{error}</span>}
    </label>
  );
}

export function Kv({ k, children, mono = true }: { k: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 border-b border-line py-2 text-sm last:border-0 max-sm:grid-cols-1 max-sm:gap-0.5">
      <dt className="eyebrow pt-0.5">{k}</dt>
      <dd className={`${mono ? "mono" : ""} break-all text-text`}>{children}</dd>
    </div>
  );
}

export function Hex({ value, kind = "address", full }: { value: string; kind?: "address" | "tx" | "digest"; full?: boolean }) {
  if (!value) return <span className="text-faint">—</span>;
  const text = full ? value : shortHex(value, kind === "digest" ? 10 : 6);
  if (kind === "digest") return <span className="mono" title={value}>{text}</span>;
  const href = kind === "tx" ? explorerTx(value) : explorerAddress(value);
  return <a className="mono text-verified underline decoration-verified/40 underline-offset-2 hover:decoration-verified" href={href} target="_blank" rel="noreferrer" title={value}>{text}</a>;
}

export function Notice({ tone, title, children }: { tone: Tone; title: string; children?: ReactNode }) {
  return (
    <div role={tone === "rejected" ? "alert" : "status"} className={`border-l-2 px-4 py-3 text-sm ${toneClass[tone]}`}>
      <p className="mono text-xs uppercase tracking-widest">{title}</p>
      {children && <div className="mt-1 text-text/90">{children}</div>}
    </div>
  );
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(id); }, [intervalMs]);
  return now;
}

export function usePoll<T>(load: () => Promise<T>, deps: unknown[], intervalMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    load().then((v) => { if (alive) { setData(v); setError(""); } })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  useEffect(() => {
    if (!intervalMs) return;
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}

export function NavLink({ href, children, active }: { href: string; children: ReactNode; active: boolean }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined}
      className={`mono whitespace-nowrap px-3 py-2 text-xs uppercase tracking-widest ${active ? "text-verified" : "text-dim hover:text-text"}`}>
      {children}
    </Link>
  );
}
