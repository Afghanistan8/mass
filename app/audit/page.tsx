"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getLatestLedgerRecord, listAudit, listLedgerKeys, getLedgerRecord, verifyCommitment } from "@/lib/contracts";
import { DECISIONS, formatTime, shortHex } from "@/lib/policy";
import { Field, Notice, PageIntro, Panel, Pill, usePoll } from "@/components/ui";

export default function AuditPage() {
  const [incident, setIncident] = useState("");
  const [digest, setDigest] = useState("");
  const [verdict, setVerdict] = useState<null | { ok: boolean; message: string }>(null);
  useEffect(() => { setIncident(new URLSearchParams(window.location.search).get("incident") ?? ""); }, []);

  const log = usePoll(listAudit, [], 20000);
  const ledger = usePoll(async () => {
    const keys = await listLedgerKeys();
    return (await Promise.all(keys.slice(-10).reverse().map((k) => getLedgerRecord(k)))).filter(Boolean);
  }, [], 20000);
  const focus = usePoll(() => (incident ? getLatestLedgerRecord(incident) : Promise.resolve(null)), [incident]);

  const verify = async () => {
    setVerdict(null);
    if (!incident.trim() || !/^[0-9a-f]{64}$/.test(digest.trim())) { setVerdict({ ok: false, message: "Enter an incident key and a 64-hex commitment digest." }); return; }
    try {
      const ok = await verifyCommitment(incident.trim(), digest.trim());
      setVerdict({ ok, message: ok ? "This commitment is the FINALIZED evidence commitment recorded for that incident." : "No match: this digest is not the finalized commitment for that incident." });
    } catch (e) { setVerdict({ ok: false, message: e instanceof Error ? e.message : "Read failed" }); }
  };

  const entries = (log.data ?? []).filter((e) => !incident || e.incident_key === incident);

  return (
    <div className="space-y-6">
      <PageIntro eyebrow="Audit · evidence explorer" title="Every decision, every digest.">
        The engine keeps an on-chain audit log. The ledger holds the FINALIZED per-source commitments: HTTP status plus normalised and raw content digests for each approved source.
      </PageIntro>

      <Panel eyebrow="Verify" title="Check an evidence commitment">
        <div className="grid gap-4 md:grid-cols-[1fr_2fr_auto] md:items-end">
          <Field label="Incident key"><input className="field" value={incident} onChange={(e) => setIncident(e.target.value)} name="incident" /></Field>
          <Field label="Evidence commitment digest"><input className="field" value={digest} onChange={(e) => setDigest(e.target.value)} name="digest" /></Field>
          <button className="btn" onClick={() => void verify()} data-testid="verify-commitment">Verify</button>
        </div>
        {verdict && <div className="mt-4"><Notice tone={verdict.ok ? "verified" : "rejected"} title={verdict.ok ? "Match" : "No match"}>{verdict.message}</Notice></div>}
        {focus.data && (
          <div className="mt-5 border-t border-line pt-4">
            <p className="eyebrow">Finalized record · {focus.data.incident_key}#{focus.data.attempt}</p>
            <p className="mono mt-2 break-all text-xs text-dim">commitment {focus.data.evidence_commitment_digest}</p>
            <ul className="mt-3 space-y-2">
              {focus.data.commitments.map((c) => (
                <li key={c.url} className="mono break-all border border-line p-3 text-xs">
                  <span className="text-verified">{c.url}</span><br />
                  HTTP {c.http_status} · {c.state}<br />content {c.content_digest || "—"}<br />raw {c.raw_digest || "—"}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      <Panel eyebrow="Engine audit log" title={incident ? `Incident ${incident}` : "All incidents"}>
        {log.error && <Notice tone="rejected" title="Read failed">{log.error}</Notice>}
        {entries.length ? (
          <ol className="divide-y divide-line" data-testid="audit-log">
            {[...entries].reverse().map((e) => {
              const decision = String(e.data.decision ?? "");
              return (
                <li key={e.seq} className="py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mono text-xs text-faint">#{e.seq}</span>
                    <Pill tone={e.kind === "INCIDENT_FROZEN" ? "neutral" : DECISIONS[decision]?.tone ?? "neutral"}>{e.kind === "INCIDENT_FROZEN" ? "Frozen" : DECISIONS[decision]?.label ?? decision}</Pill>
                    <Link className="mono text-verified underline decoration-verified/40" href={`/incident/${e.incident_key}`}>{e.incident_key}</Link>
                    <span className="mono text-xs text-faint">{formatTime(e.at)} · by {shortHex(e.actor)}</span>
                  </div>
                  {e.data.summary ? <p className="mt-2 text-dim">{String(e.data.summary)}</p> : null}
                  {e.data.assessment_digest ? <p className="mono mt-1 break-all text-xs text-faint">assessment {String(e.data.assessment_digest)}</p> : null}
                </li>
              );
            })}
          </ol>
        ) : <p className="text-sm text-dim">{log.loading ? "Reading chain…" : "The audit log is empty."}</p>}
      </Panel>

      {!incident && ledger.data && ledger.data.length > 0 && (
        <Panel eyebrow="Ledger" title="Latest finalized records">
          <ul className="divide-y divide-line">
            {ledger.data.map((r) => r && (
              <li key={`${r.incident_key}#${r.attempt}`} className="py-2 text-sm"><span className="mono text-verified">{r.incident_key}#{r.attempt}</span> · {DECISIONS[r.decision]?.label ?? r.decision} · <span className="mono text-xs text-dim">{shortHex(r.evidence_commitment_digest, 10, 8)}</span></li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
