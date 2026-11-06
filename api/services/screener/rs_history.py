"""The IBD-style RS Rating, nightly, as a per-session history table in ``screener.db``.

Plan: ``docs/superpowers/specs/2026-11-05-uct-relative-strength-indicator-design.md``
§7 items 17-20 and §9. Map: ``docs/superpowers/plans/2026-11-06-uct-rs-phase2-engineering-map.md``
§2.1 (placement), §2.2 (rating data), §3 row 2a-03 (this unit).

WHAT THE RATING IS
------------------
Over a ticker's daily closes ``C``::

    score = 0.40 * C/C[-63] + 0.20 * C/C[-126] + 0.20 * C/C[-189] + 0.20 * C/C[-252]

A term the history cannot supply is DROPPED and the surviving weights are
RENORMALISED; the 63-day term is REQUIRED (without it the answer is ``None``, not a
score built on the tail weights). That is ``rs_weighted_return``'s rule, applied to
this module's own term table :data:`IBD_TERMS` (the fast UCT rating in
``rs_ranking`` keeps its 3m/6m/1m/1w table; the two formulas are different on
purpose and the chart shows both with their own ``asof``). The score is ranked
across the population, ``pct = average_rank / N`` (ties share the mean of their
positions), and the rating is ``max(1, ceil(pct * 99))``. The components ``m1``,
``m3``, ``m6``, ``m12`` are the same percentile of the plain 21/63/126/252-bar
returns.

POPULATION. Default (map §5 question 1): the cap universe minus ETFs. The ranked
set never contains an ETF - an index fund sits on top of the very stocks it
summarises - but every ETF IS rated, by interpolating its score into the stock
distribution, so SPY or XLK can carry a number on the same scale. ETFs are
identified through ``industry_map`` (every ETF carries industry
``rs_benchmarks.ETF_INDUSTRY``, "Exchange Traded Fund"), unioned with the benchmark
list in ``rs_benchmarks``, the liquid-ETF list in ``cap_universe`` and the
snapshot's own ``is_etf`` rows. The denominator is a parameter: pass ``universe``
and ``etf_tickers`` to rank over something else; the receipt records both sizes.

SPLIT GUARD. Daily bars are fetched adjusted and the web pod runs the split-repair
sweep, but an unadjusted split that slips through would rank a 3:1 split as a 67 %
crash. A ticker whose scored closes (the newest :data:`SCORE_BARS`, all the 252-bar
term reads) still carry an unadjusted split is marked ``bars = 0`` and skipped for
that session: no row, counted in the receipt as ``split_guard``.

The judge is the DECLARED split list (2026-11-07, review finding #4). When
``bars_sanitize``'s corporate-action cache holds the ticker's list, the one detector,
``bars_sanitize.unadjusted_splits``, decides: only a declared split whose boundary
still shows its factor in the closes trips the guard, so a real +65 % earnings gap
or a -60 % crash never does. The cache is read without scheduling a provider fetch.
When the list is not cached, :func:`split_suspect` is the fallback: a one-bar
ratio beyond +/- :data:`SPLIT_GUARD_PCT` that is also split-SIZED (within the
detector's tolerance of a factor in :data:`SPLIT_FACTORS`). At the default 60 it
catches an unadjusted 3:1 or larger forward split and a 1:2 or larger reverse split;
a 2:1 forward split (-50 %) passes it, as does a real -50 % day, and so does a real
+65 % gap. A real +100 % day reads as a 1:2 reverse split and is still skipped
while the list is not cached, which is the trade-off the fallback states.

The old guard read every one-bar ratio in the whole ``READ_BARS`` window, so one
real big gap removed a leader for about 270 sessions, including the sessions after
the gap had left the 253 closes the score reads.

WHERE IT RUNS. The WEB pod, after the 03:00 ET screener build, writing a side
table in ``screener.db`` through ``snapshot_db.connect()`` - the ``volume_curve``
pattern: created on first write, a receipts table shaped like
``screener_build_runs``, ``nightly_job`` never raises. The worker has no scheduler
of its own and the R2 bridge ships only ``bars.db``'s ``ohlcv``; the web pod holds
the daily windows this needs (map §2.1).

NO FLAG AND NO ENVIRONMENT VARIABLE IS READ HERE. The registrar
(``register_screener_jobs``, unit 2a-04) reads ``RS_HISTORY_ENABLED`` per call and
decides whether ``nightly_job`` runs. The backfill marker lives beside
``screener.db`` unless a ``data_dir`` is passed.

D5 / D20 (plan §7 item 20) are computed ON READ from the earlier sessions in this
table and never stored, so a corrected session corrects its deltas too.

BACKFILL (plan §9, §17.6). Once, behind ``<data dir>/.rs_history_backfill_v1``
(written only after success, the ``deep_history_warm`` idiom; a corrected method
is a new marker name), point-in-time over the names held TODAY. The receipt
records ``survivorship_corrected = False`` so the readout can say "universe as
held, survivorship not yet corrected" until a delisting source exists.
"""
from __future__ import annotations

import json
import logging
import math
import os
import time
from bisect import bisect_right
from contextlib import closing
from datetime import date, datetime, timedelta

from api.services.rs_weighted_return import (
    IBD_COMPONENTS,
    IBD_REQUIRED_TERM,
    IBD_TERMS,
    period_return,
)
from api.services.screener import snapshot_db

log = logging.getLogger(__name__)

TABLE = "rs_rating_history"
RUNS_TABLE = "rs_history_runs"
#: Receipts kept, newest first - the ``screener_build_runs`` number.
RUNS_KEEP = 60
#: The one-shot backfill's done-marker, written beside ``screener.db``.
BACKFILL_MARKER = ".rs_history_backfill_v1"

