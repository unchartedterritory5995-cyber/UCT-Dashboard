"""flow-worker-side receipt of the Schwab ACCESS token replicated from web.

WEB IS THE SOLE GRANT OWNER AND THE SENDER. flow-worker only receives.

⚰️ EXISTS BECAUSE THE RE-AUTH ONLY EVER REACHED ONE POD. Schwab's OAuth callback can
only land on `web`, and `/data/schwab_token.json` is on a PER-SERVICE Railway volume, so
"I re-authed Schwab" wrote web's copy and nothing else. Measured 2026-11-09: web's token
was 0.0 days old minutes after a successful login while flow-worker's was **113.4 days**
old, failing `invalid_grant` on every cycle and silently riding the Massive OI fallback.
The owner read that as "every deploy needs a manual login", because the login did fix the
pod they were looking at and never fixed the one actually serving the data.

⛔ THE TRANSPORT DIRECTION IS FORCED, NOT PREFERRED. Railway private networking is IPv6
and web starts as `uvicorn --host 0.0.0.0` (IPv4 only), so web is unreachable FROM
flow-worker. `ticker_types_push` already disproved a pull design on deploy. web ->
flow-worker is the path WORKER_INTERNAL_URL and the read proxy already use, so this
mirrors that transport deliberately. The PAYLOAD is its own decision: a fault in the token
push must not be able to break the routing replica or the TOP-10 replica.

⛔⛔ THE REFRESH TOKEN IS NEVER STORED HERE, AND THAT IS THE SAFETY RAIL, NOT AN
OVERSIGHT. `install_pushed_token` strips it unconditionally, so it is not a flag anyone
can get wrong. Two consequences, both wanted:

  1. flow-worker CANNOT refresh, so it cannot invalidate web's grant. Whether Schwab
     rotates the refresh token on each refresh is still unverified (see
     reference_schwab_token_per_pod), and a design that is safe either way beats one that
     needs the answer. Two pods refreshing one grant is how you turn a steady, readable
     failure into a flapping one.
  2. `schwab_service.refresh_access_token()` returns None the moment it sees no refresh
     token, and `_auto_refresh_loop` logs one quiet skip line instead of hammering. That
     is what ends the storm: on 2026-11-09 **215 of 500** flow-worker log lines (43%)
     were `invalid_grant` failures, dozens inside the same second, and that noise is
     exactly what buried the onset minute of the flow.db corruption the same day.

So a pushed token is a 30-minute bearer credential and nothing more. If it goes stale
because web stopped pushing, `get_valid_token()` returns None and callers fall back to
Massive, which is the behaviour flow-worker has had (unknowingly) since 2026-07-19.

⛔ RECEIPT IS SUBORDINATE TO SERVING. Every failure is recorded and swallowed, and no
member request ever triggers or depends on a push.
"""
import json
import logging
import os
import time
from pathlib import Path

log = logging.getLogger(__name__)

# Written to the SAME path schwab_service reads, so every existing consumer
# (oi_snapshots, live_massive_router's side confirm, gex, daily_tracker) picks it up
# with no change at the call sites.
_DATA_DIR = Path("/data")
if _DATA_DIR.exists() and _DATA_DIR.is_dir():
    TOKEN_FILE = _DATA_DIR / "schwab_token.json"
else:
    TOKEN_FILE = Path(os.getenv("SCHWAB_TOKEN_PATH", "/tmp/schwab_token.json"))

# A token document is a few hundred bytes. Anything larger is not one.
_MAX_PUSH_BYTES = int(os.environ.get("SCHWAB_TOKEN_MAX_PUSH_BYTES", "16384"))

# Tolerance for sender/receiver clock skew when judging `saved_at`. Both pods are
# NTP-synced containers, so this is generous.
_MAX_CLOCK_SKEW_SEC = float(os.environ.get("SCHWAB_TOKEN_MAX_SKEW_SEC", "300"))

_STATE = {
    "last_attempt_at": None,
    "last_success_at": None,
    "last_error": None,
    "last_error_at": None,
    "last_result": None,
    "attempts": 0,
    "installs": 0,
    "skipped_already_current": 0,
    "rejected": 0,
}


def receive_enabled() -> bool:
    """Off by default. Distinct from the sender's flag on web."""
    return os.environ.get("SCHWAB_TOKEN_REPLICA_RECEIVE_ENABLED", "0") == "1"


def _local_saved_at() -> float:
    """`saved_at` of the token currently on this pod, or 0.0 if there is none."""
    try:
        if not TOKEN_FILE.exists():
            return 0.0
        doc = json.loads(TOKEN_FILE.read_text())
        return float(doc.get("saved_at") or 0.0)
    except Exception:  # noqa: BLE001
        return 0.0


def _reject(reason: str, code: str = "rejected") -> dict:
    _STATE["rejected"] += 1
    _STATE["last_error"] = reason
    _STATE["last_error_at"] = time.time()
    _STATE["last_result"] = code
    log.warning("[schwab-token-replica] %s", reason)
    return {"status": code, "reason": reason}


