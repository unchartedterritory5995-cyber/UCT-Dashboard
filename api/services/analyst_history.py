"""Gap audit P1 + R3 (2026-11-27): the DATED store of analyst actions behind `UPDG`.

WHY THIS EXISTS
---------------
`GET /api/analyst-actions` reads only the last pushed Morning Wire (`engine.get_analyst_actions`), keeps the first 12
upgrades / 12 downgrades / 15 target changes, and holds no history: the wire file is overwritten every morning and
the wire archive (`wire_archive.py`) keeps the rundown html only. So a member could not look at last Tuesday's
upgrades, and a morning with no wire push showed the older wire all day with nothing else to read.

TWO SOURCES, ONE TABLE, EACH ROW NAMES ITS SOURCE
--------------------------------------------------
* ``wire`` -- every push (`/api/push`, and the `/api/push/archive` backfill) records the wire's FULL, uncapped
  `analyst_actions` list under the wire's own date. A re-push of the same date replaces that date's wire rows (what
  members were last served that morning is the record, the `wire_archive.record` rule); the backfill never replaces a
  date a push already recorded.
* ``fmp`` -- the 02:00 nightly FMP analyst pass (`screener/analyst_pass.py`) already reads each target ticker's last
  40 grades (`/stable/grades`) to count its 30-day upgrades and downgrades. It used to throw the rows away; the pass
  now hands its upgrade/downgrade rows here, keyed by the FIRM'S OWN action date. No vendor call is added. The pass
  reaches the actives every night and the rest of the universe once a week, so one day's FMP list can still grow for
  up to a week after that day: a reader must say so. FMP grades carry no price target.
  Licensing: `/stable/grades` is `("fmp", "analyst_grades")`, LA for member display (provider_licensing_class T-34).
  The TheFly-origin grade NEWS feeds (`analyst_actions_news`, U) are NOT read here.

WHERE
-----
A table in the analyst pass's own SQLite file (`analyst_pass.get_db_path()`: `/data/screener_analyst.db` on the
volume; `SCREENER_ANALYST_DB_PATH` in a test). No new setting, and the file is already backed up off-box
(`store_backup`, store `screener_analyst`).

RETENTION: `RETENTION_DAYS` (400) by the row's action date, pruned on every write. This is NOT the TERM-073
append-only revision timeline (kept for years); this module never reads or writes that table.

WHAT IS NEVER DONE
------------------
* A read for a day the store does not hold says so (`held: False`): never a neighbouring day, never today's list.
* A write never raises into its caller (the push, the nightly pass): every public writer catches and logs.
"""
from __future__ import annotations

import contextlib
import logging
import re
import sqlite3
import time
from datetime import date, datetime, timedelta, timezone
from typing import Iterable, Optional

log = logging.getLogger(__name__)

TABLE = "analyst_actions_dated"
RETENTION_DAYS = 400
SOURCES = ("wire", "fmp")
#: The words each list takes. The SAME sets `engine.get_analyst_actions` uses for the default (capped) answer;
#: tests/test_analyst_history.py pins the two to the same split.
UPGRADE_ACTIONS = frozenset({"upgrade", "upgraded", "initiates", "initiated"})
DOWNGRADE_ACTIONS = frozenset({"downgrade", "downgraded"})
PT_ACTIONS = frozenset({"raises pt", "lowers pt"})
#: The most a `full` read returns per list unless the caller asks for less; the route never lifts it.
MAX_PER_LIST = 2000

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ITEM_FIELDS = ("ticker", "action", "firm", "from_rating", "to_rating", "price_target")

