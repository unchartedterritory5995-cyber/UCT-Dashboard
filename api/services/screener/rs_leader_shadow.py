"""The shadow Leader score's storage: computed nightly, kept, shown to nobody.

Plan: ``2026-11-14-uct-rs-screens-plan-v2.md`` section 8 and owner decision D1 ("run
unseen until it passes its test"). Unit U9.

WHY A SIDE TABLE AND NOT ``screener_rows`` COLUMNS
--------------------------------------------------
A scan answers ``SELECT *`` over ``screener_rows`` and returns every column of each
row (``query.build_scan_sql`` / ``query.run_scan``), and ``snapshot_db.get_row`` does
the same for the single-ticker readers. Hiding a key from ``meta()`` therefore hides a
control, not a value: a number stored on the row is in every member's scan response
the night the flag is armed. The receipts are served too (``snapshot_db.status()``
on ``/api/screener/snapshot-status``). So everything this unit stores lives in two
tables of ``screener.db`` that no request path names, and nothing it does is written
into a receipt a member can read:

* :data:`TABLE` (``rs_leader_shadow``): one row per ticker. The build writes the two
  bar inputs (``rs_columns.SHADOW_COLUMNS``) with the row's own ``bars_asof``; the
  rating post-pass fills the score and its four parts.
* :data:`HISTORY_TABLE` (``rs_leader_score_history``): one row per stock on the RS
  liquid floor per rating session, for the comparison a later step makes.

The names are the ones a later unit would give the columns if the owner ever shows
the score (``filters.RS_SHADOW_KEYS``), so that promotion is a copy, not a rename.

DARK BY DEFAULT. ``RS_LEADER_SHADOW_ENABLED`` is read per call (only the literal ``1``
arms it). Off, nothing here opens the database: no table is created, nothing is
computed in the build and the post-pass is the one it was.
"""
from __future__ import annotations

import logging
import os
import time
from contextlib import closing

from . import rs_columns, snapshot_db

log = logging.getLogger(__name__)

FLAG = "RS_LEADER_SHADOW_ENABLED"

TABLE = "rs_leader_shadow"
#: The two bar inputs the build writes (the writer's own tuple, never retyped).
INPUT_COLUMNS = tuple(rs_columns.SHADOW_COLUMNS)

