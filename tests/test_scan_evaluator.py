"""E-3 — the evaluator: FOUR outcomes, a closed identity, and no threads.

🔴 WHAT THIS FILE EXISTS TO MAKE IMPOSSIBLE — a screen that loses symbols.
Every sweep in the ground-truth survey that lost symbols lost them through a hole
in one piece of arithmetic:

  * `bars_prewarm._warm_one`  -- `except: pass`, counted into NEITHER `warmed`
    nor `skipped`, never printed. A symbol failing every cycle is invisible.
  * `rs_ranking`              -- per-ticker `except: pass`, no counter, AND
    `readiness.mark_done("rs_rankings")` fires EVEN ON FAILURE.
  * `theme_performance`       -- a failed fetch becomes a legitimate-looking None.
  * `scan_volume._job`        -- `m = {}` on a failed reference: a failed
    reference is indistinguishable from an empty market.

At 3,742 symbols that is a screen silently dropping 800, returning fewer hits, and
looking like a quiet market -- which a trader would act on.

⭐ AND THE ANSWER IS FOUR BUCKETS, NOT TWO. `evaluated == answered + dropped +
not_computable` is asserted INSIDE the function, and `withheld` sits OUTSIDE it
because a withheld symbol was never looked at. Fold any two together and a capped
screen reads as broken while a broken one reads as capped.
"""
from __future__ import annotations

import ast as pyast
import datetime
import inspect
import pathlib
import re

import pytest

from api.services import ast_freshness
from api.services import ast_interpret
from api.services import ast_table
from api.services import definition_record
from api.services import scan_definition
from api.services import user_definitions
from api.services.screener import scan_evaluator
from api.services.screener import scan_store
from api.services.screener import snapshot_db
from api.services.signature import ledger

MODULE_PATH = pathlib.Path(scan_evaluator.__file__)

#: The session every fixture screens. A weekday, spelled once.
SESSION = 20260807
SESSION_DATE = datetime.date(2026, 8, 7)
TF = scan_evaluator.DEFAULT_TF

#: ⛔ THE PRODUCT LABEL IS DERIVED. `scan_store` keys on the bars-store CODE and
#: `definition_record` keys on the label; typing "1D" here would be the second
#: spelling both stores exist to prevent.
TF_LABEL = ledger._BARS_STORE_TF_KEYS[TF]


# ─── trees ───────────────────────────────────────────────────────────────────
#
# Built as canonical nodes rather than parsed, because what is under test is the
# SWEEP. `tests/test_scan_definition.py` is where a tree's provenance is proved
# against the shipped parser; here every tree is run through `assert_scannable`,
# which is the same door production uses.

def _series(name):
    return {"type": "series", "name": name}


def _num(value):
    return {"type": "num", "value": value}


def _op(name, *args):
    return {"type": "op", "name": name, "args": list(args)}


#: `market_cap > 1e9` -- the SCALAR tree. Its hole is the whole point of
#: contract 1: with no market cap the comparison answers a confident 0.
SCALAR_TREE = _op(">", _series("market_cap"), _num(1e9))

#: `close && (close > 0)` -- the NaN-AT-THE-LAST-BAR tree. `&&` propagates NaN
#: (the table says so in its own words) while a comparison eats it, so this is
#: the only shape that can put a `None` at the last confirmed bar.
NAN_TREE = _op("&&", _series("close"), _op(">", _series("close"), _num(0)))

#: `close > 0` -- reads no declared scalar, so `screener_rows` cannot make its
#: answer wrong. The control for the snapshot gate.
PRICE_TREE = _op(">", _series("close"), _num(0))


def _definition(tree, *, rev=1, def_id="u_000000000001"):
    """A schema-v1 `ast` definition around a canonical tree."""
    return {
        "schemaVersion": 1,
        "id": def_id,
        "version": 1,
        "meta": {"name": "A Screen", "shortName": "SCR",
                 "repaint": "non-repainting"},
        "compute": {"kind": "ast", "ast": tree,
                    "fn": user_definitions.ast_hash(tree),
                    **({"rev": rev} if rev is not None else {})},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


# ─── bars ────────────────────────────────────────────────────────────────────

def _daily_bars(n=60, end=SESSION_DATE, last_close=None, start_close=10.0):
    """`n` consecutive daily bars ending on `end`, as the store's own tuples."""
    out = []
    for i in range(n):
        d = end - datetime.timedelta(days=n - 1 - i)
        key = d.year * 10_000 + d.month * 100 + d.day
        close = start_close + i
        out.append((key, close, close + 1, close - 1, close, 1_000_000))
    if last_close is not None:
        k, o, h, l, _c, v = out[-1]
        out[-1] = (k, o, h, l, last_close, v)
    return out


@pytest.fixture
def store(tmp_path, monkeypatch):
    """A screener database of this test's own, PROVED to be the one in use."""
    path = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    monkeypatch.setattr(scan_store, "_INITED", set())
    assert snapshot_db.get_db_path() == str(path), (
        "SCREENER_DB_PATH did not reach snapshot_db — a module-level capture has "
        "appeared and this whole file is writing somewhere else")
    scan_store.init_db()
    return path


@pytest.fixture
def bars(monkeypatch):
    """A stub bars store keyed by ticker. Missing ticker == no bars."""
    from api.services import bars_sqlite

    table: dict = {}

    def _get(ticker, tf, max_bars):
        rows = table.get(str(ticker).upper())
        return list(rows or [])[-max_bars:]

    monkeypatch.setattr(bars_sqlite, "get_bars", _get)
    return table


@pytest.fixture
def clock(monkeypatch):
    """⏰ THE SWEEP READS A WALL CLOCK NOW, SO EVERY SWEEP TEST MUST FREEZE IT.

    Frozen at the sweep's OWN SCHEDULED HOUR on the session under test — derived
    from `SWEEP_HOUR_ET`/`SWEEP_MINUTE_ET` rather than typed, so moving the
    schedule moves the fixture and the budget tests keep describing production.

    ⛔ THERE IS EXACTLY ONE CLOCK TO FREEZE (`scan_evaluator._now_et`) AND THAT IS
    WHY THIS IS SAFE. `lesson_a_half_faked_clock_manufactures_false_positives`
    measured 15 false time-bombs per real one, every one from a test that froze
    one source and left a second running. `sweep_deadline` reads this same
    function, so freezing it freezes the deadline too.

    ⭐ WITHOUT THIS FIXTURE THESE TESTS PASS BEFORE 09:00 ET AND FAIL AFTER IT —
    measured, not theorised: three pre-existing sweep tests went red the moment
    the budget landed, at 11:07 ET, because the real deadline had already passed.
    """
    frozen = datetime.datetime(
        SESSION_DATE.year, SESSION_DATE.month, SESSION_DATE.day,
        scan_evaluator.SWEEP_HOUR_ET, scan_evaluator.SWEEP_MINUTE_ET,
        tzinfo=scan_evaluator._ET)
    monkeypatch.setattr(scan_evaluator, "_now_et", lambda: frozen)
    return frozen


def _snapshot(rows, snapshot_date=None):
    """Write `screener_rows` for this test. `rows` is `{ticker: {column: value}}`."""
    stamp = snapshot_date or SESSION_DATE.isoformat()
    payload = []
    for ticker, fields in rows.items():
        row = {c: None for c in snapshot_db.COLUMNS}
        row["ticker"] = ticker.upper()
        row["snapshot_date"] = stamp
        row["built_at"] = 1
        row.update(fields)
        payload.append(row)
    snapshot_db.upsert_rows(payload)


# ═══ 1. the closed identity ═════════════════════════════════════════════════

def test_coverage_is_a_CLOSED_IDENTITY_the_function_asserts_about_itself(store, bars):
    """🔴 `evaluated == answered + dropped + not_computable`, ASSERTED INSIDE THE
    FUNCTION.

    `escape_census` already does exactly this ('census arithmetic broke: parsed=…
    refused=… escaped=…') and it is why a swallowed case there is impossible
    rather than merely discouraged.

    ⭐ THE 41 IS DERIVED FROM THE FIXTURE, NOT RESTATED. Both non-answered kinds
    are built and both counts are counted OFF the build, so the docstring and the
    numbers cannot drift apart — plan review #10, the same discipline E-2 adopted.
    """
    answered_syms = [f"OK{i:03d}" for i in range(9)]
    hole_syms = [f"HOLE{i:03d}" for i in range(39)]      # no market cap -> a hole
    nobars_syms = ["NOBARS"]                              # a row, no bars
    norow_syms = ["NOROW"]                                # bars, no screener row
    universe = answered_syms + hole_syms + nobars_syms + norow_syms

    _snapshot({**{s: {"market_cap": 2e9} for s in answered_syms},
               **{s: {"market_cap": None} for s in hole_syms},
               **{s: {"market_cap": 2e9} for s in nobars_syms}})
    for s in answered_syms + hole_syms + norow_syms:
        bars[s] = _daily_bars()

    r = scan_evaluator.evaluate_one(_definition(SCALAR_TREE), TF,
                                    universe=universe, as_of=SESSION)

    assert r["evaluated"] == r["answered"] + r["dropped"] + r["not_computable"]
    assert r["evaluated"] == len(universe)
    assert r["dropped"] == len(nobars_syms) + len(norow_syms)
    assert r["not_computable"] == len(hole_syms)
    assert len(r["dropped_symbols"]) == r["dropped"] + r["not_computable"]
    reasons = {d["reason"] for d in r["dropped_symbols"]}
    assert reasons <= (set(scan_evaluator.DROP_REASONS)
                       | {scan_evaluator.NOT_COMPUTABLE_REASON})
    assert reasons == {"no-bars", "no-screener-row",
                       scan_evaluator.NOT_COMPUTABLE_REASON}
    assert sorted(r["hits"]) == sorted(answered_syms)


def test_the_identity_ASSERTION_can_actually_FAIL_and_it_NAMES_all_four(store):
    """⚠️ A GATE IS REAL ONLY IF SOMETHING FAILS ON IT (`lesson_gate_that_cannot_fail`).

    Driven directly with numbers that do not close, so the assertion above is not
    merely asserting that two identical calls agree. ⛔ AND IT IS A `raise`, NOT A
    BARE `assert`: `python -O` strips `assert`, and a coverage guard that
    evaporates under an optimisation flag is a guard that is not there.
    """
    with pytest.raises(AssertionError) as exc:
        scan_evaluator._assert_coverage_closes(evaluated=10, answered=5,
                                               dropped=2, not_computable=2)
    for token in ("evaluated=10", "answered=5", "dropped=2", "not_computable=2"):
        assert token in str(exc.value)
    # and it accepts the closing case, so the raise is not unconditional
    scan_evaluator._assert_coverage_closes(evaluated=9, answered=5, dropped=2,
                                           not_computable=2)


def test_the_closed_identity_IS_CALLED_FROM_INSIDE_evaluate_one__BY_AST():
    """⛔ AST, NEVER GREP. The guard has to run on the sweep's own path; a helper
    that exists and is never called is the shape eight features shipped in this
    week (`lesson_built_tested_green_and_unreachable`)."""
    fn = _function_node("evaluate_one")
    called = {n.func.id for n in pyast.walk(fn)
              if isinstance(n, pyast.Call) and isinstance(n.func, pyast.Name)}
    assert "_assert_coverage_closes" in called, (
        "evaluate_one no longer asserts its own coverage arithmetic")


# ═══ 2. the last confirmed bar ══════════════════════════════════════════════

def test_the_value_is_read_at_the_LAST_CONFIRMED_BAR_and_a_NaN_there_is_NOT_COMPUTABLE(
        store, bars):
    """🔴 A REAL DEFECT CLASS IN A FUNCTION THIS TASK WOULD OTHERWISE REUSE.

    `alert_user_series._last_finite` returns 'the newest computable number in an
    aligned column' -- correct for an alert, which asks 'has it happened yet'.
    WRONG for a screen: on a halted or delisted symbol it walks BACKWARDS until it
    finds a number and answers with a value from forty sessions ago, wearing
    today's `as_of`. That is `lesson_a_derived_reference_needs_a_sanity_bound` at
    universe scale -- a plausible, ranked, wrong answer.

    So the evaluator reads the index of the LAST CONFIRMED BAR specifically, and a
    NaN there lands in `not_computable` -- its OWN bucket, not `dropped`
    (controller resolution 5). It never looks further back.
    """
    rows = _daily_bars(n=40)
    k, o, h, l, _c, v = rows[-1]
    rows[-1] = (k, o, h, l, None, v)                  # NaN at -1 ...
    bars["STALE"] = rows
    column = ast_interpret.interpret(
        NAN_TREE, [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4],
                    "v": r[5]} for r in rows])
    assert column[-1] is None and column[-20] == 1.0, (
        "the fixture no longer has a hole at the last bar and a real value "
        "twenty back — this test would prove nothing")

    r = scan_evaluator.evaluate_one(_definition(NAN_TREE), TF,
                                    universe=["STALE"], as_of=SESSION)

    assert r["hits"] == [] and r["answered"] == 0
    assert r["not_computable"] == 1 and r["dropped"] == 0
    assert r["dropped_symbols"][0]["reason"] == scan_evaluator.NOT_COMPUTABLE_REASON


