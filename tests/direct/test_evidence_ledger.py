import json

from tests.direct.helpers import ASSESSMENT_DIGEST, CHARTER_DIGEST, hx

COMMIT = "d" * 64


def make(vm, deploy, alice, bob):
    vm.sender = alice
    ledger = deploy("contracts/evidence_ledger.py")
    ledger.bind_engine(hx(bob))
    return ledger


def record(ledger, vm, engine, attempt=1, incident="INC-0001", commit=COMMIT):
    vm.sender = engine
    return ledger.record_assessment(
        incident, attempt, CHARTER_DIGEST, "TRIGGER_CONFIRMED", ASSESSMENT_DIGEST, commit, "summary",
        json.dumps([{"url": "https://example.com/a", "http_status": 200, "content_digest": COMMIT}]),
    )


def test_only_bound_engine_can_record(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    ledger = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    with direct_vm.expect_revert("only bound MassEngine may record assessments"):
        record(ledger, direct_vm, direct_charlie)
    assert record(ledger, direct_vm, direct_bob) == "INC-0001#1"


def test_bind_is_one_time_and_deployer_only(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    direct_vm.sender = direct_alice
    ledger = direct_deploy("contracts/evidence_ledger.py")
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("only deployer may bind engine"):
        ledger.bind_engine(hx(direct_bob))
    direct_vm.sender = direct_alice
    ledger.bind_engine(hx(direct_bob))
    with direct_vm.expect_revert("engine already bound"):
        ledger.bind_engine(hx(direct_charlie))


def test_records_are_append_only_and_queryable(direct_vm, direct_deploy, direct_alice, direct_bob):
    ledger = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    record(ledger, direct_vm, direct_bob, attempt=1)
    with direct_vm.expect_revert("assessment already recorded"):
        record(ledger, direct_vm, direct_bob, attempt=1)
    record(ledger, direct_vm, direct_bob, attempt=2, commit="e" * 64)
    assert ledger.list_record_keys() == ["INC-0001#1", "INC-0001#2"]
    latest = json.loads(ledger.get_latest_record_json("INC-0001"))
    assert latest["attempt"] == 2 and latest["evidence_commitment_digest"] == "e" * 64
    assert ledger.verify_commitment("INC-0001", "e" * 64) is True
    assert ledger.verify_commitment("INC-0001", COMMIT) is False
    assert ledger.verify_commitment("INC-NONE", COMMIT) is False


def test_malformed_digests_rejected(direct_vm, direct_deploy, direct_alice, direct_bob):
    ledger = make(direct_vm, direct_deploy, direct_alice, direct_bob)
    with direct_vm.expect_revert("invalid evidence commitment digest"):
        record(ledger, direct_vm, direct_bob, commit="not-a-digest")
