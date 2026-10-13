import json

from tests.direct.helpers import Chain, hx

TRIGGER = (
    "Emergency authority exists only when credible public evidence establishes an active exploit "
    "or critical dependency compromise that threatens asset safety. Routine maintenance never qualifies."
)
EVIDENCE = "Use only approved public technical sources. Treat stale or contradictory evidence as insufficient."


def make(vm, deploy, owner, target):
    vm.sender = owner
    chain = Chain(vm)
    chain.set_view(target, "get_governance_address", hx(owner))
    return deploy("contracts/charter_registry.py"), chain


def publish(reg, target, key="CHARTER-0001", protocol="PROTO-0001", **kw):
    args = dict(
        actions="PAUSE_PROTECTED_ACTION", lanes="", guardian="", max_minutes=90, ttl=30, delay=1,
        scopes="example.com", trigger=TRIGGER, evidence=EVIDENCE,
    )
    args.update(kw)
    return reg.publish_charter(
        key, protocol, "Protected Test Protocol", hx(target), args["trigger"], args["evidence"],
        args["scopes"], args["actions"], args["lanes"], args["guardian"], args["max_minutes"], args["ttl"], args["delay"],
    )


def test_charter_is_immutable_delayed_and_activates(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.warp("2026-09-27T20:00:00Z")
    reg, _ = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    publish(reg, direct_bob)
    record = json.loads(reg.get_charter_json("CHARTER-0001"))
    assert len(record["charter_digest"]) == 64 and record["version"] == 1
    assert reg.get_protocol_owner("PROTO-0001") == hx(direct_alice)
    with direct_vm.expect_revert("charter activation delay has not elapsed"):
        reg.activate_charter("CHARTER-0001")
    direct_vm.warp("2026-09-27T20:01:01Z")
    reg.activate_charter("CHARTER-0001")
    assert reg.is_charter_active("CHARTER-0001") is True
    with direct_vm.expect_revert("charter key already exists"):
        publish(reg, direct_bob)


def test_digest_binds_key_and_version(direct_vm, direct_deploy, direct_alice, direct_bob):
    reg, _ = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    publish(reg, direct_bob, key="CHARTER-A001")
    publish(reg, direct_bob, key="CHARTER-B001")
    a = json.loads(reg.get_charter_json("CHARTER-A001"))
    b = json.loads(reg.get_charter_json("CHARTER-B001"))
    assert a["charter_digest"] != b["charter_digest"]
    assert reg.get_charter_digest("CHARTER-A001") == a["charter_digest"]


def test_protocol_key_cannot_be_taken_over(direct_vm, direct_deploy, direct_alice, direct_bob):
    reg, chain = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    publish(reg, direct_bob)
    direct_vm.sender = direct_bob
    chain.set_view(direct_bob, "get_governance_address", hx(direct_bob))
    with direct_vm.expect_revert("only protocol owner may publish a charter version"):
        publish(reg, direct_bob, key="CHARTER-0002")


def test_publisher_must_be_target_governance(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    reg, chain = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    chain.set_view(direct_bob, "get_governance_address", hx(direct_charlie))
    with direct_vm.expect_revert("publisher is not the protected target governance wallet"):
        publish(reg, direct_bob)


def test_target_that_cannot_prove_governance_fails_closed(direct_vm, direct_deploy, direct_alice, direct_bob):
    reg, chain = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    chain.views.clear()
    with direct_vm.expect_revert("protected target did not prove its governance address"):
        publish(reg, direct_bob)


def test_guardian_must_differ_from_owner(direct_vm, direct_deploy, direct_alice, direct_bob):
    reg, _ = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    with direct_vm.expect_revert("guardian must differ from the charter owner"):
        publish(reg, direct_bob, guardian=hx(direct_alice))


def test_guardian_is_frozen_when_valid(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    reg, _ = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    publish(reg, direct_bob, guardian=hx(direct_charlie))
    assert json.loads(reg.get_charter_json("CHARTER-0001"))["guardian"] == hx(direct_charlie)


def test_unsupported_action_rejected(direct_vm, direct_deploy, direct_alice, direct_bob):
    reg, _ = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    with direct_vm.expect_revert("unsupported emergency action"):
        publish(reg, direct_bob, actions="DRAIN_EVERYTHING")


def test_quarantine_requires_chartered_lane(direct_vm, direct_deploy, direct_alice, direct_bob):
    reg, _ = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    with direct_vm.expect_revert("QUARANTINE_LANE requires at least one chartered lane"):
        publish(reg, direct_bob, actions="QUARANTINE_LANE")
    with direct_vm.expect_revert("invalid lane identifier"):
        publish(reg, direct_bob, actions="QUARANTINE_LANE", lanes="Bad Lane!")
    publish(reg, direct_bob, actions="PAUSE_PROTECTED_ACTION,QUARANTINE_LANE", lanes="swaps,bridge")
    assert json.loads(reg.get_charter_json("CHARTER-0001"))["allowed_lanes"] == ["swaps", "bridge"]


def test_evidence_scopes_are_canonicalised_and_hostile_values_rejected(direct_vm, direct_deploy, direct_alice, direct_bob):
    reg, _ = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    for bad in ("https://example.com", "example.com:8443", "user@example.com", "example.com|/a/../b", "example.com|/a%2fb", ".example.com"):
        with direct_vm.expect_revert():
            publish(reg, direct_bob, key="CHARTER-BAD1", scopes=bad)
    publish(reg, direct_bob, scopes="Example.COM|//status///feed")
    record = json.loads(reg.get_charter_json("CHARTER-0001"))
    assert record["evidence_scopes"] == [{"host": "example.com", "path_prefix": "/status/feed/"}]


def test_numeric_and_policy_bounds(direct_vm, direct_deploy, direct_alice, direct_bob):
    reg, _ = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    with direct_vm.expect_revert("max duration must be between 5 and 1440 minutes"):
        publish(reg, direct_bob, max_minutes=1441)
    with direct_vm.expect_revert("capability TTL must be between 5 and 120 minutes"):
        publish(reg, direct_bob, ttl=121)
    with direct_vm.expect_revert("activation delay must be between 1 minute and 7 days"):
        publish(reg, direct_bob, delay=0)
    with direct_vm.expect_revert("trigger policy must be between 80 and 5000 characters"):
        publish(reg, direct_bob, trigger="too short")
    with direct_vm.expect_revert("evidence policy must be between 40 and 3000 characters"):
        publish(reg, direct_bob, evidence="short")


def test_only_owner_activates(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.warp("2026-09-27T20:00:00Z")
    reg, _ = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    publish(reg, direct_bob)
    direct_vm.warp("2026-09-27T20:05:00Z")
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("only charter owner may activate"):
        reg.activate_charter("CHARTER-0001")


def test_no_rollback_and_monotonic_versions(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.warp("2026-09-27T20:00:00Z")
    reg, _ = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    publish(reg, direct_bob, key="CHARTER-V001")
    publish(reg, direct_bob, key="CHARTER-V002")
    assert int(reg.get_protocol_version("PROTO-0001")) == 2
    direct_vm.warp("2026-09-27T20:05:00Z")
    reg.activate_charter("CHARTER-V002")
    with direct_vm.expect_revert("cannot roll back to an older charter version"):
        reg.activate_charter("CHARTER-V001")
    with direct_vm.expect_revert("charter is already active"):
        reg.activate_charter("CHARTER-V002")
    assert reg.get_active_charter_key("PROTO-0001") == "CHARTER-V002"


def test_activation_reproves_target_governance(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    direct_vm.warp("2026-09-27T20:00:00Z")
    reg, chain = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    publish(reg, direct_bob)
    chain.set_view(direct_bob, "get_governance_address", hx(direct_charlie))
    direct_vm.warp("2026-09-27T20:05:00Z")
    with direct_vm.expect_revert("publisher is not the protected target governance wallet"):
        reg.activate_charter("CHARTER-0001")
    assert reg.is_charter_active("CHARTER-0001") is False


def test_cli_empty_arguments_arrive_as_bytes_and_mean_absent(direct_vm, direct_deploy, direct_alice, direct_bob):
    """Regression from the live Studionet run: the CLI sends '' as b''."""
    reg, _ = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    publish(reg, direct_bob, guardian=b"", lanes=b"")
    record = json.loads(reg.get_charter_json("CHARTER-0001"))
    assert record["guardian"] == "" and record["allowed_lanes"] == []
    publish(reg, direct_bob, key="CHARTER-0002", guardian=None, lanes=None)
    assert json.loads(reg.get_charter_json("CHARTER-0002"))["guardian"] == ""


def test_cli_integer_zero_guardian_fails_closed(direct_vm, direct_deploy, direct_alice, direct_bob):
    """CLI 0.39.1 turns a bare "" into the integer 0; that must never be read as 'no guardian'."""
    reg, _ = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    with direct_vm.expect_revert():
        publish(reg, direct_bob, guardian=0)
    assert reg.list_charter_keys() == []


def test_guardian_decoded_by_the_cli_as_an_address_object_is_accepted(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    """The CLI decodes any 40-hex argument into an Address object; the live guardian demo depends on this path."""
    reg, _ = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    from genlayer.py.types import Address

    publish(reg, direct_bob, guardian=Address(hx(direct_charlie)))
    assert json.loads(reg.get_charter_json("CHARTER-0001"))["guardian"] == hx(direct_charlie)