def test_a_bar_NEWER_than_the_session_does_not_become_the_answer(store, bars):
    """⛔ `-1` IS NOT THE LAST CONFIRMED BAR EITHER. The store carries an evolving
    partial bar for the current session (`_needs_fresh` keeps re-fetching it
    through extended hours), so reading the tail would publish an in-progress
    candle as a screen result. The session is looked UP."""
    rows = _daily_bars(n=40)
    tomorrow = SESSION_DATE + datetime.timedelta(days=1)
    rows.append((tomorrow.year * 10_000 + tomorrow.month * 100 + tomorrow.day,
                 1.0, 1.0, 1.0, -5.0, 1))          # a partial bar that would FAIL
    bars["PARTIAL"] = rows

    r = scan_evaluator.evaluate_one(_definition(PRICE_TREE), TF,
                                    universe=["PARTIAL"], as_of=SESSION)
    assert r["hits"] == ["PARTIAL"], (
        "the sweep read the unconfirmed tail bar instead of the session it was "
        "asked for")
    assert r["answered"] == 1


# ═══ 3. the hole a comparison eats ══════════════════════════════════════════

def test_a_MISSING_SCALAR_is_asked_about_BEFORE_the_comparison_eats_it(store, bars):
    """🔴 CONTRACT 1, RE-MEASURED IN-SUITE RATHER THAN QUOTED.

    `_cmp` answers **0** when either side is NaN, and that rule is pinned by 17
    frozen cross-lane conformance digests, so it is not changing. Applied to a
    scalar it is `scan_volume._job`'s bug at the leaf: *"failed the filter"* and
    *"we had no data"* become the same value at the top of the tree.

    So `unresolved_scalars` is called and the symbol is dropped from evaluation
    BEFORE `interpret` sees it. The control is the symbol that genuinely evaluates
    to 0: it is ANSWERED and merely absent from the hits.
    """
    assert ast_interpret.interpret(SCALAR_TREE, [{"t": SESSION, "c": 1.0}],
                                   scalars={"market_cap": None})[-1] == 0.0, (
        "the comparison no longer eats the hole — the conformance digests must "
        "have moved, and this whole precaution needs re-deriving")

    _snapshot({"HOLE": {"market_cap": None}, "SMALL": {"market_cap": 1.0}})
    bars["HOLE"] = _daily_bars()
    bars["SMALL"] = _daily_bars()

    r = scan_evaluator.evaluate_one(_definition(SCALAR_TREE), TF,
                                    universe=["HOLE", "SMALL"], as_of=SESSION)

    assert r["hits"] == []
    assert r["not_computable"] == 1 and r["answered"] == 1 and r["dropped"] == 0
    listed = {d["ticker"]: d for d in r["dropped_symbols"]}
    assert set(listed) == {"HOLE"}, (
        "the symbol that evaluated to a real 0 was reported as unanswered — "
        "'did not match' and 'we had no data' have been folded together")
    assert "market_cap" in listed["HOLE"]["detail"], (
        "the enumeration must NAME the scalar that was missing, or a member "
        "cannot tell which datum their screen is waiting on")


def test_the_unresolved_INPUT_CALLS_are_on_the_sweep_path__BY_AST():
    """⛔ THE POSITIVE CONTROL FOR THE ABOVE IS STRUCTURAL. A behavioural test
    passes just as happily if the hole never occurs in the fixture; this one goes
    red the moment the call is deleted.

    ⭐ THE SWEEP NOW ASKS THE WIDER QUESTION (W9a.1 / X23). A scalar is one of
    THREE kinds of input the comparison launders, and each has its own owner:

      * `unresolved_inputs`   -- the declared SCALARS (it calls
                                 `unresolved_scalars`, asserted below so the
                                 original question cannot be lost inside the
                                 wider one) **and** the BAR READERS, the entries
                                 declaring `reads: "bars"` in `closedTable.json`,
                                 whose preconditions are properties of the bars;
      * `unresolved_lookback` -- the HISTORY, for a symbol whose store holds
                                 fewer bars than the tree declares it reads.

    All three end in `not_computable`, named. See
    `tests/test_scan_not_computable_inputs.py` for the behaviour.
    """
    fn = _function_node("evaluate_one")
    attrs = {n.func.attr for n in pyast.walk(fn)
             if isinstance(n, pyast.Call) and isinstance(n.func, pyast.Attribute)}
    assert "unresolved_inputs" in attrs
    assert "unresolved_lookback" in attrs

    # ⭐ AND THE SCALAR QUESTION SURVIVES INSIDE THE WIDER ONE. Without this the
    # rail above would go green on an `unresolved_inputs` that quietly stopped
    # asking about scalars at all -- the wider question is only wider if it still
    # contains the narrow one.
    inner = pyast.parse(inspect.getsource(ast_interpret.unresolved_inputs))
    called = {n.func.id for n in pyast.walk(inner)
              if isinstance(n, pyast.Call) and isinstance(n.func, pyast.Name)}
    assert "unresolved_scalars" in called


# ═══ 4. FOUR outcomes — withheld is not dropped ═════════════════════════════

class _Limits:
    """The shape E-7's frozen `Limits` dataclass will have. Read by DUCK TYPE, so
    E-3 does not import a module E-7 has not written."""

    def __init__(self, toolkit="small", max_symbols=None, max_history_bars=None,
                 max_definitions=50, min_refresh_seconds=None):
        self.toolkit = toolkit
        self.max_symbols = max_symbols
        self.max_history_bars = max_history_bars
        self.max_definitions = max_definitions
        self.min_refresh_seconds = min_refresh_seconds


def test_a_SYMBOL_CAP_is_applied_in_the_SWEEP_and_reported_as_WITHHELD_not_DROPPED(
        store, bars):
    """🔴 CONTRACT 2 — FOUR OUTCOMES, AND E-7 IS BLOCKED ON THESE TWO KEYS.

    *"A screen that silently drops 800 symbols returns fewer hits and looks like a
    quiet market."* A toolkit cap does exactly that unless it is reported, and it
    must NOT be reported as `dropped`: dropped means "we tried and failed, here
    they are, re-run them"; withheld means "your plan stops here". Folding one
    into the other makes a capped screen read as a broken one, and a broken one
    read as a capped one.

    ⛔ AND `withheld` IS OUTSIDE THE CLOSED IDENTITY. A withheld symbol was never
    looked at, so counting it as `evaluated` would make the identity a statement
    about billing.
    """
    universe = [f"SYM{i:03d}" for i in range(20)]
    for s in universe:
        bars[s] = _daily_bars()

    out = scan_evaluator.evaluate_one(
        _definition(PRICE_TREE), TF, universe=universe, as_of=SESSION,
        limits=_Limits("small", max_symbols=5, max_history_bars=None,
                       max_definitions=50, min_refresh_seconds=None))

    assert out["evaluated"] == 5
    assert out["withheld"] == len(universe) - 5
    assert out["withheld_reason"] == "toolkit:symbols"
    assert out["dropped"] == 0 and out["dropped_symbols"] == []
    assert out["evaluated"] == (out["answered"] + out["dropped"]
                                + out["not_computable"])
    assert out["withheld_reason"] in scan_evaluator.WITHHELD_REASONS


def test_a_DOWNGRADE_actually_SHRINKS_the_answer(store, bars):
    """⛔ GT §4.3: every limit in the repo today is a CAPACITY bound, not an
    ENTITLEMENT bound, and *"entitlement bounds are a billing contract and need a
    test that a downgrade actually shrinks the answer."* A cap that is computed
    and never applied is the shape of every feature that shipped green and
    unreachable this week."""
    universe = [f"SYM{i:03d}" for i in range(20)]
    for s in universe:
        bars[s] = _daily_bars()
    d = _definition(PRICE_TREE)

    big = scan_evaluator.evaluate_one(d, TF, universe=universe, as_of=SESSION,
                                      limits=_Limits("all", max_symbols=None))
    small = scan_evaluator.evaluate_one(d, TF, universe=universe, as_of=SESSION,
                                        limits=_Limits("small", max_symbols=5))
    assert small["evaluated"] < big["evaluated"]
    assert len(small["hits"]) < len(big["hits"])
    assert big["withheld"] == 0 and big["withheld_reason"] is None


def test_the_FIVE_outcome_keys_are_ALL_PRESENT_and_none_is_a_synonym(store, bars):
    """⛔ CONTROLLER RESOLUTION 5 PLUS CONTRACT 2. Only a KEY-SET assertion sees a
    fold: `evaluated == answered + dropped + not_computable` still closes if
    `not_computable` is added into `dropped` and the fifth key deleted."""
    bars["A"] = _daily_bars()
    out = scan_evaluator.evaluate_one(_definition(PRICE_TREE), TF,
                                      universe=["A"], as_of=SESSION)
    for key in ("evaluated", "answered", "dropped", "not_computable",
                "withheld", "withheld_reason", "dropped_symbols"):
        assert key in out, f"the envelope lost {key!r}"
    for key in scan_store.COVERAGE_KEYS:
        assert key in out, (
            f"the envelope and the STORE disagree about {key!r} — the receipt "
            "cannot be written from a result that does not carry its columns")


# ═══ 5. the preconditions ═══════════════════════════════════════════════════

def test_a_STALE_SNAPSHOT_refuses_the_whole_run_and_writes_NOTHING(store, bars):
    """🔴 M6. The scalars come out of `screener_rows`, so a stale snapshot is a
    screen answering on last month's fundamentals under today's date — and the
    positive control is sitting on the developer's disk (`C:\\data\\screener.db`,
    3,583 of 3,589 rows stamped 2026-07-11, a month stale)."""
    _snapshot({"AAPL": {"market_cap": 2e9}}, snapshot_date="2026-07-11")
    bars["AAPL"] = _daily_bars()
    d = _definition(SCALAR_TREE)

    with pytest.raises(scan_evaluator.ScanRunRefused) as exc:
        scan_evaluator.evaluate_one(d, TF, universe=["AAPL"], as_of=SESSION)
    assert exc.value.gate == "snapshot-stale"
    assert "2026-07-11" in exc.value.detail and "2026-08-07" in exc.value.detail

    handle = scan_definition.assert_scannable(d)["def_hash"]
    assert scan_store.coverage(handle, TF, SESSION) is None, (
        "a refused run left a receipt — a half-run that reads as 'we looked' is "
        "the one thing the three-state design exists to keep impossible")
    assert scan_store.hits(handle, TF, SESSION) == []


def test_the_SNAPSHOT_gate_does_NOT_fire_for_a_tree_that_reads_no_scalar(store, bars):
    """⚠️ THE OTHER HALF, AND IT IS WHAT MAKES THE GATE MEAN SOMETHING. A gate
    that refuses everything is not a gate. `close > 0` reads nothing out of
    `screener_rows`, so a month-old snapshot cannot make its answer wrong."""
    _snapshot({"AAPL": {"market_cap": 2e9}}, snapshot_date="2026-07-11")
    bars["AAPL"] = _daily_bars()
    out = scan_evaluator.evaluate_one(_definition(PRICE_TREE), TF,
                                      universe=["AAPL"], as_of=SESSION)
    assert out["hits"] == ["AAPL"] and out["snapshot_date"] is None


def test_ONE_fresh_row_does_NOT_make_a_MONTH_STALE_snapshot_current(store, bars):
    """🔴 MEASURED ON THIS BOX, AND IT IS WHY THE STATISTIC IS THE MEDIAN.

    `C:\\data\\screener.db` holds 3,589 rows: **3,583 stamped 2026-07-11, five
    stamped 2026-07-10, and exactly ONE stamped 2026-08-08.**
    `snapshot_db.status()` reports `MAX(snapshot_date)`, so the first version of
    this gate read "2026-08-08", called a month-stale snapshot current, and waved
    the whole universe through. GT §0.4's positive control was sitting on the disk
    and the gate walked straight past it.

    The median is a RANK statistic, not a tunable threshold: no number to pick, and
    it goes stale the moment half the universe stops rebuilding.
    """
    stale = {f"OLD{i:03d}": {"market_cap": 2e9} for i in range(20)}
    _snapshot(stale, snapshot_date="2026-07-11")
    _snapshot({"NEW": {"market_cap": 2e9}},
              snapshot_date=SESSION_DATE.isoformat())
    assert snapshot_db.status()["latest_snapshot_date"] == SESSION_DATE.isoformat()
    assert scan_evaluator._median_snapshot_date() == "2026-07-11"

    with pytest.raises(scan_evaluator.ScanRunRefused) as exc:
        scan_evaluator.evaluate_one(_definition(SCALAR_TREE), TF,
                                    universe=list(stale) + ["NEW"], as_of=SESSION)
    assert exc.value.gate == "snapshot-stale"
    assert "2026-07-11" in exc.value.detail


