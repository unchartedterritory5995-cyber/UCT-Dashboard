"""Web-side replication of the canonical ROUTING classification to flow-worker.

WEB IS THE SOLE CANONICAL WRITER AND THE SENDER. flow-worker only receives.

⛔ A SEPARATE MECHANISM FROM `optionsflow_etf_push`, ON PURPOSE. That one replicates the
Options-Flow TOP-10 replica and its own docstring forbids touching `ticker_types`, calling
the two "separate owner decisions [that] must not be bundled". This is that second
decision, taken 2026-11-08. Sharing the transport PATTERN is deliberate; sharing the
PAYLOAD is not, because a fault in the routing push must not be able to break the TOP-10
replica that has been healthy since 2026-09-07.

⛔ THE TRANSPORT DIRECTION IS FORCED, NOT PREFERRED. Railway private networking is IPv6
and web starts as `uvicorn --host 0.0.0.0` (IPv4 only), so web is unreachable FROM
flow-worker — a pull design was already disproved on deploy. web -> flow-worker is the path
WORKER_INTERNAL_URL, the read proxy and the TOP-10 replica all already use.

⛔ REPLICATION IS SUBORDINATE TO SERVING MEMBERS. Every failure here is swallowed and
recorded. A flow-worker outage must never fail web's canonical sync, and no member request
ever triggers replication.

⚠️ WHAT ARMING THIS CHANGES, STATED PLAINLY: flow-worker's `ticker_types` drives
`massive_processor.is_index_source()`, which decides whether a live OPRA trade is stored
with source='stocks' or 'indexes'. That is a bigger blast radius than the TOP-10 replica,
which is why both ends ship DARK (`TICKER_TYPES_REPLICA_PUSH_ENABLED` here,
`TICKER_TYPES_REPLICA_RECEIVE_ENABLED` on the receiver) and the receiver validates the
digest, refuses a downgrade and refuses a shrink before it writes anything.
"""
import logging
import os
import time

log = logging.getLogger(__name__)

WORKER_INTERNAL_URL = (os.environ.get("WORKER_INTERNAL_URL") or "").rstrip("/")
_TIMEOUT = float(os.environ.get("TICKER_TYPES_PUSH_TIMEOUT", "60"))

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
    return os.environ.get("TICKER_TYPES_REPLICA_PUSH_ENABLED", "0") == "1"


def _auth_headers() -> dict:
    secret = (os.environ.get("PUSH_SECRET") or "").strip()
    if not secret:
        raise RuntimeError("PUSH_SECRET is unset")
    return {"Authorization": f"Bearer {secret}"}


def reconcile(force: bool = False) -> dict:
    """Converge flow-worker's `ticker_types` on the current canonical generation.

    Compares generations FIRST via the receiver's tiny status endpoint, so a pod that is
    already current costs a few dozen bytes and transfers no snapshot. Only a genuine
    mismatch sends the ~27.5k-pair payload (~0.5 MB, well inside the receiver's 8 MB bound).

    ⛔ NEVER CALLED FROM A MEMBER REQUEST. Scheduler and post-sync only.
    ⛔ NEVER RAISES.
    """
    _STATE["attempts"] += 1
    _STATE["last_attempt_at"] = time.time()

    def _fail(reason):
        _STATE["last_error"] = str(reason)
        _STATE["last_error_at"] = time.time()
        _STATE["last_result"] = "error"
        log.warning("[ticker-types-push] %s", reason)
        return {"ok": False, "reason": str(reason)}

    if not push_enabled():
        _STATE["last_result"] = "disabled"
        return {"ok": False, "reason": "push disabled"}
    if not WORKER_INTERNAL_URL:
        return _fail("WORKER_INTERNAL_URL is unset")

    try:
        import httpx
        from api.ticker_types import classification_snapshot
    except Exception as e:  # noqa: BLE001
        return _fail(f"import failed: {e}")

    # The snapshot and its identity from ONE read — see classification_snapshot's docstring
    # for why two reads allow stamping generation G onto the rows of G+1.
    try:
        snap = classification_snapshot()
    except Exception as e:  # noqa: BLE001
        return _fail(f"canonical read failed: {e}")

    gen = snap.get("generation")
    rows = snap.get("rows") or []
    if not gen or not rows:
        return _fail("canonical classification empty — refusing to replicate it")
    # ⛔ A canonical set missing one of the two classes is a FAULT, not a valid snapshot.
    # `classify()` needs the STOCK set to override a stale INDEX_SYMBOLS entry (the SPCX
    # correction); shipping an ETF-only set would silently disable that on the routing pod.
    by_class = snap.get("counts_by_class") or {}
    if not by_class.get("STOCK") or not (by_class.get("ETF") or by_class.get("INDEX")):
        return _fail("canonical classification is missing a class (%s) — refusing to "
                     "replicate a half set" % by_class)

    try:
        with httpx.Client(timeout=_TIMEOUT) as c:
            if not force:
                r = c.get(WORKER_INTERNAL_URL + "/api/flow/ticker-types-status",
                          headers=_auth_headers())
                r.raise_for_status()
                remote = r.json()
                if remote.get("local_generation") == gen:
                    _STATE["skipped_already_current"] += 1
                    _STATE["last_success_at"] = time.time()
                    _STATE["last_result"] = "already-current"
                    _STATE["last_error"] = None
                    return {"ok": True, "transferred": False, "generation": gen}

            body = {"generation": gen, "last_synced": snap.get("last_synced"),
                    "rows": [list(p) for p in rows]}
            r = c.post(WORKER_INTERNAL_URL + "/api/flow/ticker-types/install",
                       headers=_auth_headers(), json=body)
            r.raise_for_status()
            out = r.json()
    except Exception as e:  # noqa: BLE001
        return _fail(f"push failed: {e}")

    _STATE["pushes_sent"] += 1
    _STATE["last_success_at"] = time.time()
    _STATE["last_result"] = out.get("status")
    _STATE["last_error"] = None
    log.info("[ticker-types-push] %s generation %s (%d pairs)",
             out.get("status"), (gen or "")[:12], len(rows))
    return {"ok": True, "transferred": True, "generation": gen, "remote": out}


def status() -> dict:
    """Sender-side telemetry. The receiver reports its own state separately."""
    try:
        from api.ticker_types import classification_snapshot
        snap = classification_snapshot()
        canonical = {k: snap.get(k) for k in ("generation", "last_synced", "count",
                                              "counts_by_class")}
    except Exception:  # noqa: BLE001
        canonical = {"generation": None, "last_synced": None, "count": 0,
                     "counts_by_class": {}}
    return {
        "push_enabled": push_enabled(),
        "worker_internal_url_configured": bool(WORKER_INTERNAL_URL),
        "canonical": canonical,
        **{k: _STATE[k] for k in sorted(_STATE)},
    }
