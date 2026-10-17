"""The TSDR archive as a SOURCE for the Wisdom publish adapters (owner decisions 2026-10-16).

The publish adapters (desk_markers, badges, dossier, brainkb, lookalike, level_alerts) were
built against the Loop store (`wisdom_records`), whose CALL/MENTION rows sit behind the R89
publication floor and are, in production, effectively empty. The archive is a separate store
(`wisdom_archive_*`) that the owner made a member surface on 2026-10-15. This module is the ONE
place the adapters read it from, so each adapter keeps a single shape and never writes SQL
against the archive tables itself.

OWNER DECISIONS THIS MODULE ENCODES (docs/wisdom/LEDGER.md, "Owner decisions 2026-10-16")
1. **The archive bypasses the R89 floor.** It is not an extraction to be voted on: every row
   is a dated, attributed post with a measured outcome, imported by the owner. This is an
   explicit second provider, NOT a weakening of `floor.py` — the Loop's floored reads are
   untouched and still fail closed.
2. **Prices only on aged calls.** entry / stop / target leave this module only for calls
   posted more than PRICE_AGE_SESSIONS trading sessions before today (CONTRACTS:463 keeps a
   recent exit private for 20 sessions; HARD-RULES §0.4d keeps open positions private).
   `public_call` and `levels` are the only two functions that read the level columns.

GATE: every read here is behind `WISDOM_ARCHIVE_ENABLED`, read per call by `enabled()`; the
caller additionally keeps its own adapter flag. With the archive flag off nothing here opens
the store (callers check `enabled()` first; the read functions also return [] when the archive
tables are absent).

CITATION: archive rows cite through the ONE locator grammar (`common.locator`):
    wisdom:archive#<record_id>@record
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Iterable, Optional, Sequence

from api.services.wisdom.core import flags

SOURCE_ID = "archive"
PRICE_AGE_SESSIONS = 20
#: Actions that are the trader's own call on a name, versus a passing mention.
CALL_ACTIONS = ("entry", "idea", "add", "exit", "trim")
MENTION_ACTIONS = ("watch", "flow")
LEVEL_FIELDS = ("entry", "stop", "target")
_CALL_COLS = ("call_id", "record_id", "author_id", "ticker", "direction", "setup", "action", "posted",
              "conf", "outcome_json")


def enabled() -> bool:
    return flags.archive_enabled()


def has_archive(conn) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'wisdom_archive_calls'").fetchone() is not None


def locator(record_id: Optional[str]) -> str:
    from api.services.wisdom.publish.adapters import common

    return common.locator(SOURCE_ID, record_id, path="record")


def subject_ref(row: dict) -> str:
    """`<table>:<key>` for the provenance marker."""
    if row.get("call_id"):
        return f"wisdom_archive_calls:{row['call_id']}"
    return f"wisdom_archive_records:{row.get('record_id')}"


# ── the price gate ───────────────────────────────────────────────────────────

def _day(value) -> Optional[date]:
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def sessions_since(posted, today: date) -> Optional[int]:
    """Trading sessions after `posted` up to and including `today` (weekends and NYSE holidays out)."""
    from api.services.wisdom.core import timeutil

    start = _day(posted)
    if start is None:
        return None
    if start >= today:
        return 0
    calendar_days = (today - start).days
    return calendar_days - timeutil.non_trading_days_between(start, today)


def is_aged(posted, today: Optional[date] = None) -> bool:
    """True only when the call is MORE than PRICE_AGE_SESSIONS sessions old. Unknown age is not aged."""
    n = sessions_since(posted, today or _today())
    return n is not None and n > PRICE_AGE_SESSIONS


def _today() -> date:
    from api.services.wisdom.core import timeutil

    return timeutil.now_et().date()


def aged_before(today: Optional[date] = None) -> str:
    """The latest posted DATE that is aged, as YYYY-MM-DD — for SQL `posted <= ?` prefilters.

    Walks back session by session, so it agrees with `is_aged` by construction."""
    from api.services.wisdom.core import timeutil

    d = today or _today()
    for _ in range(PRICE_AGE_SESSIONS):
        d = timeutil.previous_session(d)
    return (d - timedelta(days=1)).isoformat()


# ── reads ────────────────────────────────────────────────────────────────────

def _outcome(raw) -> dict:
    try:
        out = json.loads(raw or "{}")
    except (TypeError, ValueError):
        return {}
    return out if isinstance(out, dict) else {}


def _call_row(r) -> dict:
    d = {c: r[c] for c in _CALL_COLS}
    d["outcome"] = _outcome(d.pop("outcome_json"))
    d["record_note"] = r["record_note"]
    d["setup_name"] = r["setup_name"]
    return d


def calls(conn, *, tickers: Optional[Iterable[str]] = None, authors: Optional[Iterable[str]] = None,
          actions: Optional[Sequence[str]] = None, directions: Optional[Sequence[str]] = None,
          since: Optional[str] = None, until: Optional[str] = None, order: str = "c.posted DESC, c.call_id DESC",
          limit: Optional[int] = None) -> list[dict]:
    """Archive calls with the record's note and the setup's display name. NO level columns.

    `since` / `until` compare on the posted DATE (inclusive). Callers that need levels go through
    `levels()` / `public_call()`, the two functions the price gate lives in."""
    if not has_archive(conn):
        return []
    from api.services.wisdom.publish.adapters import common

    has_setups = common.table_exists(conn, "wisdom_archive_setups")
    sql = [
        "SELECT c.call_id, c.record_id, c.author_id, c.ticker, c.direction, c.setup, c.action, c.posted, c.conf, "
        "c.outcome_json, r.note AS record_note, ",
        "s.name AS setup_name " if has_setups else "NULL AS setup_name ",
        "FROM wisdom_archive_calls c LEFT JOIN wisdom_archive_records r ON r.record_id = c.record_id ",
        "LEFT JOIN wisdom_archive_setups s ON s.setup_id = c.setup " if has_setups else "",
        "WHERE c.author_id IN (" + ",".join("?" * len(common.team_author_ids())) + ")",
    ]
    params: list = list(common.team_author_ids())
    for col, values in (("c.ticker", [common.normalize_ticker(t) for t in tickers or [] if t] if tickers is not None else None),
                        ("c.author_id", list(authors) if authors is not None else None),
                        ("c.action", list(actions) if actions is not None else None),
                        ("c.direction", list(directions) if directions is not None else None)):
        if values is None:
            continue
        values = [v for v in values if v]
        if not values:
            return []
        sql.append(f" AND {col} IN ({','.join('?' * len(values))})")
        params.extend(values)
    if since:
        sql.append(" AND substr(c.posted, 1, 10) >= ?")
        params.append(str(since)[:10])
    if until:
        sql.append(" AND substr(c.posted, 1, 10) <= ?")
        params.append(str(until)[:10])
    sql.append(f" ORDER BY {order}")
    if limit:
        sql.append(" LIMIT ?")
        params.append(int(limit))
    return [_call_row(r) for r in conn.execute("".join(sql), params)]


def levels(conn, call_ids: Sequence[str], *, today: Optional[date] = None) -> dict:
    """{call_id: [(kind, price), ...]} for AGED calls only — the price gate's read."""
    if not call_ids or not has_archive(conn):
        return {}
    today = today or _today()
    out: dict = {}
    ids = list(dict.fromkeys(call_ids))
    for i in range(0, len(ids), 500):
        chunk = ids[i:i + 500]
        for r in conn.execute(
                f"SELECT call_id, posted, entry, stop, target FROM wisdom_archive_calls "
                f"WHERE call_id IN ({','.join('?' * len(chunk))})", chunk):
            if not is_aged(r["posted"], today):
                continue
            clean = [(k, float(r[k])) for k in LEVEL_FIELDS if isinstance(r[k], (int, float)) and r[k] > 0]
            if clean:
                out[r["call_id"]] = clean
    return out


