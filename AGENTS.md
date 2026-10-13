# Agent handoff

Read [README.md](README.md), [ARCHITECTURE.md](ARCHITECTURE.md) and [SECURITY.md](SECURITY.md) first.

## Hard rules

- **Studionet 61999 only.** Never add another network, Privy, WalletConnect, Firebase, Supabase, a backend that decides anything, or a production mock.
- **Toolchain pins** (`npm run toolchain:check`): genlayer CLI **0.39.1 repo-local** (always `npx --no-install genlayer`, never a global one), genlayer-js 1.1.8, genlayer-py v0.18, genlayer-testing-suite v0.29, Python 3.12+ in `.python312`, genvm-linter 0.11.0.
- **Runner pin** on line 1 of every contract: `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`.
- **Contracts are frozen against the live deployment.** A single changed byte means redeploying all five and publishing a new manifest. `tests/unit/test_frontend_invariants.py::test_public_manifest_…` fails when the repo drifts from the manifest hashes.
- **Every authority message is `emit(on="finalized")`.** Never `accepted`.
- **Never** add an admin/owner/governance pause to `ProtectedTarget`, a payable method anywhere, or `on="accepted"`.
- Deployment uses the CLI's active **unlocked** account. Do not read, print, export or paste key material. Confirm the account (`genlayer account show`) before any write, and tell the user what you will sign.

## Commands

```bash
npm run toolchain:check   npm run contracts:check   npm run test:unit   npm run test:direct
npm run typecheck         npm run build             npm run test:e2e
npm run source:verify     npm run health:check
node scripts/adversarial-run.mjs [--phase=A]
```

## Where things are

- `contracts/` five contracts. `tests/direct/helpers.py` has `Chain` (fake cross-contract views + recorded `PostMessage`s) and `action_digest`.
- `lib/policy.ts` is the single source of UI copy for decisions/statuses; a unit test keeps it equal to the engine's sets.
- `lib/genlayer.ts` wallet + chain access; the `__MASS_E2E_MOCK__` seam is inert in production.
- `scripts/py.mjs` runs the repo-local venv with `GENVM_VERSION=v0.2.16`.

## Gotchas learned the hard way

- CLI 0.39.1 argument quirks: through a shell, empty args are dropped or arrive as `b''`; without a shell a bare `""` becomes the integer `0`. Pass `null` for absent optional args and spawn without a shell. Contracts accept `""`, `b''` and `None` as absent.
- `genvm-lint validate` needs the runner's GenVM release downloaded (`genvm-lint download -v v0.2.16`).
- Direct Mode account objects are `bytes`; use `hx()` from the helpers. `target.address` is the checksummed deployed address.
- Next 16 allows one `next dev` per directory: stop any preview server before `playwright test`.
- Validator tests must give the leader's forged state `http_status: 200`, or the HTTP-class check rejects it first and the test passes for the wrong reason. Re-mutate when adding validator tests.
- **Studionet RPC budget:** `gen_call` and `gen_getContractSchema` are limited to 30/min per IP (bucket "standard"); `eth_*` and `gen_getContractCode` to 300/min. 429s have no CORS headers, so browsers show "Failed to fetch". All app reads must go through `readContract` (the gate); never add ad-hoc retry loops or fast polling, and remember your own scripts share the IP budget.
- Controlled inputs rendered on the server lose typed-before-hydration text from React state; new forms must call `adoptPrehydrationValues` (a unit test enforces it).
- CSP is production-only: verify header changes with `next build && next start`, not `next dev`.
- `genlayer deploy` runs EVERY `.ts`/`.js` in `deploy/`, and a crashed run leaves `deploy/deployScript.compiled.js` behind, so the next run deploys twice. It is git-ignored; delete it before redeploying. The deploy script retries transport errors (Studionet RPC timeouts happen).
- Capabilities have ONE hard deadline (`expires_at`) for approval, dispatch, recovery and the target's application; the target refuses late deliveries. Live tests that need a late delivery dispatch ~half the measured delivery latency (~35 s) before the deadline (see `scripts/steward-demo.mjs`).
- Studionet reads default to latest finalized; a just-written value may take tens of seconds to appear.

## Status

See [VALIDATION_REPORT.md](VALIDATION_REPORT.md) for what has and has not been verified, and the live addresses in `deployment-manifest.public.json`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
