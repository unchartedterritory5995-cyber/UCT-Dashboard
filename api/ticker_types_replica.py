"""Receive web's canonical ROUTING classification onto this pod's `ticker_types`.

WEB IS THE SOLE CANONICAL WRITER AND THE SENDER. This pod only receives.

⛔⛔ THIS ONE IS THE ROUTING TABLE, AND THAT IS THE WHOLE DIFFERENCE FROM
`api/services/optionsflow_etf_replica.py`. That module replicates into a dedicated
`optionsflow_etf_replica` table read only by the server-side Options Flow TOP 10, and its
docstring is emphatic that `ticker_types` is untouched because `ticker_types` drives
`massive_processor.is_index_source()` and therefore WHERE EVERY LIVE OPRA TRADE IS STORED.
It also says the two are separate owner decisions that must not be bundled. This module is
that second decision, taken deliberately (owner, 2026-11-08) — so it is a SEPARATE
mechanism with SEPARATE flags on both ends, and the proven TOP-10 replica path is not
modified. A fault here must not be able to break that one, and vice versa.

⚰️ WHY IT IS NEEDED, MEASURED RATHER THAN ASSUMED.
`/api/flow/etf-replica-status` exists because of a 55-day freeze found 2026-09-07:
flow-worker sat on the 2026-07-14 generation while web synced daily, and it was INVISIBLE
because nothing reported replica age. The replica half was fixed then. The `ticker_types`
half was not, and it froze the same way:

    web          11-08: 26,657   11-07: 15   11-06: 56   11-05: 3    <- a rolling daily tail
    flow-worker  11-08: 26,665   07-14: 709  07-11: 2    07-10: 4    <- a cliff

flow-worker's history is exactly two events: the original 07-14 population and one MANUAL
`sync_from_massive` on 2026-11-08T02:44. ~1,300 names were classification-blind in between,
which is the SKHY under-post root cause. A manual fix is not a fix; it refreezes the next
day. Hence a scheduled push plus `status()` telemetry, because the lesson of the 55-day
freeze is that a silent freeze needs a number, not a theory.

⛔ WHY REPLICATION AND NOT A SECOND INDEPENDENT SYNC. flow-worker could sync Massive
itself, but then two pods write the same value from the same upstream and can disagree
transiently. The owner chose one canonical writer. The transport is also already proven:
web -> flow-worker over WORKER_INTERNAL_URL is the path the proxy and the TOP-10 replica
both use, and it was verified current (10:30 ET) on the day this was written. ⚠️ Railway
private networking is IPv6 and web binds IPv4-only, so flow-worker CANNOT pull from web —
the direction is forced, not preferred (see optionsflow_etf_push's docstring).

⭐ THE CLASSIFIER ITSELF IS NOT TOUCHED. `classify()` and `is_index_source()` keep reading
`ticker_types` exactly as before; this module only keeps that table fresh. The hot trade
write path gains no new branch, no new import and no new failure mode — all of the risk is
confined to this installer, which is the smallest blast radius available for the change.
"""
from __future__ import annotations

import logging
import os
import sqlite3
import threading
import time

log = logging.getLogger(__name__)

DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")

# Both bounds exist because the body is attacker-shaped only in the sense that a BUG
# upstream is indistinguishable from malice here: an empty or truncated classification is
# a provider fault, never a real "no tickers exist".
MAX_SNAPSHOT_ROWS = int(os.environ.get("TICKER_TYPES_REPLICA_MAX_ROWS", "200000"))
MIN_SNAPSHOT_ROWS = int(os.environ.get("TICKER_TYPES_REPLICA_MIN_ROWS", "1000"))
# ⛔ THE SHRINK GUARD. An authoritative install DELETES local tickers absent from the
# payload, so a partially-fetched canonical snapshot would silently de-classify thousands
# of names and route their trades to the wrong source. A snapshot smaller than this
# fraction of what is already installed is refused rather than applied.
SHRINK_GUARD_FRAC = float(os.environ.get("TICKER_TYPES_REPLICA_SHRINK_GUARD", "0.90"))

_LOCK = threading.Lock()
_STATE = {
    "pushes_received": 0,
    "pushes_already_current": 0,
    "installs": 0,
    "rejected": 0,
    "last_push_ok_at": None,
    "last_push_error": None,
    "last_push_error_at": None,
}


