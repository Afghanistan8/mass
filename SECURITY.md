# Security

## Threat model

| Adversary | Goal | Mitigation |
|---|---|---|
| Operator / protocol team | Obtain emergency power without a real emergency | Power exists only as a capability issued after a FINALIZED consensus assessment; the operator's reason is declared non-evidence to validators |
| Malicious evidence source | Manipulate the assessing model | JSON-encoded untrusted data, explicit attack framing, deterministic tripwire, quote verification, any tripwire hit ⇒ `SOURCE_TAMPERING_SUSPECTED` |
| Malicious leader | Push a false decision through consensus | Validators independently refetch and re-judge; require equal decision, per-source state, HTTP class; verify every quote in their own fetch |
| Insider with the target's deployer key | Pause or unpause the target at will | The target has no admin pause or unpause. The deployer only holds the *right to be a capability holder* |
| Stranger | Replay, substitute, or redirect a capability | Holder-bound, target-bound, action/scope/duration-bound, digest recomputed at gate and target, single-use |
| Chain observer / reorg | Act on an accepted-but-not-final result | All authority messages are `emit(on="finalized")` |
| Rogue contract | Impersonate a user | Protected actions require `sender == origin` |

## Invariants and where they are tested

| # | Invariant | Enforced in | Negative tests |
|---|---|---|---|
| 1 | No capability before FINALIZED | `mass_engine` emit; `capability_gate.issue_capability` engine-only | `test_confirmed_assessment_emits_only_finalized_messages`, `test_only_bound_engine_can_issue`, `test_all_privileged_emissions_are_finality_gated`; live A2 |
| 2 | No direct emergency admin on target | `protected_target` (no such methods; gate-only) | `test_no_admin_pause_surface_exists`, `test_only_gate_can_apply_emergency_methods`, `test_target_has_no_admin_pause_or_governance_mutation`; live A1 |
| 3 | No arbitrary target/action | digest at engine, gate (×2), target, browser | `test_issuance_recomputes_and_rejects_forged_digest`, `test_digest_must_bind_this_target`, `test_lane_scope_is_digest_bound` |
| 4 | No unauthorized target governance | registry (publish, activate), engine (open, assess), gate (issue), target (apply) | `test_publisher_must_be_target_governance`, `test_activation_reproves_target_governance`, `test_target_governance_checked_at_open`, `test_governance_rejection_at_assessment_blocks_issuance`, `test_issuance_double_checks_target_governance`, `test_governance_isolation_rejects_unauthorized_holder` |
| 5 | No duration expansion | charter max → incident check → digest → gate envelope → target bounds | `test_action_scope_and_duration_are_bounded_by_charter`, `test_execution_envelope_rejects_…`, `test_duration_bounds`; live C1 |
| 6 | No replay | gate status + target idempotency + unique action keys | `test_applied_capability_cannot_be_replayed`, `test_capability_replay_is_idempotent_and_cannot_rebind`, `test_replayed_protected_action_key_is_rejected`; live D9 |
| 7 | No issuer substitution | gate `engine_address` one-time bind; capability stores issuer | `test_engine_binding_is_one_time_and_deployer_only`, `test_issuance_before_bind_is_impossible`; live A3 |
| 8 | No source-host substitution | exact-host scopes, canonical URL rules | `test_evidence_scope_rejects_dot_segments_lookalikes_and_foreign_hosts`; live C3, C4 |
| 9 | Uncertainty fails closed | `_enforce`, closed decision set | `test_unavailable_source_cannot_support_trigger`, `test_fabricated_quote_cannot_create_authority`, `test_ungrounded_trigger_clause_fails_closed`, `test_support_plus_contradiction_is_conflicting_not_confirmed` |
| 10 | No protocol-key takeover or charter rollback | registry owner map, version compare | `test_protocol_key_cannot_be_taken_over`, `test_no_rollback_and_monotonic_versions`; live F3 |
| 11 | No internal user impersonation | `sender == origin` on protected actions | `test_protected_action_requires_direct_eoa` |
| 12 | No stranded user value | no payable method, no value transfer anywhere | `test_system_is_structurally_non_custodial` |
| 13 | Prompt-injection resistance | prompt framing + tripwire + quotes | `test_prompt_injection_in_source_is_tripwired_to_tampering`, `test_engine_prompt_treats_all_inputs_as_untrusted_data` |
| 14 | Validators are not rubber stamps | `validator_fn` | `test_validator_rejects_*` (8 tests); mutation-checked |

"Mutation-checked": the quote check, clause grounding, per-source state comparison, injection downgrade and target digest check were each disabled in turn and the corresponding test failed. Two initial tests that passed for the wrong reason were found this way and rewritten.

## Known limitations

- **The model can still be wrong.** Code rules narrow what a wrong answer can do (a false `TRIGGER_CONFIRMED` still needs a verbatim quote from an approved source and an ungrounded clause is dropped), but a convincing real-looking page on an approved host can still deceive. Choose evidence hosts and path prefixes accordingly.
- **Tripwires are heuristics.** A hostile page that avoids the patterns will not trip them; the quote requirement and the validators' independent judgement remain.
- **Authority is bounded, not absent.** A confirmed incident can pause a target for up to the chartered maximum (≤ 24h). Chaining incidents requires a new finalized assessment each time.
- **Single governance wallet.** The target's deployer is its governance wallet and cannot be rotated. The optional guardian adds a second approver for execution, not for opening incidents.
- **Frontend CSP allows inline scripts.** Next.js's bootstrap needs `script-src 'unsafe-inline'` unless a nonce proxy is added. The rest of the policy is strict: `default-src 'self'`, `connect-src` limited to the Studionet RPC, `frame-ancestors 'none'`, `object-src 'none'`; plus `X-Frame-Options: DENY`, `nosniff`, a restrictive `Permissions-Policy`. Hostile URL segments are escaped (verified: no script execution).
- **Public RPC rate limit.** Studionet allows 30 `gen_call`/min per address; the frontend caps itself at 22/min (shared across tabs), caches reads and stops polling finished pages. This is availability, not safety: no authority decision depends on it.
- **Studionet only.** Test network, no external audit. GenVM runner `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` is pinned in every contract.
- **Argument decoding.** Optional arguments may arrive as `""` (browser), `b''` (CLI via a shell), `None` (CLI `null`) or the integer `0` (CLI 0.39.1 turns a bare `""` into `0`). Mass treats `""`, `b''` and `None` as absent and fails closed on anything else (e.g. `0` is rejected as an invalid address). Pass `null` from the CLI. Found in live runs; regression-tested.
- **Cross-contract failure shapes differ on-chain.** Direct Mode turns a missing governance view into Mass's `UserError`. On Studionet, calling an *undefined method* on a real contract (for example chartering the engine as a target) is a VM-level error that `except Exception` cannot catch. The transaction still reverts and nothing is published, so the behaviour is fail-closed, but the revert message is the VM's, not Mass's (live step A5).
- **Dispatched is not applied.** Cross-contract delivery is asynchronous; the UI shows `DISPATCHED` until the target reports the digest.

## Reporting

Open an issue in the repository or contact the maintainer of the deployment manifest's deployer address. Do not post live exploit details publicly.
