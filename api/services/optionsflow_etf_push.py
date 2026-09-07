"""Web-side replication of the canonical ETF/INDEX snapshot to flow-worker.

WEB IS THE SOLE CANONICAL WRITER AND THE SENDER. flow-worker only receives.

⛔ THE TRANSPORT DIRECTION IS EVIDENCE-DRIVEN, NOT PREFERENCE.
The first design had flow-worker PULL from web. Deploying it disproved that:
Railway private networking is IPv6, and web starts as `uvicorn --host 0.0.0.0`
(IPv4 only), so web is unreachable from flow-worker — connections were REFUSED on
8080/8000/80 over both families, probed from inside the pod. Changing web's bind
to `::` was rejected: it is the member-facing service and there is no staging.
web -> flow-worker already works (WORKER_INTERNAL_URL, the proxy's own path), so
the push direction uses proven networking instead of a new listener risk.

⛔ THIS IS NOT LIVE ROUTING. It replicates into flow-worker's dedicated
`optionsflow_etf_replica` table, read only by the server-side Options Flow TOP 10.
`ticker_types` on flow-worker — which drives massive_processor.is_index_source()
and therefore where every live OPRA trade is stored — is untouched. Those are two
separate owner decisions and must not be bundled.

⛔ REPLICATION IS SUBORDINATE TO SERVING MEMBERS. Every failure here is swallowed
and recorded. A flow-worker outage must never fail web's canonical sync, and no
member request ever triggers replication.
"""
import logging
import os
import time

log = logging.getLogger(__name__)

WORKER_INTERNAL_URL = (os.environ.get("WORKER_INTERNAL_URL") or "").rstrip("/")
_TIMEOUT = float(os.environ.get("OPTIONSFLOW_ETF_PUSH_TIMEOUT", "30"))

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
    return os.environ.get("OPTIONSFLOW_ETF_REPLICA_PUSH_ENABLED", "0") == "1"


def _auth_headers() -> dict:
    secret = (os.environ.get("PUSH_SECRET") or "").strip()
    if not secret:
        raise RuntimeError("PUSH_SECRET is unset")
    return {"Authorization": f"Bearer {secret}", "Content-Type": "application/json"}


def reconcile(force: bool = False) -> dict:
    """Converge flow-worker's replica on the current canonical generation.

    Compares generations FIRST via flow-worker's tiny status endpoint, so a
    matching replica costs a few dozen bytes and transfers no snapshot. Only a
    genuine mismatch sends the ~19.5k-row payload.

    ⛔ NEVER CALLED FROM A MEMBER REQUEST. Scheduler and post-sync only.
    ⛔ NEVER RAISES. A flow-worker outage records an error and returns; web's
    canonical sync and every member request are unaffected.
    """
    _STATE["attempts"] += 1
    _STATE["last_attempt_at"] = time.time()

    def _fail(reason):
        _STATE["last_error"] = str(reason)
        _STATE["last_error_at"] = time.time()
        _STATE["last_result"] = "error"
        log.warning("[of-etf-push] %s", reason)
        return {"ok": False, "reason": str(reason)}

    if not push_enabled():
        _STATE["last_result"] = "disabled"
        return {"ok": False, "reason": "push disabled"}
    if not WORKER_INTERNAL_URL:
        return _fail("WORKER_INTERNAL_URL is unset")

    try:
        import httpx
        from api.ticker_types import etf_index_snapshot
    except Exception as e:  # noqa: BLE001
        return _fail(f"import failed: {e}")

    # The canonical snapshot and its identity from ONE read (see C2a): fetching
    # them separately allows stamping generation G onto the rows of G+1.
    try:
        snap = etf_index_snapshot(include_pairs=True)
    except Exception as e:  # noqa: BLE001
        return _fail(f"canonical read failed: {e}")

    gen = snap.get("generation")
    rows = snap.get("rows") or []
    if not gen or not rows:
        return _fail("canonical snapshot empty — refusing to replicate it")

    try:
        with httpx.Client(timeout=_TIMEOUT) as c:
            if not force:
                r = c.get(WORKER_INTERNAL_URL + "/api/flow/etf-replica-status",
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
            r = c.post(WORKER_INTERNAL_URL + "/api/flow/etf-replica/install",
                       headers=_auth_headers(), json=body)
            r.raise_for_status()
            out = r.json()
    except Exception as e:  # noqa: BLE001
        return _fail(f"push failed: {e}")

    _STATE["pushes_sent"] += 1
    _STATE["last_success_at"] = time.time()
    _STATE["last_result"] = out.get("status")
    _STATE["last_error"] = None
    log.info("[of-etf-push] %s generation %s (%d rows)",
             out.get("status"), (gen or "")[:12], len(rows))
    return {"ok": True, "transferred": True, "generation": gen, "remote": out}


def status() -> dict:
    """Sender-side telemetry. The receiver reports its own state separately."""
    try:
        from api.ticker_types import classification_generation
        canonical = classification_generation()
    except Exception:  # noqa: BLE001
        canonical = {"generation": None, "last_synced": None, "count": 0}
    return {
        "push_enabled": push_enabled(),
        "worker_internal_url_configured": bool(WORKER_INTERNAL_URL),
        "canonical_generation": canonical.get("generation"),
        "canonical_last_synced": canonical.get("last_synced"),
        "canonical_count": canonical.get("count"),
        **_STATE,
    }
