"""SCALAR POPULATION — a declared scalar that nothing fills is a broken promise.

🔴 THE DEFECT THIS EXISTS FOR. On 2026-08-09 the closed table declared 54
scalars and **22 of them were NULL on all 3,708 rows** of the live snapshot. The
engine was right, the honesty machinery was right, `not_computable` was reported
honestly — but 41% of the vocabulary a member can build a criterion out of had no
data behind it, and *nothing in the suite was red*. Every unit test of every
producer passed, because every one of them mocks its provider:
`tests/test_screener_massive_cap.py` proves `get_market_cap` returns `1.5e9`
when `get_ticker_details` is monkeypatched to hand it `1.5e9`. That test is
green on a build that wrote NULL 3,708 times.

⭐ SO THE RAILS HERE MEASURE, THEY DO NOT MOCK. Two of them, because the 22 have
two different shapes and one check cannot see both:

  * **§1 STRUCTURAL — "declared without a collector."** Derived by AST over the
    screener package: which snapshot COLUMNS does any code in it actually
    assign? A scalar the manifest declares that no line of the builder can ever
    write is red the day it is declared, in CI, with no database and no network.
    That is the check that catches a 55th scalar on arrival.

  * **§2 ARTIFACT — "collector exists, produced nothing."** `COUNT(col)` over a
    real snapshot. `market_cap` passes §1 (the builder assigns it, and it fills
    15/15 when exercised) and still came out 0/3,708, because the process had no
    `MASSIVE_API_KEY` and `_read_fundamentals` swallowed the same `RuntimeError`
    3,708 times.

⛔ NEITHER LIST IS TYPED BY HAND. Both derive from `closedTable.json` through
`ast_table` — the same bytes the browser parses — so the day a scalar is added
or renamed, these rails read the new name and not somebody's memory of the old
one.

⭐ THE ALLOW-LISTS ARE SELF-CLEANING, IN BOTH DIRECTIONS. A newly-empty scalar
fails because it is not listed; an allow-listed scalar that has since been
filled ALSO fails, demanding its own removal. An allow-list that only ever grows
is a list of things nobody will look at again.

⛔ AND THE ALLOW-LIST IS NOT DATE-BOMBED. "Obviously temporary" is carried by a
mandatory dated reason per entry plus the shrink-or-fail rail above — NOT by
asserting a clock has not passed some day. This repo has measured 15 false time
bombs per real one (`lesson_a_half_faked_clock_manufactures_false_positives`),
and a rail that turns red at midnight teaches people to delete rails.

⚠️ EMPTY IS THE FAILURE, THIN IS CONTEXT. `pattern_conf_max` sits at 41% because
most tickers genuinely have no detected pattern — that is a true answer, not a
gap. A percentage threshold here would be a tunable with nothing to tune it
against, so the gate is `COUNT(col) == 0` and sparse columns are reported.
"""
from __future__ import annotations

import ast as pyast
import os
import pathlib
import sqlite3

import pytest

from api.services import ast_table

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCREENER_PKG = ROOT / "api" / "services" / "screener"

#: Which environment variable points these rails at a REAL snapshot.
#:
#: ⚠️ IT HAS TO BE EXPLICIT. The repo-root `conftest.py` redirects every
#: `/data`-derived path to a per-run sandbox (it is the tripwire that keeps the
#: suite out of `C:\data`), so `snapshot_db.get_db_path()` under pytest resolves
#: to an EMPTY database. A rail that measured that would report 54 empty
#: scalars, or — worse, once allow-listed — 54 green ones. Opting in by name
#: means the artifact under measurement is always the one somebody chose.
ARTIFACT_ENV = "SCALAR_POPULATION_ARTIFACT"


# ───────────────────────── derivations ──────────────────────────────────────

def declared_scalar_columns() -> dict:
    """``{scalar_name: column_name}`` for every scalar the manifest declares.

    ⛔ THE COLUMN IS READ FROM `source`, NOT ASSUMED EQUAL TO THE NAME. They
    happen to match for all 54 today; asserting through the assumption would
    make these rails silently measure the wrong column the day one diverges.
    """
    out = {}
    for name in sorted(ast_table.scalar_names()):
        src = ast_table.scalar_source(name) or {}
        col = src.get("column") or name
        out[name] = col
    return out