def test_a_SINGLE_symbol_left_behind_by_the_nightly_build_is_DROPPED(store, bars):
    """⛔ A CURRENT MEDIAN DOES NOT MAKE EVERY ROW CURRENT. The same argument as
    `stale-bars`, one column over: a symbol the build skipped keeps last month's
    fundamentals, and answering on them is a plausible, ranked, wrong answer for
    that symbol. Reported as `no-screener-row` — for THIS session there is none —
    with the stale date named, because `DROP_REASONS` is a closed set."""
    fresh = {f"OK{i:03d}": {"market_cap": 2e9} for i in range(20)}
    _snapshot(fresh)
    _snapshot({"LEFTBEHIND": {"market_cap": 2e9}}, snapshot_date="2026-07-11")
    for s in list(fresh) + ["LEFTBEHIND"]:
        bars[s] = _daily_bars()

    out = scan_evaluator.evaluate_one(_definition(SCALAR_TREE), TF,
                                      universe=list(fresh) + ["LEFTBEHIND"],
                                      as_of=SESSION)
    assert "LEFTBEHIND" not in out["hits"]
    listed = {d["ticker"]: d for d in out["dropped_symbols"]}
    assert listed["LEFTBEHIND"]["reason"] == "no-screener-row"
    assert "2026-07-11" in listed["LEFTBEHIND"]["detail"]
    assert out["answered"] == len(fresh) and out["dropped"] == 1


def test_a_snapshot_built_AFTER_the_session_is_current(store, bars):
    """⚠️ THE COMPARISON IS `>=`, NOT `==`, AND THAT IS NOT LAXITY. The builder
    stamps the CALENDAR DAY it ran; the sweep screens the last CONFIRMED session,
    which on a Monday is the previous Friday. An equality would refuse every
    correct Monday."""
    _snapshot({"AAPL": {"market_cap": 2e9}},
              snapshot_date=(SESSION_DATE + datetime.timedelta(days=3)).isoformat())
    bars["AAPL"] = _daily_bars()
    out = scan_evaluator.evaluate_one(_definition(SCALAR_TREE), TF,
                                      universe=["AAPL"], as_of=SESSION)
    assert out["hits"] == ["AAPL"]


def test_a_symbol_whose_bars_PREDATE_the_session_is_DROPPED_never_answered(store, bars):
    """🔴 M7. 99.0% of cap_universe has daily bars (3,704/3,742) but only 6 of
    those carry the store's own newest session, and `BARS_PREWARM_ENABLED`
    defaults to "0" with per-job failures entirely silent. A screen over stale
    bars returns a plausible, ranked, wrong answer."""
    behind = _daily_bars(n=40, end=SESSION_DATE - datetime.timedelta(days=5))
    bars["BEHIND"] = behind
    bars["CURRENT"] = _daily_bars(n=40)

    out = scan_evaluator.evaluate_one(_definition(PRICE_TREE), TF,
                                      universe=["BEHIND", "CURRENT"],
                                      as_of=SESSION)
    assert out["hits"] == ["CURRENT"]
    assert out["dropped"] == 1 and out["not_computable"] == 0
    entry = out["dropped_symbols"][0]
    assert entry["ticker"] == "BEHIND" and entry["reason"] == "stale-bars"
    assert scan_evaluator._bars_are_current(
        "BEHIND", [{"t": r[0]} for r in behind], SESSION) is False


def test_an_EMPTY_universe_refuses_rather_than_writing_an_empty_day(store, bars):
    """⛔ An empty hit list from an empty universe is indistinguishable from a
    quiet market, and `scan_coverage` would certify it."""
    with pytest.raises(scan_evaluator.ScanRunRefused) as exc:
        scan_evaluator.evaluate_one(_definition(PRICE_TREE), TF, universe=[],
                                    as_of=SESSION)
    assert exc.value.gate == "no-universe"


@pytest.mark.parametrize("definition,gate", [
    (None, "no-definition"),
    ({}, "no-definition"),
    ({"compute": {"kind": "native", "fn": "rsi"}}, "not-scannable"),
])
def test_every_RUN_GATE_that_can_refuse_a_definition_is_REACHABLE(
        store, definition, gate):
    """⚠️ A refusal nobody can reach is a comment. Each declared gate is driven."""
    with pytest.raises(scan_evaluator.ScanRunRefused) as exc:
        scan_evaluator.evaluate_one(definition, TF, universe=["A"], as_of=SESSION)
    assert exc.value.gate == gate
    assert gate in scan_evaluator.RUN_GATES


def test_a_REAL_VALUED_tree_is_refused_because_it_would_match_the_universe(store, bars):
    """⛔ `<tree> != 0` over a price column is true for every symbol trading above
    zero. This is the gate that stops a screen silently returning everything."""
    bars["A"] = _daily_bars()
    with pytest.raises(scan_evaluator.ScanRunRefused) as exc:
        scan_evaluator.evaluate_one(_definition(_series("close")), TF,
                                    universe=["A"], as_of=SESSION)
    assert exc.value.gate == "not-scannable"


# ═══ 6. the receipt ═════════════════════════════════════════════════════════

def test_the_RECEIPT_is_written_ONLY_after_the_loop_finishes(store, bars, monkeypatch):
    """🔴 M9. A half-run that left a receipt becomes indistinguishable from a
    quiet market — E-2's third reading, reached by an early write."""
    universe = [f"SYM{i:03d}" for i in range(5)]
    for s in universe:
        bars[s] = _daily_bars()
    d = _definition(PRICE_TREE)
    handle = scan_definition.assert_scannable(d)["def_hash"]

    calls = {"n": 0}
    real = ast_interpret.interpret

    def _boom(tree, bar_rows, *a, **k):
        calls["n"] += 1
        if calls["n"] == 3:
            raise ast_interpret.TableRefusal("interpret:node", "planted")
        return real(tree, bar_rows, *a, **k)

    monkeypatch.setattr(ast_interpret, "interpret", _boom)
    with pytest.raises(scan_evaluator.ScanRunRefused) as exc:
        scan_evaluator.evaluate_one(d, TF, universe=universe, as_of=SESSION)
    assert exc.value.gate == "not-scannable"
    assert calls["n"] == 3, "the run kept going after the table refused the tree"
    assert scan_store.coverage(handle, TF, SESSION) is None
    assert scan_store.hits(handle, TF, SESSION) == []


def test_a_TableRefusal_refuses_the_RUN_and_is_not_3742_quiet_drops(store, bars,
                                                                    monkeypatch):
    """⛔ A tree the table refuses is refused for EVERY symbol. Swallowing it per
    symbol turns one loud authoring error into a universe of quietly dropped rows
    — `record_pass` says the same thing in its own docstring."""
    universe = [f"SYM{i:03d}" for i in range(5)]
    for s in universe:
        bars[s] = _daily_bars()
    monkeypatch.setattr(ast_interpret, "interpret",
                        lambda *a, **k: (_ for _ in ()).throw(
                            ast_interpret.TableRefusal("interpret:node", "planted")))
    with pytest.raises(scan_evaluator.ScanRunRefused):
        scan_evaluator.evaluate_one(_definition(PRICE_TREE), TF,
                                    universe=universe, as_of=SESSION)


def test_dropped_symbols_is_CAPPED_and_the_CAP_IS_REPORTED_while_the_COUNTS_are_not(
        store, bars):
    """🔴 M10. An unbounded list inside a stored row is how a receipt becomes the
    thing that fills the disk — E-2 measured `scan_coverage` at 4,194 B/row with a
    41-symbol enumeration, ~10.6 GB/yr at 10k definitions."""
    universe = [f"GONE{i:04d}" for i in range(250)]        # every one: no bars
    d = _definition(PRICE_TREE)
    out = scan_evaluator.evaluate_one(d, TF, universe=universe, as_of=SESSION)

    assert out["dropped"] == 250, "the COUNT was capped — only the list may be"
    assert out["dropped_listed"] == scan_evaluator._DROPPED_LISTED_MAX
    assert len(out["dropped_symbols"]) == scan_evaluator._DROPPED_LISTED_MAX
    assert out["truncated"] is True

    handle = scan_definition.assert_scannable(d)["def_hash"]
    stored = scan_store.coverage(handle, TF, SESSION)
    assert stored["dropped"] == 250
    assert stored["dropped_listed"] == scan_evaluator._DROPPED_LISTED_MAX


def test_the_FRESHNESS_stored_is_the_TREES_verdict_and_never_the_default(store, bars):
    """🔴 E-2 CONCERN 3. `record_coverage(freshness=...)` defaults to `unknown`
    because the STORE never sees the tree. The sweep does. Without this the whole
    column reads `unknown` and the receipt says nothing about what it read."""
    _snapshot({"AAPL": {"market_cap": 2e9}})
    bars["AAPL"] = _daily_bars()
    d = _definition(SCALAR_TREE)
    out = scan_evaluator.evaluate_one(d, TF, universe=["AAPL"], as_of=SESSION)

    expected = ast_freshness.freshness_for(SCALAR_TREE)["mode"]
    assert expected != ast_freshness.UNKNOWN, "the fixture would prove nothing"
    assert out["freshness"] == expected
    handle = scan_definition.assert_scannable(d)["def_hash"]
    assert scan_store.coverage(handle, TF, SESSION)["freshness"] == expected


def test_the_CADENCE_CEILING_is_a_property_of_the_TREE_and_is_DERIVED(store, bars):
    """🔴 A TRUE NUMBER CARRYING A FALSE IMPLICATION.

    All 54 declared scalars are `cadence: nightly` out of `screener_rows` at
    `grain: date` (measured over the manifest 2026-08-09, unanimous). So a scan
    naming ANY scalar re-read an hour later returns the SAME answer off the SAME
    nightly snapshot — correct, and correctly badged `as-of-snapshot`, but a member
    watching it refresh reasonably infers new information arrived. A bars-only scan
    has no such ceiling: bars stream.

    ⛔ AND THE ANSWER IS READ OFF THE MANIFEST, NEVER HAND-LISTED. The expected
    value is `ast_table.scalar_cadence(...)` — the declaration itself — so this
    test cannot drift from it.
    """
    declared = ast_table.scalar_cadence("market_cap")
    assert scan_evaluator.cadence_ceiling(SCALAR_TREE) == declared
    assert scan_evaluator.cadence_ceiling(PRICE_TREE) is None, (
        "a bars-only tree was given a scalar's ceiling")

    _snapshot({"AAPL": {"market_cap": 2e9}})
    bars["AAPL"] = _daily_bars()
    out = scan_evaluator.evaluate_one(_definition(SCALAR_TREE), TF,
                                      universe=["AAPL"], as_of=SESSION)
    assert out["cadence"] == declared
    plain = scan_evaluator.evaluate_one(_definition(PRICE_TREE), TF,
                                        universe=["AAPL"], as_of=SESSION)
    assert plain["cadence"] is None


def test_a_PLANTED_cadence_reaches_the_ceiling_with_NO_EDIT_in_the_evaluator():
    """⚠️ THE DERIVATION'S CONTROL — E-2's M5/M5b asymmetry, one module over. A
    hand-list that AGREES with today's manifest is invisible to every behavioural
    test; only a planted declaration that DISAGREES can tell them apart."""
    def _plain(value):
        # ⚠️ THE MANIFEST IS FROZEN WITH `MappingProxyType`, AND `isinstance(proxy,
        # dict)` IS FALSE. `ast_freshness._declaration_is_readable` checks exactly
        # that, so a shallow copy leaves `as_of` a proxy and the whole scalar reads
        # as UNREADABLE — the plant would "work" by breaking the declaration
        # instead of changing it, which proves nothing.
        if hasattr(value, "keys"):
            return {k: _plain(v) for k, v in value.items()}
        return value

    table = _plain(ast_table.TABLE)
    table[ast_table.SCALARS_SECTION]["market_cap"]["cadence"] = \
        "hourly-in-this-test-only"

    assert scan_evaluator.cadence_ceiling(
        SCALAR_TREE, {"table": table}) == "hourly-in-this-test-only", (
        "the ceiling is hand-listed — a scalar declaring a different cadence "
        "would not move it")


