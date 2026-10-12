# Review target

**Submission:** Mass, a GenLayer-native emergency-authority system, Smart Contract / dApp category.
**Network:** Studionet 61999. **Addresses and source hashes:** [deployment-manifest.public.json](deployment-manifest.public.json).

## What a reviewer should try to break

1. Obtain a pause on `ProtectedTarget` without a FINALIZED `TRIGGER_CONFIRMED` assessment.
2. Make the gate issue or execute a capability that differs from the frozen action in any field.
3. Execute a capability twice, or after it expired, or as someone other than its holder.
4. Make validators agree on a confirmation that the evidence does not support (fabricated quote, injected instructions, unavailable source, ungrounded clause).
5. Publish or activate a charter for a target you do not govern; take over a protocol key; roll a charter back.
6. Make the UI show success for something that is only accepted, pending or rejected.

Every item has a Direct Mode negative test, and the first three, the fifth and part of the fourth also have a live Studionet step in `scripts/adversarial-run.mjs`.

## Fast path for a steward

```bash
npm run toolchain:check && npm run contracts:check && npm test      # pins, lint+validate, 41 unit + 91 Direct Mode
npm run source:verify && npm run health:check                        # live: bytes on chain == this repo; wiring
node scripts/adversarial-run.mjs --phase=A                           # live negatives, ~5 minutes
```

Then read [SECURITY.md](SECURITY.md) (invariant → enforcement → test table) and [REVIEW_EVIDENCE.md](REVIEW_EVIDENCE.md).

## Why Mass is stronger than EXIGENT

EXIGENT ([Bibidee/exigency](https://github.com/Bibidee/exigency)) is the baseline: four contracts, one action class, and a sound finality-gated capability model. The comparison below states what was actually read in its repository at the time of writing; it does not predict how either project is scored.

| Dimension | EXIGENT | Mass |
|---|---|---|
| **Contract separation** | 4 contracts: registry, engine, gate, vault | 5: adds `EvidenceLedger` (finality-gated, append-only provenance) so audit evidence is not stored by the contract that produces it |
| **Equivalence strength** | Validator re-runs the assessment; compares decision and per-source state; then one LLM equivalence call | Same, plus: per-source HTTP-class equality; deterministic grounding of trigger clauses in the frozen policy; **every quote the leader relied on must appear verbatim in the validator's own fetch**; a deterministic prompt-injection tripwire; code-enforced downgrades (support+contradiction ⇒ conflicting; any tripwire ⇒ tampering) |
| **Failure-mode clarity** | 5 outcomes | 7 outcomes, adding `EVIDENCE_STALE` and `SOURCE_TAMPERING_SUSPECTED`; each has a distinct UI explanation and a rule that it grants nothing |
| **Governance hardening** | Charter owner must equal target governance at assessment, and again at application | Checked at publish, activate, open, assess, issue, and apply (registry, engine ×2, gate, target). The target also recomputes the digest against its own address |
| **Authority surface** | One action (`PAUSE_PROTECTED_ACTION`) | Strict action-class registry: pause, and per-lane quarantine with chartered lanes; scope is part of the digest |
| **Role separation** | Holder only | Optional guardian co-signature, required before execution, must differ from the owner |
| **Evidence provenance** | Digests inside the incident record | Normalised and raw digests per source plus an aggregate commitment, queryable and verifiable on a finalized ledger; the UI has a commitment verifier |
| **Charter migration** | Frozen digest check | Same, plus explicit tests that rotation leaves open incidents bound to the original digest and superseded charters cannot open new ones |
| **UX of finality** | Status labels | Four-step authority rail; finalized vs pending reads shown side by side; writes complete only on `FINALIZED`; capability digest recomputed in the browser with a loud mismatch state |
| **Tests (counted in each repo)** | 14 unit, 29 Direct Mode, 7 Playwright, 3 integration | 41 unit, 91 Direct Mode, 22 Playwright, plus a live adversarial script |
| **Test quality** | — | Key checks were mutation-tested: disabling them makes a test fail (two tests that initially passed for the wrong reason were found and fixed) |
| **Live-run findings** | — | The live run exposed a CLI-vs-browser argument-decoding gap (`b''`) that Direct Mode could not; fixed, regression-tested and redeployed |

What Mass does **not** claim: that it is audited, that its LLM judgement is infallible, or that the numeric score will be higher. Those are for the reviewer.