def _assigned_string_keys(path: pathlib.Path) -> set:
    """String keys this module can WRITE into a dict, read by AST.

    Two shapes, and only two, because they are the two the builder uses:
    ``d["col"] = v`` (an assignment whose target is a constant subscript) and
    ``{"col": v}`` (a dict literal, which `build_row` merges wholesale).

    ⛔ AST, NEVER GREP, and never an import either — `test_ast_scalars.py` sets
    that precedent for exactly this reason. A grep over `snapshot_db.py` would
    count all 65 names in `COLUMNS`; `COLUMNS` is a LIST, so no name in it is
    either an assignment target or a dict key, and the AST reads zero writers
    there. That distinction is the whole check.
    """
    tree = pyast.parse(path.read_text(encoding="utf-8"))
    found = set()
    for node in pyast.walk(tree):
        targets = []
        if isinstance(node, pyast.Assign):
            targets = list(node.targets)
        elif isinstance(node, (pyast.AugAssign, pyast.AnnAssign)):
            targets = [node.target]
        for tgt in targets:
            if (isinstance(tgt, pyast.Subscript)
                    and isinstance(tgt.slice, pyast.Constant)
                    and isinstance(tgt.slice.value, str)):
                found.add(tgt.slice.value)
        if isinstance(node, pyast.Dict):
            for key in node.keys:
                if isinstance(key, pyast.Constant) and isinstance(key.value, str):
                    found.add(key.value)
    return found


def writable_columns() -> set:
    """Every snapshot column ANY module in the screener package can assign."""
    out = set()
    for path in sorted(SCREENER_PKG.glob("*.py")):
        out |= _assigned_string_keys(path)
    return out


def measure_population(db_path: str, columns) -> tuple:
    """``(rows, {column: non_null_rows})`` read READ-ONLY off a snapshot file.

    ⛔ OPENED `mode=ro`. These rails may be pointed at `C:\\data\\screener.db`,
    the live shared artifact a 3,704-row rebuild lands in nightly. A rail that
    could write to what it measures is not a measurement.
    """
    uri = f"file:{pathlib.Path(db_path).as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    try:
        present = {r[1] for r in conn.execute("PRAGMA table_info(screener_rows)")}
        rows = conn.execute("SELECT COUNT(*) FROM screener_rows").fetchone()[0]
        counts = {}
        for col in columns:
            if col not in present:
                counts[col] = None          # the column itself is missing
                continue
            counts[col] = conn.execute(
                f'SELECT COUNT("{col}") FROM screener_rows').fetchone()[0]
        return rows, counts
    finally:
        conn.close()


def assess(counts: dict, allowed: dict) -> dict:
    """Partition a population census against an allow-list.

    Returns ``{"unlisted_empty": [...], "stale_allowance": [...],
    "missing_column": [...]}`` — three DIFFERENT facts, never folded into one
    number. "A new scalar has no data", "an old gap has been filled", and "the
    column is not in the schema at all" want three different actions.
    """
    unlisted_empty, stale, missing = [], [], []
    for name, n in sorted(counts.items()):
        if n is None:
            missing.append(name)
        elif n == 0 and name not in allowed:
            unlisted_empty.append(name)
        elif n > 0 and name in allowed:
            stale.append(name)
    return {"unlisted_empty": unlisted_empty,
            "stale_allowance": stale,
            "missing_column": missing}


# ───────────────────────── the allow-lists ──────────────────────────────────
#
# ⏳ TEMPORARY — REVIEWED 2026-08-09, and every entry carries WHY. These are not
# exemptions, they are an inventory of debt with a named owner for each item.
# Adding a name here is a decision to ship a scalar a member cannot screen on;
# `test_no_allowance_outlives_its_gap` deletes each one the moment it is fixed.

