"""UCT RS Leaders, the steadier list (RS screens unit U12, 2026-11-14).

WHY IT EXISTS
-------------
UCT RS Leaders was "the 50 qualifiers with the highest RS Rating score", recomputed
from nothing on every scan. A stock ranked 50th today and 52nd tomorrow left the list
and came back the day after: the list flickered at its edge, and a member watching a
name could not tell a real change from noise two places wide.

THE RULE (:func:`members`)
--------------------------
* A stock already on the list STAYS while it still qualifies and ranks
  ``LEADERS_HOLD_RANK`` (65) or better among the qualifiers.
* A stock not on the list ENTERS at ``LEADERS_TOP_N`` (50) or better. ALWAYS: no
  stock ranked in the top 50 of the qualifiers is ever kept off the list.
* So the list holds 50 to ``LEADERS_HOLD_RANK`` names: the top 50, plus the listed
  stocks that have slipped to 51st..65th and are still holding their place.
* A stock that stops qualifying leaves at once, whatever its rank was.
* With no earlier record (the first session) the list is the plain top 50.

⚠️ WHY THE LIST IS NOT CUT TO 50 (coordinator ruling at integration, 2026-11-14).
Two cuts were possible and both are wrong for a list called "Leaders":
* "the 50 best-ranked of everyone entitled" undoes the rule: ranks 1 to 50 are
  always entitled, so that cut is always exactly ranks 1 to 50 and the hold band
  never keeps anyone;
* "a listed stock keeps its seat and a newcomer waits for a free one" (how this unit
  was first built) keeps the list at 50 but leaves a stock ranked 44th OFF it for as
  long as fifty incumbents hold, which is the one thing the list must never do.
So nothing is cut: ``_run`` passes ``cap=LEADERS_HOLD_RANK``, which the two bands can
never exceed (every member ranks 65th or better). :func:`members` keeps its ``cap``
argument, and the tests for it, so a smaller cap stays a deliberate choice.

THE QUALIFIERS ARE THE STARTER'S OWN FILTERS, EVALUATED BY THE SCAN
(:func:`qualifier_filters`, :func:`ranked_qualifiers`). The gate is read off
``rs_screens.leaders()`` as served (stocks only included), with only the membership
clause itself taken out, and turned into SQL by ``query.build_scan_sql``: the same
WHERE the screen runs, stale-row gate included. Nothing here retypes a threshold, so
a rule added to the screen is a rule of the list on the next pass.

WHERE IT RUNS (:func:`run`). Inside ``rs_post_pass`` after the rating columns are
written, because the gate reads ``rs_rank`` and the order is ``rs_rating_score``.
It writes two ``screener_rows`` columns over the whole table:

* ``rs_leaders_member``: 1 on the list, 0 for every other row;
* ``rs_leaders_days``: consecutive stored sessions on the list counting today, blank
  for a row that is not on it.

and, on the pass that moved the ratings onto the settled session only, the session's
record in ``rs_leaders_members(session, ticker, rank)``, kept for
:data:`KEEP_SESSIONS` sessions. "Already on the list" always means the newest record
of an EARLIER session, so every pass of one day reads the same yesterday and a second
pass cannot feed on the first (the ``rs_pos_history`` rule).

DARK. ``rs_post_pass.run`` returns before it opens the database while
``RS_SCREENS_ENABLED`` is off, so this module is not asked and its table is not made.
"""
from __future__ import annotations

import logging
from contextlib import closing

from . import snapshot_db

log = logging.getLogger(__name__)

#: The two columns this module writes (``snapshot_db.POST_PASS_COLUMNS`` holds them).
COLUMNS = ("rs_leaders_member", "rs_leaders_days")
MEMBER_KEY, DAYS_KEY = COLUMNS
#: One row per listed stock per session: its rank among that session's qualifiers.
TABLE = "rs_leaders_members"
#: Sessions kept (about 19 months, the place history's own depth).
KEEP_SESSIONS = 400

