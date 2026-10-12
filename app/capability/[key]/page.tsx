"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ADDRESSES } from "@/lib/config";
import { getCapability } from "@/lib/contracts";
import { countdown, formatTime } from "@/lib/policy";
import { DispatchPill, Envelope } from "@/components/domain";
import { Hex, Kv, Notice, PageIntro, Panel, StaleNotice, useNow, usePoll } from "@/components/ui";
import { TxStatus, useTx } from "@/components/tx";
import { useWallet } from "@/components/WalletProvider";

export default function CapabilityPage() {
  const { key } = useParams<{ key: string }>();
  const now = useNow();
  const { address } = useWallet();
  const { data: cap, error, loading, reload } = usePoll(() => getCapability(key), [key], 15000, (d) => d?.dispatch_status !== "APPLIED");
  const tx = useTx(reload);

  if (loading && !cap) return <p className="mono text-dim">Reading capability…</p>;
  if (error && !cap) return <Notice tone="rejected" title="Read failed">{error}</Notice>;
  if (!cap) {
    return <Notice tone="pending" title="No capability with this key exists on the finalized chain">
      A capability appears only after the confirming assessment is FINALIZED and the gate processes the engine’s message. If you just assessed an incident, wait and refresh.
    </Notice>;
  }

  const me = address.toLowerCase();
  const isHolder = me === cap.holder.toLowerCase();
  const isGuardian = !!cap.guardian && me === cap.guardian.toLowerCase();
  const expired = now / 1000 > cap.expires_at;
  const needsGuardian = !!cap.guardian && !cap.guardian_approved;
  const spent = cap.dispatch_status === "APPLIED";
  const canFirstExecute = cap.dispatch_status === "ISSUED" && !expired && !needsGuardian && isHolder;
  const canRecover = cap.dispatch_status === "DISPATCHED" && isHolder;
  const envelope = [cap.action_class, cap.scope, String(cap.duration_minutes), cap.target];

  return (
    <div className="space-y-6">
      <PageIntro eyebrow="Capability" title={cap.capability_key}>
        Single-use, expiring and bound to exactly one action on exactly one target.
      </PageIntro>
      <div className="flex flex-wrap items-center gap-2">
        <DispatchPill status={cap.dispatch_status} />
        {cap.dispatch_status === "ISSUED" && (expired ? <span className="mono text-xs text-rejected">expired {formatTime(cap.expires_at)}</span> : <span className="mono text-xs text-pending">expires in {countdown(cap.expires_at, now)}</span>)}
        <Link className="mono text-xs text-verified underline" href={`/incident/${cap.incident_key}`}>incident {cap.incident_key}</Link>
      </div>

      <StaleNotice error={error} />

      <Envelope e={{ ...cap, expires_at: cap.expires_at }} digest={cap.action_digest} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel eyebrow="Provenance" title="Why this exists">
          <dl>
            <Kv k="Issuer (engine)"><Hex value={cap.issuer} full /></Kv>
            <Kv k="Assessment digest">{cap.assessment_digest}</Kv>
            <Kv k="Issued">{formatTime(cap.issued_at)}</Kv>
            <Kv k="Dispatches">{cap.dispatch_count}</Kv>
          </dl>
        </Panel>
        <Panel eyebrow="Role separation" title="Guardian co-signature">
          {!cap.guardian ? <p className="text-sm text-dim">This charter named no guardian. The holder alone executes.</p> : (
            <>
              <p className="mono text-sm">{cap.guardian_approved ? <span className="text-verified">✓ approved</span> : <span className="text-pending">awaiting guardian</span>} · <Hex value={cap.guardian} full /></p>
              {!cap.guardian_approved && (
                <button className="btn mt-4" disabled={!isGuardian || tx.busy || !!tx.blocked || expired || spent} onClick={() => void tx.run(ADDRESSES.capabilityGate, "approve_capability", [cap.capability_key])} data-testid="approve-capability">Approve as guardian</button>
              )}
              {!isGuardian && !cap.guardian_approved && address && <p className="mt-2 text-xs text-dim">Connect the guardian wallet to approve.</p>}
            </>
          )}
        </Panel>
      </div>

      <Panel eyebrow="Execute" title="Apply the bound action" tone={spent ? "neutral" as never : "verified"}>
        {spent ? <Notice tone="verified" title="Applied · spent">The target applied this capability. Replay is rejected by the gate and by the target.</Notice> : (
          <>
            <ul className="mono mb-4 space-y-1 text-xs text-dim"><li>• envelope: {envelope.join(" · ")}</li><li>• the gate recomputes the digest; the target recomputes it again against its own address</li><li>• execution is emitted on=&quot;finalized&quot;; “dispatched” is not “applied”</li></ul>
            {!isHolder && address && <Notice tone="rejected" title="Only the bound holder can execute this capability" />}
            {needsGuardian && <Notice tone="pending" title="Guardian approval required before execution" />}
            {expired && cap.dispatch_status === "ISSUED" && <Notice tone="rejected" title="Capability expired before first use" />}
            <div className="mt-4 flex flex-wrap gap-3">
              <button className="btn" disabled={!(canFirstExecute || canRecover) || tx.busy || !!tx.blocked} data-testid="execute-capability"
                onClick={() => void tx.run(ADDRESSES.capabilityGate, "execute_capability", [cap.capability_key, cap.target, cap.action_class, cap.scope, cap.duration_minutes])}>
                {canRecover ? "Re-dispatch (exact recovery)" : "Execute capability"}
              </button>
              {cap.dispatch_status === "DISPATCHED" && (
                <button className="btn btn-quiet" disabled={!isHolder || tx.busy || !!tx.blocked} data-testid="reconcile-capability" onClick={() => void tx.run(ADDRESSES.capabilityGate, "reconcile_capability", [cap.capability_key])}>Reconcile</button>
              )}
            </div>
            {tx.blocked && <p className="mt-2 text-xs text-dim">{tx.blocked}</p>}
            <div className="mt-3"><TxStatus state={tx.state} /></div>
          </>
        )}
      </Panel>
    </div>
  );
}
