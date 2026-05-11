"""
HMAC-signed action IDs for two-phase voice write tools.

Workflow:
  - preview() returns sign_action(tool, args, user_id) as the action_id
  - confirm(action_id) calls verify_action() then consume_action()
  - Replay is prevented via an in-memory consumed-set (cleared at restart)
  - 60-second TTL prevents stale tokens

IMPORTANT: The signed payload includes the FULL args (not just a hash) so
that confirm_action can re-derive what to execute without needing a
separate store. HMAC integrity protects the whole payload.

The HMAC secret is env-configurable; falls back to a per-process random key
if missing. Production should set VOICE_ACTION_SECRET.
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
import time


TTL_SECONDS = 60


_FALLBACK_SECRET = secrets.token_bytes(32)
_CONSUMED: set[str] = set()


def _secret() -> bytes:
    s = os.environ.get("VOICE_ACTION_SECRET")
    if s:
        return s.encode("utf-8")
    return _FALLBACK_SECRET


class ActionInvalid(Exception):
    """The signature is malformed or doesn't match."""


class ActionExpired(Exception):
    """The action_id is past its TTL."""


class ActionReplayed(Exception):
    """The action_id was already consumed."""


def _hash_args(args: dict) -> str:
    canonical = json.dumps(args or {}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def sign_action(*, tool: str, args: dict, user_id: str) -> str:
    """Return a base64-encoded action_id of the form: base64(payload).hex(hmac)"""
    payload = {
        "tool": tool,
        "args_hash": _hash_args(args),
        "args": args or {},
        "user_id": user_id,
        "exp_ts": time.time() + TTL_SECONDS,
        "nonce": secrets.token_hex(8),
    }
    payload_b = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    payload_b64 = base64.urlsafe_b64encode(payload_b).decode("ascii")
    sig = hmac.new(_secret(), payload_b64.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}"


def verify_action(action_id: str) -> dict:
    """Verify signature + TTL. Returns decoded payload. Raises on issues."""
    if not action_id or "." not in action_id:
        raise ActionInvalid("malformed action_id")
    payload_b64, sig = action_id.rsplit(".", 1)
    expected = hmac.new(_secret(), payload_b64.encode("ascii"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        raise ActionInvalid("signature mismatch")
    try:
        payload = json.loads(base64.urlsafe_b64decode(payload_b64.encode("ascii")))
    except Exception:
        raise ActionInvalid("malformed payload")
    if time.time() > float(payload.get("exp_ts", 0)):
        raise ActionExpired("action expired")
    return payload


def consume_action(action_id: str) -> dict:
    """Verify and mark consumed. Raises ActionReplayed if already used."""
    payload = verify_action(action_id)
    if action_id in _CONSUMED:
        raise ActionReplayed("action already used")
    _CONSUMED.add(action_id)
    if len(_CONSUMED) > 10000:
        sample = list(_CONSUMED)[:5000]
        for s in sample:
            _CONSUMED.discard(s)
    return payload
