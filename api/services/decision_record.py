"""TERM-088 (item 15 ACC-02) -- the decision record, read for a member.

WHAT THE STORE IS (verified 2026-09-28, not assumed)
----------------------------------------------------
`wire_universe` x `wire_issues` in the engine's `uct_intelligence.db`. The
Morning Wire engine writes one `wire_universe` row per (issue, ticker) it
CONSIDERED: `dropped_at_stage` is NULL for a name that passed every stage and
the stage number for one it rejected, with a `drop_reason`. Columns measured by
item 15 / the product vision (PRAGMA table_info): issue_id, ticker, sources,
feature_vector, dropped_at_stage, drop_reason, is_exploration, created_at.
`issue_id` is the session date (the admin Wisdom replay queries it as
`session.isoformat()`); `wire_issues` holds one row per published issue with its
`sent_at`.

THE TRANSPORT IS THE ONE THAT ALREADY SHIPS. The nightly Brain Pack installs
the engine DB on the pod at `<brain_dir>/data/uct_intelligence.db`
(`api/services/brain_sync.py`); the admin replay reads `wire_universe` from that
exact path. This module reads the same file the same way -- `?mode=ro` by URI
-- and nothing here writes to it.

⛔ A LAYER THAT COULD NOT BE READ IS NOT A LAYER THAT IS EMPTY. Four answers,
never collapsed into each other:
  considered      the ticker has rows; each carries its stage and issue
  not_considered  the record is readable, holds issues, and has no row for it
  empty_record    the record is readable and holds no issues at all
  unavailable     the file, the table or the read failed -- says WHY
An `unavailable` record is never reported as `not_considered`.

⛔ EVERY COUNT IS DERIVED off the rows at request time, never typed: the
record's own coverage (issues held, span, weekdays in the span) rides every
readable answer so its youth is visible rather than implied. No rate is
computed and nothing is annualised (CLM-17).

⛔ DARK behind `DECISION_RECORD_MEMBER_ENABLED`, read PER CALL, unset = OFF.
Owner decision pending (backlog TERM-088 `ACT:`): whether the firm's
rejection record may be shown to members at all is a product call.
"""
from __future__ import annotations

import datetime
import logging
import os
import re
import sqlite3
from typing import Optional

logger = logging.getLogger(__name__)

FLAG = "DECISION_RECORD_MEMBER_ENABLED"

STORE = "uct_intelligence.db"
TABLES = ["wire_universe", "wire_issues"]

#: Stage numbers as documented by the D-13 inventory
#: (`docs/terminal-research/05-product-strategy/proprietary-asset-inventory-raw.md`
#: §c: "dropped_at_stage 1=universe / 2=gate / 3=lens"). A stage outside this
#: map renders as its NUMBER with no label -- never a guessed one.
STAGE_LABELS = {1: "universe", 2: "gate", 3: "lens"}

DEFAULT_LIMIT = 50
MAX_LIMIT = 100