#: §1 — DECLARED AHEAD OF ANY COLLECTOR. No line in the screener package
#: assigns these columns; they exist in `snapshot_db.COLUMNS` and nowhere else
#: in the write path. Filling them needs a per-ticker fundamentals fetch across
#: ~3,700 names (the values ARE computed for the research page today — see
#: `research/financials.py` and `research/snapshot.py` — but only one symbol at
#: a time, on demand, from FMP).
NO_COLLECTOR = {
    "dividend_yield": "2026-08-09 no collector; research/snapshot.py has it per-symbol",
    "pe_ttm":         "2026-08-09 no collector; research/financials.py has it per-symbol",
    "ps":             "2026-08-09 no collector; research/snapshot.py has it per-symbol",
    "pb":             "2026-08-09 no collector; research/snapshot.py has it per-symbol",
    "gross_margin":   "2026-08-09 no collector; research/financials.py has it per-symbol",
    "net_margin":     "2026-08-09 no collector; research/financials.py has it per-symbol",
    "roa":            "2026-08-09 no collector; research/financials.py has it per-symbol",
    "debt_to_equity": "2026-08-09 no collector; research/financials.py has it per-symbol",
    "current_ratio":  "2026-08-09 no collector; research/financials.py has it per-symbol",
    "beta":           "2026-08-09 no collector; research/snapshot.py has it per-symbol",
}

#: §2 — EMPTY IN THE ARTIFACT AS IT STANDS. Everything in NO_COLLECTOR is
#: necessarily here too (no writer => no data), plus the columns whose collector
#: exists but produced nothing on the build that wrote the current rows.
ARTIFACT_EMPTY = dict(NO_COLLECTOR)
ARTIFACT_EMPTY.update({
    # An empty store behind a job that is off by default: `research_ratings.db`
    # is 0 bytes, and its only writer (`ratings_universe.nightly_job`) is
    # registered only under RATINGS_PERCENTILE_ENABLED, default "0".
    "eps_growth":    "2026-08-09 research_ratings.db empty (RATINGS_PERCENTILE_ENABLED=0)",
    "rev_growth":    "2026-08-09 research_ratings.db empty (RATINGS_PERCENTILE_ENABLED=0)",
    "peg":           "2026-08-09 research_ratings.db empty (RATINGS_PERCENTILE_ENABLED=0)",
    "pe_fwd":        "2026-08-09 research_ratings.db empty (RATINGS_PERCENTILE_ENABLED=0)",
    "op_margin":     "2026-08-09 research_ratings.db empty (RATINGS_PERCENTILE_ENABLED=0)",
    "roe":           "2026-08-09 research_ratings.db empty (RATINGS_PERCENTILE_ENABLED=0)",
    "inst_pct":      "2026-08-09 research_ratings.db empty (RATINGS_PERCENTILE_ENABLED=0)",
    "accdis":        "2026-08-09 research_ratings.db empty (RATINGS_PERCENTILE_ENABLED=0)",
    "uct_composite": "2026-08-09 research_ratings.db empty (RATINGS_PERCENTILE_ENABLED=0)",
    # FIXED IN CODE 2026-08-09, still empty in the rows on disk because those
    # rows predate the fix. These three clear on the next build, and this rail
    # will then FAIL demanding they be struck from the list.
    "market_cap": "2026-08-09 FIXED (build ran with no MASSIVE_API_KEY); clears next build",
    "rs_rank":    "2026-08-09 FIXED (now wired to rs_ranking); clears next build",
    "rs_return":  "2026-08-09 FIXED (now wired to rs_ranking); clears next build",
})


# ───────────────────────── §0 the allow-lists themselves ────────────────────

def test_every_allowance_names_a_declared_scalar():
    """A typo in an allow-list is a permanent silent exemption for nothing —
    and, worse, leaves the real name unlisted and the rail red for a reason
    nobody can find."""
    declared = set(declared_scalar_columns())
    for label, table in (("NO_COLLECTOR", NO_COLLECTOR),
                         ("ARTIFACT_EMPTY", ARTIFACT_EMPTY)):
        unknown = sorted(set(table) - declared)
        assert not unknown, (
            f"{label} names things the closed table does not declare: {unknown}. "
            f"Either the manifest dropped them (delete the allowance) or they "
            f"are misspelled.")


