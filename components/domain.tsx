"use client";

import { useEffect, useState } from "react";
import type { Assessment, Capability, Incident, SourceState } from "@/lib/contracts";
import { actionDigest } from "@/lib/digest";
import { DECISIONS, DISPATCH, SOURCE_STATE, formatTime, type Tone } from "@/lib/policy";
import { Hex, Kv, Panel, Pill } from "@/components/ui";

export type RailStep = { label: string; detail: string; tone: Tone; done: boolean };

export function FinalityRail({ steps }: { steps: RailStep[] }) {
  return (
    <ol className="grid gap-px border border-line bg-line sm:grid-cols-4" aria-label="Authority timeline" data-testid="finality-rail">
      {steps.map((s, i) => (
        <li key={s.label} className="bg-panel p-4">
          <p className="eyebrow">{String(i + 1).padStart(2, "0")} · {s.label}</p>
          <p className={`mono mt-2 text-sm ${s.tone === "verified" ? "text-verified" : s.tone === "pending" ? "text-pending" : s.tone === "rejected" ? "text-rejected" : "text-faint"} ${!s.done && s.tone === "pending" ? "pulse-pending" : ""}`}>
            {s.done ? "✓ " : ""}{s.detail}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function incidentRail(incident: Incident, assessment: Assessment | null, capability: Capability | null, finalizedStatus: string | undefined): RailStep[] {
  const assessed = !!assessment;
  const confirmed = assessment?.decision === "TRIGGER_CONFIRMED";
  const finalAuthority = finalizedStatus === "AUTHORITY_PENDING_FINALITY" || !!capability;
  return [
    { label: "Frozen", detail: `charter ${incident.charter_digest.slice(0, 10)}…`, tone: "verified", done: true },
    { label: "Assessed", detail: assessed ? DECISIONS[assessment!.decision]?.label ?? assessment!.decision : "awaiting assessment", tone: !assessed ? "pending" : confirmed ? "verified" : "rejected", done: assessed },
    { label: "Finalized", detail: !assessed ? "—" : !confirmed ? "no authority path" : finalAuthority ? "assessment FINALIZED" : "awaiting FINALIZED", tone: !assessed ? "neutral" : !confirmed ? "rejected" : finalAuthority ? "verified" : "pending", done: finalAuthority && confirmed },
    { label: "Capability", detail: capability ? capability.dispatch_status === "ISSUED" ? "issued · unused" : capability.dispatch_status.toLowerCase() : confirmed ? "issued after finality" : "none", tone: capability ? "verified" : confirmed ? "pending" : "neutral", done: !!capability },
  ];
}

export function DecisionBanner({ assessment }: { assessment: Assessment }) {
  const meta = DECISIONS[assessment.decision] ?? { label: assessment.decision, tone: "rejected" as Tone, grants: false, meaning: "Unrecognised outcome. Treated as no authority." };
  return (
    <Panel tone={meta.tone} eyebrow={`Assessment · attempt ${assessment.attempt}`}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="display text-3xl" data-testid="decision-label">{meta.label}</h2>
        <Pill tone={meta.tone}>{assessment.decision}</Pill>
        <Pill tone={meta.grants ? "pending" : "rejected"}>{meta.grants ? "Grants authority only after FINALIZED" : "Grants no authority"}</Pill>
      </div>
      <p className="mt-3 max-w-3xl text-dim">{meta.meaning}</p>
      {assessment.summary && <p className="mt-3 border-l border-line-strong pl-3 text-sm">{assessment.summary}</p>}
      {assessment.authority_status === "TARGET_GOVERNANCE_REJECTED" && (
        <p className="mono mt-3 text-sm text-rejected">Target governance rejected this charter owner: no capability can be issued.</p>
      )}
    </Panel>
  );
}

export function SourceCard({ s }: { s: SourceState }) {
  const meta = SOURCE_STATE[s.state] ?? SOURCE_STATE.UNAVAILABLE;
  return (
    <li className="border border-line bg-graphite p-4" data-testid="source-card">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={meta.tone}>{meta.label}</Pill>
        <Pill tone={s.http_status >= 200 && s.http_status < 300 ? "verified" : "rejected"}>HTTP {s.http_status || "—"}</Pill>
        {s.injection_flagged && <Pill tone="rejected">Injection tripwire</Pill>}
      </div>
      <p className="mono mt-2 break-all text-sm"><a className="text-verified underline decoration-verified/40" href={s.url} target="_blank" rel="noreferrer">{s.url}</a></p>
      {s.finding && <p className="mt-2 text-sm text-dim">{s.finding}</p>}
      {s.quote && <blockquote className="mono mt-2 border-l-2 border-verified/60 pl-3 text-xs text-text">“{s.quote}” <span className="text-faint">· verbatim-verified by every validator</span></blockquote>}
      <dl className="mt-3 grid gap-1 text-xs">
        <div className="flex gap-2"><dt className="eyebrow w-28 shrink-0">content sha256</dt><dd className="mono break-all text-dim">{s.content_digest || "—"}</dd></div>
        <div className="flex gap-2"><dt className="eyebrow w-28 shrink-0">raw sha256</dt><dd className="mono break-all text-dim">{s.raw_digest || "—"}</dd></div>
      </dl>
    </li>
  );
}

export function Envelope({ e, digest }: { e: { target: string; action_class: string; scope: string; duration_minutes: number; holder?: string; guardian?: string; incident_key: string; charter_digest: string; expires_at?: number }; digest: string }) {
  const [recomputed, setRecomputed] = useState<string>("");
  useEffect(() => {
    let alive = true;
    actionDigest({ incident_key: e.incident_key, charter_digest: e.charter_digest, target: e.target, action_class: e.action_class, scope: e.scope, duration_minutes: e.duration_minutes })
      .then((d) => alive && setRecomputed(d));
    return () => { alive = false; };
  }, [e.incident_key, e.charter_digest, e.target, e.action_class, e.scope, e.duration_minutes]);
  const match = recomputed ? recomputed === digest : null;
  return (
    <Panel eyebrow="Authority envelope" title="Exactly this, and nothing else" tone={match === false ? "rejected" : "verified"}>
      <dl>
        <Kv k="Action">{e.action_class}</Kv>
        <Kv k="Scope">{e.scope}</Kv>
        <Kv k="Duration">{e.duration_minutes} minutes (hard-bound; cannot expand)</Kv>
        <Kv k="Target"><Hex value={e.target} full /></Kv>
        {e.holder && <Kv k="Holder"><Hex value={e.holder} full /></Kv>}
        {e.guardian ? <Kv k="Guardian co-sign"><Hex value={e.guardian} full /></Kv> : <Kv k="Guardian co-sign">none chartered</Kv>}
        {e.expires_at ? <Kv k="Issuance expiry">{formatTime(e.expires_at)}</Kv> : null}
        <Kv k="Charter digest"><span title={e.charter_digest}>{e.charter_digest}</span></Kv>
        <Kv k="Action digest">{digest}</Kv>
        <Kv k="Recomputed here">
          {match === null ? "…" : match ? <span className="text-verified" data-testid="digest-match">✓ matches: recomputed in your browser from the envelope above</span> : <span className="text-rejected" data-testid="digest-mismatch">✗ MISMATCH — do not trust this capability</span>}
        </Kv>
      </dl>
    </Panel>
  );
}

export function DispatchPill({ status }: { status: string }) {
  const m = DISPATCH[status] ?? DISPATCH.ISSUED;
  return <Pill tone={m.tone} pulse={status === "DISPATCHED"}>{m.label}</Pill>;
}
