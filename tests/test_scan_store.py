"""E-2 — the scan results store: hits-only, and a receipt that separates
"nobody looked" from "nobody matched".

🔴 THE ONE FAILURE THIS FILE EXISTS TO MAKE STRUCTURALLY IMPOSSIBLE.
`scan_volume._job` sets `m = {}` when its reference build fails, so "a failed
reference is indistinguishable from an empty market". At screener scale that is a
screen silently dropping 800 symbols, returning fewer hits, and looking like a
quiet market — and a trader would act on it.

⚠️ AND THE HITS-ONLY DECISION NEEDS A CONTROL, WHICH IS THE POINT OF
`test_a_NON_HIT_is_ABSENT_from_scan_hits_and_still_RECOVERABLE`. A test that only
checks that the hits are there would pass just as happily against a dense
row-per-symbol table — the shape measured at 53 B/row and 279 GB/yr next door in
`alert_shadow_fires`. So the assertion is on the ABSENCE as well as the presence.

⚠️ ISOLATION IS PROVED AGAINST THE ARTIFACT, NOT AGAINST THE ENV VAR. `C:\\data`
exists on this box and is NOT production; the screener's default path resolves
into it and there is a real 1.7 MB `screener.db` sitting there.
`test_the_store_never_touches_the_default_database` stats that file before and
after — byte size and mtime — because "we set the env var" is a claim about
intent and a stat is a claim about what happened.
"""
from __future__ import annotations

import contextlib
import itertools
import os
import pathlib
import sqlite3

import pytest

from api.services import ast_freshness
from api.services import ast_interpret
from api.services import ast_table
from api.services.screener import scan_store
from api.services.screener import snapshot_db
from api.services.signature import ledger

# A well-formed handle. Its VALUE is arbitrary — what matters is that the store
# keys on it and on nothing about a member.
H = "sha256:" + "0" * 64
H2 = "sha256:" + "1" * 64

DAY = 20260808
TF = "D"

# ⭐ THE ENUMERATION IS THE FIXTURE AND THE COUNTS ARE DERIVED FROM IT.
#
# The plan review's finding 10: "`41` is restated with three mutually
# inconsistent splits, and E-2's fixture contradicts its own docstring". Three
# documents disagreed about which half of 41 was which because each restated the
# split in prose. Here there is nothing to restate — `dropped_symbols` is built,
# and every count below is counted OFF IT, so the fixture and its description
# cannot drift apart. `evaluated` is the only free number.
UNIVERSE = 3742
NOT_COMPUTABLE_REASON = "insufficient_history"   # could not compute at the last bar
FAILED_REASON = "evaluation_failed"              # something broke

DROPPED_SYMBOLS = (
    [{"ticker": f"SHORT{i:03d}", "reason": NOT_COMPUTABLE_REASON} for i in range(39)]
    + [{"ticker": f"BROKE{i:03d}", "reason": FAILED_REASON} for i in range(2)]
)
NOT_COMPUTABLE = sum(1 for d in DROPPED_SYMBOLS
                     if d["reason"] == NOT_COMPUTABLE_REASON)
DROPPED = sum(1 for d in DROPPED_SYMBOLS if d["reason"] == FAILED_REASON)
ANSWERED = UNIVERSE - DROPPED - NOT_COMPUTABLE
HITS = ["AAPL", "MSFT", "NVDA"]

#: The index counts, held by the test rather than restated in prose. Both are
#: read off `sqlite_master` where they are asserted; do not quote them elsewhere.
EXPECTED_SCREENER_ROW_INDEXES = 8
EXPECTED_SCAN_HIT_INDEXES = 1


@pytest.fixture
def store(tmp_path, monkeypatch):
    """A screener database of this test's own, proved to be the one in use.

    `snapshot_db.get_db_path()` reads `SCREENER_DB_PATH` on EVERY call rather than
    capturing it at import, so `monkeypatch.setenv` genuinely reaches it — but
    that is a property of the module, not a promise, so it is asserted here
    before anything writes. `_INITED` is cleared because it is keyed by path and
    a previous test's entry must not answer for this one.
    """
    path = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    monkeypatch.setattr(scan_store, "_INITED", set())
    assert snapshot_db.get_db_path() == str(path), (
        "SCREENER_DB_PATH did not reach snapshot_db — a module-level capture has "
        "appeared and this whole file is writing somewhere else")
    scan_store.init_db()
    assert path.exists()
    return path