_SQL = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
    ticker TEXT PRIMARY KEY,
    bars_asof INTEGER,
    rs_steady REAL,
    rs_line_below_high_pct REAL,
    rs_leader_score REAL,
    rs_ls_strength REAL,
    rs_ls_steady REAL,
    rs_ls_high REAL,
    rs_ls_group REAL,
    score_session TEXT,
    built_at REAL
)"""


def enabled() -> bool:
    """``RS_LEADER_SHADOW_ENABLED``, read PER CALL (only the literal ``1`` arms it), so
    a flip needs no restart and a rollback is an unset. Ledger: docs/feature_flags.json.
    The name is spelled out here (not read from :data:`FLAG`) because the ledger's index
    of gates is derived from the literal (``feature_flag_index``)."""
    return os.environ.get("RS_LEADER_SHADOW_ENABLED", "0") == "1"


def _table_exists(conn, name: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
                        (name,)).fetchone() is not None


def _real(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


# --------------------------------------------------------------------------- #
# the build's half: the two bar inputs
# --------------------------------------------------------------------------- #

def write_inputs(rows: dict, *, now=None) -> int:
    """Store the bar inputs of the tickers one build batch just wrote.

    ``rows`` is ``{TICKER: {"bars_asof": ymd, "rs_steady": x, "rs_line_below_high_pct": y}}``
    (a value the build could not compute is ``None``). INSERT OR REPLACE, like the
    batch's own ``upsert_rows``: a rebuilt ticker's score is NULL until the post-pass at
    the end of that build recomputes it, so no score outlives the inputs it came from.
    Returns the rows written. Raises on a database error (the caller decides)."""
    if not rows:
        return 0
    at = time.time() if now is None else float(now)
    payload = [(str(t).upper(), (v or {}).get("bars_asof"),
                *[_real((v or {}).get(c)) for c in INPUT_COLUMNS], at)
               for t, v in rows.items()]
    sql = (f"INSERT OR REPLACE INTO {TABLE} (ticker, bars_asof, {', '.join(INPUT_COLUMNS)}, "
           f"built_at) VALUES (?, ?, {', '.join('?' for _ in INPUT_COLUMNS)}, ?)")
    with snapshot_db._WRITE_LOCK, closing(snapshot_db.connect()) as conn:
        conn.execute(_SQL)
        conn.executemany(sql, payload)
        conn.commit()
    return len(payload)


def read_inputs(conn) -> dict:
    """``{TICKER: {"bars_asof", "rs_steady", "rs_line_below_high_pct"}}`` as stored, or
    ``{}`` when the table does not exist. Creates nothing."""
    if not _table_exists(conn, TABLE):
        return {}
    cols = ("bars_asof",) + INPUT_COLUMNS
    return {r[0]: dict(zip(cols, r[1:])) for r in conn.execute(
        f"SELECT ticker, {', '.join(cols)} FROM {TABLE}")}


# --------------------------------------------------------------------------- #
# the post-pass's half: the score, its parts and the per-session record
# --------------------------------------------------------------------------- #

HISTORY_TABLE = "rs_leader_score_history"
#: Sessions kept: a little over five years, the depth of the test's own backfill.
#: About 2,400 stocks are on the floor a night, so the full depth is about 3 million
#: rows; the table is clustered on its key (WITHOUT ROWID) so it is stored once, not
#: once as rows and again as an index.
HISTORY_KEEP_SESSIONS = 1300
#: ``(side-table column, key of rs_leader_score.score_rows' answer)``.
SCORE_COLUMNS = (("rs_leader_score", "score"), ("rs_ls_strength", "strength"),
                 ("rs_ls_steady", "steady"), ("rs_ls_high", "high"), ("rs_ls_group", "group"))
#: A score and its parts are 0 to 100; four places is finer than any use of them.
SCORE_DP = 4
#: The ``screener_rows`` columns one pass reads (the two bar inputs come from the side
#: table). ``rs_rating_score`` is the post-pass's own: this runs after it is written.
ROW_READS = ("ticker", "is_etf", "price", "dollar_vol_30d", "rs_rating_score",
             "px_below_high_pct", "industry", "sector", "chg_pct_1m", "bars_asof")

_HISTORY_SQL = f"""
CREATE TABLE IF NOT EXISTS {HISTORY_TABLE} (
    session TEXT NOT NULL,
    ticker TEXT NOT NULL,
    score REAL,
    strength REAL,
    steady REAL,
    high REAL,
    group_part REAL,
    qualifies INTEGER NOT NULL,
    PRIMARY KEY (session, ticker)
) WITHOUT ROWID"""

#: The newest pass's receipt, kept in memory only. NOT stored beside the build's or the
#: post-pass's receipts: those are served on ``/api/screener/snapshot-status``.
_LAST: dict = {}


def last_run() -> dict:
    """The newest pass's receipt in this process (``{}`` before the first)."""
    return dict(_LAST)


def leaders_gate() -> list:
    """The UCT RS Leaders gate as the starter a member opens defines it: the starter's
    own filter list (``rs_screens.leaders``) with the stocks-only clause every starter
    is served with (``saved_screens._stocks_only``). Read, never retyped: a change to
    the screen changes ``qualifies`` with it."""
    from . import rs_screens, saved_screens                  # noqa: PLC0415 - lazy: no cycle
    return [dict(f) for f in saved_screens._stocks_only(rs_screens.leaders())["spec"]["filters"]]


def _qualifiers(conn) -> set:
    """The tickers that pass :func:`leaders_gate` now, through the scan's own WHERE
    builder (``query.build_where``), so a NULL, an exclude list and every operator mean
    here exactly what they mean on the screen. Nightly values: no live overlay."""
    from . import query                                      # noqa: PLC0415 - lazy: no cycle
    where, params = query.build_where(leaders_gate(), conn=conn)
    return {r[0] for r in conn.execute(f"SELECT ticker FROM screener_rows{where}", params)}


def _same_bars(side: dict, row_asof) -> bool:
    """Were these side inputs computed from the bars the screener row now holds?"""
    a, b = (side or {}).get("bars_asof"), row_asof
    return a is not None and b is not None and str(a) == str(b)


def _round(v):
    return None if v is None else round(float(v), SCORE_DP)


