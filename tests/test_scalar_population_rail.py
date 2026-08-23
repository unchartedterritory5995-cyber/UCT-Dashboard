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

    Three shapes, because they are the three the package uses:
    ``d["col"] = v`` (an assignment whose target is a constant subscript),
    ``{"col": v}`` (a dict literal, which `build_row` merges wholesale), and
    ``for col in _FIELDS: row[col] = …`` (a subscript-assign whose slice is
    the loop variable of a ``for`` over a tuple/list of string constants —
    `opt_flow.read_opt_flow_fields`' guarded per-column copy, which shipped
    with Wave 5 and made the two-shape census read a REAL collector as absent:
    2026-08-23 Wave-6 T1 found `opt_net_premium_1d`/`opt_bull_pct_1d`/
    `opt_net_premium_5d` orphaned by the derivation, not by the builder).

    ⛔ AST, NEVER GREP, and never an import either — `test_ast_scalars.py` sets
    that precedent for exactly this reason. A grep over `snapshot_db.py` would
    count all 65 names in `COLUMNS`; `COLUMNS` is a LIST, so no name in it is
    either an assignment target or a dict key, and the AST reads zero writers
    there. That distinction is the whole check — and shape three keeps it:
    the sequence's strings count ONLY when the loop body assigns through the
    loop name, so `snapshot_db`'s `for c in COLUMNS:` (ALTER TABLE, no
    subscript-assign) still contributes nothing.
    """
    tree = pyast.parse(path.read_text(encoding="utf-8"))
    found = set()

    def _string_seq(node) -> set:
        """{strings} for a Tuple/List literal made ENTIRELY of string constants."""
        if not isinstance(node, (pyast.Tuple, pyast.List)) or not node.elts:
            return set()
        strings = {e.value for e in node.elts
                   if isinstance(e, pyast.Constant) and isinstance(e.value, str)}
        return strings if len(strings) == len(node.elts) else set()

    # module-level `NAME = ("a", "b", …)` bindings, for shape three's iterable
    const_seqs = {}
    for node in tree.body:
        if isinstance(node, pyast.Assign):
            strings = _string_seq(node.value)
            if strings:
                for tgt in node.targets:
                    if isinstance(tgt, pyast.Name):
                        const_seqs[tgt.id] = strings

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
        if isinstance(node, pyast.For) and isinstance(node.target, pyast.Name):
            if isinstance(node.iter, pyast.Name):
                seq = const_seqs.get(node.iter.id, set())
            else:
                seq = _string_seq(node.iter)
            if seq and any(
                    isinstance(tgt, pyast.Subscript)
                    and isinstance(tgt.slice, pyast.Name)
                    and tgt.slice.id == node.target.id
                    for sub in pyast.walk(node)
                    for tgt in (list(sub.targets) if isinstance(sub, pyast.Assign)
                                else [sub.target] if isinstance(
                                    sub, (pyast.AugAssign, pyast.AnnAssign))
                                else [])):
                found |= seq
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
#: in the write path.
#:
#: ⭐ EMPTY AS OF 2026-08-09, and it emptied the way the rail was designed to
#: make it empty. All ten members were the Group-A fundamentals
#: (dividend_yield · pe_ttm · ps · pb · gross_margin · net_margin · roa ·
#: debt_to_equity · current_ratio · beta); the moment
#: `screener/fundamentals_bulk.py` landed with a dict literal keyed by those
#: column names, `test_no_collector_allowance_shrinks_when_a_collector_lands`
#: went red and demanded every one of them be struck from here. That is the
#: shrink direction doing its job, not a list somebody tidied.
#:
#: ⛔ DO NOT re-add a name here to quiet a red §1. The allowance is for a gap
#: with a named owner, and §1 going red means the manifest declared something
#: the builder cannot write — which is a missing collector, not a missing
#: exemption.
NO_COLLECTOR: dict = {}

#: §2 — EMPTY IN THE ARTIFACT AS IT STANDS. Everything in NO_COLLECTOR is
#: necessarily here too (no writer => no data), plus the columns whose collector
#: exists but produced nothing on the build that wrote the current rows.
ARTIFACT_EMPTY = dict(NO_COLLECTOR)
ARTIFACT_EMPTY.update({
    # An empty store behind a job that is off by default: `research_ratings.db`
    # is 0 bytes, and its only writer (`ratings_universe.nightly_job`) is
    # registered only under RATINGS_PERCENTILE_ENABLED, default "0".
    #
    # ⚠️ THE PARENTHESISED REASON IS ABOUT THIS BOX, NOT ABOUT PRODUCTION.
    # `railway variables --service web` reads `RATINGS_PERCENTILE_ENABLED=1`,
    # so the gather DOES run on Railway and these columns are not dormant there
    # — they are empty HERE, where the store is 0 bytes. A local default is not
    # a deployment's state.
    "eps_growth":    "2026-08-09 research_ratings.db empty on this box (RATINGS_PERCENTILE_ENABLED=0 locally, =1 on Railway)",
    "rev_growth":    "2026-08-09 research_ratings.db empty on this box (RATINGS_PERCENTILE_ENABLED=0 locally, =1 on Railway)",
    "pe_fwd":        "2026-08-09 research_ratings.db empty on this box (RATINGS_PERCENTILE_ENABLED=0 locally, =1 on Railway)",
    "inst_pct":      "2026-08-09 research_ratings.db empty on this box (RATINGS_PERCENTILE_ENABLED=0 locally, =1 on Railway)",
    # (`accdis` was listed here until 2026-08-23 Wave-6 T1 EXCLUDED it from the
    # manifest — it holds letter grades, so it is no longer a declared scalar
    # and `test_every_allowance_names_a_declared_scalar` demands its removal.)
    "uct_composite": "2026-08-09 research_ratings.db empty on this box (RATINGS_PERCENTILE_ENABLED=0 locally, =1 on Railway)",
    # ⭐ THREE COLUMNS CHANGED HANDS, so their reason changed too. `op_margin`,
    # `roe` and `peg` are no longer waiting on `research_ratings.db` — they are
    # read from `ratios-ttm-bulk`/`key-metrics-ttm-bulk` by `fundamentals_bulk`,
    # which is also why `enrich.ratings_fields` stopped emitting them (two
    # writers over one column, and BOTH ran in production). They are still
    # listed here for the same reason as the Group-A ten below: §2 measures the
    # ROWS on disk, and those were written before the collector existed.
    "op_margin":     "2026-08-09 collector changed hands (enrich -> fundamentals_bulk); clears next build",
    "roe":           "2026-08-09 collector changed hands (enrich -> fundamentals_bulk); clears next build",
    "peg":           "2026-08-09 collector changed hands (enrich -> fundamentals_bulk); clears next build",
    # FIXED IN CODE 2026-08-09, still empty in the rows on disk because those
    # rows predate the fix. These three clear on the next build, and this rail
    # will then FAIL demanding they be struck from the list.
    "market_cap": "2026-08-09 FIXED (build ran with no MASSIVE_API_KEY); clears next build",
    "rs_rank":    "2026-08-09 FIXED (now wired to rs_ranking); clears next build",
    "rs_return":  "2026-08-09 FIXED (now wired to rs_ranking); clears next build",
    # ⭐ THE GROUP-A TEN. A COLLECTOR NOW EXISTS — `screener/fundamentals_bulk.py`
    # fills them from three FMP bulk endpoints in six requests, proven against a
    # sandbox rebuild — so they are OFF `NO_COLLECTOR` above. They stay listed
    # HERE, and only here, because the rows on `C:\data\screener.db` were
    # written before the collector existed and §2 measures rows, not code.
    # They clear on the next nightly build, at which point
    # `test_no_allowance_outlives_its_gap` fails and strikes all ten.
    "dividend_yield": "2026-08-09 collector landed (fundamentals_bulk); clears next build",
    "pe_ttm":         "2026-08-09 collector landed (fundamentals_bulk); clears next build",
    "ps":             "2026-08-09 collector landed (fundamentals_bulk); clears next build",
    "pb":             "2026-08-09 collector landed (fundamentals_bulk); clears next build",
    "gross_margin":   "2026-08-09 collector landed (fundamentals_bulk); clears next build",
    "net_margin":     "2026-08-09 collector landed (fundamentals_bulk); clears next build",
    "roa":            "2026-08-09 collector landed (fundamentals_bulk); clears next build",
    "debt_to_equity": "2026-08-09 collector landed (fundamentals_bulk); clears next build",
    "current_ratio":  "2026-08-09 collector landed (fundamentals_bulk); clears next build",
    "beta":           "2026-08-09 collector landed (fundamentals_bulk); clears next build",
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
    # ⭐ SHAPE THREE'S BOTH DIRECTIONS, on the module that forced it. opt_flow's
    # `for col in _FIELDS: row[col] = src[col]` is a real collector and must
    # count; and `snapshot_db.py` iterates `COLUMNS` too (the ALTER-add loop),
    # so the `dividend_yield` assertion above is ALSO the negative control that
    # a for-loop with no subscript-assign through its loop name stays invisible.
    assert "opt_net_premium_1d" in _assigned_string_keys(SCREENER_PKG / "opt_flow.py"), (
        "the walker lost shape three — a per-column guarded copy over a module "
        "tuple — and §1 will orphan every collector written that way")


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
