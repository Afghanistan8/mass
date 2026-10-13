# Response to steward review (round 1)

Every requested change below was first **reproduced as a failing test against the reviewed code**, then fixed, then mutation-checked (disabling the fix makes the named tests fail), then demonstrated live on Studionet. Live evidence: [`docs/live-runs/steward-MV6KHJ3C.md`](live-runs/steward-MV6KHJ3C.md) — 39 of 39 checks passed, every transaction waited to **FINALIZED**, with GenVM outcome, consensus result, delivered child transactions and authoritative state readbacks.

Redeployed stack (byte-verified, `npm run source:verify`): CharterRegistry `0xf32Ee8ce88A85108E521CEE342E4F0820ca34240` · MassEngine `0x4339f56a03963B8cAF9Ff6a1D83C3FC932e5d90c` · CapabilityGate `0x962F5713E45E4595d6B23D1BA699D0d3bc3FE5Dc` · ProtectedTarget `0x6b286EaD0BA56623f68094249fe09E7F1AC3534D` · EvidenceLedger `0x3dEeE6210EF78733419390F6012e4E0b6F48aD88`.

Explorer links below use `https://explorer-studio.genlayer.com/tx/<hash>`.

---

## 1. Bounded, verifiable recovery (`CapabilityGate.execute_capability`)

**Reproduced.** On the reviewed code a `DISPATCHED` capability whose delivery never applied could be re-dispatched after its TTL (the expiry check ran only for `ISSUED`). Separately, the target had **no deadline at all**, so even a first dispatch delivered late would still apply.

**Change.**
- `expires_at` is now **one hard authority deadline** for guardian approval, the first dispatch, every recovery re-dispatch, **and the target's application** (`capability_gate.py: _effective_status`, `execute_capability`).
- Recovery is allowed only while: the deadline has not passed, the target has not applied the capability (read from the target), the envelope and action digest re-verify exactly, and fewer than **3** dispatches were made (`MAX_DISPATCHES`).
- Each dispatch carries `valid_until = expires_at`; the target refuses application after it, and refuses any deadline more than 7,200 s ahead (`protected_target.py: _require_authority_window`). Replaying an already-applied capability is a no-op — no extension, no new history — even after the deadline.
- After the deadline an unapplied capability is `EXPIRED` (immediately in the view, persisted by `reconcile_capability`); execution reverts with *"capability expired: renewed emergency authorization is required"*. New authority needs a new incident and a new FINALIZED assessment.

**Tests** (`tests/direct/test_steward_round1.py`): `test_recovery_redispatch_after_the_authority_deadline_is_rejected`, `test_recovery_within_the_window_is_allowed_but_bounded`, `test_every_dispatch_carries_the_authority_deadline_to_the_target`, `test_unapplied_capability_becomes_expired_and_stays_expired`, `test_an_issued_capability_that_was_never_used_expires_too`, `test_a_capability_applied_inside_its_window_is_reported_applied_after_it`, `test_a_delayed_delivery_after_the_deadline_is_rejected_by_the_target`, `test_delivery_inside_the_deadline_applies`, `test_target_refuses_a_deadline_beyond_the_maximum_lifetime`, `test_replaying_an_applied_capability_after_its_deadline_changes_nothing`, `test_lane_quarantine_is_also_bound_by_the_deadline`. The pre-review test that *allowed* recovery after expiry was rewritten to require rejection.

**Live (phase R).** Capability `CAP-INC-R-MV6KHJ3C`, deadline 11:16:56Z (5-min TTL):