#: ``(label, bars_back, weight)`` - plan §7 item 17. The one copy lives in
#: ``rs_weighted_return`` beside the fast rating's table (the single-authority
#: rail allows exactly one module to declare RS lookbacks); re-exported here
#: under the names this module's readers use.
REQUIRED_TERM = IBD_REQUIRED_TERM
COMPONENTS = IBD_COMPONENTS
#: The rating scale's top; the bottom is 1.
RATING_MAX = 99
#: Closes read per ticker: the 252-bar term needs 253 closes, plus a margin for a
#: missing day or two so a short gap does not cost the year term.
READ_BARS = 270
#: Closes the score reads: the 252-bar term compares the newest close with the one
#: 252 bars back, so a split older than these closes cannot move the rating.
SCORE_BARS = 253
#: The fallback split guard (no cached split list): a one-bar close ratio beyond
#: this percent either way, AND split-sized, marks the window unadjusted.
SPLIT_GUARD_PCT = 60.0
#: Split factors the fallback recognises, forward (``prev / cur``) and reverse
#: (their reciprocals). The tolerance is ``bars_sanitize``'s own.
SPLIT_FACTORS = (2, 3, 4, 5, 6, 7, 8, 10, 15, 20, 25, 30, 40, 50)
#: A ticker whose newest stored bar is more than this many calendar days behind the
#: session is not rated for it (a stale name, or a hole in the store). Wide enough
#: for a long weekend plus a night the prewarm missed.
MAX_BAR_LAG_DAYS = 5
#: ``read_fields`` notes ``stale:<n>d`` when the newest session is older than this.
STALE_DAYS = 3
#: The backfill's default depth: one trading year.
BACKFILL_DAYS = 252

RATING_COLUMNS = ("ibd", "m1", "m3", "m6", "m12")
ROW_COLUMNS = ("ibd", "fast", "m1", "m3", "m6", "m12", "score", "bars")

_SQL = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
    session TEXT NOT NULL,
    ticker TEXT NOT NULL,
    ibd INTEGER, fast INTEGER,
    m1 INTEGER, m3 INTEGER, m6 INTEGER, m12 INTEGER,
    score REAL, bars INTEGER,
    PRIMARY KEY (session, ticker)
)"""
_INDEX_SQL = f"CREATE INDEX IF NOT EXISTS idx_rsh_ticker ON {TABLE}(ticker, session)"
_RUNS_SQL = f"""
CREATE TABLE IF NOT EXISTS {RUNS_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session TEXT, started_at REAL, finished_at REAL,
    universe INTEGER, rated INTEGER, excluded_etfs INTEGER, short_history INTEGER,
    duration_ms REAL, note TEXT
)"""


def ensure_schema(conn) -> None:
    """Create both tables (idempotent). Called on every write, like ``volume_curve``."""
    conn.execute(_SQL)
    conn.execute(_INDEX_SQL)
    conn.execute(_RUNS_SQL)


# --------------------------------------------------------------------------- #
# pure arithmetic
# --------------------------------------------------------------------------- #

def closes_from_rows(rows) -> tuple[list[int], list[float]]:
    """``(ts_list, close_list)`` from bars-store rows ``(ts, o, h, l, c, v)``, oldest first.

    Daily ``ts`` is a ``YYYYMMDD`` int (``bars_sqlite``). A row without a positive
    close is dropped, so the series is the valid closes in order - the plan's
    reading for every derived value (§7 item 2).
    """
    ts_out: list[int] = []
    c_out: list[float] = []
    for ts, _o, _h, _l, c, _v in rows or ():
        try:
            cf = float(c)
        except (TypeError, ValueError):
            continue
        if not cf > 0:
            continue
        ts_out.append(int(ts))
        c_out.append(cf)
    return ts_out, c_out


def _split_tol() -> float:
    """``bars_sanitize``'s ratio tolerance, read from its one copy (no second number)."""
    from api.services.bars_sanitize import _SPLIT_TOL
    return float(_SPLIT_TOL)


def _split_sized(step: float, tol: float) -> bool:
    """True when ``step`` (``prev / cur``) is within ``tol`` of a split factor."""
    for f in SPLIT_FACTORS:
        for factor in (float(f), 1.0 / f):
            if abs(step / factor - 1.0) <= tol:
                return True
    return False


def split_suspect(closes, pct: float = SPLIT_GUARD_PCT) -> bool:
    """The fallback guard, used when the declared split list is not cached.

    True when a one-bar close ratio among the newest :data:`SCORE_BARS` closes lies
    beyond +/- ``pct`` AND is split-sized (see :func:`_split_sized`). Older closes
    are not read: the score never reaches them.
    """
    lo, hi = 1.0 - pct / 100.0, 1.0 + pct / 100.0
    tail = list(closes)[-SCORE_BARS:]
    tol = _split_tol()
    for prev, cur in zip(tail, tail[1:]):
        if prev > 0 and cur > 0:
            r = cur / prev
            if (r < lo or r > hi) and _split_sized(prev / cur, tol):
                return True
    return False


def _iso(ymd) -> str:
    s = str(int(ymd))
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}"


