"""Shared Direct Mode helpers: address conversion and a fake chain that answers
cross-contract views and records emitted (PostMessage) calls."""


def hx(account) -> str:
    """Lower-case 0x address for a Direct Mode account (bytes) or string."""
    if isinstance(account, str):
        return account.lower()
    if hasattr(account, "as_hex"):
        return account.as_hex.lower()
    from genlayer_py.types import CalldataAddress

    return CalldataAddress(account).as_hex.lower()


class Chain:
    """views[address_hex][method] -> value or callable(calldata) -> value."""

    def __init__(self, vm):
        self.vm = vm
        self.views = {}
        self.posts = []
        self.calls = []
        vm._gl_call_hook = self._hook

    def set_view(self, address, method, value):
        self.views.setdefault(hx(address), {})[method] = value

    def _hook(self, vm, request):
        from genlayer.py import calldata

        if "CallContract" in request:
            call = request["CallContract"]
            address = hx(call["address"])
            method = call["calldata"]["method"]
            self.calls.append((address, method))
            responder = self.views.get(address, {}).get(method)
            if responder is None:
                raise AssertionError(f"unexpected view call {method} on {address}")
            value = responder(call["calldata"]) if callable(responder) else responder
            return b"\x00" + calldata.encode(value)
        if "PostMessage" in request:
            self.posts.append(request["PostMessage"])
            return b"\x00" + calldata.encode(None)
        return None

    def posted_methods(self):
        return [post.get("calldata", {}).get("method") for post in self.posts]


def sha256_json(payload) -> str:
    import hashlib
    import json

    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def action_digest(incident_key, charter_digest, target, action_class="PAUSE_PROTECTED_ACTION", scope="*", minutes=30) -> str:
    return sha256_json(
        {
            "incident_key": incident_key,
            "charter_digest": charter_digest,
            "target": hx(target),
            "action_class": action_class,
            "scope": scope,
            "duration_minutes": int(minutes),
        }
    )


CHARTER_DIGEST = "b" * 64
ASSESSMENT_DIGEST = "c" * 64


def deadline(vm, seconds: int = 600) -> int:
    """An authority deadline `seconds` after the Direct Mode VM's current clock."""
    from datetime import datetime

    return int(datetime.fromisoformat(str(vm._datetime).replace("Z", "+00:00")).timestamp()) + seconds
