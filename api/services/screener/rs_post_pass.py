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

THE MARKET STATE RIDES ALONG (unit U8). Every pass also asks ``rs_market_state.compute``
for the market caution state and keeps the answer in its receipt as ``market``
(``{state, text, asof}``, or None when no state can be claimed). It is a fact about SPY
and QQQ, not about any row, so it is asked whether or not the rating half of the pass
succeeded, and a failure there never costs the pass.

DARK BY DEFAULT. ``RS_SCREENS_ENABLED`` is read per call and takes the three values the
Focus screener flags take (unit U10): off, ``admin`` (the owner's private look) and on
for everyone. :func:`enabled` answers for the DATA (``admin`` or on) and
:func:`surfaces_on` for what one user is shown. Off, :func:`run` returns before it opens
the database: no column is written, no table is created and no receipt is stored.

UCT RS LEADERS' LIST RIDES THIS PASS TOO (unit U12). After the rating columns are
written, :func:`_leaders_list` hands over to ``rs_leaders_list.run``, which decides who
is on the list this session (join at 50 or better, stay to 65) and writes
``rs_leaders_member`` and ``rs_leaders_days``. It needs ``rs_rank`` and
``rs_rating_score`` as this pass leaves them, so it runs here. Its counts are in the
receipt as ``leaders``; a failure there blanks those two columns and costs nothing else.

THE SHADOW LEADER SCORE (unit U9) rides this pass: after the places, and only while
``RS_LEADER_SHADOW_ENABLED`` is on too, :func:`_leader_shadow` hands over to
``rs_leader_shadow.run``, which keeps a score no member is shown in its own side
tables. It writes no ``screener_rows`` column and nothing into this pass's receipt.
"""
from __future__ import annotations

import json
import logging
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

#: The columns the pass's rating UPDATE writes (with :data:`LEADERS_COLUMNS` below they
#: are ``snapshot_db.POST_PASS_COLUMNS``; the build's ``empty_columns`` receipt leaves
#: all of them to this pass's own receipt).
OWNED_COLUMNS = ("rs_rating_session", "rs_rating_score", "rs_rating_pos", "rs_rating_pos_n",
                 "rs_pos_1m", "rs_pos_3m", "rs_pos_6m", "rs_pos_12m", "rs_rating_pos_prev20",
                 "rs_rating_prev20")
#: UCT RS Leaders' list (unit U12): the two columns ``rs_leaders_list.run`` writes
#: inside this pass, in its own UPDATE after the rating columns (``rs_leaders_list.
#: COLUMNS`` is the writer's copy; a test holds the two equal).
LEADERS_COLUMNS = ("rs_leaders_member", "rs_leaders_days")
#: EVERY column the pass writes: :data:`OWNED_COLUMNS` in the rating UPDATE, then the
#: list's two. ``snapshot_db.POST_PASS_COLUMNS`` is the schema's copy of this set.
PASS_COLUMNS = OWNED_COLUMNS + LEADERS_COLUMNS
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


#: The flag and its default (off), as a one-row table. The read below goes through the
#: Focus flags' helper, which takes the name from a variable; the ledger's index of gates
#: (``feature_flag_index``) finds a gate by a literal, and a module-level ``*_FLAGS``
#: table is the form it reads for that. Without this row the ledger would describe a
#: gate the index cannot see.
RS_SCREENS_FLAGS = {"RS_SCREENS_ENABLED": False}


def _reads(user=None) -> tuple:
    """``(data on, surfaces on for this user)``, read PER CALL (a flip needs no restart
    and a rollback is an unset). Ledger: docs/feature_flags.json.

    THE ONE PARSE is ``api.routers.auth._breadth_dc_scope``, the helper the Focus
    screener flags use, so the two cannot disagree about what ``admin`` or a typo means:
    unset / ``0`` / ``false`` / ``no`` / ``off`` is off, ``admin`` is the owner's private
    look, ``1`` / ``true`` / ``yes`` / ``on`` is everyone, and anything else takes the
    default (off), never the opposite of it. The import is lazy, the way ``premarket``
    and ``membership`` read their own flags: the router is not loaded for this module.

    An admin is ``role == "admin"`` on the user dict, the test ``premarket.served_to``
    and the New today route apply. No user, or one this cannot read, is a member.
    A flag that cannot be read is off for both answers."""
    try:
        from api.routers import auth                         # noqa: PLC0415 - lazy: no cycle
        scope = auth._breadth_dc_scope(FLAG, RS_SCREENS_FLAGS[FLAG])
        data = scope != auth._SCOPE_OFF
        owner_only = scope == auth._ADMIN_ONLY
        everyone = scope == auth._SCOPE_ALL
    except Exception:                                        # noqa: BLE001
        return False, False
    is_admin = isinstance(user, dict) and user.get("role") == "admin"
    return data, everyone or (owner_only and is_admin)


def enabled() -> bool:
    """Is the DATA on (``admin`` or on for everyone)? The build's extra columns, this
    pass, the rating session stamp and the membership re-record all ask this, so under
    ``admin`` the owner looks at real screens and a full release has its history."""
    return _reads()[0]


def surfaces_on(user=None) -> bool:
    """Is THIS user shown the screens (on for everyone, or ``admin`` and the user is an
    admin)? Every member-facing surface asks this: the five starters and the hidden
    marks, the RS screens views and filter keys in ``filters.meta``, the method page.
    A caller that passes no user gets a member's answer, so it fails closed at ``admin``.

    A payload a later unit serves for the screens (a new key, a new route) gates on THIS
    with the route's user, never on :func:`enabled`: a member under ``admin`` must be
    served exactly what the flag off serves (tests/test_rs_screens_u10_owner_only.py).
    The scan and count routes are not gated: a column that exists may be filtered by
    anyone."""
    return _reads(user)[1]


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


#: What an RS screen says while the table holds rows and not one of them has been placed:
#: the first night after the flag is set (the build's extra columns and this pass have not
#: run under it yet), or a table rebuilt with no pass behind it. The first sentence is the
#: headline of the page's empty state and the second its body (`RsEmptyState`).
PENDING_TEXT = ("This list is not ready yet. It fills after the overnight rating run, "
                "at about 4:15 AM Eastern.")


def pending() -> dict | None:
    """``{"text": PENDING_TEXT}`` while the RS screens are computed (:func:`enabled`), the
    table holds rows, and NOT ONE row has an exact place (``rs_rating_pos``); else ``None``.

    Every RS screen filters on a column only this pass writes, so until the first pass
    under the flag each of them is empty, and the page's ordinary empty state blames the
    member's filters ("No stocks match all 12 filters") and the coverage line says every
    stock has no RS Rating. Neither is true: the lists have not been built. The
    saved-screens payload carries this as ``rs_pending`` so the page can say that instead.

    ``None`` for everything that is not exactly that state: the flag off, no table, no rows
    (a pod with no snapshot has its own states), the column absent, one placed row, or a
    read that failed. Read-only and never raises."""
    try:
        if not enabled():
            return None
        with closing(snapshot_db.connect()) as conn:
            if not _table_exists(conn, "screener_rows"):
                return None
            have = {r[1] for r in conn.execute("PRAGMA table_info(screener_rows)")}
            if "rs_rating_pos" not in have:
                return None
            if conn.execute("SELECT 1 FROM screener_rows LIMIT 1").fetchone() is None:
                return None
            placed = conn.execute(
                "SELECT 1 FROM screener_rows WHERE rs_rating_pos IS NOT NULL LIMIT 1").fetchone()
        return None if placed is not None else {"text": PENDING_TEXT}
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


def _market_state(spy_bars, now):
    """The market caution state for this pass's receipt (unit U8), or None. Never
    raises: ``rs_market_state.compute`` already answers None for anything it cannot
    read, and an import that fails is the same answer."""
    try:
        from . import rs_market_state                        # noqa: PLC0415 - lazy: no cycle
        return rs_market_state.compute(spy_bars=spy_bars, now=now)
    except Exception as e:                                   # noqa: BLE001
        log.warning("[rs_post_pass] market state not computed: %s", e)
        return None


def run(session=None, *, source: str = "manual", now=None, spy_bars=None) -> dict:
    """One pass over ``screener_rows`` (module docstring). Returns its receipt and
    never raises.

    ``session`` defaults to the screener's settled session. The receipt carries
    ``session`` (the one asked for), ``rating_session`` (the one the rows now say, or
    None), ``rewritten`` (were the rating columns moved onto ``session``),
    ``reason`` when nothing was rewritten, the row counts, ``populated``: the
    non-null count of every column this pass owns, for the build's own receipt, and
    ``market``: the market caution state (unit U8; None when none can be claimed).

    ``spy_bars`` is the build's own SPY read, handed on so the market state does not
    read SPY a second time; every other caller leaves it out."""
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
    receipt["market"] = _market_state(spy_bars, now)
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
        _leaders_list(receipt, key, record=False)
        _leader_shadow(receipt.get("rating_session"), record_history=False)
        return
    _rewrite(receipt, key, rows, rating_map, fields)
    _leaders_list(receipt, key, record=True)
    _leader_shadow(key, record_history=True)


def _leaders_list(receipt: dict, session: str, *, record: bool) -> None:
    """UCT RS Leaders' list for this session (unit U12), after the rating columns:
    ``rs_leaders_list.run`` over the rows this pass just wrote. Its counts land in the
    receipt as ``leaders`` and its two columns join ``populated``, so the build's own
    receipt counts them like every column the pass writes.

    ``session`` is the session the pass was ASKED for (the settled one), also on a pass
    that carried an earlier session's ratings: "already on the list" is the record of
    a session before it either way. Only the pass that moved the ratings onto that
    session records it (``record``; the ``rs_pos_history`` rule).

    Never raises: ``rs_leaders_list.run`` blanks its columns and reports the error,
    and an import that fails is the same answer. The places above are not touched."""
    try:
        from . import rs_leaders_list                        # noqa: PLC0415 - lazy: no cycle
        out = dict(rs_leaders_list.run(session, record=record))
    except Exception as e:                                   # noqa: BLE001 - never costs the pass
        log.warning("[rs_post_pass] leaders list failed: %s: %s", type(e).__name__, e)
        out = {"error": f"{type(e).__name__}: {e}"[:300], "populated": {}}
    receipt.setdefault("populated", {}).update(out.pop("populated", None) or {})
    receipt["leaders"] = out


def _leader_shadow(session, *, record_history: bool) -> None:
    """The shadow Leader score (unit U9), after the places: ``rs_leader_shadow.run``
    over the rows this pass just wrote. It needs ``rs_rating_score``, which only this
    pass writes, so it runs here and nowhere else. Only the pass that moved the
    ratings onto the settled session records the per-session history; a pass that
    carried an earlier session's ratings scores the rows and records nothing (the
    ``rs_pos_history`` rule).

    ⛔ NOTHING IT DOES REACHES THIS PASS'S RECEIPT. The receipt is served to members
    (``snapshot_db.status()`` on ``/api/screener/snapshot-status``) and the score is
    shown to nobody. A failure is logged here and costs the pass nothing.

    Dark behind ``RS_LEADER_SHADOW_ENABLED`` (read per call): off, the module is not
    asked and the pass is the one it was."""
    try:
        from . import rs_leader_shadow                       # noqa: PLC0415 - lazy: no cycle
        if rs_leader_shadow.enabled():
            rs_leader_shadow.run(session, record_history=record_history)
    except Exception as e:                                   # noqa: BLE001 - never costs the pass
        log.warning("[rs_post_pass] leader shadow failed: %s: %s", type(e).__name__, e)


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