def window_split_suspect(ts_win, closes_win, declared) -> bool:
    """Does this scoring window carry an unadjusted split?

    ``declared`` is the ticker's declared split list (``[(iso_date, ratio)]``), ``[]``
    when it has none, or ``None`` when the list is unknown. Known: the one detector,
    ``bars_sanitize.unadjusted_splits``, over the newest :data:`SCORE_BARS` closes
    (read-only; the store is never touched here). Unknown: :func:`split_suspect`.
    """
    tail_c = list(closes_win)[-SCORE_BARS:]
    if declared is None:
        return split_suspect(tail_c)
    if not declared:
        return False
    tail_t = list(ts_win)[-SCORE_BARS:]
    from api.services import bars_sanitize
    bars = [{"t": _iso(t), "c": c} for t, c in zip(tail_t, tail_c)]
    return bool(bars_sanitize.unadjusted_splits(bars, list(declared)))


def ibd_score(closes) -> float | None:
    """The weighted quarter-ratio score, missing terms dropped and renormalised.

    ``None`` when the required 63-day term is missing (fewer than 64 closes).
    """
    ratios = {}
    for label, n, _w in IBD_TERMS:
        r = period_return(closes, n)
        if r is not None:
            ratios[label] = 1.0 + r / 100.0
    if REQUIRED_TERM not in ratios:
        return None
    num = sum(ratios[label] * w for label, _n, w in IBD_TERMS if label in ratios)
    den = sum(w for label, _n, w in IBD_TERMS if label in ratios)
    return num / den if den else None


def plain_returns(closes) -> dict:
    """``{m1, m3, m6, m12}`` percentage returns over 21/63/126/252 bars, ``None`` when short."""
    return {label: period_return(closes, n) for label, n in COMPONENTS}


def percentile_ranks(values: dict) -> dict:
    """``{key: average_rank / N}`` ascending by value; ties share the mean of their positions."""
    items = sorted(values.items(), key=lambda kv: kv[1])
    n = len(items)
    out = {}
    i = 0
    while i < n:
        j = i
        while j + 1 < n and items[j + 1][1] == items[i][1]:
            j += 1
        avg = ((i + 1) + (j + 1)) / 2.0
        for k in range(i, j + 1):
            out[items[k][0]] = avg / n
        i = j + 1
    return out


def rating_from_pct(pct) -> int | None:
    """``max(1, ceil(pct * 99))``, never above 99."""
    if pct is None:
        return None
    return max(1, min(RATING_MAX, math.ceil(pct * RATING_MAX)))


def interpolate_pct(value: float, dist: list) -> float | None:
    """Linear read of ``value`` on ``dist``, the sorted ``[(value, pct), ...]`` of the
    ranked set; clamped to the end percentiles beyond either end. An ETF whose score
    equals a stock's lands exactly on that stock's percentile."""
    if not dist:
        return None
    xs = [x for x, _p in dist]
    i = bisect_right(xs, value)
    if i == 0:
        return dist[0][1]
    if i >= len(dist):
        return dist[-1][1]
    x0, p0 = dist[i - 1]
    x1, p1 = dist[i]
    if x1 == x0:
        return p1
    return p0 + (p1 - p0) * (value - x0) / (x1 - x0)


def _rank_block(values: dict, ranked_set: set) -> dict:
    """Ratings for one metric: percentile over ``ranked_set``, interpolation for the rest."""
    ranked = {t: v for t, v in values.items() if t in ranked_set and v is not None}
    pcts = percentile_ranks(ranked)
    dist = sorted((ranked[t], pcts[t]) for t in ranked)
    out = {}
    for t, v in values.items():
        if v is None:
            out[t] = None
        elif t in pcts:
            out[t] = rating_from_pct(pcts[t])
        else:
            out[t] = rating_from_pct(interpolate_pct(v, dist))
    return out


def compute_ratings(closes_by_ticker: dict, etf_tickers, *, suspects=None) -> dict:
    """Pure: ``{TICKER: {ibd, m1, m3, m6, m12, score, bars}}``.

    * ``score`` is :func:`ibd_score` (``None`` without the 63-day term).
    * ``ibd`` and the components are percentiles across the NON-ETF tickers only;
      an ETF receives each number by :func:`interpolate_pct` against that
      distribution and never moves a stock's rating.
    * A window the split guard marks yields ``bars = 0``, every rating ``None`` and
      ``reason = "unadjusted_split"``; the writer stores no row for it. ``suspects``
      is the set of tickers the caller judged against the declared split list
      (:func:`window_split_suspect`); without it every window gets the fallback,
      :func:`split_suspect`.
    * ``bars`` is the count of closes the ticker was scored on.
    """
    etfs = {str(t).upper() for t in (etf_tickers or ())}
    scores: dict = {}
    comps: dict = {}
    bars: dict = {}
    skipped: list = []
    for t, closes in (closes_by_ticker or {}).items():
        tu = str(t).upper()
        c = [float(x) for x in (closes or ()) if x is not None]
        if (tu in suspects) if suspects is not None else split_suspect(c):
            skipped.append(tu)
            continue
        bars[tu] = len(c)
        scores[tu] = ibd_score(c)
        comps[tu] = plain_returns(c)
    stocks = set(scores) - etfs
    ibd = _rank_block(scores, stocks)
    by_component = {label: _rank_block({t: comps[t][label] for t in comps}, stocks)
                    for label, _n in COMPONENTS}
    out = {}
    for t in scores:
        row = {"ibd": ibd[t]}
        for label, _n in COMPONENTS:
            row[label] = by_component[label][t]
        row["score"] = None if scores[t] is None else round(scores[t], 6)
        row["bars"] = bars[t]
        out[t] = row
    for t in skipped:
        row = {k: None for k in RATING_COLUMNS}
        row["score"] = None
        row["bars"] = 0
        row["reason"] = "unadjusted_split"
        out[t] = row
    return out