def test_the_HITS_are_written_ONCE_and_REPLACE_the_prior_answer(store, bars):
    """⭐ E-2 CONCERN 2, honoured. `record_hits` REPLACES the set for a key
    deliberately — a bars correction must be able to REMOVE a hit — so the sweep
    accumulates in memory and calls it exactly once."""
    bars["A"] = _daily_bars()
    bars["B"] = _daily_bars()
    d = _definition(PRICE_TREE)
    handle = scan_definition.assert_scannable(d)["def_hash"]

    scan_evaluator.evaluate_one(d, TF, universe=["A", "B"], as_of=SESSION)
    assert scan_store.hits(handle, TF, SESSION) == ["A", "B"]

    # a correction removes B's bars entirely; the re-run must remove its hit
    del bars["B"]
    scan_evaluator.evaluate_one(d, TF, universe=["A", "B"], as_of=SESSION)
    assert scan_store.hits(handle, TF, SESSION) == ["A"], (
        "a superseded hit survived the re-run — scan_hits now disagrees with the "
        "receipt written beside it")

    fn = _function_node("evaluate_one")
    writes = [n for n in pyast.walk(fn)
              if isinstance(n, pyast.Call) and isinstance(n.func, pyast.Attribute)
              and n.func.attr == "record_hits"]
    assert len(writes) == 1, (
        "record_hits is called more than once — a chunked sweep must accumulate "
        "in memory, because the second call REPLACES the first's answer")


# ═══ 7. rev, and the rule record ════════════════════════════════════════════

def test_rev_is_READ_off_compute_and_is_NEITHER_invented_NOR_defaulted(store, bars):
    """🔴 M13. E-6's receipt is keyed on `rev`: returning 0 would certify work
    under the wrong maths, and D-A3's rev semantics would stop protecting an
    edited scan."""
    bars["A"] = _daily_bars()
    out = scan_evaluator.evaluate_one(_definition(PRICE_TREE, rev=7), TF,
                                      universe=["A"], as_of=SESSION)
    assert out["rev"] == 7

    hole = scan_evaluator.evaluate_one(_definition(PRICE_TREE, rev=None), TF,
                                       universe=["A"], as_of=SESSION)
    assert hole["rev"] is None, "a missing rev was defaulted rather than reported"
    assert hole["recorded"] == 0, (
        "a rule-record row was filed under a revision nobody declared")


def test_the_rule_record_PLANTS_its_origin_rather_than_BACKTESTING_the_past(
        store, bars):
    """🔴 CONTRACT 3, FIRST HALF — FORWARD-ONLY FROM THE FIRST SWEEP.

    On the first sweep there is no record, and closing "last month" would file a
    tally for sessions that ran before the definition existed. `definition_record`
    has *"no column that could hold a hypothetical"* and no business inferring
    one, so the first sweep plants a ONE-BAR row for the session it is actually
    looking at. That row is the origin; every later window starts strictly after
    it.
    """
    bars["A"] = _daily_bars(n=120)                 # ~4 months of history
    d = _definition(PRICE_TREE, rev=1)
    handle = scan_definition.assert_scannable(d)["def_hash"]

    out = scan_evaluator.evaluate_one(d, TF, universe=["A"], as_of=SESSION)
    assert out["recorded"] == 1
    row = definition_record.latest_evaluation(handle, 1, TF_LABEL, "A")
    assert row["first_bar_time"] == SESSION and row["through_bar_time"] == SESSION
    assert row["bars_evaluated"] == 1
    assert definition_record.origin(handle, 1) == SESSION, (
        "the record reaches back before the sweep that started it — that is a "
        "backtest wearing a receipt's clothes")

    # a second sweep of the SAME session is free and adds nothing
    again = scan_evaluator.evaluate_one(d, TF, universe=["A"], as_of=SESSION)
    assert again["recorded"] == 0


def test_the_rule_record_grain_is_MONTHLY_and_a_COMPLETED_month_is_ONE_row(
        store, bars):
    """🔴 CONTRACT 3, SECOND HALF — AND THE NUMBER IS E-6'S.

    241.9 B/row over 3,742 tickers makes a DAILY row per symbol per session 0.23
    GB/yr per definition and **114 GB/yr at 500** — Railway will not hold that
    past ~10. *"A row is a window with a tally, of any length"*, so a month of
    sessions is ONE row: 252 sessions -> 12 rows is **21x cheaper and answers
    every month-or-longer question identically.**
    """
    d = _definition(PRICE_TREE, rev=1)
    handle = scan_definition.assert_scannable(d)["def_hash"]

    # sweep 1: plant the origin mid-August
    plant_day = datetime.date(2026, 8, 10)
    bars["A"] = _daily_bars(n=200, end=plant_day)
    scan_evaluator.evaluate_one(d, TF, universe=["A"],
                                as_of=20260810)

    # sweep 2: the first sweep of September closes August, in ONE row
    sept = datetime.date(2026, 9, 2)
    bars["A"] = _daily_bars(n=200, end=sept)
    out = scan_evaluator.evaluate_one(d, TF, universe=["A"], as_of=20260902)
    assert out["recorded"] == 1, "a completed month must cost exactly one row"

    rows = _record_rows(handle, 1, TF_LABEL, "A")
    assert len(rows) == 2
    august = rows[-1]
    assert august["first_bar_time"] == 20260811, (
        "the closed month reaches back to or before the planted origin")
    assert august["through_bar_time"] == 20260831
    assert august["bars_evaluated"] == 21          # 11..31 August inclusive
    assert august["bars_true"] == 21

    # sweep 3: a LATER September sweep closes nothing — the month is still running
    sept2 = datetime.date(2026, 9, 15)
    bars["A"] = _daily_bars(n=200, end=sept2)
    again = scan_evaluator.evaluate_one(d, TF, universe=["A"], as_of=20260915)
    assert again["recorded"] == 0
    assert len(_record_rows(handle, 1, TF_LABEL, "A")) == 2, (
        "a second row landed inside one month — the grain has gone daily and the "
        "storage projection with it")


def test_the_MONTHLY_grain_is_21x_CHEAPER_and_the_ratio_is_DERIVED(store, bars):
    """⚠️ THE RATIO IS COUNTED OFF THE FIXTURE, NOT TYPED. A daily-grain writer
    would file one row per session in the closed window; a monthly one files one.
    The saving is the window's own length."""
    d = _definition(PRICE_TREE, rev=1)
    handle = scan_definition.assert_scannable(d)["def_hash"]
    bars["A"] = _daily_bars(n=200, end=datetime.date(2026, 8, 10))
    scan_evaluator.evaluate_one(d, TF, universe=["A"], as_of=20260810)
    bars["A"] = _daily_bars(n=200, end=datetime.date(2026, 9, 2))
    scan_evaluator.evaluate_one(d, TF, universe=["A"], as_of=20260902)

    august = _record_rows(handle, 1, TF_LABEL, "A")[-1]
    sessions_in_window = august["bars_evaluated"]
    rows_written = 1
    assert sessions_in_window / rows_written >= 20, (
        f"the monthly window folded only {sessions_in_window} sessions into "
        f"{rows_written} row(s) — the 21x saving E-6 measured is not being taken")


def test_a_RULE_RECORD_refusal_is_COUNTED_and_never_takes_the_RECEIPT_down(
        store, bars):
    """🔴 THE SECOND STORE MAY REFUSE; THE SCREEN'S ANSWER IS NOT ITS HOSTAGE.

    `definition_record` is forward-only from its origin and says so by raising.
    That is right — *"a record that can be extended backwards is a backtest
    wearing a receipt's clothes"* — but the sweep has already written its hits and
    its receipt by the time the record is offered a row, and letting the
    `ValueError` escape would turn a COMPLETED sweep into `coverage() is None`, i.e.
    a sweep that never happened. So the refusal is counted, named in the log, and
    reported.

    ⚠️ MEASURED, NOT IMAGINED: this fired on the first full-universe measurement
    run, when a second sweep was pointed at an EARLIER session than the one that
    planted the origin.
    """
    d = _definition(PRICE_TREE, rev=1)
    handle = scan_definition.assert_scannable(d)["def_hash"]
    bars["A"] = _daily_bars(n=60, end=datetime.date(2026, 9, 2))
    first = scan_evaluator.evaluate_one(d, TF, universe=["A"], as_of=20260902)
    assert first["recorded"] == 1 and definition_record.origin(handle, 1) == 20260902

    # ⛔ A SYMBOL WHOSE FIRST CURRENT SESSION IS OLDER THAN THE RECORD'S ORIGIN.
    # `B` only becomes readable at an EARLIER session, so planting it would reach
    # back before the record began.
    bars["B"] = _daily_bars(n=60, end=datetime.date(2026, 8, 20))
    out = scan_evaluator.evaluate_one(d, TF, universe=["B"], as_of=20260820)

    assert out["record_refused"] >= 1, (
        "the rule record accepted a window reaching back before its origin")
    assert out["recorded"] == 0
    assert out["answered"] == 1 and out["hits"] == ["B"]
    assert scan_store.coverage(handle, TF, 20260820) is not None, (
        "a rule-record refusal destroyed the SCREEN's receipt")


def _record_rows(def_hash, rev, tf_label, sym):
    import contextlib
    import sqlite3
    with contextlib.closing(sqlite3.connect(definition_record.db_path())) as c:
        c.row_factory = sqlite3.Row
        return [dict(r) for r in c.execute(
            f"SELECT * FROM {definition_record.TABLE_NAME} WHERE def_hash=? AND "
            "rev=? AND tf=? AND sym=? ORDER BY id", (def_hash, rev, tf_label, sym))]


def _record_row_count(def_hash, rev):
    import contextlib
    import sqlite3
    with contextlib.closing(sqlite3.connect(definition_record.db_path())) as c:
        return c.execute(
            f"SELECT COUNT(*) FROM {definition_record.TABLE_NAME} "
            "WHERE def_hash=? AND rev=?", (def_hash, rev)).fetchone()[0]


def test_the_SWEEP_writes_the_rule_record_in_ONE_TRANSACTION_not_one_per_row(
        store, bars, monkeypatch):
    """🔴 THE WIRE, NOT THE DOOR — this is the test that goes RED when the sweep
    stops using the batching door while that door stays perfectly correct.

    E-6's concern 2 sanctioned a batching door on `definition_record` and it
    landed measured at 156k rows/s -- but `_write_rule_record` went on looping
    the per-row door, so production sweeps still wrote at ~288 rows/s. *Built,
    tested, green, connected to nothing* (2026-08-08 audit). A unit test on
    `record_evaluations` cannot see that: it is green in both worlds. **So this
    counts CONNECTIONS opened during a real `evaluate_one`.** One batch is one
    `_connect()`; the per-row loop is one per row, because `_connect` re-runs
    `PRAGMA journal_mode=WAL` and the per-row door commits, per row.

    ⭐ AND IT CARRIES ITS OWN CONTROL. The same counter is pointed at the per-row
    spelling of the same writes and asserted to see N — so `== 1` is a
    measurement of batching, not of a probe that stopped counting.
    """
    d = _definition(PRICE_TREE, rev=1)
    handle = scan_definition.assert_scannable(d)["def_hash"]
    universe = ["A", "B", "C", "D"]
    for s in universe:
        bars[s] = _daily_bars()

    # the schema's own connection, taken OUT of the count rather than tolerated
    definition_record._ensure_init()

    connects: list = []
    real_connect = definition_record._connect

    def _counting_connect():
        connects.append(1)
        return real_connect()

    monkeypatch.setattr(definition_record, "_connect", _counting_connect)

    # ⛔ THE COUNT IS TAKEN AROUND THE WRITE SITE, NOT AROUND THE SWEEP. The
    # sweep also opens ONE connection to READ `latest_through_by_symbol` before
    # the loop; folding that into the number would make this assertion a
    # statement about two unrelated things, and it would move the day a second
    # read landed.
    seen: dict = {}
    real_write = scan_evaluator._write_rule_record

    def _spy(def_hash, rev, tf_label, rows):
        before = len(connects)
        out = real_write(def_hash, rev, tf_label, rows)
        seen["connects"] = len(connects) - before
        seen["rows"] = len(rows)
        return out

    monkeypatch.setattr(scan_evaluator, "_write_rule_record", _spy)

    out = scan_evaluator.evaluate_one(d, TF, universe=universe, as_of=SESSION)
    assert out["recorded"] == len(universe), (
        "the sweep did not write a row per symbol — `== 1` below would be a "
        "measurement of nothing being written")
    assert seen.get("rows") == len(universe), (
        "the sweep handed the write site a different number of rows than it "
        "recorded — this test is no longer measuring the sweep's own batch")
    assert seen["connects"] == 1, (
        f"the write site opened {seen['connects']} connections to write "
        f"{seen['rows']} rows — `_write_rule_record` is looping the per-row "
        f"door again and production sweeps are back at ~288 rows/s")

    # ⭐ THE CONTROL: the per-row spelling IS visible to this counter.
    connects.clear()
    for s in universe:
        definition_record.record_evaluation(handle, 2, TF_LABEL, s, SESSION,
                                            SESSION, bars_evaluated=1, bars_true=0)
    assert len(connects) == len(universe), (
        "the connection counter cannot see a per-row loop, so the assertion "
        "above proves nothing")


