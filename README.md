# Mass

> Mass of evidence. Mass of consensus. Zero self-certification.

Mass is an emergency-authority system for GenLayer Studionet (chain 61999). A protocol commits an immutable emergency charter in advance. When an incident is frozen, GenLayer validators independently fetch only the pre-approved evidence sources, judge them against the frozen natural-language policy, and only after that assessment is **FINALIZED** can a single-use, expiring, digest-bound capability be issued. The protected target has no admin pause. Uncertainty fails closed.

No party, including the protocol's own deployer, can self-certify an emergency.

## Why GenLayer is load-bearing

A contract cannot read a security advisory or notice that a source is trying to manipulate its reader. A multisig can, but then a person certifies their own emergency. Mass replaces that person with validator consensus over live web evidence. Remove GenLayer and nothing remains that is allowed to say "this is an emergency".

## Contracts

| Contract | Role |
|---|---|
| `CharterRegistry` | Immutable, versioned charters. First publisher claims a protocol key. No rollback. Proves target governance on publish and activate. |
| `MassEngine` | Freezes incidents; the only nondeterministic contract. Leader + validators fetch, interpret, verify quotes. Audit log. |
| `CapabilityGate` | Finality-gated issuance and single-use consumption. Recomputes the action digest at issuance and every execution. Optional guardian co-signature. |
| `ProtectedTarget` | Non-custodial consequence surface. No admin pause. Emergency methods accept only the gate and recompute the digest against their own address. |
| `EvidenceLedger` | Append-only, finality-gated provenance: per-source HTTP status and normalised/raw content digests. |

Two action classes exist: `PAUSE_PROTECTED_ACTION` and `QUARANTINE_LANE` (one chartered lane).

## Live deployment

Hosted frontend: <https://mass-iota-three.vercel.app> (`/api/build-info` reports the exact commit and deployment id).


The live Studionet addresses, source SHA-256 values, deployer and transaction hashes are in [`deployment-manifest.public.json`](deployment-manifest.public.json). `npm run source:verify` checks the on-chain bytes against this repository.

## Quick start

Requirements: Node 22.18+ (24 recommended; the gate tests run TypeScript natively), [uv](https://docs.astral.sh/uv/), a Chromium for Playwright.

```bash
uv venv --python 3.12 .python312
uv pip install --python .python312/Scripts/python.exe -r requirements.txt   # .python312/bin/python on macOS/Linux
npm ci
npm run toolchain:check     # pins: genlayer 0.39.1, genlayer-js 1.1.8, genvm-linter 0.11.0, Python 3.12+
npm run contracts:check     # py_compile + genvm-lint check (lint + validate) for all 5 contracts
npm run test                # unit + Direct Mode
npm run typecheck && npm run build
npm run test:e2e            # Playwright
npm run dev                 # http://localhost:3000
```

`npm run health:check` verifies live Studionet reads, contract wiring and the exact deployed-source byte match.

## Deploying

Deployment uses the repo-local GenLayer CLI (0.39.1, never global) and the CLI's active **unlocked** account:

```bash
npx --no-install genlayer account show     # confirm the account and network
npm run deploy:studionet
```

The script refuses any chain other than 61999. See [DEPLOYMENT_RUNBOOK.md](DEPLOYMENT_RUNBOOK.md).

## Documentation

[ARCHITECTURE](ARCHITECTURE.md) · [SECURITY](SECURITY.md) · [DEPLOYMENT_RUNBOOK](DEPLOYMENT_RUNBOOK.md) · [REVIEW_TARGET](REVIEW_TARGET.md) · [REVIEW_EVIDENCE](REVIEW_EVIDENCE.md) · [VALIDATION_REPORT](VALIDATION_REPORT.md) · [Adversarial review](docs/ADVERSARIAL_REVIEW.md) · [Steward response](docs/STEWARD_RESPONSE.md) · [AGENTS](AGENTS.md)

## Honest limits

- The consensus decision is an LLM judgement; Mass constrains it (verbatim quotes, grounded clauses, tripwires, fail-closed rules) but does not make it infallible.
- Studionet's public RPC allows 30 `gen_call` reads per minute per network address and hides its 429s from browsers. The frontend paces, caches and shares a read budget across tabs; heavy use from one address can still see short delays (the UI says so).
- The demo target is deliberately small. It demonstrates the authority path; it is not a production protocol.
- Studionet is a test network. Nothing here has had an external audit.