# --------------------------------------------------------------------------- #
# sessions
# --------------------------------------------------------------------------- #

def session_key(s) -> str:
    """``"YYYY-MM-DD"`` from a date, a datetime, an ISO string or a ``YYYYMMDD`` int/str."""
    if isinstance(s, datetime):
        return s.date().isoformat()
    if isinstance(s, date):
        return s.isoformat()
    txt = str(s).strip()
    if len(txt) == 8 and txt.isdigit():
        return f"{txt[:4]}-{txt[4:6]}-{txt[6:]}"
    return date.fromisoformat(txt[:10]).isoformat()


def session_ymd(s) -> int:
    """The ``YYYYMMDD`` int of a session key - the daily bar ``ts`` shape."""
    return int(session_key(s).replace("-", ""))


def _ymd_to_date(ymd: int) -> date:
    txt = str(int(ymd))
    return date(int(txt[:4]), int(txt[4:6]), int(txt[6:8]))


def settled_session(now=None) -> date | None:
    """The last completed NYSE session strictly before ``now``'s ET date - the
    screener build's own clock (``snapshot_builder.settled_session``), imported
    inside the function so this module never loads the builder at import time."""
    from api.services.screener.snapshot_builder import settled_session as _settled
    return _settled(now)


def trading_sessions_ending(end: date, n: int) -> list:
    """The ``n`` NYSE sessions ending at ``end`` (inclusive when it is one), oldest first."""
    from api.services import session_calendar as sc
    out: list = []
    d = end
    guard = 0
    while len(out) < n and guard < n * 2 + 30:
        if sc.covers(d) and sc.is_trading_day(d):
            out.append(d)
        d -= timedelta(days=1)
        guard += 1
    return sorted(out)


def _lagging(newest_ymd: int, session_ymd_: int) -> bool:
    return (_ymd_to_date(session_ymd_) - _ymd_to_date(newest_ymd)).days > MAX_BAR_LAG_DAYS


def window_at(ts_list: list, closes: list, to_ymd: int) -> list | None:
    """The newest ``READ_BARS`` closes with ``ts <= to_ymd``, or ``None`` when there
    are none or the newest is more than ``MAX_BAR_LAG_DAYS`` behind the session."""
    b = _window_bounds(ts_list, to_ymd)
    return None if b is None else closes[b[0]:b[1]]


def _window_bounds(ts_list: list, to_ymd: int):
    """``(lo, cut)`` of :func:`window_at`'s slice, or ``None`` (same rule)."""
    cut = bisect_right(ts_list, int(to_ymd))
    if cut == 0 or _lagging(ts_list[cut - 1], int(to_ymd)):
        return None
    return max(0, cut - READ_BARS), cut


# --------------------------------------------------------------------------- #
# defaults (every one injectable; each imported inside its function)
# --------------------------------------------------------------------------- #

def default_universe() -> set:
    """``groups.cap_universe_set()`` - the same file ``rs_rank`` ranks over."""
    from api.services.groups import cap_universe_set
    return set(cap_universe_set())


def default_etf_tickers() -> set:
    """Every ETF this pod can name, from four sources, each best effort:
    ``industry_map`` (industry "Exchange Traded Fund"), the ``rs_benchmarks``
    lists, ``cap_universe.etf_symbols()`` and the snapshot's ``is_etf`` rows."""
    out: set = set()
    try:
        from api.services import industry_map
        from api.services.rs_benchmarks import ETF_INDUSTRY
        out |= {str(t).upper() for t in industry_map.tickers_in_industry(ETF_INDUSTRY) or ()}
    except Exception as e:                                   # noqa: BLE001
        log.warning("[rs_history] industry_map ETF read failed: %s", e)
    try:
        from api.services import rs_benchmarks
        out |= set(rs_benchmarks.LITERAL_BENCHMARKS) | set(rs_benchmarks.SECTOR_ETF.values())
    except Exception as e:                                   # noqa: BLE001
        log.warning("[rs_history] rs_benchmarks ETF read failed: %s", e)
    try:
        from api.services import cap_universe
        out |= {str(t).upper() for t in cap_universe.etf_symbols() or ()}
    except Exception as e:                                   # noqa: BLE001
        log.warning("[rs_history] cap_universe ETF read failed: %s", e)
    try:
        with closing(snapshot_db.connect()) as conn:
            rows = conn.execute("SELECT ticker FROM screener_rows WHERE is_etf = 1").fetchall()
        out |= {str(r["ticker"]).upper() for r in rows}
    except Exception:                                        # noqa: BLE001 - no snapshot yet
        pass
    return out


def default_bars_reader(ticker: str, n: int, to_key: int) -> list:
    """Daily rows ``(ts, o, h, l, c, v)`` with ``ts <= to_key``, newest ``n``, oldest first
    - ``bars_sqlite.get_bars_before``: one indexed seek per ticker, never a by-date scan."""
    from api.services import bars_sqlite
    return bars_sqlite.get_bars_before(ticker, "D", int(n), int(to_key))


def default_splits_reader(ticker: str):
    """The ticker's declared split list from ``bars_sanitize``'s corporate-action
    cache: ``[(iso_date, ratio), ...]``, ``[]`` for none declared, ``None`` when the
    cache does not hold it. CACHE ONLY: a miss schedules no provider fetch (the
    nightly sweeps the whole universe; the cache warms on the serve path)."""
    try:
        from api.services import bars_sanitize as san
        with san.suppress_meta_warm():
            meta = san._meta_cached(str(ticker).upper())
    except Exception:                                        # noqa: BLE001
        return None
    if meta is None:
        return None
    return list(meta.get("splits") or [])