def _columns(path, table) -> list:
    with contextlib.closing(sqlite3.connect(str(path))) as c:
        return [r[1] for r in c.execute(f"PRAGMA table_info({table})")]


# ═══ 1. quiet is not broken ═════════════════════════════════════════════════

def test_no_hits_and_never_ran_are_DIFFERENT_and_the_store_can_tell_them_apart(store):
    """🔴 THE FAILURE THIS PHASE MUST NOT SHIP, MADE STRUCTURAL (mutation M2).

    Two tables make it impossible to confuse them: `scan_hits` holds only hits,
    and `scan_coverage` holds the receipt that says the run happened and over
    what. A quiet market is `coverage(...) is not None and hits == []`. A run that
    never happened is `coverage(...) is None`. There is no third reading, and
    inferring "ran" from a non-empty hit list — the mutation — collapses the two.
    """
    assert scan_store.coverage(H, TF, DAY) is None            # nobody looked
    assert scan_store.hits(H, TF, DAY) == []                  # ... and so, no hits

    scan_store.record_coverage(
        H, TF, DAY, evaluated=UNIVERSE, answered=UNIVERSE, dropped=0,
        not_computable=0, dropped_symbols=[])
    scan_store.record_hits(H, TF, DAY, [])

    assert scan_store.hits(H, TF, DAY) == []                  # a quiet market
    receipt = scan_store.coverage(H, TF, DAY)
    assert receipt is not None and receipt["evaluated"] == UNIVERSE, (
        "the sweep ran over the whole universe and matched nothing; without the "
        "receipt this is byte-identical to a sweep that never started")


def test_the_coverage_receipt_carries_FIVE_KEYS_and_the_arithmetic_closes(store):
    """🔴 CONTROLLER RESOLUTION 5 — `not_computable` IS ITS OWN KEY (mutation M10).

    "We could not compute it at the last confirmed bar" and "something broke" are
    DIFFERENT FACTS to a member, and folding them is what makes a coverage report
    untrustworthy. A 41-symbol drop that is really 39 short-history and 2 failures
    has to say so.

    ⛔ `dropped_symbols` is the ONE enumeration and carries BOTH kinds, each with
    its `reason`; the two COUNTS are what split them. A second list would be a
    sixth key nobody granted — and two lists that must agree with two counts is
    two chances to disagree.
    """
    scan_store.record_coverage(
        H, TF, DAY, evaluated=UNIVERSE, answered=ANSWERED, dropped=DROPPED,
        not_computable=NOT_COMPUTABLE, dropped_symbols=DROPPED_SYMBOLS)
    c = scan_store.coverage(H, TF, DAY)

    assert set(c) >= set(scan_store.COVERAGE_KEYS)
    assert c["evaluated"] == c["answered"] + c["dropped"] + c["not_computable"]
    assert c["dropped"] == DROPPED and c["not_computable"] == NOT_COMPUTABLE
    assert c["dropped"] != c["not_computable"], (
        "the two buckets happen to be equal in this fixture, so folding them "
        "would be invisible — change the fixture, not this assertion")
    assert len(c["dropped_symbols"]) == DROPPED + NOT_COMPUTABLE
    by_reason = {}
    for entry in c["dropped_symbols"]:
        by_reason[entry["reason"]] = by_reason.get(entry["reason"], 0) + 1
    assert by_reason == {NOT_COMPUTABLE_REASON: NOT_COMPUTABLE,
                         FAILED_REASON: DROPPED}


