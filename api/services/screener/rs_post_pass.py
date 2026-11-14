"""The RS screens post-pass: one rating session on every screener row, its date, and
each liquid stock's exact place in the RS Rating order.

Plan: ``2026-11-14-uct-rs-screens-plan-v2.md`` sections 1.1, 2 (item 2) and 9. Unit U1.

WHY IT EXISTS
-------------
1. The 03:00 ET build reads the NEWEST stored rating session
   (``snapshot_builder._read_rs_history_fields``) and the rating job writes the settled
   session at 04:15 ET, so a row carried the PREVIOUS session's rating beside today's
   bars. Rows the resume job rebuilt after 04:15 read the new session, so one table
   could hold two rating sessions and nothing recorded which.
2. A rating is an integer 1 to 99 and dozens of names share each value (19 names at 99
   on 2026-11-13). A ranking needs an exact place, and the unrounded ``score`` behind
   the rating was stored per session in ``rs_rating_history`` and shown nowhere.

WHAT ONE PASS DOES (:func:`run`), over ``screener_rows``
--------------------------------------------------------
* Resolves the screener's settled session S (``snapshot_builder.settled_session``) and
  reads ``rs_history.read_fields(tickers, session=S)`` (an exact match).
* S STORED: every row's rating columns are rewritten to S through the build's own
  mapping (``snapshot_builder._RS_HISTORY_COLUMNS``), ``rs_rating_session`` says S, and
  the exact places are filled. A row with no history row in S gets NULL ratings and a
  NULL stamp, never another session's number.
* S NOT STORED YET (every 03:00 build; the rating job has not run): no RATING column
  is rewritten. A row is stamped with the newest stored session only when its rating
  columns equal that session's (checked column by column), otherwise the stamp is
  NULL: a stamp is a statement about the numbers beside it, never a guess. The receipt
  says ``reason = session_not_stored``.
  ⭐ NO BLANK WINDOW (unit U4, 2026-11-14): the stamped rows still get their score,
  their places and their rating a month ago, from the session they are stamped with.
  Before, every place was NULL from the 03:00 build until the 04:15 rating job (and
  all day when that job failed), so a screen that filters on a place was empty. These
  carried places are written to the rows only: ``rs_pos_history`` keeps the ranking
  the rating job's own pass stored for that session.
* The OVERALL place is taken among rows on the RS LIQUID FLOOR (:data:`LIQUID_FLOOR`),
  ordered by the unrounded score, highest first; ties by the 3-month value, then
  dollar volume, then ticker, so no two rows share a place.
* Each PERIOD place (1, 3, 6, 12 months) needs only liquidity and that period's own
  stored value (unit U4): a stock listed under a year ago has no overall place and is
  still ranked on the boards its history covers. A period board can therefore be
  longer than the overall one.
* ``rs_rating_prev20`` is the RS Rating 20 stored sessions earlier (the rating minus
  the 20-session change the same history read returned), NULL when either is unknown.

WHEN IT RUNS. At the end of EVERY ``snapshot_builder.run_build`` (the build upserts
whole rows with INSERT OR REPLACE, so a single nightly pass would be wiped by the next
build) and after the rating job and its catch-up (``api.main._run_rs_post_pass``),
where screen membership is then re-recorded on the new ratings.

DARK BY DEFAULT. ``RS_SCREENS_ENABLED`` is read per call (only the literal ``1`` arms
it). Off, :func:`run` returns before it opens the database: no column is written, no
table is created and no receipt is stored.
"""
from __future__ import annotations

import json
import logging
import os
import time
from contextlib import closing

from . import snapshot_db

log = logging.getLogger(__name__)

FLAG = "RS_SCREENS_ENABLED"

#: THE RS LIQUID FLOOR, the one copy (plan section 1 and owner decision D7: "stocks and
#: ADRs, price $10+, $20M+ traded daily (30-day)"). ``full_year_column`` is the
#: full-year-of-history test: the 12-month rank exists only for a series that reaches
#: 252 sessions back inside its current listing. Other units read these; nothing
#: retypes them.
LIQUID_FLOOR = {
    "price_min": 10.0,
    "dollar_vol_30d_min": 20_000_000.0,
    "exclude_etfs": True,
    "full_year_column": "rs_rating_12m",
}