_TABLE_SQL = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
    session TEXT NOT NULL,
    ticker TEXT NOT NULL,
    rank INTEGER NOT NULL,
    PRIMARY KEY (session, ticker)
)"""


# --------------------------------------------------------------------------- #
# pure: the rule
# --------------------------------------------------------------------------- #

def members(ranked, prior, *, enter: int, hold: int, cap: int) -> list:
    """``[(ticker, rank)]``: today's list, best-ranked first (module docstring).

    ``ranked`` is today's qualifiers in order, strongest first (rank 1 is the first);
    ``prior`` the tickers on the newest earlier record (empty or None on the first
    session). A ticker in ``prior`` that is not in ``ranked`` has stopped qualifying
    and is simply not returned."""
    prior = set(prior or ())
    stay = [(t, i) for i, t in enumerate(ranked, 1) if t in prior and i <= hold]
    new = [(t, i) for i, t in enumerate(ranked, 1) if t not in prior and i <= enter]
    keep = stay[:max(0, cap)]
    keep += new[:max(0, cap - len(keep))]
    return sorted(keep, key=lambda m: m[1])


def days_on_list(listed, history) -> dict:
    """``{ticker: days}`` for each of ``listed``: consecutive stored sessions on the
    list counting today, so a stock that joined today reads 1.

    ``history`` is the earlier sessions' member sets, NEWEST FIRST. The count stops at
    the first session the stock was not on, and at the end of what is stored."""
    out = {}
    for t in listed:
        n = 1
        for was in history:
            if t not in was:
                break
            n += 1
        out[t] = n
    return out


# --------------------------------------------------------------------------- #
# the qualifiers: the starter's own filters, through the scan
# --------------------------------------------------------------------------- #

def qualifier_filters() -> list:
    """The clauses a stock must pass to be ranked for the list: UCT RS Leaders'
    filters exactly as the starter is served (``saved_screens._stocks_only`` over
    ``rs_screens.leaders()``), minus the membership clause this module answers."""
    from . import rs_screens, saved_screens                  # noqa: PLC0415 - lazy: no cycle
    starter = saved_screens._stocks_only(rs_screens.leaders())
    return [dict(f) for f in starter["spec"]["filters"] if f.get("key") != MEMBER_KEY]


def ranked_qualifiers(conn) -> list:
    """Today's qualifiers, strongest first: every row the screen's own WHERE selects
    (``query.build_scan_sql`` over :func:`qualifier_filters`, the stale-row gate
    included) that holds an ``rs_rating_score``, by that score, then ticker. A row
    with no score cannot be placed and is on no list."""
    from . import query, rs_screens                          # noqa: PLC0415 - lazy: no cycle
    plan = query.build_scan_sql({"filters": qualifier_filters()}, conn=conn)
    overlay = plan["overlay"]
    rows = conn.execute(
        f"SELECT {overlay.col_expr('ticker')}, {overlay.col_expr(rs_screens.LEADERS_ORDER_KEY)} "
        f"FROM {plan['from_sql']}{plan['where']}", plan["describe_params"]).fetchall()
    scored = [(str(r[0]), float(r[1])) for r in rows if r[0] and r[1] is not None]
    scored.sort(key=lambda r: (-r[1], r[0]))
    return [t for t, _score in scored]


def standing(ticker) -> tuple:
    """``(rank, qualifiers)``: where ``ticker`` ranks right now among the stocks that
    pass the screen's rules, and how many pass, by the pass's OWN ranking
    (:func:`ranked_qualifiers`), so "ranked 58th" is the number the list was decided
    on. ``(None, qualifiers)`` when the stock is not among them. Read-only; it is what
    the assistant says to "why isn't X on UCT RS Leaders?" (``rs_screens_service``)."""
    with closing(snapshot_db.connect()) as conn:
        ranked = ranked_qualifiers(conn)
    sym = str(ticker or "").strip().upper()
    return (ranked.index(sym) + 1 if sym in ranked else None), len(ranked)


# --------------------------------------------------------------------------- #
# storage
# --------------------------------------------------------------------------- #

def _table_exists(conn) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
                        (TABLE,)).fetchone() is not None


def _earlier(conn, session: str) -> tuple:
    """``(prior_session, [member sets, newest first])`` over the records stored for
    sessions BEFORE ``session``; ``(None, [])`` when there are none. Creates nothing."""
    if not _table_exists(conn):
        return None, []
    by_session: dict = {}
    for s, t in conn.execute(f"SELECT session, ticker FROM {TABLE} WHERE session < ? "
                             "ORDER BY session DESC", (session,)):
        by_session.setdefault(s, set()).add(t)
    if not by_session:
        return None, []
    order = sorted(by_session, reverse=True)
    return order[0], [by_session[s] for s in order]


def _store(conn, session: str, listed: list) -> None:
    """Make the table hold exactly ``listed`` for ``session`` (delete then insert, so
    a second pass leaves one row per ticker), then trim to :data:`KEEP_SESSIONS`."""
    conn.execute(_TABLE_SQL)
    conn.execute(f"DELETE FROM {TABLE} WHERE session = ?", (session,))
    conn.executemany(f"INSERT INTO {TABLE} (session, ticker, rank) VALUES (?, ?, ?)",
                     [(session, t, rank) for t, rank in listed])
    cut = conn.execute(
        f"SELECT session FROM (SELECT DISTINCT session FROM {TABLE} "
        "ORDER BY session DESC LIMIT 1 OFFSET ?)", (KEEP_SESSIONS - 1,)).fetchone()
    if cut is not None:
        conn.execute(f"DELETE FROM {TABLE} WHERE session < ?", (cut[0],))


def _blank() -> None:
    """Both columns NULL on every row: what a pass that could not compute the list
    leaves behind, so yesterday's membership never stands beside today's ratings."""
    with snapshot_db._WRITE_LOCK, closing(snapshot_db.connect()) as conn:
        conn.execute(f"UPDATE screener_rows SET {MEMBER_KEY} = NULL, {DAYS_KEY} = NULL")
        conn.commit()


# --------------------------------------------------------------------------- #
# the step
# --------------------------------------------------------------------------- #

def run(session, *, record: bool) -> dict:
    """Compute today's list for ``session`` and write the two columns. Returns its
    receipt (``members``, ``qualifiers``, ``held``, ``entered``, ``left``,
    ``prior_session``, ``recorded``, ``populated``) and NEVER raises: a failure blanks
    both columns and answers ``{"error": ..., "populated": {both: 0}}``.

    ``record`` stores the session's record (the pass that moved the ratings onto the
    settled session); a pass that carried an earlier session's ratings writes the
    columns and records nothing. An empty list is never recorded either: no qualifier
    at all is a broken table before it is a market with no leaders (the
    ``rs_pos_history`` rule), and yesterday's record then still stands."""
    try:
        return _run(str(session), record)
    except Exception as e:                                   # noqa: BLE001 - never costs the pass
        log.warning("[rs_leaders_list] failed: %s: %s", type(e).__name__, e)
        try:
            _blank()
        except Exception as e2:                              # noqa: BLE001
            log.warning("[rs_leaders_list] columns not blanked: %s", e2)
        return {"error": f"{type(e).__name__}: {e}"[:300],
                "populated": {c: 0 for c in COLUMNS}}