def _split_list(splits_reader, ticker: str):
    try:
        got = splits_reader(ticker)
    except Exception:                                        # noqa: BLE001
        return None
    return None if got is None else list(got)


def default_fast_map() -> dict:
    """``rs_ranking.cached_rank_map()`` - the hourly UCT fast rating, cache only,
    never a recompute (an empty dict on a cold cache; the receipt counts it)."""
    from api.services import rs_ranking
    return rs_ranking.cached_rank_map()


def _fast_for(fast_map, ticker: str):
    if not fast_map:
        return None
    v = fast_map.get(ticker)
    if isinstance(v, dict):
        v = v.get("rs_rank")
    try:
        return None if v is None else int(v)
    except (TypeError, ValueError):
        return None


# --------------------------------------------------------------------------- #
# storage
# --------------------------------------------------------------------------- #

def store_rows(session, ratings: dict, fast_map=None, *, replace: bool = True,
               conn=None) -> int:
    """Write one session's rows. ``replace`` (the nightly) overwrites the session's
    rows; ``False`` (the backfill) keeps any row the nightly already wrote. Tickers
    with ``bars == 0`` get no row. Returns the rows written."""
    key = session_key(session)
    rows = []
    for t, r in (ratings or {}).items():
        if not r.get("bars"):
            continue
        rows.append((key, str(t).upper(), r.get("ibd"), _fast_for(fast_map, str(t).upper()),
                     r.get("m1"), r.get("m3"), r.get("m6"), r.get("m12"),
                     r.get("score"), int(r.get("bars") or 0)))
    verb = "INSERT OR REPLACE" if replace else "INSERT OR IGNORE"
    sql = (f"{verb} INTO {TABLE} (session, ticker, ibd, fast, m1, m3, m6, m12, score, bars) "
           "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")

    def _write(c) -> int:
        ensure_schema(c)
        cur = c.executemany(sql, rows)
        c.commit()
        # ``rowcount`` is what SQLite actually wrote: an ignored row is not a row written.
        return cur.rowcount if cur.rowcount is not None and cur.rowcount >= 0 else len(rows)

    if conn is not None:
        return _write(conn)
    with closing(snapshot_db.connect()) as c:
        return _write(c)


def record_run(receipt: dict) -> None:
    """Persist one run's receipt. Never raises: a receipt that cannot be written must
    not cost the run it describes (the ``record_build_run`` contract)."""
    try:
        note = receipt.get("note")
        with closing(snapshot_db.connect()) as conn:
            ensure_schema(conn)
            conn.execute(
                f"INSERT INTO {RUNS_TABLE} (session, started_at, finished_at, universe, rated, "
                "excluded_etfs, short_history, duration_ms, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (receipt.get("session"), receipt.get("started_at"), receipt.get("finished_at"),
                 receipt.get("universe"), receipt.get("rated"), receipt.get("excluded_etfs"),
                 receipt.get("short_history"), receipt.get("duration_ms"),
                 json.dumps(note, sort_keys=True) if isinstance(note, (dict, list)) else note))
            conn.execute(
                f"DELETE FROM {RUNS_TABLE} WHERE id NOT IN (SELECT id FROM {RUNS_TABLE} "
                "ORDER BY id DESC LIMIT ?)", (RUNS_KEEP,))
            conn.commit()
    except Exception as e:                                   # noqa: BLE001
        log.warning("[rs_history] receipt not written: %s", e)


def last_run() -> dict | None:
    """The newest receipt, ``note`` parsed, or ``None``. Never raises, and never
    creates a table: a dark pod's read answers ``None`` and leaves no schema behind."""
    try:
        with closing(snapshot_db.connect()) as conn:
            if not _table_exists(conn, RUNS_TABLE):
                return None
            r = conn.execute(f"SELECT * FROM {RUNS_TABLE} ORDER BY id DESC LIMIT 1").fetchone()
    except Exception:                                        # noqa: BLE001
        return None
    if r is None:
        return None
    d = dict(r)
    try:
        d["note"] = json.loads(d["note"]) if d.get("note") else None
    except (TypeError, ValueError):
        pass
    return d


# --------------------------------------------------------------------------- #
# the backfill marker (the repo's one-shot heal idiom)
# --------------------------------------------------------------------------- #

def marker_path(data_dir=None) -> str:
    base = data_dir or os.path.dirname(os.path.abspath(snapshot_db.get_db_path()))
    return os.path.join(base, BACKFILL_MARKER)


def marker_state(data_dir=None) -> dict:
    path = marker_path(data_dir)
    content = None
    present = os.path.exists(path)
    if present:
        try:
            with open(path, "r", encoding="utf-8") as fh:
                content = fh.read().strip()
        except OSError:
            content = None
    return {"path": path, "present": present, "content": content}


def _write_marker(path: str, text: str) -> bool:
    try:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
        return True
    except OSError as e:
        log.warning("[rs_history] could not write backfill marker %s: %s", path, e)
        return False


# --------------------------------------------------------------------------- #
# the jobs
# --------------------------------------------------------------------------- #

def _resolve_population(universe, etf_tickers) -> tuple[set, set]:
    uni = {str(t).upper() for t in (universe if universe is not None else default_universe())}
    etfs = {str(t).upper() for t in (etf_tickers if etf_tickers is not None
                                     else default_etf_tickers())}
    return uni, etfs


