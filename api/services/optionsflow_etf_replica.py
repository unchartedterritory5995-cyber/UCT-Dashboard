"""A CURRENT ETF/INDEX classification replica, for Options Flow only.

⛔⛔ THIS IS NOT THE ROUTING TABLE. READ THIS BEFORE CONNECTING ANYTHING TO IT.

`ticker_types` on flow-worker drives `massive_processor.is_index_source()`, which
decides whether every live OPRA trade is stored as source='indexes' or 'stocks'.
That table is deliberately LEFT ALONE by this module. Changing what it contains
would change live tape routing — a member-visible semantic change in a
partner-owned surface, and a separate owner decision from Options Flow
performance work. This module writes to its OWN table and is read by ONE
consumer: the server-side Options Flow TOP 10 computation.

If you are here because you want current classifications on the routing path,
STOP. That is the `optionsflow_etf_replica` / routing-correction distinction, and
it is deliberate. Wire routing to this table and you silently bundle two
decisions the owner separated on purpose.

WHY IT EXISTS — measured on the live Railway services 2026-09-07:

    web          19,483 ETF/INDEX symbols, last_synced 2026-09-07T09:30
    flow-worker  18,863 ETF/INDEX symbols, last_synced 2026-07-14T05:30

Four separate Railway volumes, all mounted at /data, so FLOW_DB_PATH is the same
path but service-local storage. Web syncs `ticker_types` daily at 05:30 ET;
flow-worker never has. Its copy froze at the P5 cutover and ran 55 days stale.
`/api/flow/*` is proxied to flow-worker, so a server-side TOP 10 built there
would classify from that frozen set while the browser used web's current one.

WEB REMAINS THE SINGLE CANONICAL WRITER. This is a read replica: it pulls one
canonical snapshot, identified by content digest, and installs it atomically.
"""
import json
import logging
import os
import sqlite3
import threading
import time

log = logging.getLogger(__name__)

DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")

# Web syncs at 05:30 ET daily, so anything past ~26h means a missed sync or a
# frozen replica. Deliberately NOT a multiple of the refresh interval: this is a
# statement about the CANONICAL cadence, not about how often we poll.
STALE_AFTER_S = int(os.environ.get("OPTIONSFLOW_ETF_STALE_AFTER_S", str(26 * 3600)))

_TABLE = "optionsflow_etf_replica"
_META = "optionsflow_etf_replica_meta"

_LOCK = threading.Lock()
_MEM = {"generation": None, "symbols": frozenset(), "loaded_at": 0.0}
_STATE = {
    "last_push_ok_at": None,
    "last_push_error": None,
    "last_push_error_at": None,
    "pushes_received": 0,
    "pushes_already_current": 0,
    "pushes_rejected": 0,
    "installs": 0,
}


def receive_enabled() -> bool:
    """Accept pushed snapshots? Off by default.

    ⛔ DELIBERATELY A NEW NAME. The first C2b build had flow-worker PULL from web
    under OPTIONSFLOW_ETF_REPLICA_ENABLED. Deploying it disproved that transport:
    Railway private networking is IPv6 and web starts as
    `uvicorn --host 0.0.0.0` (IPv4 only), so web is unreachable from flow-worker
    in any direction — connections were REFUSED on 8080/8000/80 over both
    families. Reusing the old flag name would leave the impossible pull design
    looking like the active architecture. Sender-side is
    OPTIONSFLOW_ETF_REPLICA_PUSH_ENABLED, on web.
    """
    return os.environ.get("OPTIONSFLOW_ETF_REPLICA_RECEIVE_ENABLED", "0") == "1"


def _connect():
    return sqlite3.connect(DB_PATH, timeout=15)


def ensure_schema(conn) -> None:
    conn.execute(
        f"CREATE TABLE IF NOT EXISTS {_TABLE} ("
        " ticker TEXT PRIMARY KEY,"
        " asset_type TEXT NOT NULL)"
    )
    conn.execute(
        f"CREATE TABLE IF NOT EXISTS {_META} ("
        " k TEXT PRIMARY KEY,"
        " v TEXT)"
    )