def _run(session: str, record: bool) -> dict:
    from . import rs_screens                                 # noqa: PLC0415 - lazy: no cycle
    # READ FIRST, WITHOUT THE WRITE LOCK: the scan's planner is asked for the WHERE,
    # and nothing it may do on its own connection can then wait on a lock held here
    # (`snapshot_db._WRITE_LOCK` is not re-entrant).
    with closing(snapshot_db.connect()) as conn:
        ranked = ranked_qualifiers(conn)
        prior_session, history = _earlier(conn, session)
    prior = history[0] if history else set()
    listed = members(ranked, prior, enter=rs_screens.LEADERS_TOP_N,
                     hold=rs_screens.LEADERS_HOLD_RANK, cap=rs_screens.LEADERS_HOLD_RANK)
    days = days_on_list([t for t, _rank in listed], history)
    with snapshot_db._WRITE_LOCK, closing(snapshot_db.connect()) as conn:
        conn.execute(f"UPDATE screener_rows SET {MEMBER_KEY} = 0, {DAYS_KEY} = NULL")
        conn.executemany(
            f"UPDATE screener_rows SET {MEMBER_KEY} = 1, {DAYS_KEY} = ? WHERE ticker = ?",
            [(days[t], t) for t, _rank in listed])
        recorded = bool(record and listed)
        if recorded:
            _store(conn, session, listed)
        rows = conn.execute("SELECT COUNT(*) FROM screener_rows").fetchone()[0]
        conn.commit()
    names = {t for t, _rank in listed}
    return {"members": len(listed), "qualifiers": len(ranked),
            "held": len(names & prior), "entered": len(names - prior),
            "left": len(prior - names), "prior_session": prior_session,
            "recorded": recorded,
            "populated": {MEMBER_KEY: rows, DAYS_KEY: len(listed)}}
