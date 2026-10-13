# Architecture

## Authority flow

```
publish_charter ──delay──▶ activate_charter            CharterRegistry   (owner = target governance wallet)
        │
open_incident ─ freezes action, scope, duration, evidence URLs, charter digest      MassEngine
        │
assess_incident ─ leader_fn / validator_fn over live web evidence                  MassEngine (nondeterministic)
        │  emit(on="finalized")                      emit(on="finalized")
        ├────────────▶ EvidenceLedger.record_assessment   (always, any decision)
        └────────────▶ CapabilityGate.issue_capability    (only TRIGGER_CONFIRMED + governance ok)
                              │
execute_capability ─ holder (+ guardian) ─ digest recomputed       CapabilityGate
        │  emit(on="finalized")
        ▼
ProtectedTarget.emergency_pause / emergency_quarantine_lane   (sender must be the gate; digest recomputed again)
```

Every arrow that confers authority is `emit(on="finalized")`. There is no `on="accepted"` anywhere (a unit test enforces this).

## Contracts and their dependencies

- **CharterRegistry** reads `ProtectedTarget.get_governance_address`.
- **MassEngine** reads the registry and the target; emits to gate and ledger. Constructor: `(registry, gate, ledger)`.
- **CapabilityGate** reads the target; emits to the target. `bind_engine` is one-time, deployer-only.
- **EvidenceLedger** accepts writes only from the bound engine; `bind_engine` is one-time.
- **ProtectedTarget** knows only its gate (constructor) and records its deployer as governance. It reads nothing.

Deployment order: ledger, gate, registry, engine, bind engine on gate and ledger, target.

## The digest

```
action_digest = sha256(canonical_json({incident_key, charter_digest, target, action_class, scope, duration_minutes}))
```

`canonical_json` is `json.dumps(sort_keys=True, separators=(",", ":"))`. It is computed by the engine at freeze, recomputed by the gate at issuance and at every execution, recomputed by the target against `gl.message.contract_address`, and recomputed in the browser on the capability page. A capability minted for another target, scope or duration is inert.

## Assessment pipeline (MassEngine)

1. **Fetch.** Each frozen URL is fetched with bounded size (64 KiB per source, 256 KiB total). HTML is reduced to text; a normalised content digest and a raw digest are computed in code. A deterministic prompt-injection tripwire scans each source's **full** text. A source is either shown to the model **in full** (extracted text ≤ 10,000 characters, `complete: true`) or marked `complete: false`; nothing is silently excerpted.
2. **Prompt.** Charter, incident and evidence are JSON-encoded data documents. The operator's reason is labelled `operator_assertion_not_evidence`. The prompt states that text addressing the assessor is an attack, not an instruction.
3. **Enforce in code**, after the model answers, regardless of what it said:
   - A source supports the trigger only with HTTP 2xx, non-empty content, no tripwire, **and a verbatim quote of at least 12 characters found in that source**.
   - `TRIGGER_CONFIRMED` additionally needs ≥1 supporting source, ≥1 charter clause that overlaps the frozen policy text, and ≥1 material finding.
   - Any tripwire hit sets the decision to `SOURCE_TAMPERING_SUSPECTED` and the tripped source to `NEUTRAL`, **whatever the model answered**, so validators running different models compute the same outcome. For a confirmation, support plus contradiction becomes `CONFLICTING_EVIDENCE`; otherwise missing support, clauses or findings becomes `INSUFFICIENT_EVIDENCE`.
   - A source the model could not read in full can never support the trigger, and any reachable incomplete source turns a confirmation into `INSUFFICIENT_EVIDENCE`: text the model did not see can never hide a qualification behind an authority-granting decision.
   - HTTP status and digests are code-derived; the model cannot supply them.
4. **Validator.** Each validator re-runs the full pipeline itself and returns `True` only if: decisions are equal; every per-source state is equal; every per-source 2xx/non-2xx class is equal; for a confirmation the clauses are grounded and **every quote the leader relied on exists in the validator's own fetch**; and a second LLM comparison of clauses and material findings says `equivalent: true`. One exception skips that last comparison: when the validator's *own* fetch tripped the tripwire, its own code forced `SOURCE_TAMPERING_SUSPECTED`, and the leader matches on decision and every source. That outcome grants nothing, so free-text differences cannot matter (found live: run `MV5CCPP0` ended `MAJORITY_DISAGREE` before this rule).

Decisions: `TRIGGER_CONFIRMED`, `TRIGGER_NOT_CONFIRMED`, `INSUFFICIENT_EVIDENCE`, `ACTION_DISPROPORTIONATE`, `CONFLICTING_EVIDENCE`, `EVIDENCE_STALE`, `SOURCE_TAMPERING_SUSPECTED`. Only the first can lead to a capability.

