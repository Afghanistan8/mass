# Validation report

Only results that were actually observed are listed. Live results reference Studionet transaction hashes recorded in `docs/adversarial-run.*.json` and `docs/live-runs/`.

## Deployment (Studionet 61999)

| Contract | Address |
|---|---|
| CharterRegistry | `0xf32Ee8ce88A85108E521CEE342E4F0820ca34240` |
| MassEngine | `0x4339f56a03963B8cAF9Ff6a1D83C3FC932e5d90c` |
| CapabilityGate | `0x962F5713E45E4595d6B23D1BA699D0d3bc3FE5Dc` |
| ProtectedTarget | `0x6b286EaD0BA56623f68094249fe09E7F1AC3534D` |
| EvidenceLedger | `0x3dEeE6210EF78733419390F6012e4E0b6F48aD88` |

Deployer / target governance: `0x4184bc5E5444F250767E8D33A49817A9B4FB0df3`. Four earlier stacks are listed under `supersededDeployments` in the manifest, each with the reason it was retired; do not use them. This stack answers steward review round 1 (bounded recovery, target-side deadline, validator fingerprint equality, full-read evidence); the previous stack's live run `MV5D9JSD` below remains the evidence trail for the pre-steward code.

- `npm run source:verify`: all five contracts' on-chain bytes are **exactly equal** to the repository files and to the manifest SHA-256.
- `npm run health:check`: RPC reachable; gate and ledger bound to the engine; engine bindings match; target gate matches; target governance equals the deployer.

## Local gates

| Gate | Result |
|---|---|
| `toolchain:check` | CLI 0.39.1 (repo-local), genlayer-js 1.1.8, Python 3.12.13, genvm-linter 0.11.0 |
| `contracts:check` | 5/5 compile, lint and validate (GenVM v0.2.16 runner `py-genlayer:1jb45aa8…`) |
| Unit (`tests/unit`) | 62 Python passed + 11 TypeScript passed |
| Direct Mode (`tests/direct`) | 108 passed (incl. 16 steward round-1 tests) |
| `typecheck`, `build` | clean |
| Playwright (`tests/e2e`) | 42 passed (incl. 6 steward round-1 UI tests) |

Mutation checks: disabling (one at a time) leader-side quote verification, validator-side quote verification, clause grounding, per-source state comparison, the forced tamper decision, the validators' tripwire shortcut, and the target's digest check each makes a specific test fail. For the steward changes: disabling the gate's `EXPIRED` guard makes `test_recovery_redispatch_after_the_authority_deadline_is_rejected` fail (the re-dispatch succeeds instead of reverting — re-verified while preparing the resubmission); source-level invariant tests pin the retry cap, the `valid_until` handoff, the target's deadline check order, the validator fingerprint comparison, and the no-excerpt rule.

## Live adversarial run `MV5D9JSD` — ALL EXPECTATIONS MET

Deployment above, evidence served from `raw.githubusercontent.com/Afghanistan8/mass/main/demo/evidence/` (pre-flight verified HTTP 200 and byte-identical content). Full record: `docs/adversarial-run.MV5D9JSD.json`.

