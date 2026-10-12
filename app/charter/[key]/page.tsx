"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ADDRESSES } from "@/lib/config";
import { getActiveCharterKey, getCharter } from "@/lib/contracts";
import { countdown, formatTime } from "@/lib/policy";
import { Hex, Kv, Notice, PageIntro, Panel, Pill, useNow, usePoll } from "@/components/ui";
import { TxStatus, useTx } from "@/components/tx";
import { useWallet } from "@/components/WalletProvider";

export default function CharterPage() {
  const { key } = useParams<{ key: string }>();
  const now = useNow();
  const { address } = useWallet();
  const { data, error, loading, reload } = usePoll(async () => {
    const charter = await getCharter(key);
    const active = charter ? await getActiveCharterKey(charter.protocol_key) : "";
    return { charter, active };
  }, [key], 20000);
  const tx = useTx(reload);

  if (loading && !data) return <p className="mono text-dim">Reading charter…</p>;
  if (error) return <Notice tone="rejected" title="Read failed">{error}</Notice>;
  const charter = data?.charter;
  if (!charter) return <Notice tone="rejected" title="Charter not found">{key} is not published in this registry.</Notice>;

  const isActive = data!.active === charter.charter_key;
  const eligible = now / 1000 >= charter.eligible_at;
  const isOwner = !!address && address.toLowerCase() === charter.owner.toLowerCase();
  const superseded = !!data!.active && data!.active !== charter.charter_key;

  return (
    <div className="space-y-6">
      <PageIntro eyebrow={`Charter · v${charter.version}`} title={charter.protocol_name}>
        <span className="mono text-sm">{charter.charter_key}</span>
      </PageIntro>

      <div className="flex flex-wrap gap-2">
        {isActive ? <Pill tone="verified">Active</Pill> : eligible ? <Pill tone="pending">Eligible · not active</Pill> : <Pill tone="pending" pulse>Activation delay · {countdown(charter.eligible_at, now)}</Pill>}
        {superseded && <Pill tone="neutral">Another version is active: {data!.active}</Pill>}
        <Pill tone="neutral">Immutable</Pill>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel eyebrow="Frozen commitment" title="Digest">
          <dl>
            <Kv k="Charter digest">{charter.charter_digest}</Kv>
            <Kv k="Owner"><Hex value={charter.owner} full /></Kv>
            <Kv k="Guardian">{charter.guardian ? <Hex value={charter.guardian} full /> : "none"}</Kv>
            <Kv k="Protected target"><Hex value={charter.protected_target} full /></Kv>
            <Kv k="Published">{formatTime(charter.published_at)}</Kv>
            <Kv k="Eligible">{formatTime(charter.eligible_at)}</Kv>
          </dl>
        </Panel>
        <Panel eyebrow="Hard limits" title="Authority envelope">
          <dl>
            <Kv k="Actions">{charter.allowed_actions.join(", ")}</Kv>
            <Kv k="Lanes">{charter.allowed_lanes.length ? charter.allowed_lanes.join(", ") : "—"}</Kv>
            <Kv k="Max duration">{charter.max_duration_minutes} min</Kv>
            <Kv k="Capability TTL">{charter.capability_ttl_minutes} min</Kv>
            <Kv k="Activation delay">{charter.activation_delay_minutes} min</Kv>
          </dl>
        </Panel>
        <Panel eyebrow="Natural language" title="Trigger policy"><p className="whitespace-pre-wrap text-sm leading-relaxed">{charter.trigger_policy}</p></Panel>
        <Panel eyebrow="Natural language" title="Evidence policy"><p className="whitespace-pre-wrap text-sm leading-relaxed">{charter.evidence_policy}</p></Panel>
        <Panel eyebrow="Approved sources" title="Evidence scopes" className="lg:col-span-2">
          <ul className="mono space-y-1 text-sm">
            {charter.evidence_scopes.map((s) => <li key={s.host + s.path_prefix}>https://{s.host}{s.path_prefix}…</li>)}
          </ul>
        </Panel>
      </div>

      {!isActive && (
        <Panel eyebrow="Activation" title="Activate this version">
          <p className="mb-4 text-sm text-dim">Only the owner can activate, only after the delay, and never to an older version. Governance over the target is re-proved on-chain at this step.</p>
          {!isOwner && address && <Notice tone="rejected" title="Connected wallet is not the charter owner" />}
          <button className="btn mt-3" disabled={!eligible || !isOwner || tx.busy || !!tx.blocked} onClick={() => void tx.run(ADDRESSES.charterRegistry, "activate_charter", [charter.charter_key])} data-testid="activate-charter">Activate charter</button>
          {tx.blocked && <p className="mt-2 text-xs text-dim">{tx.blocked}</p>}
          <div className="mt-3"><TxStatus state={tx.state} /></div>
        </Panel>
      )}
      {isActive && <Link className="btn" href={`/incident/new?charter=${charter.charter_key}`}>Freeze an incident →</Link>}
    </div>
  );
}
