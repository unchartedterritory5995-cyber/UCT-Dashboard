"""Earnings context — last-report move, implied move, and setup grade.

Two readers over TWO SEPARATE stores (registered separately downstream, same
as `context_joins.py`'s four):

  • `read_last_report_move` — the earnings wire's `wire_prints` table
    (`api/services/wire/store.py`). ONE query, via that module's own
    `_connect` seam: `GROUP BY sym` with a bare `MAX(market_date)` resolves
    the LATEST print per symbol (SQLite's per-group bare-column rule: with
    exactly one MAX()/MIN() aggregate, every other bare column in the SELECT
    list is taken from the same row that produced the aggregate — verified
    live, not assumed). The store only holds prints since ~2026-07-30, so a
    symbol it has never seen gets NO key at all (disclosed NULL, never a
    confident 0.0) — that is honest coverage, not a miss.

  • `read_implied_context` — `implied_store`'s nightly-capture data:
    `upcoming_reporters(days=14)` + one `get_implied_for_date(date)` call per
    DISTINCT report_date among the target reporters (both already public,
    store-internal-cold-safe accessors) for the pre-report implied move, and
    a raw query against `grade_snapshots` (no bulk accessor exists there yet
    — `get_grade_history` is per-symbol) for the latest §12 setup-grade
    letter, scoped to `surface=setup_grade.SURFACE` — imported from
    `setup_grade.py`, never retyped (verified live: `SURFACE = "setup"` at
    setup_grade.py:29). A non-reporter, or a reporter this store never
    captured, gets no key at all.

Both readers share `context_joins.py`'s honesty contract: a dead OR empty
source returns `{}` (counted via `_note`, same shape); a healthy source
answers only for the symbols it genuinely has data for — an uncovered
symbol gets NO key (disclosed NULL), never a guessed/blank value. One leg
dying (e.g. the grade query) never blanks a sibling leg that's still
healthy (mirrors `read_etf_flags`'s per-leg isolation), and one bad
report_date's `get_implied_for_date` call never blanks every OTHER date's
reporters.

⚠️ Every write below is a literal `d["col"] = v` subscript-assign keyed by
the exact snapshot column name — the scalar-population rail derives writers
by AST over that shape (and `{"col": v}` dict literals, see
`tests/test_scalar_population_rail.py::_assigned_string_keys`); a
dynamically-built mapping is an invisible collector.
"""
from __future__ import annotations

import contextlib


def _note(failures, source, outcome):
    if failures is None:
        return
    key = outcome if isinstance(outcome, str) else type(outcome).__name__
    failures.setdefault(source, {})
    failures[source][key] = failures[source].get(key, 0) + 1


def read_last_report_move(targets, failures=None):
    """{TICKER: {"last_report_move_pct": float}} — the latest wire print's
    `peak_move_pct` per symbol, off `wire.store`'s own `_connect` seam.

    A symbol with no print at all (never reported since the wire started
    capturing, ~2026-07-30) gets no key — absent is the honest answer here,
    not 0.0. A row whose `peak_move_pct` is NULL is likewise skipped, never
    coerced to 0.0.
    """
    try:
        from api.services.wire import store as wire_store
        with wire_store._connect() as conn:
            rows = conn.execute(
                "SELECT sym, peak_move_pct, MAX(market_date) AS market_date "
                "FROM wire_prints GROUP BY sym"
            ).fetchall()
    except Exception as e:  # noqa: BLE001 — a dead wire store costs this column, never the build
        _note(failures, "wire_last_report_move", e)
        return {}
    if not rows:
        _note(failures, "wire_last_report_move", "empty")
        return {}

    moves = {}
    for r in rows:
        sym = (r["sym"] or "").upper()
        pct = r["peak_move_pct"]
        if sym and pct is not None:
            moves[sym] = float(pct)

    out = {}
    for t in targets:
        tu = t.upper()
        if tu in moves:
            row = {}
            row["last_report_move_pct"] = moves[tu]
            out[tu] = row
    return out


def _latest_grades(failures=None):
    """{SYM: letter} — the latest `grade_snapshots` row per symbol for
    `setup_grade.SURFACE`, off `implied_store`'s own `_connect` seam. Same
    GROUP BY / bare-MAX trick as the wire query above.
    """
    try:
        from api.services import implied_store
        from api.services import setup_grade
        with contextlib.closing(implied_store._connect()) as conn:
            rows = conn.execute(
                "SELECT sym, grade, MAX(date) AS date FROM grade_snapshots "
                "WHERE surface = ? GROUP BY sym",
                (setup_grade.SURFACE,),
            ).fetchall()
    except Exception as e:  # noqa: BLE001 — a dead grade store costs the grade leg only
        _note(failures, "implied_grade_snapshots", e)
        return {}
    if not rows:
        _note(failures, "implied_grade_snapshots", "empty")
        return {}
    out = {}
    for r in rows:
        sym = (r["sym"] or "").upper()
        grade = r["grade"]
        if sym and grade:
            out[sym] = grade
    return out


def read_implied_context(targets, failures=None):
    """{TICKER: {"implied_move_pct": float, "earnings_setup_grade": str}} —
    reporters within 14 days (`implied_store.upcoming_reporters(days=14)`),
    one `get_implied_for_date` call per DISTINCT report_date among the
    TARGET reporters, plus the latest setup-grade letter. A non-reporter (or
    a reporter whose report_date this store never captured a snapshot for)
    gets no key at all — disclosed NULL, per spec, never a stale/guessed
    value.
    """
    try:
        from api.services import implied_store
        reporters = implied_store.upcoming_reporters(days=14)
    except Exception as e:  # noqa: BLE001 — a dead reporter-list costs the whole reader
        _note(failures, "implied_upcoming_reporters", e)
        return {}
    if not reporters:
        _note(failures, "implied_upcoming_reporters", "empty")
        return {}

    target_set = {t.upper() for t in targets}
    report_date_by_sym = {}
    for rep in reporters:
        sym = (rep.get("sym") or "").upper()
        rd = rep.get("report_date")
        if sym and rd and sym in target_set and sym not in report_date_by_sym:
            report_date_by_sym[sym] = rd
    if not report_date_by_sym:
        return {}

    implied_by_sym = {}
    for rd in sorted({rd for rd in report_date_by_sym.values()}):
        try:
            day_map = implied_store.get_implied_for_date(rd) or {}
        except Exception as e:  # noqa: BLE001 — one bad date must not blank every date
            _note(failures, "implied_get_for_date", e)
            continue
        implied_by_sym.update(day_map)

    grades = _latest_grades(failures)

    out = {}
    for sym in report_date_by_sym:
        row = {}
        if sym in implied_by_sym:
            row["implied_move_pct"] = implied_by_sym[sym]
        if sym in grades:
            row["earnings_setup_grade"] = grades[sym]
        if row:
            out[sym] = row
    return out