#: The columns only this pass writes (``snapshot_db.POST_PASS_COLUMNS`` is the schema's
#: copy of the same set; the build's ``empty_columns`` receipt leaves them to this
#: pass's own receipt).
OWNED_COLUMNS = ("rs_rating_session", "rs_rating_score", "rs_rating_pos", "rs_rating_pos_n",
                 "rs_pos_1m", "rs_pos_3m", "rs_pos_6m", "rs_pos_12m", "rs_rating_pos_prev20",
                 "rs_rating_prev20")
#: ``place column -> the stored per-period value it is ordered by`` (``rs_rating_history``
#: ``v1/v3/v6/v12``: the numbers the 1 to 99 ranks were taken over).
PERIOD_PLACES = (("rs_pos_1m", "v1"), ("rs_pos_3m", "v3"),
                 ("rs_pos_6m", "v6"), ("rs_pos_12m", "v12"))

#: One row per ranked stock per session: the overall place and the population size.
POS_TABLE = "rs_pos_history"
#: Sessions kept (about 19 months): "a month ago" needs 21, the rest is room for a chart.
POS_KEEP_SESSIONS = 400
#: ``rs_rating_pos_prev20`` reads the place this many STORED sessions earlier.
PREV_SESSIONS = 20
RUNS_TABLE = "rs_post_pass_runs"
RUNS_KEEP = 60

_POS_SQL = f"""
CREATE TABLE IF NOT EXISTS {POS_TABLE} (
    session TEXT NOT NULL,
    ticker TEXT NOT NULL,
    pos INTEGER NOT NULL,
    n INTEGER NOT NULL,
    PRIMARY KEY (session, ticker)
)"""
_RUNS_SQL = f"""
CREATE TABLE IF NOT EXISTS {RUNS_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session TEXT, source TEXT, started_at REAL, finished_at REAL, note TEXT
)"""


def enabled() -> bool:
    """``RS_SCREENS_ENABLED``, read PER CALL (only the literal ``1`` arms it), so a flip
    needs no restart and a rollback is an unset. Ledger: docs/feature_flags.json.
    The name is spelled out here (not read from :data:`FLAG`) because the ledger's index
    of gates is derived from the literal (``feature_flag_index``)."""
    return os.environ.get("RS_SCREENS_ENABLED", "0") == "1"


# --------------------------------------------------------------------------- #
# pure: the floor and the order
# --------------------------------------------------------------------------- #

def _num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def on_liquid_floor(row: dict, *, full_year: bool = True) -> bool:
    """Is this screener row on :data:`LIQUID_FLOOR`? ``row`` carries ``is_etf``,
    ``price``, ``dollar_vol_30d`` and the full-year column. A missing price or volume
    is off the floor (no value is not a pass).

    ``full_year=False`` asks for liquidity alone (unit U4): the per-period boards take
    a stock with under a year of history, the overall board does not."""
    if LIQUID_FLOOR["exclude_etfs"] and row.get("is_etf"):
        return False
    price, dv = _num(row.get("price")), _num(row.get("dollar_vol_30d"))
    if price is None or price < LIQUID_FLOOR["price_min"]:
        return False
    if dv is None or dv < LIQUID_FLOOR["dollar_vol_30d_min"]:
        return False
    return (not full_year) or row.get(LIQUID_FLOOR["full_year_column"]) is not None


def exact_places(candidates: list, value_key: str) -> dict:
    """``{TICKER: place}``, 1 = strongest, over the candidates whose ``value_key`` is a
    number. Order: that value, highest first; ties by ``v3`` (highest first, none
    last), then ``dollar_vol_30d`` (highest first, none last), then ticker (A first).
    The ticker is unique, so the places are 1..n with no two rows sharing one.

    ``candidates`` are dicts with ``ticker``, ``dollar_vol_30d``, ``v3`` and
    ``value_key``; the caller has already applied the floor."""
    def _desc(v):
        f = _num(v)
        return (1, 0.0) if f is None else (0, -f)

    ranked = [c for c in candidates if _num(c.get(value_key)) is not None]
    ranked.sort(key=lambda c: (-_num(c[value_key]), _desc(c.get("v3")),
                               _desc(c.get("dollar_vol_30d")), str(c["ticker"])))
    return {c["ticker"]: i for i, c in enumerate(ranked, 1)}


# --------------------------------------------------------------------------- #
# storage: the place history and the receipts
# --------------------------------------------------------------------------- #

def _table_exists(conn, name: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
                        (name,)).fetchone() is not None


