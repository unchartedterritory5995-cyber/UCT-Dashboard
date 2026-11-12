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
positions), and the rating is ``max(1, ceil(pct * 99))``. The component ``m1`` is the
same percentile of the plain 21-bar return. ``m3`` (restated 2026-11-12) is the
percentile of the EQUALLY weighted average of the 1-, 2- and 3-month close ratios,
``m3 = (R21 + R42 + R63) / 3`` with ``Rn = close / close[-n]``, and no value without
the 63-bar window (``rs_weighted_return.EQUAL_WEIGHT_COMPONENT_TERMS``; against 61
Deepvue readings the rank correlation went 0.856 -> 0.994 and the mean miss 10.2 ->
6.9 points, and Deepvue's docs call its 3M "equal weighted"). ``m6``, ``m9``
and ``m12`` (restated 2026-11-11) are the percentile of an IBD-style weighted
close-ratio: the newest quarter counts double, so ``m6 = (2 R63 + R126) / 3``,
``m9 = (2 R63 + R126 + R189) / 4`` and ``m12 = (2 R63 + R126 + R189 + R252) / 5``
with ``Rn = close / close[-n]`` and no value unless the series reaches the
component's whole window (a 150-bar stock has no 9M or 12M rank, as before)
(``rs_weighted_return.IBD_STYLE_COMPONENT_TERMS``). Deepvue documents its 1M as unweighted, its 3M as equal
weighted and its 6M and 12M as recency-weighted without publishing weights; against
61 of its readings this method tracked it far better than plain returns at 6M, 9M and
12M and left 1M as it was (3M followed a day later, above). ``m9`` (Deepvue round 2, 2026-11-08) is the
chart's 9M column. ``m9`` is a nullable column added to an existing table by an
idempotent ``ALTER`` (:func:`ensure_schema`); rows written before it stay null
until the backfill's ``--fill-column m9`` mode fills them (below). Sessions stored
before the restatement hold the OLD plain-return ``m6``/``m9``/``m12``; the
``--restate-ranks`` mode rewrites exactly those three columns, and
``--restate-ranks --columns m3`` rewrites ``m3`` (below).

POPULATION. Since 2026-11-12 (owner: "everything until the indicator is 100% perfect")
the ranked set is EVERY non-ETF ticker with a fresh daily bar and enough closes for the
term, about 6,000 names (:func:`ranking_universe`), not the 3,418-name cap universe it
was before: against 61 Deepvue readings the cap universe sat 5 to 8 points below Deepvue
(it ranks all stocks) and the wide one sits within 0.1 point on average, 3.0 points off
per reading, 93 % within 10. Warrants, rights, units and preferreds stay in (removing
them moved the fit by 0.02 points), and so do penny and thin names (price and volume
floors made it 2 to 7 points worse). The ranked set never contains an ETF - an index fund sits on top of the very stocks it
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

ONE JUDGE, NO THRESHOLD (owner decision N4, 2026-11-07). The guard is the repo's
one split detector, ``bars_sanitize.unadjusted_splits``, asked about the ticker's
DECLARED split list: only a declared split whose boundary still shows its factor in
the scored closes trips it, so a real +65 % earnings gap, a real -50 % biotech day
or a real +100 % squeeze is always rated. Any one-bar threshold either passes a 2:1
split or drops a real 50 % move; the ``+/-60 %`` fallback this replaced did both.

The declared list comes from :mod:`api.services.declared_splits` (a stored
provider answer, ``bars_sanitize``'s cache, or a budgeted fetch through
``bars_sanitize._fetch_meta``). A name whose list cannot be had this run is rated
and counted (``note.split_basis.unknown``): there is no evidence of a split to act
on, and a second judge is the thing N4 removed.

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

BACKFILL (plan §9, §17.6; owner decision D2). One trading year, point-in-time
over the names held TODAY, by a ONE-SHOT COMMAND the operator runs on the web pod
when ``RS_HISTORY_ENABLED`` is armed, so the rating is on the chart from day one::

    python -m api.services.screener.rs_history --backfill-days 252 --dry-run
    python -m api.services.screener.rs_history --backfill-days 252

FILLING ONE NEW COLUMN (``m9``, round 2). A plain re-run skips every stored
session, so a column added after the backfill is filled by its own mode, which
recomputes ONLY that column for the stored sessions and rewrites nothing else::

    python -m api.services.screener.rs_history --backfill-days 252 --fill-column m9 --dry-run
    python -m api.services.screener.rs_history --backfill-days 252 --fill-column m9

It ranks each session over the tickers that session STORED (the population its
other columns were ranked over), and it REFUSES, writing nothing, when today's
bars or split guard would change any stored value of another column for any of
those sessions (:func:`fill_column`).

RESTATING THE LONG COMPONENTS (2026-11-11). ``m6``, ``m9`` and ``m12`` changed
meaning (IBD-style, above), and every stored session still holds the plain-return
ones. A mixed history is wrong, so one mode rewrites exactly those three columns
for the sessions already stored, and nothing else::

    python -m api.services.screener.rs_history --backfill-days 252 --restate-ranks --dry-run
    python -m api.services.screener.rs_history --backfill-days 252 --restate-ranks

It ranks each session over the tickers that session STORED, with today's bars,
ETF list and declared splits, and CHECKS before it writes: ``ibd``, ``m1`` and
``m3`` (the columns that did not change) are recomputed and compared with what is
stored. A rank that differs by one point is drift (today's bars are not the bars of
that night) and is allowed up to ``--max-drift-share`` (1 % of the rows checked); a
difference of more than one point, a ticker with no bars window today or one
today's split guard would skip is a hard mismatch, allowed up to the same share. Past
either, NOTHING is written (``reason = would_change_other_values``). A ticker that
cannot be restated inside an allowed run gets ``NULL`` for the three columns, never
an old-meaning number. Each session commits with its row in ``rs_history_restated``;
a session found there is skipped, so a run that dies is finished by running it
again. ``ibd``, ``fast``, ``m1``, ``m3`` and ``score`` are never written by that
restate. Sessions the nightly job stores after this change are already new-meaning;
a restate run rewrites them with the same values.

RESTATING 3M (2026-11-12). ``m3`` changed meaning a day later (equal-weighted 1-, 2-,
3-month average, above). The same mode, one flag more, rewrites exactly that column::

    python -m api.services.screener.rs_history --backfill-days 260 --restate-ranks --columns m3 --dry-run
    python -m api.services.screener.rs_history --backfill-days 260 --restate-ranks --columns m3

It has its own marker table (``rs_history_restated_m3``, method ``m3_eqwt_v1``), so it
is independent of the long restate and either can run first. The check compares
``ibd`` and ``m1`` always, and ``m6``/``m9``/``m12`` for the sessions that carry the
long marker (a column that still holds an old meaning is never compared). Each
session's commit is retried with backoff on ``database is locked``.

Idempotent and resumable: a session that already holds rows (the nightly's, or an
earlier backfill's) is skipped, and each session commits as it is written, so a
run that dies is resumed by running it again. Bounded: ``--max-sessions`` writes
at most that many sessions per invocation and ``days`` is capped at
:data:`BACKFILL_MAX_DAYS`. Nothing imports-and-runs it and no scheduler names it
(``tests/test_rs_rating_history.py`` holds both). The marker
``<data dir>/.rs_history_backfill_v1`` is written once every requested session is
stored, as a record for ``status``; it no longer gates a run. The receipt records
``survivorship_corrected = False`` so the readout can say "universe as held,
survivorship not yet corrected" until a delisting source exists.
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
import sqlite3
import time
from array import array
from bisect import bisect_right
from contextlib import closing, contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path

from api.services.rs_weighted_return import (
    BLENDED_COMPONENT_TERMS,
    EQUAL_WEIGHT_COMPONENT_TERMS,
    IBD_COMPONENTS,
    IBD_M9_COMPONENT,
    IBD_STYLE_COMPONENT_TERMS,
    ibd_style_component,
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
#: Every component this table STORES, shortest window first: the four above plus
#: the 9-month one (round 2). The screener and the methodology page read
#: ``COMPONENTS``; the chart reads all five.
STORED_COMPONENTS = tuple(sorted(IBD_COMPONENTS + (IBD_M9_COMPONENT,), key=lambda c: c[1]))
#: The columns a later round ADDED to the table (nullable, by ``ALTER``), each with
#: its SQL type. A read selects one only when the table already carries it.
ADDED_COLUMNS = {"m9": "INTEGER"}
#: The three columns whose MEANING changed on 2026-11-11 (IBD-style weighting) and
#: that ``--restate-ranks`` rewrites for the sessions already stored.
RESTATE_COLUMNS = tuple(label for label, _t in IBD_STYLE_COMPONENT_TERMS)
#: The columns a restate ALWAYS compares (they have never changed meaning): it
#: recomputes them and compares them with the stored values before it writes
#: anything. The columns that changed later are added per session once that
#: session carries their restate marker (:func:`_compared_for`).
RESTATE_COMPARED = ("ibd", "m1")
#: ``rs_history_restated.method`` for a session carrying the IBD-style long columns.
RESTATE_METHOD = "ibd_style_v1"
RESTATED_TABLE = "rs_history_restated"
#: The second restate (2026-11-12): ``m3`` became the equal-weighted average of the
#: 1-, 2- and 3-month close ratios. Its OWN marker table, because
#: ``rs_history_restated`` holds one row per session (``session`` is its primary
#: key) and a second method written there would overwrite the first one's marker.
RESTATE_M3_COLUMNS = tuple(label for label, _t in EQUAL_WEIGHT_COMPONENT_TERMS)
RESTATE_M3_METHOD = "m3_eqwt_v1"
RESTATED_M3_TABLE = "rs_history_restated_m3"
#: The restates the CLI offers: ``kind`` -> (columns rewritten, marker method, marker
#: table). ``long`` is ``--restate-ranks``; ``m3`` is ``--restate-ranks --columns m3``.
RESTATE_KINDS = {
    "long": (RESTATE_COLUMNS, RESTATE_METHOD, RESTATED_TABLE),
    "m3": (RESTATE_M3_COLUMNS, RESTATE_M3_METHOD, RESTATED_M3_TABLE),
}
#: Every column a restate may compare or rewrite, in stored order.
RESTATE_ALL_COLUMNS = ("ibd", "m1", "m3", "m6", "m9", "m12")
#: A per-session commit that meets ``database is locked`` is retried this many times
#: (backoff ``LOCK_RETRY_BASE_S`` doubling, capped at 60 s) before the run gives up:
#: the first real restate (2026-11-12) died at session 249 of 254 on one lock.
LOCK_RETRY_ATTEMPTS = 6
LOCK_RETRY_BASE_S = 5.0
_lock_sleep = time.sleep
#: Share of the rows checked that may drift by one rating point, and share that may
#: be a hard mismatch, before a restate refuses to write.
RESTATE_DRIFT_SHARE = 0.01
#: The third restate (2026-11-12): the RATED UNIVERSE widened from the 3,418-name cap
#: universe to every non-ETF ticker with a daily bar (``ranking_universe``, "U1" in the
#: fit). ``--restate-universe`` re-ranks every stored session for ALL six rating columns,
#: so it also writes the long and the m3 markers (nothing is left for those restates to
#: do). Its OWN marker table for the same reason the m3 one has one.
UNIVERSE_METHOD = "universe_u1_v1"
UNIVERSE_TABLE = "rs_history_restated_universe"
#: A session's ranked set (non-ETF names with a bars window that night) may differ from
#: the median session's by this share before the restate refuses to write ANYTHING: a
#: stale bars store or a half-listed night would otherwise rank against a fragment.
UNIVERSE_BAND = 0.15
#: ... and a session ranking fewer names than this is never written, whatever the
#: median says (the cap universe it replaces held 3,418).
UNIVERSE_MIN_RANKED = 3000
#: A rating that moves by more than this many points counts as a BIG shift in the
#: distribution summary the restate prints (the owner sees what happened).
UNIVERSE_BIG_SHIFT = 15
#: The columns ``--fill-column`` may fill (each one a stored component).
FILLABLE_COLUMNS = ("m9",)
#: The rating scale's top; the bottom is 1.
RATING_MAX = 99
#: Closes read per ticker: the 252-bar term needs 253 closes, plus a margin for a
#: missing day or two so a short gap does not cost the year term.
READ_BARS = 270
#: Closes the score reads: the 252-bar term compares the newest close with the one
#: 252 bars back, so a split older than these closes cannot move the rating.
SCORE_BARS = 253
#: A ticker whose newest stored bar is more than this many calendar days behind the
#: session is not rated for it (a stale name, or a hole in the store). Wide enough
#: for a long weekend plus a night the prewarm missed.
MAX_BAR_LAG_DAYS = 5
#: ``read_fields`` notes ``stale:<n>d`` when the newest session is older than this.
STALE_DAYS = 3
#: The backfill's default depth: one trading year.
BACKFILL_DAYS = 252
#: The deepest backfill one command accepts: five trading years. A typo of an
#: extra digit is refused rather than read as a 25-year universe-as-held history.
BACKFILL_MAX_DAYS = 5 * BACKFILL_DAYS
#: The backfill writes nothing while more split lists than this are unknown: the
#: larger of a small floor and a share of the names read (review, 2026-11-07). A
#: session it writes is never rewritten, so a name rated unguarded there stays
#: unguarded; a run refused for this is simply run again once the provider answers.
BACKFILL_UNKNOWN_SPLITS_FLOOR = 5
BACKFILL_UNKNOWN_SPLITS_SHARE = 0.01

RATING_COLUMNS = ("ibd", "m1", "m3", "m6", "m9", "m12")
ROW_COLUMNS = ("ibd", "fast", "m1", "m3", "m6", "m9", "m12", "score", "bars")

_SQL = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
    session TEXT NOT NULL,
    ticker TEXT NOT NULL,
    ibd INTEGER, fast INTEGER,
    m1 INTEGER, m3 INTEGER, m6 INTEGER, m12 INTEGER,
    score REAL, bars INTEGER, m9 INTEGER,
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
    """Create both tables and add any later column (idempotent). Called on every
    write, like ``volume_curve``.

    A table created before round 2 has no ``m9``: it is added by ``ALTER TABLE
    ADD COLUMN`` (nullable, so every existing row reads null and nothing is
    rewritten), once, when ``PRAGMA table_info`` says it is missing. The
    ``(ticker, session)`` index the rating view's series read walks is created
    here too (it has been since 2a-03)."""
    conn.execute(_SQL)
    have = _columns(conn, TABLE)
    for col, kind in ADDED_COLUMNS.items():
        if col not in have:
            conn.execute(f"ALTER TABLE {TABLE} ADD COLUMN {col} {kind}")
    conn.execute(_INDEX_SQL)
    conn.execute(_RUNS_SQL)


def _columns(conn, name: str) -> set:
    """The columns ``name`` carries (``PRAGMA table_info``; empty without the table)."""
    return {r[1] for r in conn.execute(f"PRAGMA table_info({name})").fetchall()}


def _read_columns(conn, wanted=ROW_COLUMNS) -> tuple:
    """``wanted`` less any ADDED column the table does not carry yet. A read never
    alters the table (a dark pod keeps no schema), so a pre-round-2 table is read
    without ``m9`` and the row reports it as None."""
    have = _columns(conn, TABLE)
    return tuple(c for c in wanted if c not in ADDED_COLUMNS or c in have)


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


def _iso(ymd) -> str:
    s = str(int(ymd))
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}"


def window_split_suspect(ts_win, closes_win, declared) -> bool:
    """Does this scoring window carry an unadjusted split?

    ``declared`` is the ticker's declared split list (``[(iso_date, ratio)]``), ``[]``
    when it has none, or ``None`` when the list is unknown. The one detector,
    ``bars_sanitize.unadjusted_splits``, judges the newest :data:`SCORE_BARS` closes
    (read-only; the store is never touched here); the older closes are not read
    because the score never reaches them. Nothing declared, or nothing known, is
    no evidence of a split: ``False`` (the caller counts the unknown ones).
    """
    if not declared:
        return False
    tail_c = list(closes_win)[-SCORE_BARS:]
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
    """``{m1, m3, m6, m9, m12}`` plain percentage returns over 21/63/126/189/252
    bars, ``None`` when short (``m9`` needs 190 closes). Only ``m1`` is ranked from
    these now; ``m3``/``m6``/``m9``/``m12`` are ranked from
    :func:`component_values`' blended ratios. Kept as the plain reference."""
    return {label: period_return(closes, n) for label, n in STORED_COMPONENTS}


def component_values(closes) -> dict:
    """``{m1, m3, m6, m9, m12}`` - the numbers each component rank is taken over.

    ``m1`` is the plain 21-bar percentage return. ``m3`` is the equal-weighted
    average of the 1-, 2- and 3-month close ratios
    (:data:`EQUAL_WEIGHT_COMPONENT_TERMS`, restated 2026-11-12) and ``m6``, ``m9``
    and ``m12`` are the IBD-style weighted close-ratios of
    :data:`IBD_STYLE_COMPONENT_TERMS` (newest quarter double-weighted). A rank
    only needs the ORDER, and the kinds are never ranked against each other, so
    the units may differ. ``None`` when the series cannot supply the value.
    """
    plain = {label: period_return(closes, n) for label, n in STORED_COMPONENTS}
    out = {"m1": plain["m1"]}
    for label, terms in BLENDED_COMPONENT_TERMS:
        out[label] = ibd_style_component(closes, terms)
    return {label: out[label] for label, _n in STORED_COMPONENTS}


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
    """Pure: ``{TICKER: {ibd, m1, m3, m6, m9, m12, score, bars}}``.

    * ``score`` is :func:`ibd_score` (``None`` without the 63-day term).
    * ``ibd`` and the components are percentiles across the NON-ETF tickers only;
      an ETF receives each number by :func:`interpolate_pct` against that
      distribution and never moves a stock's rating.
    * A window the split guard marks yields ``bars = 0``, every rating ``None`` and
      ``reason = "unadjusted_split"``; the writer stores no row for it. ``suspects``
      is the set of tickers the caller judged against the declared split list
      (:func:`window_split_suspect`); ``None`` means none was marked.
    * ``bars`` is the count of closes the ticker was scored on.
    """
    etfs = {str(t).upper() for t in (etf_tickers or ())}
    marked = {str(t).upper() for t in (suspects or ())}
    scores: dict = {}
    comps: dict = {}
    bars: dict = {}
    skipped: list = []
    for t, closes in (closes_by_ticker or {}).items():
        tu = str(t).upper()
        c = [float(x) for x in (closes or ()) if x is not None]
        if tu in marked:
            skipped.append(tu)
            continue
        bars[tu] = len(c)
        scores[tu] = ibd_score(c)
        comps[tu] = component_values(c)
    stocks = set(scores) - etfs
    ibd = _rank_block(scores, stocks)
    by_component = {label: _rank_block({t: comps[t][label] for t in comps}, stocks)
                    for label, _n in STORED_COMPONENTS}
    out = {}
    for t in scores:
        row = {"ibd": ibd[t]}
        for label, _n in STORED_COMPONENTS:
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
    """``groups.cap_universe_set()`` - the file the HOURLY ``rs_rank`` ranks over.

    ⛔ NOT the nightly rating's population any more (2026-11-12): that is
    :func:`ranking_universe`. This stays for the tools and tests that name the cap
    universe on purpose."""
    from api.services.groups import cap_universe_set
    return set(cap_universe_set())


#: What a rankable symbol looks like: letters and digits with ``.``/``-`` class
#: separators, at most ten characters. Index, vol and crypto feeds held beside the
#: equities in ``bars.db`` (``$SPX``, ``^VIX``, ``X:BTCUSD``) fail it.
_RANKABLE_SYMBOL = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,9}$")


def rankable_symbol(ticker) -> bool:
    """True for a symbol that can be a stock in the ranked set: the pattern above and
    not one of the index symbols ``api.index_bars`` routes elsewhere."""
    tu = str(ticker or "").strip().upper()
    if not _RANKABLE_SYMBOL.match(tu):
        return False
    try:
        from api.index_bars import is_index
        return not is_index(tu)
    except Exception:                                        # noqa: BLE001 - the pattern alone is enough
        return True


def ranking_universe(*, lister=None, last_daily_ts=None) -> set:
    """The nightly rating's candidate population (2026-11-12, owner: rank against
    EVERYTHING, as Deepvue and IBD do): every rankable ticker that holds a DAILY bar in
    ``bars.db``, ETFs included (the caller takes them out of the ranked set through
    its ETF list, exactly as before).

    This is only the candidate list. Each session still keeps a name only when it has a
    FRESH bar (newest within :data:`MAX_BAR_LAG_DAYS` calendar days of the session,
    ``_window_bounds``) and enough closes for the term being ranked, so a stale,
    delisted-long-ago or brand-new name drops out of that session and that term by the
    rules it always used. NO type filter (warrants, rights, units and preferreds stay
    in) and NO price or volume floor: against 61 Deepvue readings both filters changed
    the fit by less than half a rating point or made it 2 to 7 points worse. The
    listing walks the primary key (one seek per ticker, ``bars_sqlite.iter_tickers``).

    ``lister`` / ``last_daily_ts`` are the test seams (default: the web pod's store)."""
    if lister is None or last_daily_ts is None:
        from api.services import bars_sqlite
        if lister is None:
            def lister():                                    # noqa: E306
                return bars_sqlite.iter_tickers(bars_sqlite._conn())
        if last_daily_ts is None:
            def last_daily_ts(t):                            # noqa: E306
                return bars_sqlite.get_last_ts(t, "D")
    out: set = set()
    for t in lister():
        tu = str(t or "").strip().upper()
        if not tu or tu in out or not rankable_symbol(tu):
            continue
        try:
            if last_daily_ts(tu) is None:
                continue
        except Exception:                                    # noqa: BLE001 - one name, not the run
            continue
        out.add(tu)
    return out


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


#: ``split_fetch_budget`` default: the nightly's provider-fetch budget
#: (``declared_splits.DEFAULT_FETCH_BUDGET``); ``None`` means no limit.
NIGHTLY_BUDGET = "nightly"


def default_splits_reader(conn=None, *, budget=NIGHTLY_BUDGET, persist: bool = True):
    """A declared-split-list reader for one run: ``reader(ticker)`` answers
    ``[(iso_date, ratio), ...]``, ``[]`` for none declared, ``None`` when unknown.

    :class:`api.services.declared_splits.DeclaredSplits` over ``conn`` (the run's
    ``screener.db`` connection, where its memo table lives): a stored provider
    answer, then ``bars_sanitize``'s cache, then at most ``budget`` provider
    fetches (:data:`NIGHTLY_BUDGET`: the module default; ``None``: no limit). A cold
    cache alone would leave most of the universe unjudged (that module's header
    says why)."""
    from api.services import declared_splits
    if budget == NIGHTLY_BUDGET:
        budget = declared_splits.DEFAULT_FETCH_BUDGET
    return declared_splits.DeclaredSplits(conn, budget=budget, persist=persist)


def _split_stats(reader) -> dict | None:
    stats = getattr(reader, "stats", None)
    return dict(stats) if isinstance(stats, dict) else None


def _split_list(splits_reader, ticker: str):
    try:
        got = splits_reader(ticker)
    except Exception:                                        # noqa: BLE001
        return None
    return None if got is None else list(got)


def default_fast_map() -> dict:
    """``rs_ranking.fast_rank_map()`` - the hourly UCT fast rating, cache only,
    never a recompute (an empty dict on a cold cache; the receipt counts it).

    ⛔ THE RAW FAST MAP, NOT ``cached_rank_map`` (RS split unit U5a). Under
    ``RS_RANK_IBD_ENABLED`` that reader hands back THIS table's ``ibd`` as
    ``rs_rank``, so reading it here would store the rating in its own ``fast``
    column: a circle, and the one column that records the other formula gone."""
    from api.services import rs_ranking
    return rs_ranking.fast_rank_map()


def _fast_for(fast_map, ticker: str):
    if not fast_map:
        return None
    v = fast_map.get(ticker)
    if isinstance(v, dict):
        # A unified entry (U5a) keeps the hourly value under ``rs_rank_fast``;
        # a raw one carries it as ``rs_rank``. Either way the FAST rating is stored.
        v = v.get("rs_rank_fast", v.get("rs_rank"))
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
                     r.get("m1"), r.get("m3"), r.get("m6"), r.get("m9"), r.get("m12"),
                     r.get("score"), int(r.get("bars") or 0)))
    verb = "INSERT OR REPLACE" if replace else "INSERT OR IGNORE"
    sql = (f"{verb} INTO {TABLE} (session, ticker, ibd, fast, m1, m3, m6, m9, m12, score, bars) "
           "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")

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
    uni = {str(t).upper() for t in (universe if universe is not None else ranking_universe())}
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
                splits_reader=None, split_fetch_budget=NIGHTLY_BUDGET) -> dict:
    """Rate the universe for one session and store the rows. Never raises.

    ``session`` defaults to the last completed session before ``now`` through
    ``session_fn`` (default :func:`settled_session`). ``universe`` defaults to the
    cap universe, ``etf_tickers`` to :func:`default_etf_tickers`, ``bars_reader`` to
    the web pod's ``bars_sqlite`` daily read and ``fast_map`` to the cached UCT fast
    rating. ``splits_reader`` (default :func:`default_splits_reader`, with
    ``split_fetch_budget``) gives the declared split list the split guard judges
    against. Rows are ``INSERT OR REPLACE`` for the session, so a rerun for the same
    session leaves the same rows. Returns the receipt it recorded.
    """
    kw = dict(universe=universe, data_dir=data_dir, bars_reader=bars_reader, fast_map=fast_map,
              etf_tickers=etf_tickers, now=now, session_fn=session_fn)
    if splits_reader is not None:
        return _nightly(session, splits_reader=splits_reader, **kw)
    conn = None
    try:
        conn = snapshot_db.connect()                         # the split-list memo lives in screener.db
    except Exception as e:                                   # noqa: BLE001 - never costs the build
        log.warning("[rs_history] split-list memo unavailable (%s); judging from the cache", e)
    try:
        return _nightly(session, splits_reader=default_splits_reader(conn, budget=split_fetch_budget), **kw)
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:                                # noqa: BLE001
                pass