def test_the_rule_record_batch_is_ONE_TRANSACTION_so_a_crash_leaves_NO_PREFIX(
        store, bars, monkeypatch):
    """⚠️ THE BEHAVIOUR CHANGE, ASSERTED DELIBERATELY RATHER THAN DISCOVERED.

    The per-row door committed per row, so a process that died mid-sweep left a
    PREFIX of the rows on file. One batch is one transaction, so the same death
    leaves NOTHING. For an append-only receipt store that is the safer half of
    the trade -- the next sweep re-derives the same windows and `UNIQUE` makes
    the re-run free, whereas a half-written month sits there forever claiming a
    tally nobody computed -- but it IS a change, and it is asserted here so a
    future reader finds it stated rather than inferring it from a docstring.

    ⛔ THE CONTROL IS THE SAME BATCH WITHOUT THE FAULT. Without it, "zero rows"
    would also be satisfied by a batch that never ran.
    """
    import sqlite3

    d = _definition(PRICE_TREE, rev=1)
    handle = scan_definition.assert_scannable(d)["def_hash"]
    rows = [{"sym": s, "first": SESSION, "through": SESSION,
             "evaluated": 1, "true": 0} for s in ("A", "B", "C", "D", "E")]

    class _DiesPartWay:
        """A connection that fails on the 3rd INSERT — mid-batch, by construction."""

        def __init__(self, inner):
            self.inner = inner
            self.inserts = 0

        def execute(self, sql, *a):
            if sql.lstrip().upper().startswith("INSERT"):
                self.inserts += 1
                if self.inserts == 3:
                    raise sqlite3.OperationalError("disk I/O error")
            return self.inner.execute(sql, *a)

        def commit(self):
            return self.inner.commit()

        def close(self):
            return self.inner.close()

    definition_record._ensure_init()
    real_connect = definition_record._connect
    monkeypatch.setattr(definition_record, "_connect",
                        lambda: _DiesPartWay(real_connect()))

    with pytest.raises(sqlite3.OperationalError):
        scan_evaluator._write_rule_record(handle, 1, TF_LABEL, rows)
    assert _record_row_count(handle, 1) == 0, (
        "a crash mid-batch left a PREFIX of the sweep's rows on file — the "
        "transaction boundary this store depends on is gone")

    # ⭐ THE CONTROL: the same rows, no fault, all land.
    monkeypatch.setattr(definition_record, "_connect", real_connect)
    written, refused = scan_evaluator._write_rule_record(handle, 1, TF_LABEL, rows)
    assert (written, refused) == (len(rows), 0)
    assert _record_row_count(handle, 1) == len(rows)


def test_a_KEY_level_refusal_is_COUNTED_for_EVERY_row_and_is_NEVER_fatal(
        store, bars, caplog):
    """⛔ THE BATCHING DOOR RAISES ON A BAD KEY -- AND THE RECEIPT SURVIVES IT.

    `record_evaluations` returns per-ROW refusals but RAISES on a bad
    `def_hash`/`rev`/`tf`, deliberately: that is one problem, not N, and
    returning it N times would say N. The per-row loop this replaced caught the
    same `ValueError` once per row and reported `refused == len(rows)`, so this
    site keeps that arithmetic while logging the sentence ONCE -- because
    `_write_rule_record`'s contract to the sweep is that a refusal is *counted
    and named, never swallowed and never fatal*.
    """
    d = _definition(PRICE_TREE, rev=1)
    handle = scan_definition.assert_scannable(d)["def_hash"]
    rows = [{"sym": s, "first": SESSION, "through": SESSION,
             "evaluated": 1, "true": 0} for s in ("A", "B", "C")]

    with caplog.at_level("WARNING"):
        written, refused = scan_evaluator._write_rule_record(
            handle, 1, "not-a-timeframe-any-claim-can-name", rows)
    assert (written, refused) == (0, len(rows)), (
        "a key-level refusal was not counted against every row it refused")
    named = [r for r in caplog.records if "rule record refused" in r.getMessage()]
    assert len(named) == 1, (
        f"one problem was logged {len(named)} times — the per-row noise E-6's "
        f"door exists to avoid")
    assert definition_record.REFUSALS["timeframe"] in named[0].getMessage(), (
        "the refusal was counted but not NAMED — a number nobody can act on")

    # ⭐ THE CONTROL: the same rows under a timeframe a claim CAN name are written.
    assert scan_evaluator._write_rule_record(handle, 1, TF_LABEL, rows) == (3, 0)


def test_the_batched_through_read_answers_what_latest_evaluation_answers(store, bars):
    """⛔ ONE VALUE, ONE AUTHORITY. The batching door E-6's concern 2 sanctioned is
    a READ on that module, and it must agree with the per-symbol read it replaces
    — a second query shape that drifted would silently re-open every window."""
    d = _definition(PRICE_TREE, rev=1)
    handle = scan_definition.assert_scannable(d)["def_hash"]
    bars["A"] = _daily_bars()
    bars["B"] = _daily_bars()
    scan_evaluator.evaluate_one(d, TF, universe=["A", "B"], as_of=SESSION)

    batched = definition_record.latest_through_by_symbol(handle, 1, TF_LABEL)
    one_at_a_time = {
        s: definition_record.latest_evaluation(handle, 1, TF_LABEL, s)["through_bar_time"]
        for s in ("A", "B")}
    assert batched == one_at_a_time
    assert definition_record.latest_through_by_symbol(
        handle, 1, TF_LABEL) == batched
    assert definition_record.latest_through_by_symbol(
        "sha256:" + "f" * 64, 1, TF_LABEL) == {}, (
        "the batched read is not filtered by definition")


# ═══ 8. the sweep over many definitions ═════════════════════════════════════

def test_the_sweep_DEDUPES_by_MATHS_so_two_members_cost_ONE_evaluation(store, bars,
                                                                       monkeypatch,
                                                                       clock):
    """⭐ Two members who typed the same formula have the same maths, share one
    result set and cost the pod ONE sweep. That is the property that makes the
    store member-independent."""
    bars["A"] = _daily_bars()
    mine = _definition(PRICE_TREE, def_id="u_00000000000a")
    theirs = _definition(PRICE_TREE, def_id="u_00000000000b")
    other = _definition(_op("<", _series("close"), _num(0)))

    seen = []
    real = scan_evaluator.evaluate_one
    monkeypatch.setattr(scan_evaluator, "evaluate_one",
                        lambda d, *a, **k: (seen.append(d["id"]), real(d, *a, **k))[1])

    out = scan_evaluator.run_sweep([mine, theirs, other], TF, universe=["A"],
                                   as_of=SESSION)
    assert out["definitions"] == 3 and out["distinct"] == 2 and out["swept"] == 2
    assert seen == ["u_00000000000a", other["id"]]


def test_run_sweep_returns_NONE_rather_than_an_empty_day(store, clock):
    """⛔ `scan_gainers._build_reference` returns None on a provider miss *"so the
    job retries next request instead of caching an empty day"*. A `{}` here would
    be a run that happened and found nothing."""
    assert scan_evaluator.run_sweep([], TF, universe=["A"], as_of=SESSION) is None
    assert scan_evaluator.run_sweep([_definition(PRICE_TREE)], TF, universe=[],
                                    as_of=SESSION) is None


def test_a_REFUSED_definition_does_not_abort_the_rest_of_the_sweep(store, bars, clock):
    """One member's malformed formula is not the other members' outage."""
    bars["A"] = _daily_bars()
    good = _definition(PRICE_TREE)
    bad = {"schemaVersion": 1, "id": "u_00000000000c",
           "compute": {"kind": "native", "fn": "rsi"}}
    out = scan_evaluator.run_sweep([bad, good], TF, universe=["A"], as_of=SESSION)
    assert out["swept"] == 1 and out["refused"] == 1
    assert out["refusals"][0]["gate"] in scan_definition.GATES


# ═══ 9. the structural gates ════════════════════════════════════════════════

_CONCURRENCY_MODULES = frozenset({
    "threading", "multiprocessing", "concurrent", "concurrent.futures",
    "asyncio", "anyio", "numpy", "numpy.core", "_thread", "queue",
})
_CONCURRENCY_NAMES = frozenset({
    "ThreadPoolExecutor", "ProcessPoolExecutor", "Thread", "Process", "Pool",
    "to_thread", "run_in_executor", "gather", "spawn", "numpy", "np",
})


def _concurrency_census(source: str) -> set:
    """Every concurrency primitive IMPORTED or CALLED, by AST."""
    tree = pyast.parse(source)
    found: set = set()
    for node in pyast.walk(tree):
        if isinstance(node, pyast.Import):
            for a in node.names:
                root = a.name.split(".")[0]
                if a.name in _CONCURRENCY_MODULES or root in _CONCURRENCY_MODULES:
                    found.add(a.name)
        elif isinstance(node, pyast.ImportFrom):
            mod = node.module or ""
            root = mod.split(".")[0]
            if mod in _CONCURRENCY_MODULES or root in _CONCURRENCY_MODULES:
                found.add(mod)
            for a in node.names:
                if a.name in _CONCURRENCY_NAMES:
                    found.add(f"{mod}.{a.name}")
        elif isinstance(node, pyast.Call):
            fn = node.func
            name = (fn.id if isinstance(fn, pyast.Name)
                    else fn.attr if isinstance(fn, pyast.Attribute) else None)
            if name in _CONCURRENCY_NAMES:
                found.add(name)
    return found


def test_the_evaluator_imports_no_concurrency_primitive__BY_AST():
    """⛔ AST, NEVER GREP. This module's own docstring says 'ThreadPool' four
    times; a grep counts comments and has done so in BOTH directions on this
    branch. The census reads `ast.Import`/`ast.ImportFrom`/`ast.Call` nodes."""
    found = _concurrency_census(MODULE_PATH.read_text(encoding="utf-8"))
    assert found == set(), (
        f"scan_evaluator reaches {sorted(found)}. MEASURED: threads buy x1.00 at "
        "4 workers and are NEGATIVE at 8 and 16, because the 1e-9 cross-lane "
        "guarantee is what makes the interpreter GIL-bound.")


def test_the_concurrency_census_can_actually_FIND_a_thread_pool():
    """⚠️ THE POSITIVE CONTROL. Without it the assertion above is satisfied by a
    census that walks nothing (`lesson_test_that_passes_vacuously`)."""
    planted = ("from concurrent.futures import ThreadPoolExecutor\n"
               "def f(xs):\n"
               "    with ThreadPoolExecutor(max_workers=8) as pool:\n"
               "        return list(pool.map(str, xs))\n")
    assert _concurrency_census(planted), "the census is blind to a real thread pool"
    # and the docstring text alone must NOT trip it
    prose = '"""ThreadPoolExecutor( 8) 981 ms speedup x0.62."""\n'
    assert _concurrency_census(prose) == set(), (
        "the census counts prose — it is a grep wearing an AST's clothes")


def test_the_ban_still_CARRIES_ITS_MEASURED_REASON():
    """⛔ M2. A ban whose rationale has been deleted is a ban the next agent
    lifts. The docstring must still carry the three measured speedups; if the
    measurement is re-taken and moves, this goes red and somebody has to look."""
    doc = scan_evaluator.__doc__ or ""
    assert re.findall(r"speedup x([0-9.]+)", doc) == ["1.00", "0.62", "0.55"], (
        "the measured speedups have left the docstring — the reason the sweep is "
        "sequential is now folklore")
    assert "GIL" in doc and "1e-9" in doc


def test_the_sweep_states_that_a_member_request_never_triggers_it():
    doc = scan_evaluator.__doc__ or ""
    assert "OFF THE\nREQUEST PATH" in doc or "OFF THE REQUEST PATH" in doc