def _meta_get(conn, key, default=None):
    row = conn.execute(f"SELECT v FROM {_META} WHERE k = ?", (key,)).fetchone()
    return row[0] if row else default


def local_generation() -> dict:
    """{generation, last_synced, installed_at, count} for the installed replica."""
    try:
        conn = _connect()
        try:
            ensure_schema(conn)
            n = conn.execute(f"SELECT COUNT(*) FROM {_TABLE}").fetchone()[0]
            return {
                "generation": _meta_get(conn, "generation"),
                "last_synced": _meta_get(conn, "last_synced"),
                "installed_at": _meta_get(conn, "installed_at"),
                "count": n,
            }
        finally:
            conn.close()
    except Exception as e:
        log.warning("[of-etf-replica] local generation read failed: %s", e)
        return {"generation": None, "last_synced": None, "installed_at": None, "count": 0}


def symbols() -> frozenset:
    """The replicated ETF/INDEX symbol set, memoised per generation.

    ⛔ Returns an EMPTY set when nothing is installed — never a partial one. A
    caller must treat "no generation" as "cannot classify", not as "no ETFs".
    """
    info = local_generation()
    gen = info["generation"]
    if not gen:
        return frozenset()
    if _MEM["generation"] == gen:
        return _MEM["symbols"]
    try:
        conn = _connect()
        try:
            rows = conn.execute(f"SELECT ticker FROM {_TABLE}").fetchall()
        finally:
            conn.close()
        s = frozenset(r[0] for r in rows)
        _MEM.update(generation=gen, symbols=s, loaded_at=time.time())
        return s
    except Exception as e:
        log.warning("[of-etf-replica] symbol load failed: %s", e)
        return frozenset()


def _install(snapshot) -> None:
    """Replace the replica ATOMICALLY, stamping its generation in the same txn.

    ⛔ The rows and the generation are written in ONE transaction. A crash between
    them would leave a replica whose stamp describes a different set than it
    holds — exactly the lie the generation exists to prevent. DELETE+INSERT
    inside an explicit transaction gives that atomicity in SQLite; a reader
    either sees the whole previous generation or the whole new one.
    """
    conn = _connect()
    try:
        ensure_schema(conn)
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(f"DELETE FROM {_TABLE}")
        conn.executemany(
            f"INSERT INTO {_TABLE} (ticker, asset_type) VALUES (?, 'ETF')",
            [(s,) for s in snapshot["symbols"]],
        )
        for k, v in (
            ("generation", snapshot["generation"]),
            ("last_synced", snapshot.get("last_synced")),
            ("installed_at", str(int(time.time()))),
        ):
            conn.execute(f"INSERT OR REPLACE INTO {_META} (k, v) VALUES (?, ?)", (k, str(v)))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def status() -> dict:
    """Everything needed to SEE a freeze like July 14 -> September 7.

    The 55-day staleness was invisible because nothing reported replica age. A
    test can prove the stale-state logic; only telemetry catches the next freeze.
    """
    local = local_generation()
    installed_at = local.get("installed_at")
    try:
        age = time.time() - float(installed_at) if installed_at else None
    except (TypeError, ValueError):
        age = None
    return {
        "receive_enabled": receive_enabled(),
        "local_generation": local.get("generation"),
        "local_last_synced": local.get("last_synced"),
        "local_count": local.get("count"),
        "replica_age_seconds": age,
        "replica_age_hours": round(age / 3600, 2) if age is not None else None,
        "stale": (age is None) or (age > STALE_AFTER_S),
        "stale_after_seconds": STALE_AFTER_S,
        "last_push_ok_at": _STATE["last_push_ok_at"],
        "last_push_error": _STATE["last_push_error"],
        "last_push_error_at": _STATE["last_push_error_at"],
        "pushes_received": _STATE["pushes_received"],
        "pushes_already_current": _STATE["pushes_already_current"],
        "pushes_rejected": _STATE["pushes_rejected"],
        "installs": _STATE["installs"],
    }


# ── Receiving a pushed snapshot ─────────────────────────────────────────────
# Web is the sole canonical writer and the SENDER. Flow-worker only receives.
# The transport reversed (see receive_enabled) but the architecture did not:
# versioned canonical snapshot -> atomic read replica.

