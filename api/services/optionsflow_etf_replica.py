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
WEB_INTERNAL_URL = (os.environ.get("WEB_INTERNAL_URL") or "").rstrip("/")

# Web syncs at 05:30 ET daily, so anything past ~26h means a missed sync or a
# frozen replica. Deliberately NOT a multiple of the refresh interval: this is a
# statement about the CANONICAL cadence, not about how often we poll.
STALE_AFTER_S = int(os.environ.get("OPTIONSFLOW_ETF_STALE_AFTER_S", str(26 * 3600)))
REFRESH_EVERY_S = int(os.environ.get("OPTIONSFLOW_ETF_REFRESH_EVERY_S", str(3600)))
_HTTP_TIMEOUT = float(os.environ.get("OPTIONSFLOW_ETF_HTTP_TIMEOUT", "20"))

_TABLE = "optionsflow_etf_replica"
_META = "optionsflow_etf_replica_meta"

_LOCK = threading.Lock()
_MEM = {"generation": None, "symbols": frozenset(), "loaded_at": 0.0}
_STATE = {
    "last_refresh_ok_at": None,
    "last_refresh_error": None,
    "last_refresh_error_at": None,
    "last_canonical_generation_seen": None,
    "refreshes": 0,
    "no_op_refreshes": 0,
    "installs": 0,
}


def enabled() -> bool:
    """Off by default. Nothing reads the replica until this is on."""
    return os.environ.get("OPTIONSFLOW_ETF_REPLICA_ENABLED", "0") == "1"


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


def _fetch_json(path):
    import httpx
    if not WEB_INTERNAL_URL:
        raise RuntimeError("WEB_INTERNAL_URL is unset")
    with httpx.Client(timeout=_HTTP_TIMEOUT) as c:
        r = c.get(WEB_INTERNAL_URL + path)
        r.raise_for_status()
        return r.json()


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


def refresh_if_stale(force: bool = False) -> dict:
    """Converge the replica on the canonical generation. Never raises.

    Metadata first: ask web for the generation (a few dozen bytes) and do nothing
    when it already matches. Only a genuine change pulls ~19k symbols.

    ⛔ NEVER CALLED FROM A MEMBER REQUEST PATH. A per-request refresh would put a
    cross-service HTTP call in front of an aggregate build on a single-process
    pod. This runs on the scheduler and on boot.

    ⛔ ON ANY FAILURE THE PREVIOUS COMPLETE REPLICA IS RETAINED. Stale-but-whole
    beats partial: the generation mismatch rail can see stale, and it cannot see
    a half-installed set.
    """
    if not _LOCK.acquire(blocking=False):
        return {"ok": False, "reason": "refresh already running"}
    try:
        _STATE["refreshes"] += 1
        try:
            gen = _fetch_json("/api/ticker-types/generation")
        except Exception as e:
            _STATE["last_refresh_error"] = f"generation probe: {e}"
            _STATE["last_refresh_error_at"] = time.time()
            log.warning("[of-etf-replica] generation probe failed: %s", e)
            return {"ok": False, "reason": str(e)}

        canonical = gen.get("generation")
        _STATE["last_canonical_generation_seen"] = canonical
        local = local_generation()["generation"]
        if canonical and local == canonical and not force:
            _STATE["no_op_refreshes"] += 1
            _STATE["last_refresh_ok_at"] = time.time()
            return {"ok": True, "changed": False, "generation": canonical}

        try:
            snap = _fetch_json("/api/ticker-types/etf-index-symbols")
        except Exception as e:
            _STATE["last_refresh_error"] = f"snapshot fetch: {e}"
            _STATE["last_refresh_error_at"] = time.time()
            log.warning("[of-etf-replica] snapshot fetch failed: %s", e)
            return {"ok": False, "reason": str(e)}

        syms = snap.get("symbols")
        snap_gen = snap.get("generation")
        # Validation before replacement. An empty or unstamped payload is a
        # provider fault, not a real classification of "no ETFs exist".
        if not isinstance(syms, list) or not syms or not snap_gen:
            _STATE["last_refresh_error"] = "snapshot failed validation (empty or unstamped)"
            _STATE["last_refresh_error_at"] = time.time()
            log.warning("[of-etf-replica] snapshot rejected: count=%s gen=%s",
                        len(syms) if isinstance(syms, list) else None, snap_gen)
            return {"ok": False, "reason": "snapshot failed validation"}

        try:
            _install({"symbols": syms, "generation": snap_gen,
                      "last_synced": snap.get("last_synced")})
        except Exception as e:
            _STATE["last_refresh_error"] = f"install: {e}"
            _STATE["last_refresh_error_at"] = time.time()
            log.exception("[of-etf-replica] install failed — previous replica retained")
            return {"ok": False, "reason": str(e)}

        _MEM.update(generation=None, symbols=frozenset(), loaded_at=0.0)
        _STATE["installs"] += 1
        _STATE["last_refresh_ok_at"] = time.time()
        _STATE["last_refresh_error"] = None
        log.info("[of-etf-replica] installed generation %s (%d symbols, last_synced %s)",
                 snap_gen[:12], len(syms), snap.get("last_synced"))
        return {"ok": True, "changed": True, "generation": snap_gen, "count": len(syms)}
    finally:
        _LOCK.release()


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
    canonical = _STATE["last_canonical_generation_seen"]
    return {
        "enabled": enabled(),
        "web_internal_url_configured": bool(WEB_INTERNAL_URL),
        "local_generation": local.get("generation"),
        "local_last_synced": local.get("last_synced"),
        "local_count": local.get("count"),
        "replica_age_seconds": age,
        "replica_age_hours": round(age / 3600, 2) if age is not None else None,
        "stale": (age is None) or (age > STALE_AFTER_S),
        "stale_after_seconds": STALE_AFTER_S,
        "canonical_generation_last_seen": canonical,
        "matches_canonical": bool(canonical and local.get("generation") == canonical),
        "last_refresh_ok_at": _STATE["last_refresh_ok_at"],
        "last_refresh_error": _STATE["last_refresh_error"],
        "last_refresh_error_at": _STATE["last_refresh_error_at"],
        "refreshes": _STATE["refreshes"],
        "no_op_refreshes": _STATE["no_op_refreshes"],
        "installs": _STATE["installs"],
    }
