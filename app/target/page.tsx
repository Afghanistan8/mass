"use client";

import { useState } from "react";
import { ADDRESSES } from "@/lib/config";
import { getTargetStatus, listEmergencyHistory } from "@/lib/contracts";
import { countdown, formatTime } from "@/lib/policy";
import { Field, Hex, Kv, Notice, PageIntro, Panel, Pill, StaleNotice, useNow, usePoll } from "@/components/ui";
import { TxStatus, useTx } from "@/components/tx";

export default function TargetPage() {
  const now = useNow();
  const { data, error, loading, reload } = usePoll(async () => ({ status: await getTargetStatus(), history: await listEmergencyHistory() }), [], 20000);
  const [lane, setLane] = useState("swaps");
  const [actionKey, setActionKey] = useState("");
  const tx = useTx(reload);

  if (loading && !data) return <p className="mono text-dim">Reading target…</p>;
  if (error && !data) return <Notice tone="rejected" title="Read failed">{error}</Notice>;
  const s = data?.status;
  if (!s) return <Notice tone="rejected" title="Target status unavailable" />;

  const paused = s.paused && now / 1000 < s.paused_until;
  const laneEntries = Object.entries(s.lanes);

  return (
    <div className="space-y-6">
      <PageIntro eyebrow="Protected target" title="The consequence surface.">
        No admin. No owner pause. No custody. The only way to restrict this contract is a finalized, digest-bound capability delivered by the gate.
      </PageIntro>

      <StaleNotice error={error} />

      <Panel tone={paused ? "pending" : "verified"} eyebrow="Pause state" title={paused ? "Protected actions are PAUSED" : "Protected actions are OPEN"}>
        {paused ? (
          <p className="mono text-pending" data-testid="pause-countdown">Expires by itself in {countdown(s.paused_until, now)} (transaction-time check; no keeper, no unpause call).</p>
        ) : <p className="text-sm text-dim">Nothing is paused. Pause state is evaluated at the time of each transaction.</p>}
        {laneEntries.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-2">
            {laneEntries.map(([name, l]) => {
              const live = l.quarantined && now / 1000 < l.until;
              return <li key={name}><Pill tone={live ? "pending" : "verified"} pulse={live}>{name} · {live ? `quarantined ${countdown(l.until, now)}` : "open"}</Pill></li>;
            })}
          </ul>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel eyebrow="Immutable wiring" title="Authority sources">
          <dl>
            <Kv k="Gate (sole emergency caller)"><Hex value={s.gate_address} full /></Kv>
            <Kv k="Governance wallet"><Hex value={s.governance_address} full /></Kv>
            <Kv k="Protected actions">{s.action_count}</Kv>
            <Kv k="Capabilities applied">{s.applied_capability_count}</Kv>
          </dl>
        </Panel>
        <Panel eyebrow="Normal operation" title="Execute a protected action">
          <p className="mb-4 text-sm text-dim">A direct-EOA, replay-protected operation. It is rejected at transaction time while the target or its lane is paused.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Lane"><input className="field" value={lane} onChange={(e) => setLane(e.target.value)} name="lane" /></Field>
            <Field label="Unique action key"><input className="field" value={actionKey} onChange={(e) => setActionKey(e.target.value)} name="actionKey" /></Field>
          </div>
          {tx.blocked && <p className="mt-3 text-xs text-dim">{tx.blocked}</p>}
          <button className="btn mt-4" disabled={tx.busy || !!tx.blocked || !actionKey.trim()} data-testid="execute-protected-action" onClick={() => void tx.run(ADDRESSES.protectedTarget, "execute_protected_action", [lane.trim().toLowerCase(), actionKey.trim()])}>Execute</button>
          <div className="mt-3"><TxStatus state={tx.state} /></div>
        </Panel>
      </div>

      <Panel eyebrow="Applied emergencies" title="History">
        {data?.history.length ? (
          <ul className="divide-y divide-line">
            {data.history.map((h, i) => (
              <li key={i} className="py-3 text-sm">
                <span className="mono text-verified">{String(h.action_class)}</span> · scope <span className="mono">{String(h.scope)}</span> · {String(h.duration_minutes)} min · incident <span className="mono">{String(h.incident_key)}</span> · {formatTime(Number(h.executed_at))}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-dim">No emergency has ever been applied.</p>}
      </Panel>
    </div>
  );
}