def test_a_MISSING_SCALAR_is_not_the_same_row_as_a_symbol_that_simply_did_not_hit(store):
    """🔴 THE HOLE A COMPARISON EATS, AND WHY THE SCHEMA HAS TO OUTLIVE IT.

    Measured by E-1 and pinned by 17 frozen cross-lane digests: `_cmp` answers
    **0** against NaN, so on a symbol with no market cap

        interpret(market_cap > 1e9)   ->  0.0        a confident False
        interpret(market_cap)         ->  None       the honest hole

    The hole is visible at the LEAF and invisible one node up. So at the top of
    the tree, "this symbol failed the filter" and "we had no data for this
    symbol" are the SAME VALUE — `scan_volume`'s defect reached from the other
    side, and at screener scale it is a screen that quietly drops symbols and
    looks like a thin market.

    ⛔ THE STORE CANNOT FIX THAT, BUT IT MUST NOT UNDO THE FIX EITHER. E-3 asks
    `ast_interpret.unresolved_scalars` BEFORE evaluating and drops the symbol; a
    receipt that could only say "dropped" would fold the answer straight back
    together one layer down. This asserts the schema keeps them apart: the
    no-data symbol is counted in `not_computable`, named in the enumeration with
    the SCALAR that was missing, and is NOT in `answered` — while the symbol that
    genuinely evaluated to 0 is in `answered` and simply absent from the hits.
    """
    bars = [{"t": 20260806 + i, "o": 1.0, "h": 1.0, "l": 1.0, "c": 1.0, "v": 1}
            for i in range(3)]
    # derived, never typed: the first NUMERIC scalar the table declares, so the
    # comparison below is a magnitude test rather than a nonsense one.
    scalar = sorted(n for n in ast_table.scalar_names()
                    if ast_table.yields_of(n) == "num")[0]
    tree = {"type": "op", "name": ">", "args": [
        {"type": "series", "name": scalar}, {"type": "num", "value": 1e9}]}

    # the measurement this test is defending, re-taken here rather than quoted
    assert ast_interpret.interpret(tree, bars, scalars={scalar: None})[-1] == 0.0, (
        "a comparison stopped eating the hole — if `_cmp` now propagates NaN the "
        "conformance digests moved and this whole argument needs re-deriving")
    assert ast_interpret.unresolved_scalars(tree, {scalar: None}) == [scalar]
    assert ast_interpret.unresolved_scalars(tree, {scalar: 2e9}) == []

    no_data, evaluated_miss, hit = "NODATA", "MISSED", "AAPL"
    scan_store.record_hits(H, TF, DAY, [hit])
    scan_store.record_coverage(
        H, TF, DAY, evaluated=3, answered=2, dropped=0, not_computable=1,
        dropped_symbols=[{"ticker": no_data, "reason": f"unresolved_scalar:{scalar}"}])

    c = scan_store.coverage(H, TF, DAY)
    assert c["not_computable"] == 1 and c["dropped"] == 0
    assert c["answered"] == 2, "the symbol with no data must not be in `answered`"
    listed = {d["ticker"]: d["reason"] for d in c["dropped_symbols"]}
    assert listed == {no_data: f"unresolved_scalar:{scalar}"}
    assert scalar in listed[no_data], (
        "the enumeration must name WHICH scalar was absent, or a member cannot "
        "tell a stale snapshot from a formula that asks for too much")

    # and the two remain distinguishable at the surface: both are absent from
    # `scan_hits`, and ONLY the receipt says which one was actually looked at.
    assert scan_store.hits(H, TF, DAY) == [hit]
    assert no_data not in scan_store.hits(H, TF, DAY)
    assert evaluated_miss not in scan_store.hits(H, TF, DAY)
    assert evaluated_miss not in listed, (
        "a symbol that evaluated to 0 must NOT appear in the dropped "
        "enumeration; it was answered, and the answer was no")


def test_a_receipt_whose_ARITHMETIC_DOES_NOT_CLOSE_is_refused_not_recorded(store):
    """A coverage report whose own numbers disagree is worse than none, because
    it looks like evidence. Refused at the door, and nothing lands."""
    with pytest.raises(ValueError, match="does not close"):
        scan_store.record_coverage(
            H, TF, DAY, evaluated=UNIVERSE, answered=UNIVERSE, dropped=DROPPED,
            not_computable=NOT_COMPUTABLE, dropped_symbols=DROPPED_SYMBOLS)
    assert scan_store.coverage(H, TF, DAY) is None, (
        "a refused receipt left a row behind — the refusal has to be BEFORE the "
        "write or a half-written receipt is worse than none")


def test_an_enumerated_symbol_with_NO_REASON_is_refused(store):
    """"41 symbols were dropped and here they are" is only worth printing if each
    entry says WHY — it is the difference between a member learning their screen
    needs more history and a member concluding the screener is broken."""
    with pytest.raises(ValueError, match="carries no reason"):
        scan_store.record_coverage(
            H, TF, DAY, evaluated=3, answered=2, dropped=1, not_computable=0,
            dropped_symbols=[{"ticker": "AAPL"}])
    with pytest.raises(ValueError, match="carries no ticker"):
        scan_store.record_coverage(
            H, TF, DAY, evaluated=3, answered=2, dropped=1, not_computable=0,
            dropped_symbols=[{"reason": FAILED_REASON}])