def _function_node(name: str):
    tree = pyast.parse(MODULE_PATH.read_text(encoding="utf-8"))
    for node in pyast.walk(tree):
        if isinstance(node, (pyast.FunctionDef, pyast.AsyncFunctionDef)) \
                and node.name == name:
            return node
    raise AssertionError(f"{name} is no longer defined in {MODULE_PATH.name}")


def test_no_per_symbol_exception_is_SWALLOWED__BY_AST():
    """🔴 M3's structural half. `bars_prewarm._warm_one` is the counter-example:
    `except Exception: pass`, into NEITHER bucket, never printed."""
    fn = _function_node("evaluate_one")
    for handler in [n for n in pyast.walk(fn) if isinstance(n, pyast.ExceptHandler)]:
        body = [s for s in handler.body if not isinstance(s, pyast.Expr)
                or not isinstance(s.value, pyast.Constant)]
        assert body and not all(isinstance(s, pyast.Pass) for s in body), (
            "an except handler in the sweep swallows its symbol")


def test_the_sweep_hour_lives_in_exactly_ONE_place():
    """⏳ OWNER, design §8.5. A constant with two authorities is a schedule with
    two authorities (`lesson_probe_names_must_be_derived_not_typed`'s sibling)."""
    import api.main as main_mod
    source = pathlib.Path(main_mod.__file__).read_text(encoding="utf-8")
    assert "SWEEP_HOUR_ET" in source, "main.py no longer reads the declared hour"
    tree = pyast.parse(MODULE_PATH.read_text(encoding="utf-8"))
    assigns = [n for n in tree.body if isinstance(n, pyast.Assign)
               and any(isinstance(t, pyast.Name) and t.id == "SWEEP_HOUR_ET"
                       for t in n.targets)]
    assert len(assigns) == 1


# ═══ 10. the scheduler ══════════════════════════════════════════════════════

def _cron_hour(trigger) -> int:
    """The hour a CronTrigger fires, READ OFF THE TRIGGER rather than off the
    call that built it — the object is the artifact the scheduler will use."""
    for field in trigger.fields:
        if field.name == "hour":
            return int(str(field))
    raise AssertionError("the trigger declares no hour")


class _FakeScheduler:
    def __init__(self):
        self.jobs = []

    def add_job(self, fn, trigger=None, id=None, max_instances=None, **kw):
        self.jobs.append({"fn": fn, "trigger": trigger, "id": id,
                          "max_instances": max_instances, **kw})


def test_the_scan_sweep_is_its_OWN_job_at_a_LATER_hour_and_not_chained_to_run_build(
        monkeypatch):
    """🔴 M11. Two reasons, each measured. `run_build` is capped at
    SCREENER_SNAPSHOT_MAX_PER_RUN = 4000 and its DURATION IS NOT MEASURED
    ANYWHERE, so chaining puts an unmeasured job behind an unmeasured job in ONE
    `max_instances=1` slot. And the sweep's own precondition is that the snapshot
    is CURRENT, which it cannot assert about a build it is running inside.
    """
    import api.main as main_mod

    monkeypatch.setenv("SCREENER_SNAPSHOT_ENABLED", "1")
    monkeypatch.setenv("SCAN_SWEEP_ENABLED", "1")
    monkeypatch.setattr(main_mod, "start_screener_snapshot_warm", lambda: None)
    sched = _FakeScheduler()
    assert main_mod.register_screener_jobs(sched) is True

    by_id = {j["id"]: j for j in sched.jobs}
    assert "screener_snapshot_nightly" in by_id
    assert "screener_scan_sweep" in by_id, (
        "the sweep was chained into the snapshot build instead of registering "
        "its own job")
    snap, sweep = by_id["screener_snapshot_nightly"], by_id["screener_scan_sweep"]
    assert sweep["max_instances"] == 1
    snap_hour, sweep_hour = _cron_hour(snap["trigger"]), _cron_hour(sweep["trigger"])
    assert sweep_hour != snap_hour, f"both jobs run at hour {snap_hour}"
    assert sweep_hour == scan_evaluator.SWEEP_HOUR_ET, (
        "the schedule retyped the hour instead of reading the declared constant")
    assert sweep_hour > snap_hour, "the sweep runs BEFORE the snapshot it depends on"
    assert sweep["fn"] is not snap["fn"]


def test_the_scan_sweep_job_is_OFF_by_default(monkeypatch):
    """The sweep's code default stays OFF (=1 on Railway): a bare local run
    must never spend the night sweeping. E-4 IS wired (Wave 4) — the old
    'no surface reads these rows' rationale is gone; the default-off contract
    is about LOCAL honesty now. ⛔ This test pins the SWEEP's absence, not the
    whole registry — asserting the exact job list was the count-beside-list
    defect: Wave 2's three default-ON source jobs (finviz/edates/insider)
    turned it red for weeks while every scoped gate looked elsewhere."""
    import api.main as main_mod
    monkeypatch.delenv("SCAN_SWEEP_ENABLED", raising=False)
    monkeypatch.setattr(main_mod, "start_screener_snapshot_warm", lambda: None)
    sched = _FakeScheduler()
    main_mod.register_screener_jobs(sched)
    ids = [j["id"] for j in sched.jobs]
    assert "screener_scan_sweep" not in ids
    assert "screener_snapshot_nightly" in ids


def test_the_job_reads_the_ARTIFACT_back_rather_than_trusting_its_return_value(
        store, bars, monkeypatch, caplog, clock):
    """🔇⏰ `lesson_scheduler_job_return_value_goes_nowhere`: APScheduler discards
    what a job returns and silence reads as success. The success criterion is a
    `scan_coverage` row existing for today's `as_of`, READ BACK."""
    bars["A"] = _daily_bars()
    monkeypatch.setattr(scan_evaluator, "definitions_to_sweep",
                        lambda: [_definition(PRICE_TREE)])
    monkeypatch.setattr(scan_evaluator.snapshot_builder, "_load_universe",
                        lambda: ["A"])
    monkeypatch.setattr(scan_evaluator, "expected_session", lambda: SESSION)
    with caplog.at_level("INFO"):
        scan_evaluator.sweep_job()
    assert any("receipts read back: 1 of 1" in r.message for r in caplog.records), (
        "the job reported success without reading a single receipt back")

    fn = _function_node("sweep_job")
    attrs = {n.func.attr for n in pyast.walk(fn)
             if isinstance(n, pyast.Call) and isinstance(n.func, pyast.Attribute)}
    assert "coverage" in attrs


# ═══ 11. the contract symbols ═══════════════════════════════════════════════

_CONTRACT = (
    (ast_interpret, "unresolved_scalars"),
    (ast_interpret, "interpret"),
    (ast_interpret, "max_lookback"),
    (ast_interpret, "TableRefusal"),
    (ast_freshness, "freshness_for"),
    (ast_freshness, "FRESHNESS_MODES"),
    (ast_table, "scalar_source"),
    (scan_definition, "assert_scannable"),
    (scan_definition, "ScanRefused"),
    (scan_store, "record_hits"),
    (scan_store, "record_coverage"),
    (scan_store, "coverage"),
    (scan_store, "COVERAGE_KEYS"),
    (snapshot_db, "get_rows"),
    (snapshot_db, "status"),
    # ⛔ THE **PLURAL** DOOR. `_write_rule_record` switched to the batching
    # spelling on 2026-08-09; naming the singular here would leave this rail
    # watching a symbol the sweep no longer takes — green while the one it
    # actually depends on moved.
    (definition_record, "record_evaluations"),
    (definition_record, "REFUSALS"),
    (definition_record, "latest_through_by_symbol"),
    (ledger, "_BARS_STORE_TF_KEYS"),
    (ledger, "_normalize_bar_time"),
    (user_definitions, "live_definitions"),
)


@pytest.mark.parametrize("module,symbol", _CONTRACT)
def test_every_symbol_taken_ON_CONTRACT_exists_and_fails_BY_NAME_if_it_moved(
        module, symbol):
    """⚠️ Two of these are PRIVATE attributes carrying no compatibility promise,
    which is exactly why they are asserted rather than assumed."""
    assert hasattr(module, symbol), (
        f"{module.__name__}.{symbol} is gone — scan_evaluator takes it on contract")


def test_the_scalar_to_COLUMN_map_is_read_off_the_MANIFEST_not_assumed():
    """⛔ NOT `name == column`. `ast_table.scalar_source` is the declaration; a
    scalar renamed on one side of that map and not the other is the
    two-vocabularies defect this lane has already paid for twice."""
    names = sorted(ast_table.scalar_names())
    assert names, "the manifest declares no scalars — the probe would be vacuous"
    mapped = scan_evaluator._scalar_columns(names)
    assert set(mapped) == set(names)
    for name, column in mapped.items():
        assert column in snapshot_db.COLUMNS, (
            f"the manifest points `{name}` at `screener_rows.{column}`, which "
            "that table does not have")
    # the positive control: a name the manifest never declared maps to nothing
    assert scan_evaluator._scalar_columns(["not_a_scalar_anybody_declared"]) == {}


def test_the_sweep_reads_the_scalars_ASSERT_SCANNABLE_handed_it(store, bars):
    """⭐ E-2 CONCERN 4. `assert_scannable` returns the tree's declared scalars;
    deriving them a second way here would be a second authority over which
    snapshot columns the sweep must carry."""
    fn = _function_node("evaluate_one")
    source = pyast.unparse(fn)
    assert "_scalar_columns(spec['scalars'])" in source


# ═══ 12. the wall-clock budget ══════════════════════════════════════════════
#
# 🔴 `SWEEP-DURATION`, the performance audit's own words: *"`max_instances=1`
# prevents OVERLAP but not OVERRUN."* Re-measured 2026-08-09, one definition is
# 25-70 s and 500 of them run straight through the market open. What follows is
# the pair the risk needs and neither half is optional: a budget that fires, and
# a budget that does NOT fire on a normal night. A bound that always trips is a
# broken sweep, not a bounded one.


def _at(hour, minute=0, day=SESSION_DATE):
    return datetime.datetime(day.year, day.month, day.day, hour, minute,
                             tzinfo=scan_evaluator._ET)


def _two_definitions():
    return (_definition(PRICE_TREE, def_id="u_00000000000a"),
            _definition(_op("<", _series("close"), _num(0)),
                        def_id="u_00000000000b"))


def test_the_BUDGET_FIRES_and_the_receipt_NAMES_what_went_UNSWEPT(
        store, bars, clock, caplog):
    """🔴 THE GATE. A deadline already in the past must stop the sweep — and
    stopping must be REPORTED, never silent.

    *"A sweep that quietly evaluated 40 of 500 definitions and wrote confident
    receipts for the rest is the exact defect class this phase exists to
    remove."* So three things are asserted together: nothing was swept, the
    definitions are NAMED, and the shared store carries NO receipt for them —
    `coverage(...) is None` is E-2's "nobody looked", which is the truth.
    """
    bars["A"] = _daily_bars()
    first, second = _two_definitions()

    with caplog.at_level("INFO"):
        out = scan_evaluator.run_sweep([first, second], TF, universe=["A"],
                                       as_of=SESSION,
                                       deadline=_at(4))     # an hour ago

    assert out["stopped_early"] is True
    assert out["swept"] == 0
    assert out["unswept"] == 2
    assert out["unswept_reason"] == scan_evaluator.UNSWEPT_REASON
    assert len(out["unswept_definitions"]) == 2, "the receipt named nobody"

    # ⛔ NAMED BY THE SAME HANDLE THE STORE KEYS ON, so "which ones" is
    # answerable against the artifact rather than by eye.
    for handle in out["unswept_definitions"]:
        assert scan_store.coverage(handle, TF, SESSION) is None, (
            "a definition the sweep never reached carries a receipt — a "
            "confident answer for work that never happened")
        assert scan_store.hits(handle, TF, SESSION) == []

    assert any("STOPPED EARLY" in r.message for r in caplog.records), (
        "the sweep truncated in silence")


def test_the_budget_does_NOT_fire_on_a_NORMAL_run__THE_CONTROL(
        store, bars, clock, caplog):
    """🔴 THE CONTROL, AND IT IS HALF THE GATE. A budget that always trips is a
    broken sweep wearing a bound's clothes (`lesson_gate_that_cannot_fail`, the
    other way round).

    ⭐ NO `deadline=` IS PASSED — this runs the REAL derivation off the frozen
    clock, so it proves the production default gives a 05:00 sweep room to work.
    """
    bars["A"] = _daily_bars()
    first, second = _two_definitions()

    with caplog.at_level("INFO"):
        out = scan_evaluator.run_sweep([first, second], TF, universe=["A"],
                                       as_of=SESSION)

    assert out["stopped_early"] is False
    assert out["swept"] == 2 and out["unswept"] == 0
    assert out["unswept_definitions"] == [] and out["unswept_reason"] is None
    assert not any("STOPPED EARLY" in r.message for r in caplog.records)
    assert scan_evaluator.sweep_deadline(clock) > clock, (
        "the sweep's own scheduled hour is already past its deadline")