def public_call(call: dict, call_levels: Optional[list] = None) -> dict:
    """The member-facing shape of one call. `call_levels` comes from `levels()` (aged only)."""
    o = call.get("outcome") or {}
    out = {
        "call_id": call["call_id"], "record_id": call["record_id"], "ticker": call["ticker"],
        "author_id": call["author_id"], "trader": speaker(call["author_id"]),
        "posted": call.get("posted"), "direction": call.get("direction"), "action": call.get("action"),
        "setup": call.get("setup"), "setup_name": call.get("setup_name") or call.get("setup"),
        "outcome": {k: o.get(k) for k in ("r5", "r20", "r60", "sim_R", "status") if o.get(k) is not None},
        "locator": locator(call["record_id"]),
    }
    if call_levels:
        out["levels"] = [{"kind": k, "price": p} for k, p in call_levels]
    return out


def has_setups(conn) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'wisdom_archive_setups'").fetchone() is not None


_SETUP_JSON = (("stats", {}), ("context", {}), ("teachings", []), ("winners", []), ("failures", []))


def setups(conn, setup_ids: Sequence[str]) -> dict:
    """{setup_id: playbook} for the named archive setups: name plus the parsed stats, context,
    teachings, winners and failures. It reads no call level column; a caller that needs a call's
    prices asks `levels()`, where the price gate lives. {} when the setups table is absent."""
    ids = list(dict.fromkeys(s for s in setup_ids if s))
    if not ids or not has_setups(conn):
        return {}
    from api.services.wisdom.publish.adapters import common

    out: dict = {}
    for r in conn.execute(
            "SELECT setup_id, name, stats_json, context_json, teachings_json, winners_json, failures_json "
            f"FROM wisdom_archive_setups WHERE setup_id IN ({','.join('?' * len(ids))})", ids):
        d = {"setup_id": r["setup_id"], "name": r["name"]}
        for k, default in _SETUP_JSON:
            d[k] = common.parse_json(r[f"{k}_json"], default)
        out[r["setup_id"]] = d
    return out