def _store_places(conn, session: str, places: dict) -> None:
    """Make ``rs_pos_history`` hold exactly ``places`` for ``session`` (delete then
    insert, so a second pass leaves one row per ticker and no row for a name that left
    the floor), then trim to the newest :data:`POS_KEEP_SESSIONS` sessions."""
    n = len(places)
    conn.execute(_POS_SQL)
    conn.execute(f"DELETE FROM {POS_TABLE} WHERE session = ?", (session,))
    conn.executemany(f"INSERT INTO {POS_TABLE} (session, ticker, pos, n) VALUES (?, ?, ?, ?)",
                     [(session, t, p, n) for t, p in places.items()])
    cut = conn.execute(
        f"SELECT session FROM (SELECT DISTINCT session FROM {POS_TABLE} "
        "ORDER BY session DESC LIMIT 1 OFFSET ?)", (POS_KEEP_SESSIONS - 1,)).fetchone()
    if cut is not None:
        conn.execute(f"DELETE FROM {POS_TABLE} WHERE session < ?", (cut[0],))


def _earlier_session(conn, session: str, back: int = PREV_SESSIONS):
    """The session ``back`` STORED sessions before ``session`` in ``rs_pos_history``, or
    None when that much history does not exist. One primary-key seek per step."""
    cur = session
    for _ in range(back):
        cur = conn.execute(f"SELECT MAX(session) FROM {POS_TABLE} WHERE session < ?",
                           (cur,)).fetchone()[0]
        if cur is None:
            return None
    return cur


def _record(receipt: dict) -> None:
    """Persist one pass's receipt. Never raises (the ``record_build_run`` contract)."""
    try:
        with closing(snapshot_db.connect()) as conn:
            conn.execute(_RUNS_SQL)
            conn.execute(
                f"INSERT INTO {RUNS_TABLE} (session, source, started_at, finished_at, note) "
                "VALUES (?, ?, ?, ?, ?)",
                (receipt.get("session"), receipt.get("source"), receipt.get("started_at"),
                 receipt.get("finished_at"), json.dumps(receipt, sort_keys=True, default=str)))
            conn.execute(f"DELETE FROM {RUNS_TABLE} WHERE id NOT IN (SELECT id FROM {RUNS_TABLE} "
                         "ORDER BY id DESC LIMIT ?)", (RUNS_KEEP,))
            conn.commit()
    except Exception as e:                                   # noqa: BLE001
        log.warning("[rs_post_pass] receipt not written: %s", e)


def last_run() -> dict | None:
    """The newest pass receipt, or None. Read-only (a dark pod carries no table) and
    never raises. ``snapshot_db.status()`` serves it as ``rs_post_pass``."""
    try:
        with closing(snapshot_db.connect()) as conn:
            if not _table_exists(conn, RUNS_TABLE):
                return None
            r = conn.execute(f"SELECT note FROM {RUNS_TABLE} ORDER BY id DESC LIMIT 1").fetchone()
        return json.loads(r[0]) if r and r[0] else None
    except Exception:                                        # noqa: BLE001
        return None


# --------------------------------------------------------------------------- #
# the pass
# --------------------------------------------------------------------------- #

def _rating_map() -> dict:
    """``snapshot column -> read_fields key``: the build's own mapping, so the pass and
    the build can never disagree about which stored number is which column."""
    from . import snapshot_builder                           # noqa: PLC0415 - lazy: no cycle
    return dict(snapshot_builder._RS_HISTORY_COLUMNS)


def _rank_ibd_on() -> bool:
    try:
        from api.services import rs_ranking                  # noqa: PLC0415 - lazy
        return bool(rs_ranking.rs_rank_ibd_enabled())
    except Exception:                                        # noqa: BLE001
        return False


def run(session=None, *, source: str = "manual", now=None) -> dict:
    """One pass over ``screener_rows`` (module docstring). Returns its receipt and
    never raises.

    ``session`` defaults to the screener's settled session. The receipt carries
    ``session`` (the one asked for), ``rating_session`` (the one the rows now say, or
    None), ``rewritten`` (were the rating columns moved onto ``session``),
    ``reason`` when nothing was rewritten, the row counts, and ``populated``: the
    non-null count of every column this pass owns, for the build's own receipt."""
    t0 = time.time()
    receipt = {"ok": False, "enabled": enabled(), "source": source, "session": None,
               "rating_session": None, "rewritten": False, "reason": None, "rows": 0,
               "started_at": t0, "finished_at": None, "duration_ms": 0.0}
    if not receipt["enabled"]:
        receipt["reason"] = "disabled"
        return receipt
    try:
        _run(receipt, session, now)
    except Exception as e:                                   # noqa: BLE001 - never costs the build
        log.warning("[rs_post_pass] failed: %s: %s", type(e).__name__, e)
        receipt["ok"] = False
        receipt["error"] = f"{type(e).__name__}: {e}"[:300]
    receipt["finished_at"] = time.time()
    receipt["duration_ms"] = round((receipt["finished_at"] - t0) * 1000, 1)
    _record(receipt)
    log.info("[rs_post_pass] %s", {k: v for k, v in receipt.items() if k != "populated"})
    return receipt