def test_the_budget_cuts_BETWEEN_definitions_and_NEVER_INSIDE_one(
        store, bars, monkeypatch):
    """🔴 THE SHARPEST CONSTRAINT. A mid-definition abort writes a
    `scan_coverage` row describing a PARTIAL universe as though it were
    complete — indistinguishable from a quiet market, which is the one reading
    E-2's three-state design exists to keep impossible.

    The clock advances past the deadline WHILE the first definition runs. The
    first must still finish and its receipt must describe the WHOLE universe;
    the second must not start at all.
    """
    universe = [f"SYM{i:02d}" for i in range(12)]
    for s in universe:
        bars[s] = _daily_bars()
    first, second = _two_definitions()
    deadline = _at(6)

    # ⚠️ THE READS ARE COUNTED, NOT GUESSED. `run_sweep` reads the clock to stamp
    # its start BEFORE the loop's first check, so a two-element script would have
    # spent its "before" reading on the stamp and stopped at definition one —
    # measured, and it is `lesson_a_half_faked_clock_manufactures_false_positives`
    # in miniature.
    readings = {"n": 0}

    def _tick():
        readings["n"] += 1
        return _at(5) if readings["n"] <= 2 else _at(7)

    monkeypatch.setattr(scan_evaluator, "_now_et", _tick)

    out = scan_evaluator.run_sweep([first, second], TF, universe=universe,
                                   as_of=SESSION, deadline=deadline)

    assert out["swept"] == 1 and out["unswept"] == 1 and out["stopped_early"]
    swept_handle = scan_definition.assert_scannable(first)["def_hash"]
    receipt = scan_store.coverage(swept_handle, TF, SESSION)
    assert receipt is not None
    assert receipt["evaluated"] == len(universe), (
        "the definition that was running when the clock ran out wrote a "
        "PARTIAL universe into a complete-looking receipt")
    assert receipt["evaluated"] == (receipt["answered"] + receipt["dropped"]
                                    + receipt["not_computable"])


def test_NOTHING_inside_evaluate_one_READS_THE_CLOCK__BY_AST():
    """⛔ THE STRUCTURAL HALF OF THE RULE ABOVE. The behavioural test can only
    catch the cut it was given; this catches a clock read appearing ANYWHERE
    inside the per-definition work, which is how a mid-definition abort would
    arrive later."""
    inner = _function_node("evaluate_one")
    names = {n.id for n in pyast.walk(inner) if isinstance(n, pyast.Name)}
    for banned in ("_now_et", "sweep_deadline", "SWEEP_STOP_BEFORE_OPEN"):
        assert banned not in names, (
            f"`evaluate_one` reads {banned} — the budget belongs to `run_sweep`, "
            "which is the only thing that knows how long the SWEEP has run")
    outer = _function_node("run_sweep")
    outer_names = {n.id for n in pyast.walk(outer) if isinstance(n, pyast.Name)}
    assert "_now_et" in outer_names, (
        "the control: `run_sweep` must read the clock, or the probe above is "
        "asserting the absence of something nobody uses")


def test_the_SWEEP_ARITHMETIC_CLOSES_and_the_assertion_can_actually_FAIL():
    """🔴 THE GUARD ON THE BUDGET ITSELF. A `break` that forgot to record what it
    broke out of leaves a receipt saying 200 swept of 500 handed with no fourth
    number — which reads as 300 vanished, or as "there were only 200"."""
    scan_evaluator._assert_sweep_closes(handed=5, swept=2, refused=1,
                                        duplicate=1, unswept=1)
    with pytest.raises(AssertionError) as exc:
        scan_evaluator._assert_sweep_closes(handed=5, swept=2, refused=1,
                                            duplicate=1, unswept=0)
    for field in ("handed=5", "swept=2", "refused=1", "duplicate=1", "unswept=0"):
        assert field in str(exc.value), f"the failure did not name {field}"


def test_the_sweep_identity_IS_CALLED_FROM_INSIDE_run_sweep__BY_AST():
    """⛔ AN IDENTITY ASSERTED ONLY IN A TEST IS A TEST, NOT A GUARD. The one
    above proves the arithmetic; this proves the SWEEP performs it about itself,
    on every run, including the ones no test drives. Same shape as
    `test_the_closed_identity_IS_CALLED_FROM_INSIDE_evaluate_one__BY_AST`."""
    fn = _function_node("run_sweep")
    called = {n.func.id for n in pyast.walk(fn)
              if isinstance(n, pyast.Call) and isinstance(n.func, pyast.Name)}
    assert "_assert_sweep_closes" in called, (
        "`run_sweep` no longer asserts its own arithmetic — a budget that "
        "dropped definitions on the floor would look like a shorter list")


def test_every_definition_HANDED_IN_is_accounted_for_by_the_RECEIPT(
        store, bars, clock):
    """⭐ THE IDENTITY, DRIVEN. One good, one duplicate of it, one malformed, and
    a budget that stops before the rest — every bucket non-zero at once, which is
    the only arrangement that can catch a fold between two of them."""
    bars["A"] = _daily_bars()
    good = _definition(PRICE_TREE, def_id="u_00000000000a")
    same = _definition(PRICE_TREE, def_id="u_00000000000b")     # same maths
    bad = {"schemaVersion": 1, "id": "u_00000000000c",
           "compute": {"kind": "native", "fn": "rsi"}}
    other = _definition(_op("<", _series("close"), _num(0)))

    out = scan_evaluator.run_sweep([good, same, bad, other], TF, universe=["A"],
                                   as_of=SESSION, deadline=_at(4))
    assert out["definitions"] == 4
    assert out["refused"] == 1 and out["duplicate"] == 1
    assert out["swept"] == 0 and out["unswept"] == 2
    assert (out["swept"] + out["refused"] + out["duplicate"] + out["unswept"]
            == out["definitions"])


# ─── the deadline is DERIVED from the open ───────────────────────────────────

def test_the_MARKET_OPEN_is_read_off_the_BARS_STORES_OWN_ANCHOR():
    """⭐ THE POSITIVE HALF. The repo's canonical session anchor says 9:30-9:59
    ET buckets at 9:30 and everything else floors to the clock hour, so the open
    is the one bucket in the day that is not a clock hour — and DST comes free."""
    assert scan_evaluator.market_open_et(SESSION_DATE) == _at(9, 30)
    winter = datetime.date(2026, 1, 15)
    assert scan_evaluator.market_open_et(winter) == _at(9, 30, day=winter)
    assert scan_evaluator.market_open_et(winter).utcoffset() != \
        scan_evaluator.market_open_et(SESSION_DATE).utcoffset(), (
        "both dates report the same UTC offset — the derivation is not going "
        "through a real timezone and a DST change would move the deadline")


def test_a_PLANTED_OPEN_moves_the_DEADLINE_with_NO_EDIT_in_the_evaluator(
        monkeypatch):
    """🔴 THE CONTROL THAT SEPARATES A DERIVATION FROM A LITERAL, and it is the
    only test that can. A hand-typed `09:30` agrees with the anchor function in
    every behavioural test ever written — E-2's M5/M5b asymmetry, and E-3 hit the
    same wall with the cadence ceiling. So the ANCHOR is moved to 10:15 and the
    deadline must follow it.
    """
    from api.services import bars_fetch

    def _planted(t_utc):
        dt = datetime.datetime.fromtimestamp(t_utc, tz=scan_evaluator._ET)
        if dt.hour == 10 and dt.minute >= 15:
            return int(dt.replace(minute=15, second=0, microsecond=0).timestamp())
        return int(dt.replace(minute=0, second=0, microsecond=0).timestamp())

    monkeypatch.setattr(bars_fetch, "bucket_60_et_unix_seconds", _planted)
    assert scan_evaluator.market_open_et(SESSION_DATE) == _at(10, 15)
    assert scan_evaluator.sweep_deadline(_at(5)) == (
        _at(10, 15) - scan_evaluator.SWEEP_STOP_BEFORE_OPEN)


def test_the_open_derivation_REFUSES_rather_than_guessing_when_it_vanishes(
        monkeypatch):
    """⛔ A BUDGET THAT FELL BACK TO A TYPED 09:30 WOULD BE THE SECOND AUTHORITY
    the derivation exists to avoid — and it would fail SILENTLY, which is worse
    than not being bounded at all."""
    from api.services import bars_fetch
    monkeypatch.setattr(
        bars_fetch, "bucket_60_et_unix_seconds",
        lambda t: int(datetime.datetime.fromtimestamp(t, tz=scan_evaluator._ET)
                      .replace(minute=0, second=0, microsecond=0).timestamp()))
    with pytest.raises(RuntimeError) as exc:
        scan_evaluator.market_open_et(SESSION_DATE)
    assert "session open" in str(exc.value)


def test_the_DEADLINE_is_the_OPEN_minus_the_ONLY_number_the_budget_declares():
    """⛔ ONE NUMBER, ONE PLACE. The margin is declared; the open is not."""
    open_et = scan_evaluator.market_open_et(SESSION_DATE)
    deadline = scan_evaluator.sweep_deadline(_at(5))
    assert deadline == open_et - scan_evaluator.SWEEP_STOP_BEFORE_OPEN

    # 🔴 AND THE MARGIN IS CHECKED AGAINST SOMETHING OTHER THAN ITSELF. The line
    # above is a TAUTOLOGY under a mutation of the constant — both sides move
    # together — and a margin of ZERO SURVIVED the gauntlet on it, measured. That
    # is `lesson_test_that_passes_vacuously` in its quietest form: an assertion
    # that reads the value it is supposed to be pinning.
    #
    # The requirement was never "the deadline is the open minus the margin". It is
    # "the sweep STOPS BEFORE the open", and the margin must absorb the ONE
    # definition the sweep may still be inside when the clock runs out.
    assert deadline < open_et, (
        "the sweep may still be STARTING definitions at the moment the market "
        "opens — a zero margin is not a margin")
    worst_case_definition_seconds = 70      # 42.4 s compute + 19-26 s of writes,
    assert (scan_evaluator.SWEEP_STOP_BEFORE_OPEN.total_seconds()             # noqa
            >= worst_case_definition_seconds), (
        "the margin is smaller than the worst-case single definition measured on "
        "this box, so the sweep can overrun the open by starting one definition "
        "one second before the deadline")
    tree = pyast.parse(MODULE_PATH.read_text(encoding="utf-8"))
    assigns = [n for n in tree.body if isinstance(n, pyast.Assign)
               and any(isinstance(t, pyast.Name) and t.id == "SWEEP_STOP_BEFORE_OPEN"
                       for t in n.targets)]
    assert len(assigns) == 1, "the margin acquired a second authority"

    # ⛔ AND NO CLOCK-TIME LITERAL HIDES IN THE FUNCTIONS THAT DERIVE THE OPEN.
    for name in ("market_open_et", "sweep_deadline"):
        consts = {n.value for n in pyast.walk(_function_node(name))
                  if isinstance(n, pyast.Constant) and isinstance(n.value, int)}
        assert not ({9, 30, 930, 570} & consts), (
            f"`{name}` carries a clock-time literal — the open was typed after "
            "all, beside the function that derives it")


def test_the_SCHEDULED_hour_falls_INSIDE_its_own_budget_window():
    """⭐ THE FOOTGUN RAIL. The deadline is TODAY's open minus the margin, so a
    schedule moved past it would produce a sweep that can never run — 0 swept,
    everything unswept, every night, and the WARNING would be the only sign.
    The two constants are checked against each other rather than assumed."""
    scheduled = _at(scan_evaluator.SWEEP_HOUR_ET, scan_evaluator.SWEEP_MINUTE_ET)
    assert scheduled < scan_evaluator.sweep_deadline(scheduled), (
        f"the sweep is scheduled at {scheduled.isoformat()} and its budget "
        f"expires at {scan_evaluator.sweep_deadline(scheduled).isoformat()} — "
        "it could never sweep a single definition")


def test_a_run_STARTED_AFTER_THE_OPEN_is_already_out_of_budget():
    """⭐ THE DEADLINE IS TODAY'S OPEN, NOT THE NEXT ONE. Rolling it forward for
    a run that began at 10:00 would hand a sweep already running through the
    session another twenty-three hours — bounding the clock while losing the
    thing the bound is FOR."""
    assert scan_evaluator.sweep_deadline(_at(10)) < _at(10)
    assert scan_evaluator.sweep_deadline(_at(5)) > _at(5)