def records(conn, *, types: Sequence[str], since: Optional[str] = None, limit: Optional[int] = None,
            order: str = "stated_date ASC, record_id ASC") -> list[dict]:
    """Team records of the given types: record_id, author_id, stated_date, record_type, tickers, note, quote."""
    if not types or not has_archive(conn):
        return []
    from api.services.wisdom.publish.adapters import common

    team = common.team_author_ids()
    sql = ("SELECT record_id, author_id, stated_date, record_type, tickers, note, quote FROM wisdom_archive_records "
           f"WHERE record_type IN ({','.join('?' * len(types))}) AND author_id IN ({','.join('?' * len(team))})")
    params: list = [*types, *team]
    if since:
        sql += " AND stated_date >= ?"
        params.append(str(since)[:10])
    sql += f" ORDER BY {order}"
    if limit:
        sql += " LIMIT ?"
        params.append(int(limit))
    return [dict(r) for r in conn.execute(sql, params)]


def search(conn, query: str, *, limit: int = 3, types: Sequence[str] = ("LESSON",)) -> list[dict]:
    """FTS over archive records of the given types (team authors only). [] when FTS is absent."""
    if not has_archive(conn):
        return []
    from api.services.wisdom.archive import service
    from api.services.wisdom.publish.adapters import common

    match = service.build_match(query)
    if not match or not common.table_exists(conn, "wisdom_archive_fts"):
        return []
    team = common.team_author_ids()
    rows = conn.execute(
        "SELECT f.record_id, f.author_id, f.record_type, f.stated_date FROM wisdom_archive_fts f "
        f"WHERE wisdom_archive_fts MATCH ? AND f.record_type IN ({','.join('?' * len(types))}) "
        f"AND f.author_id IN ({','.join('?' * len(team))}) ORDER BY bm25(wisdom_archive_fts) ASC LIMIT ?",
        (match, *types, *team, int(limit))).fetchall()
    return [dict(r) for r in rows]


def speaker(author_id: Optional[str]) -> str:
    from api.services.wisdom.publish.adapters import common

    return common.speaker(author_id)


def pct(value) -> Optional[str]:
    try:
        x = float(value) * 100
    except (TypeError, ValueError):
        return None
    return f"{'+' if x > 0 else ''}{x:.1f}%"