def _nightly(session, *, universe, data_dir, bars_reader, fast_map, etf_tickers, now,
             session_fn, splits_reader) -> dict:
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
        split_reader = splits_reader
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
        lists = _split_stats(split_reader)
        if lists is not None:
            receipt["note"]["split_lists"] = lists
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


def _finish(receipt: dict, t0: float, *, record: bool = True) -> dict:
    receipt["finished_at"] = time.time()
    receipt["duration_ms"] = round((receipt["finished_at"] - t0) * 1000, 1)
    if record:
        record_run(receipt)
    if receipt.get("ok"):
        log.info("[rs_history] %s: rated %s of %s targets (%s ETFs by interpolation, %s short, "
                 "%s stale, %s split-guarded) in %s ms", receipt.get("session"), receipt.get("rated"),
                 receipt.get("targets"), receipt["note"].get("etfs_rated"), receipt.get("short_history"),
                 receipt.get("stale"), receipt.get("split_guard"), receipt["duration_ms"])
    else:
        log.warning("[rs_history] run NOT stored: %s", receipt.get("note"))
    return receipt


#: ``split_fetch_budget`` default for :func:`backfill`: no provider limit for a real
#: run (a first year needs every name's list once), none at all for a dry run.
AUTO_BUDGET = "auto"