MAX_SNAPSHOT_ROWS = int(os.environ.get("OPTIONSFLOW_ETF_MAX_ROWS", "200000"))


class SnapshotRejected(Exception):
    """Validation failed. The previous replica is untouched, always."""


def install_pushed_snapshot(payload: dict) -> dict:
    """Validate and atomically install a pushed canonical snapshot.

    ⛔ THE CALLER'S GENERATION IS NOT TRUSTED. The digest is RECOMPUTED here from
    the rows actually received and compared to the stamp. A truncated body, a
    reordered list or a mismatched stamp is therefore detectable without trusting
    the sender — which is the whole point of a content identity rather than a
    timestamp.

    Ordering: `last_synced` decides which snapshot is newer, because generations
    are digests and digests have no order. An older snapshot must never overwrite
    a newer replica — a retry arriving late after a fresher push would otherwise
    silently roll the replica backwards.

    Returns {"status": accepted|already-current|rejected, ...} — small and
    operational. Never echoes the dataset back.
    """
    _STATE["pushes_received"] += 1
    try:
        if not isinstance(payload, dict):
            raise SnapshotRejected("payload is not an object")
        gen = payload.get("generation")
        rows = payload.get("rows")
        last_synced = payload.get("last_synced")
        if not gen or not isinstance(gen, str):
            raise SnapshotRejected("missing generation")
        if not isinstance(rows, list) or not rows:
            # An empty payload is a provider fault, never a real "no ETFs exist".
            raise SnapshotRejected("rows missing or empty")
        if len(rows) > MAX_SNAPSHOT_ROWS:
            raise SnapshotRejected("rows exceed bound")

        pairs = []
        for r in rows:
            if not (isinstance(r, (list, tuple)) and len(r) == 2):
                raise SnapshotRejected("row is not a [ticker, asset_type] pair")
            t, a = r
            if not isinstance(t, str) or not isinstance(a, str) or not t:
                raise SnapshotRejected("row has a non-string or empty field")
            pairs.append((t, a))

        from api.services.etf_generation import generation_from_pairs
        recomputed = generation_from_pairs(pairs)
        if recomputed != gen:
            raise SnapshotRejected("digest mismatch (truncated or altered body)")

        local = local_generation()
        if local.get("generation") == gen:
            _STATE["pushes_already_current"] += 1
            _STATE["last_push_ok_at"] = time.time()
            _STATE["last_push_error"] = None
            return {"status": "already-current", "generation": gen,
                    "count": local.get("count")}

        # No downgrade. Digests are unordered, so freshness comes from last_synced.
        installed_ls = local.get("last_synced")
        if installed_ls and last_synced and str(last_synced) < str(installed_ls):
            raise SnapshotRejected("older snapshot may not overwrite a newer replica")

        _install({"symbols": [t for t, _ in pairs], "generation": gen,
                  "last_synced": last_synced})
        _MEM.update(generation=None, symbols=frozenset(), loaded_at=0.0)
        _STATE["installs"] += 1
        _STATE["last_push_ok_at"] = time.time()
        _STATE["last_push_error"] = None
        log.info("[of-etf-replica] installed pushed generation %s (%d rows, last_synced %s)",
                 gen[:12], len(pairs), last_synced)
        return {"status": "accepted", "generation": gen, "count": len(pairs)}

    except SnapshotRejected as e:
        _STATE["pushes_rejected"] += 1
        _STATE["last_push_error"] = str(e)
        _STATE["last_push_error_at"] = time.time()
        log.warning("[of-etf-replica] push rejected: %s", e)
        return {"status": "rejected", "reason": str(e)}
    except Exception as e:
        # An install/transaction failure leaves the previous COMPLETE replica.
        _STATE["pushes_rejected"] += 1
        _STATE["last_push_error"] = f"install: {e}"
        _STATE["last_push_error_at"] = time.time()
        log.exception("[of-etf-replica] push install failed — previous replica retained")
        return {"status": "rejected", "reason": "install failed"}