def _counts_for(ratings: dict, etfs: set) -> dict:
    rated = sum(1 for r in ratings.values() if r.get("ibd") is not None)
    short = sum(1 for r in ratings.values() if r.get("bars") and r.get("ibd") is None)
    split = sum(1 for r in ratings.values() if not r.get("bars"))
    return {"rated": rated, "short_history": short, "split_guard": split,
            "etfs_rated": sum(1 for t, r in ratings.items()
                              if t in etfs and r.get("ibd") is not None)}


def nightly_job(session=None, *, universe=None, data_dir=None, bars_reader=None,
                fast_map=None, etf_tickers=None, now=None, session_fn=None,
                splits_reader=None) -> dict:
    """Rate the universe for one session and store the rows. Never raises.

    ``session`` defaults to the last completed session before ``now`` through
    ``session_fn`` (default :func:`settled_session`). ``universe`` defaults to the
    cap universe, ``etf_tickers`` to :func:`default_etf_tickers`, ``bars_reader`` to
    the web pod's ``bars_sqlite`` daily read and ``fast_map`` to the cached UCT fast
    rating. ``splits_reader`` (default :func:`default_splits_reader`) gives the
    declared split list the split guard judges against. Rows are ``INSERT OR
    REPLACE`` for the session, so a rerun for the same session leaves the same rows.
    Returns the receipt it recorded.
    """
    t0 = time.time()
    receipt = {"ok": False, "session": None, "started_at": t0, "finished_at": None,
               "universe": None, "targets": None, "rated": 0, "rows": 0, "excluded_etfs": None,
               "short_history": 0, "stale": 0, "no_bars": 0, "split_guard": 0,
               "fast_filled": 0, "duration_ms": 0.0, "note": {"source": "nightly"}}
    try:
        if session is None:
            resolved = (session_fn or settled_session)(now)
            if resolved is None:
                receipt["note"]["reason"] = "no_session"
                return _finish(receipt, t0)
            session = resolved
        key = session_key(session)
        ymd = session_ymd(key)
        receipt["session"] = key
        uni, etfs = _resolve_population(universe, etf_tickers)
        targets = sorted(uni | etfs)
        receipt["universe"] = len(uni - etfs)
        receipt["targets"] = len(targets)
        receipt["excluded_etfs"] = len(etfs & set(targets))
        reader = bars_reader or default_bars_reader
        split_reader = splits_reader or default_splits_reader
        fast = fast_map if fast_map is not None else default_fast_map()
        closes_by_ticker: dict = {}
        suspects: set = set()
        split_basis = {"declared": 0, "unknown": 0}
        for t in targets:
            try:
                rows = reader(t, READ_BARS, ymd)
            except Exception as e:                           # noqa: BLE001 - one name, not the run
                log.debug("[rs_history] bars read failed for %s: %s", t, e)
                rows = None
            ts_list, closes = closes_from_rows(rows)
            if not ts_list:
                receipt["no_bars"] += 1
                continue
            bounds = _window_bounds(ts_list, ymd)
            if bounds is None:
                receipt["stale"] += 1
                continue
            win = closes[bounds[0]:bounds[1]]
            declared = _split_list(split_reader, t)
            split_basis["unknown" if declared is None else "declared"] += 1
            if window_split_suspect(ts_list[bounds[0]:bounds[1]], win, declared):
                suspects.add(str(t).upper())
            closes_by_ticker[t] = win
        ratings = compute_ratings(closes_by_ticker, etfs, suspects=suspects)
        counts = _counts_for(ratings, etfs)
        receipt.update(rated=counts["rated"], short_history=counts["short_history"],
                       split_guard=counts["split_guard"])
        receipt["note"]["etfs_rated"] = counts["etfs_rated"]
        receipt["note"]["split_basis"] = split_basis
        receipt["rows"] = store_rows(key, ratings, fast, replace=True)
        receipt["fast_filled"] = sum(1 for t, r in ratings.items()
                                     if r.get("bars") and _fast_for(fast, t) is not None)
        receipt["ok"] = True
    except Exception as e:                                   # noqa: BLE001 - never costs the build
        log.warning("[rs_history] nightly failed: %s: %s", type(e).__name__, e)
        receipt["note"]["error"] = f"{type(e).__name__}: {e}"[:300]
    receipt["note"]["counts"] = {k: receipt[k] for k in
                                 ("targets", "rows", "stale", "no_bars", "split_guard", "fast_filled")}
    out = _finish(receipt, t0)
    out["backfill"] = marker_state(data_dir)
    return out


def _finish(receipt: dict, t0: float) -> dict:
    receipt["finished_at"] = time.time()
    receipt["duration_ms"] = round((receipt["finished_at"] - t0) * 1000, 1)
    record_run(receipt)
    if receipt.get("ok"):
        log.info("[rs_history] %s: rated %s of %s targets (%s ETFs by interpolation, %s short, "
                 "%s stale, %s split-guarded) in %s ms", receipt.get("session"), receipt.get("rated"),
                 receipt.get("targets"), receipt["note"].get("etfs_rated"), receipt.get("short_history"),
                 receipt.get("stale"), receipt.get("split_guard"), receipt["duration_ms"])
    else:
        log.warning("[rs_history] run NOT stored: %s", receipt.get("note"))
    return receipt