def test_the_freshness_verdict_is_validated_against_the_ONE_declaration(store):
    """One vocabulary in storage. `ast_freshness.FRESHNESS_MODES` is E-1's
    declaration and this store validates against it rather than keeping a second
    list of acceptable spellings."""
    for mode in ast_freshness.FRESHNESS_MODES:
        scan_store.record_coverage(
            H, TF, DAY, evaluated=0, answered=0, dropped=0, not_computable=0,
            dropped_symbols=[], freshness=mode)
        assert scan_store.coverage(H, TF, DAY)["freshness"] == mode
    with pytest.raises(ValueError, match="freshness must be one of"):
        scan_store.record_coverage(
            H, TF, DAY, evaluated=0, answered=0, dropped=0, not_computable=0,
            dropped_symbols=[], freshness="fresh-ish")


# ═══ 2. hits-only, WITH its control ═════════════════════════════════════════

def test_a_NON_HIT_is_ABSENT_from_scan_hits_and_still_RECOVERABLE(store):
    """⛔ MUTATION M1, AND THE HALF A NAIVE TEST WOULD MISS.

    `registry_defs.event_columns` is right that "0 is 'computed, did not happen'
    and is the whole point" — so the 0 must be RECOVERABLE. It is: a ticker inside
    a `scan_coverage` window and absent from `scan_hits` IS a computed 0.

    A test that only asserted the three hits are present would pass unchanged
    against a dense row-per-symbol table, which is the `alert_shadow_fires` shape
    (53 B/row, no prune, 279 GB/yr at 10k). So this asserts the ABSENCE too, and
    counts the rows the table actually holds.
    """
    evaluated = HITS + ["QUIET1", "QUIET2", "QUIET3", "QUIET4"]
    scan_store.record_hits(H, TF, DAY, HITS)
    scan_store.record_coverage(
        H, TF, DAY, evaluated=len(evaluated), answered=len(evaluated),
        dropped=0, not_computable=0, dropped_symbols=[])

    assert scan_store.hits(H, TF, DAY) == sorted(HITS)
    with contextlib.closing(sqlite3.connect(str(store))) as c:
        rows = c.execute("SELECT COUNT(*) FROM scan_hits").fetchone()[0]
    assert rows == len(HITS), (
        f"scan_hits holds {rows} rows for {len(HITS)} hits over "
        f"{len(evaluated)} evaluated symbols — the table went dense")

    # the 0 is recoverable: swept, and not in the hit list.
    for quiet in ("QUIET1", "QUIET4"):
        assert quiet not in scan_store.hits(H, TF, DAY)
        assert scan_store.coverage(H, TF, DAY) is not None, (
            f"{quiet} evaluated to 0 and the receipt is what says so")


def test_recording_hits_REPLACES_the_answer_for_a_key_rather_than_unioning(store):
    """The key names ONE evaluation of ONE formula over ONE session. A re-run
    after a bars correction must not leave yesterday's answer superimposed on
    today's, or a hit the correction REMOVED becomes unremovable and `scan_hits`
    starts disagreeing with the receipt written beside it."""
    scan_store.record_hits(H, TF, DAY, HITS)
    assert scan_store.record_hits(H, TF, DAY, ["AAPL"]) == 1
    assert scan_store.hits(H, TF, DAY) == ["AAPL"]


def test_a_lowercase_ticker_is_stored_UPPERCASE_so_the_join_can_ever_match(store):
    """`screener_rows.ticker` is stored upper-cased and is the column
    `join_clause` joins on. A lower-case hit would be a row that exists and never
    matches, which is worse than a missing one."""
    assert scan_store.record_hits(H, TF, DAY, ["nvda", "NVDA", " aapl ", ""]) == 2
    assert scan_store.hits(H, TF, DAY) == ["AAPL", "NVDA"]


# ═══ 3. one spelling per timeframe, one encoding per session ════════════════