class SnapshotRejected(Exception):
    """A payload that must not be installed. The reason is operational, never the body."""


def receive_enabled() -> bool:
    """Off by default, and distinct from the sender's flag on web.

    ⛔ Two independent switches on purpose: arming the sender must not be able to start
    writing this pod's routing table by itself, and disarming the receiver must stop it
    without a web deploy.
    """
    return os.environ.get("TICKER_TYPES_REPLICA_RECEIVE_ENABLED", "0") == "1"


def _connect():
    return sqlite3.connect(DB_PATH, timeout=20)


def local_classification() -> dict:
    """This pod's own {generation, last_synced, count, counts_by_class}. Never raises."""
    try:
        from api import ticker_types
        conn = _connect()
        try:
            return ticker_types.classification_snapshot(conn)
        finally:
            conn.close()
    except Exception as e:  # noqa: BLE001
        log.warning("[ticker-types-replica] local read failed: %s", e)
        return {"generation": None, "last_synced": None, "count": 0,
                "counts_by_class": {}, "rows": []}


def _install(pairs: list, last_synced) -> int:
    """Authoritative replace of the (ticker, asset_type) projection, in ONE transaction.

    ⭐ AUTHORITATIVE, NOT MERGE-ONLY, AND THE DIGEST IS WHY. The generations compared by
    the sender are digests over the FULL projection, so if this pod kept local tickers the
    canonical set no longer has, its generation could never converge and the sender would
    re-push the whole snapshot every single day while `already-current` never fired. A
    merge that cannot converge is a push loop with extra steps.

    ⛔ OTHER COLUMNS ARE PRESERVED for tickers that remain. The payload carries only the
    classification projection, so writing full rows would blank `name`,
    `primary_exchange`, `raw_type` and `market` on 27k rows to replicate two fields.
    """
    conn = _connect()
    try:
        from api import ticker_types
        ticker_types.ensure_schema(conn)
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("CREATE TEMP TABLE IF NOT EXISTS _tt_incoming "
                     "(ticker TEXT PRIMARY KEY, asset_type TEXT NOT NULL)")
        conn.execute("DELETE FROM _tt_incoming")
        conn.executemany("INSERT OR REPLACE INTO _tt_incoming(ticker, asset_type) VALUES (?, ?)",
                         pairs)
        conn.execute("DELETE FROM ticker_types "
                     "WHERE ticker NOT IN (SELECT ticker FROM _tt_incoming)")
        conn.execute(
            "INSERT INTO ticker_types(ticker, asset_type, last_synced) "
            "SELECT ticker, asset_type, ? FROM _tt_incoming "
            "WHERE true "
            "ON CONFLICT(ticker) DO UPDATE SET "
            "  asset_type = excluded.asset_type, last_synced = excluded.last_synced",
            (str(last_synced) if last_synced else None,))
        n = conn.execute("SELECT COUNT(*) FROM ticker_types").fetchone()[0]
        conn.commit()
        return int(n)
    except Exception:
        try:
            conn.rollback()
        except Exception:  # noqa: BLE001
            pass
        raise
    finally:
        conn.close()


