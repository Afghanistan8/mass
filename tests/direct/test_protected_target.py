import json

from tests.direct.helpers import CHARTER_DIGEST, action_digest, deadline, hx


def deploy_target(vm, deploy, governance, gate):
    vm.sender = governance
    vm.origin = governance
    return deploy("contracts/protected_target.py", hx(gate))


def pause(target, vm, gate, governance, minutes=30, cap="CAP-INC-0001", inc="INC-0001", digest=None, holder=None):
    vm.sender = gate
    digest = digest or action_digest(inc, CHARTER_DIGEST, target.address, minutes=minutes)
    return target.emergency_pause(minutes, inc, CHARTER_DIGEST, cap, digest, holder or hx(governance), deadline(vm))


def test_only_gate_can_apply_emergency_methods(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    target = deploy_target(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.sender = direct_alice  # even governance has no direct path
    digest = action_digest("INC-0001", CHARTER_DIGEST, target.address)
    with direct_vm.expect_revert("emergency authority requires CapabilityGate"):
        target.emergency_pause(30, "INC-0001", CHARTER_DIGEST, "CAP-INC-0001", digest, hx(direct_alice), deadline(direct_vm))
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("emergency authority requires CapabilityGate"):
        target.emergency_quarantine_lane("swaps", 30, "INC-0001", CHARTER_DIGEST, "CAP-INC-0001", digest, hx(direct_alice), deadline(direct_vm))


def test_no_admin_pause_surface_exists(direct_vm, direct_deploy, direct_alice, direct_bob):
    target = deploy_target(direct_vm, direct_deploy, direct_alice, direct_bob)
    for name in ("pause", "admin_pause", "owner_pause", "set_paused", "unpause", "emergency_stop", "set_gate", "transfer_governance"):
        assert not hasattr(target, name), name


def test_governance_isolation_rejects_unauthorized_holder(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    target = deploy_target(direct_vm, direct_deploy, direct_alice, direct_bob)
    with direct_vm.expect_revert("target governance rejected capability holder"):
        pause(target, direct_vm, direct_bob, direct_alice, holder=hx(direct_charlie))
    assert json.loads(target.get_status_json())["paused"] is False


def test_gate_pause_applies_and_blocks_protected_actions(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.warp("2026-09-27T20:00:00Z")
    target = deploy_target(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.sender = direct_alice
    assert int(target.execute_protected_action("swaps", "ACTION-01")) == 1
    pause(target, direct_vm, direct_bob, direct_alice)
    status = json.loads(target.get_status_json())
    assert status["paused"] is True and status["applied_capability_count"] == 1
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("protected action is temporarily paused"):
        target.execute_protected_action("swaps", "ACTION-02")


def test_pause_expires_at_transaction_time_without_keeper(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.warp("2026-09-27T20:00:00Z")
    target = deploy_target(direct_vm, direct_deploy, direct_alice, direct_bob)
    pause(target, direct_vm, direct_bob, direct_alice, minutes=30)
    direct_vm.sender = direct_alice
    direct_vm.warp("2026-09-27T20:29:59Z")
    with direct_vm.expect_revert("protected action is temporarily paused"):
        target.execute_protected_action("swaps", "ACTION-EARLY")
    direct_vm.warp("2026-09-27T20:30:01Z")
    assert int(target.execute_protected_action("swaps", "ACTION-LATE")) == 1
    assert json.loads(target.get_status_json())["paused"] is False


def test_digest_must_bind_this_target(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    target = deploy_target(direct_vm, direct_deploy, direct_alice, direct_bob)
    foreign = action_digest("INC-0001", CHARTER_DIGEST, direct_charlie)  # minted for another target
    with direct_vm.expect_revert("action digest does not bind this target"):
        pause(target, direct_vm, direct_bob, direct_alice, digest=foreign)
    wrong_duration = action_digest("INC-0001", CHARTER_DIGEST, target.address, minutes=31)
    with direct_vm.expect_revert("action digest does not bind this target"):
        pause(target, direct_vm, direct_bob, direct_alice, minutes=30, digest=wrong_duration)


def test_capability_replay_is_idempotent_and_cannot_rebind(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.warp("2026-09-27T20:00:00Z")
    target = deploy_target(direct_vm, direct_deploy, direct_alice, direct_bob)
    first = pause(target, direct_vm, direct_bob, direct_alice)
    direct_vm.warp("2026-09-27T20:10:00Z")
    second = pause(target, direct_vm, direct_bob, direct_alice)
    assert first == second  # replay does not extend the pause
    assert len(target.list_emergency_history()) == 1
    other = action_digest("INC-0001", CHARTER_DIGEST, target.address, minutes=45)
    with direct_vm.expect_revert("capability key is already bound to a different action"):
        pause(target, direct_vm, direct_bob, direct_alice, minutes=45, digest=other)


def test_duration_bounds(direct_vm, direct_deploy, direct_alice, direct_bob):
    target = deploy_target(direct_vm, direct_deploy, direct_alice, direct_bob)
    for minutes in (0, 1441):
        with direct_vm.expect_revert("invalid emergency duration"):
            pause(target, direct_vm, direct_bob, direct_alice, minutes=minutes)


def test_lane_quarantine_blocks_only_that_lane(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.warp("2026-09-27T20:00:00Z")
    target = deploy_target(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.sender = direct_bob
    digest = action_digest("INC-0002", CHARTER_DIGEST, target.address, "QUARANTINE_LANE", "bridge", 20)
    target.emergency_quarantine_lane("bridge", 20, "INC-0002", CHARTER_DIGEST, "CAP-INC-0002", digest, hx(direct_alice), deadline(direct_vm))
    direct_vm.sender = direct_alice
    direct_vm.origin = direct_alice
    with direct_vm.expect_revert("lane is temporarily quarantined"):
        target.execute_protected_action("bridge", "ACTION-B1")
    assert int(target.execute_protected_action("swaps", "ACTION-S1")) == 1
    assert target.is_lane_open("bridge") is False and target.is_lane_open("swaps") is True
    direct_vm.warp("2026-09-27T20:21:00Z")
    assert target.is_lane_open("bridge") is True


def test_lane_scope_is_digest_bound(direct_vm, direct_deploy, direct_alice, direct_bob):
    target = deploy_target(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.sender = direct_bob
    digest = action_digest("INC-0002", CHARTER_DIGEST, target.address, "QUARANTINE_LANE", "bridge", 20)
    with direct_vm.expect_revert("action digest does not bind this target"):
        target.emergency_quarantine_lane("swaps", 20, "INC-0002", CHARTER_DIGEST, "CAP-INC-0002", digest, hx(direct_alice), deadline(direct_vm))
    with direct_vm.expect_revert("invalid lane identifier"):
        target.emergency_quarantine_lane("Bad Lane", 20, "INC-0002", CHARTER_DIGEST, "CAP-INC-0002", digest, hx(direct_alice), deadline(direct_vm))


def test_replayed_protected_action_key_is_rejected(direct_vm, direct_deploy, direct_alice, direct_bob):
    target = deploy_target(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.sender = direct_alice
    target.execute_protected_action("swaps", "ACTION-REPLAY")
    with direct_vm.expect_revert("protected action already executed"):
        target.execute_protected_action("swaps", "ACTION-REPLAY")
    assert int(target.get_status_json() and json.loads(target.get_status_json())["action_count"]) == 1


def test_protected_action_requires_direct_eoa(direct_vm, direct_deploy, direct_alice, direct_bob):
    target = deploy_target(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.sender = direct_bob
    direct_vm.origin = direct_alice
    with direct_vm.expect_revert("protected actions require a direct EOA caller"):
        target.execute_protected_action("swaps", "ACTION-CHILD")


def test_protected_action_input_validation(direct_vm, direct_deploy, direct_alice, direct_bob):
    target = deploy_target(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("invalid lane identifier"):
        target.execute_protected_action("NOT A LANE", "ACTION-1")
    with direct_vm.expect_revert("invalid protected action key"):
        target.execute_protected_action("swaps", "   ")


def test_deployer_is_immutable_governance(direct_vm, direct_deploy, direct_alice, direct_bob):
    target = deploy_target(direct_vm, direct_deploy, direct_alice, direct_bob)
    assert target.get_governance_address() == hx(direct_alice)
    assert target.get_gate_address() == hx(direct_bob)
