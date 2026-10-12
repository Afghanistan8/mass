# Validation report

Only results that were actually observed are listed. Live results reference Studionet transaction hashes recorded in `docs/adversarial-run.*.json` and `docs/live-runs/`.

## Deployment (Studionet 61999)

| Contract | Address |
|---|---|
| CharterRegistry | `0xfC8EaFe8a95Fa24a8b96531322db2D0B960c4386` |
| MassEngine | `0xfa40EE2856151d8193cf1e1bB93EB2cDA34A269b` |
| CapabilityGate | `0xF4Abb78B911505F762eB4C331577032CF0ae6C54` |
| ProtectedTarget | `0x19d36019F8906d5F9c3de6E7d44453AD5164D04E` |
| EvidenceLedger | `0xD3aaaA0e85c2E5E7bB52ff40400D8f85D9A2B63F` |

Deployer / target governance: `0x4184bc5E5444F250767E8D33A49817A9B4FB0df3`. Three earlier stacks are listed under `supersededDeployments` in the manifest, each with the reason it was retired; do not use them.

- `npm run source:verify`: all five contracts' on-chain bytes are **exactly equal** to the repository files and to the manifest SHA-256.
- `npm run health:check`: RPC reachable; gate and ledger bound to the engine; engine bindings match; target gate matches; target governance equals the deployer.

## Local gates

| Gate | Result |
|---|---|
| `toolchain:check` | CLI 0.39.1 (repo-local), genlayer-js 1.1.8, Python 3.12.13, genvm-linter 0.11.0 |
| `contracts:check` | 5/5 compile, lint and validate (GenVM v0.2.16 runner `py-genlayer:1jb45aa8…`) |
| Unit (`tests/unit`) | 41 passed |
| Direct Mode (`tests/direct`) | 91 passed |
| `typecheck`, `build` | clean |
| Playwright (`tests/e2e`) | 22 passed |

Mutation checks: disabling (one at a time) leader-side quote verification, validator-side quote verification, clause grounding, per-source state comparison, the forced tamper decision, the validators' tripwire shortcut, and the target's digest check each makes a specific test fail.

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
