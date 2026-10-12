# Deployment runbook

Target: **Studionet only** (chain 61999, `https://studio.genlayer.com/api`, explorer `https://explorer-studio.genlayer.com`).

## 0. Preconditions

```bash
node scripts/toolchain-check.mjs            # CLI 0.39.1 (repo-local), genlayer-js 1.1.8, Python 3.12+, genvm-linter 0.11.0
npx --no-install genlayer account show      # active account must be the intended, UNLOCKED deployer; network studionet
npm run contracts:check                     # all 5 contracts: compile + lint + validate
npm run test                                # unit + Direct Mode must be green
```

Never use a globally installed `genlayer` (a different version may be on PATH). Always `npx --no-install genlayer …` from the repo root.

The deployer wallet becomes the **governance wallet of ProtectedTarget** and the owner of the engine/ledger bind step. Treat it accordingly.

## 1. Deploy

```bash
npm run deploy:studionet
```

`deploy/deployScript.ts` (run by the CLI with the active unlocked account):

1. refuses unless `client.chain.id === 61999`;
2. deploys EvidenceLedger, CapabilityGate, CharterRegistry, MassEngine `(registry, gate, ledger)`;
3. `gate.bind_engine(engine)` and `ledger.bind_engine(engine)`, each waited to FINALIZED;
4. deploys ProtectedTarget `(gate)`;
5. waits for every transaction to reach **FINALIZED** with a successful execution result;
6. writes `.env.generated` and `deployment-manifest.generated.json` (addresses, source SHA-256, tx hashes, deployer, repository commit).

If any step fails, stop. Do not partially reuse a stack: redeploy all five (contracts are not upgradeable by design).

## 2. Publish the manifest

Copy `deployment-manifest.generated.json` to `deployment-manifest.public.json`, set `"status": "DEPLOYED"`, keep any `supersededDeployments`, and commit it together with the exact contract sources it describes.

## 3. Verify

```bash
npm run source:verify     # gen_getContractCode bytes == repository bytes == manifest sha256, for all 5
npm run health:check      # live reads, wiring (gate/ledger bound to engine, target gate), governance == deployer
```

Both must pass before the frontend is announced. `health:check` also checks a hosted frontend when `MASS_HEALTH_BASE_URL` (and optionally `EXPECTED_FRONTEND_COMMIT`) are set; the frontend's `/api/build-info` returns the commit and deployment id.

## 4. Frontend

```bash
npm run build && npm run start     # or deploy the Next.js app to any host; no server secrets are required
```

The app needs only `deployment-manifest.public.json` (or the `NEXT_PUBLIC_*_ADDRESS` overrides in `.env.example`). It has no backend and no keys.

## 5. Live review

`node scripts/adversarial-run.mjs` executes the full adversarial path against the deployed stack. See [docs/ADVERSARIAL_REVIEW.md](docs/ADVERSARIAL_REVIEW.md).

## Changing contracts

Any byte change to a contract requires redeploying the whole stack, a new manifest, and `source:verify` to pass again. CI's unit suite fails if the repository drifts from the manifest's source hashes.

## Known operational notes

- Studionet finality takes tens of seconds per transaction; a full deployment takes roughly 5–10 minutes. An assessment takes longer because validators fetch and reason.
- `genvm-lint validate` resolves the runner from a downloaded GenVM release. `scripts/py.mjs` sets `GENVM_VERSION=v0.2.16`, which contains the pinned `py-genlayer:1jb45aa8…` runner. Run `genvm-lint download -v v0.2.16` once.
- On Windows, set `PYTHONIOENCODING=utf-8` for `genvm-lint` (the scripts do this).
