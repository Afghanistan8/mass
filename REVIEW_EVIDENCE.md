# Review evidence

Maps each quality criterion to the artefact that demonstrates it. The criteria are those in Mass's design brief (success criteria for a high-impact Intelligent Contract submission); where a criterion is a claim about behaviour, the test or live step that exercises it is named. Counts are current as of [VALIDATION_REPORT.md](VALIDATION_REPORT.md).

| Criterion | Evidence |
|---|---|
| **Removing GenLayer collapses the trust model** | The only path to authority is `MassEngine.assess_incident`, whose decision exists only through `gl.vm.run_nondet_unsafe` leader/validator consensus over `gl.nondet.web` + `gl.nondet.exec_prompt`. No other contract can produce a capability (`test_only_bound_engine_can_issue`, `test_no_contract_uses_nondeterminism_outside_the_engine`). Without validator consensus no party is permitted to certify an emergency. |
| **Every privileged state change is finality-gated and digest-bound** | All `.emit(` calls are `on="finalized"` (`test_all_privileged_emissions_are_finality_gated`); issuance, execution and application each recompute the digest (`test_gate_recomputes_digest_at_issuance_and_execution_and_binds_envelope`, `test_digest_must_bind_this_target`). Charter publication/activation are owner-only writes that grant nothing by themselves. |
| **Non-custodial, zero admin bypass, uncertainty fails closed** | No payable method / value transfer (`test_system_is_structurally_non_custodial`); target write surface is exactly three methods (`test_target_has_no_admin_pause_or_governance_mutation`); fail-closed `_enforce` (`test_unavailable_source_…`, `test_fabricated_quote_…`, `test_ungrounded_trigger_clause_…`, `test_support_plus_contradiction_…`). |
| **Adversarial path documented and testable end to end** | [docs/ADVERSARIAL_REVIEW.md](docs/ADVERSARIAL_REVIEW.md); `scripts/adversarial-run.mjs` (live); results in `docs/adversarial-run.latest.json`. |
| **Source verification, CI health, public deployment airtight** | `npm run source:verify` compares `gen_getContractCode` bytes with the repo and with manifest SHA-256 for all five contracts; `npm run health:check` also checks wiring and (optionally) the hosted frontend commit; `.github/workflows/health.yml` runs it on a schedule; a unit test fails if the repo drifts from the manifest hashes. |
| **Feels like real infrastructure** | Control-room UI with finality rail, authority envelope, per-source evidence, audit explorer; explicit wrong-network / no-wallet / rejected-transaction states; `/api/build-info` for commit + deployment id. |

## Pins and hygiene

| Requirement | Evidence |
|---|---|
| Studionet 61999 only | `lib/config.ts`; `deploy/deployScript.ts` refuses other chains; `scripts/toolchain-check.mjs`; unit tests |
| CLI 0.39.1 repo-local | `package.json` devDependency; `toolchain:check` reads `node_modules/genlayer/package.json`; all docs use `npx --no-install genlayer` |
| genlayer-js 1.1.8, genlayer-py v0.18, testing suite v0.29, Python 3.12+, genvm-linter 0.11.0 | `package.json`, `requirements.txt`, `.python312`, `toolchain:check` |
| Stable runner pinned in every contract | line 1 of each file; `test_every_contract_pins_the_stable_runner_on_line_one` |
| No Privy / WalletConnect / Firebase / Supabase / backend / production mocks | `test_forbidden_dependencies_are_absent`, `test_wallet_is_injected_eip1193_only`, `test_e2e_seam_is_inert_in_production` |
| Injected EIP-1193 wallet with explicit errors | `components/WalletProvider.tsx`, `lib/genlayer.ts`; E2E: missing wallet, wrong network, rejected connection, unconnected write |

## Security invariants

The full invariant → enforcement → test table, with live step references, is in [SECURITY.md](SECURITY.md).

## Test inventory

| Layer | Count | Notes |
|---|---|---|
| Unit (`tests/unit`) | 41 | Source-level invariants, pins, forbidden deps, UI↔engine decision-set equality, manifest-hash drift, CI gates |
| Direct Mode (`tests/direct`) | 86 | Every negative path per contract, cross-contract governance, finality emission, replay, digest mismatch, host rejection, validator disagreement |
| Browser E2E (`tests/e2e`) | 22 | Stub EIP-1193 wallet + dev-only data seam; happy path and adversarial UI paths |
| Live Studionet | `scripts/adversarial-run.mjs` | ~45 steps; transaction hashes recorded |

Mutation evidence: disabling the engine's quote verification (leader and validator sides), clause grounding, per-source state comparison, injection downgrade, and the target's digest check each makes a specific test fail.
