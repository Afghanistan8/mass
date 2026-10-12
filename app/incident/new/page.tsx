"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ACTION_CLASSES, ADDRESSES } from "@/lib/config";
import { getCharter } from "@/lib/contracts";
import { ACTION_COPY, validateEvidenceUrl } from "@/lib/policy";
import { Field, Notice, PageIntro, Panel } from "@/components/ui";
import { TxStatus, useTx } from "@/components/tx";

const slug = (v: string) => /^[A-Za-z0-9._:-]{4,96}$/.test(v);

export default function NewIncident() {
  const [f, setF] = useState({ incidentKey: "", charterKey: "", action: ACTION_CLASSES[0] as string, scope: "*", minutes: 30, reason: "", urls: "" });
  const [submitted, setSubmitted] = useState(false);
  const [charterNote, setCharterNote] = useState("");
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const tx = useTx();

  useEffect(() => {
    const preset = new URLSearchParams(window.location.search).get("charter");
    if (preset) setF((s) => ({ ...s, charterKey: preset }));
  }, []);

  useEffect(() => {
    let alive = true;
    setCharterNote("");
    if (!slug(f.charterKey)) return;
    getCharter(f.charterKey).then((c) => {
      if (!alive) return;
      if (!c) setCharterNote("This charter key is not published.");
      else setCharterNote(`Limits: ≤ ${c.max_duration_minutes} min · actions ${c.allowed_actions.join(", ")}${c.allowed_lanes.length ? ` · lanes ${c.allowed_lanes.join(", ")}` : ""}`);
    }).catch(() => alive && setCharterNote(""));
    return () => { alive = false; };
  }, [f.charterKey]);

  const urlList = useMemo(() => f.urls.split("\n").map((u) => u.trim()).filter(Boolean), [f.urls]);
  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!slug(f.incidentKey)) e.incidentKey = "4–96 chars: letters, digits . _ : -";
    if (!slug(f.charterKey)) e.charterKey = "Enter the active charter key.";
    if (f.action === "PAUSE_PROTECTED_ACTION" && f.scope !== "*") e.scope = "A pause always has scope *.";
    if (f.action === "QUARANTINE_LANE" && !/^[a-z0-9][a-z0-9_-]{1,31}$/.test(f.scope)) e.scope = "Lane id: 2–32 chars, a-z 0-9 _ -";
    if (f.minutes < 1) e.minutes = "At least 1 minute.";
    if (f.reason.trim().length < 30) e.reason = `At least 30 characters (${f.reason.trim().length}).`;
    if (urlList.length < 1 || urlList.length > 4) e.urls = "Provide 1–4 evidence URLs, one per line.";
    else {
      const bad = urlList.map((u) => ({ u, m: validateEvidenceUrl(u) })).find((x) => x.m);
      if (bad) e.urls = `${bad.u} — ${bad.m}`;
      else if (new Set(urlList).size !== urlList.length) e.urls = "Duplicate evidence URL.";
    }
    return e;
  }, [f, urlList]);
  const invalid = Object.keys(errors).length > 0;
  const show = (k: string) => (submitted ? errors[k] : undefined);

  const submit = () => {
    setSubmitted(true);
    if (invalid) return;
    void tx.run(ADDRESSES.massEngine, "open_incident", [
      f.incidentKey.trim(), f.charterKey.trim(), f.action, f.scope.trim(), Number(f.minutes), f.reason.trim(), JSON.stringify(urlList),
    ]);
  };

  return (
    <div className="space-y-6">
      <PageIntro eyebrow="Incident · freeze" title="Freeze the exact request.">
        Freezing binds the action, scope, duration and evidence URLs to the charter digest. Your reason is recorded as an <em>assertion</em>: validators are told it is not evidence.
      </PageIntro>
      <form className="grid gap-5 lg:grid-cols-2" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }} aria-label="Freeze incident">
        <Panel eyebrow="Binding" title="Charter & request">
          <div className="space-y-4">
            <Field label="Incident key" error={show("incidentKey")}><input className="field" aria-invalid={!!show("incidentKey")} value={f.incidentKey} onChange={(e) => set("incidentKey", e.target.value)} name="incidentKey" /></Field>
            <Field label="Active charter key" hint={charterNote} error={show("charterKey")}><input className="field" aria-invalid={!!show("charterKey")} value={f.charterKey} onChange={(e) => set("charterKey", e.target.value)} name="charterKey" /></Field>
            <Field label="Action class" hint={ACTION_COPY[f.action]}>
              <select className="field" value={f.action} onChange={(e) => { set("action", e.target.value); set("scope", e.target.value === "PAUSE_PROTECTED_ACTION" ? "*" : ""); }} name="action">
                {ACTION_CLASSES.map((a) => <option key={a}>{a}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Scope" error={show("scope")}><input className="field" aria-invalid={!!show("scope")} value={f.scope} onChange={(e) => set("scope", e.target.value)} name="scope" /></Field>
              <Field label="Duration (min)" error={show("minutes")}><input className="field" type="number" value={f.minutes} onChange={(e) => set("minutes", Number(e.target.value))} name="minutes" /></Field>
            </div>
          </div>
        </Panel>
        <Panel eyebrow="Evidence" title="Pre-approved sources only">
          <div className="space-y-4">
            <Field label="Evidence URLs" hint="One per line, up to 4. Must sit inside the charter’s approved host/path scope. https only; no query, fragment, port, userinfo, percent-encoding or dot segments." error={show("urls")}>
              <textarea className="field" aria-invalid={!!show("urls")} value={f.urls} onChange={(e) => set("urls", e.target.value)} name="urls" />
            </Field>
            <Field label="Operator assertion (not evidence)" error={show("reason")}>
              <textarea className="field" aria-invalid={!!show("reason")} value={f.reason} onChange={(e) => set("reason", e.target.value)} name="reason" />
            </Field>
          </div>
        </Panel>
        <div className="space-y-4 lg:col-span-2">
          {submitted && invalid && <Notice tone="rejected" title="Fix the highlighted fields before freezing" />}
          {tx.blocked && <Notice tone="pending" title={tx.blocked} />}
          <button type="submit" className="btn" disabled={tx.busy || !!tx.blocked} data-testid="freeze-incident">Freeze incident</button>
          <TxStatus state={tx.state} />
          {tx.state.phase === "finalized" && <Link className="btn btn-quiet" href={`/incident/${f.incidentKey.trim()}`}>Open incident →</Link>}
        </div>
      </form>
    </div>
  );
}
