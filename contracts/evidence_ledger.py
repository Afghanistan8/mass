# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import json
import re
from datetime import datetime, timezone
from genlayer import *


def _now() -> int:
    return int(datetime.now(timezone.utc).timestamp())


def _address_hex(value) -> str:
    if hasattr(value, "as_hex"):
        return value.as_hex.lower()
    return Address(value).as_hex.lower()


class EvidenceLedger(gl.Contract):
    """Queryable, finality-gated provenance of every consensus assessment.

    Only the bound MassEngine can write, and it does so with
    emit(on="finalized"), so a record exists here only for assessments that
    reached FINALIZED. The ledger never grants authority; it is the public
    evidence trail an auditor reads.
    """

    deployer: str
    engine_address: str
    records: TreeMap[str, str]
    record_keys: DynArray[str]
    latest_by_incident: TreeMap[str, str]

    def __init__(self):
        self.deployer = _address_hex(gl.message.sender_address)
        self.engine_address = ""

    @gl.public.write
    def bind_engine(self, engine_address: str) -> str:
        if _address_hex(gl.message.sender_address) != self.deployer:
            raise gl.vm.UserError("only deployer may bind engine")
        if self.engine_address:
            raise gl.vm.UserError("engine already bound")
        self.engine_address = _address_hex(engine_address)
        return self.engine_address

    @gl.public.write
    def record_assessment(
        self,
        incident_key: str,
        attempt: int,
        charter_digest: str,
        decision: str,
        assessment_digest: str,
        evidence_commitment_digest: str,
        summary: str,
        commitments_json: str,
    ) -> str:
        if not self.engine_address or _address_hex(gl.message.sender_address) != self.engine_address:
            raise gl.vm.UserError("only bound MassEngine may record assessments")
        for label, value in (
            ("charter digest", charter_digest),
            ("assessment digest", assessment_digest),
            ("evidence commitment digest", evidence_commitment_digest),
        ):
            if not re.fullmatch(r"[0-9a-f]{64}", str(value)):
                raise gl.vm.UserError(f"invalid {label}")
        key = f"{incident_key}#{int(attempt)}"
        if key in self.records:
            raise gl.vm.UserError("assessment already recorded")
        record = {
            "incident_key": incident_key,
            "attempt": int(attempt),
            "charter_digest": charter_digest,
            "decision": decision,
            "assessment_digest": assessment_digest,
            "evidence_commitment_digest": evidence_commitment_digest,
            "summary": str(summary)[:1600],
            "commitments": json.loads(commitments_json),
            "recorded_at": _now(),
        }
        self.records[key] = json.dumps(record, sort_keys=True)
        self.record_keys.append(key)
        self.latest_by_incident[incident_key] = key
        return key

    @gl.public.view
    def get_record_json(self, record_key: str) -> str:
        return self.records.get(record_key, "")

    @gl.public.view
    def get_latest_record_json(self, incident_key: str) -> str:
        key = self.latest_by_incident.get(incident_key, "")
        return self.records.get(key, "") if key else ""

    @gl.public.view
    def verify_commitment(self, incident_key: str, evidence_commitment_digest: str) -> bool:
        key = self.latest_by_incident.get(incident_key, "")
        if not key:
            return False
        return json.loads(self.records[key]).get("evidence_commitment_digest") == evidence_commitment_digest

    @gl.public.view
    def list_record_keys(self) -> list:
        return [self.record_keys[i] for i in range(len(self.record_keys))]

    @gl.public.view
    def get_engine_address(self) -> str:
        return self.engine_address