def test_the_timeframe_is_the_BARS_STORE_CODE_and_the_LABEL_is_refused_BY_NAME(store):
    """⛔ MUTATION M3 — controller resolution 6.

    Accepting both spellings splits one session across two keys and every count
    stays plausible: nothing fails, nothing is red, and the screen quietly halves.
    The refusal NAMES the code a caller should have sent, because a refusal that
    only says "no" gets fixed by deleting the scan.

    ⛔ AND THE ACCEPTED SET IS DERIVED from the bars store's own key map, never
    typed here — so a ninth timeframe is accepted the day it is declared.
    """
    codes = set(ledger._BARS_STORE_TF_KEYS)
    labels = set(ledger._BARS_STORE_TF_KEYS.values())
    assert codes and not (codes & labels), (
        "the code and label vocabularies overlap; this test cannot distinguish "
        "them and neither could the store")

    for code in codes:
        scan_store.record_hits(H, code, DAY, ["AAPL"])
        assert scan_store.hits(H, code, DAY) == ["AAPL"]

    for label in labels:
        with pytest.raises(ValueError, match="PRODUCT LABEL") as exc:
            scan_store.hits(H, label, DAY)
        assert repr(scan_store._TF_CODE_BY_LABEL[label]) in str(exc.value), (
            "the refusal did not name the code the caller should send")

    with pytest.raises(ValueError, match="bars-store codes"):
        scan_store.hits(H, "daily", DAY)


def test_as_of_collapses_EVERY_ENCODING_onto_one_INTEGER_key(store):
    """⛔ MUTATION M4.

    `screener_rows.bars_asof` is TEXT and the bars store speaks ints. A key that
    accepted both would silently split one session across two rows and every
    count would still look plausible. `ledger._normalize_bar_time` already owns
    the collapse — it is CALLED here rather than re-derived — and the door adds
    the range check it deliberately does not do, because it passes an epoch
    through verbatim (correct for an intraday signal, a second encoding of one
    day here).
    """
    scan_store.record_hits(H, TF, "2026-08-08", HITS)
    assert scan_store.hits(H, TF, DAY) == sorted(HITS)
    assert scan_store.hits(H, TF, "20260808") == sorted(HITS)
    assert scan_store.hits(H, TF, "2026-08-08T00:00:00Z") == sorted(HITS)

    with contextlib.closing(sqlite3.connect(str(store))) as c:
        kinds = {r[0] for r in c.execute("SELECT typeof(as_of) FROM scan_hits")}
    assert kinds == {"integer"}, (
        f"as_of is stored as {kinds}; TEXT '20260808' and INTEGER 20260808 are "
        "different keys and the join silently returns nothing")

    for junk in (1754611200, 20261332, "not a date", None):
        with pytest.raises(ValueError):
            scan_store.hits(H, TF, junk)


# ═══ 4. member independence, and screener_rows untouched ════════════════════

def test_the_key_carries_NOTHING_about_a_MEMBER(store):
    """⛔ MUTATION M7. Two members who type the same formula have the same maths
    and share one result set — which costs the pod one sweep instead of two, and
    is the property E-6 is being built to obtain. Asserted against the COLUMN SET
    read out of the database, not out of a docstring."""
    forbidden = {"user_id", "member_id", "alert_id", "def_id", "version",
                 "active", "snoozed"}
    for table in ("scan_hits", "scan_coverage"):
        cols = set(_columns(store, table))
        assert not (cols & forbidden), (
            f"{table} carries {sorted(cols & forbidden)} — the store stopped "
            "being member-independent")
    # ⭐⭐ A ROSTER WITH A REASON PER COLUMN, still CLOSED-WORLD. The bare set this
    # replaces was doing real work that the blocklist above cannot: it catches a
    # member-identifying column added under a name nobody thought to forbid
    # (`owner`, `account`, `subscriber`). Keeping that strength while admitting a
    # legitimate column means naming WHY each one is member-independent, so the next
    # addition is a decision somebody wrote down rather than a set somebody widened.
    #
    # ⚰️ `value` BROKE THIS ASSERTION AND THE INVARIANT WAS NEVER IN DANGER — it is
    # not in `forbidden`, and the check above passed. What failed was an exact
    # equality standing in for a property, which is the "count beside the list"
    # shape this repo keeps paying for.
    member_independent = {
        "def_hash": "the FORMULA, not who typed it — two members with the same maths"
                    " share one row and one sweep, which is the whole property",
        "tf": "the timeframe the formula was evaluated on",
        "as_of": "the session it was evaluated for",
        "ticker": "the symbol it matched",
        "value": "the number THAT FORMULA answered with on THAT symbol — a fact about"
                 " the definition and the market, identical for every member who"
                 " typed it, so it carries no member either",
    }
    assert set(_columns(store, "scan_hits")) == set(member_independent), (
        "scan_hits gained or lost a column. Every column here must be a fact about"
        " the FORMULA, the MARKET or the SESSION — never about a member. Add it to"
        " `member_independent` WITH the reason it qualifies, or do not add it.")