def _store_history(conn, session: str, floor: list, scores: dict, qualifiers: set) -> int:
    """Make the history hold exactly one row per floor stock for ``session`` (delete
    then insert: a second pass over one session leaves the same rows), then trim to the
    newest :data:`HISTORY_KEEP_SESSIONS` sessions."""
    conn.execute(_HISTORY_SQL)
    conn.execute(f"DELETE FROM {HISTORY_TABLE} WHERE session = ?", (session,))
    conn.executemany(
        f"INSERT INTO {HISTORY_TABLE} (session, ticker, score, strength, steady, high, "
        "group_part, qualifies) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [(session, t, *[_round(scores[t][k]) for _c, k in SCORE_COLUMNS],
          1 if t in qualifiers else 0) for t in floor])
    cut = conn.execute(
        f"SELECT session FROM (SELECT DISTINCT session FROM {HISTORY_TABLE} "
        "ORDER BY session DESC LIMIT 1 OFFSET ?)", (HISTORY_KEEP_SESSIONS - 1,)).fetchone()
    if cut is not None:
        conn.execute(f"DELETE FROM {HISTORY_TABLE} WHERE session < ?", (cut[0],))
    return len(floor)


def run(session=None, *, record_history: bool = False) -> dict:
    """One shadow pass over ``screener_rows``, after the rating post-pass has written
    the unrounded score. Returns its receipt; raises on a database error (the caller,
    ``rs_post_pass``, never lets that cost the pass).

    * Every row gets the score and its four parts in :data:`TABLE` (blank off the RS
      liquid floor and wherever a part has no input), stamped with ``session``. A
      row's two bar inputs are used only when the side row was written from the bars
      the screener row now holds (same ``bars_asof``); otherwise they are blank.
    * With ``record_history`` (the pass that moved the ratings onto ``session``), one
      row per stock on the floor goes to :data:`HISTORY_TABLE` with ``qualifies``.
      A pass that only carried an earlier session's ratings records nothing: the
      stored record is the settled session's, as for the exact places.
    * A side row whose ticker has left ``screener_rows`` is removed.

    Off, it returns before it opens the database."""
    from . import rs_leader_score, rs_post_pass             # noqa: PLC0415 - lazy: no cycle
    t0 = time.time()
    receipt = {"ok": False, "enabled": enabled(), "session": session,
               "history": False, "started_at": t0}
    if not receipt["enabled"]:
        receipt["reason"] = "disabled"
        return receipt
    with closing(snapshot_db.connect()) as conn:
        rows = [dict(r) for r in conn.execute(
            f"SELECT {', '.join(ROW_READS)} FROM screener_rows").fetchall()]
        inputs = read_inputs(conn)
        qualifiers = _qualifiers(conn) if (record_history and session and rows) else set()
    for r in rows:
        side = inputs.get(str(r["ticker"]).upper())
        fresh = _same_bars(side, r.get("bars_asof"))
        for c in INPUT_COLUMNS:
            r[c] = side.get(c) if fresh else None
    floor = [r["ticker"] for r in rows if rs_post_pass.on_liquid_floor(r, full_year=False)]
    on_floor = set(floor)
    scores = rs_leader_score.score_rows(rows, in_floor=lambda r: r["ticker"] in on_floor)
    at = time.time()
    cols = [c for c, _k in SCORE_COLUMNS]
    upsert = (f"INSERT INTO {TABLE} (ticker, bars_asof, built_at, score_session, {', '.join(cols)}) "
              f"VALUES (?, ?, ?, ?, {', '.join('?' for _ in cols)}) "
              "ON CONFLICT(ticker) DO UPDATE SET score_session = excluded.score_session, "
              + ", ".join(f"{c} = excluded.{c}" for c in cols))
    payload = [(str(r["ticker"]).upper(), r.get("bars_asof"), at,
                session if scores[r["ticker"]]["score"] is not None else None,
                *[_round(scores[r["ticker"]][k]) for _c, k in SCORE_COLUMNS]) for r in rows]
    history_rows = 0
    with snapshot_db._WRITE_LOCK, closing(snapshot_db.connect()) as conn:
        conn.execute(_SQL)
        conn.executemany(upsert, payload)
        conn.execute(f"DELETE FROM {TABLE} WHERE ticker NOT IN (SELECT ticker FROM screener_rows)")
        # An empty floor never replaces a stored session (a table with no liquid row is
        # a broken table, not a market with no leaders): `rs_post_pass`'s own rule.
        if record_history and session and floor:
            history_rows = _store_history(conn, session, floor, scores, qualifiers)
        conn.commit()
    receipt.update(
        ok=True, rows=len(rows), floor=len(floor), history=bool(history_rows),
        history_rows=history_rows,
        scored=sum(1 for t in floor if scores[t]["score"] is not None),
        qualifiers=sum(1 for t in floor if t in qualifiers),
        duration_ms=round((time.time() - t0) * 1000, 1))
    _LAST.clear()
    _LAST.update(receipt)
    log.info("[rs_leader_shadow] %s", receipt)
    return receipt