_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_REQUIRED = {"issue_id", "ticker", "dropped_at_stage"}


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF (an enablement gate on a dark surface)."""
    return os.environ.get(FLAG, "0").strip().lower() in ("1", "true", "yes", "on")


def db_path() -> str:
    from api.services import brain_sync
    return os.path.join(brain_sync.brain_dir(), "data", STORE)


class RecordUnavailable(RuntimeError):
    pass


def _open_ro(path: Optional[str]) -> sqlite3.Connection:
    """The ONE open. `mode=ro` by URI: SQLite refuses every write through it."""
    if not path or not os.path.exists(path):
        raise RecordUnavailable("source_file_missing")
    conn = sqlite3.connect("file:" + str(path).replace("\\", "/") + "?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _columns(conn: sqlite3.Connection, table: str) -> set:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def _pack_installed_at() -> Optional[str]:
    try:
        from api.services import brain_sync
        ts = brain_sync.installed_ts()
    except Exception:  # noqa: BLE001 -- provenance is best-effort, never fatal
        return None
    if not ts:
        return None
    try:
        return datetime.datetime.fromtimestamp(int(ts), tz=datetime.timezone.utc).isoformat()
    except (OverflowError, OSError, ValueError):
        return None


def _as_date(s) -> Optional[datetime.date]:
    s = str(s or "")[:10]
    if not _ISO_DATE.match(s):
        return None
    try:
        return datetime.date.fromisoformat(s)
    except ValueError:
        return None


def coverage(conn: sqlite3.Connection) -> dict:
    """The record's OWN coverage, derived off `wire_universe`: how many issues it
    holds, the span they cover, and how many weekdays that span contains -- so
    'not every session' is a number on the surface, not an adjective."""
    row = conn.execute(
        "SELECT COUNT(DISTINCT issue_id) AS n, MIN(issue_id) AS lo, MAX(issue_id) AS hi FROM wire_universe"
    ).fetchone()
    held = int(row["n"] or 0)
    lo, hi = _as_date(row["lo"]), _as_date(row["hi"])
    span_days = weekdays = months = None
    if held and lo and hi and hi >= lo:
        span_days = (hi - lo).days + 1
        weekdays = sum(1 for i in range(span_days) if (lo + datetime.timedelta(days=i)).weekday() < 5)
        months = int(round(span_days / 30.44))
    return {
        "issues_held": held,
        "first_issue": row["lo"] if held else None,
        "last_issue": row["hi"] if held else None,
        "span_days": span_days,
        "weekdays_in_span": weekdays,
        "span_months": months,
    }


def _entities_by_issue(ticker: str, issue_ids: list) -> Optional[dict]:
    """TERM-023: when the Entity Master member path is armed, key each issue's
    row to the entity that held the ticker ON THAT ISSUE'S DATE -- a reused
    ticker over five months is exactly where a bare string bites. Dark, it is
    not consulted at all."""
    from api.services.entity_master import member_resolve
    if not member_resolve.is_enabled():
        return None
    from api.services.entity_master import api as em_api
    out = {}
    for iid in issue_ids:
        when = str(iid)[:10] if _as_date(iid) else None
        try:
            r = em_api.resolve(ticker, as_of=when)
            ok = r.status == "resolved" and r.entity is not None
            out[iid] = (r.entity.entity_id if ok else None, r.status)
        except Exception as exc:  # noqa: BLE001 -- an unreadable store is not "no entity"
            logger.warning("[decision_record] entity resolve failed: %s", exc)
            out[iid] = (None, "unavailable")
    return out


def normalize_ticker(t: str) -> str:
    return (t or "").strip().upper()


def ticker_record(ticker: str, *, limit: int = DEFAULT_LIMIT, offset: int = 0,
                  path: Optional[str] = None) -> dict:
    """Every issue that considered `ticker`, newest first, with the stage each
    rejection happened at -- beside the issues it passed. See the module
    docstring for the four statuses."""
    t = normalize_ticker(ticker)
    body = {
        "ticker": t,
        "status": "unavailable",
        "reason": None,
        "rows": [],
        "counts": None,
        "coverage": None,
        "paging": {"limit": limit, "offset": offset, "total_rows": None},
        "entity": {"enabled": False, "distinct_entities": None},
        "source": {"store": STORE, "tables": list(TABLES), "pack_installed_at": _pack_installed_at()},
    }
    conn = None
    try:
        conn = _open_ro(path if path is not None else db_path())
        cols = _columns(conn, "wire_universe")
        if not cols:
            raise RecordUnavailable("table_missing:wire_universe")
        if not _REQUIRED <= cols:
            raise RecordUnavailable("schema_mismatch:wire_universe")
        issue_cols = _columns(conn, "wire_issues")
        join_sent = {"issue_id", "sent_at"} <= issue_cols

        cov = coverage(conn)
        body["coverage"] = cov

        agg = conn.execute(
            "SELECT COUNT(*) AS n_rows, COUNT(DISTINCT issue_id) AS n_issues,"
            " COUNT(DISTINCT CASE WHEN dropped_at_stage IS NULL THEN issue_id END) AS n_passed,"
            " COUNT(DISTINCT CASE WHEN dropped_at_stage IS NOT NULL THEN issue_id END) AS n_dropped"
            " FROM wire_universe WHERE UPPER(ticker) = ?", (t,)).fetchone()
        by_stage = {
            str(r["s"]): int(r["n"]) for r in conn.execute(
                "SELECT dropped_at_stage AS s, COUNT(*) AS n FROM wire_universe"
                " WHERE UPPER(ticker) = ? AND dropped_at_stage IS NOT NULL GROUP BY 1 ORDER BY 1", (t,))
        }
        total = int(agg["n_rows"] or 0)
        body["paging"]["total_rows"] = total

        if cov["issues_held"] == 0:
            body["status"] = "empty_record"
            return body
        if total == 0:
            body["status"] = "not_considered"
            body["counts"] = {"rows": 0, "issues_considered": 0, "issues_passed": 0,
                              "issues_dropped": 0, "by_stage": {}}
            return body

        body["counts"] = {
            "rows": total,
            "issues_considered": int(agg["n_issues"] or 0),
            "issues_passed": int(agg["n_passed"] or 0),
            "issues_dropped": int(agg["n_dropped"] or 0),
            "by_stage": by_stage,
        }

        opt = [c for c in ("drop_reason", "is_exploration", "created_at") if c in cols]
        sel = ", ".join(["u.issue_id", "u.dropped_at_stage"] + [f"u.{c}" for c in opt]
                        + (["i.sent_at AS sent_at"] if join_sent else []))
        join = " LEFT JOIN wire_issues i ON i.issue_id = u.issue_id" if join_sent else ""
        page = conn.execute(
            f"SELECT {sel} FROM wire_universe u{join} WHERE UPPER(u.ticker) = ?"
            " ORDER BY u.issue_id DESC, u.rowid DESC LIMIT ? OFFSET ?", (t, limit, offset)).fetchall()

        all_issues = [r[0] for r in conn.execute(
            "SELECT DISTINCT issue_id FROM wire_universe WHERE UPPER(ticker) = ?", (t,))]
        entities = _entities_by_issue(t, all_issues)

        rows = []
        for r in page:
            keys = r.keys()
            stage = r["dropped_at_stage"]
            row = {
                "issue_id": r["issue_id"],
                "sent_at": r["sent_at"] if "sent_at" in keys else None,
                "outcome": "passed" if stage is None else "dropped",
                "dropped_at_stage": stage,
                "stage_label": STAGE_LABELS.get(stage) if stage is not None else None,
                "drop_reason": r["drop_reason"] if "drop_reason" in keys else None,
                "is_exploration": bool(r["is_exploration"]) if "is_exploration" in keys and r["is_exploration"] is not None else None,
                "created_at": r["created_at"] if "created_at" in keys else None,
            }
            if entities is not None:
                eid, est = entities.get(r["issue_id"], (None, "not_found"))
                row["entity_id"] = eid
                row["entity_status"] = est
            rows.append(row)
        body["rows"] = rows
        if entities is not None:
            body["entity"] = {"enabled": True,
                              "distinct_entities": len({e for e, _ in entities.values() if e})}
        body["status"] = "considered"
        return body
    except RecordUnavailable as exc:
        body.update(status="unavailable", reason=str(exc), rows=[], counts=None, coverage=None)
        return body
    except sqlite3.Error as exc:
        logger.warning("[decision_record] read failed: %s", exc)
        body.update(status="unavailable", reason=f"source_error:{type(exc).__name__}",
                    rows=[], counts=None, coverage=None)
        return body
    finally:
        if conn is not None:
            conn.close()