def test_screener_rows_still_holds_EXACTLY_its_own_columns_and_no_scan_column(store):
    """⛔ MUTATION M8 — E-A4 refuses both a per-definition widening and an EAV.

    Read out of `PRAGMA table_info`, never out of the source that wrote it.
    """
    assert set(_columns(store, "screener_rows")) == set(snapshot_db.COLUMNS)
    assert "scan_hit" not in _columns(store, "screener_rows")


def test_the_screener_COLUMN_SET_still_partitions_into_E1s_frozen_manifest(store):
    """⛔ NOT A LENGTH — A LENGTH ASSERTION PASSES A SWAP.

    E-1 froze the screener's column set into the closed table as a partition:
    every column is either a declared `scalars` entry or a declared exclusion,
    and the two are disjoint. Comparing the live `COLUMNS` against that partition
    binds this task to E-1's measurement by NAME, with no integer restated in
    either place — and a 66th column lands red here as well as there.
    """
    declared = {ast_table.scalar_source(n)["column"]
                for n in ast_table.scalar_names()}
    excluded = ast_table.excluded_columns()
    assert declared | excluded == set(snapshot_db.COLUMNS), (
        "unpartitioned: "
        f"{sorted(set(snapshot_db.COLUMNS) - declared - excluded)} / stale: "
        f"{sorted((declared | excluded) - set(snapshot_db.COLUMNS))}")
    assert not (declared & excluded)
    assert len(snapshot_db.COLUMNS) == len(set(snapshot_db.COLUMNS))


def test_the_two_new_tables_added_NO_index_to_screener_rows(store):
    """The 8 indexes on `screener_rows` are what make the classic screener fast.
    Read from `sqlite_master`, so a name typed here cannot make this pass."""
    with contextlib.closing(sqlite3.connect(str(store))) as c:
        on_rows = sorted(r[0] for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type='index' "
            "AND tbl_name='screener_rows' AND name NOT LIKE 'sqlite_%'"))
        on_hits = sorted(r[0] for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type='index' "
            "AND tbl_name='scan_hits' AND name NOT LIKE 'sqlite_%'"))
    assert len(on_rows) == EXPECTED_SCREENER_ROW_INDEXES, on_rows
    assert all(n.startswith("idx_sr_") for n in on_rows), on_rows
    assert len(on_hits) == EXPECTED_SCAN_HIT_INDEXES, on_hits


# ═══ 5. the join ════════════════════════════════════════════════════════════

def test_the_join_clause_is_PARAMETRIZED_and_the_handle_never_reaches_the_SQL(store):
    """⛔ `filters.column_for` / `is_valid_op` gate every existing screener query
    because a client string must never become SQL, and `def_hash` is the one
    value here a client could ever supply. It leaves as a BOUND PARAMETER."""
    sql, params = scan_store.join_clause(H, TF, "2026-08-08")
    assert H not in sql and sql.count("?") == 3
    assert params == [H, TF, DAY], "the params were not normalised at the door"
    assert "'" not in sql and '"' not in sql

    injected = "x'; DROP TABLE screener_rows; --"
    sql2, params2 = scan_store.join_clause(injected, TF, DAY)
    assert sql2 == sql and params2[0] == injected, (
        "a client-supplied handle changed the SQL TEXT — it must only ever be a "
        "bound parameter")


def test_the_join_clause_actually_SELECTS_the_hit_rows_from_screener_rows(store):
    """🔴 A FRAGMENT NOBODY EXECUTES IS A FRAGMENT NOBODY KNOWS IS WRONG.

    E-2 wires nothing (E4-A5 gives the surface decision to E-4), so the only way
    this fragment can be shown to compose against the real table is to compose it
    here — against real `screener_rows` rows, in the real database, with the real
    parameters. A syntax error or a mis-spelled correlation name would otherwise
    surface in E-4's task, in someone else's file.
    """
    snapshot_db.upsert_rows([
        {"ticker": t, "price": 10.0, "snapshot_date": "2026-08-08",
         "built_at": 1}
        for t in ("AAPL", "MSFT", "NVDA", "QUIET1", "QUIET2")])
    scan_store.record_hits(H, TF, DAY, HITS)

    sql, params = scan_store.join_clause(H, TF, DAY)
    with contextlib.closing(sqlite3.connect(str(store))) as c:
        got = sorted(r[0] for r in c.execute(
            f"SELECT ticker FROM screener_rows WHERE {sql} ORDER BY ticker", params))
    assert got == sorted(HITS)

    # the control: a handle nothing was recorded under selects NOTHING, rather
    # than everything, which is what a broken correlation name would do.
    sql2, params2 = scan_store.join_clause(H2, TF, DAY)
    with contextlib.closing(sqlite3.connect(str(store))) as c:
        none = [r[0] for r in c.execute(
            f"SELECT ticker FROM screener_rows WHERE {sql2}", params2)]
    assert none == []


