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
# The gate's longest possible capability TTL. A deadline further out than this is refused outright.
MAX_CAPABILITY_LIFETIME_SECONDS = 7200


def _now() -> int:
    return int(datetime.now(timezone.utc).timestamp())


def _address_hex(value) -> str:
    if hasattr(value, "as_hex"):
        return value.as_hex.lower()
    return Address(value).as_hex.lower()


def _digest(payload: dict) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


class ProtectedTarget(gl.Contract):
    """Non-custodial protected-action surface.

    There is deliberately NO admin, owner or governance pause method. The only
    way to restrict this contract is a CapabilityGate message that carries a
    finalized, digest-bound capability whose holder is this contract's
    governance wallet. The contract holds no user value and makes no payouts,
    so there is no stranded-value failure mode under GenVM's value-transfer
    semantics.
    """

    gate_address: str
    governance_address: str
    paused_until: u256
    lane_paused_until: TreeMap[str, u256]
    lane_keys: DynArray[str]
    action_count: u256
    action_records: TreeMap[str, str]
    action_keys: DynArray[str]
    last_action_json: str
    applied_digests: TreeMap[str, str]
    applied_until: TreeMap[str, u256]
    emergency_history: DynArray[str]

    def __init__(self, gate_address: str):
        self.gate_address = _address_hex(gate_address)
        # The deployment wallet is the target's immutable governance wallet.
        self.governance_address = _address_hex(gl.message.sender_address)
        self.paused_until = u256(0)
        self.action_count = u256(0)
        self.last_action_json = ""

    # ---------------------------------------------------------------- guards
    def _require_gate(self) -> None:
        if _address_hex(gl.message.sender_address) != self.gate_address:
            raise gl.vm.UserError("emergency authority requires CapabilityGate")

    def _require_governance_holder(self, holder: str) -> None:
        if _address_hex(holder) != self.governance_address:
            raise gl.vm.UserError("target governance rejected capability holder")

    def _require_direct_user(self) -> str:
        sender = _address_hex(gl.message.sender_address)
        origin = _address_hex(gl.message.origin_address)
        if sender != origin:
            raise gl.vm.UserError("protected actions require a direct EOA caller")
        return sender

    def _require_envelope(
        self,
        incident_key: str,
        charter_digest: str,
        action_class: str,
        scope: str,
        duration_minutes: int,
        action_digest: str,
        holder: str,
    ) -> None:
        self._require_gate()
        self._require_governance_holder(holder)
        if action_class not in ACTION_CLASSES:
            raise gl.vm.UserError("unsupported action class")
        if duration_minutes < 1 or duration_minutes > MAX_DURATION_CEILING:
            raise gl.vm.UserError("invalid emergency duration")
        # Digest is recomputed here against THIS contract's own address, so a
        # capability minted for another target can never be applied.
        expected = _digest(
            {
                "incident_key": incident_key,
                "charter_digest": charter_digest,
                "target": _address_hex(gl.message.contract_address),
                "action_class": action_class,
                "scope": scope,
                "duration_minutes": int(duration_minutes),
            }
        )
        if expected != action_digest:
            raise gl.vm.UserError("action digest does not bind this target")

    def _require_authority_window(self, valid_until: int) -> None:
        # Delivery is asynchronous (emit on finalized). A message that arrives after the capability's authority
        # deadline must not take effect, however it got delayed.
        now = _now()
        deadline = int(valid_until)
        if now > deadline:
            raise gl.vm.UserError("capability authority window has expired")
        if deadline - now > MAX_CAPABILITY_LIFETIME_SECONDS:
            raise gl.vm.UserError("authority deadline exceeds the maximum capability lifetime")

    def _already_applied(self, capability_key: str, action_digest: str) -> bool:
        existing = self.applied_digests.get(capability_key, "")
        if not existing:
            return False
        if existing != action_digest:
            raise gl.vm.UserError("capability key is already bound to a different action")
        return True

    def _record(self, action_class, scope, duration_minutes, incident_key, capability_key, action_digest, until_ts, valid_until) -> None:
        encoded = json.dumps(
            {
                "action_class": action_class,
                "scope": scope,
                "duration_minutes": int(duration_minutes),
                "incident_key": incident_key,
                "capability_key": capability_key,
                "action_digest": action_digest,
                "executed_at": _now(),
                "effective_until": int(until_ts),
                "valid_until": int(valid_until),
            },
            sort_keys=True,
        )
        self.emergency_history.append(encoded)
        self.applied_digests[capability_key] = action_digest
        self.applied_until[capability_key] = u256(until_ts)

    # ----------------------------------------------------- protected surface
    @gl.public.write
    def execute_protected_action(self, lane: str, action_key: str) -> u256:
        """A normal, non-custodial protected operation in a named lane.

        Rejected at transaction time while the target or the lane is paused.
        The pause check uses the block time of THIS transaction, so expiry
        needs no keeper and no unpause call.
        """
        lane = str(lane).strip().lower()
        if not re.fullmatch(LANE_PATTERN, lane):
            raise gl.vm.UserError("invalid lane identifier")
        now = _now()
        if now < int(self.paused_until):
            raise gl.vm.UserError("protected action is temporarily paused")
        if now < int(self.lane_paused_until.get(lane, u256(0))):
            raise gl.vm.UserError("lane is temporarily quarantined")
        holder = self._require_direct_user()
        key = str(action_key).strip()
        if not key or len(key) > 128:
            raise gl.vm.UserError("invalid protected action key")
        if self.action_records.get(key, ""):
            raise gl.vm.UserError("protected action already executed")

        next_count = self.action_count + u256(1)
        encoded = json.dumps(
            {"action_key": key, "lane": lane, "holder": holder, "executed_at": now, "sequence": str(next_count)},
            sort_keys=True,
        )
        self.action_records[key] = encoded
        self.action_keys.append(key)
        self.last_action_json = encoded
        self.action_count = next_count
        return next_count

    # ---------------------------------------------- emergency (gate-only)
    @gl.public.write
    def emergency_pause(
        self,
        duration_minutes: int,
        incident_key: str,
        charter_digest: str,
        capability_key: str,
        action_digest: str,
        holder: str,
        valid_until: int,
    ) -> int:
        self._require_envelope(
            incident_key, charter_digest, "PAUSE_PROTECTED_ACTION", "*", duration_minutes, action_digest, holder
        )
        # A replay of an applied capability is a no-op (no extension, no new history), even after the deadline.
        if self._already_applied(capability_key, action_digest):
            return int(self.applied_until.get(capability_key, u256(0)))
        self._require_authority_window(valid_until)
        until_ts = _now() + int(duration_minutes) * 60
        if until_ts > int(self.paused_until):
            self.paused_until = u256(until_ts)
        self._record("PAUSE_PROTECTED_ACTION", "*", duration_minutes, incident_key, capability_key, action_digest, until_ts, valid_until)
        return until_ts

    @gl.public.write
    def emergency_quarantine_lane(
        self,
        lane: str,
        duration_minutes: int,
        incident_key: str,
        charter_digest: str,
        capability_key: str,
        action_digest: str,
        holder: str,
        valid_until: int,
    ) -> int:
        if not re.fullmatch(LANE_PATTERN, str(lane)):
            raise gl.vm.UserError("invalid lane identifier")
        self._require_envelope(
            incident_key, charter_digest, "QUARANTINE_LANE", lane, duration_minutes, action_digest, holder
        )
        if self._already_applied(capability_key, action_digest):
            return int(self.applied_until.get(capability_key, u256(0)))
        self._require_authority_window(valid_until)
        until_ts = _now() + int(duration_minutes) * 60
        if lane not in self.lane_paused_until:
            self.lane_keys.append(lane)
        if until_ts > int(self.lane_paused_until.get(lane, u256(0))):
            self.lane_paused_until[lane] = u256(until_ts)
        self._record("QUARANTINE_LANE", lane, duration_minutes, incident_key, capability_key, action_digest, until_ts, valid_until)
        return until_ts

    # ------------------------------------------------------------------ views
    @gl.public.view
    def get_status_json(self) -> str:
        now = _now()
        lanes = {}
        for i in range(len(self.lane_keys)):
            lane = self.lane_keys[i]
            until = int(self.lane_paused_until.get(lane, u256(0)))
            lanes[lane] = {"quarantined": now < until, "until": until}
        return json.dumps(
            {
                "gate_address": self.gate_address,
                "governance_address": self.governance_address,
                "action_count": str(self.action_count),
                "paused": now < int(self.paused_until),
                "paused_until": int(self.paused_until),
                "lanes": lanes,
                "last_action_json": self.last_action_json,
                "applied_capability_count": len(self.emergency_history),
            },
            sort_keys=True,
        )

    @gl.public.view
    def get_action_json(self, action_key: str) -> str:
        return self.action_records.get(action_key, "")

    @gl.public.view
    def list_action_keys(self) -> list:
        return [self.action_keys[i] for i in range(len(self.action_keys))]

    @gl.public.view
    def list_emergency_history(self) -> list:
        return [self.emergency_history[i] for i in range(len(self.emergency_history))]

    @gl.public.view
    def get_applied_capability_digest(self, capability_key: str) -> str:
        return self.applied_digests.get(capability_key, "")

    @gl.public.view
    def get_governance_address(self) -> str:
        return self.governance_address

    @gl.public.view
    def get_gate_address(self) -> str:
        return self.gate_address

    @gl.public.view
    def is_lane_open(self, lane: str) -> bool:
        now = _now()
        return now >= int(self.paused_until) and now >= int(self.lane_paused_until.get(str(lane).lower(), u256(0)))
