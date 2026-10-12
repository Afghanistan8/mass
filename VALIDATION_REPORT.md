# Validation report

Only results that were actually observed are listed. Live results reference Studionet transaction hashes recorded in `docs/adversarial-run.*.json` and `docs/live-runs/`.

## Deployment (Studionet 61999)

| Contract | Address |
|---|---|
| CharterRegistry | `0x970CCfF9BA4749EB93508F802afc3c08D03e7AAe` |
| MassEngine | `0xecD45151074a14623d4a8eDC19fE592915b36886` |
| CapabilityGate | `0x19132D44C47cE39DE86faBD8dAb9cC72c75eE220` |
| ProtectedTarget | `0xb9a64476961378485c4ba429f10Ce7990cdb313f` |
| EvidenceLedger | `0x74B57d0A4E353ff1Cc337AAf2FfBFF3D47F6FA88` |

Deployer / target governance: `0x4184bc5E5444F250767E8D33A49817A9B4FB0df3`. Two earlier stacks are listed under `supersededDeployments` in the manifest with the reason for each; do not use them.

- `npm run source:verify`: all five contracts' on-chain bytes are **exactly equal** to the repository files and to the manifest SHA-256.
- `npm run health:check`: RPC reachable; gate and ledger bound to the engine; engine bindings match; target gate matches; target governance equals the deployer.

## Local gates

| Gate | Result |
|---|---|
| `toolchain:check` | CLI 0.39.1 (repo-local), genlayer-js 1.1.8, Python 3.12.13, genvm-linter 0.11.0 |
| `contracts:check` | 5/5 compile, lint and validate (GenVM v0.2.16 runner `py-genlayer:1jb45aa8…`) |
| Unit (`tests/unit`) | 41 passed |
| Direct Mode (`tests/direct`) | 86 passed |
| `typecheck`, `build` | clean |
| Playwright (`tests/e2e`) | 22 passed |

Mutation checks: disabling (one at a time) leader-side quote verification, validator-side quote verification, clause grounding, per-source state comparison, the injection downgrade, and the target's digest check each makes a specific test fail.

## Live adversarial run `MV5B3PVS` (evidence via httpbin.org)

| Phase | Observed |
|---|---|
| A — six unauthorized attempts | all reverted (A5 reverts with a VM error instead of Mass's message; still fail-closed, see SECURITY.md) |
| B — publish, early activation rejected, activate | pass |
| C — duration, lane, foreign host, dot segment | all rejected at freeze |
| D — confirm → finality → capability → execute → pause → replay rejected → ledger | pass. Consensus `TRIGGER_CONFIRMED` with a verbatim quote; capability `CAP-INC-A-MV5B3PVS` applied by the target at 13:57:00Z (digest `cb29725bb741…` in the target's own history); replay reverted "capability already applied" |
| E-B — routine-maintenance evidence | `TRIGGER_NOT_CONFIRMED`, no capability |
| E-C — prompt-injection evidence | no capability on both attempts (`INSUFFICIENT_EVIDENCE`). **Tripwire not exercised**: httpbin.org answered HTTP 503 to the validators both times, so the hostile text never reached them |
| F — v2 activated, rollback rejected, superseded charter blocked, frozen incident keeps v1 digest | pass |

The run was interrupted once (process terminated externally right after submitting E-C1) and completed with `--resume`, which verifies existing on-chain state instead of re-submitting.

**Pending:** a run with evidence served from `raw.githubusercontent.com` to exercise the injection tripwire live. Until it is recorded here, the tripwire is proven by Direct Mode only.

## Findings fixed because of live runs

1. CLI argument decoding (`b''`, dropped args, `""`→`0`): contracts accept `""`, `b''`, `None` as absent; scripts pass `null` and spawn without a shell.
2. Nondet closures captured the contract instance (runtime warning about reading storage in nondet mode): helpers moved to module level; a unit test forbids `self.` inside the closures.
3. A leader result with `MAJORITY_DISAGREE` was initially treated as success by the script: success now requires an agreed consensus result.
4. Ambiguous demo evidence (imperative wording) led to `MAJORITY_DISAGREE` — correct fail-closed behaviour; evidence rewritten as factual text.
5. A test URL exceeded the engine's 500-character limit: boundary pinned by tests; the script refuses over-long evidence URLs before sending.