def backfill(days: int = BACKFILL_DAYS, *, universe=None, data_dir=None, bars_reader=None,
             etf_tickers=None, now=None, session_fn=None, sessions=None,
             splits_reader=None) -> dict:
    """One-shot point-in-time history over the names held today. Never raises.

    Behind :func:`marker_path` - present means done, and the marker is written only
    after a run that rated at least half of its sessions. Each ticker is read ONCE
    (``READ_BARS + days`` closes to the newest session) and sliced per session, so
    the cost is one indexed seek per name, not one per name per session. Rows are
    ``INSERT OR IGNORE``: a session the nightly already wrote keeps the nightly's
    rows (which carry ``fast``; backfilled rows have none - the fast rating has no
    history). The receipt note says ``survivorship_corrected = False`` (plan §9).
    """
    t0 = time.time()
    marker = marker_path(data_dir)
    if os.path.exists(marker):
        return {"ok": True, "skipped": True, "reason": "marker_present", "marker": marker}
    receipt = {"ok": False, "session": None, "started_at": t0, "finished_at": None,
               "universe": None, "targets": None, "rated": 0, "rows": 0, "excluded_etfs": None,
               "short_history": 0, "duration_ms": 0.0,
               "note": {"source": "backfill", "days": int(days), "sessions": 0, "sessions_rated": 0,
                        "point_in_time": True, "survivorship_corrected": False}}
    try:
        if sessions is None:
            end = (session_fn or settled_session)(now)
            if end is None:
                receipt["note"]["reason"] = "no_session"
                return _finish(receipt, t0)
            sessions = trading_sessions_ending(end, int(days))
        keys = sorted(session_key(s) for s in sessions)
        receipt["note"]["sessions"] = len(keys)
        if not keys:
            receipt["note"]["reason"] = "no_sessions"
            return _finish(receipt, t0)
        receipt["session"] = keys[-1]
        uni, etfs = _resolve_population(universe, etf_tickers)
        targets = sorted(uni | etfs)
        receipt["universe"] = len(uni - etfs)
        receipt["targets"] = len(targets)
        receipt["excluded_etfs"] = len(etfs & set(targets))
        reader = bars_reader or default_bars_reader
        split_reader = splits_reader or default_splits_reader
        depth = READ_BARS + len(keys) + 10
        end_ymd = session_ymd(keys[-1])
        series: dict = {}
        for t in targets:
            try:
                rows = reader(t, depth, end_ymd)
            except Exception as e:                           # noqa: BLE001
                log.debug("[rs_history] backfill read failed for %s: %s", t, e)
                rows = None
            ts_list, closes = closes_from_rows(rows)
            if ts_list:
                series[t] = (ts_list, closes, _split_list(split_reader, t))
        receipt["note"]["tickers_with_bars"] = len(series)
        receipt["note"]["split_basis"] = {
            "declared": sum(1 for s in series.values() if s[2] is not None),
            "unknown": sum(1 for s in series.values() if s[2] is None)}
        rated_sessions = 0
        with closing(snapshot_db.connect()) as conn:
            ensure_schema(conn)
            for key in keys:
                ymd = session_ymd(key)
                closes_by_ticker = {}
                suspects = set()
                for t, (ts_list, closes, declared) in series.items():
                    bounds = _window_bounds(ts_list, ymd)
                    if bounds is None:
                        continue
                    win = closes[bounds[0]:bounds[1]]
                    if window_split_suspect(ts_list[bounds[0]:bounds[1]], win, declared):
                        suspects.add(str(t).upper())
                    closes_by_ticker[t] = win
                ratings = compute_ratings(closes_by_ticker, etfs, suspects=suspects)
                counts = _counts_for(ratings, etfs)
                receipt["rated"] += counts["rated"]
                receipt["short_history"] += counts["short_history"]
                receipt["rows"] += store_rows(key, ratings, None, replace=False, conn=conn)
                if counts["rated"]:
                    rated_sessions += 1
        receipt["note"]["sessions_rated"] = rated_sessions
        receipt["ok"] = rated_sessions >= max(1, len(keys) // 2)
        if receipt["ok"]:
            written = _write_marker(
                marker, f"done ts={int(time.time())} sessions={len(keys)} sessions_rated={rated_sessions} "
                        f"rated_rows={receipt['rated']} survivorship_corrected=False")
            receipt["note"]["marker_written"] = written
        else:
            receipt["note"]["reason"] = "too_few_sessions_rated"
    except Exception as e:                                   # noqa: BLE001
        log.warning("[rs_history] backfill failed: %s: %s", type(e).__name__, e)
        receipt["note"]["error"] = f"{type(e).__name__}: {e}"[:300]
    out = _finish(receipt, t0)
    out["marker"] = marker
    return out


# --------------------------------------------------------------------------- #
# reads
# --------------------------------------------------------------------------- #

def _note(failures, outcome: str) -> None:
    if failures is None:
        return
    failures.setdefault("rs_history", {})
    failures["rs_history"][outcome] = failures["rs_history"].get(outcome, 0) + 1


def _table_exists(conn, name: str) -> bool:
    """A ``sqlite_master`` lookup: answers without creating anything."""
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
                        (name,)).fetchone() is not None


def _sessions_desc(conn, limit=None, upto=None) -> list:
    """The stored sessions, newest first, at most ``limit`` (``None`` = all), none
    after ``upto``. One primary-key seek per session (``MAX(session) WHERE session <
    ?``), so it reads ``limit`` index entries, never every row of those sessions."""
    if upto is None:
        cur = conn.execute(f"SELECT MAX(session) FROM {TABLE}").fetchone()[0]
    else:
        cur = conn.execute(f"SELECT MAX(session) FROM {TABLE} WHERE session <= ?",
                           (upto,)).fetchone()[0]
    out = []
    while cur is not None and (limit is None or len(out) < limit):
        out.append(cur)
        cur = conn.execute(f"SELECT MAX(session) FROM {TABLE} WHERE session < ?",
                           (cur,)).fetchone()[0]
    return out