def _run(receipt: dict, session, now) -> None:
    from . import rs_history, snapshot_builder               # noqa: PLC0415 - lazy: no cycle
    if session is None:
        session = snapshot_builder.settled_session(now)
        if session is None:
            receipt["reason"] = "no_session"
            return
    key = rs_history.session_key(session)
    receipt["session"] = key
    rating_map = _rating_map()
    rating_cols = tuple(rating_map)
    with closing(snapshot_db.connect()) as conn:
        have = {r[1] for r in conn.execute("PRAGMA table_info(screener_rows)")}
    if not set(OWNED_COLUMNS) <= have:
        # A table from before this unit: `init_db` ALTER-adds the columns (it does on
        # every build; this covers a pass that runs before the pod's first one).
        snapshot_db.init_db()
    read_cols = ("ticker", "is_etf", "price", "dollar_vol_30d", "rs_rank") + rating_cols
    with closing(snapshot_db.connect()) as conn:
        rows = [dict(r) for r in conn.execute(
            f"SELECT {', '.join(read_cols)} FROM screener_rows").fetchall()]
    receipt["rows"] = len(rows)
    if not rows:
        receipt["reason"] = "no_rows"
        return
    tickers = [r["ticker"] for r in rows]
    fields = rs_history.read_fields(tickers, session=key) or {}
    if not fields:
        _carry(receipt, rows, rating_map, rs_history.read_fields(tickers) or {})
        return
    _rewrite(receipt, key, rows, rating_map, fields)


def _mapped(rating_map: dict, f: dict) -> dict:
    """One ticker's rating columns from its ``read_fields`` row: every column named,
    NULL where the session has no value (the pass REWRITES, so an absent value must
    clear what the row held)."""
    return {col: (f or {}).get(src) for col, src in rating_map.items()}


def _sourced(rating_map: dict, f: dict, session) -> dict:
    """One row's values FROM ONE history row: the mapped rating columns, the session
    stamp, the unrounded score and the rating 20 stored sessions earlier. ``f`` empty
    (no history row, or a row whose numbers are not this session's) is all NULL."""
    vals = _mapped(rating_map, f)
    vals["rs_rating_session"] = session if f else None
    vals["rs_rating_score"] = _num(f.get("score"))
    ibd, d20 = _num(f.get("ibd")), _num(f.get("d20"))
    vals["rs_rating_prev20"] = None if ibd is None or d20 is None else int(ibd - d20)
    return vals


def _candidates(rows: list, merged: dict, fields_of) -> tuple:
    """``(overall, periods)``: the rows that may hold an overall place (the full
    floor and a score) and the rows that may hold a period place (liquidity alone;
    `exact_places` then drops a row with no value for the period)."""
    overall, periods = [], []
    for r in rows:
        t = r["ticker"]
        vals, f = merged[t], fields_of(t)
        if not f or not on_liquid_floor({**r, **vals}, full_year=False):
            continue
        c = {"ticker": t, "dollar_vol_30d": r.get("dollar_vol_30d"),
             "score": vals["rs_rating_score"], **{v: f.get(v) for _c, v in PERIOD_PLACES}}
        periods.append(c)
        if c["score"] is not None and on_liquid_floor({**r, **vals}):
            overall.append(c)
    return overall, periods


def _earlier_places(conn, session) -> tuple:
    """``(session, {ticker: place})`` stored :data:`PREV_SESSIONS` sessions before
    ``session``, or ``(None, {})``. Creates nothing."""
    if session is None or not _table_exists(conn, POS_TABLE):
        return None, {}
    prev_session = _earlier_session(conn, session)
    if prev_session is None:
        return None, {}
    return prev_session, {r[0]: r[1] for r in conn.execute(
        f"SELECT ticker, pos FROM {POS_TABLE} WHERE session = ?", (prev_session,))}


def _place_values(vals: dict, t, places: dict, n: int, period: dict, prev: dict) -> None:
    pos = places.get(t)
    vals.update(rs_rating_pos=pos, rs_rating_pos_n=n if pos is not None else None,
                rs_rating_pos_prev20=prev.get(t) if pos is not None else None,
                **{col: period[col].get(t) for col, _v in PERIOD_PLACES})


