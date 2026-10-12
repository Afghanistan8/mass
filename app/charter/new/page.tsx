"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ACTION_CLASSES, ADDRESSES } from "@/lib/config";
import { Field, Notice, PageIntro, Panel } from "@/components/ui";
import { TxStatus, useTx } from "@/components/tx";
import { useWallet } from "@/components/WalletProvider";

const SAMPLE_TRIGGER =
  "Emergency authority exists only when credible public evidence from the approved sources establishes an active exploit of, or critical dependency compromise affecting, the protected target that threatens asset safety. Routine maintenance, price movement and operator assertion alone never qualify.";
const SAMPLE_EVIDENCE =
  "Use only the approved public technical sources. Treat unavailable, stale, circular or materially contradictory evidence as insufficient rather than assuming an emergency exists.";

const slug = (v: string) => /^[A-Za-z0-9._:-]{4,96}$/.test(v);
const address = (v: string) => /^0x[0-9a-fA-F]{40}$/.test(v);

export default function NewCharter() {
  const { address: wallet } = useWallet();
  const [f, setF] = useState({
    charterKey: "", protocolKey: "", name: "", target: ADDRESSES.protectedTarget as string,
    trigger: SAMPLE_TRIGGER, evidence: SAMPLE_EVIDENCE, scopes: "", guardian: "", lanes: "",
    pause: true, quarantine: false, maxMinutes: 60, ttl: 30, delay: 1,
  });
  const [submitted, setSubmitted] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const tx = useTx();

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!slug(f.charterKey)) e.charterKey = "4–96 chars: letters, digits . _ : -";
    if (!slug(f.protocolKey)) e.protocolKey = "4–96 chars: letters, digits . _ : -";
    if (f.name.trim().length < 2) e.name = "Required.";
    if (!address(f.target)) e.target = "A 0x… contract address is required.";
    if (f.trigger.trim().length < 80) e.trigger = `At least 80 characters (${f.trigger.trim().length}).`;
    if (f.evidence.trim().length < 40) e.evidence = `At least 40 characters (${f.evidence.trim().length}).`;
    if (!f.scopes.trim()) e.scopes = "At least one evidence host.";
    if (f.guardian && !address(f.guardian)) e.guardian = "A 0x… address, or leave empty.";
    if (f.guardian && wallet && f.guardian.toLowerCase() === wallet.toLowerCase()) e.guardian = "The guardian must differ from the charter owner.";
    if (!f.pause && !f.quarantine) e.actions = "Select at least one action class.";
    if (f.quarantine && !f.lanes.trim()) e.lanes = "QUARANTINE_LANE needs at least one lane id.";
    if (f.maxMinutes < 5 || f.maxMinutes > 1440) e.maxMinutes = "5–1440.";
    if (f.ttl < 5 || f.ttl > 120) e.ttl = "5–120.";
    if (f.delay < 1 || f.delay > 10080) e.delay = "1–10080.";
    return e;
  }, [f, wallet]);

  const invalid = Object.keys(errors).length > 0;
  const show = (k: string) => (submitted ? errors[k] : undefined);

  const submit = () => {
    setSubmitted(true);
    if (invalid) return;
    const actions = [f.pause && ACTION_CLASSES[0], f.quarantine && ACTION_CLASSES[1]].filter(Boolean).join(",");
    void tx.run(ADDRESSES.charterRegistry, "publish_charter", [
      f.charterKey.trim(), f.protocolKey.trim(), f.name.trim(), f.target.trim(), f.trigger.trim(), f.evidence.trim(),
      f.scopes.trim(), actions, f.lanes.trim(), f.guardian.trim(), Number(f.maxMinutes), Number(f.ttl), Number(f.delay),
    ]);
  };

  return (
    <div className="space-y-6">
      <PageIntro eyebrow="Charter · publish" title="Commit the rules before the emergency.">
        A charter is immutable. Its digest binds every incident, assessment and capability that follows. The registry proves on-chain that you are the protected target’s governance wallet before it accepts this.
      </PageIntro>
      <Notice tone="pending" title="What publishing does not do">It grants no authority. A charter becomes usable only after its activation delay, and only its owner can activate it.</Notice>

      <form className="grid gap-5 lg:grid-cols-2" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }} aria-label="Publish charter">
        <Panel eyebrow="Identity" title="Protocol & target">
          <div className="space-y-4">
            <Field label="Charter key" hint="Unique, permanent." error={show("charterKey")}><input className="field" aria-invalid={!!show("charterKey")} value={f.charterKey} onChange={(e) => set("charterKey", e.target.value)} name="charterKey" /></Field>
            <Field label="Protocol key" hint="First publisher claims it; only that wallet can add versions." error={show("protocolKey")}><input className="field" aria-invalid={!!show("protocolKey")} value={f.protocolKey} onChange={(e) => set("protocolKey", e.target.value)} name="protocolKey" /></Field>
            <Field label="Protocol name" error={show("name")}><input className="field" value={f.name} onChange={(e) => set("name", e.target.value)} name="name" /></Field>
            <Field label="Protected target address" hint="Its deployer wallet must be the connected wallet." error={show("target")}><input className="field" value={f.target} onChange={(e) => set("target", e.target.value)} name="target" /></Field>
            <Field label="Guardian co-signer (optional)" hint="A different wallet that must approve before execution." error={show("guardian")}><input className="field" value={f.guardian} onChange={(e) => set("guardian", e.target.value)} name="guardian" /></Field>
          </div>
        </Panel>

        <Panel eyebrow="Policy" title="Natural-language triggers">
          <div className="space-y-4">
            <Field label="Trigger policy" error={show("trigger")}><textarea className="field" style={{ minHeight: "10rem" }} aria-invalid={!!show("trigger")} value={f.trigger} onChange={(e) => set("trigger", e.target.value)} name="trigger" /></Field>
            <Field label="Evidence-quality policy" error={show("evidence")}><textarea className="field" aria-invalid={!!show("evidence")} value={f.evidence} onChange={(e) => set("evidence", e.target.value)} name="evidence" /></Field>
          </div>
        </Panel>

        <Panel eyebrow="Evidence" title="Approved sources">
          <Field label="Hosts, optionally with a path prefix" hint="Comma-separated: host or host|/path/prefix. Exact host match only — no subdomain wildcards." error={show("scopes")}>
            <input className="field" aria-invalid={!!show("scopes")} placeholder="raw.githubusercontent.com|/your-org/status/" value={f.scopes} onChange={(e) => set("scopes", e.target.value)} name="scopes" />
          </Field>
        </Panel>

        <Panel eyebrow="Authority" title="Allowed actions & hard limits">
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="eyebrow">Action classes</legend>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.pause} onChange={(e) => set("pause", e.target.checked)} /> <span className="mono">PAUSE_PROTECTED_ACTION</span></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.quarantine} onChange={(e) => set("quarantine", e.target.checked)} /> <span className="mono">QUARANTINE_LANE</span></label>
              {show("actions") && <span role="alert" className="text-xs text-rejected">{errors.actions}</span>}
            </fieldset>
            <Field label="Chartered lanes" hint="Comma-separated lane ids, e.g. swaps,bridge" error={show("lanes")}><input className="field" value={f.lanes} onChange={(e) => set("lanes", e.target.value)} name="lanes" /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Max minutes" error={show("maxMinutes")}><input className="field" type="number" value={f.maxMinutes} onChange={(e) => set("maxMinutes", Number(e.target.value))} /></Field>
              <Field label="Cap TTL min" error={show("ttl")}><input className="field" type="number" value={f.ttl} onChange={(e) => set("ttl", Number(e.target.value))} /></Field>
              <Field label="Delay min" error={show("delay")}><input className="field" type="number" value={f.delay} onChange={(e) => set("delay", Number(e.target.value))} /></Field>
            </div>
          </div>
        </Panel>

        <div className="space-y-4 lg:col-span-2">
          {submitted && invalid && <Notice tone="rejected" title="Fix the highlighted fields before publishing" />}
          {tx.blocked && <Notice tone="pending" title={tx.blocked} />}
          <button type="submit" className="btn" disabled={tx.busy || !!tx.blocked} data-testid="publish-charter">Publish charter</button>
          <TxStatus state={tx.state} />
          {tx.state.phase === "finalized" && <Link className="btn btn-quiet" href={`/charter/${f.charterKey.trim()}`}>Open charter →</Link>}
        </div>
      </form>
    </div>
  );
}