### Source equivalence (what validators must agree on)

| Field (per source) | Authority-granting decision (`TRIGGER_CONFIRMED`) | Any other decision |
|---|---|---|
| Decision | identical | identical |
| Source state (supports / contradicts / neutral / unavailable) | identical | identical |
| HTTP class (2xx vs not) | identical | identical |
| **Normalised content fingerprint** — sha256 of the tag-stripped, whitespace-collapsed, lower-cased text, computed by each validator from its own fetch | **identical for every reachable source** | recorded, not required |
| Read in full (`complete`) | **true for every reachable source, on both sides** | recorded |
| Every quote the leader relied on | must occur in the validator's own fetch | — |
| Trigger clauses / material findings | grounded in the frozen policy, then a second LLM comparison | second LLM comparison |
| Raw-bytes fingerprint (sha256 of the body) | recorded in the ledger as provenance; **not** required, because markup-only changes (attributes, comments, CDN cache tags) do not change meaning | recorded |

So a materially different version of the evidence — a withdrawn advisory, an added correction, an edited sentence — cannot support the same authority: some validator's normalised fingerprint differs and it votes against. Non-granting decisions do not require fingerprint equality because they create no authority (a disagreement there simply fails to finalize, which is also fail-closed). Consequence: evidence pages for authority must be stable documents; a page whose visible text changes on every request can never confirm a trigger.

## Incident lifecycle

`OPEN` → `AUTHORITY_PENDING_FINALITY` (confirmed; capability follows finality) | `ASSESSMENT_RETRYABLE` (insufficient / conflicting / stale, up to 3 attempts) | `ASSESSED_NO_AUTHORITY`. An incident expires 24 hours after freezing.

## Charter migration

Charters are immutable and versioned per protocol key. Activating v2 does not touch open incidents: they carry the charter digest frozen at open time and the engine rejects assessment if the registry no longer resolves that key to the same digest. New incidents require the active charter. Rollback to an older version is rejected.

## Capability lifecycle

`ISSUED` → (guardian approves, if chartered) → `DISPATCHED` (execute emitted on finalized) → `APPLIED` (the target holds the digest) — or `EXPIRED`.

**One hard authority deadline.** `expires_at` (issuance + the charter's TTL, 5–120 min) bounds *everything*: guardian approval, the first dispatch, every recovery re-dispatch, **and the target's application**. The gate sends `valid_until = expires_at` with each dispatch and the target refuses to apply after it, so a delivery that arrives late — however it was delayed — has no effect. The target also refuses any deadline more than 7,200 s (the gate's longest TTL) in the future.

**Bounded recovery.** Delivery is asynchronous, so a dispatch can fail to apply. The holder may re-send the *exact same* action (envelope and digest re-verified) only while: the deadline has not passed, the target has not applied it, and fewer than 3 dispatches have been made. The target is idempotent per capability key: replaying an applied capability, even after its deadline, is a no-op that neither extends nor re-records anything.

**After the deadline** an unapplied capability is `EXPIRED`. The gate's view reports it immediately; `reconcile_capability` persists it. Execution then reverts with "capability expired: renewed emergency authorization is required": new authority needs a new incident and a new FINALIZED assessment. A capability that the target applied inside its window is reported `APPLIED` forever.

## Frontend

Next.js App Router, TypeScript, Tailwind. It talks only to the contracts via genlayer-js 1.1.8 and an injected EIP-1193 wallet.

**Read path.** Every read goes through `lib/rpc-gate.ts`: results are cached (45 s final, 15 s pending, mirrored to `sessionStorage`), identical in-flight reads are shared, requests spend from a budget of 22 per minute shared across tabs (`localStorage`), and rate-limit-like failures trigger a cooldown instead of an immediate retry (a retry is another counted request). Studionet's 429s carry no CORS headers, so browsers see them as "Failed to fetch"; the UI explains pacing in a banner rather than showing a raw error. Terminal pages (settled incident, applied capability, superseded charter) stop polling, and a failed refresh keeps the last good data on screen.

**Finality in the UI.** Reads default to the latest *finalized* state; the incident page also reads non-final state while something is settling to show "assessed but not final". Incident status is derived from the capability once it exists (the engine cannot observe the gate finalizing, so it stores `AUTHORITY_PENDING_FINALITY` for good). Writes are reported complete only on `FINALIZED`, and the read cache is cleared then.

**Forms.** Server-rendered controlled inputs accept typing before hydration, but React state never hears about it. Each form adopts the DOM's values on mount (`adoptPrehydrationValues`) before applying deep-link presets.

A test seam (`window.__MASS_E2E_MOCK__`) exists only when `NODE_ENV !== "production"`.
