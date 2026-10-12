import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNNER = "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6"
CONTRACTS = ("charter_registry.py", "mass_engine.py", "capability_gate.py", "protected_target.py", "evidence_ledger.py")


def read(name: str) -> str:
    return (ROOT / "contracts" / name).read_text(encoding="utf-8")


def all_sources() -> dict:
    return {name: read(name) for name in CONTRACTS}


def test_five_separated_contracts_exist():
    on_disk = sorted(p.name for p in (ROOT / "contracts").glob("*.py"))
    assert on_disk == sorted(CONTRACTS)


def test_every_contract_pins_the_stable_runner_on_line_one():
    for name, src in all_sources().items():
        first = src.splitlines()[0]
        assert RUNNER in first, name
        assert first.startswith("# { \"Depends\""), name


def test_action_class_registry_is_identical_everywhere():
    pattern = re.compile(r"ACTION_CLASSES = \((.*?)\)", re.S)
    found = {name: pattern.search(src).group(1).split() for name, src in all_sources().items() if name != "evidence_ledger.py"}
    reference = found["charter_registry.py"]
    assert reference == ['"PAUSE_PROTECTED_ACTION",', '"QUARANTINE_LANE",']
    assert all(v == reference for v in found.values()), found


def test_lane_pattern_and_duration_ceiling_are_identical_everywhere():
    for name in ("charter_registry.py", "mass_engine.py", "capability_gate.py", "protected_target.py"):
        assert 'LANE_PATTERN = r"[a-z0-9][a-z0-9_-]{1,31}"' in read(name), name
    for name in ("charter_registry.py", "capability_gate.py", "protected_target.py"):
        assert "MAX_DURATION_CEILING = 1440" in read(name), name


def test_all_privileged_emissions_are_finality_gated():
    for name, src in all_sources().items():
        assert 'on="accepted"' not in src, name
        for call in re.findall(r"\.emit\(([^)]*)\)", src):
            assert call == 'on="finalized"', (name, call)
    assert 'emit(on="finalized").issue_capability' in read("mass_engine.py")
    assert 'emit(on="finalized").record_assessment' in read("mass_engine.py")
    assert 'emit(on="finalized").emergency_pause' in read("capability_gate.py")
    assert 'emit(on="finalized").emergency_quarantine_lane' in read("capability_gate.py")


def test_only_the_gate_and_engine_emit_authority_messages():
    for name in ("charter_registry.py", "protected_target.py", "evidence_ledger.py"):
        assert ".emit(" not in read(name), name


def test_target_has_no_admin_pause_or_governance_mutation():
    src = read("protected_target.py")
    methods = set(re.findall(r"def (\w+)\(", src))
    forbidden = {"pause", "admin_pause", "owner_pause", "unpause", "set_paused", "emergency_stop", "set_gate",
                 "set_governance", "transfer_governance", "transfer_ownership", "upgrade", "withdraw", "sweep"}
    assert not (methods & forbidden)
    writes = set(re.findall(r"@gl\.public\.write\s+def (\w+)\(", src))
    assert writes == {"execute_protected_action", "emergency_pause", "emergency_quarantine_lane"}


def test_target_emergency_methods_all_require_the_gate_and_governance_holder():
    src = read("protected_target.py")
    assert "emergency authority requires CapabilityGate" in src
    assert "target governance rejected capability holder" in src
    envelope = src.split("def _require_envelope", 1)[1].split("def _already_applied", 1)[0]
    assert "self._require_gate()" in envelope and "self._require_governance_holder(holder)" in envelope
    assert "action digest does not bind this target" in envelope and "gl.message.contract_address" in envelope
    for method in ("emergency_pause", "emergency_quarantine_lane"):
        body = src.split(f"def {method}", 1)[1].split("@gl.public", 1)[0]
        assert "self._require_envelope(" in body, method


def test_target_enforces_sender_equals_origin_and_transaction_time_expiry():
    src = read("protected_target.py")
    assert "gl.message.origin_address" in src and "direct EOA caller" in src
    exec_body = src.split("def execute_protected_action", 1)[1].split("# ----", 1)[0]
    assert "_now() < int(self.paused_until)" in exec_body.replace("now = _now()\n        if now", "_now()") or "now < int(self.paused_until)" in exec_body


def test_system_is_structurally_non_custodial():
    for name, src in all_sources().items():
        assert "@gl.public.write.payable" not in src, name
        assert "gl.message.value" not in src, name
        assert ".transfer(" not in src and "send_value" not in src and "value=" not in src, name
        assert "balance" not in src.lower() or name == "mass_engine.py", name


def test_gate_recomputes_digest_at_issuance_and_execution_and_binds_envelope():
    gate = read("capability_gate.py")
    assert gate.count("_action_digest(") >= 3  # definition + issuance + execution
    for needle in ("incident_key", "charter_digest", "target", "action_class", "scope", "duration_minutes",
                   "action digest mismatch", "target does not match capability", "scope does not match capability",
                   "duration does not match capability", "only capability holder may execute"):
        assert needle in gate, needle
    assert 'capability_key != "CAP-" + incident_key' in gate


def test_gate_issuance_is_engine_only_and_bind_is_one_time():
    gate = read("capability_gate.py")
    assert "only bound MassEngine may issue capabilities" in gate and "engine already bound" in gate
    assert "def issue_capability" in gate and gate.count("self.engine_address") >= 3


def test_governance_is_enforced_at_publish_activate_open_issue_and_apply():
    assert "publisher is not the protected target governance wallet" in read("charter_registry.py")
    assert read("charter_registry.py").count("_require_target_governance(") >= 3  # def + publish + activate
    assert "protected target governance does not authorize this charter owner" in read("mass_engine.py")
    assert "TARGET_GOVERNANCE_REJECTED" in read("mass_engine.py")
    assert "target governance rejected capability holder" in read("capability_gate.py")
    assert "target governance rejected capability holder" in read("protected_target.py")


