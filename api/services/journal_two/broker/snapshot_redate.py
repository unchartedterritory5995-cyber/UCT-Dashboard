"""Re-date equity snapshots from SYNC day to the SESSION they belong to.

`write_balances` stamped every daily net-liq snapshot with the ET date of the
sync. The balance sync runs ~03:40 ET — before the open — so the equity it
carried was the PREVIOUS session's close. Measured on prod 2026-08-29: Friday's
close was filed under Saturday, Thursday's close appeared under both Thursday
and Friday, and the weekend had points at all. `timeutil.session_day_et` now
fixes the WRITER; this fixes the rows already on disk.

The mapping is derived, never typed: each row carries its own `synced_at`, so
the session it belongs to is a pure function of a value the row already holds.
Rows written by `history_backfill` carry a `backfill:<date>` marker instead of
a timestamp — `session_day_et` returns None for those and they are LEFT ALONE
(they came from a daily mark-to-market replay and are already session-dated).

Collisions are the point, not an accident: several sync-day rows collapse onto
one session. The winner is the LATEST `synced_at`, which mirrors the writer's
own latest-write-wins ON CONFLICT and picks the most-settled reading (2026-08-21
kept a pre-settlement 10,517.48 while the Saturday sync had filed the settled
10,607.50 under 08-22 — after this, the session holds 10,607.50).

A live row moving onto a date held by a BACKFILL row displaces it: a real
broker reading beats a replayed estimate, the same precedence
`history_backfill`'s own INSERT OR IGNORE encodes.

SAFETY: `run()` is dry-run BY DEFAULT and writes a full JSON backup of every
row it is about to touch before it mutates anything. Deletes are by rowid, so
a backfill row that merely shares a date with something being moved is never
collateral damage.
"""

from __future__ import annotations

import json
import os
import sqlite3
import tempfile
from collections import defaultdict
from datetime import date, datetime, timezone
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import timeutil

_TABLE = "j2_broker_equity_snapshots"
_COLS = ("user_id", "broker_account_id", "snapshot_date", "total_equity",
         "cash", "market_value", "synced_at")


def _backup_path() -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return os.path.join(os.environ.get("DATA_DIR", "/data"),
                        f"equity_snapshot_redate_backup_{ts}.json")


def _write_backup(path: str, rows: list[dict]) -> str:
    """Encode → temp file → os.replace. A bare open(w) truncates BEFORE the
    encode can fail, which would destroy the backup we are about to rely on."""
    payload = json.dumps({"table": _TABLE, "rows": rows}, indent=1).encode("utf-8")
    d = os.path.dirname(path) or "."
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(payload)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return path


def _is_weekend(iso_day: str | None) -> bool:
    try:
        return date.fromisoformat(str(iso_day)).weekday() >= 5
    except (ValueError, TypeError):
        return False


def _compute(conn: sqlite3.Connection) -> dict[str, Any]:
    """Pure planning pass: what would change, and why. No writes."""
    rows = conn.execute(
        f"SELECT rowid AS rid, {', '.join(_COLS)} FROM {_TABLE}"
    ).fetchall()

    # Group the RE-DATABLE rows (those carrying a real timestamp) by the
    # session they belong to. Backfill rows are untouched by construction.
    by_target: dict[tuple, list[sqlite3.Row]] = defaultdict(list)
    skipped_no_timestamp = 0
    for r in rows:
        target = timeutil.session_day_et(r["synced_at"])
        if target is None:
            skipped_no_timestamp += 1
            continue
        by_target[(r["user_id"], r["broker_account_id"], target)].append(r)

    # Everything already sitting on a date, so a winner can spot what it displaces.
    at_date: dict[tuple, list[sqlite3.Row]] = defaultdict(list)
    for r in rows:
        at_date[(r["user_id"], r["broker_account_id"], r["snapshot_date"])].append(r)

    winners: list[dict] = []
    delete_rids: set[int] = set()
    moved = merged = displaced_backfill = weekend_removed = 0

    for (user_id, acct_id, target), group in by_target.items():
        group = sorted(group, key=lambda r: str(r["synced_at"]))
        win = group[-1]
        for loser in group[:-1]:
            delete_rids.add(loser["rid"])
            merged += 1
            if _is_weekend(loser["snapshot_date"]):
                weekend_removed += 1
        # Anything already parked on the target date that is not the winner
        # (a backfill estimate, or a row whose own timestamp maps elsewhere).
        for other in at_date.get((user_id, acct_id, target), []):
            if other["rid"] == win["rid"] or other["rid"] in delete_rids:
                continue
            if timeutil.session_day_et(other["synced_at"]) is None:
                displaced_backfill += 1
            delete_rids.add(other["rid"])
        if win["snapshot_date"] != target:
            moved += 1
            if _is_weekend(win["snapshot_date"]):
                weekend_removed += 1
        delete_rids.add(win["rid"])
        winners.append({
            "user_id": user_id, "broker_account_id": acct_id,
            "snapshot_date": target, "total_equity": win["total_equity"],
            "cash": win["cash"], "market_value": win["market_value"],
            "synced_at": win["synced_at"],
            "_was": win["snapshot_date"], "_rid": win["rid"],
        })

    touched = [dict(r) for r in rows if r["rid"] in delete_rids]
    return {
        "scanned": len(rows),
        "skipped_no_timestamp": skipped_no_timestamp,
        "sessions": len(winners),
        "moved": moved,
        "merged_duplicates": merged,
        "displaced_backfill": displaced_backfill,
        "weekend_points_removed": weekend_removed,
        "_winners": winners,
        "_delete_rids": sorted(delete_rids),
        "_touched": touched,
    }


def plan(conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """Read-only summary of what `run()` would do, plus a few examples."""
    own = conn is None
    conn = conn or get_connection()
    try:
        res = _compute(conn)
    finally:
        if own:
            conn.close()
    examples = [
        {"from": w["_was"], "to": w["snapshot_date"], "equity": w["total_equity"]}
        for w in res["_winners"] if w["_was"] != w["snapshot_date"]
    ]
    examples.sort(key=lambda e: e["to"], reverse=True)
    return {k: v for k, v in res.items() if not k.startswith("_")} | {
        "examples": examples[:10],
    }


def run(conn: sqlite3.Connection | None = None, *, dry_run: bool = True) -> dict[str, Any]:
    """Apply the re-dating. DRY RUN BY DEFAULT — pass dry_run=False to write.

    Idempotent: a session-dated row's own `synced_at` maps back to the same
    session, so a second run finds nothing to move.
    """
    own = conn is None
    conn = conn or get_connection()
    try:
        res = _compute(conn)
        summary = {k: v for k, v in res.items() if not k.startswith("_")}
        summary["dry_run"] = dry_run
        if dry_run or not res["_delete_rids"]:
            summary["backup"] = None
            return summary

        summary["backup"] = _write_backup(_backup_path(), res["_touched"])
        cur = conn.cursor()
        cur.execute("BEGIN")
        try:
            cur.executemany(f"DELETE FROM {_TABLE} WHERE rowid = ?",
                            [(r,) for r in res["_delete_rids"]])
            cur.executemany(
                f"INSERT INTO {_TABLE} ({', '.join(_COLS)}) "
                f"VALUES (?, ?, ?, ?, ?, ?, ?)",
                [tuple(w[c] for c in _COLS) for w in res["_winners"]],
            )
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        return summary
    finally:
        if own:
            conn.close()
