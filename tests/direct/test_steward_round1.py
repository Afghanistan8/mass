"""Steward review, round 1. Each test reproduces one requested change; all were written to fail on the code the
steward reviewed (commit f803e80) and pass after the fix.

1. Bounded recovery: no dispatch, re-dispatch or application after the capability's authority deadline.
2. Source equivalence: an authority-granting decision requires every validator to see the same evidence version.
3. Completeness: a source the model could not read in full can never support a trigger.
"""
import json

from tests.direct.helpers import CHARTER_DIGEST, Chain, action_digest, hx
from tests.direct.test_capability_gate import TARGET, issue, make
from tests.direct.test_mass_engine import (
    PAGE, QUOTE, URL, arm, assessment, frozen_engine, ok_state, record,
)

T0 = "2026-09-27T20:00:00Z"


def _dispatch(gate, vm, holder, key="CAP-INC-0001", minutes=30):
    vm.sender = holder
    return gate.execute_capability(key, TARGET, "PAUSE_PROTECTED_ACTION", "*", minutes)


# ----------------------------------------------------------------------------- 1. bounded recovery (gate)
def test_recovery_redispatch_after_the_authority_deadline_is_rejected(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.warp(T0)
    gate, chain = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    issue(gate, direct_vm, direct_bob, direct_alice, ttl=600)
    chain.set_view(TARGET, "get_applied_capability_digest", "")  # delivery never applied
    _dispatch(gate, direct_vm, direct_alice)
    direct_vm.warp("2026-09-27T20:10:01Z")
    with direct_vm.expect_revert("capability expired: renewed emergency authorization is required"):
        _dispatch(gate, direct_vm, direct_alice)
    assert len(chain.posts) == 1, "no second message may leave the gate after the deadline"


def test_recovery_within_the_window_is_allowed_but_bounded(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.warp(T0)
    gate, chain = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    issue(gate, direct_vm, direct_bob, direct_alice, ttl=1800)
    chain.set_view(TARGET, "get_applied_capability_digest", "")
    for minute in ("20:01:00", "20:02:00", "20:03:00"):
        direct_vm.warp(f"2026-09-27T{minute}Z")
        _dispatch(gate, direct_vm, direct_alice)
    with direct_vm.expect_revert("dispatch retry limit reached: renewed emergency authorization is required"):
        _dispatch(gate, direct_vm, direct_alice)
    record_ = json.loads(gate.get_capability_json("CAP-INC-0001"))
    assert record_["dispatch_count"] == 3 and record_["max_dispatches"] == 3
    digests = {post["calldata"]["args"][4] for post in chain.posts}
    assert digests == {record_["action_digest"]}, "every recovery carries the exact authorized digest"


def test_every_dispatch_carries_the_authority_deadline_to_the_target(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.warp(T0)
    gate, chain = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    issue(gate, direct_vm, direct_bob, direct_alice, ttl=900)
    _dispatch(gate, direct_vm, direct_alice)
    expires_at = json.loads(gate.get_capability_json("CAP-INC-0001"))["expires_at"]
    post = chain.posts[0]
    assert post["on"] == "finalized"
    assert post["calldata"]["method"] == "emergency_pause"
    assert post["calldata"]["args"][-1] == expires_at


def test_unapplied_capability_becomes_expired_and_stays_expired(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.warp(T0)
    gate, chain = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    issue(gate, direct_vm, direct_bob, direct_alice, ttl=600)
    chain.set_view(TARGET, "get_applied_capability_digest", "")
    _dispatch(gate, direct_vm, direct_alice)
    direct_vm.warp("2026-09-27T20:10:01Z")
    # The view already reports the truth before anyone reconciles.
    assert json.loads(gate.get_capability_json("CAP-INC-0001"))["dispatch_status"] == "EXPIRED"
    direct_vm.sender = direct_alice
    assert gate.reconcile_capability("CAP-INC-0001") == "EXPIRED"
    with direct_vm.expect_revert("capability expired: renewed emergency authorization is required"):
        _dispatch(gate, direct_vm, direct_alice)


def test_an_issued_capability_that_was_never_used_expires_too(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.warp(T0)
    gate, _ = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    issue(gate, direct_vm, direct_bob, direct_alice, ttl=600)
    direct_vm.warp("2026-09-27T20:10:01Z")
    direct_vm.sender = direct_alice
    assert gate.reconcile_capability("CAP-INC-0001") == "EXPIRED"
    assert json.loads(gate.get_capability_json("CAP-INC-0001"))["dispatch_status"] == "EXPIRED"


def test_a_capability_applied_inside_its_window_is_reported_applied_after_it(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.warp(T0)
    gate, chain = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    issue(gate, direct_vm, direct_bob, direct_alice, ttl=600)
    _dispatch(gate, direct_vm, direct_alice)
    chain.set_view(TARGET, "get_applied_capability_digest", action_digest("INC-0001", CHARTER_DIGEST, TARGET, minutes=30))
    direct_vm.warp("2026-09-27T20:30:00Z")
    direct_vm.sender = direct_alice
    assert gate.reconcile_capability("CAP-INC-0001") == "APPLIED"
    with direct_vm.expect_revert("capability already applied"):
        _dispatch(gate, direct_vm, direct_alice)


# ---------------------------------------------------------------------------- 1. bounded recovery (target)
def _target(vm, deploy, governance, gate):
    vm.sender = governance
    vm.origin = governance
    return deploy("contracts/protected_target.py", hx(gate))


def _pause(target, vm, gate, governance, valid_until, minutes=30, cap="CAP-INC-0001"):
    vm.sender = gate
    digest = action_digest("INC-0001", CHARTER_DIGEST, target.address, minutes=minutes)
    return target.emergency_pause(minutes, "INC-0001", CHARTER_DIGEST, cap, digest, hx(governance), valid_until)


def _epoch(iso: str) -> int:
    from datetime import datetime
    return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp())


def test_a_delayed_delivery_after_the_deadline_is_rejected_by_the_target(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.warp("2026-09-27T20:10:05Z")  # delivered 5s after the authority deadline
    target = _target(direct_vm, direct_deploy, direct_alice, direct_bob)
    with direct_vm.expect_revert("capability authority window has expired"):
        _pause(target, direct_vm, direct_bob, direct_alice, valid_until=_epoch("2026-09-27T20:10:00Z"))
    status = json.loads(target.get_status_json())
    assert status["paused"] is False and status["applied_capability_count"] == 0
    assert target.get_applied_capability_digest("CAP-INC-0001") == ""


def test_delivery_inside_the_deadline_applies(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.warp("2026-09-27T20:09:59Z")
    target = _target(direct_vm, direct_deploy, direct_alice, direct_bob)
    _pause(target, direct_vm, direct_bob, direct_alice, valid_until=_epoch("2026-09-27T20:10:00Z"))
    entry = json.loads(target.list_emergency_history()[0])
    assert json.loads(target.get_status_json())["paused"] is True
    assert entry["valid_until"] == _epoch("2026-09-27T20:10:00Z")


def test_target_refuses_a_deadline_beyond_the_maximum_lifetime(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.warp(T0)
    target = _target(direct_vm, direct_deploy, direct_alice, direct_bob)
    with direct_vm.expect_revert("authority deadline exceeds the maximum capability lifetime"):
        _pause(target, direct_vm, direct_bob, direct_alice, valid_until=_epoch(T0) + 7201)


def test_replaying_an_applied_capability_after_its_deadline_changes_nothing(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.warp(T0)
    target = _target(direct_vm, direct_deploy, direct_alice, direct_bob)
    deadline = _epoch(T0) + 600
    first = _pause(target, direct_vm, direct_bob, direct_alice, valid_until=deadline)
    direct_vm.warp("2026-09-27T20:20:00Z")  # past the deadline, pause still running
    assert _pause(target, direct_vm, direct_bob, direct_alice, valid_until=deadline) == first
    assert len(target.list_emergency_history()) == 1
    assert json.loads(target.get_status_json())["paused_until"] == first


def test_lane_quarantine_is_also_bound_by_the_deadline(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.warp("2026-09-27T20:10:05Z")
    target = _target(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.sender = direct_bob
    digest = action_digest("INC-0002", CHARTER_DIGEST, target.address, "QUARANTINE_LANE", "bridge", 20)
    with direct_vm.expect_revert("capability authority window has expired"):
        target.emergency_quarantine_lane("bridge", 20, "INC-0002", CHARTER_DIGEST, "CAP-INC-0002", digest, hx(direct_alice), _epoch("2026-09-27T20:10:00Z"))
    assert target.is_lane_open("bridge") is True


# ----------------------------------------------------------------------- 2. source equivalence (validator)
WITHDRAWN = PAGE.replace("</body>", "<p>UPDATE 21:40 UTC: this advisory is withdrawn; the activity was an authorised drill.</p></body>")
MARKUP_ONLY = PAGE.replace("<h1>", '<h1 class="title" data-build="7731"><!-- cache: hit -->')


def test_validator_rejects_authority_when_its_evidence_version_differs(direct_vm, direct_deploy, direct_alice):
    engine, _, _ = frozen_engine(direct_vm, direct_deploy, direct_alice, assessment())
    engine.assess_incident("INC-ENGINE-01")
    # The validator's fetch still contains the leader's quote, its model agrees, and the free-text check says
    # "equivalent" -- but it is a materially different document. That must not support the same authority.
    arm(direct_vm, assessment(), body=WITHDRAWN, equivalent=True)
    assert direct_vm.run_validator() is False


def test_validator_accepts_markup_only_differences(direct_vm, direct_deploy, direct_alice):
    engine, _, _ = frozen_engine(direct_vm, direct_deploy, direct_alice, assessment())
    engine.assess_incident("INC-ENGINE-01")
    arm(direct_vm, assessment(), body=MARKUP_ONLY, equivalent=True)
    assert direct_vm.run_validator() is True


def test_a_forged_leader_digest_is_rejected(direct_vm, direct_deploy, direct_alice):
    engine, _, _ = frozen_engine(direct_vm, direct_deploy, direct_alice, assessment())
    engine.assess_incident("INC-ENGINE-01")
    forged = assessment(states=[{**ok_state(), "content_digest": "e" * 64, "complete": True, "text_chars": 60}])
    assert direct_vm.run_validator(leader_result=forged) is False


# ------------------------------------------------------------------------- 3. completeness of model input
FILLER = "Routine telemetry line without findings. " * 150
# The decision-critical qualification sits in the middle, exactly where the old 3000+3000 excerpt omitted text.
LONG = PAGE.replace("</body>", "<p>" + FILLER + "</p><p>Correction: no funds moved; the alert was a false positive.</p><p>" + FILLER + "</p></body>")


def test_a_source_the_model_cannot_read_in_full_cannot_support_a_trigger(direct_vm, direct_deploy, direct_alice):
    engine, chain, _ = frozen_engine(direct_vm, direct_deploy, direct_alice, assessment(), body=LONG)
    result = engine.assess_incident("INC-ENGINE-01")
    state = result["source_states"][0]
    assert state["complete"] is False and state["text_chars"] > 10_000
    assert state["state"] != "SUPPORTS_TRIGGER"
    assert result["decision"] == "INSUFFICIENT_EVIDENCE"
    assert "issue_capability" not in chain.posted_methods()


def test_a_source_read_in_full_is_recorded_as_complete(direct_vm, direct_deploy, direct_alice):
    engine, _, _ = frozen_engine(direct_vm, direct_deploy, direct_alice, assessment())
    result = engine.assess_incident("INC-ENGINE-01")
    state = result["source_states"][0]
    assert state["complete"] is True and 0 < state["text_chars"] <= 10_000
    assert result["decision"] == "TRIGGER_CONFIRMED"
    commitments = json.loads(record(engine)["assessment_json"])["source_states"]
    assert commitments[0]["complete"] is True
