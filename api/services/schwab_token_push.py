"""Web-side replication of the Schwab ACCESS token to flow-worker.

WEB IS THE SOLE GRANT OWNER AND THE SENDER. flow-worker only receives.

⚰️ THE PROBLEM, MEASURED 2026-11-09. Schwab's OAuth callback can only land on `web`, and
`/data/schwab_token.json` sits on a PER-SERVICE Railway volume. So a re-auth wrote web's
copy and nothing else: web's token was 0.0 days old minutes after a successful login while
flow-worker's was **113.4 days** old, failing `invalid_grant` on every cycle. The owner
experienced that as "every deploy I have to log in again" — the login did fix the pod they
were looking at, and never fixed the one serving the data. A deploy was never the cause;
`/data` survives deploys. The cause was that nothing propagated the token.

⛔ A SEPARATE MECHANISM FROM `ticker_types_push` AND `optionsflow_etf_push`, ON PURPOSE.
Sharing the transport PATTERN is deliberate; sharing the PAYLOAD is not. Those two carry
datasets on a daily/30-min cadence; this carries a 30-MINUTE CREDENTIAL and must run far
more often, so folding it into either would either starve this one or over-run those.

⛔ THE TRANSPORT DIRECTION IS FORCED, NOT PREFERRED. Railway private networking is IPv6 and
web starts as `uvicorn --host 0.0.0.0` (IPv4 only), so web is unreachable FROM flow-worker
and a pull design was already disproved on deploy by `ticker_types_push`. web ->
flow-worker over WORKER_INTERNAL_URL is the only direction that works.

⛔⛔ ONLY THE ACCESS TOKEN IS EVER SENT. The refresh token is never put on the wire and the
receiver strips it anyway if it somehow arrives. That keeps web the only pod that can
refresh, so the two pods can never invalidate each other's grant — which matters because
whether Schwab rotates the refresh token on refresh is still unverified, and a design that
is safe either way beats one that needs the answer. `id_token` is not sent either: it is an
identity JWT no consumer on flow-worker reads.

⛔ REPLICATION IS SUBORDINATE TO SERVING MEMBERS. Every failure here is swallowed and
recorded. A flow-worker outage must never fail a login, a refresh, or a member request, and
no member request ever triggers a push.

⚠️ WHAT THIS DOES NOT FIX, STATED PLAINLY. Schwab caps the REFRESH token at 7 days and
refreshing does not extend it, so a manual OAuth re-auth roughly weekly is unavoidable and
no amount of replication removes it. `schwab_service._auto_refresh_loop`'s docstring claims
"users never need to re-authenticate" — that claim is false and predates this module. What
this removes is the per-pod and per-deploy half of the problem: one login on web now reaches
flow-worker within `SCHWAB_TOKEN_PUSH_INTERVAL_MIN`.
"""
import logging
import os
import time

log = logging.getLogger(__name__)

WORKER_INTERNAL_URL = (os.environ.get("WORKER_INTERNAL_URL") or "").rstrip("/")
_TIMEOUT = float(os.environ.get("SCHWAB_TOKEN_PUSH_TIMEOUT", "15"))

# Push when the remote copy is older than this many seconds, even if nothing changed
# locally. Access tokens live 1800s; the scheduler runs well inside that.
_STALE_AFTER_SEC = float(os.environ.get("SCHWAB_TOKEN_PUSH_STALE_AFTER_SEC", "420"))

_STATE = {
    "last_attempt_at": None,
    "last_success_at": None,
    "last_error": None,
    "last_error_at": None,
    "last_result": None,
    "attempts": 0,
    "pushes_sent": 0,
    "skipped_already_current": 0,
}


def push_enabled() -> bool:
    """Off by default. Distinct from the receiver's flag on flow-worker."""
    return os.environ.get("SCHWAB_TOKEN_PUSH_ENABLED", "0") == "1"


def _auth_headers() -> dict:
    secret = (os.environ.get("PUSH_SECRET") or "").strip()
    if not secret:
        raise RuntimeError("PUSH_SECRET is unset")
    return {"Authorization": f"Bearer {secret}"}


def _fail(reason) -> dict:
    _STATE["last_error"] = str(reason)
    _STATE["last_error_at"] = time.time()
    _STATE["last_result"] = "error"
    # ⛔ Never log the token or the response body. This module handles a live credential
    # and the repo is public.
    log.warning("[schwab-token-push] %s", reason)
    return {"ok": False, "reason": str(reason)}