| Evidence | Result | Transaction |
|---|---|---|
| Holder dispatches 15 s before the deadline (gate state: dispatched 1791890201, deadline 1791890216) | `return` | [0xcdef107c…](https://explorer-studio.genlayer.com/tx/0xcdef107cbedb0aaee16375e10dab629e0677bec625cfee447566f8bfaaf709d8) |
| **Delayed delivery**: child transaction gate → target created 11:17:18Z, 22 s after the deadline | `rollback` · *capability authority window has expired* | [0x041d4143…](https://explorer-studio.genlayer.com/tx/0x041d4143e1ebe4179e15a89065eeead08d4c19c0421c86dbfb3ed6863612e880) |
| Readback: target `get_applied_capability_digest` empty; no history entry; gate view `EXPIRED` while storage still `DISPATCHED` | ✅ | — |
| Recovery re-dispatch after the deadline | `rollback` · *capability expired: renewed emergency authorization is required* | [0x062d347b…](https://explorer-studio.genlayer.com/tx/0x062d347b7af030351dca131c3bf2a60844126b84bdec6f3c331d8ed5ef02ae2b) |
| Reconcile records the expiry (`stored_status: EXPIRED`) | `return` · "EXPIRED" | [0x07d88dd2…](https://explorer-studio.genlayer.com/tx/0x07d88dd272971db5a723b2a49962fb7e90a64d1b5b7ec08e9438252a2af35f58) |
| Second recovery attempt on the expired capability | `rollback` · same message | [0x8111f8fd…](https://explorer-studio.genlayer.com/tx/0x8111f8fdbcc6d3ecc0ec8814e2567c76dc8d69cb7ab463de951a101154ff5b76) |

**Live (phase X).** After the quarantine capability's own deadline, replaying it → `rollback` *capability already applied* ([0xe689b211…](https://explorer-studio.genlayer.com/tx/0xe689b2117348a06b68d0d719199d383825a8e6c23cf4178c982829dd67c47837)); readback: lane `bridge` still until `1791890694` (not extended), exactly one history entry.

## 2. Source equivalence (validator fingerprints)

**Reproduced.** The reviewed validator compared decisions, per-source states and HTTP classes, but not content fingerprints. A validator whose fetch returned a *withdrawn* version of the advisory (still containing the leader's quote) returned `True`.

**Change.** For an authority-granting decision (`TRIGGER_CONFIRMED`), each validator now requires, for **every reachable source**, that its **own** normalised content fingerprint — sha256 of the tag-stripped, whitespace-collapsed, lower-cased text, computed in code from its own fetch — equals the one the leader commits to the ledger, and that both read the source in full. The raw-bytes fingerprint is recorded as provenance but not required, because markup-only changes (attributes, comments, cache tags) do not change meaning. Non-granting decisions do not require fingerprint equality (they create no authority; a disagreement simply fails to finalize). The full definition is a table in [ARCHITECTURE.md › Source equivalence](../ARCHITECTURE.md).

**Tests:** `test_validator_rejects_authority_when_its_evidence_version_differs` (withdrawn version), `test_a_forged_leader_digest_is_rejected`, `test_validator_accepts_markup_only_differences`.

**Live.** Both live confirmations in run `steward-MV6KHJ3C` (incidents `INC-Q-…`, `INC-R-…`) reached `MAJORITY_AGREE` under the new rule, so validators independently produced identical fingerprints for the published advisory ([0x837e40ae…](https://explorer-studio.genlayer.com/tx/0x837e40ae1a8f7577829d95590f9337f432dea5b65b1371c371ee4a5c16149f48), [0xd617f2ec…](https://explorer-studio.genlayer.com/tx/0xd617f2ecd0d19e818497c3aa247b1ea68cd70710d17d0c06ba86bd9d1dd74a46)). The per-source fingerprints are in the finalized EvidenceLedger record.

## 3. Bounded excerpts vs. complete documents

**Reproduced.** The reviewed engine sent the model the first and last 3,000 characters of long sources while hashing the whole document. With a *"Correction: … the alert was a false positive"* sentence placed in the omitted middle, the reviewed code still returned `TRIGGER_CONFIRMED` and emitted a capability.

**Change.** Nothing is excerpted any more. A source is either shown to the model **in full** (extracted text ≤ 10,000 characters, `complete: true`) or marked `complete: false`. An incomplete source can never support a trigger, and any reachable incomplete source turns a confirmation into `INSUFFICIENT_EVIDENCE` — so text the model did not read can never hide a qualification behind an authority-granting decision. `complete` and `text_chars` are recorded per source in the assessment and the ledger commitment, and the UI shows them. The injection tripwire always scanned the full text and still does.

**Tests:** `test_a_source_the_model_cannot_read_in_full_cannot_support_a_trigger` (the false-positive-in-the-middle case), `test_a_source_read_in_full_is_recorded_as_complete`.

## 4. Expanded live demonstration

All in run `steward-MV6KHJ3C` ([report](live-runs/steward-MV6KHJ3C.md)):

| Requested | Shown | Key transaction |
|---|---|---|
| `QUARANTINE_LANE` | lane `bridge` quarantined for 20 min; readback `lanes.bridge.quarantined = true`, `is_lane_open(bridge) = false`, `is_lane_open(swaps) = true`, global pause unchanged; protected action in `bridge` → *lane is temporarily quarantined*; in `swaps` → succeeds | delivery [0x732dd36a…](https://explorer-studio.genlayer.com/tx/0x732dd36a2dc5f0ec4db4ca82d90c65c320c14408c3518385eed5a097858d3954), blocked action [0xd9255c83…](https://explorer-studio.genlayer.com/tx/0xd9255c83c0d3f94e1b87456a7e1739f00478bf935fb685c0ee8a81192fe8aa2e) |
| Optional guardian approval | charter names a guardian; execute before approval → *guardian approval required*; holder approving → *only the guardian may approve*; guardian (separate key) approves → execution succeeds | [0x1984eb8c…](https://explorer-studio.genlayer.com/tx/0x1984eb8cf6816308aa15673c0ea06b2e8d9014d3c27ea7e333a84d4caa3d482c), [0xd01508e6…](https://explorer-studio.genlayer.com/tx/0xd01508e686e6cb4c8e6100fdd9e43f17a2d19b41f4fd4d87e1271a704069ed05), [0xe3176f4c…](https://explorer-studio.genlayer.com/tx/0xe3176f4c68204981f55131c5ab39ae00abd00eb5047ac4aba6d4b90f88e141b8) |
| Delayed cross-contract delivery | measured delivery latency 35 s; a dispatch timed inside the window whose delivery landed 22 s late was refused by the target | [0x041d4143…](https://explorer-studio.genlayer.com/tx/0x041d4143e1ebe4179e15a89065eeead08d4c19c0421c86dbfb3ed6863612e880) |
| Expired-capability recovery attempts | two re-dispatch attempts after the deadline, both rejected; expiry persisted | see §1 |
| Already-applied authority | replay before and after its deadline both rejected; no extension | [0x031792fd…](https://explorer-studio.genlayer.com/tx/0x031792fd62da42ed693bebbcbf9b17c30f33e96834bd679f855160cd8d5af744), [0xe689b211…](https://explorer-studio.genlayer.com/tx/0xe689b2117348a06b68d0d719199d383825a8e6c23cf4178c982829dd67c47837) |
| Protected-target state changes | 15 authoritative readbacks of the latest FINALIZED state (capabilities, target status, lanes, history) embedded in the report | — |

The guardian in the live run is a throwaway key generated in memory for that run only (unfunded — Studionet accepted its transactions without funding — and never stored). The deployer remains the target's governance wallet and the capability holder.

Reproduce: `node scripts/steward-demo.mjs` (≈ 30–45 min; writes a new report under `docs/live-runs/`).

## Trade-offs made explicit

- **Authority deadline = the charter TTL.** A dispatch made seconds before the deadline can be refused by the target if delivery lands after it — deliberately fail-closed (shown live). Charters should leave room for delivery (~35 s on Studionet).
- **Authority needs stable, bounded evidence.** Confirmation requires identical normalised text across validators and ≤ 10,000 extracted characters per source. A page whose visible text changes per request, or a very long document, cannot confirm a trigger.