def install_pushed_classification(payload: dict) -> dict:
    """Validate and atomically install a pushed canonical classification.

    ⛔ THE CALLER'S GENERATION IS NOT TRUSTED. The digest is RECOMPUTED from the rows
    actually received, so a truncated or altered body is detectable without trusting the
    sender — a content identity rather than a timestamp, per `etf_generation`'s docstring
    (two different symbol sets can share a count; a one-for-one ticker swap is invisible to
    both a count and a clock).

    Ordering: `last_synced` decides which snapshot is newer, because digests have no order.
    A late retry must never roll this pod's classification backwards.

    Returns {"status": accepted|already-current|rejected, ...} — small and operational,
    never the dataset echoed back.
    """
    _STATE["pushes_received"] += 1
    with _LOCK:
        try:
            if not isinstance(payload, dict):
                raise SnapshotRejected("payload is not an object")
            gen = payload.get("generation")
            rows = payload.get("rows")
            last_synced = payload.get("last_synced")
            if not gen or not isinstance(gen, str):
                raise SnapshotRejected("missing generation")
            if not isinstance(rows, list) or not rows:
                raise SnapshotRejected("rows missing or empty")
            if len(rows) > MAX_SNAPSHOT_ROWS:
                raise SnapshotRejected("rows exceed bound")
            if len(rows) < MIN_SNAPSHOT_ROWS:
                raise SnapshotRejected("rows below the absolute floor (%d < %d)"
                                       % (len(rows), MIN_SNAPSHOT_ROWS))

            pairs = []
            for r in rows:
                if not (isinstance(r, (list, tuple)) and len(r) == 2):
                    raise SnapshotRejected("row is not a [ticker, asset_type] pair")
                t, a = r
                if not isinstance(t, str) or not isinstance(a, str) or not t or not a:
                    raise SnapshotRejected("row has a non-string or empty field")
                pairs.append((t, a))

            from api.services.etf_generation import generation_from_pairs
            if generation_from_pairs(pairs) != gen:
                raise SnapshotRejected("digest mismatch (truncated or altered body)")

            local = local_classification()
            if local.get("generation") == gen:
                _STATE["pushes_already_current"] += 1
                _STATE["last_push_ok_at"] = time.time()
                _STATE["last_push_error"] = None
                return {"status": "already-current", "generation": gen,
                        "count": local.get("count")}

            installed_ls = local.get("last_synced")
            if installed_ls and last_synced and str(last_synced) < str(installed_ls):
                raise SnapshotRejected("older snapshot may not overwrite a newer local set")

            # THE SHRINK GUARD, checked against what is actually installed right now.
            have = int(local.get("count") or 0)
            if have and len(pairs) < int(have * SHRINK_GUARD_FRAC):
                raise SnapshotRejected(
                    "snapshot shrinks the classification past the guard (%d < %.0f%% of %d) "
                    "-- refusing to de-classify names on the pod that routes live trades"
                    % (len(pairs), SHRINK_GUARD_FRAC * 100, have))

            n = _install(pairs, last_synced)

            # The in-memory class sets are what `classify()` actually answers from, and
            # they are TTL-cached (6h). Without this the table is fresh and the routing
            # decision keeps using the old sets for up to a TTL -- an install that looks
            # applied and is not.
            try:
                from api import ticker_types
                ticker_types.refresh_class_sets()
            except Exception as e:  # noqa: BLE001
                log.warning("[ticker-types-replica] installed but class-set refresh "
                            "failed (stale for up to one TTL): %s", e)

            _STATE["installs"] += 1
            _STATE["last_push_ok_at"] = time.time()
            _STATE["last_push_error"] = None
            log.info("[ticker-types-replica] installed generation %s (%d rows, "
                     "last_synced %s)", (gen or "")[:12], n, last_synced)
            return {"status": "accepted", "generation": gen, "count": n}

        except SnapshotRejected as e:
            _STATE["rejected"] += 1
            _STATE["last_push_error"] = str(e)
            _STATE["last_push_error_at"] = time.time()
            log.warning("[ticker-types-replica] rejected: %s", e)
            return {"status": "rejected", "reason": str(e)}
        except Exception as e:  # noqa: BLE001
            _STATE["rejected"] += 1
            _STATE["last_push_error"] = str(e)
            _STATE["last_push_error_at"] = time.time()
            log.warning("[ticker-types-replica] install failed: %s", e)
            return {"status": "rejected", "reason": "install failed"}


def status() -> dict:
    """Is this pod's routing classification current, and how old is it?

    ⭐ THIS IS THE POINT, NOT A NICETY. The 2026-07-14 freeze lasted 55 days for the
    replica and ~117 days for `ticker_types`, and both were invisible for the same reason:
    nothing reported age. A test can prove the install logic; only telemetry catches the
    next freeze.
    """
    local = local_classification()
    age = None
    ls = local.get("last_synced")
    if ls:
        try:
            import datetime as _dt
            parsed = _dt.datetime.fromisoformat(str(ls))
            age = round((_dt.datetime.now() - parsed).total_seconds())
        except Exception:  # noqa: BLE001
            age = None
    return {
        "receive_enabled": receive_enabled(),
        "local_generation": local.get("generation"),
        "last_synced": ls,
        "age_seconds": age,
        "count": local.get("count"),
        "counts_by_class": local.get("counts_by_class"),
        "shrink_guard_frac": SHRINK_GUARD_FRAC,
        **{k: _STATE[k] for k in sorted(_STATE)},
    }
