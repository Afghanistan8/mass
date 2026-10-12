import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def text(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def test_required_routes_exist():
    for route in (
        "app/page.tsx", "app/command/page.tsx", "app/charter/new/page.tsx", "app/charter/[key]/page.tsx",
        "app/incident/new/page.tsx", "app/incident/[key]/page.tsx", "app/capability/[key]/page.tsx",
        "app/target/page.tsx", "app/audit/page.tsx", "app/api/build-info/route.ts",
    ):
        assert (ROOT / route).exists(), route


def test_e2e_seam_is_inert_in_production():
    src = text("lib/genlayer.ts")
    assert 'process.env.NODE_ENV !== "production"' in src
    assert src.count("__MASS_E2E_MOCK__") <= 3
    for fn in ("readContract", "submitWrite", "waitForFinalization"):
        assert fn in src


def test_wallet_is_injected_eip1193_only():
    src = text("lib/genlayer.ts")
    assert "window.ethereum" in src and "eth_requestAccounts" in src and "wallet_switchEthereumChain" in src
    for banned in ("privy", "walletconnect", "firebase", "supabase", "web3modal", "wagmi"):
        assert banned not in src.lower()


def test_frontend_is_pinned_to_studionet_61999():
    cfg = text("lib/config.ts")
    assert "chainId: 61999" in cfg and 'chainIdHex: "0xf22f"' in cfg
    assert "https://studio.genlayer.com/api" in cfg and "https://explorer-studio.genlayer.com" in cfg
    assert not re.search(r"6199[0-8]|studio-dev|bradbury|asimov", cfg, re.I)


def test_every_write_is_reported_only_after_finalization():
    tx = text("components/tx.tsx")
    assert 'status: "FINALIZED"' in text("lib/genlayer.ts")
    assert tx.index("await waitForFinalization(hash)") < tx.index("setState({ phase: \"finalized\", hash })")
    assert "Accepted is not final" in tx


def test_reads_support_finalized_and_pending_views():
    src = text("lib/genlayer.ts")
    assert "LATEST_FINAL" in src and "LATEST_NONFINAL" in src
    assert "A newer assessment exists but is NOT final" in text("app/incident/[key]/page.tsx")


def test_ui_recomputes_action_digest_locally_with_canonical_json():
    digest = text("lib/digest.ts")
    assert "crypto.subtle.digest" in digest and "sortKeys" in digest
    assert "digest-mismatch" in text("components/domain.tsx")


def test_client_validation_mirrors_contract_url_rules():
    policy = text("lib/policy.ts")
    for needle in ("https://", "Dot path segments", "percent-encoding", "canonical"):
        assert needle in policy


def test_red_is_used_only_for_rejection_tone():
    css = text("app/globals.css")
    assert "--color-rejected: #ff5d5d" in css
    policy = text("lib/policy.ts")
    for decision, tone in re.findall(r'(\w+): \{\s*label: "[^"]+", tone: "(\w+)", grants', policy):
        if decision == "TRIGGER_CONFIRMED":
            assert tone == "verified"
        else:
            assert tone == "rejected"


def test_decision_set_matches_the_engine():
    engine = text("contracts/mass_engine.py")
    decisions = re.search(r"DECISIONS = \((.*?)\)", engine, re.S).group(1)
    engine_set = set(re.findall(r'"(\w+)"', decisions))
    ui_block = text("lib/policy.ts").split("export const DECISIONS", 1)[1].split("export const INCIDENT_STATUS", 1)[0]
    ui_set = set(re.findall(r"^  (\w+): \{", ui_block, re.M))
    assert engine_set == ui_set


def test_incident_statuses_match_the_engine():
    engine = text("contracts/mass_engine.py")
    statuses = set(re.findall(r'incident\["status"\] = "(\w+)"', engine)) | {"OPEN"}
    ui_block = text("lib/policy.ts").split("export const INCIDENT_STATUS", 1)[1].split("export const SOURCE_STATE", 1)[0]
    assert statuses == set(re.findall(r"^  (\w+): \{", ui_block, re.M))


def test_no_secrets_or_private_keys_in_repository_sources():
    for path in list(ROOT.glob("lib/*.ts")) + list(ROOT.glob("app/**/*.tsx")) + list(ROOT.glob("scripts/*.mjs")) + list(ROOT.glob("deploy/*.ts")):
        body = path.read_text(encoding="utf-8")
        assert not re.search(r"0x[0-9a-fA-F]{64}['\"]\s*[,;]?\s*//\s*(private|secret)", body, re.I), path
        assert "PRIVATE_KEY" not in body and "privateKey" not in body, path


def test_deploy_script_refuses_other_chains_and_binds_once():
    deploy = text("deploy/deployScript.ts")
    assert "Number(client.chain?.id) !== CHAIN_ID" in deploy and "Refusing" in deploy
    assert deploy.count('"bind_engine"') == 2


def test_public_manifest_is_complete_and_studionet_only():
    manifest = json.loads(text("deployment-manifest.public.json"))
    assert manifest["chainId"] == 61999 and manifest["network"] == "studionet"
    assert set(manifest["contracts"]) == {"charterRegistry", "massEngine", "capabilityGate", "protectedTarget", "evidenceLedger"}
    if manifest.get("status") == "DEPLOYED":
        for name, address in manifest["contracts"].items():
            assert re.fullmatch(r"0x[0-9a-fA-F]{40}", address), name
            src = (ROOT / manifest["sources"][name]["path"]).read_bytes()
            import hashlib
            assert hashlib.sha256(src).hexdigest() == manifest["sources"][name]["sha256"], f"{name} drifted from deployed bytes"


def test_ci_runs_every_gate():
    ci = text(".github/workflows/ci.yml")
    for step in ("toolchain:check", "contracts:check", "test:unit", "test:direct", "typecheck", "build", "test:e2e"):
        assert step in ci
    assert "health:check" in text(".github/workflows/health.yml")