def _carry(receipt: dict, rows: list, rating_map: dict, newest: dict) -> None:
    """The asked session is not stored yet (every 03:00 ET build). No rating column is
    rewritten. A row whose rating columns ARE the newest stored session's is stamped
    with that session and given its score, its places and its rating a month ago from
    that session; every other row gets NULL in all of them, so nothing an earlier pass
    wrote stays beside a date it is not from.

    The places are computed on the floor as the rows stand NOW and written to the rows
    only: the stored ranking for that session (``rs_pos_history``) is the rating job's
    record and is not replaced by a later build's view of it."""
    receipt["reason"] = "session_not_stored"
    asof = next((f.get("asof") for f in newest.values() if f), None)
    merged, own = {}, {}
    for r in rows:
        t = r["ticker"]
        f = newest.get(str(t).upper()) or {}
        if not (f and all(r.get(c) == v for c, v in _mapped(rating_map, f).items())):
            f = {}
        own[t] = f
        merged[t] = _sourced(rating_map, f, asof)
    overall, periods = _candidates(rows, merged, own.get)
    places = exact_places(overall, "score")
    n = len(places)
    period = {col: exact_places(periods, v) for col, v in PERIOD_PLACES}
    sql = (f"UPDATE screener_rows SET {', '.join(c + ' = ?' for c in OWNED_COLUMNS)} "
           "WHERE ticker = ?")
    with snapshot_db._WRITE_LOCK, closing(snapshot_db.connect()) as conn:
        prev_session, prev = _earlier_places(conn, asof)
        payload = []
        for t, vals in merged.items():
            _place_values(vals, t, places, n, period, prev)
            payload.append([vals[c] for c in OWNED_COLUMNS] + [t])
        conn.executemany(sql, payload)
        conn.commit()
    verified = sum(1 for f in own.values() if f)
    receipt.update(
        rating_session=asof if verified else None, stamped=verified,
        unstamped=len(rows) - verified, ranked=n, prev20_session=prev_session,
        populated={c: sum(1 for v in merged.values() if v.get(c) is not None)
                   for c in OWNED_COLUMNS})
    receipt["ok"] = True


def _rewrite(receipt: dict, key: str, rows: list, rating_map: dict, fields: dict) -> None:
    rating_cols = tuple(rating_map)
    rank_ibd = _rank_ibd_on()
    merged = {r["ticker"]: _sourced(rating_map, fields.get(str(r["ticker"]).upper()) or {}, key)
              for r in rows}
    overall, periods = _candidates(rows, merged,
                                   lambda t: fields.get(str(t).upper()) or {})
    places = exact_places(overall, "score")
    n = len(places)
    period = {col: exact_places(periods, v) for col, v in PERIOD_PLACES}
    set_cols = rating_cols + OWNED_COLUMNS
    sql = (f"UPDATE screener_rows SET {', '.join(c + ' = ?' for c in set_cols)}"
           + (", rs_rank = COALESCE(?, rs_rank)" if rank_ibd else "") + " WHERE ticker = ?")
    with snapshot_db._WRITE_LOCK, closing(snapshot_db.connect()) as conn:
        if n:
            # An empty ranking never replaces a stored one (a table with no liquid row
            # is a broken table, not a market with no leaders).
            _store_places(conn, key, places)
        prev_session, prev = _earlier_places(conn, key)
        payload = []
        for t, vals in merged.items():
            _place_values(vals, t, places, n, period, prev)
            args = [vals[c] for c in set_cols]
            if rank_ibd:
                # One reader for both columns: a rated row's `rs_rank` IS this session's
                # rating; an unrated row keeps what the build wrote (the hourly rank).
                args.append(vals["rs_rating_ibd"])
            payload.append(args + [t])
        conn.executemany(sql, payload)
        conn.commit()
    receipt.update(
        rating_session=key, rewritten=True, reason=None,
        rated=sum(1 for v in merged.values() if v["rs_rating_ibd"] is not None),
        no_row=sum(1 for v in merged.values() if v["rs_rating_session"] is None),
        ranked=n, prev20_session=prev_session,
        rs_rank=("ibd" if rank_ibd else "untouched"),
        populated={c: sum(1 for v in merged.values() if v.get(c) is not None)
                   for c in OWNED_COLUMNS})
    receipt["ok"] = True