@contextmanager
def _backfill_conn(dry_run: bool):
    """The backfill's ``screener.db`` connection. A dry run opens the file READ-ONLY
    and, when it does not exist yet, opens nothing (``None``): a dry run never
    creates the file, a table or a memo row."""
    if not dry_run:
        with closing(snapshot_db.connect()) as conn:
            yield conn
        return
    path = snapshot_db.get_db_path()
    if not os.path.exists(path):
        yield None
        return
    conn = sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True, timeout=30)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def _stored_sessions(conn, keys) -> set:
    """The keys that already hold at least one row: one primary-key seek per key,
    and nothing created when the table does not exist yet."""
    if not keys or conn is None or not _table_exists(conn, TABLE):
        return set()
    out = set()
    for key in keys:
        if conn.execute(f"SELECT 1 FROM {TABLE} WHERE session = ? LIMIT 1", (key,)).fetchone():
            out.add(key)
    return out


def backfill(days: int = BACKFILL_DAYS, *, universe=None, data_dir=None, bars_reader=None,
             etf_tickers=None, now=None, session_fn=None, sessions=None,
             splits_reader=None, dry_run: bool = False, max_sessions=None,
             split_fetch_budget=AUTO_BUDGET, log_every: int = 25) -> dict:
    """Point-in-time rating history for the ``days`` sessions ending at the settled
    session, over the names held today (owner decision D2). Never raises.

    IDEMPOTENT: a session that already holds rows is skipped, never rewritten, so a
    session the nightly wrote keeps the nightly's rows (they carry ``fast``; the
    fast rating has no history to backfill). RESUMABLE: each session commits as it
    is written, newest first, so a run that dies, or one bounded by
    ``max_sessions``, is finished by running the same command again. BOUNDED:
    ``days`` must lie in ``1 .. BACKFILL_MAX_DAYS`` and ``max_sessions`` caps the
    sessions written per call. Each ticker is read ONCE (``READ_BARS`` plus the span
    still to write) and sliced per session: one indexed seek per name.

    ``dry_run`` reads and rates exactly as a real run would and writes NOTHING: no
    row, no receipt, no marker, no split-list memo. Its ``split_fetch_budget``
    defaults to 0 (stored answers and the cache only, no provider call); a real
    run's defaults to no limit. The marker is written once every requested session
    holds rows. The receipt note says ``survivorship_corrected = False`` (plan §9).
    """
    t0 = time.time()
    marker = marker_path(data_dir)
    receipt = {"ok": False, "dry_run": bool(dry_run), "session": None, "started_at": t0,
               "finished_at": None, "universe": None, "targets": None, "rated": 0, "rows": 0,
               "excluded_etfs": None, "short_history": 0, "split_guard": 0, "duration_ms": 0.0,
               "note": {"source": "backfill", "days": None, "sessions": 0, "sessions_stored": 0,
                        "sessions_todo": 0, "sessions_written": 0, "sessions_rated": 0,
                        "sessions_remaining": 0, "point_in_time": True,
                        "survivorship_corrected": False}}
    record = not dry_run
    try:
        try:
            days = int(days)
        except (TypeError, ValueError):
            days = 0
        receipt["note"]["days"] = days
        if not 1 <= days <= BACKFILL_MAX_DAYS:
            receipt["note"]["reason"] = f"days must be 1 to {BACKFILL_MAX_DAYS}"
            return _finish(receipt, t0, record=False)
        if sessions is None:
            end = (session_fn or settled_session)(now)
            if end is None:
                receipt["note"]["reason"] = "no_session"
                return _finish(receipt, t0, record=record)
            sessions = trading_sessions_ending(end, days)
        keys = sorted({session_key(s) for s in sessions})
        receipt["note"]["sessions"] = len(keys)
        if not keys:
            receipt["note"]["reason"] = "no_sessions"
            return _finish(receipt, t0, record=record)
        receipt["session"] = keys[-1]
        with _backfill_conn(dry_run) as conn:
            stored = _stored_sessions(conn, keys)
            todo = sorted((k for k in keys if k not in stored), reverse=True)   # newest first
            receipt["note"]["sessions_stored"] = len(stored)
            if max_sessions is not None and int(max_sessions) >= 0:
                todo = todo[:int(max_sessions)]
            receipt["note"]["sessions_todo"] = len(todo)
            if not todo:
                receipt["ok"] = True
                receipt["note"]["reason"] = "nothing_to_do"
                remaining = len(keys) - len(stored)
                receipt["note"]["sessions_remaining"] = remaining
                if not dry_run and remaining == 0 and not os.path.exists(marker):
                    receipt["note"]["marker_written"] = _write_marker(
                        marker, f"done ts={int(time.time())} sessions={len(keys)} survivorship_corrected=False")
                return _finish(receipt, t0, record=record)
            _backfill_sessions(receipt, conn, keys, todo, universe=universe, etf_tickers=etf_tickers,
                               bars_reader=bars_reader, splits_reader=splits_reader, dry_run=dry_run,
                               split_fetch_budget=split_fetch_budget, log_every=log_every)
            remaining = len(keys) - len(_stored_sessions(conn, keys)) if not dry_run else \
                len(keys) - len(stored) - len(todo)
        note = receipt["note"]
        note["sessions_remaining"] = remaining
        receipt["ok"] = note["sessions_rated"] >= max(1, len(todo) // 2)
        if note.get("reason") == "split_lists_unknown":
            receipt["ok"] = False
        elif not receipt["ok"]:
            note["reason"] = "too_few_sessions_rated"
        elif not dry_run and remaining == 0:
            note["marker_written"] = _write_marker(
                marker, f"done ts={int(time.time())} sessions={len(keys)} "
                        f"sessions_rated={note['sessions_rated']} rated_rows={receipt['rated']} "
                        f"survivorship_corrected=False")
    except Exception as e:                                   # noqa: BLE001
        log.warning("[rs_history] backfill failed: %s: %s", type(e).__name__, e)
        receipt["note"]["error"] = f"{type(e).__name__}: {e}"[:300]
    out = _finish(receipt, t0, record=record)
    out["marker"] = marker
    return out


def _backfill_sessions(receipt, conn, keys, todo, *, universe, etf_tickers, bars_reader,
                       splits_reader, dry_run, split_fetch_budget, log_every) -> None:
    """The body of :func:`backfill`: read every target once, rate and store each
    session in ``todo`` (newest first). Fills ``receipt`` in place."""
    note = receipt["note"]
    uni, etfs = _resolve_population(universe, etf_tickers)
    targets = sorted(uni | etfs)
    receipt["universe"] = len(uni - etfs)
    receipt["targets"] = len(targets)
    receipt["excluded_etfs"] = len(etfs & set(targets))
    reader = bars_reader or default_bars_reader
    if splits_reader is None:
        budget = (0 if dry_run else None) if split_fetch_budget == AUTO_BUDGET else split_fetch_budget
        splits_reader = default_splits_reader(conn, budget=budget, persist=not dry_run)
    # Bars from READ_BARS before the oldest session still to write, to the newest.
    span = keys.index(todo[0]) - keys.index(todo[-1]) + 1
    depth = READ_BARS + span + 10
    end_ymd = session_ymd(todo[0])
    series: dict = {}
    for t in targets:
        try:
            rows = reader(t, depth, end_ymd)
        except Exception as e:                               # noqa: BLE001
            log.debug("[rs_history] backfill read failed for %s: %s", t, e)
            rows = None
        ts_list, closes = closes_from_rows(rows)
        if ts_list:
            series[t] = (ts_list, closes, _split_list(splits_reader, t))
    note["tickers_with_bars"] = len(series)
    note["split_basis"] = {"declared": sum(1 for s in series.values() if s[2] is not None),
                           "unknown": sum(1 for s in series.values() if s[2] is None)}
    lists = _split_stats(splits_reader)
    if lists is not None:
        note["split_lists"] = lists
    unknown = note["split_basis"]["unknown"]
    allowed = max(BACKFILL_UNKNOWN_SPLITS_FLOOR, int(len(series) * BACKFILL_UNKNOWN_SPLITS_SHARE))
    if not dry_run and unknown > allowed:
        # ⛔ WRITE NOTHING RATHER THAN A YEAR OF UNGUARDED ROWS (review, 2026-11-07).
        # A written session is skipped by every later run, so names rated without a
        # split list here would never be judged again. Run the command again when the
        # provider answers; `split_lists.no_key` says when the key is the reason.
        note["reason"] = "split_lists_unknown"
        note["split_lists_unknown"] = unknown
        note["split_lists_unknown_allowed"] = allowed
        log.warning("[rs_history] backfill wrote nothing: %d split lists unknown (allowed %d)%s",
                    unknown, allowed, " - FMP_API_KEY is not set" if (lists or {}).get("no_key") else "")
        return
    if not dry_run:
        ensure_schema(conn)
    for n, key in enumerate(todo, 1):
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
        receipt["split_guard"] += counts["split_guard"]
        if dry_run:
            receipt["rows"] += sum(1 for r in ratings.values() if r.get("bars"))
        else:
            receipt["rows"] += store_rows(key, ratings, None, replace=False, conn=conn)
            note["sessions_written"] += 1
        if counts["rated"]:
            note["sessions_rated"] += 1
        if log_every and n % log_every == 0:
            log.info("[rs_history] backfill %d/%d sessions (newest first), at %s", n, len(todo), key)


# --------------------------------------------------------------------------- #
# filling one added column for the stored sessions (round 2: ``m9``)
# --------------------------------------------------------------------------- #

#: The stored values the fill compares before it writes: every rank column but the
#: one being filled. ``score`` (a float) and ``fast`` (the hourly rating captured at
#: write time) are not recomputable ranks and are not compared.
FILL_COMPARED = ("ibd", "m1", "m3", "m6", "m12")
#: Mismatch examples kept in the receipt.
FILL_EXAMPLES = 10


def _sessions_missing_column(conn, keys, column: str) -> list:
    """The stored keys whose rows hold no non-null ``column`` (all of them when the
    table does not carry the column yet), newest first. One seek per key."""
    has_col = column in _columns(conn, TABLE)
    out = []
    for key in keys:
        if not conn.execute(f"SELECT 1 FROM {TABLE} WHERE session = ? LIMIT 1", (key,)).fetchone():
            continue
        if has_col and conn.execute(f"SELECT 1 FROM {TABLE} WHERE session = ? AND {column} IS NOT NULL "
                                    "LIMIT 1", (key,)).fetchone():
            continue
        out.append(key)
    return sorted(out, reverse=True)


def _stored_rows(conn, key: str) -> dict:
    """``{TICKER: {ibd, m1, m3, m6, m12}}`` for one stored session (a primary-key range)."""
    cols = ", ".join(FILL_COMPARED)
    return {r[0]: dict(zip(FILL_COMPARED, tuple(r)[1:])) for r in conn.execute(
        f"SELECT ticker, {cols} FROM {TABLE} WHERE session = ?", (key,)).fetchall()}


def _fill_session(key, stored: dict, series: dict, etfs: set):
    """Recompute one stored session over the tickers it STORED. Returns
    ``(ratings, mismatches)``: ``mismatches`` is ``[(kind, ticker, detail)]`` where
    ``kind`` is ``window`` (no bars window for the session today), ``guard`` (today's
    split guard skips a ticker the session rated) or ``values`` (a compared rank
    differs from the stored one)."""
    ymd = session_ymd(key)
    closes_by_ticker, suspects, bad = {}, set(), []
    for t in stored:
        s = series.get(t)
        bounds = None if s is None else _window_bounds(s[0], ymd)
        if bounds is None:
            bad.append(("window", t, None))
            continue
        ts_list, closes, declared = s
        win = closes[bounds[0]:bounds[1]]
        if window_split_suspect(ts_list[bounds[0]:bounds[1]], win, declared):
            suspects.add(t)
        closes_by_ticker[t] = win
    ratings = compute_ratings(closes_by_ticker, etfs, suspects=suspects)
    for t in sorted(closes_by_ticker):
        r = ratings.get(t) or {}
        if not r.get("bars"):
            bad.append(("guard", t, None))
            continue
        diff = {c: (stored[t].get(c), r.get(c)) for c in FILL_COMPARED if stored[t].get(c) != r.get(c)}
        if diff:
            bad.append(("values", t, diff))
    return ratings, bad


def fill_column(column: str = "m9", days: int = BACKFILL_DAYS, *, etf_tickers=None, bars_reader=None,
                now=None, session_fn=None, sessions=None, splits_reader=None, dry_run: bool = False,
                max_sessions=None, split_fetch_budget=AUTO_BUDGET, log_every: int = 25) -> dict:
    """Fill ONE added column (:data:`FILLABLE_COLUMNS`) for the sessions already
    stored in the last ``days``, rewriting nothing else. Never raises.

    * WHICH SESSIONS: every stored session in the span whose rows hold no value of
      ``column`` yet (a session the nightly wrote after round 2 already does and is
      skipped), newest first, at most ``max_sessions`` per call. Re-running is
      resumable and a finished store is ``nothing_to_do``.
    * WHICH POPULATION: each session is ranked over the tickers it STORED, the set
      its other columns were ranked over, with today's ETF list, bars and declared
      splits (the backfill's readers), so the new column is ranked like the rest.
    * ⛔ IT REFUSES RATHER THAN MIX TWO STORES. Before writing anything, every
      session is recomputed and each stored ticker checked: a ticker with no bars
      window today, a ticker today's split guard would now skip, or any compared
      rank (:data:`FILL_COMPARED`) that would come out different means the store's
      other columns no longer agree with what the column would be ranked against.
      The run then writes NOTHING (``reason = would_change_other_values``) and the
      receipt counts each kind with a few examples. Only a clean check writes.
    * WHAT IT WRITES: ``UPDATE ... SET <column> = ? WHERE session = ? AND ticker = ?``
      for the stored rows only, one commit per session. No row is inserted, no other
      column is touched, no ``fast`` is lost.
    * ``dry_run`` opens ``screener.db`` read-only, checks exactly as a real run
      does and writes nothing (no column, no row, no receipt, no split-list memo).
    """
    t0 = time.time()
    receipt = {"ok": False, "dry_run": bool(dry_run), "session": None, "started_at": t0,
               "finished_at": None, "universe": None, "targets": None, "rated": 0, "rows": 0,
               "excluded_etfs": None, "short_history": 0, "split_guard": 0, "duration_ms": 0.0,
               "note": {"source": "fill_column", "column": column, "days": None, "sessions": 0,
                        "sessions_stored": 0, "sessions_todo": 0, "sessions_filled": 0,
                        "rows_filled": 0, "mismatches": {"window": 0, "guard": 0, "values": 0},
                        "examples": []}}
    record = not dry_run
    note = receipt["note"]
    try:
        if column not in FILLABLE_COLUMNS:
            note["reason"] = f"column must be one of {', '.join(FILLABLE_COLUMNS)}"
            return _finish(receipt, t0, record=False)
        try:
            days = int(days)
        except (TypeError, ValueError):
            days = 0
        note["days"] = days
        if not 1 <= days <= BACKFILL_MAX_DAYS:
            note["reason"] = f"days must be 1 to {BACKFILL_MAX_DAYS}"
            return _finish(receipt, t0, record=False)
        if sessions is None:
            end = (session_fn or settled_session)(now)
            if end is None:
                note["reason"] = "no_session"
                return _finish(receipt, t0, record=record)
            sessions = trading_sessions_ending(end, days)
        keys = sorted({session_key(s) for s in sessions})
        note["sessions"] = len(keys)
        receipt["session"] = keys[-1] if keys else None
        with _backfill_conn(dry_run) as conn:
            if conn is None or not _table_exists(conn, TABLE):
                receipt["ok"] = True
                note["reason"] = "nothing_to_do"
                return _finish(receipt, t0, record=record)
            note["sessions_stored"] = len(_stored_sessions(conn, keys))
            todo = _sessions_missing_column(conn, keys, column)
            if max_sessions is not None and int(max_sessions) >= 0:
                todo = todo[:int(max_sessions)]
            note["sessions_todo"] = len(todo)
            if not todo:
                receipt["ok"] = True
                note["reason"] = "nothing_to_do"
                return _finish(receipt, t0, record=record)
            _fill_sessions(receipt, conn, keys, todo, column, etf_tickers=etf_tickers,
                           bars_reader=bars_reader, splits_reader=splits_reader, dry_run=dry_run,
                           split_fetch_budget=split_fetch_budget, log_every=log_every)
    except Exception as e:                                   # noqa: BLE001
        log.warning("[rs_history] fill %s failed: %s: %s", column, type(e).__name__, e)
        note["error"] = f"{type(e).__name__}: {e}"[:300]
    return _finish(receipt, t0, record=record)


def _fill_sessions(receipt, conn, keys, todo, column, *, etf_tickers, bars_reader, splits_reader,
                   dry_run, split_fetch_budget, log_every) -> None:
    """The body of :func:`fill_column`: read every stored ticker once, CHECK every
    session, then (a real run with a clean check) write ``column``."""
    note = receipt["note"]
    etfs = {str(t).upper() for t in (etf_tickers if etf_tickers is not None else default_etf_tickers())}
    tickers: set = set()
    for key in todo:
        tickers |= {r[0] for r in conn.execute(f"SELECT ticker FROM {TABLE} WHERE session = ?",
                                               (key,)).fetchall()}
    receipt["targets"] = len(tickers)
    receipt["universe"] = len(tickers - etfs)
    receipt["excluded_etfs"] = len(tickers & etfs)
    reader = bars_reader or default_bars_reader
    if splits_reader is None:
        budget = (0 if dry_run else None) if split_fetch_budget == AUTO_BUDGET else split_fetch_budget
        splits_reader = default_splits_reader(conn, budget=budget, persist=not dry_run)
    span = keys.index(todo[0]) - keys.index(todo[-1]) + 1
    depth = READ_BARS + span + 10
    end_ymd = session_ymd(todo[0])
    series: dict = {}
    for t in sorted(tickers):
        try:
            rows = reader(t, depth, end_ymd)
        except Exception as e:                               # noqa: BLE001
            log.debug("[rs_history] fill read failed for %s: %s", t, e)
            rows = None
        ts_list, closes = closes_from_rows(rows)
        if ts_list:
            series[t] = (ts_list, closes, _split_list(splits_reader, t))
    note["tickers_with_bars"] = len(series)
    lists = _split_stats(splits_reader)
    if lists is not None:
        note["split_lists"] = lists
    # ── PASS 1: the check. Nothing is written unless every session agrees. ──
    for key in todo:
        _ratings, bad = _fill_session(key, _stored_rows(conn, key), series, etfs)
        for kind, t, detail in bad:
            note["mismatches"][kind] += 1
            if len(note["examples"]) < FILL_EXAMPLES:
                note["examples"].append({"session": key, "ticker": t, "kind": kind,
                                         **({"stored_vs_now": detail} if detail else {})})
    if any(note["mismatches"].values()):
        note["reason"] = "would_change_other_values"
        log.warning("[rs_history] fill %s wrote nothing: the stored sessions no longer agree with "
                    "today's bars or split guard (%s)", column, note["mismatches"])
        return
    # ── PASS 2: the write (or, dry, the count of what would be written). ──
    if not dry_run:
        ensure_schema(conn)                                  # the ALTER, if the column is missing
    sql = f"UPDATE {TABLE} SET {column} = ? WHERE session = ? AND ticker = ?"
    for n, key in enumerate(todo, 1):
        stored = _stored_rows(conn, key)
        ratings, _bad = _fill_session(key, stored, series, etfs)
        rows = [(ratings[t].get(column), key, t) for t in stored]
        filled = sum(1 for v, _k, _t in rows if v is not None)
        receipt["rated"] += filled
        if not dry_run:
            conn.executemany(sql, rows)
            conn.commit()
        note["rows_filled"] += filled
        receipt["rows"] += len(rows)
        note["sessions_filled"] += 1
        if log_every and n % log_every == 0:
            log.info("[rs_history] fill %s %d/%d sessions (newest first), at %s", column, n, len(todo), key)
    receipt["ok"] = True


# --------------------------------------------------------------------------- #
# restating the long components (2026-11-11): m6 / m9 / m12 became IBD-style
# --------------------------------------------------------------------------- #

def _restated_sql(table: str) -> str:
    return f"""
CREATE TABLE IF NOT EXISTS {table} (
    session TEXT PRIMARY KEY,
    method TEXT NOT NULL,
    restated_at REAL,
    rows INTEGER
)"""


_RESTATED_SQL = _restated_sql(RESTATED_TABLE)


def _restated_sessions(conn, keys, kind: str = "long") -> set:
    """The keys already restated by ``kind`` (``long`` = m6/m9/m12 to
    :data:`RESTATE_METHOD`, ``m3`` to :data:`RESTATE_M3_METHOD`); none when the
    marker table is absent: nothing is created by asking."""
    _cols, method, table = RESTATE_KINDS[kind]
    if not _table_exists(conn, table):
        return set()
    return {k for k in keys if conn.execute(
        f"SELECT 1 FROM {table} WHERE session = ? AND method = ?",
        (k, method)).fetchone()}


def _compared_for(columns, done_long: bool, done_m3: bool) -> tuple:
    """The stored columns a restate of ``columns`` compares for ONE session: ``ibd``
    and ``m1`` always, plus every column that is NOT being rewritten and whose
    CURRENT meaning that session already holds (``m3`` once the session carries the
    m3 marker, ``m6``/``m9``/``m12`` once it carries the long marker). A column still
    holding an old meaning would only produce false mismatches, so it is not compared."""
    out = list(RESTATE_COMPARED)
    if "m3" not in columns and done_m3:
        out.append("m3")
    if not set(RESTATE_COLUMNS) & set(columns) and done_long:
        out.extend(RESTATE_COLUMNS)
    return tuple(out)


def _is_lock_error(e: Exception) -> bool:
    return isinstance(e, sqlite3.OperationalError) and "locked" in str(e).lower()


def _write_with_lock_retry(conn, write, *, what: str = "restate") -> None:
    """Run ``write()`` (the session's UPDATEs and marker insert) and commit; on
    ``database is locked`` roll back, wait (backoff) and run it again, up to
    :data:`LOCK_RETRY_ATTEMPTS` times, then raise. One session is one transaction, so
    a retry never leaves half a session behind."""
    for attempt in range(1, LOCK_RETRY_ATTEMPTS + 1):
        try:
            write()
            conn.commit()
            return
        except sqlite3.OperationalError as e:
            if not _is_lock_error(e) or attempt == LOCK_RETRY_ATTEMPTS:
                raise
            try:
                conn.rollback()
            except sqlite3.Error:
                pass
            delay = min(LOCK_RETRY_BASE_S * (2 ** (attempt - 1)), 60.0)
            log.warning("[rs_history] %s: database is locked (attempt %d/%d), retrying in %.0f s",
                        what, attempt, LOCK_RETRY_ATTEMPTS, delay)
            _lock_sleep(delay)


def _restate_session(key, stored: dict, series: dict, etfs: set, compared=RESTATE_COMPARED):
    """Recompute one stored session over the tickers it STORED. ``compared`` is the
    columns checked against what is stored (:func:`_compared_for`).

    Returns ``(ratings, counts, examples)``. ``counts`` has ``checked`` (tickers
    compared), ``drift`` (a compared rank off by exactly one point and none by
    more), ``hard`` (a compared rank off by more than one, no bars window today, or
    today's split guard skips it) and ``unrestatable`` (the tickers whose long
    columns cannot be recomputed: these get ``NULL``)."""
    ymd = session_ymd(key)
    closes_by_ticker, suspects = {}, set()
    counts = {"checked": 0, "drift": 0, "hard": 0, "unrestatable": 0,
              "window": 0, "guard": 0, "values": 0}
    examples = []
    for t in stored:
        s = series.get(t)
        bounds = None if s is None else _window_bounds(s[0], ymd)
        if bounds is None:
            counts["window"] += 1
            counts["hard"] += 1
            counts["unrestatable"] += 1
            if len(examples) < FILL_EXAMPLES:
                examples.append({"session": key, "ticker": t, "kind": "window"})
            continue
        ts_list, closes, declared = s
        win = closes[bounds[0]:bounds[1]]
        if window_split_suspect(ts_list[bounds[0]:bounds[1]], win, declared):
            suspects.add(t)
        closes_by_ticker[t] = win
    ratings = compute_ratings(closes_by_ticker, etfs, suspects=suspects)
    for t in sorted(closes_by_ticker):
        r = ratings.get(t) or {}
        counts["checked"] += 1
        if not r.get("bars"):
            counts["guard"] += 1
            counts["hard"] += 1
            counts["unrestatable"] += 1
            if len(examples) < FILL_EXAMPLES:
                examples.append({"session": key, "ticker": t, "kind": "guard"})
            continue
        gaps = [abs(int(stored[t][c]) - int(r[c])) for c in compared
                if stored[t].get(c) is not None and r.get(c) is not None]
        missing = any((stored[t].get(c) is None) != (r.get(c) is None) for c in compared)
        if missing or (gaps and max(gaps) > 1):
            counts["values"] += 1
            counts["hard"] += 1
            if len(examples) < FILL_EXAMPLES:
                examples.append({"session": key, "ticker": t, "kind": "values",
                                 "stored_vs_now": {c: (stored[t].get(c), r.get(c))
                                                   for c in compared
                                                   if stored[t].get(c) != r.get(c)}})
        elif gaps and max(gaps) == 1:
            counts["drift"] += 1
    return ratings, counts, examples


def restate_ranks(days: int = BACKFILL_DAYS, *, etf_tickers=None, bars_reader=None, now=None,
                  session_fn=None, sessions=None, splits_reader=None, dry_run: bool = False,
                  max_sessions=None, split_fetch_budget=AUTO_BUDGET,
                  max_drift_share: float = RESTATE_DRIFT_SHARE, log_every: int = 25,
                  kind: str = "long") -> dict:
    """Rewrite one group of component columns to their current meaning for the
    sessions already stored in the last ``days``. Never raises.

    ``kind="long"`` (the default, ``--restate-ranks``) rewrites ``m6``/``m9``/``m12``
    (:data:`RESTATE_COLUMNS`) to the IBD-style meaning; ``kind="m3"``
    (``--restate-ranks --columns m3``) rewrites ``m3`` (:data:`RESTATE_M3_COLUMNS`) to
    the equal-weighted 1-, 2-, 3-month meaning. Each kind has its own marker table, so
    the two restates are independent and can run in either order.

    * WHICH SESSIONS: every stored session in the span not yet recorded in the kind's
      marker table, newest first, at most ``max_sessions`` per call. Re-running is
      resumable; a finished store is ``nothing_to_do``.
    * WHICH POPULATION: each session is ranked over the tickers it STORED with
      today's ETF list, bars and declared splits, like :func:`fill_column`.
    * ⛔ IT CHECKS BEFORE IT WRITES. The columns that are not being rewritten and that
      the session already holds in their current meaning (:func:`_compared_for`:
      ``ibd`` and ``m1`` always) are recomputed and compared with the stored values.
      Drift of one rating point and hard mismatches (more than one point, no bars
      window today, a name today's split guard skips) are each allowed up to
      ``max_drift_share`` of the rows checked; past either, NOTHING is written
      (``reason = would_change_other_values``) and the receipt counts each kind with
      a few examples. A name that cannot be restated inside an allowed run is written
      ``NULL`` in the kind's columns, never left holding an old-meaning number.
    * WHAT IT WRITES: ``UPDATE ... SET <the kind's columns>`` for the stored rows
      only, and the session's marker row, in one commit per session (retried on
      ``database is locked``, :func:`_write_with_lock_retry`). No row is inserted and
      no other column is touched.
    * ``dry_run`` opens ``screener.db`` read-only, checks exactly as a real run does
      and writes nothing (no column, row, table, receipt or split-list memo).
    """
    t0 = time.time()
    if kind not in RESTATE_KINDS:
        kind = "long"
    k_columns, k_method, k_table = RESTATE_KINDS[kind]
    receipt = {"ok": False, "dry_run": bool(dry_run), "session": None, "started_at": t0,
               "finished_at": None, "universe": None, "targets": None, "rated": 0, "rows": 0,
               "excluded_etfs": None, "short_history": 0, "split_guard": 0, "duration_ms": 0.0,
               "note": {"source": "restate_ranks", "columns": list(k_columns),
                        "method": k_method, "days": None, "sessions": 0,
                        "sessions_stored": 0, "sessions_restated_before": 0, "sessions_todo": 0,
                        "sessions_done": 0, "rows_written": 0, "rows_nulled": 0,
                        "checked": 0, "drift": 0, "hard": 0,
                        "mismatches": {"window": 0, "guard": 0, "values": 0},
                        "drift_share_allowed": max_drift_share, "examples": []}}
    record = not dry_run
    note = receipt["note"]
    try:
        try:
            days = int(days)
        except (TypeError, ValueError):
            days = 0
        note["days"] = days
        if not 1 <= days <= BACKFILL_MAX_DAYS:
            note["reason"] = f"days must be 1 to {BACKFILL_MAX_DAYS}"
            return _finish(receipt, t0, record=False)
        if not 0 <= float(max_drift_share) <= 0.05:
            note["reason"] = "max_drift_share must be 0 to 0.05"
            return _finish(receipt, t0, record=False)
        if sessions is None:
            end = (session_fn or settled_session)(now)
            if end is None:
                note["reason"] = "no_session"
                return _finish(receipt, t0, record=record)
            sessions = trading_sessions_ending(end, days)
        keys = sorted({session_key(s) for s in sessions})
        note["sessions"] = len(keys)
        receipt["session"] = keys[-1] if keys else None
        with _backfill_conn(dry_run) as conn:
            if conn is None or not _table_exists(conn, TABLE):
                receipt["ok"] = True
                note["reason"] = "nothing_to_do"
                return _finish(receipt, t0, record=record)
            stored_keys = _stored_sessions(conn, keys)
            note["sessions_stored"] = len(stored_keys)
            done_keys = _restated_sessions(conn, stored_keys, kind)
            note["sessions_restated_before"] = len(done_keys)
            todo = sorted((k for k in stored_keys if k not in done_keys), reverse=True)
            if max_sessions is not None and int(max_sessions) >= 0:
                todo = todo[:int(max_sessions)]
            note["sessions_todo"] = len(todo)
            if not todo:
                receipt["ok"] = True
                note["reason"] = "nothing_to_do"
                return _finish(receipt, t0, record=record)
            _restate_sessions(receipt, conn, keys, todo, etf_tickers=etf_tickers,
                              bars_reader=bars_reader, splits_reader=splits_reader, dry_run=dry_run,
                              split_fetch_budget=split_fetch_budget, max_drift_share=max_drift_share,
                              log_every=log_every, kind=kind)
    except Exception as e:                                   # noqa: BLE001
        log.warning("[rs_history] restate failed: %s: %s", type(e).__name__, e)
        note["error"] = f"{type(e).__name__}: {e}"[:300]
    return _finish(receipt, t0, record=record)


def _restate_sessions(receipt, conn, keys, todo, *, etf_tickers, bars_reader, splits_reader, dry_run,
                      split_fetch_budget, max_drift_share, log_every, kind: str = "long") -> None:
    """The body of :func:`restate_ranks`: read every stored ticker once, CHECK every
    session, then (a real run inside the allowance) write the kind's columns."""
    note = receipt["note"]
    k_columns, k_method, k_table = RESTATE_KINDS[kind]
    etfs = {str(t).upper() for t in (etf_tickers if etf_tickers is not None else default_etf_tickers())}
    have = {r[1] for r in conn.execute(f"PRAGMA table_info({TABLE})").fetchall()}
    stored_cols = tuple(c for c in RESTATE_ALL_COLUMNS if c in have)
    cols = ", ".join(stored_cols)
    done_long = _restated_sessions(conn, todo, "long")
    done_m3 = _restated_sessions(conn, todo, "m3")

    def _cmp(key):
        return _compared_for(k_columns, key in done_long, key in done_m3)

    tickers: set = set()
    for key in todo:
        tickers |= {r[0] for r in conn.execute(f"SELECT ticker FROM {TABLE} WHERE session = ?",
                                               (key,)).fetchall()}
    receipt["targets"] = len(tickers)
    receipt["universe"] = len(tickers - etfs)
    receipt["excluded_etfs"] = len(tickers & etfs)
    reader = bars_reader or default_bars_reader
    if splits_reader is None:
        budget = (0 if dry_run else None) if split_fetch_budget == AUTO_BUDGET else split_fetch_budget
        splits_reader = default_splits_reader(conn, budget=budget, persist=not dry_run)
    span = keys.index(todo[0]) - keys.index(todo[-1]) + 1
    depth = READ_BARS + span + 10
    end_ymd = session_ymd(todo[0])
    series: dict = {}
    for t in sorted(tickers):
        try:
            rows = reader(t, depth, end_ymd)
        except Exception as e:                               # noqa: BLE001
            log.debug("[rs_history] restate read failed for %s: %s", t, e)
            rows = None
        ts_list, closes = closes_from_rows(rows)
        if ts_list:
            series[t] = (ts_list, closes, _split_list(splits_reader, t))
    note["tickers_with_bars"] = len(series)
    lists = _split_stats(splits_reader)
    if lists is not None:
        note["split_lists"] = lists

    def _stored(key):
        return {r[0]: dict(zip(stored_cols, tuple(r)[1:])) for r in conn.execute(
            f"SELECT ticker, {cols} FROM {TABLE} WHERE session = ?", (key,)).fetchall()}

    # ── PASS 1: the check. Nothing is written unless the whole run is inside the allowance. ──
    for key in todo:
        _r, counts, examples = _restate_session(key, _stored(key), series, etfs, _cmp(key))
        note["checked"] += counts["checked"] + counts["window"]
        note["drift"] += counts["drift"]
        note["hard"] += counts["hard"]
        for kind_name in ("window", "guard", "values"):
            note["mismatches"][kind_name] += counts[kind_name]
        for ex in examples:
            if len(note["examples"]) < FILL_EXAMPLES:
                note["examples"].append(ex)
    rows_checked = max(note["checked"], 1)
    over = {"drift": note["drift"] > max_drift_share * rows_checked,
            "hard": note["hard"] > max_drift_share * rows_checked}
    note["over_allowance"] = over
    if any(over.values()):
        note["reason"] = "would_change_other_values"
        log.warning("[rs_history] restate wrote nothing: drift=%s hard=%s of %s rows checked "
                    "(allowed %.2f%%)", note["drift"], note["hard"], rows_checked, 100 * max_drift_share)
        return
    # ── PASS 2: the write (or, dry, the count of what would be written). ──
    if not dry_run:
        ensure_schema(conn)
        conn.execute(_restated_sql(k_table))
    sql = (f"UPDATE {TABLE} SET {', '.join(c + ' = ?' for c in k_columns)} "
           "WHERE session = ? AND ticker = ?")
    for n, key in enumerate(todo, 1):
        stored = _stored(key)
        ratings, _c, _e = _restate_session(key, stored, series, etfs, _cmp(key))
        rows, nulled = [], 0
        for t in stored:
            r = ratings.get(t) or {}
            vals = [r.get(c) if r.get("bars") else None for c in k_columns]
            if not r.get("bars"):
                nulled += 1
            rows.append((*vals, key, t))
        receipt["rated"] += sum(1 for row in rows if row[0] is not None)
        if not dry_run:
            def _write(rows=rows, key=key):
                conn.executemany(sql, rows)
                conn.execute(f"INSERT OR REPLACE INTO {k_table} (session, method, restated_at, rows) "
                             "VALUES (?, ?, ?, ?)", (key, k_method, time.time(), len(rows)))
            _write_with_lock_retry(conn, _write, what=f"restate {'/'.join(k_columns)} {key}")
        note["rows_written"] += len(rows)
        note["rows_nulled"] += nulled
        receipt["rows"] += len(rows)
        note["sessions_done"] += 1
        if log_every and n % log_every == 0:
            log.info("[rs_history] restate %d/%d sessions (newest first), at %s", n, len(todo), key)
    receipt["ok"] = True


# --------------------------------------------------------------------------- #
# re-ranking every stored session against ALL stocks (2026-11-12): U1
# --------------------------------------------------------------------------- #

#: The 63-bar term needs 64 closes: fewer and a name has no rating, so it is not in the ranked set.
_REQUIRED_BARS = dict((label, n) for label, n, _w in IBD_TERMS)[REQUIRED_TERM]

_UPSERT_SQL = (
    f"INSERT INTO {TABLE} (session, ticker, ibd, m1, m3, m6, m9, m12, score, bars) "
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
    "ON CONFLICT(session, ticker) DO UPDATE SET ibd = excluded.ibd, m1 = excluded.m1, "
    "m3 = excluded.m3, m6 = excluded.m6, m9 = excluded.m9, m12 = excluded.m12, "
    "score = excluded.score, bars = excluded.bars")
#: ``fast`` is the HOURLY fast rating the nightly stored that night; it cannot be
#: recomputed, so the upsert never names it (a conflict keeps it, a new row has none).
_NULL_RATINGS_SQL = (f"UPDATE {TABLE} SET ibd = NULL, m1 = NULL, m3 = NULL, m6 = NULL, "
                     "m9 = NULL, m12 = NULL WHERE session = ? AND ticker = ?")
_UNIVERSE_MARKERS = ((UNIVERSE_TABLE, UNIVERSE_METHOD), (RESTATED_TABLE, RESTATE_METHOD),
                     (RESTATED_M3_TABLE, RESTATE_M3_METHOD))


def _compact_series(rows):
    """``(ts, closes)`` as typed arrays (4 + 8 bytes a bar, not ~70 for two lists of
    Python numbers): the wide universe holds ~13,000 tickers x ~530 bars at once, and
    the web pod runs with little headroom. ``None`` when there is no valid close."""
    ts_list, closes = closes_from_rows(rows)
    if not ts_list:
        return None
    return array("i", ts_list), array("d", closes)


def _universe_windows(series: dict, etfs: set, key) -> tuple:
    """``(closes_by_ticker, suspects, ranked_estimate)`` for ONE session: each ticker's
    fresh window (:func:`_window_bounds`), the names today's split guard marks, and
    how many non-ETF names have enough closes to be ranked at all (the 63-bar term
    plus the base: 64)."""
    ymd = session_ymd(key)
    closes_by_ticker, suspects, ranked = {}, set(), 0
    for t, (ts_list, closes, declared) in series.items():
        bounds = _window_bounds(ts_list, ymd)
        if bounds is None:
            continue
        win = closes[bounds[0]:bounds[1]]
        if window_split_suspect(ts_list[bounds[0]:bounds[1]], win, declared):
            suspects.add(t)
        closes_by_ticker[t] = win
        if t not in etfs and len(win) > _REQUIRED_BARS:
            ranked += 1
    return closes_by_ticker, suspects, ranked


def _ranked_estimate(series: dict, etfs: set, key) -> int:
    """The cheap version of :func:`_universe_windows` for the band check: bounds only,
    no slicing, no split judging."""
    ymd = session_ymd(key)
    n = 0
    for t, (ts_list, _closes, _declared) in series.items():
        if t in etfs:
            continue
        b = _window_bounds(ts_list, ymd)
        if b is not None and b[1] - b[0] > _REQUIRED_BARS:
            n += 1
    return n


def _median(values):
    v = sorted(values)
    if not v:
        return 0
    m = len(v) // 2
    return v[m] if len(v) % 2 else (v[m - 1] + v[m]) / 2.0


def restate_universe(days: int = BACKFILL_DAYS, *, universe=None, etf_tickers=None, bars_reader=None,
                     now=None, session_fn=None, sessions=None, splits_reader=None,
                     dry_run: bool = False, max_sessions=None, split_fetch_budget=AUTO_BUDGET,
                     band: float = UNIVERSE_BAND, log_every: int = 25) -> dict:
    """Re-rank every stored session in the last ``days`` against ALL non-ETF stocks
    (:func:`ranking_universe`), rewriting every rating column. Never raises.

    The same :func:`compute_ratings` the nightly job calls does the work, over the same
    candidate list, so the stored history can never disagree with tonight's rows.

    * WHICH SESSIONS: every stored session in the span with no row in
      ``rs_history_restated_universe`` (method :data:`UNIVERSE_METHOD`), newest first, at
      most ``max_sessions`` per call. A finished store is ``nothing_to_do``; a run that
      dies is finished by running the command again.
    * WHAT IT WRITES, one transaction per session (retried with backoff on
      ``database is locked``): an UPSERT of ``ibd, m1, m3, m6, m9, m12, score, bars``
      for every ticker rated that session (a stock the cap universe never held is a NEW
      row; an ETF row is rewritten because its interpolation distribution changed),
      ``NULL`` ratings for a stored ticker that no longer has a window or is split-guarded
      (never an old-universe number), and the session's marker in this restate's table AND in
      the long and m3 tables (every column is now in its current meaning, so those restates
      have nothing left to do). ``fast`` is never touched.
    * ⛔ IT REFUSES, WRITING NOTHING, when (a) a session would rank fewer than
      :data:`UNIVERSE_MIN_RANKED` names or its ranked count is outside ``band`` of the
      median session's (a stale bars store, a half-listed night); (b) on a real run, more
      split lists are unknown than the backfill allows. The values change by design, so
      the comparison guard of ``--restate-ranks`` does not apply; the receipt prints the
      shift instead (mean rating change, share moved by more than
      :data:`UNIVERSE_BIG_SHIFT`) so the owner sees what happened.
    * ``dry_run`` opens ``screener.db`` read-only, reads and ranks exactly as a real run
      does and writes nothing (no row, table, receipt or split-list memo; stored answers
      and the cache only, no provider call).
    """
    t0 = time.time()
    receipt = {"ok": False, "dry_run": bool(dry_run), "session": None, "started_at": t0,
               "finished_at": None, "universe": None, "targets": None, "rated": 0, "rows": 0,
               "excluded_etfs": None, "short_history": 0, "split_guard": 0, "duration_ms": 0.0,
               "note": {"source": "restate_universe", "method": UNIVERSE_METHOD,
                        "columns": list(RESTATE_ALL_COLUMNS), "days": None, "sessions": 0,
                        "sessions_stored": 0, "sessions_restated_before": 0, "sessions_todo": 0,
                        "sessions_done": 0, "rows_written": 0, "rows_inserted": 0,
                        "rows_updated": 0, "rows_nulled": 0, "band": band,
                        "ranked": {"min": None, "median": None, "max": None},
                        "shift": {"compared": 0, "mean": None, "big_share": None, "up_share": None},
                        "examples": []}}
    record = not dry_run
    note = receipt["note"]
    try:
        try:
            days = int(days)
        except (TypeError, ValueError):
            days = 0
        note["days"] = days
        if not 1 <= days <= BACKFILL_MAX_DAYS:
            note["reason"] = f"days must be 1 to {BACKFILL_MAX_DAYS}"
            return _finish(receipt, t0, record=False)
        if not 0.02 <= float(band) <= 0.5:
            note["reason"] = "band must be 0.02 to 0.5"
            return _finish(receipt, t0, record=False)
        if sqlite3.sqlite_version_info < (3, 24, 0):
            note["reason"] = f"sqlite {sqlite3.sqlite_version} has no UPSERT (needs 3.24)"
            return _finish(receipt, t0, record=False)
        if sessions is None:
            end = (session_fn or settled_session)(now)
            if end is None:
                note["reason"] = "no_session"
                return _finish(receipt, t0, record=record)
            sessions = trading_sessions_ending(end, days)
        keys = sorted({session_key(s) for s in sessions})
        note["sessions"] = len(keys)
        receipt["session"] = keys[-1] if keys else None
        with _backfill_conn(dry_run) as conn:
            if conn is None or not _table_exists(conn, TABLE):
                receipt["ok"] = True
                note["reason"] = "nothing_to_do"
                return _finish(receipt, t0, record=record)
            stored_keys = _stored_sessions(conn, keys)
            note["sessions_stored"] = len(stored_keys)
            have_marks = _table_exists(conn, UNIVERSE_TABLE)
            done_keys = {k for k in stored_keys if have_marks and conn.execute(
                f"SELECT 1 FROM {UNIVERSE_TABLE} WHERE session = ? AND method = ?",
                (k, UNIVERSE_METHOD)).fetchone()}
            note["sessions_restated_before"] = len(done_keys)
            todo = sorted((k for k in stored_keys if k not in done_keys), reverse=True)
            if max_sessions is not None and int(max_sessions) >= 0:
                todo = todo[:int(max_sessions)]
            note["sessions_todo"] = len(todo)
            if not todo:
                receipt["ok"] = True
                note["reason"] = "nothing_to_do"
                return _finish(receipt, t0, record=record)
            _restate_universe_sessions(receipt, conn, keys, todo, universe=universe,
                                       etf_tickers=etf_tickers, bars_reader=bars_reader,
                                       splits_reader=splits_reader, dry_run=dry_run,
                                       split_fetch_budget=split_fetch_budget, band=float(band),
                                       log_every=log_every)
    except Exception as e:                                   # noqa: BLE001
        log.warning("[rs_history] restate-universe failed: %s: %s", type(e).__name__, e)
        note["error"] = f"{type(e).__name__}: {e}"[:300]
    return _finish(receipt, t0, record=record)


def _restate_universe_sessions(receipt, conn, keys, todo, *, universe, etf_tickers, bars_reader,
                               splits_reader, dry_run, split_fetch_budget, band, log_every) -> None:
    """The body of :func:`restate_universe`: read every candidate once, check every
    session's ranked count, then (a real run inside the guards) write each session."""
    note = receipt["note"]
    uni, etfs = _resolve_population(universe, etf_tickers)
    have = {r[1] for r in conn.execute(f"PRAGMA table_info({TABLE})").fetchall()}
    stored_cols = tuple(c for c in RESTATE_ALL_COLUMNS if c in have)
    cols = ", ".join(stored_cols)
    stored_tickers: set = set()
    for key in todo:
        stored_tickers |= {r[0] for r in conn.execute(f"SELECT ticker FROM {TABLE} WHERE session = ?",
                                                      (key,)).fetchall()}
    candidates = sorted(uni | etfs | stored_tickers)
    receipt["targets"] = len(candidates)
    receipt["universe"] = len(set(candidates) - etfs)
    receipt["excluded_etfs"] = len(set(candidates) & etfs)
    reader = bars_reader or default_bars_reader
    if splits_reader is None:
        budget = (0 if dry_run else None) if split_fetch_budget == AUTO_BUDGET else split_fetch_budget
        splits_reader = default_splits_reader(conn, budget=budget, persist=not dry_run)
    span = keys.index(todo[0]) - keys.index(todo[-1]) + 1
    depth = READ_BARS + span + 10
    end_ymd = session_ymd(todo[0])
    series: dict = {}
    for t in candidates:
        try:
            rows = reader(t, depth, end_ymd)
        except Exception as e:                               # noqa: BLE001 - one name, not the run
            log.debug("[rs_history] restate-universe read failed for %s: %s", t, e)
            rows = None
        packed = _compact_series(rows)
        if packed is not None:
            series[t] = (packed[0], packed[1], _split_list(splits_reader, t))
    note["tickers_with_bars"] = len(series)
    note["split_basis"] = {"declared": sum(1 for s in series.values() if s[2] is not None),
                           "unknown": sum(1 for s in series.values() if s[2] is None)}
    lists = _split_stats(splits_reader)
    if lists is not None:
        note["split_lists"] = lists
    unknown = note["split_basis"]["unknown"]
    allowed = max(BACKFILL_UNKNOWN_SPLITS_FLOOR, int(len(series) * BACKFILL_UNKNOWN_SPLITS_SHARE))
    note["split_lists_allowed_unknown"] = allowed
    if not dry_run and unknown > allowed:
        # A session this writes is skipped by every later run, so a name ranked without
        # its split list here would never be judged again: write nothing, run it again
        # when the provider answers (the lists it did fetch are kept).
        note["reason"] = "split_lists_unknown"
        log.warning("[rs_history] restate-universe wrote nothing: %d split lists unknown (allowed %d)%s",
                    unknown, allowed, " - FMP_API_KEY is not set" if (lists or {}).get("no_key") else "")
        return
    # ── PASS 1: the ranked count of every session. Nothing is written unless all are plausible. ──
    ranked_by_session = {key: _ranked_estimate(series, etfs, key) for key in todo}
    counts = list(ranked_by_session.values())
    med = _median(counts)
    note["ranked"] = {"min": min(counts), "median": med, "max": max(counts)}
    bad = [(k, n) for k, n in ranked_by_session.items()
           if n < UNIVERSE_MIN_RANKED or (med and abs(n - med) / med > band)]
    if bad:
        note["reason"] = "implausible_universe"
        note["examples"] = [{"session": k, "ranked": n} for k, n in sorted(bad)[:FILL_EXAMPLES]]
        note["implausible_sessions"] = len(bad)
        log.warning("[rs_history] restate-universe wrote nothing: %d session(s) rank fewer than %d names "
                    "or sit outside +/-%.0f%% of the median %s (e.g. %s)", len(bad), UNIVERSE_MIN_RANKED,
                    100 * band, med, note["examples"][:3])
        return
    # ── PASS 2: rank, compare with what is stored, write (or, dry, count). ──
    if not dry_run:
        ensure_schema(conn)
        for table, _method in _UNIVERSE_MARKERS:
            conn.execute(_restated_sql(table))
    shift = {"n": 0, "sum": 0, "big": 0, "up": 0}
    for n, key in enumerate(todo, 1):
        closes_by_ticker, suspects, _ranked = _universe_windows(series, etfs, key)
        ratings = compute_ratings(closes_by_ticker, etfs, suspects=suspects)
        stored = {r[0]: dict(zip(stored_cols, tuple(r)[1:])) for r in conn.execute(
            f"SELECT ticker, {cols} FROM {TABLE} WHERE session = ?", (key,)).fetchall()}
        upserts, nulls, inserted = [], [], 0
        for t, r in ratings.items():
            if not r.get("bars"):
                continue
            upserts.append((key, t, r.get("ibd"), r.get("m1"), r.get("m3"), r.get("m6"),
                            r.get("m9"), r.get("m12"), r.get("score"), int(r.get("bars") or 0)))
            old = stored.get(t)
            if old is None:
                inserted += 1
            elif t not in etfs and old.get("ibd") is not None and r.get("ibd") is not None:
                # the summary describes STOCKS (an ETF's number follows the stocks')
                d = int(r["ibd"]) - int(old["ibd"])
                shift["n"] += 1
                shift["sum"] += d
                shift["big"] += 1 if abs(d) > UNIVERSE_BIG_SHIFT else 0
                shift["up"] += 1 if d > 0 else 0
        for t in stored:
            if not (ratings.get(t) or {}).get("bars"):
                nulls.append((key, t))
        counts_n = _counts_for(ratings, etfs)
        receipt["rated"] += counts_n["rated"]
        receipt["short_history"] += counts_n["short_history"]
        receipt["split_guard"] += counts_n["split_guard"]
        if not dry_run:
            def _write(upserts=upserts, nulls=nulls, key=key):
                conn.executemany(_UPSERT_SQL, upserts)
                if nulls:
                    conn.executemany(_NULL_RATINGS_SQL, nulls)
                now_ts = time.time()
                for table, method in _UNIVERSE_MARKERS:
                    conn.execute(f"INSERT OR REPLACE INTO {table} (session, method, restated_at, rows) "
                                 "VALUES (?, ?, ?, ?)", (key, method, now_ts, len(upserts)))
            _write_with_lock_retry(conn, _write, what=f"restate-universe {key}")
        note["rows_written"] += len(upserts)
        note["rows_inserted"] += inserted
        note["rows_updated"] += len(upserts) - inserted
        note["rows_nulled"] += len(nulls)
        receipt["rows"] += len(upserts)
        note["sessions_done"] += 1
        if log_every and n % log_every == 0:
            log.info("[rs_history] restate-universe %d/%d sessions (newest first), at %s", n, len(todo), key)
    if shift["n"]:
        note["shift"] = {"compared": shift["n"], "mean": round(shift["sum"] / shift["n"], 2),
                         "big_share": round(shift["big"] / shift["n"], 4),
                         "up_share": round(shift["up"] / shift["n"], 4)}
    receipt["ok"] = True


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
    """``{TICKER: {ibd, fast, m1, m3, m6, m9, m12, score, bars, d5, d20, asof}}`` for the
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
            cols = ", ".join(_read_columns(conn))
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


def newest_ibd_ratings() -> tuple:
    """``(session, {TICKER: ibd})`` for the NEWEST stored session: the one number the
    site shows as the RS rating everywhere once ``RS_RANK_IBD_ENABLED`` is on (RS
    split unit U5a; ``rs_ranking.cached_rank_map`` is the reader).

    READ-ONLY and never raises: no table, no rows or a failed read answers
    ``(None, {})`` and creates nothing, so a dark pod keeps no schema. Rows whose
    ``ibd`` is null (rated short) are left out, so the caller falls back to the fast
    rank for them exactly as for a name with no row. One ``MAX(session)`` seek and
    one whole-session read: the newest session is ~3,700 rows."""
    try:
        with closing(snapshot_db.connect()) as conn:
            if not _table_exists(conn, TABLE):
                return None, {}
            latest = conn.execute(f"SELECT MAX(session) FROM {TABLE}").fetchone()[0]
            if latest is None:
                return None, {}
            rows = conn.execute(
                f"SELECT ticker, ibd FROM {TABLE} WHERE session = ? AND ibd IS NOT NULL",
                (latest,)).fetchall()
    except Exception as e:                                   # noqa: BLE001 - a read never raises
        log.warning("[rs_history] newest ratings read failed: %s", e)
        return None, {}
    return latest, {str(r[0]).upper(): int(r[1]) for r in rows}


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
    provider's rating history. Never raises; ``[]`` without a table. A table from
    before round 2 is read without ``m9`` (each row carries ``m9: None``)."""
    try:
        with closing(snapshot_db.connect()) as conn:
            cols = ", ".join(_read_columns(conn))
            rows = conn.execute(
                f"SELECT session, {cols} FROM {TABLE} WHERE ticker = ? ORDER BY session DESC LIMIT ?",
                (str(ticker or "").upper(), int(limit))).fetchall()
    except Exception:                                        # noqa: BLE001
        return []
    return [{**{c: None for c in ROW_COLUMNS}, **dict(r)} for r in rows]


#: The most sessions one rating-view read returns: ten trading years, past any
#: chart window the provider asks for (its bars plus the average's warm-up). A
#: bound, so a caller passing a huge ``limit`` still reads a bounded set.
SERIES_MAX_SESSIONS = 2520


def rating_series(ticker: str, upto=None, limit: int = 300) -> list:
    """``[(session, ibd), ...]`` OLDEST first: one ticker's stored IBD-style rating
    for at most ``limit`` sessions ending at ``upto`` (inclusive; ``None`` = the
    newest). The RS Rating reading's line (round 2).

    ONE BOUNDED, INDEXED READ: ``WHERE ticker = ? AND session <= ? ORDER BY session
    DESC LIMIT ?`` walks ``idx_rsh_ticker (ticker, session)`` backwards from
    ``upto`` and stops after ``limit`` entries (the plan is pinned in
    ``tests/test_rs_rating_view.py``). Read-only: no table means ``[]`` and nothing
    is created. Never raises. A row whose ``ibd`` is null (rated short) is kept, so
    the caller sees the gap."""
    try:
        n = max(0, min(int(limit or 0), SERIES_MAX_SESSIONS))
    except (TypeError, ValueError):
        return []
    tu = str(ticker or "").strip().upper()
    if not n or not tu:
        return []
    try:
        with closing(snapshot_db.connect()) as conn:
            if not _table_exists(conn, TABLE):
                return []
            if upto is None:
                rows = conn.execute(f"SELECT session, ibd FROM {TABLE} WHERE ticker = ? "
                                    "ORDER BY session DESC LIMIT ?", (tu, n)).fetchall()
            else:
                rows = conn.execute(f"SELECT session, ibd FROM {TABLE} WHERE ticker = ? AND session <= ? "
                                    "ORDER BY session DESC LIMIT ?", (tu, session_key(upto), n)).fetchall()
    except Exception as e:                                   # noqa: BLE001 - a read never raises
        log.warning("[rs_history] rating series read failed for %s: %s", tu, e)
        return []
    return [(r[0], None if r[1] is None else int(r[1])) for r in reversed(rows)]


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


# --------------------------------------------------------------------------- #
# the one-shot backfill command (owner decision D2)
# --------------------------------------------------------------------------- #

def _parser():
    import argparse
    ap = argparse.ArgumentParser(
        prog="python -m api.services.screener.rs_history",
        description="One-shot backfill of the UCT RS rating history: point-in-time ratings for the "
                    "last N sessions from bars.db over today's universe. Idempotent (a session that "
                    "already holds rows is skipped) and resumable (run it again to finish). Run it on "
                    "the web pod, by hand, when RS_HISTORY_ENABLED is armed; nothing schedules it.")
    ap.add_argument("--backfill-days", type=int, required=True, metavar="N",
                    help=f"sessions to cover, ending at the settled session (1 to {BACKFILL_MAX_DAYS}; "
                         f"{BACKFILL_DAYS} is one trading year)")
    ap.add_argument("--dry-run", action="store_true",
                    help="rate and report, write nothing (no rows, receipt, marker or split-list memo)")
    ap.add_argument("--max-sessions", type=int, default=None, metavar="N",
                    help="write at most N sessions this run, newest first (default: all still missing)")
    ap.add_argument("--split-fetch-budget", type=int, default=None, metavar="N",
                    help="provider fetches for declared split lists (default: no limit on a real run, "
                         "0 on a dry run, which reads stored answers and the cache only)")
    ap.add_argument("--fill-column", default=None, choices=list(FILLABLE_COLUMNS), metavar="COLUMN",
                    help="fill ONE column added after the backfill (m9) for the sessions already stored "
                         "in the last N, rewriting nothing else; refuses, writing nothing, when today's "
                         "bars or split guard would change any other stored value")
    ap.add_argument("--restate-ranks", action="store_true",
                    help="rewrite m6, m9 and m12 to the IBD-style meaning (or, with --columns m3, m3 to "
                         "the equal-weighted 1/2/3-month meaning) for the sessions already stored in "
                         "the last N, nothing else; refuses, writing nothing, when the columns it does "
                         "not rewrite no longer agree with today's bars beyond --max-drift-share")
    ap.add_argument("--columns", default="m6,m9,m12", choices=["m6,m9,m12", "m3"], metavar="COLUMNS",
                    help="with --restate-ranks: which columns to restate, m6,m9,m12 (default; the "
                         "IBD-style blend) or m3 (the equal-weighted 1/2/3-month average)")
    ap.add_argument("--restate-universe", action="store_true",
                    help="re-rank EVERY stored session in the last N against all non-ETF stocks (the "
                         "wide universe) and rewrite every rating column; writes new rows for stocks "
                         "the cap universe never held; refuses, writing nothing, when a session's "
                         "ranked count is implausible")
    ap.add_argument("--universe-band", type=float, default=UNIVERSE_BAND, metavar="X",
                    help=f"with --restate-universe: how far a session's ranked count may sit from the "
                         f"median session's before the run refuses (default {UNIVERSE_BAND}, 0.02 to 0.5)")
    ap.add_argument("--max-drift-share", type=float, default=RESTATE_DRIFT_SHARE, metavar="X",
                    help=f"with --restate-ranks: share of rows checked that may drift one rating point, "
                         f"and share that may mismatch harder, before it refuses (default "
                         f"{RESTATE_DRIFT_SHARE}, at most 0.05)")
    return ap


def main(argv=None) -> int:
    """The CLI. Exit 0 when the run finished (or had nothing to do), 1 when it did
    not, 2 on a usage error. The receipt prints as one ``receipt {json}`` line."""
    import sys
    # ⛔ This CLI runs over ssh in a process that never imported the web app, so nothing
    # else installed the credential redaction (2026-11-11: the FMP key reached the pod's
    # logs from here). Idempotent: factory + filter on whatever root handlers exist now.
    from api.services.log_redaction import install as _install_log_redaction
    _install_log_redaction()
    try:
        args = _parser().parse_args(list(argv) if argv is not None else None)
    except SystemExit as e:                                  # argparse: 2 on error, 0 on --help
        return int(e.code) if isinstance(e.code, int) else 2
    if not 1 <= args.backfill_days <= BACKFILL_MAX_DAYS:
        print(f"rs_history: --backfill-days must be 1 to {BACKFILL_MAX_DAYS}", file=sys.stderr)
        return 2
    if args.max_sessions is not None and args.max_sessions < 1:
        print("rs_history: --max-sessions must be 1 or more", file=sys.stderr)
        return 2
    if args.split_fetch_budget is not None and args.split_fetch_budget < 0:
        print("rs_history: --split-fetch-budget must be 0 or more", file=sys.stderr)
        return 2
    budget = AUTO_BUDGET if args.split_fetch_budget is None else args.split_fetch_budget
    if sum(bool(x) for x in (args.restate_ranks, args.fill_column, args.restate_universe)) > 1:
        print("rs_history: pick one of --restate-ranks, --restate-universe and --fill-column", file=sys.stderr)
        return 2
    if args.restate_universe:
        if not 0.02 <= args.universe_band <= 0.5:
            print("rs_history: --universe-band must be 0.02 to 0.5", file=sys.stderr)
            return 2
        receipt = restate_universe(args.backfill_days, dry_run=args.dry_run, max_sessions=args.max_sessions,
                                   split_fetch_budget=budget, band=args.universe_band)
        note = receipt.get("note") or {}
        dry = bool(receipt.get("dry_run"))
        ranked = note.get("ranked") or {}
        shift = note.get("shift") or {}
        print(f"rs_history restate-universe{' (dry run)' if dry else ''}: sessions={note.get('sessions')} "
              f"stored={note.get('sessions_stored')} already_done={note.get('sessions_restated_before')} "
              f"todo={note.get('sessions_todo')} {'would_write' if dry else 'written'}={note.get('sessions_done')} "
              f"rows={note.get('rows_written')} new_rows={note.get('rows_inserted')} "
              f"updated={note.get('rows_updated')} nulled={note.get('rows_nulled')} "
              f"ranked_min={ranked.get('min')} ranked_median={ranked.get('median')} ranked_max={ranked.get('max')} "
              f"shift_mean={shift.get('mean')} shift_over{UNIVERSE_BIG_SHIFT}={shift.get('big_share')} "
              f"shift_up={shift.get('up_share')} split_unknown={(note.get('split_basis') or {}).get('unknown')} "
              f"reason={note.get('reason')} ms={receipt.get('duration_ms')} ok={receipt.get('ok')}", flush=True)
        print("receipt " + json.dumps(receipt, sort_keys=True, default=str), flush=True)
        return 0 if receipt.get("ok") else 1
    if args.columns != "m6,m9,m12" and not args.restate_ranks:
        print("rs_history: --columns only goes with --restate-ranks", file=sys.stderr)
        return 2
    if args.restate_ranks:
        if not 0 <= args.max_drift_share <= 0.05:
            print("rs_history: --max-drift-share must be 0 to 0.05", file=sys.stderr)
            return 2
        kind = "m3" if args.columns == "m3" else "long"
        receipt = restate_ranks(args.backfill_days, dry_run=args.dry_run, max_sessions=args.max_sessions,
                                split_fetch_budget=budget, max_drift_share=args.max_drift_share,
                                kind=kind)
        note = receipt.get("note") or {}
        dry = bool(receipt.get("dry_run"))
        print(f"rs_history restate {'/'.join(RESTATE_KINDS[kind][0])}{' (dry run)' if dry else ''}: "
              f"sessions={note.get('sessions')} stored={note.get('sessions_stored')} "
              f"already_done={note.get('sessions_restated_before')} todo={note.get('sessions_todo')} "
              f"{'would_write' if dry else 'written'}={note.get('sessions_done')} "
              f"rows={note.get('rows_written')} nulled={note.get('rows_nulled')} "
              f"checked={note.get('checked')} drift={note.get('drift')} hard={note.get('hard')} "
              f"mismatches={json.dumps(note.get('mismatches'), sort_keys=True)} "
              f"reason={note.get('reason')} ms={receipt.get('duration_ms')} ok={receipt.get('ok')}", flush=True)
        print("receipt " + json.dumps(receipt, sort_keys=True, default=str), flush=True)
        return 0 if receipt.get("ok") else 1
    if args.fill_column:
        receipt = fill_column(args.fill_column, args.backfill_days, dry_run=args.dry_run,
                              max_sessions=args.max_sessions, split_fetch_budget=budget)
        note = receipt.get("note") or {}
        dry = bool(receipt.get("dry_run"))
        print(f"rs_history fill {args.fill_column}{' (dry run)' if dry else ''}: "
              f"sessions={note.get('sessions')} stored={note.get('sessions_stored')} "
              f"todo={note.get('sessions_todo')} {'would_fill' if dry else 'filled'}={note.get('sessions_filled')} "
              f"rows={note.get('rows_filled')} mismatches={json.dumps(note.get('mismatches'), sort_keys=True)} "
              f"reason={note.get('reason')} ms={receipt.get('duration_ms')} ok={receipt.get('ok')}", flush=True)
        print("receipt " + json.dumps(receipt, sort_keys=True, default=str), flush=True)
        return 0 if receipt.get("ok") else 1
    receipt = backfill(args.backfill_days, dry_run=args.dry_run, max_sessions=args.max_sessions,
                       split_fetch_budget=budget)
    note = receipt.get("note") or {}
    dry = bool(receipt.get("dry_run"))
    done = note.get("sessions_todo") if dry else note.get("sessions_written")
    print(f"rs_history backfill{' (dry run)' if dry else ''}: sessions={note.get('sessions')} "
          f"already_stored={note.get('sessions_stored')} {'would_write' if dry else 'written'}={done} "
          f"remaining={note.get('sessions_remaining')} rated_rows={receipt.get('rated')} "
          f"split_guard={receipt.get('split_guard')} ms={receipt.get('duration_ms')} "
          f"ok={receipt.get('ok')}", flush=True)
    print("receipt " + json.dumps(receipt, sort_keys=True, default=str), flush=True)
    return 0 if receipt.get("ok") else 1


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    # ⛔ credentials never reach a log line: filter on the handlers basicConfig just made
    from api.services.log_redaction import install as _install_log_redaction
    _install_log_redaction()
    raise SystemExit(main())
