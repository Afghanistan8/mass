# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import hashlib
import json
import re
from datetime import datetime, timezone
from genlayer import *


ACTION_CLASSES = (
    "PAUSE_PROTECTED_ACTION",
    "QUARANTINE_LANE",
)

MAX_DURATION_CEILING = 1440
LANE_PATTERN = r"[a-z0-9][a-z0-9_-]{1,31}"


def _now() -> int:
    return int(datetime.now(timezone.utc).timestamp())


def _address_hex(value) -> str:
    if hasattr(value, "as_hex"):
        return value.as_hex.lower()
    return Address(value).as_hex.lower()


def _digest(payload: dict) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _action_digest(incident_key, charter_digest, target, action_class, scope, duration_minutes) -> str:
    return _digest(
        {
            "incident_key": incident_key,
            "charter_digest": charter_digest,
            "target": _address_hex(target),
            "action_class": action_class,
            "scope": scope,
            "duration_minutes": int(duration_minutes),
        }
    )


class CapabilityGate(gl.Contract):
    deployer: str
    engine_address: str
    capabilities: TreeMap[str, str]
    capability_keys: DynArray[str]
    capability_by_incident: TreeMap[str, str]

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

    def _load(self, capability_key: str) -> dict:
        raw = self.capabilities.get(capability_key, "")
        if not raw:
            raise gl.vm.UserError("capability not found")
        return json.loads(raw)

    def _applied_on_target(self, record: dict, capability_key: str) -> bool:
        try:
            protected = gl.get_contract_at(Address(str(record["target"])))
            applied = protected.view().get_applied_capability_digest(capability_key)
        except Exception:
            return False
        return str(applied) == str(record.get("action_digest", ""))

    # ------------------------------------------------------------- issuance
    @gl.public.write
    def issue_capability(
        self,
        capability_key: str,
        incident_key: str,
        holder: str,
        guardian: str,
        target: str,
        action_class: str,
        scope: str,
        duration_minutes: int,
        action_digest: str,
        charter_digest: str,
        assessment_digest: str,
        ttl_seconds: int,
    ) -> str:
        # Reaching this method at all means the engine's assessment message was
        # delivered on="finalized". Anything else is refused here.
        if not self.engine_address or _address_hex(gl.message.sender_address) != self.engine_address:
            raise gl.vm.UserError("only bound MassEngine may issue capabilities")
        if capability_key != "CAP-" + incident_key:
            raise gl.vm.UserError("capability key must derive from the incident key")
        if capability_key in self.capabilities or incident_key in self.capability_by_incident:
            raise gl.vm.UserError("capability already exists")
        if action_class not in ACTION_CLASSES:
            raise gl.vm.UserError("unsupported action class")
        if action_class == "PAUSE_PROTECTED_ACTION" and scope != "*":
            raise gl.vm.UserError("pause scope must be *")
        if action_class == "QUARANTINE_LANE" and not re.fullmatch(LANE_PATTERN, scope):
            raise gl.vm.UserError("invalid lane scope")
        if duration_minutes < 1 or duration_minutes > MAX_DURATION_CEILING:
            raise gl.vm.UserError("invalid duration")
        if ttl_seconds < 300 or ttl_seconds > 7200:
            raise gl.vm.UserError("invalid capability TTL")
        for label, value in (("action digest", action_digest), ("charter digest", charter_digest), ("assessment digest", assessment_digest)):
            if not re.fullmatch(r"[0-9a-f]{64}", str(value)):
                raise gl.vm.UserError(f"invalid {label}")

        target_hex = _address_hex(target)
        holder_hex = _address_hex(holder)
        if isinstance(guardian, (bytes, bytearray)):
            guardian = bytes(guardian).decode("utf-8", errors="replace")
        guardian_hex = _address_hex(guardian) if str(guardian or "").strip() else ""
        if guardian_hex and guardian_hex == holder_hex:
            raise gl.vm.UserError("guardian must differ from holder")
        if _action_digest(incident_key, charter_digest, target_hex, action_class, scope, duration_minutes) != action_digest:
            raise gl.vm.UserError("action digest mismatch")

        # Governance check #2 (engine checked #1; the target checks #3).
        try:
            governance = _address_hex(gl.get_contract_at(Address(target_hex)).view().get_governance_address())
        except Exception:
            raise gl.vm.UserError("target did not prove its governance address")
        if governance != holder_hex:
            raise gl.vm.UserError("target governance rejected capability holder")

        issued_at = _now()
        record = {
            "capability_key": capability_key,
            "incident_key": incident_key,
            "holder": holder_hex,
            "guardian": guardian_hex,
            "guardian_approved": False,
            "target": target_hex,
            "action_class": action_class,
            "scope": scope,
            "duration_minutes": int(duration_minutes),
            "action_digest": action_digest,
            "charter_digest": charter_digest,
            "assessment_digest": assessment_digest,
            "issuer": self.engine_address,
            "issued_at": issued_at,
            "expires_at": issued_at + int(ttl_seconds),
            "dispatch_status": "ISSUED",
            "dispatch_count": 0,
            "consumed": False,
            "consumed_at": 0,
        }
        self.capabilities[capability_key] = json.dumps(record, sort_keys=True)
        self.capability_keys.append(capability_key)
        self.capability_by_incident[incident_key] = capability_key
        return capability_key

    # ------------------------------------------------------------ guardian
    @gl.public.write
    def approve_capability(self, capability_key: str) -> str:
        record = self._load(capability_key)
        if not record.get("guardian"):
            raise gl.vm.UserError("capability has no guardian")
        if _address_hex(gl.message.sender_address) != str(record["guardian"]):
            raise gl.vm.UserError("only the guardian may approve")
        if record.get("guardian_approved"):
            raise gl.vm.UserError("guardian already approved")
        if str(record["dispatch_status"]) != "ISSUED" or _now() > int(record["expires_at"]):
            raise gl.vm.UserError("capability is no longer approvable")
        record["guardian_approved"] = True
        record["guardian_approved_at"] = _now()
        self.capabilities[capability_key] = json.dumps(record, sort_keys=True)
        return "APPROVED"

    # ----------------------------------------------------------- execution
    @gl.public.write
    def execute_capability(
        self,
        capability_key: str,
        target: str,
        action_class: str,
        scope: str,
        duration_minutes: int,
    ) -> str:
        record = self._load(capability_key)
        if _address_hex(gl.message.sender_address) != str(record["holder"]):
            raise gl.vm.UserError("only capability holder may execute")
        status = str(record.get("dispatch_status", "ISSUED"))
        if status == "APPLIED":
            raise gl.vm.UserError("capability already applied")
        if status == "DISPATCHED" and self._applied_on_target(record, capability_key):
            raise gl.vm.UserError("capability already applied")
        # Expiry gates only the first dispatch; recovery re-dispatch can never
        # change the bound action because the envelope is re-verified below.
        if status == "ISSUED" and _now() > int(record["expires_at"]):
            raise gl.vm.UserError("capability expired")
        if record.get("guardian") and not record.get("guardian_approved"):
            raise gl.vm.UserError("guardian approval required")

        target_hex = _address_hex(target)
        if target_hex != str(record["target"]):
            raise gl.vm.UserError("target does not match capability")
        if action_class != str(record["action_class"]):
            raise gl.vm.UserError("action does not match capability")
        if str(scope) != str(record["scope"]):
            raise gl.vm.UserError("scope does not match capability")
        if int(duration_minutes) != int(record["duration_minutes"]):
            raise gl.vm.UserError("duration does not match capability")
        recomputed = _action_digest(
            str(record["incident_key"]), str(record["charter_digest"]), target_hex, action_class, str(scope), int(duration_minutes)
        )
        if recomputed != str(record["action_digest"]):
            raise gl.vm.UserError("action digest mismatch")

        record["dispatch_status"] = "DISPATCHED"
        record["dispatch_count"] = int(record.get("dispatch_count", 0)) + 1
        record["dispatched_at"] = record.get("dispatched_at") or _now()
        self.capabilities[capability_key] = json.dumps(record, sort_keys=True)

        protected = gl.get_contract_at(Address(target_hex))
        if action_class == "PAUSE_PROTECTED_ACTION":
            protected.emit(on="finalized").emergency_pause(
                int(duration_minutes),
                str(record["incident_key"]),
                str(record["charter_digest"]),
                capability_key,
                str(record["action_digest"]),
                str(record["holder"]),
            )
        elif action_class == "QUARANTINE_LANE":
            protected.emit(on="finalized").emergency_quarantine_lane(
                str(scope),
                int(duration_minutes),
                str(record["incident_key"]),
                str(record["charter_digest"]),
                capability_key,
                str(record["action_digest"]),
                str(record["holder"]),
            )
        else:
            raise gl.vm.UserError("unsupported action class")
        return action_class

    @gl.public.write
    def reconcile_capability(self, capability_key: str) -> str:
        record = self._load(capability_key)
        if _address_hex(gl.message.sender_address) != str(record["holder"]):
            raise gl.vm.UserError("only capability holder may reconcile")
        status = str(record.get("dispatch_status", "ISSUED"))
        if status != "DISPATCHED":
            return status
        if self._applied_on_target(record, capability_key):
            record["dispatch_status"] = "APPLIED"
            record["consumed"] = True
            record["consumed_at"] = _now()
            self.capabilities[capability_key] = json.dumps(record, sort_keys=True)
            return "APPLIED"
        return "DISPATCHED"

    # --------------------------------------------------------------- views
    @gl.public.view
    def get_capability_json(self, capability_key: str) -> str:
        raw = self.capabilities.get(capability_key, "")
        if not raw:
            return ""
        record = json.loads(raw)
        if record.get("dispatch_status") == "DISPATCHED" and self._applied_on_target(record, capability_key):
            record["dispatch_status"] = "APPLIED"
            record["consumed"] = True
        return json.dumps(record, sort_keys=True)

    @gl.public.view
    def get_capability_for_incident(self, incident_key: str) -> str:
        return self.capability_by_incident.get(incident_key, "")

    @gl.public.view
    def list_capability_keys(self) -> list:
        return [self.capability_keys[i] for i in range(len(self.capability_keys))]

    @gl.public.view
    def get_engine_address(self) -> str:
        return self.engine_address
