# Adversarial review script

Two layers: Direct Mode (fast, deterministic, every negative path) and a live Studionet run (real consensus).

## Direct Mode

```bash
npm run test:direct     # contracts executed in the GenVM direct harness; web and LLM are mocked
```

Hostile cases covered include: forged digests, wrong holder/target/action/scope/duration, expiry, guardian bypass, replay, governance mismatch at each of five checkpoints, URL traversal/look-alikes/foreign hosts, fabricated quotes, ungrounded clauses, unavailable sources, prompt-injection pages, support+contradiction, malicious leaders, validators that disagree on decision / per-source state / HTTP class / quote presence, a lying second comparison, rollback, takeover, frozen-digest mismatch after charter rotation, and CLI `b''` empty arguments.

## Live run

```bash
node scripts/adversarial-run.mjs            # everything
node scripts/adversarial-run.mjs --phase=A  # only the instant unauthorized-attempt checks
```

It signs with the CLI's active unlocked account (repo-local CLI 0.39.1), reads and waits on receipts with genlayer-js, and writes every step and transaction hash to `docs/adversarial-run.latest.json`. Evidence texts live in [`demo/evidence/`](../demo/evidence) and are served from `raw.githubusercontent.com/Afghanistan8/mass/main/demo/evidence/` (the charter scope is exactly that path prefix). A pre-flight check refuses to start unless every evidence URL returns HTTP 200 with content byte-identical to the repository file. `--evidence=httpbin` reproduces runs made before the switch; httpbin.org proved unreliable (repeated HTTP 503 during run `MV5B3PVS`).

| Phase | Step | Expected |
|---|---|---|
| A | A1 deployer calls `ProtectedTarget.emergency_pause` | revert: requires CapabilityGate |
| A | A2 deployer calls `CapabilityGate.issue_capability` | revert: only bound MassEngine |
| A | A3 re-bind the gate's engine | revert: already bound |
| A | A4 forge a ledger record | revert: only bound MassEngine |
| A | A5 charter a target the publisher doesn't govern | revert: target did not prove governance |
| A | A6 open an incident on an unknown charter | revert: charter not found |
| B | publish v1 → activate early → wait → activate | early activation reverts; final activation succeeds |
| C | duration over limit; un-chartered lane; foreign host; dot segments | each reverts at freeze time |
| D | freeze incident A → assess → finality → capability → execute → target paused | capability appears only after FINALIZED; target pauses |
| D | protected action while paused; reconcile; replay the spent capability | revert; applied; revert |
| E | routine-maintenance evidence; prompt-injection evidence | no `TRIGGER_CONFIRMED`, no capability |
| F | publish v2 → activate → roll back to v1 → open incident on v1 | rollback reverts; superseded charter reverts; the earlier incident keeps its v1 digest |

A step whose result differs from the expectation is printed as `FAIL` and makes the script exit non-zero. If step D2 does not return `TRIGGER_CONFIRMED`, the script reports it rather than hiding it; consensus over live web evidence is probabilistic and a run should be repeated and the outcome recorded as observed.

## Steward demonstration (review round 1)

```bash
node scripts/steward-demo.mjs     # ≈ 30–45 min; writes docs/live-runs/steward-<RUN>.{md,json}
```

Every write is waited to **FINALIZED** and recorded with its GenVM outcome (`return` / `rollback` + message), consensus, the child transactions it triggered, and an explorer link; state is read back from the latest FINALIZED state.

| Phase | Shows |
|---|---|
| QG | `QUARANTINE_LANE` behind a guardian: execute before approval and holder-as-guardian both revert; the guardian (a throwaway in-memory key) approves; the delivery quarantines only the chartered lane; protected actions blocked there and allowed elsewhere; replay rejected |
| R | delayed delivery: a dispatch inside the window whose delivery lands after the deadline is refused by the target; nothing recorded; recovery after the deadline rejected twice; expiry persisted |
| X | replaying the applied quarantine after its deadline is rejected and does not extend it |

Latest result: [`steward-MV6KHJ3C`](live-runs/steward-MV6KHJ3C.md) — 39/39 passed. See also [STEWARD_RESPONSE.md](STEWARD_RESPONSE.md).

## Manual UI walk-through

1. `/charter/new` — publish; `/charter/<key>` — wait for the delay, activate.
2. `/incident/new` — freeze; try a `http://` URL, a `?query`, a `..` segment: the form rejects each before any wallet prompt.
3. `/incident/<key>` — assess; watch the rail: Frozen → Assessed → Finalized → Capability. A newer-but-not-final assessment is flagged.
4. `/capability/<key>` — the page recomputes the action digest in your browser and shows a match or a loud mismatch. Execute; the UI says "waiting for FINALIZED" until it is.
5. `/target` — the pause countdown; try a protected action while paused.
6. `/audit?incident=<key>` — per-source digests; paste a commitment to verify it against the finalized ledger.