# ═══ 6. the horizon ═════════════════════════════════════════════════════════

def test_prune_drops_what_is_BEYOND_the_horizon_and_keeps_what_is_INSIDE_it(store):
    """⛔ MUTATION M9. GT §3.5's verdict on `alert_shadow_fires` — "do not build a
    screener history on this table's current shape" — was never about its width.
    It was about shipping without a prune and growing for a year.

    ⚠️ STRICTLY BEFORE, so the horizon date itself SURVIVES. An inclusive prune
    would quietly eat one extra day every run and the loss would only ever show
    up as a hit rate that drifted.
    """
    old, horizon, newer = 20260101, 20260601, 20260701
    for day in (old, horizon, newer):
        scan_store.record_hits(H, TF, day, HITS)
        scan_store.record_coverage(
            H, TF, day, evaluated=UNIVERSE, answered=ANSWERED, dropped=DROPPED,
            not_computable=NOT_COMPUTABLE, dropped_symbols=DROPPED_SYMBOLS)

    removed = scan_store.prune(horizon)
    assert removed == {"before_as_of": horizon,
                       "hits": len(HITS), "coverage": 1}, removed

    assert scan_store.hits(H, TF, old) == []
    assert scan_store.coverage(H, TF, old) is None, (
        "a pruned window must read as UNPROVEN — `coverage` answering None is "
        "what stops a claim surface reporting a shrunken hit rate as the whole")

    for surviving in (horizon, newer):
        assert scan_store.hits(H, TF, surviving) == sorted(HITS), surviving
        assert scan_store.coverage(H, TF, surviving) is not None, surviving

    assert scan_store.prune(horizon) == {"before_as_of": horizon,
                                         "hits": 0, "coverage": 0}


def test_prune_normalises_its_horizon_the_same_way_everything_else_does(store):
    """A horizon spelled as an ISO date must mean the same day as one spelled as
    an int, or the prune eats a different window from the one asked for."""
    scan_store.record_hits(H, TF, 20260101, HITS)
    assert scan_store.prune("2026-06-01")["hits"] == len(HITS)
    with pytest.raises(ValueError):
        scan_store.prune(1754611200)


# ═══ 7. the measurement the decision rests on ═══════════════════════════════

#: Measured 2026-08-09 on this box, VACUUMed, differenced against the empty
#: schema: 91.1 B/row for the table and 182.3 B/row with `idx_scan_hits_ticker`.
#: The band is wide because SQLite page accounting moves with the platform; the
#: assertion that MATTERS is the RATIO below, which is a property of the shape.
HIT_BYTES_PER_ROW_FLOOR = 50.0
HIT_BYTES_PER_ROW_CEILING = 500.0
#: A dense table writes one row per EVALUATED symbol. At a hit rate this
#: generous, hits-only must still be an order of magnitude smaller — otherwise
#: the argument for the decision is not true on this platform.
DENSE_HIT_RATE = 0.05
DENSE_SAVING_FLOOR = 15.0


def test_a_hit_row_costs_what_the_DECISION_rests_on_and_dense_would_cost_20x(store):
    """⭐ THE DECISION IS A MEASUREMENT, SO IT IS MEASURED HERE RATHER THAN QUOTED.

    `alert_shadow_fires` is the counter-example the design forbids building on:
    53 B/row, no prune, 279 GB/yr at 10k alerts. This table's rows are HEAVIER
    than that — the 71-character handle repeats in every one, and the secondary
    index doubles it — which makes hits-only and `prune` more load-bearing here,
    not less.
    """
    tickers = ["".join(p) for p in itertools.islice(
        itertools.product("ABCDEFGHIJ", repeat=3), 500)]
    assert len(set(tickers)) == 500
    with contextlib.closing(sqlite3.connect(str(store))) as c:
        c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    empty = os.path.getsize(store)
    written = 0
    for day in range(20):
        scan_store.record_hits(H, TF, 20260101 + day, tickers)
        written += len(tickers)
    with contextlib.closing(sqlite3.connect(str(store))) as c:
        c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        c.execute("VACUUM")
    per_row = (os.path.getsize(store) - empty) / written
    assert HIT_BYTES_PER_ROW_FLOOR <= per_row <= HIT_BYTES_PER_ROW_CEILING, per_row

    dense_rows = written / DENSE_HIT_RATE
    assert dense_rows / written >= DENSE_SAVING_FLOOR, (
        f"a dense table would write {dense_rows:,.0f} rows where hits-only wrote "
        f"{written:,} — at {per_row:.1f} B/row that is the difference the "
        "decision rests on")