#: ``read_fields`` reads only the asked tickers' rows (primary-key lookups) when it
#: is asked for at most this many; a larger ask (the screener build's whole
#: universe) reads each session whole, which is cheaper at that size.
NARROW_READ_MAX = 200


def read_fields(tickers, session=None, failures=None, now=None) -> dict:
    """``{TICKER: {ibd, fast, m1, m3, m6, m12, score, bars, d5, d20, asof}}`` for the
    newest session (or ``session``), the ``opt_flow.read_opt_flow_fields`` shape.

    ``d5`` / ``d20`` are ``ibd`` minus the ticker's ``ibd`` in the session 5 and 20
    stored sessions earlier, ``None`` when either row is absent or unrated. A
    ticker with no row gets ``{}`` - never a fabricated ``None`` row. No table or no
    session notes ``missing`` into ``failures``; a newest session older than
    :data:`STALE_DAYS` behind the settled session notes ``stale:<n>d`` and is
    served. Never raises.
    """
    want = []
    seen = set()
    for t in tickers or ():
        tu = str(t or "").strip().upper()
        if tu and tu not in seen:
            seen.add(tu)
            want.append(tu)
    if not want:
        return {}
    try:
        with closing(snapshot_db.connect()) as conn:
            if session is not None:
                key = session_key(session)
                sess = _sessions_desc(conn, 21, upto=key)
                if not sess or sess[0] != key:
                    sess = []
            else:
                sess = _sessions_desc(conn, 21)
            if not sess:
                _note(failures, "missing")
                return {}
            latest = sess[0]
            cols = ", ".join(ROW_COLUMNS)
            # A chart asks for one symbol: read its rows by primary key rather than
            # three whole sessions (review finding #30, 2026-11-07). The build's
            # bulk ask keeps the whole-session read.
            if len(want) <= NARROW_READ_MAX:
                only = f" AND ticker IN ({', '.join('?' * len(want))})"
                args = tuple(want)
            else:
                only, args = "", ()
            rows = {r["ticker"]: dict(r) for r in conn.execute(
                f"SELECT ticker, {cols} FROM {TABLE} WHERE session = ?{only}",
                (latest,) + args).fetchall()}
            earlier = {}
            for n in (5, 20):
                if len(sess) > n:
                    earlier[n] = {r[0]: r[1] for r in conn.execute(
                        f"SELECT ticker, ibd FROM {TABLE} WHERE session = ?{only}",
                        (sess[n],) + args).fetchall()}
    except Exception as e:                                   # noqa: BLE001 - a read never raises
        log.warning("[rs_history] read failed: %s", e)
        _note(failures, "missing")
        return {}
    age = _session_age_days(latest, now)
    if age is not None and age > STALE_DAYS:
        _note(failures, f"stale:{age}d")
    out = {}
    for t in want:
        src = rows.get(t)
        if not src:
            out[t] = {}
            continue
        row = {col: src.get(col) for col in ROW_COLUMNS}
        for n, label in ((5, "d5"), (20, "d20")):
            prior = earlier.get(n, {}).get(t)
            row[label] = (None if row["ibd"] is None or prior is None
                          else int(row["ibd"]) - int(prior))
        row["asof"] = latest
        out[t] = row
    return out


def _session_age_days(latest_key: str, now=None):
    """Calendar days from ``latest_key`` to the settled session; ``None`` when unknown."""
    try:
        settled = settled_session(now)
        if settled is None:
            return None
        return (settled - date.fromisoformat(latest_key)).days
    except Exception:                                        # noqa: BLE001
        return None


def ticker_history(ticker: str, limit: int = 60) -> list:
    """``[{session, ibd, fast, ...}, ...]`` newest first for one ticker, for the chart
    provider's rating history. Never raises; ``[]`` without a table."""
    cols = ", ".join(ROW_COLUMNS)
    try:
        with closing(snapshot_db.connect()) as conn:
            rows = conn.execute(
                f"SELECT session, {cols} FROM {TABLE} WHERE ticker = ? ORDER BY session DESC LIMIT ?",
                (str(ticker or "").upper(), int(limit))).fetchall()
    except Exception:                                        # noqa: BLE001
        return []
    return [dict(r) for r in rows]


def status(data_dir=None) -> dict:
    """The last receipt, row and session counts, the newest session and the
    backfill marker's state. Never raises; an empty store reads as zeros.

    READ-ONLY (review finding #31, 2026-11-07): a pod with no table answers zeros and
    creates nothing, so a dark pod still carries no table. No statement decodes every
    row: ``MAX(session)`` and the session count are primary-key seeks (one per
    session), and the row count is a bare ``COUNT(*)``, which SQLite answers by
    counting b-tree cells (measured 2026-11-07 on 1.1M synthetic rows: 2.7 ms, against
    397 ms for the old ``COUNT(DISTINCT session)`` statement)."""
    rows = sessions = 0
    latest = None
    try:
        with closing(snapshot_db.connect()) as conn:
            if _table_exists(conn, TABLE):
                rows = int(conn.execute(f"SELECT COUNT(*) FROM {TABLE}").fetchone()[0] or 0)
                listed = _sessions_desc(conn)
                sessions, latest = len(listed), (listed[0] if listed else None)
    except Exception as e:                                   # noqa: BLE001
        log.warning("[rs_history] status read failed: %s", e)
    return {"table": TABLE, "rows": rows, "sessions": sessions, "latest_session": latest,
            "last_run": last_run(), "backfill": marker_state(data_dir)}
