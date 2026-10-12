# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import hashlib
import json
import re
from datetime import datetime, timezone
from genlayer import *


# Strict action-class registry. The same tuple is mirrored (and source-tested)
# in the engine, the gate and the protected target.
ACTION_CLASSES = (
    "PAUSE_PROTECTED_ACTION",
    "QUARANTINE_LANE",
)

MAX_DURATION_CEILING = 1440
LANE_PATTERN = r"[a-z0-9][a-z0-9_-]{1,31}"


def _now() -> int:
    return int(datetime.now(timezone.utc).timestamp())


def _text(value) -> str:
    # The CLI delivers an empty string argument as b''; browsers send "". Both
    # (and None) mean "absent" for optional arguments.
    if value is None:
        return ""
    if isinstance(value, (bytes, bytearray)):
        return bytes(value).decode("utf-8", errors="replace")
    return str(value)


def _address_hex(value) -> str:
    # The CLI decodes address calldata to Address objects, while Direct Mode
    # supplies strings. Accept both without wrapping an Address twice.
    if hasattr(value, "as_hex"):
        return value.as_hex.lower()
    return Address(value).as_hex.lower()


class CharterRegistry(gl.Contract):
    charters: TreeMap[str, str]
    charter_keys: DynArray[str]
    active_by_protocol: TreeMap[str, str]
    protocol_owners: TreeMap[str, str]
    protocol_versions: TreeMap[str, u256]

    def __init__(self):
        pass

    def _require_key(self, value: str, label: str) -> None:
        if not re.fullmatch(r"[A-Za-z0-9._:-]{4,96}", value):
            raise gl.vm.UserError(f"invalid {label}")

    def _digest(self, payload: dict) -> str:
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()

    def _normalise_host(self, host: str) -> str:
        value = host.strip().lower()
        if (
            not value
            or len(value) > 180
            or "/" in value
            or "://" in value
            or "@" in value
            or ":" in value
            or " " in value
            or value.startswith(".")
            or value.endswith(".")
            or ".." in value
            or not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", value)
        ):
            raise gl.vm.UserError("invalid evidence host")
        return value

    def _normalise_scope(self, raw: str) -> tuple:
        parts = raw.strip().split("|", 1)
        host = self._normalise_host(parts[0])
        prefix = "/"
        if len(parts) == 2:
            prefix = parts[1].strip()
            if (
                not prefix.startswith("/")
                or "\\" in prefix
                or "%" in prefix
                or "." in prefix
                or any(ord(c) < 0x21 or ord(c) == 0x7F for c in prefix)
                or len(prefix) > 240
            ):
                raise gl.vm.UserError("invalid evidence path prefix")
            if "?" in prefix or "#" in prefix:
                raise gl.vm.UserError("evidence path prefix must not contain query or fragment")
            prefix = "/" + "/".join(part for part in prefix.split("/") if part)
            if prefix != "/":
                prefix += "/"
        return host, prefix

    def _require_target_governance(self, target_hex: str, owner: str) -> None:
        # Fail closed: a target that cannot prove its governance wallet, or
        # whose governance wallet is not the publisher, cannot be chartered.
        try:
            target = gl.get_contract_at(Address(target_hex))
            governance = _address_hex(target.view().get_governance_address())
        except Exception:
            raise gl.vm.UserError("protected target did not prove its governance address")
        if governance != owner:
            raise gl.vm.UserError("publisher is not the protected target governance wallet")

    @gl.public.write
    def publish_charter(
        self,
        charter_key: str,
        protocol_key: str,
        protocol_name: str,
        protected_target: str,
        trigger_policy: str,
        evidence_policy: str,
        evidence_scopes_csv: str,
        allowed_actions_csv: str,
        allowed_lanes_csv: str,
        guardian: str,
        max_duration_minutes: int,
        capability_ttl_minutes: int,
        activation_delay_minutes: int,
    ) -> str:
        self._require_key(charter_key, "charter key")
        self._require_key(protocol_key, "protocol key")
        if charter_key in self.charters:
            raise gl.vm.UserError("charter key already exists")

        sender = _address_hex(gl.message.sender_address)
        existing_owner = self.protocol_owners.get(protocol_key, "")
        if existing_owner and existing_owner != sender:
            raise gl.vm.UserError("only protocol owner may publish a charter version")

        protocol_name = protocol_name.strip()
        trigger_policy = trigger_policy.strip()
        evidence_policy = evidence_policy.strip()
        if len(protocol_name) < 2 or len(protocol_name) > 120:
            raise gl.vm.UserError("invalid protocol name")
        if len(trigger_policy) < 80 or len(trigger_policy) > 5000:
            raise gl.vm.UserError("trigger policy must be between 80 and 5000 characters")
        if len(evidence_policy) < 40 or len(evidence_policy) > 3000:
            raise gl.vm.UserError("evidence policy must be between 40 and 3000 characters")
        if max_duration_minutes < 5 or max_duration_minutes > MAX_DURATION_CEILING:
            raise gl.vm.UserError("max duration must be between 5 and 1440 minutes")
        if capability_ttl_minutes < 5 or capability_ttl_minutes > 120:
            raise gl.vm.UserError("capability TTL must be between 5 and 120 minutes")
        if activation_delay_minutes < 1 or activation_delay_minutes > 10080:
            raise gl.vm.UserError("activation delay must be between 1 minute and 7 days")

        target_hex = _address_hex(protected_target)
        self._require_target_governance(target_hex, sender)

        guardian_hex = ""
        guardian = _text(guardian).strip()
        if guardian:
            guardian_hex = _address_hex(guardian)
            if guardian_hex == sender:
                raise gl.vm.UserError("guardian must differ from the charter owner")

        hosts = []
        scopes = []
        for raw in evidence_scopes_csv.split(","):
            raw = raw.strip()
            if raw:
                host, prefix = self._normalise_scope(raw)
                if host not in hosts:
                    hosts.append(host)
                scope = {"host": host, "path_prefix": prefix}
                if scope not in scopes:
                    scopes.append(scope)
        if len(hosts) < 1 or len(hosts) > 8 or len(scopes) > 16:
            raise gl.vm.UserError("provide between 1 and 8 evidence hosts")

        actions = []
        for raw in allowed_actions_csv.split(","):
            action = raw.strip().upper()
            if action:
                if action not in ACTION_CLASSES:
                    raise gl.vm.UserError("unsupported emergency action")
                if action not in actions:
                    actions.append(action)
        if len(actions) < 1:
            raise gl.vm.UserError("at least one emergency action is required")

        lanes = []
        for raw in _text(allowed_lanes_csv).split(","):
            lane = raw.strip().lower()
            if lane:
                if not re.fullmatch(LANE_PATTERN, lane):
                    raise gl.vm.UserError("invalid lane identifier")
                if lane not in lanes:
                    lanes.append(lane)
        if len(lanes) > 8:
            raise gl.vm.UserError("at most 8 lanes may be chartered")
        if "QUARANTINE_LANE" in actions and not lanes:
            raise gl.vm.UserError("QUARANTINE_LANE requires at least one chartered lane")

        if not existing_owner:
            self.protocol_owners[protocol_key] = sender

        published_at = _now()
        version = int(self.protocol_versions.get(protocol_key, u256(0))) + 1
        self.protocol_versions[protocol_key] = u256(version)
        frozen = {
            "charter_key": charter_key,
            "protocol_key": protocol_key,
            "protocol_name": protocol_name,
            "owner": sender,
            "guardian": guardian_hex,
            "protected_target": target_hex,
            "trigger_policy": trigger_policy,
            "evidence_policy": evidence_policy,
            "evidence_hosts": hosts,
            "evidence_scopes": scopes,
            "allowed_actions": actions,
            "allowed_lanes": lanes,
            "max_duration_minutes": int(max_duration_minutes),
            "capability_ttl_minutes": int(capability_ttl_minutes),
            "activation_delay_minutes": int(activation_delay_minutes),
            "published_at": published_at,
            "eligible_at": published_at + int(activation_delay_minutes) * 60,
            "version": version,
        }
        record = dict(frozen)
        record["charter_digest"] = self._digest(frozen)

        self.charters[charter_key] = json.dumps(record, sort_keys=True)
        self.charter_keys.append(charter_key)
        return charter_key

    @gl.public.write
    def activate_charter(self, charter_key: str) -> str:
        raw = self.charters.get(charter_key, "")
        if not raw:
            raise gl.vm.UserError("charter not found")
        charter = json.loads(raw)
        if _address_hex(gl.message.sender_address) != str(charter.get("owner", "")):
            raise gl.vm.UserError("only charter owner may activate")
        if _now() < int(charter.get("eligible_at", 0)):
            raise gl.vm.UserError("charter activation delay has not elapsed")

        protocol_key = str(charter["protocol_key"])
        active_key = self.active_by_protocol.get(protocol_key, "")
        if active_key == charter_key:
            raise gl.vm.UserError("charter is already active")
        if active_key:
            active_raw = self.charters.get(active_key, "")
            if not active_raw:
                raise gl.vm.UserError("active charter record is missing")
            active = json.loads(active_raw)
            if int(charter.get("version", 0)) <= int(active.get("version", 0)):
                raise gl.vm.UserError("cannot roll back to an older charter version")

        # Re-prove target governance at activation: a charter whose target
        # governance moved or vanished during the delay never becomes active.
        self._require_target_governance(str(charter["protected_target"]), str(charter["owner"]))

        self.active_by_protocol[protocol_key] = charter_key
        return charter_key

    @gl.public.view
    def get_charter_json(self, charter_key: str) -> str:
        return self.charters.get(charter_key, "")

    @gl.public.view
    def get_charter_digest(self, charter_key: str) -> str:
        raw = self.charters.get(charter_key, "")
        if not raw:
            return ""
        return str(json.loads(raw).get("charter_digest", ""))

    @gl.public.view
    def get_active_charter_key(self, protocol_key: str) -> str:
        return self.active_by_protocol.get(protocol_key, "")

    @gl.public.view
    def is_charter_active(self, charter_key: str) -> bool:
        raw = self.charters.get(charter_key, "")
        if not raw:
            return False
        charter = json.loads(raw)
        return self.active_by_protocol.get(str(charter["protocol_key"]), "") == charter_key

    @gl.public.view
    def get_protocol_owner(self, protocol_key: str) -> str:
        return self.protocol_owners.get(protocol_key, "")

    @gl.public.view
    def get_protocol_version(self, protocol_key: str) -> u256:
        return self.protocol_versions.get(protocol_key, u256(0))

    @gl.public.view
    def list_charter_keys(self) -> list:
        return [self.charter_keys[i] for i in range(len(self.charter_keys))]
