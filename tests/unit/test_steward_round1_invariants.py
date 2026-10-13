"""Source-level guards for the changes requested in steward review round 1 (behaviour is in tests/direct)."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(name: str) -> str:
    return (ROOT / "contracts" / name).read_text(encoding="utf-8")


# 1. Bounded recovery ------------------------------------------------------------------------------------------------
def test_gate_has_one_hard_deadline_and_a_retry_cap():
    gate = read("capability_gate.py")
    assert "MAX_DISPATCHES = 3" in gate
    execute = gate.split("def execute_capability", 1)[1].split("def reconcile_capability", 1)[0]
    assert "self._effective_status(record, capability_key)" in execute
    assert "raise gl.vm.UserError(EXPIRED_MESSAGE)" in execute
    assert "raise gl.vm.UserError(RETRY_LIMIT_MESSAGE)" in execute
    # the pre-review loophole: expiry checked only for ISSUED
    assert 'if status == "ISSUED" and _now() > int(record["expires_at"])' not in gate
    effective = gate.split("def _effective_status", 1)[1].split("def _applied_on_target", 1)[0]
    assert 'return "APPLIED"' in effective and 'return "EXPIRED"' in effective
    assert effective.index('return "APPLIED"') < effective.index('return "EXPIRED"'), "applied inside the window must win"


def test_every_dispatch_hands_the_deadline_to_the_target():
    gate = read("capability_gate.py")
    emits = re.findall(r"emit\(on=\"finalized\"\)\.(emergency_\w+)\((.*?)\n            \)", gate, re.S)
    assert {name for name, _ in emits} == {"emergency_pause", "emergency_quarantine_lane"}
    for name, args in emits:
        assert args.strip().endswith("valid_until,"), name
    assert 'valid_until = int(record["expires_at"])' in gate


def test_target_enforces_the_deadline_after_idempotency_and_within_the_max_lifetime():
    target = read("protected_target.py")
    assert "MAX_CAPABILITY_LIFETIME_SECONDS = 7200" in target
    gate = read("capability_gate.py")
    assert "ttl_seconds > 7200" in gate, "target lifetime bound must equal the gate's longest TTL"
    for method in ("def emergency_pause", "def emergency_quarantine_lane"):
        body = target.split(method, 1)[1].split("@gl.public", 1)[0]
        assert "valid_until: int," in body, method
        assert body.index("self._already_applied(") < body.index("self._require_authority_window(valid_until)"), method


# 2. Source equivalence ----------------------------------------------------------------------------------------------
def test_validator_requires_identical_normalized_fingerprints_for_authority():
    engine = read("mass_engine.py")
    validator = engine.split("def validator_fn", 1)[1].split("assessment = gl.vm.run_nondet_unsafe", 1)[0]
    confirmed = validator.split('if leader["decision"] == "TRIGGER_CONFIRMED":', 1)[1]
    assert 's["content_digest"] != mine.get("content_digest")' in confirmed
    assert 's["complete"] is not True or mine.get("complete") is not True' in confirmed
    # the fingerprint is computed in code from the fetched bytes, never taken from the model
    assert 'hashlib.sha256(norm.encode("utf-8")).hexdigest()' in engine
    assert 'state["content_digest"] = str(src.get("content_digest", ""))' in engine


# 3. Completeness of what the model reads ----------------------------------------------------------------------------
def test_no_source_is_silently_excerpted():
    engine = read("mass_engine.py")
    assert "MAX_PROMPT_EXCERPT" not in engine and "[...omitted...]" not in engine
    assert "MAX_MODEL_TEXT_CHARS = 10_000" in engine
    enforce = engine.split("def _enforce", 1)[1].split("def _evaluate_full", 1)[0]
    assert 'if not state["complete"] and state["state"] == "SUPPORTS_TRIGGER":' in enforce
    assert "if unread:" in enforce
    commitments = engine.split("commitments = [", 1)[1].split("for s in assessment", 1)[0]
    assert '"complete": s["complete"]' in commitments and '"text_chars": s["text_chars"]' in commitments