def install_pushed_token(payload: dict) -> dict:
    """Validate and atomically install an access token pushed by web.

    ⛔ NEVER RAISES. Returns a small operational dict; never echoes the credential.

    The sender is authenticated but still not trusted on content: a replay of an older
    document, a document already expired on arrival, or one whose `saved_at` is in the
    future is refused BEFORE anything is written. Refusing a downgrade is what keeps a
    retry storm or an out-of-order delivery from walking the pod backwards onto a token
    that is about to die.
    """
    _STATE["attempts"] += 1
    _STATE["last_attempt_at"] = time.time()

    if not isinstance(payload, dict):
        return _reject("payload is not an object")

    access = payload.get("access_token")
    if not isinstance(access, str) or not access.strip():
        return _reject("missing access_token")

    try:
        saved_at = float(payload.get("saved_at"))
    except (TypeError, ValueError):
        return _reject("missing or non-numeric saved_at")

    # ⛔ NOT `payload.get("expires_in") or 1800` — that idiom reads a literal 0 as
    # "absent" and silently substitutes a 30-minute lifetime for a token that declares
    # it has none, so an expired document would install as a fresh one. Found by
    # `test_install_refuses_non_positive_expires_in`.
    raw_expires = payload.get("expires_in")
    if raw_expires is None:
        raw_expires = 1800
    try:
        expires_in = float(raw_expires)
    except (TypeError, ValueError):
        return _reject("non-numeric expires_in")
    if expires_in <= 0:
        return _reject("expires_in must be positive")

    now = time.time()
    if saved_at > now + _MAX_CLOCK_SKEW_SEC:
        return _reject("saved_at is in the future beyond tolerated clock skew")

    # Already dead on arrival. Installing it would overwrite a possibly-usable token
    # with a certainly-useless one.
    remaining = (saved_at + expires_in) - now
    if remaining <= 0:
        return _reject("token already expired on arrival")

    local = _local_saved_at()
    if saved_at < local:
        return _reject("pushed token is older than the installed one")
    if saved_at == local and local > 0:
        _STATE["skipped_already_current"] += 1
        _STATE["last_success_at"] = now
        _STATE["last_result"] = "already-current"
        _STATE["last_error"] = None
        return {"status": "already-current", "saved_at": saved_at,
                "expires_in_sec": round(remaining, 1)}

    # ⛔⛔ The refresh token is dropped HERE, unconditionally. See the module docstring:
    # this is the rail that makes it impossible for this pod to refresh, and therefore
    # impossible for it to invalidate web's grant. `id_token` is dropped too; it is an
    # identity JWT no consumer on this pod reads.
    doc = {
        "access_token": access,
        "token_type": payload.get("token_type") or "Bearer",
        "expires_in": expires_in,
        "scope": payload.get("scope") or "api",
        "saved_at": saved_at,
        # Local-clock provenance, kept separate from the sender's `saved_at` so the
        # freeze telemetry below can tell "web stopped pushing" from "token is old".
        "replica_received_at": now,
        "replica_source": "web",
    }

    try:
        TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = TOKEN_FILE.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(doc, indent=2))
        os.replace(tmp, TOKEN_FILE)
    except Exception as e:  # noqa: BLE001
        return _reject(f"write failed: {e}", code="error")

    _STATE["installs"] += 1
    _STATE["last_success_at"] = now
    _STATE["last_result"] = "accepted"
    _STATE["last_error"] = None
    log.info("[schwab-token-replica] installed access token, %.0fs of life left",
             remaining)
    return {"status": "accepted", "saved_at": saved_at,
            "expires_in_sec": round(remaining, 1)}


def status() -> dict:
    """Receiver-side telemetry. The sender reports its own state separately.

    ⚰️ WATCH `age_seconds` AND `expired`. A replica that silently stops being fed is the
    exact failure this module exists to end, and it was invisible for 113 days. A test can
    prove the install logic; only telemetry catches the next freeze.
    """
    local = _local_saved_at()
    expires_in = 1800.0
    has_refresh = False
    try:
        if TOKEN_FILE.exists():
            doc = json.loads(TOKEN_FILE.read_text())
            _raw = doc.get("expires_in")  # same 0-is-not-absent care as above
            expires_in = float(_raw) if _raw is not None else 1800.0
            # Surfaced on purpose: a True here means this pod is holding a refresh token
            # from somewhere other than this module, and could refresh against web's grant.
            has_refresh = bool(doc.get("refresh_token"))
    except Exception:  # noqa: BLE001
        pass

    age = (time.time() - local) if local else None
    return {
        "receive_enabled": receive_enabled(),
        "token_file": str(TOKEN_FILE),
        "has_token": bool(local),
        "saved_at": local or None,
        "age_seconds": round(age, 1) if age is not None else None,
        "expired": (age is not None and age > expires_in),
        "holds_refresh_token": has_refresh,
        **{k: _STATE[k] for k in sorted(_STATE)},
    }