# ─── fairness: the tail of the last run leads the next one ───────────────────

def test_the_TAIL_the_last_run_NEVER_REACHED_LEADS_the_next_one(store, bars,
                                                                clock, monkeypatch):
    """🔴 FAIRNESS. If the budget always cuts at the same point the same tail is
    never swept — and every night's receipt still looks like a healthy partial,
    so nothing would say so.

    ⭐ THE RESUME POINT IS THE ARTIFACT, NOT A CURSOR: `first` carries a receipt
    for the PREVIOUS session and `second` does not, so `second` leads. No stored
    state, nothing to lose on a redeploy, and it cannot disagree with what
    actually happened.
    """
    bars["A"] = _daily_bars()
    first, second = _two_definitions()
    handle = scan_definition.assert_scannable(first)["def_hash"]
    prev = scan_evaluator.previous_session(SESSION)
    assert prev is not None and prev < SESSION
    scan_store.record_coverage(handle, TF, prev, evaluated=1, answered=1,
                               dropped=0, not_computable=0, dropped_symbols=[],
                               freshness="as-of-snapshot")

    order = []
    real = scan_evaluator.evaluate_one
    monkeypatch.setattr(scan_evaluator, "evaluate_one",
                        lambda d, *a, **k: (order.append(d["id"]), real(d, *a, **k))[1])
    scan_evaluator.run_sweep([first, second], TF, universe=["A"], as_of=SESSION)

    assert order == [second["id"], first["id"]], (
        "the definition the last run already swept went first again — the tail "
        "starves")


def test_the_resume_order_is_the_IDENTITY_when_the_last_run_reached_NOBODY(
        store, bars, clock, monkeypatch):
    """⛔ THE CONTROL. It reorders on ONE bit and nothing else — no sort, no
    sample, no shuffle. `apply_symbol_cap` refuses the same thing in E-7's words:
    *'the order is the caller's'*."""
    bars["A"] = _daily_bars()
    first, second = _two_definitions()
    order = []
    real = scan_evaluator.evaluate_one
    monkeypatch.setattr(scan_evaluator, "evaluate_one",
                        lambda d, *a, **k: (order.append(d["id"]), real(d, *a, **k))[1])
    scan_evaluator.run_sweep([first, second], TF, universe=["A"], as_of=SESSION)
    assert order == [first["id"], second["id"]]


def test_the_PREVIOUS_SESSION_is_the_bars_stores_walk_back_not_a_second_calendar():
    """⛔ ONE CALENDAR. A Monday's previous session is the FRIDAY, and this must
    come from the same function `expected_session` delegates to — a second
    weekend/holiday walk-back here is `lesson_probe_names_must_be_derived_not_typed`
    in calendar form."""
    assert scan_evaluator.previous_session(20260807) == 20260806   # Fri <- Thu
    assert scan_evaluator.previous_session(20260810) == 20260807   # Mon <- Fri
    fn = _function_node("previous_session")
    attrs = {n.attr for n in pyast.walk(fn) if isinstance(n, pyast.Attribute)}
    assert "_expected_latest_session_yyyymmdd" in attrs


def test_a_TRUNCATED_night_does_not_LOG_like_an_EMPTY_one(store, bars, clock,
                                                          caplog):
    """🔴 WITH ZERO LIVE DEFINITIONS TODAY, "we ran out of night" and "there was
    nothing to scan" would otherwise be the same line in the log. The count of
    definitions HANDED and the count SWEPT are both on it."""
    bars["A"] = _daily_bars()
    first, second = _two_definitions()
    with caplog.at_level("INFO"):
        scan_evaluator.run_sweep([first, second], TF, universe=["A"],
                                 as_of=SESSION, deadline=_at(4))
    done = [r.message for r in caplog.records if "sweep done" in r.message]
    assert done, "the sweep logged no completion line at all"
    assert "handed=2" in done[0] and "swept=0" in done[0] and "unswept=2" in done[0]


def test_the_JOB_explains_the_receipt_shortfall_rather_than_leaving_a_MYSTERY(
        store, bars, monkeypatch, caplog):
    """⛔ "receipts read back: 0 of 2" beside nothing else reads as two silent
    failures. `sweep_job` says which of the two it is."""
    bars["A"] = _daily_bars()
    first, second = _two_definitions()
    monkeypatch.setattr(scan_evaluator, "definitions_to_sweep",
                        lambda: [first, second])
    monkeypatch.setattr(scan_evaluator.snapshot_builder, "_load_universe",
                        lambda: ["A"])
    monkeypatch.setattr(scan_evaluator, "expected_session", lambda: SESSION)
    monkeypatch.setattr(scan_evaluator, "_now_et", lambda: _at(10))   # past it
    with caplog.at_level("INFO"):
        scan_evaluator.sweep_job()
    assert any("receipts read back: 0 of 2" in r.message for r in caplog.records)

    # ⛔ BOUND TO A SENTENCE ONLY `sweep_job` CAN HAVE SAID. The first spelling of
    # this asked for "NOT" and "budget" in ANY record — and `run_sweep`'s own
    # warning carries both ("this is NOT an empty night", "wall-clock budget"), so
    # deleting the job's explanation entirely SURVIVED the gauntlet. The probe was
    # reading a different artifact than the one under test, which is the same
    # defect class as a census that fires on a namesake.
    explained = [r for r in caplog.records if "have NO receipt because" in r.message]
    assert len(explained) == 1, (
        "`sweep_job` did not explain the shortfall in its OWN words — a bare "
        "'receipts read back: 0 of 2' reads as two silent failures")
    assert "budget" in explained[0].message


# ═══ 13. the history axis — E-7's refusal, wired ════════════════════════════
#
# ⭐ E-7 shipped `entitlements.apply_history_cap` with NO production call site
# and said so out loud, because closing the loop needed `toolkit:history` in this
# module's closed vocabulary. This is that wire.


def test_a_HISTORY_CAP_WITHHOLDS_the_whole_definition_and_it_is_NOT_a_DROP(
        store, bars):
    """🔴 FOUR OUTCOMES STAY FOUR. `withheld` means "your plan stops here";
    `dropped` means "we tried and failed, re-run them"; `not_computable` means
    "the maths had nothing to say". A history cap is the first."""
    universe = [f"SYM{i:02d}" for i in range(10)]
    for s in universe:
        bars[s] = _daily_bars()

    out = scan_evaluator.evaluate_one(
        _definition(PRICE_TREE), TF, universe=universe, as_of=SESSION,
        limits=_Limits("small", max_history_bars=10))

    assert out["withheld_reason"] == "toolkit:history"
    assert out["withheld"] == len(universe)
    assert out["evaluated"] == 0
    assert out["dropped"] == 0 and out["not_computable"] == 0
    assert out["dropped_symbols"] == [] and out["hits"] == []
    assert out["evaluated"] == (out["answered"] + out["dropped"]
                                + out["not_computable"])


def test_a_HISTORY_WITHHELD_run_writes_NOTHING_into_the_SHARED_store(store, bars):
    """🔴 `scan_hits`/`scan_coverage` HAVE NO MEMBER COLUMN BY DESIGN — two
    members who typed one formula share one result set. Writing a per-member
    entitlement outcome there publishes one plan's boundary as a fact about the
    market, for everybody. Silence is correct: `coverage(...) is None` reads as
    "nobody looked", which is true."""
    bars["A"] = _daily_bars()
    d = _definition(PRICE_TREE)
    handle = scan_definition.assert_scannable(d)["def_hash"]

    scan_evaluator.evaluate_one(d, TF, universe=["A"], as_of=SESSION,
                                limits=_Limits("small", max_history_bars=10))
    assert scan_store.coverage(handle, TF, SESSION) is None
    assert scan_store.hits(handle, TF, SESSION) == []

    # the control: the SAME definition under a cap that admits it does write one
    scan_evaluator.evaluate_one(d, TF, universe=["A"], as_of=SESSION,
                                limits=_Limits("big", max_history_bars=10_000))
    assert scan_store.coverage(handle, TF, SESSION) is not None


def test_the_SAME_definition_answers_IDENTICALLY_under_a_cap_that_ADMITS_it(
        store, bars):
    """⛔ SPEC §1.4 AT THE SWEEP: gate BREADTH, never MECHANICS. A cap that
    admits the history must not change one digit of the answer — E-7 measured
    `ema(close,20)` at 15.269399733598789 over 400 bars and 15.269384587868412
    over 120, and `pytest.approx(rel=1e-6)` calls those EQUAL, so the comparison
    here is `repr()` for `repr()`."""
    universe = [f"SYM{i:02d}" for i in range(8)]
    for s in universe:
        bars[s] = _daily_bars()
    d = _definition(PRICE_TREE)

    ungated = scan_evaluator.evaluate_one(d, TF, universe=universe, as_of=SESSION)
    capped = scan_evaluator.evaluate_one(
        d, TF, universe=universe, as_of=SESSION,
        limits=_Limits("big", max_history_bars=10_000))
    assert repr(capped["hits"]) == repr(ungated["hits"])
    assert capped["evaluated"] == ungated["evaluated"]
    assert capped["withheld"] == 0 and capped["withheld_reason"] is None


def test_the_SWEEPs_history_gate_and_apply_history_cap_AGREE(store, bars):
    """⛔ TWO IMPLEMENTATIONS OF "how much of the past does your plan let you ask
    about" IS A SECOND AUTHORITY OVER A BILLING CONTRACT. E-7 pinned the symbol
    slice the same way; this pins the history boundary.

    ⚠️ THE SWEEP ASKS ABOUT `want` — WHAT THE TREE READS — AND `apply_history_cap`
    ASKS ABOUT `len(bars)`. For any symbol carrying the history the tree asked
    for, the two must answer identically. They deliberately DIVERGE only where
    the symbol is short of it, and that divergence has its own assertion below:
    a per-symbol test would answer YES for a liquid name and NO for a thin one,
    so a member on a small plan would get results only for the data-poorest
    tickers in the universe.
    """
    from api.services import entitlements as ent

    want = 400
    for cap in (None, 0, 1, 399, 400, 401, 5000):
        limits = ent.Limits(toolkit="t", max_symbols=None, max_history_bars=cap,
                            max_definitions=50, min_refresh_seconds=None)
        sweep_refuses = scan_evaluator._history_withheld(want, limits)
        try:
            ent.apply_history_cap([{}] * want, limits)
            store_refuses = False
        except ent.ToolkitWithheld as exc:
            store_refuses = True
            assert exc.reason == scan_evaluator.HISTORY_WITHHELD
        assert sweep_refuses is store_refuses, f"they disagree at cap={cap!r}"

    # ⭐ THE STATED DIVERGENCE, ASSERTED SO IT IS A DECISION AND NOT A DRIFT.
    thin = ent.Limits(toolkit="t", max_symbols=None, max_history_bars=100,
                      max_definitions=50, min_refresh_seconds=None)
    assert scan_evaluator._history_withheld(want, thin) is True
    ent.apply_history_cap([{}] * 50, thin)          # a 50-bar symbol: admitted


def test_the_WITHHELD_VOCABULARY_is_the_SAME_TWO_WORDS_on_BOTH_SIDES():
    """⛔ E-3 OWNS THE WORDS, E-7 SPELLS THEM. Importing across would put the
    sweep in a router's namespace, which `test_scan_evaluator_off_request_path`
    forbids — so the two are pinned equal instead, in both directions now that
    both reasons are producible here."""
    from api.services import entitlements as ent
    assert scan_evaluator.WITHHELD_REASONS[0] == ent.SYMBOLS_WITHHELD
    assert set(scan_evaluator.WITHHELD_REASONS) == set(ent.WITHHELD_REASONS)
    assert scan_evaluator.HISTORY_WITHHELD == ent.HISTORY_WITHHELD
    assert scan_evaluator.UNSWEPT_REASON not in scan_evaluator.WITHHELD_REASONS, (
        "'we ran out of night' was folded into 'your plan stops here' — they are "
        "different facts and a member fixes them by doing different things")


def test_a_BOOL_cap_is_REFUSED_on_EVERY_axis(store, bars):
    """⚠️ `isinstance(True, int)` IS TRUE. `max_history_bars=True` would withhold
    every definition reading more than one bar — i.e. all of them — while reading
    as "enabled"."""
    bars["A"] = _daily_bars()
    for field in ("max_symbols", "max_history_bars"):
        with pytest.raises(ValueError) as exc:
            scan_evaluator.evaluate_one(_definition(PRICE_TREE), TF,
                                        universe=["A"], as_of=SESSION,
                                        limits=_Limits("t", **{field: True}))
        assert field in str(exc.value)