def test_every_allowance_carries_a_dated_reason():
    """⏳ The list is temporary, and says so per entry rather than by a clock.

    A bare `{"market_cap"}` set would be indistinguishable in six months from a
    deliberate design decision. A dated sentence is what makes it debt.
    """
    for label, table in (("NO_COLLECTOR", NO_COLLECTOR),
                         ("ARTIFACT_EMPTY", ARTIFACT_EMPTY)):
        for name, reason in sorted(table.items()):
            assert isinstance(reason, str) and len(reason) > 20, \
                f"{label}[{name}] needs a real reason, got {reason!r}"
            assert reason[:4].isdigit() and reason[4] == "-", \
                (f"{label}[{name}] must start with the date it was accepted "
                 f"(YYYY-MM-DD), got {reason!r}")


def test_the_artifact_allowance_contains_every_uncollected_scalar():
    """A column nothing can write cannot have data. If §1 lists a name that §2
    does not, one of the two lists has been edited without the other."""
    missing = sorted(set(NO_COLLECTOR) - set(ARTIFACT_EMPTY))
    assert not missing, (
        f"these have no collector but are not listed as empty in the artifact: "
        f"{missing}")


# ───────────────────────── §1 structural: no collector ──────────────────────

def test_every_declared_scalar_has_a_collector():
    """🔴 THE ARRIVAL GATE. A 55th scalar declared in `closedTable.json` with no
    line of the builder able to write its column is red here, in CI, with no
    database — before a member ever meets it in the criterion list."""
    columns = declared_scalar_columns()
    writable = writable_columns()
    orphans = sorted(name for name, col in columns.items()
                     if col not in writable and name not in NO_COLLECTOR)
    assert not orphans, (
        f"declared in closedTable.json with no writer in {SCREENER_PKG.name}/: "
        f"{orphans}. A scalar with no collector always reports "
        f"`not_computable` — either wire a collector or add it to "
        f"NO_COLLECTOR with a dated reason.")


def test_no_collector_allowance_shrinks_when_a_collector_lands():
    """⭐ SELF-CLEANING. The moment somebody writes the collector, this fails
    and the allowance has to go — otherwise the list only ever grows."""
    columns = declared_scalar_columns()
    writable = writable_columns()
    now_written = sorted(name for name in NO_COLLECTOR
                         if columns.get(name, name) in writable)
    assert not now_written, (
        f"NO_COLLECTOR is stale — these now HAVE a writer: {now_written}. "
        f"Remove them from the allow-list.")


def test_the_writer_derivation_can_tell_a_list_from_a_dict():
    """The derivation's one load-bearing distinction, asserted directly.

    `snapshot_db.COLUMNS` is a list holding all 65 column names. If the walker
    counted list elements as writers, every scalar would look collected and §1
    would be permanently, invisibly green.
    """
    keys = _assigned_string_keys(SCREENER_PKG / "snapshot_db.py")
    assert "dividend_yield" not in keys, (
        "the AST walker is counting `COLUMNS` list elements as writers — §1 "
        "cannot fail while it does")
    # ...and it does find a genuine writer in the builder.
    assert "market_cap" in _assigned_string_keys(SCREENER_PKG / "snapshot_builder.py")


# ───────────────────────── §2 artifact: measured population ─────────────────

def _artifact_path():
    return os.environ.get(ARTIFACT_ENV) or ""


def _require_artifact():
    path = _artifact_path()
    if not path:
        pytest.skip(f"set {ARTIFACT_ENV}=<path to a screener.db> to measure a "
                    f"real snapshot (the suite's own DB is a sandbox)")
    if not pathlib.Path(path).exists():
        pytest.fail(f"{ARTIFACT_ENV}={path!r} does not exist — a rail pointed "
                    f"at nothing must not pass")
    return path


