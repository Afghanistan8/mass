import json

from tests.direct.helpers import ASSESSMENT_DIGEST, CHARTER_DIGEST, Chain, action_digest, hx

# alice = governance/holder, bob = engine, charlie = guardian, target = a fixed fake target address
TARGET = "0x" + "77" * 20


def make(vm, deploy, alice, bob, governance=None):
    vm.sender = alice
    chain = Chain(vm)
    chain.set_view(TARGET, "get_governance_address", governance or hx(alice))
    gate = deploy("contracts/capability_gate.py")
    gate.bind_engine(hx(bob))
    return gate, chain


def issue(gate, vm, engine, holder, guardian="", minutes=30, incident="INC-0001", ttl=1800, **kw):
    vm.sender = engine
    cls = kw.get("action_class", "PAUSE_PROTECTED_ACTION")
    scope = kw.get("scope", "*")
    digest = kw.get("digest") or action_digest(incident, CHARTER_DIGEST, TARGET, cls, scope, minutes)
    return gate.issue_capability(
        kw.get("key", "CAP-" + incident), incident, hx(holder), guardian, TARGET, cls, scope, minutes, digest,
        CHARTER_DIGEST, ASSESSMENT_DIGEST, ttl,
    )


def test_only_bound_engine_can_issue(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    gate, _ = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    with direct_vm.expect_revert("only bound MassEngine may issue capabilities"):
        issue(gate, direct_vm, direct_charlie, direct_alice)
    issue(gate, direct_vm, direct_bob, direct_alice)
    record = json.loads(gate.get_capability_json("CAP-INC-0001"))
    assert record["holder"] == hx(direct_alice) and record["issuer"] == hx(direct_bob)
    assert record["consumed"] is False and record["dispatch_status"] == "ISSUED"


def test_engine_binding_is_one_time_and_deployer_only(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    direct_vm.sender = direct_alice
    gate = direct_deploy("contracts/capability_gate.py")
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("only deployer may bind engine"):
        gate.bind_engine(hx(direct_bob))
    direct_vm.sender = direct_alice
    gate.bind_engine(hx(direct_bob))
    with direct_vm.expect_revert("engine already bound"):
        gate.bind_engine(hx(direct_charlie))


def test_issuance_before_bind_is_impossible(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    gate = direct_deploy("contracts/capability_gate.py")
    with direct_vm.expect_revert("only bound MassEngine may issue capabilities"):
        issue(gate, direct_vm, direct_bob, direct_alice)


def test_issuance_recomputes_and_rejects_forged_digest(direct_vm, direct_deploy, direct_alice, direct_bob):
    gate, _ = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    with direct_vm.expect_revert("action digest mismatch"):
        issue(gate, direct_vm, direct_bob, direct_alice, digest="a" * 64)
    with direct_vm.expect_revert("action digest mismatch"):
        issue(gate, direct_vm, direct_bob, direct_alice, minutes=30, digest=action_digest("INC-0001", CHARTER_DIGEST, TARGET, minutes=31))


def test_issuance_double_checks_target_governance(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    gate, chain = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    chain.set_view(TARGET, "get_governance_address", hx(direct_charlie))
    with direct_vm.expect_revert("target governance rejected capability holder"):
        issue(gate, direct_vm, direct_bob, direct_alice)
    chain.views.clear()
    with direct_vm.expect_revert("target did not prove its governance address"):
        issue(gate, direct_vm, direct_bob, direct_alice)


def test_capability_key_must_derive_from_incident_and_be_unique(direct_vm, direct_deploy, direct_alice, direct_bob):
    gate, _ = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    with direct_vm.expect_revert("capability key must derive from the incident key"):
        issue(gate, direct_vm, direct_bob, direct_alice, key="CAP-OTHER")
    issue(gate, direct_vm, direct_bob, direct_alice)
    with direct_vm.expect_revert("capability already exists"):
        issue(gate, direct_vm, direct_bob, direct_alice)
    assert gate.get_capability_for_incident("INC-0001") == "CAP-INC-0001"


def test_issuance_input_bounds(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    gate, _ = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    with direct_vm.expect_revert("invalid capability TTL"):
        issue(gate, direct_vm, direct_bob, direct_alice, ttl=299)
    with direct_vm.expect_revert("invalid duration"):
        issue(gate, direct_vm, direct_bob, direct_alice, minutes=1441)
    with direct_vm.expect_revert("unsupported action class"):
        issue(gate, direct_vm, direct_bob, direct_alice, action_class="DRAIN")
    with direct_vm.expect_revert("pause scope must be *"):
        issue(gate, direct_vm, direct_bob, direct_alice, scope="swaps")
    with direct_vm.expect_revert("invalid lane scope"):
        issue(gate, direct_vm, direct_bob, direct_alice, action_class="QUARANTINE_LANE", scope="Bad Lane")
    with direct_vm.expect_revert("guardian must differ from holder"):
        issue(gate, direct_vm, direct_bob, direct_alice, guardian=hx(direct_alice))


def test_execution_envelope_rejects_wrong_holder_target_action_scope_duration(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    gate, _ = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    issue(gate, direct_vm, direct_bob, direct_alice)
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("only capability holder may execute"):
        gate.execute_capability("CAP-INC-0001", TARGET, "PAUSE_PROTECTED_ACTION", "*", 30)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("target does not match capability"):
        gate.execute_capability("CAP-INC-0001", hx(direct_charlie), "PAUSE_PROTECTED_ACTION", "*", 30)
    with direct_vm.expect_revert("action does not match capability"):
        gate.execute_capability("CAP-INC-0001", TARGET, "QUARANTINE_LANE", "*", 30)
    with direct_vm.expect_revert("scope does not match capability"):
        gate.execute_capability("CAP-INC-0001", TARGET, "PAUSE_PROTECTED_ACTION", "swaps", 30)
    with direct_vm.expect_revert("duration does not match capability"):
        gate.execute_capability("CAP-INC-0001", TARGET, "PAUSE_PROTECTED_ACTION", "*", 29)
    with direct_vm.expect_revert("capability not found"):
        gate.execute_capability("CAP-NOPE", TARGET, "PAUSE_PROTECTED_ACTION", "*", 30)


def test_execute_emits_finalized_message_and_marks_dispatched(direct_vm, direct_deploy, direct_alice, direct_bob):
    gate, chain = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    issue(gate, direct_vm, direct_bob, direct_alice)
    direct_vm.sender = direct_alice
    gate.execute_capability("CAP-INC-0001", TARGET, "PAUSE_PROTECTED_ACTION", "*", 30)
    assert chain.posted_methods() == ["emergency_pause"]
    assert json.loads(gate.get_capability_json("CAP-INC-0001"))["dispatch_status"] == "DISPATCHED"


def test_applied_capability_cannot_be_replayed(direct_vm, direct_deploy, direct_alice, direct_bob):
    gate, chain = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    issue(gate, direct_vm, direct_bob, direct_alice)
    direct_vm.sender = direct_alice
    gate.execute_capability("CAP-INC-0001", TARGET, "PAUSE_PROTECTED_ACTION", "*", 30)
    digest = action_digest("INC-0001", CHARTER_DIGEST, TARGET, minutes=30)
    chain.set_view(TARGET, "get_applied_capability_digest", digest)  # target reports applied
    assert gate.reconcile_capability("CAP-INC-0001") == "APPLIED"
    with direct_vm.expect_revert("capability already applied"):
        gate.execute_capability("CAP-INC-0001", TARGET, "PAUSE_PROTECTED_ACTION", "*", 30)
    assert len(chain.posts) == 1


def test_dispatched_but_unapplied_capability_allows_exact_recovery_only(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.warp("2026-09-27T20:00:00Z")
    gate, chain = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    issue(gate, direct_vm, direct_bob, direct_alice)
    chain.set_view(TARGET, "get_applied_capability_digest", "")
    direct_vm.sender = direct_alice
    gate.execute_capability("CAP-INC-0001", TARGET, "PAUSE_PROTECTED_ACTION", "*", 30)
    direct_vm.warp("2026-09-27T23:00:00Z")  # past expiry: recovery still possible, mutation never
    gate.execute_capability("CAP-INC-0001", TARGET, "PAUSE_PROTECTED_ACTION", "*", 30)
    assert json.loads(gate.get_capability_json("CAP-INC-0001"))["dispatch_count"] == 2
    with direct_vm.expect_revert("duration does not match capability"):
        gate.execute_capability("CAP-INC-0001", TARGET, "PAUSE_PROTECTED_ACTION", "*", 31)
    assert gate.reconcile_capability("CAP-INC-0001") == "DISPATCHED"


def test_expiry_blocks_first_dispatch(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.warp("2026-09-27T20:00:00Z")
    gate, _ = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    issue(gate, direct_vm, direct_bob, direct_alice, ttl=600)
    direct_vm.warp("2026-09-27T20:10:01Z")
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("capability expired"):
        gate.execute_capability("CAP-INC-0001", TARGET, "PAUSE_PROTECTED_ACTION", "*", 30)
    assert gate.reconcile_capability("CAP-INC-0001") == "ISSUED"


def test_guardian_approval_is_required_and_role_separated(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    gate, _ = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    issue(gate, direct_vm, direct_bob, direct_alice, guardian=hx(direct_charlie))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("guardian approval required"):
        gate.execute_capability("CAP-INC-0001", TARGET, "PAUSE_PROTECTED_ACTION", "*", 30)
    with direct_vm.expect_revert("only the guardian may approve"):
        gate.approve_capability("CAP-INC-0001")
    direct_vm.sender = direct_charlie
    assert gate.approve_capability("CAP-INC-0001") == "APPROVED"
    with direct_vm.expect_revert("guardian already approved"):
        gate.approve_capability("CAP-INC-0001")
    direct_vm.sender = direct_alice
    gate.execute_capability("CAP-INC-0001", TARGET, "PAUSE_PROTECTED_ACTION", "*", 30)


def test_guardian_cannot_approve_capability_without_guardian(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    gate, _ = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    issue(gate, direct_vm, direct_bob, direct_alice)
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("capability has no guardian"):
        gate.approve_capability("CAP-INC-0001")


def test_quarantine_dispatch_routes_to_lane_method(direct_vm, direct_deploy, direct_alice, direct_bob):
    gate, chain = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    issue(gate, direct_vm, direct_bob, direct_alice, incident="INC-0009", action_class="QUARANTINE_LANE", scope="bridge", minutes=20)
    direct_vm.sender = direct_alice
    gate.execute_capability("CAP-INC-0009", TARGET, "QUARANTINE_LANE", "bridge", 20)
    assert chain.posted_methods() == ["emergency_quarantine_lane"]


def test_only_holder_may_reconcile(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    gate, _ = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    issue(gate, direct_vm, direct_bob, direct_alice)
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("only capability holder may reconcile"):
        gate.reconcile_capability("CAP-INC-0001")


def test_guardian_empty_bytes_means_no_guardian(direct_vm, direct_deploy, direct_alice, direct_bob):
    gate, _ = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    issue(gate, direct_vm, direct_bob, direct_alice, guardian=b"")
    assert json.loads(gate.get_capability_json("CAP-INC-0001"))["guardian"] == ""