def reconcile(force: bool = False) -> dict:
    """Converge flow-worker's access token on web's current one.

    Asks the receiver's tiny status endpoint FIRST, so a pod that is already current costs a
    few dozen bytes and transfers no credential. Only a genuine mismatch, or a remote copy
    gone stale, sends anything.

    ⛔ NEVER CALLED FROM A MEMBER REQUEST. Scheduler, post-login and post-refresh only.
    ⛔ NEVER RAISES.
    """
    _STATE["attempts"] += 1
    _STATE["last_attempt_at"] = time.time()

    if not push_enabled():
        _STATE["last_result"] = "disabled"
        return {"ok": False, "reason": "push disabled"}
    if not WORKER_INTERNAL_URL:
        return _fail("WORKER_INTERNAL_URL is unset")

    try:
        import httpx
        from api import schwab_service as schwab
    except Exception as e:  # noqa: BLE001
        return _fail(f"import failed: {e}")

    try:
        tokens = schwab.load_tokens()
    except Exception as e:  # noqa: BLE001
        return _fail(f"local token read failed: {e}")

    if not tokens or not tokens.get("access_token"):
        # Not an error worth shouting about: before the first OAuth there is nothing to send.
        _STATE["last_result"] = "no-local-token"
        return {"ok": False, "reason": "no local token"}

    # ⛔ `or 1800` would read a literal 0 as "absent" — see the matching note in
    # schwab_token_replica.install_pushed_token.
    _raw_exp = tokens.get("expires_in")
    try:
        saved_at = float(tokens.get("saved_at") or 0)
        expires_in = float(_raw_exp) if _raw_exp is not None else 1800.0
    except (TypeError, ValueError):
        return _fail("local token has non-numeric saved_at/expires_in")

    # ⛔ CHECKED BEFORE THE TRANSPORT BLOCK, not inside it. `_auth_headers()` raises on an
    # unset secret, and raising inside the httpx try/except reported a CONFIG error as
    # "push failed: RuntimeError" — an operator reading that would go looking at the
    # network. Same treatment as WORKER_INTERNAL_URL above.
    if not (os.environ.get("PUSH_SECRET") or "").strip():
        return _fail("PUSH_SECRET is unset")

    remaining = (saved_at + expires_in) - time.time()
    if remaining <= 0:
        # web's own token is expired. Pushing it would overwrite flow-worker's copy with a
        # dead one; web's refresh loop will mint a new one and the post-refresh hook pushes
        # it. Deliberately not an error.
        _STATE["last_result"] = "local-token-expired"
        return {"ok": False, "reason": "local token expired"}

    try:
        with httpx.Client(timeout=_TIMEOUT) as c:
            if not force:
                r = c.get(WORKER_INTERNAL_URL + "/api/flow/schwab-token-status",
                          headers=_auth_headers())
                r.raise_for_status()
                remote = r.json()
                remote_saved = remote.get("saved_at") or 0
                remote_age = remote.get("age_seconds")
                fresh_enough = (remote_age is not None
                                and remote_age <= _STALE_AFTER_SEC)
                if remote_saved and float(remote_saved) >= saved_at and fresh_enough:
                    _STATE["skipped_already_current"] += 1
                    _STATE["last_success_at"] = time.time()
                    _STATE["last_result"] = "already-current"
                    _STATE["last_error"] = None
                    return {"ok": True, "transferred": False}

            # ⛔⛔ The whitelist IS the payload contract. Never `dict(tokens)` here: that
            # would put the refresh token and the id_token on the wire the next time
            # Schwab adds a field.
            body = {
                "access_token": tokens["access_token"],
                "token_type": tokens.get("token_type") or "Bearer",
                "expires_in": expires_in,
                "scope": tokens.get("scope") or "api",
                "saved_at": saved_at,
            }
            r = c.post(WORKER_INTERNAL_URL + "/api/flow/schwab-token/install",
                       headers=_auth_headers(), json=body)
            r.raise_for_status()
            out = r.json()
    except Exception as e:  # noqa: BLE001
        # ⛔ `str(e)` on an httpx error can carry the request URL, which is internal-only
        # and carries no secret, but the response body could echo ours. Report the type and
        # the URL-free message only.
        return _fail(f"push failed: {type(e).__name__}")

    _STATE["pushes_sent"] += 1
    _STATE["last_success_at"] = time.time()
    _STATE["last_result"] = out.get("status")
    _STATE["last_error"] = None
    log.info("[schwab-token-push] %s (%.0fs of token life left)",
             out.get("status"), remaining)
    return {"ok": True, "transferred": True, "remote": out}


def reconcile_async() -> None:
    """Fire-and-forget `reconcile()` on a daemon thread.

    ⛔ EXISTS BECAUSE `save_tokens` IS SYNC AND ON THE LOGIN PATH. The OAuth callback and
    the refresh both call it, and neither may wait on flow-worker's health or block the
    event loop on a network call. Swallows everything, including a thread that cannot start.
    """
    if not push_enabled():
        return
    try:
        import threading
        threading.Thread(target=reconcile, name="schwab-token-push",
                         daemon=True).start()
    except Exception as e:  # noqa: BLE001
        log.warning("[schwab-token-push] could not start push thread: %s", e)


def status() -> dict:
    """Sender-side telemetry. The receiver reports its own state separately.

    ⛔ Reports token TIMING, never token VALUE.
    """
    local_saved_at = None
    local_remaining = None
    try:
        from api import schwab_service as schwab
        tokens = schwab.load_tokens() or {}
        if tokens.get("access_token"):
            local_saved_at = float(tokens.get("saved_at") or 0)
            local_remaining = round(
                (local_saved_at + float(tokens.get("expires_in") or 1800)) - time.time(), 1)
    except Exception:  # noqa: BLE001
        pass

    return {
        "push_enabled": push_enabled(),
        "worker_internal_url_configured": bool(WORKER_INTERNAL_URL),
        "local_saved_at": local_saved_at,
        "local_expires_in_sec": local_remaining,
        "stale_after_sec": _STALE_AFTER_SEC,
        **{k: _STATE[k] for k in sorted(_STATE)},
    }
