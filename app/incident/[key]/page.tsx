"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ADDRESSES } from "@/lib/config";
import { getCapability, getIncident, getLatestLedgerRecord, parseAssessment } from "@/lib/contracts";
import { INCIDENT_STATUS, formatTime } from "@/lib/policy";
import { DecisionBanner, FinalityRail, SourceCard, incidentRail } from "@/components/domain";
import { Hex, Kv, Notice, PageIntro, Panel, Pill, usePoll } from "@/components/ui";
import { TxStatus, useTx } from "@/components/tx";
import { useWallet } from "@/components/WalletProvider";

export default function IncidentPage() {
  const { key } = useParams<{ key: string }>();
  const { address } = useWallet();
  const { data, error, loading, reload } = usePoll(async () => {
    const [finalized, pending] = await Promise.all([getIncident(key), getIncident(key, true).catch(() => null)]);
    const capability = finalized?.capability_key ? await getCapability(finalized.capability_key).catch(() => null) : null;
    const ledger = finalized ? await getLatestLedgerRecord(key).catch(() => null) : null;
    return { finalized, pending, capability, ledger };
  }, [key], 8000);
  const tx = useTx(reload);

  if (loading && !data) return <p className="mono text-dim">Reading incident…</p>;
  if (error) return <Notice tone="rejected" title="Read failed">{error}</Notice>;
  const incident = data?.finalized;
  const pending = data?.pending;
  if (!incident) {
    return pending
      ? <Notice tone="pending" title="Incident submitted but not final yet">The freeze transaction is accepted and awaiting FINALIZED. This page refreshes automatically.</Notice>
      : <Notice tone="rejected" title="Incident not found">{key}</Notice>;
  }

  const assessment = parseAssessment(incident);
  const pendingAssessment = parseAssessment(pending ?? null);
  const awaitingFinality = !!pending && pending.assessment_count > incident.assessment_count;
  const st = INCIDENT_STATUS[incident.status] ?? { label: incident.status, tone: "neutral" as const };
  const isRequester = !!address && address.toLowerCase() === incident.requester.toLowerCase();
  const assessable = incident.status === "OPEN" || incident.status === "ASSESSMENT_RETRYABLE";
  const capability = data!.capability;

  return (
    <div className="space-y-6">
      <PageIntro eyebrow="Incident" title={incident.incident_key}>
        Frozen {formatTime(incident.opened_at)} · assessment window closes {formatTime(incident.expires_at)}
      </PageIntro>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={st.tone} pulse={st.tone === "pending"}>{st.label}</Pill>
        <Pill tone="neutral">attempt {incident.assessment_count} / 3</Pill>
      </div>

      <FinalityRail steps={incidentRail(incident, assessment, capability, incident.status)} />

      {awaitingFinality && (
        <Notice tone="pending" title="A newer assessment exists but is NOT final">
          Decision seen in pending state: <span className="mono">{pendingAssessment?.decision ?? "…"}</span>. It carries no authority until FINALIZED; the finalized view below is authoritative.
        </Notice>
      )}

      {assessment ? <DecisionBanner assessment={assessment} /> : (
        <Panel eyebrow="Assessment" title="Not yet assessed">
          <p className="text-sm text-dim">Validators will fetch only the frozen evidence URLs and judge them against the frozen charter. Until the result is FINALIZED nothing can be granted.</p>
        </Panel>
      )}

      {assessment && (
        <Panel eyebrow="Source-level findings" title="What each approved source established">
          <ul className="space-y-3">{assessment.source_states.map((s) => <SourceCard key={s.url} s={s} />)}</ul>
          {assessment.trigger_clauses.length > 0 && (
            <div className="mt-5"><p className="eyebrow">Charter clauses relied on</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{assessment.trigger_clauses.map((c) => <li key={c}>{c}</li>)}</ul></div>
          )}
          {assessment.material_findings.length > 0 && (
            <div className="mt-5"><p className="eyebrow">Material findings</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{assessment.material_findings.map((c) => <li key={c}>{c}</li>)}</ul></div>
          )}
        </Panel>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel eyebrow="Frozen request" title="Bound to the charter">
          <dl>
            <Kv k="Charter"><Link className="text-verified underline" href={`/charter/${incident.charter_key}`}>{incident.charter_key}</Link></Kv>
            <Kv k="Charter digest">{incident.charter_digest}</Kv>
            <Kv k="Action">{incident.action_class}</Kv>
            <Kv k="Scope">{incident.scope}</Kv>
            <Kv k="Duration">{incident.duration_minutes} min</Kv>
            <Kv k="Target"><Hex value={incident.target} full /></Kv>
            <Kv k="Requester"><Hex value={incident.requester} full /></Kv>
            <Kv k="Action digest">{incident.action_digest}</Kv>
            <Kv k="Incident digest">{incident.incident_digest}</Kv>
          </dl>
        </Panel>
        <Panel eyebrow="Provenance" title="Evidence commitments">
          <dl>
            <Kv k="Assessment digest">{incident.assessment_digest || "—"}</Kv>
            <Kv k="Evidence commitment">{incident.evidence_commitment_digest || "—"}</Kv>
            <Kv k="Ledger (finalized)">{data!.ledger ? <span className="text-verified">✓ recorded · {data!.ledger.decision}</span> : incident.assessment_count ? <span className="text-pending">awaiting ledger finality</span> : "—"}</Kv>
          </dl>
          <p className="mt-3 text-xs text-faint">Operator assertion (recorded, never trusted): <span className="text-dim">{incident.reason}</span></p>
          <Link className="btn btn-quiet mt-4" href={`/audit?incident=${incident.incident_key}`}>Open in evidence explorer</Link>
        </Panel>
      </div>

      {capability && (
        <Panel eyebrow="Authority" title="Capability issued after FINALIZED" tone="verified">
          <Link className="btn" href={`/capability/${capability.capability_key}`}>Inspect capability →</Link>
        </Panel>
      )}

      {assessable && (
        <Panel eyebrow="Assess" title="Request validator consensus">
          {!isRequester && address && <Notice tone="rejected" title="Only the incident requester may request an assessment" />}
          <p className="mb-4 text-sm text-dim">This runs leader + validators over live web evidence and can take several minutes on Studionet. Only a FINALIZED TRIGGER_CONFIRMED can lead to a capability.</p>
          <button className="btn" disabled={!isRequester || tx.busy || !!tx.blocked} onClick={() => void tx.run(ADDRESSES.massEngine, "assess_incident", [incident.incident_key])} data-testid="assess-incident">
            {incident.assessment_count ? "Re-assess" : "Assess incident"}
          </button>
          {tx.blocked && <p className="mt-2 text-xs text-dim">{tx.blocked}</p>}
          <div className="mt-3"><TxStatus state={tx.state} /></div>
        </Panel>
      )}
    </div>
  );
}