_SCHEMA = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
  action_date  TEXT    NOT NULL,
  source       TEXT    NOT NULL,
  seq          INTEGER NOT NULL,
  ticker       TEXT    NOT NULL,
  firm         TEXT    NOT NULL,
  action       TEXT    NOT NULL,
  from_rating  TEXT,
  to_rating    TEXT,
  price_target TEXT,
  recorded_at  INTEGER NOT NULL,
  PRIMARY KEY (action_date, source, ticker, firm, action, seq)
) WITHOUT ROWID;
"""


def parse_date(value) -> str:
    """The canonical `YYYY-MM-DD`, or ValueError. A real calendar date only."""
    if not isinstance(value, str) or not _DATE_RE.match(value):
        raise ValueError(f"not a YYYY-MM-DD date: {value!r}")
    return date.fromisoformat(value).isoformat()


def _db_path() -> str:
    from api.services.screener import analyst_pass
    return analyst_pass.get_db_path()


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path(), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=5000")
    conn.executescript(_SCHEMA)
    return conn


def _today() -> date:
    """The one clock this module reads (Eastern calendar date). Tests patch this."""
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("America/New_York")).date()


def _cutoff() -> str:
    return (_today() - timedelta(days=RETENTION_DAYS)).isoformat()


def _text(v) -> str:
    return str(v if v is not None else "").strip()


def _opt(v) -> Optional[str]:
    s = _text(v)
    return s or None


def _prune(conn: sqlite3.Connection) -> int:
    cur = conn.execute(f"DELETE FROM {TABLE} WHERE action_date < ?", (_cutoff(),))
    return cur.rowcount or 0


# ── writers ─────────────────────────────────────────────────────────────────────────────────────

def record_wire(payload: dict, *, overwrite: bool = True) -> int:
    """Record one wire's FULL `analyst_actions` list under the wire's date. Returns rows written (0 when skipped).

    Skipped, never guessed: no usable date, no `analyst_actions` list, a date older than the retention window.
    Every recorded wire also writes one marker row (seq 0), so an EMPTY list on a dated wire reads as "the wire
    listed none", never as "no wire held". `overwrite=False` (the backfill door) never replaces a date a push already recorded."""
    try:
        if not isinstance(payload, dict):
            return 0
        try:
            ymd = parse_date(payload.get("date"))
        except ValueError:
            return 0
        actions = payload.get("analyst_actions")
        if not isinstance(actions, list):
            return 0
        if ymd < _cutoff():
            return 0
        now = int(time.time())
        rows = []
        for i, a in enumerate(actions):
            if not isinstance(a, dict):
                continue
            ticker = _text(a.get("ticker")).upper()
            action = _text(a.get("action")).lower()
            if not ticker or not action:
                continue
            rows.append((ymd, "wire", i + 1, ticker, _text(a.get("firm")), action,
                         _opt(a.get("from_rating")), _opt(a.get("to_rating")), _opt(a.get("price_target")), now))
        with contextlib.closing(_connect()) as conn:
            held = conn.execute(f"SELECT 1 FROM {TABLE} WHERE action_date = ? AND source = 'wire' LIMIT 1",
                                (ymd,)).fetchone()
            if held and not overwrite:
                return 0
            conn.execute(f"DELETE FROM {TABLE} WHERE action_date = ? AND source = 'wire'", (ymd,))
            # The marker (seq 0): "a wire for this date was recorded", so a wire that listed NO actions reads as
            # "the wire listed none", not as "no wire held".
            conn.execute(f"INSERT INTO {TABLE} (action_date, source, seq, ticker, firm, action, recorded_at) "
                         "VALUES (?, 'wire', 0, '', '', '', ?)", (ymd, now))
            conn.executemany(
                f"INSERT OR IGNORE INTO {TABLE} (action_date, source, seq, ticker, firm, action, from_rating, "
                "to_rating, price_target, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
            _prune(conn)
            conn.commit()
        return len(rows)
    except Exception:
        log.exception("[analyst_history] wire record failed (caller unaffected)")
        return 0


def record_fmp_grades(ticker: str, grades: Iterable, *, since: Optional[str] = None) -> int:
    """Record a ticker's FMP `/stable/grades` upgrade and downgrade rows, each under its own `date`. Returns rows
    newly written. `since` (`YYYY-MM-DD`) drops older rows (the pass passes its own 30-day window). Rows already held
    are kept as first seen (INSERT OR IGNORE)."""
    try:
        sym = _text(ticker).upper()
        if not sym:
            return 0
        floor = max(_cutoff(), since or "")
        now = int(time.time())
        rows = []
        for g in grades or ():
            if not isinstance(g, dict):
                continue
            action = _text(g.get("action")).lower()
            if action not in ("upgrade", "downgrade"):
                continue
            try:
                ymd = parse_date(_text(g.get("date"))[:10])
            except ValueError:
                continue
            if ymd < floor or ymd > _today().isoformat():
                continue
            rows.append((ymd, "fmp", 1, sym, _text(g.get("gradingCompany")), action,
                         _opt(g.get("previousGrade")), _opt(g.get("newGrade")), None, now))
        if not rows:
            return 0
        with contextlib.closing(_connect()) as conn:
            before = conn.total_changes
            conn.executemany(
                f"INSERT OR IGNORE INTO {TABLE} (action_date, source, seq, ticker, firm, action, from_rating, "
                "to_rating, price_target, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
            written = conn.total_changes - before
            _prune(conn)
            conn.commit()
        return written
    except Exception:
        log.exception("[analyst_history] fmp record failed for %s (caller unaffected)", ticker)
        return 0


# ── readers ─────────────────────────────────────────────────────────────────────────────────────

def held_dates() -> list[dict]:
    """Every date the store holds inside the retention window, newest first:
    `[{date, wire: bool, fmp: int}]` (`wire` = a wire was recorded for that date; `fmp` = FMP actions held)."""
    try:
        with contextlib.closing(_connect()) as conn:
            got = conn.execute(
                f"SELECT action_date, "
                "  MAX(CASE WHEN source = 'wire' THEN 1 ELSE 0 END) AS wire, "
                "  SUM(CASE WHEN source = 'fmp' THEN 1 ELSE 0 END) AS fmp "
                f"FROM {TABLE} WHERE action_date >= ? GROUP BY action_date ORDER BY action_date DESC",
                (_cutoff(),)).fetchall()
    except sqlite3.Error:
        log.warning("[analyst_history] date list read failed", exc_info=True)
        return []
    return [{"date": r["action_date"], "wire": bool(r["wire"]), "fmp": int(r["fmp"] or 0)} for r in got]


def read_day(ymd: str) -> dict:
    """Exactly one date: `{date, wire_held, wire_recorded_at, wire: [...], fmp: [...]}`. Items have the wire's
    own field names plus `source`. Raises ValueError for a date that is not a real `YYYY-MM-DD`; a sqlite failure
    propagates (the route answers 503, never "nothing that day")."""
    day = parse_date(ymd)
    with contextlib.closing(_connect()) as conn:
        got = conn.execute(f"SELECT * FROM {TABLE} WHERE action_date = ? ORDER BY source DESC, seq, ticker, firm",
                           (day,)).fetchall()
    out = {"date": day, "wire_held": False, "wire_recorded_at": None, "wire": [], "fmp": []}
    for r in got:
        if r["source"] == "wire" and r["seq"] == 0:
            out["wire_held"] = True
            out["wire_recorded_at"] = datetime.fromtimestamp(r["recorded_at"], timezone.utc).isoformat(
                timespec="seconds")
            continue
        if r["source"] not in SOURCES:
            continue
        out[r["source"]].append({
            "ticker": r["ticker"], "action": r["action"], "firm": r["firm"] or None,
            "from_rating": r["from_rating"], "to_rating": r["to_rating"], "price_target": r["price_target"],
            "source": r["source"],
        })
    return out


# ── shaping (pure) ──────────────────────────────────────────────────────────────────────────────

def _bucket(action: str) -> Optional[str]:
    a = _text(action).lower()
    if a in UPGRADE_ACTIONS:
        return "upgrades"
    if a in DOWNGRADE_ACTIONS:
        return "downgrades"
    if a in PT_ACTIONS:
        return "pt_changes"
    return None


def _firm_key(firm) -> str:
    return re.sub(r"[^a-z0-9]", "", _text(firm).lower())


def merge(wire_items: list, fmp_items: list) -> list:
    """The day's actions, wire first in its own order, then the FMP rows the wire does not already carry. An FMP
    row is a duplicate when the wire has the same ticker, the same list (upgrade / downgrade) and the same firm
    (compared on letters and digits only). Each item keeps its `source`."""
    out = [{**{k: a.get(k) for k in _ITEM_FIELDS}, "source": a.get("source") or "wire"} for a in wire_items or ()]
    seen = {(_text(a["ticker"]).upper(), _bucket(a["action"]), _firm_key(a["firm"])) for a in out}
    for a in fmp_items or ():
        key = (_text(a.get("ticker")).upper(), _bucket(a.get("action")), _firm_key(a.get("firm")))
        if key in seen:
            continue
        seen.add(key)
        out.append({**{k: a.get(k) for k in _ITEM_FIELDS}, "source": "fmp"})
    return out


def split(actions: list, limit: Optional[int] = None) -> dict:
    """The three lists in list order, each cut to `limit` (default and ceiling `MAX_PER_LIST`) FROM THE END, with
    the true totals and which lists were cut. Unknown action words are left out (the default answer does the same)."""
    cap = MAX_PER_LIST if limit is None else max(1, min(int(limit), MAX_PER_LIST))
    lists = {"upgrades": [], "downgrades": [], "pt_changes": []}
    for a in actions or ():
        b = _bucket((a or {}).get("action"))
        if b:
            lists[b].append(a)
    totals = {k: len(v) for k, v in lists.items()}
    return {
        **{k: v[:cap] for k, v in lists.items()},
        "summary": {k: min(n, cap) for k, n in totals.items()},
        "totals": totals,
        "cut": {"limit": cap, "lists": [k for k, n in totals.items() if n > cap], "from": "end"},
    }


# ── the dated / full read behind `GET /api/analyst-actions?date=...&full=1` ────────────────────

#: How long after a day its FMP list can still grow: the nightly pass reaches the rest of the universe once a week.
FMP_SETTLE_DAYS = 7


def actions_view(ymd: Optional[str] = None, limit: Optional[int] = None) -> dict:
    """One day's analyst actions, uncapped (to `limit`, ceiling `MAX_PER_LIST`), both sources folded in.

    No `ymd` = the LATEST pushed wire's date (the default answer's day) with its full list, plus any FMP actions
    held for that date; `wire_status` is then the same verdict the default answer gives. With `ymd` = exactly
    that day: the wire recorded for it (or the live wire, when it is that day's) and the FMP actions dated it;
    `held: False` when the store has neither. `dates` lists every day held, newest first.

    Raises ValueError for a `ymd` that is not a real date; a store failure raises on a dated read (the route
    answers 503) and is reported, never hidden, on the latest read (`store_ok: False`, the live wire still served)."""
    from api.services import engine
    asked = parse_date(ymd) if ymd is not None else None
    wire = engine._load_wire_data()
    live_list = wire.get("analyst_actions") if isinstance(wire, dict) else None
    try:
        live_date = parse_date((wire or {}).get("date")) if isinstance(wire, dict) else None
    except ValueError:
        live_date = None
    target = asked or live_date

    store_ok = True
    stored = {"wire_held": False, "wire_recorded_at": None, "wire": [], "fmp": []}
    dates: list = []
    if target:
        try:
            stored = read_day(target)
        except Exception:
            if asked:
                raise
            store_ok = False
            log.warning("[analyst_history] store read failed for the latest day", exc_info=True)
    try:
        dates = held_dates()
    except Exception:
        store_ok = False

    if target and target == live_date and isinstance(live_list, list):
        wire_items = [{**a, "source": "wire"} for a in live_list if isinstance(a, dict) and _text(a.get("ticker"))]
        wire_held = True
    elif asked is None and isinstance(live_list, list) and live_date is None:
        # A pushed wire with no usable date: its list is still the default answer's list; it is undated.
        wire_items = [{**a, "source": "wire"} for a in live_list if isinstance(a, dict) and _text(a.get("ticker"))]
        wire_held = True
    else:
        wire_items = stored["wire"] if stored["wire_held"] else []
        wire_held = bool(stored["wire_held"])

    out = split(merge(wire_items, stored["fmp"]), limit)
    day_list = [d["date"] for d in dates]
    if live_date and live_date not in day_list:
        day_list = sorted(set(day_list) | {live_date}, reverse=True)
    wire_date = target if wire_held else None
    fmp_count = sum(1 for a in merge(wire_items, stored["fmp"]) if a.get("source") == "fmp")
    may_grow = bool(target) and target >= (_today() - timedelta(days=FMP_SETTLE_DAYS)).isoformat()
    out.update({
        "date": target,
        "requested_date": asked,
        "latest": asked is None,
        "held": bool(wire_held or stored["fmp"]),
        "wire_date": wire_date,
        "wire_status": engine.wire_freshness(wire_date) if asked is None else None,
        "sources": {
            "wire": {"held": wire_held, "count": len(wire_items), "recorded_at": stored.get("wire_recorded_at")},
            "fmp": {"count": fmp_count, "held_rows": len(stored["fmp"]), "may_grow": may_grow,
                    "settle_days": FMP_SETTLE_DAYS},
        },
        "store_ok": store_ok,
        "dates": day_list,
        "retention_days": RETENTION_DAYS,
        "full": True,
    })
    return out
