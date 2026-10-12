"use client";

import Link from "next/link";
import { ADDRESSES, CONTRACT_LABELS, type ContractName } from "@/lib/config";
import { getCapability, getCapabilityKeyForIncident, getIncident, getTargetStatus, listCapabilityKeys, listCharterKeys, listIncidentKeys, getCharter, parseAssessment, type Capability } from "@/lib/contracts";
import { DECISIONS, countdown, incidentDisplay, shortHex } from "@/lib/policy";
import { DispatchPill } from "@/components/domain";
import { Hex, Notice, PageIntro, Panel, Pill, StaleNotice, useNow, usePoll } from "@/components/ui";

// Studionet allows 30 public reads/min per address, so the overview reads only the 4 newest of each kind (about 16 calls, then cached).
const SHOW = 4;

async function loadOverview() {
  const [charterKeys, incidentKeys, capabilityKeys, target] = await Promise.all([
    listCharterKeys(), listIncidentKeys(), listCapabilityKeys(), getTargetStatus(),
  ]);
  const [charters, incidents, capabilities] = await Promise.all([
    Promise.all(charterKeys.slice(-SHOW).reverse().map((k) => getCharter(k))),
    Promise.all(incidentKeys.slice(-SHOW).reverse().map((k) => getIncident(k))),
    Promise.all(capabilityKeys.slice(-SHOW).reverse().map((k) => getCapability(k))),
  ]);
  const caps = capabilities.filter((c): c is Capability => !!c);
  // An incident the engine still labels "pending finality" may already own a capability; show the truth.
  const capByIncident = new Map<string, Capability>(caps.map((c) => [c.incident_key, c]));
  for (const incident of incidents) {
    if (!incident || incident.status !== "AUTHORITY_PENDING_FINALITY" || capByIncident.has(incident.incident_key)) continue;
    const key = await getCapabilityKeyForIncident(incident.incident_key).catch(() => "");
    const cap = key ? await getCapability(key).catch(() => null) : null;
    if (cap) capByIncident.set(incident.incident_key, cap);
  }
  return {
    counts: { charters: charterKeys.length, incidents: incidentKeys.length, capabilities: capabilityKeys.length },
    target,
    charters: charters.filter(Boolean),
    incidents: incidents.filter(Boolean),
    capabilities: caps,
    capByIncident,
  };
}

function Tile({ label, value, tone }: { label: string; value: string | number; tone?: "verified" | "pending" | "rejected" }) {
  const color = tone === "verified" ? "text-verified" : tone === "pending" ? "text-pending" : tone === "rejected" ? "text-rejected" : "text-text";
  return (
    <div className="bg-panel p-5">
      <p className="eyebrow">{label}</p>
      <p className={`display mt-2 text-4xl ${color}`}>{value}</p>
    </div>
  );
}

export default function CommandPage() {
  const now = useNow();
  const { data, error, loading } = usePoll(loadOverview, [], 30000);
  const target = data?.target;
  const configured = (Object.keys(ADDRESSES) as ContractName[]).every((k) => ADDRESSES[k]);

  return (
    <div className="space-y-8">
      <PageIntro eyebrow="Command" title="Live on-chain authority">
        Everything below is read from finalized Studionet state. Pending assessments are marked as such and carry no authority.
      </PageIntro>

      {!configured && <Notice tone="pending" title="Deployment not configured">One or more contract addresses are missing from deployment-manifest.public.json.</Notice>}
      {error && !data && <Notice tone="rejected" title="Read failed">{error}</Notice>}
      {data && <StaleNotice error={error} />}

      <div className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4" data-testid="command-tiles">
        <Tile label="Charters" value={loading && !data ? "…" : data?.counts.charters ?? 0} />
        <Tile label="Incidents" value={loading && !data ? "…" : data?.counts.incidents ?? 0} />
        <Tile label="Capabilities issued" value={loading && !data ? "…" : data?.counts.capabilities ?? 0} tone="verified" />
        <Tile label="Target" value={!target ? "…" : target.paused ? "PAUSED" : "OPEN"} tone={!target ? undefined : target.paused ? "pending" : "verified"} />
      </div>
      {target?.paused && (
        <Notice tone="pending" title="Protected actions paused by finalized capability">
          Expires on its own in <span className="mono">{countdown(target.paused_until, now)}</span>. No keeper and no unpause call exist.
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel eyebrow="Incidents" title="Latest">
          {data?.incidents.length ? (
            <ul className="divide-y divide-line">
              {data.incidents.map((i) => {
                const a = parseAssessment(i!);
                const st = incidentDisplay(i!.status, data.capByIncident.get(i!.incident_key));
                return (
                  <li key={i!.incident_key} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <Link className="mono text-verified underline decoration-verified/40" href={`/incident/${i!.incident_key}`}>{i!.incident_key}</Link>
                    <span className="flex items-center gap-2">
                      {a && <Pill tone={DECISIONS[a.decision]?.tone ?? "neutral"}>{DECISIONS[a.decision]?.label ?? a.decision}</Pill>}
                      <Pill tone={st.tone} pulse={st.pulse}>{st.label}</Pill>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : <p className="text-sm text-dim">{loading ? "Reading chain…" : "No incidents have been frozen."}</p>}
        </Panel>

        <Panel eyebrow="Capabilities" title="Latest">
          {data?.capabilities.length ? (
            <ul className="divide-y divide-line">
              {data.capabilities.map((c) => (
                <li key={c!.capability_key} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <Link className="mono text-verified underline decoration-verified/40" href={`/capability/${c!.capability_key}`}>{c!.capability_key}</Link>
                  <span className="flex items-center gap-2"><Pill tone="neutral">{c!.action_class}</Pill><DispatchPill status={c!.dispatch_status} /></span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-dim">{loading ? "Reading chain…" : "No capability has ever been issued. That is the safe default."}</p>}
        </Panel>

        <Panel eyebrow="Charters" title="Latest">
          {data?.charters.length ? (
            <ul className="divide-y divide-line">
              {data.charters.map((c) => (
                <li key={c!.charter_key} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <Link className="mono text-verified underline decoration-verified/40" href={`/charter/${c!.charter_key}`}>{c!.charter_key}</Link>
                  <span className="mono text-xs text-dim">{c!.protocol_name} · v{c!.version} · {shortHex(c!.charter_digest, 8, 6)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-dim">{loading ? "Reading chain…" : "No charter has been published."}</p>}
        </Panel>

        <Panel eyebrow="Deployment" title="Contracts">
          <dl className="space-y-2 text-sm">
            {(Object.keys(CONTRACT_LABELS) as ContractName[]).map((k) => (
              <div key={k} className="flex items-center justify-between gap-3"><dt className="eyebrow">{CONTRACT_LABELS[k]}</dt><dd><Hex value={ADDRESSES[k]} /></dd></div>
            ))}
          </dl>
        </Panel>
      </div>
    </div>
  );
}