def test_the_artifact_has_no_unlisted_empty_scalar():
    """§2's gate against the real rows. Opt-in by `SCALAR_POPULATION_ARTIFACT`."""
    path = _require_artifact()
    columns = declared_scalar_columns()
    rows, counts = measure_population(path, sorted(set(columns.values())))
    assert rows > 0, f"{path} holds no rows — nothing was measured"
    by_scalar = {name: counts[col] for name, col in columns.items()}
    verdict = assess(by_scalar, ARTIFACT_EMPTY)
    assert not verdict["missing_column"], \
        f"declared scalars with no column in the schema: {verdict['missing_column']}"
    assert not verdict["unlisted_empty"], (
        f"NULL on all {rows} rows of {path} and not allow-listed: "
        f"{verdict['unlisted_empty']}")


def test_no_allowance_outlives_its_gap():
    """⭐ THE OTHER DIRECTION, and the one that makes the list temporary: a
    scalar that has since been filled must come OFF the allow-list."""
    path = _require_artifact()
    columns = declared_scalar_columns()
    rows, counts = measure_population(path, sorted(set(columns.values())))
    by_scalar = {name: counts[col] for name, col in columns.items()}
    verdict = assess(by_scalar, ARTIFACT_EMPTY)
    assert not verdict["stale_allowance"], (
        f"ARTIFACT_EMPTY is stale — these now carry data in {path}: "
        f"{ {n: by_scalar[n] for n in verdict['stale_allowance']} }. "
        f"Delete their allowances.")


# ───────────────────────── §3 the gate can fail ─────────────────────────────
#
# ⚠️ §2 SKIPS WITHOUT AN ARTIFACT, so on its own it would be a gate nobody has
# watched fail (`lesson_gate_that_cannot_fail`). These run the SAME
# `measure_population` + `assess` against synthetic snapshots and assert the red.

def _synthetic_snapshot(tmp_path, filled: dict, rows: int = 3):
    db = tmp_path / "synthetic_screener.db"
    conn = sqlite3.connect(db)
    cols = sorted(set(declared_scalar_columns().values()))
    conn.execute("CREATE TABLE screener_rows (ticker TEXT PRIMARY KEY, "
                 + ", ".join(f'"{c}" REAL' for c in cols) + ")")
    for i in range(rows):
        vals = [f"T{i}"] + [filled.get(c) for c in cols]
        conn.execute(
            f"INSERT INTO screener_rows VALUES ({', '.join('?' * (len(cols) + 1))})",
            vals)
    conn.commit()
    conn.close()
    return str(db)


def test_measurement_reports_an_empty_declared_scalar(tmp_path):
    """The red proof for `unlisted_empty`."""
    columns = declared_scalar_columns()
    every = {c: 1.0 for c in columns.values()}
    every.pop(columns["adr_pct"])                     # one column left NULL
    db = _synthetic_snapshot(tmp_path, every)
    rows, counts = measure_population(db, sorted(set(columns.values())))
    assert rows == 3
    by_scalar = {n: counts[c] for n, c in columns.items()}
    verdict = assess(by_scalar, ARTIFACT_EMPTY)
    assert verdict["unlisted_empty"] == ["adr_pct"], verdict


def test_measurement_reports_a_stale_allowance(tmp_path):
    """The red proof for `stale_allowance` — the shrink-or-fail direction."""
    columns = declared_scalar_columns()
    every = {c: 1.0 for c in columns.values()}        # EVERYTHING filled
    db = _synthetic_snapshot(tmp_path, every)
    _, counts = measure_population(db, sorted(set(columns.values())))
    by_scalar = {n: counts[c] for n, c in columns.items()}
    verdict = assess(by_scalar, ARTIFACT_EMPTY)
    assert not verdict["unlisted_empty"]
    assert set(verdict["stale_allowance"]) == set(ARTIFACT_EMPTY), verdict


def test_measurement_reports_a_column_the_schema_lost(tmp_path):
    """A declared scalar whose column is not in the table is neither 'empty' nor
    'fine' — it is a schema break, and it gets its own bucket."""
    columns = declared_scalar_columns()
    db = _synthetic_snapshot(tmp_path, {c: 1.0 for c in columns.values()})
    rows, counts = measure_population(db, sorted(set(columns.values())) + ["nope"])
    assert counts["nope"] is None
    assert assess({"nope": None}, {})["missing_column"] == ["nope"]