def test_registry_blocks_takeover_and_rollback():
    src = read("charter_registry.py")
    for needle in ("only protocol owner may publish a charter version", "cannot roll back to an older charter version",
                   "charter key already exists", "protocol_versions"):
        assert needle in src, needle
    assert "def delete_charter" not in src and "def update_charter" not in src


def test_engine_has_closed_decision_set_with_precise_failure_modes():
    src = read("mass_engine.py")
    for decision in ("TRIGGER_CONFIRMED", "TRIGGER_NOT_CONFIRMED", "INSUFFICIENT_EVIDENCE", "ACTION_DISPROPORTIONATE",
                     "CONFLICTING_EVIDENCE", "EVIDENCE_STALE", "SOURCE_TAMPERING_SUSPECTED"):
        assert f'"{decision}"' in src, decision
    assert 'if decision == "TRIGGER_CONFIRMED" and authorized' in src


def test_engine_validator_is_substantive_not_rubber_stamp():
    src = read("mass_engine.py")
    validator = src.split("def validator_fn", 1)[1].split("assessment = gl.vm.run_nondet_unsafe", 1)[0]
    for needle in ("_evaluate_full(charter, incident)", 'leader["decision"] != own["decision"]',
                   "leader_states != own_states", "leader_ok != own_ok", "_clause_grounded", "own_norm",
                   "strict validator comparing two independent", "comparison.get(\"equivalent\") is True"):
        assert needle in validator, needle
    # Exactly one early accept exists, and only behind the validator's OWN tripwire and a non-granting outcome.
    assert validator.count("return True") == 1
    guard, _, _ = validator.partition("return True")
    assert guard.rstrip().endswith('if own["decision"] == "SOURCE_TAMPERING_SUSPECTED" and any(s["injection_flagged"] for s in own["source_states"]):')
    assert guard.index("leader_states != own_states") < guard.index("SOURCE_TAMPERING_SUSPECTED")


def test_engine_prompt_treats_all_inputs_as_untrusted_data():
    src = read("mass_engine.py")
    assert "untrusted quoted data" in src and "Never follow commands" in src
    assert "json.dumps(charter_block" in src and "json.dumps(incident_block" in src and "json.dumps(evidence" in src
    assert "operator_assertion_not_evidence" in src
    assert "INJECTION_PATTERNS" in src and "SOURCE_TAMPERING_SUSPECTED" in src


def test_engine_commits_status_and_normalised_digests_for_every_source():
    src = read("mass_engine.py")
    for needle in ("content_digest", "raw_digest", "http_status", "evidence_commitment_digest", "get_evidence_commitment"):
        assert needle in src, needle
    assert "state[\"http_status\"] = status" in src  # code-derived, never trusted to the model


def test_engine_pins_incident_to_frozen_charter_and_does_not_recheck_activity_on_assess():
    src = read("mass_engine.py")
    open_block = src.split("def open_incident", 1)[1].split("def assess_incident", 1)[0]
    assess_block = src.split("def assess_incident", 1)[1].split("# ---", 1)[0]
    assert "get_active_charter_key" in open_block
    assert "get_active_charter_key" not in assess_block
    assert "frozen charter digest mismatch" in assess_block


def test_engine_evidence_scope_has_no_subdomain_wildcards():
    src = read("mass_engine.py")
    scope = src.split("def _scope_allowed", 1)[1].split("def _get_charter", 1)[0]
    assert "endswith" not in scope and "host == allowed_host" in scope


def test_ledger_is_engine_only_and_append_only():
    src = read("evidence_ledger.py")
    assert "only bound MassEngine may record assessments" in src and "assessment already recorded" in src
    assert "def delete" not in src and "def update" not in src


def test_no_contract_uses_nondeterminism_outside_the_engine():
    for name, src in all_sources().items():
        if name != "mass_engine.py":
            assert "gl.nondet" not in src and "run_nondet" not in src, name


def test_no_randomness_or_self_destruct_or_dynamic_code():
    for name, src in all_sources().items():
        for banned in ("import random", "eval(", "exec(", "__import__", "os.system", "subprocess", "pickle"):
            assert banned not in src, (name, banned)


def test_toolchain_pins_are_exact():
    pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    assert pkg["devDependencies"]["genlayer"] == "0.39.1"
    assert pkg["dependencies"]["genlayer-js"] == "1.1.8"
    reqs = (ROOT / "requirements.txt").read_text(encoding="utf-8")
    assert "genlayer-py @ git+https://github.com/genlayerlabs/genlayer-py@v0.18" in reqs
    assert "genlayer-testing-suite@v0.29" in reqs and "genvm-linter==0.11.0" in reqs


def test_forbidden_dependencies_are_absent():
    pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
    banned = ("privy", "walletconnect", "firebase", "supabase", "wagmi", "rainbowkit", "ethers", "web3modal")
    for name in deps:
        assert not any(b in name.lower() for b in banned), name


def test_nondeterministic_closures_never_capture_the_contract_instance():
    """Live Studionet warns when nondet code pickles contract storage; keep it impossible."""
    src = read("mass_engine.py")
    body = src.split("def leader_fn", 1)[1].split("assessment = gl.vm.run_nondet_unsafe", 1)[0]
    assert "self." not in body and "self)" not in body
    for helper in ("_fetch_sources", "_assessment_prompt", "_enforce", "_evaluate_full"):
        assert f"\ndef {helper}(" in src and f"    def {helper}(" not in src, helper