# ═══ 8. isolation, proved against the artifact ══════════════════════════════

def test_the_store_never_touches_the_DEFAULT_database(tmp_path, monkeypatch):
    """⚠️ PROVED AGAINST THE ARTIFACT, NOT AGAINST THE ENV VAR.

    `C:\\data` exists on this box and is NOT production, and the screener's
    default path resolves into it. "We set `SCREENER_DB_PATH`" is a claim about
    intent; a byte size and an mtime are a claim about what happened. If a
    module-level `_DB_PATH = os.environ.get(...)` ever appears in `scan_store`,
    the env var stops reaching it and THIS is the test that notices.
    """
    monkeypatch.delenv("SCREENER_DB_PATH", raising=False)
    default = pathlib.Path(snapshot_db.get_db_path())
    before = (default.exists(),
              default.stat().st_size if default.exists() else None,
              default.stat().st_mtime_ns if default.exists() else None)

    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "mine.db"))
    monkeypatch.setattr(scan_store, "_INITED", set())
    scan_store.init_db()
    scan_store.record_hits(H, TF, DAY, HITS)
    scan_store.record_coverage(
        H, TF, DAY, evaluated=UNIVERSE, answered=ANSWERED, dropped=DROPPED,
        not_computable=NOT_COMPUTABLE, dropped_symbols=DROPPED_SYMBOLS)
    scan_store.prune(DAY + 1)

    after = (default.exists(),
             default.stat().st_size if default.exists() else None,
             default.stat().st_mtime_ns if default.exists() else None)
    assert before == after, (
        f"{default} changed while this test was writing to {tmp_path} — the "
        "store is not reading SCREENER_DB_PATH on every call")
    assert (tmp_path / "mine.db").exists()


# ═══ 9. the contract symbols this task consumes ═════════════════════════════

def test_the_symbols_E2_CONSUMES_exist_and_fail_BY_NAME_if_they_moved():
    """⛔ THE PLAN'S OWN RULE, which its review found implemented in one task of
    six. A rename would otherwise surface as an AttributeError inside a sweep at
    03:00, in a module nobody was editing."""
    missing = [name for name, obj in (
        ("ledger._normalize_bar_time",
         getattr(ledger, "_normalize_bar_time", None)),
        ("ledger._BARS_STORE_TF_KEYS",
         getattr(ledger, "_BARS_STORE_TF_KEYS", None)),
        ("snapshot_db.connect", getattr(snapshot_db, "connect", None)),
        ("snapshot_db.get_db_path", getattr(snapshot_db, "get_db_path", None)),
        ("snapshot_db.COLUMNS", getattr(snapshot_db, "COLUMNS", None)),
        ("snapshot_db._WRITE_LOCK", getattr(snapshot_db, "_WRITE_LOCK", None)),
        ("snapshot_db._SCAN_SCHEMA", getattr(snapshot_db, "_SCAN_SCHEMA", None)),
        ("ast_interpret.unresolved_scalars",
         getattr(ast_interpret, "unresolved_scalars", None)),
        ("ast_freshness.FRESHNESS_MODES",
         getattr(ast_freshness, "FRESHNESS_MODES", None)),
        ("ast_freshness.UNKNOWN", getattr(ast_freshness, "UNKNOWN", None)),
    ) if obj is None]
    assert not missing, (
        f"E-2 consumes {missing}, which no longer exist. E-2 refuses rather than "
        "adapting silently.")
    assert ast_freshness.UNKNOWN in ast_freshness.FRESHNESS_MODES
    # ⛔ `ledger.ledger_timeframe` is deliberately NOT called: the ledger speaks
    # the product label and refuses the bars-store code at its door, so calling
    # it would refuse every key this store writes.
    assert set(ledger._BARS_STORE_TF_KEYS.values()) <= set(
        ledger._PRODUCT_TIMEFRAMES)
    assert not (set(ledger._BARS_STORE_TF_KEYS) & set(ledger._PRODUCT_TIMEFRAMES))
