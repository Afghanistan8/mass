import Link from "next/link";
import { Panel } from "@/components/ui";

const PIPELINE = [
  ["01", "Charter", "The protocol commits an immutable natural-language trigger policy, approved evidence hosts, allowed actions and hard limits. Activation is delayed. Versions only move forward."],
  ["02", "Freeze", "An incident freezes the exact action, scope, duration and evidence URLs against the charter digest. The operator’s story is data, never evidence."],
  ["03", "Consensus", "GenLayer validators each fetch only the pre-approved sources, interpret them against the frozen policy, and must independently verify every quoted passage."],
  ["04", "Finality", "Only an assessment that reaches FINALIZED can emit a capability: holder-bound, target-bound, digest-bound, single-use, expiring."],
] as const;

const INVARIANTS = [
  ["No capability before FINALIZED", "Every privileged message is emitted on=\"finalized\"."],
  ["No admin pause on the target", "The target exposes no owner, admin or governance pause. Not even its deployer can bypass the gate."],
  ["Uncertainty fails closed", "Unavailable, conflicting, stale, unquoted or injected evidence yields no authority."],
  ["Digest-bound everywhere", "Gate and target each recompute the action digest. A capability for another target or duration is inert."],
  ["Governance proven five times", "Publish, activate, open, issue and apply each re-check the target’s governance wallet."],
  ["Non-custodial by construction", "No payable method, no payout, no user value. Nothing can be stranded."],
] as const;

export default function Landing() {
  return (
    <div className="space-y-16">
      <section className="max-w-4xl">
        <p className="eyebrow">Emergency control room · GenLayer Studionet</p>
        <h1 className="display mt-4 text-5xl leading-[1.02] sm:text-7xl">
          Emergency power<br />that cannot <em className="not-italic text-verified">self-certify.</em>
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-dim">
          A protocol commits its emergency charter in advance. When an incident is declared, independent GenLayer validators read only the approved evidence and decide against the frozen policy. Authority exists only after that decision is final, and then only as one exact, single-use, expiring capability.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/command" className="btn">Open command</Link>
          <Link href="/charter/new" className="btn btn-quiet">Publish a charter</Link>
          <Link href="/audit" className="btn btn-quiet">Inspect the evidence trail</Link>
        </div>
        <p className="mono mt-10 text-sm text-dim">Mass of evidence. Mass of consensus. Zero self-certification.</p>
      </section>

      <section aria-labelledby="pipeline">
        <p className="eyebrow" id="pipeline">The only path to authority</p>
        <ol className="mt-4 grid gap-px border border-line bg-line md:grid-cols-4">
          {PIPELINE.map(([n, title, body]) => (
            <li key={n} className="bg-panel p-5">
              <p className="mono text-xs text-verified">{n}</p>
              <h3 className="display mt-2 text-2xl">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-dim">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <Panel eyebrow="Why GenLayer is the trust model" title="Remove it and the system collapses">
          <p className="leading-relaxed text-dim">
            Smart contracts cannot read an incident report, weigh a security advisory, or notice that a source is trying to manipulate its reader. A multisig can, but then a person certifies their own emergency. Mass replaces that person with validator consensus over live web evidence. Without GenLayer there is nobody left who is allowed to say “this is an emergency”.
          </p>
        </Panel>
        <Panel eyebrow="What a validator actually checks" title="Not a rubber stamp">
          <ul className="space-y-2 text-sm leading-relaxed text-dim">
            <li>• Re-fetches every approved source itself, and rejects on any HTTP-class disagreement.</li>
            <li>• Verifies each quoted passage byte-for-byte against its own fetch.</li>
            <li>• Rejects trigger clauses that are not grounded in the frozen charter text.</li>
            <li>• Runs a second substantive comparison of clauses and material findings.</li>
            <li>• Treats prompt-injection tripwires as proof the evidence set is compromised.</li>
          </ul>
        </Panel>
      </section>

      <section aria-labelledby="invariants">
        <p className="eyebrow" id="invariants">Invariants, each with a negative test</p>
        <div className="mt-4 grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {INVARIANTS.map(([title, body]) => (
            <div key={title} className="bg-panel p-5">
              <h3 className="mono text-sm text-verified">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-dim">{body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