| Phase | Observed |
|---|---|
| A — six unauthorized attempts (direct target pause, direct mint, engine re-bind, forged ledger write, chartering a target you don't govern, unknown charter) | all reverted |
| B — publish; activation before the delay rejected; activate | pass |
| C — duration over limit; un-chartered lane; foreign host; dot-segment path | all rejected at freeze |
| D — consensus `TRIGGER_CONFIRMED` (verbatim quote, HTTP 200) → FINALIZED → capability `CAP-INC-A-MV5D9JSD` bound to the frozen envelope → execute → target history shows that exact capability and digest, paused → protected action rejected while paused → reconcile `APPLIED` → replay rejected → finalized ledger commitment matches | pass |
| E-B — routine-maintenance evidence | `TRIGGER_NOT_CONFIRMED`, `ASSESSED_NO_AUTHORITY`, no capability |
| E-C — prompt-injection evidence | agreed consensus `SOURCE_TAMPERING_SUSPECTED`; source `injection_flagged: true`, state `NEUTRAL`; no capability |
| F — v2 published and activated; rollback to v1 rejected; new incident on superseded v1 rejected; frozen incident keeps the v1 digest | pass |

Earlier runs on superseded deployments (`MV5B3PVS`, `MV5CCPP0`) are kept in `docs/` as the evidence trail for the findings below.

## Live steward demonstration `steward-MV6KHJ3C` — ALL EXPECTATIONS MET

Deployment above (the steward round-1 stack), evidence served from `raw.githubusercontent.com/Afghanistan8/mass/main/demo/evidence/` as in `MV5D9JSD`. Full record: `docs/live-runs/steward-MV6KHJ3C.md` (39 of 39 checks) and `docs/live-runs/steward-MV6KHJ3C.json` (39 steps, 0 failures, 15 authoritative FINALIZED state readbacks). Reproduce: `node scripts/steward-demo.mjs` (≈ 30–45 min). Point-by-point answers are in `docs/STEWARD_RESPONSE.md`.

| Phase | Observed |
|---|---|
| QG — `QUARANTINE_LANE` behind an optional guardian | execute before approval reverted (`guardian approval required`); holder approving reverted (`only the guardian may approve`); throwaway guardian key approved; dispatch delivered; lane `bridge` quarantined 20 min (`is_lane_open(bridge) = false`, `swaps` open, global pause unchanged); protected action blocked in `bridge`, allowed in `swaps`; reconcile `APPLIED`; replay rejected |
| R — delayed cross-contract delivery vs the authority deadline | 5-min TTL capability dispatched 15 s before its deadline; delivery landed 22 s late and the target refused it (`capability authority window has expired`); nothing recorded (empty digest, no history); gate view `EXPIRED` while storage still `DISPATCHED`; two recovery re-dispatches after the deadline both rejected (`capability expired: renewed emergency authorization is required`); reconcile persisted `EXPIRED` |
| X — already-applied authority | replaying the applied quarantine after its deadline rejected (`capability already applied`); lane `until` not extended; still exactly one history entry |

Both live confirmations reached `MAJORITY_AGREE` under the strengthened validator rule (identical normalised fingerprints, full reads), so the validators independently produced identical content digests for the published advisory.

## Findings fixed because of live runs

1. **CLI argument decoding.** Through a shell the CLI drops empty arguments or sends `b''`; without a shell a bare `""` becomes the integer `0`. Contracts accept `""`, `b''`, `None` as absent and fail closed on anything else; scripts pass `null` and spawn without a shell.
2. **Nondet closures captured the contract instance** (runtime warning about reading storage in nondet mode). Helpers moved to module level; a unit test forbids `self.` inside the closures.
3. **A `MAJORITY_DISAGREE` transaction was treated as success** by the script because the leader finished. Success now requires an agreed consensus result.
4. **Ambiguous demo evidence** (imperative wording) produced `MAJORITY_DISAGREE`, which is correct fail-closed behaviour; evidence rewritten as factual text.
5. **A test URL exceeded the engine's 500-character limit.** Boundary pinned by tests; the script refuses over-long URLs before sending.
6. **httpbin.org outage** (HTTP 503 to validators). Evidence moved to the repository on raw.githubusercontent.com with a pre-flight check.
7. **Tripwire outcome depended on the model.** The engine forced `SOURCE_TAMPERING_SUSPECTED` only when the model said `TRIGGER_CONFIRMED`; validators running different models (Claude Sonnet 4.6, GPT-5.4, Gemini, Kimi, MiniMax) chose different labels for the same injected page, giving `MAJORITY_DISAGREE` (run `MV5CCPP0`). Any tripwire hit now forces the decision and source state in code, and a validator accepts that outcome only when its own fetch also tripped. Verified live in `MV5D9JSD`.

## Not verified

- The hosted frontend: no deployment URL yet (Vercel Git integration was in a partial outage when import was attempted). `npm run health:check` checks it once `MASS_HEALTH_BASE_URL` is set.
- External audit: none.
