"""D2 CP1+CP2 — the derivation rail, and the rail that bounds who reads the book.

⛔ APPROVED SCOPE (owner, 2026-09-12): *"CP1 — inert canonical address data …
+ the derivation rail that fails when a scalar name, store, cadence, or grain
diverges from closedTable.json."* Those four are asserted BY NAME below.

⛔ CP2 (line 2, NARROWED): *"extend the canonical book to the first non-screener
store … Derivation rail extended to the new store."* The bars half of this file
re-derives `bars_sqlite`'s DDL INDEPENDENTLY of the builder — a rail that
imported the builder's own parser would only prove the builder agrees with
itself.

⛔ THE POPULATION IS REPORTED, NEVER ASSERTED AS A COUNT. There is no
`assert len(metrics) == 137` in this file, deliberately: the manifest is MEANT to
grow, and *a count is the wrong instrument when the population is meant to
change.* The axis check asserts the PROPERTY (one store, one cadence, one grain,
or a named exception) and prints the counts. That is the same correction this
checkpoint makes to `scan_evaluator.py`'s own comment.
"""
from __future__ import annotations

import ast
import json
import pathlib
import subprocess
import sys

import pytest

_REPO = pathlib.Path(__file__).resolve().parents[1]
_BOOK_PATH = _REPO / "api" / "data" / "canonical_address_book.json"
_BUILDER = _REPO / "tools" / "build_canonical_address_book.py"


def _book() -> dict:
    return json.loads(_BOOK_PATH.read_text(encoding="utf-8"))


def _scalars() -> dict:
    from api.services.ast_lint import TABLE
    return TABLE["scalars"]


# ─────────────────────────────────────────────────────────────────────────────
# NON-VACUITY FIRST — every assertion below is over these two sets
# ─────────────────────────────────────────────────────────────────────────────

def test_both_sides_are_non_empty_and_name_a_metric_we_can_point_at():
    """⛔ AN EMPTY RESULT IS A FAILED INVOCATION UNTIL PROVEN OTHERWISE.

    Without this, every comparison in this file would pass over two empty dicts
    — and `{} == {}` is the most convincing green in testing. Named members,
    never a count: `above_50sma` is the scalar `closedTable.json`'s own sample
    entry uses, so if the manifest is readable at all it is there.
    """
    scalars, book = _scalars(), _book()
    assert scalars, "closedTable.json declared no scalars — the read is broken, not the answer"
    assert book["metrics"], "the address book is empty — it would satisfy any check below"
    assert "above_50sma" in scalars
    assert "above_50sma" in book["metrics"]


# ─────────────────────────────────────────────────────────────────────────────
# THE DERIVATION RAIL — the four fields the approval names
# ─────────────────────────────────────────────────────────────────────────────

def test_every_scalar_NAME_in_the_table_is_in_the_book_and_vice_versa():
    """The first of the approval's four: a scalar NAME that diverges fails.

    ⚰️ CP2 WIDENED THE SECOND HALF OF THIS TEST, AND THE RETIRED SENTENCE IS
    KEPT VERBATIM because it states the property that still matters:

        "the address book carries metrics closedTable.json does not declare. A
         metric with no declaration is a second authority"

    Still true. What changed is that `closedTable.json` is no longer the only
    declaration — `bars_sqlite.py`'s own DDL is one too. So an "extra" is now
    anything the book carries that NO declared store accounts for, and the set
    of declared stores is read from the book's own `stores` block rather than
    typed here.
    """
    scalars, book = _scalars(), _book()
    metrics = book["metrics"]
    missing = sorted(set(scalars) - set(metrics))
    assert not missing, (
        "closedTable.json declares metrics the address book does not carry — "
        f"re-run tools/build_canonical_address_book.py: {missing}")

    non_screener_stores = sorted(set(book["stores"]) - {"screener_rows"})
    assert non_screener_stores, (
        "the book declares no store beyond screener_rows — then this test is "
        "back to CP1 and the widening below proves nothing")

    unaccounted = sorted(
        n for n, d in metrics.items()
        if n not in scalars and d.get("store") not in non_screener_stores)
    assert not unaccounted, (
        "the address book carries metrics no declared store accounts for. A "
        f"metric with no declaration is a second authority: {unaccounted}")


@pytest.mark.parametrize("field,table_path", [
    ("store", ("source", "store")),
    ("cadence", ("cadence",)),
    ("grain", ("as_of", "grain")),
])
def test_the_book_agrees_with_the_table_on(field, table_path):
    """STORE, CADENCE and GRAIN — the other three the approval names.

    ⭐ Parametrized over the three so a failure says WHICH axis diverged, rather
    than one assertion reporting "something is different".
    """
    scalars, book = _scalars(), _book()["metrics"]
    bad = []
    for name, d in scalars.items():
        node = d
        for key in table_path:
            node = (node or {}).get(key)
        if book.get(name, {}).get(field) != node:
            bad.append((name, node, book.get(name, {}).get(field)))
    assert not bad, (
        f"{field} diverged between closedTable.json and the address book "
        f"(name, table, book): {bad[:8]}")


def test_the_checked_in_book_IS_what_the_declarations_derive():
    """⛔ THE DERIVATION ITSELF, not a spot check of it.

    The builder's `--check` regenerates from source and byte-compares. A book
    edited by hand — the exact failure mode a hand-maintained manifest has —
    fails here even if every field above still happens to agree.
    """
    r = subprocess.run([sys.executable, str(_BUILDER), "--check"],
                       cwd=str(_REPO), capture_output=True, text=True)
    assert r.returncode == 0, (
        "the checked-in address book is not what the declarations derive:\n"
        + r.stdout + r.stderr)
    # ⛔ NON-VACUITY ON THE SUBPROCESS. A builder that crashed before doing
    # anything could also exit 0 one day; this asserts it said what it does.
    assert "OK" in r.stdout and "metrics" in r.stdout, r.stdout


def test_the_derivation_rail_CAN_FAIL(tmp_path, monkeypatch):
    """⛔ THE MUTATION, RUN IN-PROCESS RATHER THAN DESCRIBED.

    A rail nobody has seen fail is not a rail. This corrupts a copy of the book
    — never the real one — and asserts the comparison notices.
    """
    book = _book()
    name = sorted(book["metrics"])[0]
    book["metrics"][name]["cadence"] = "intraday"
    corrupted = tmp_path / "book.json"
    corrupted.write_text(json.dumps(book, indent=2), encoding="utf-8")

    scalars = _scalars()
    reloaded = json.loads(corrupted.read_text(encoding="utf-8"))["metrics"]
    diverged = [n for n, d in scalars.items() if reloaded.get(n, {}).get("cadence") != d.get("cadence")]
    assert diverged == [name], (
        "the cadence comparison did not notice a corrupted entry — then it "
        "would not notice a real one either")


# ─────────────────────────────────────────────────────────────────────────────
# THE AXIS REPORT — reported, never asserted as a count
# ─────────────────────────────────────────────────────────────────────────────

def test_the_axes_are_REPORTED_not_assumed(capsys):
    """⭐ THE CORRECTION THIS CHECKPOINT MAKES, AS A TEST.

    `scan_evaluator.py`'s comment said "all 54 declared scalars are unanimous"
    and warned about "a fifty-fifth". The manifest declares far more than 54 and
    the unanimity claim is STILL TRUE — the mechanism was right and the number
    beside it drifted.

    ⛔ So this asserts the PROPERTY and PRINTS the count. It stays true the day
    a scalar is added, and goes red the day one arrives with a different cadence
    — which is the event the comment was actually about.
    """
    scalars = _scalars()
    stores = {(d.get("source") or {}).get("store") for d in scalars.values()}
    cadences = {d.get("cadence") for d in scalars.values()}
    grains = {(d.get("as_of") or {}).get("grain") for d in scalars.values()}

    print("[axis-report] metrics=%d stores=%s cadences=%s grains=%s"
          % (len(scalars), sorted(stores), sorted(cadences), sorted(grains)))

    assert stores == {"screener_rows"}, (
        "a scalar now declares a store other than screener_rows. That is the "
        "event D2 exists for — the address book must classify the new store in "
        f"PRD-D2 §7 before it can address it. Saw: {sorted(stores)}")
    assert cadences == {"nightly"}, (
        "a scalar now declares a non-nightly cadence. `cadence_ceiling` already "
        "handles it correctly; what must change is any PROSE claiming unanimity. "
        f"Saw: {sorted(cadences)}")
    assert grains == {"date"}, f"a scalar now declares a non-date grain: {sorted(grains)}"

    out = capsys.readouterr().out
    assert "[axis-report]" in out, "the report did not print — it reports nothing"


def test_the_book_carries_the_axis_report_it_derived():
    book = _book()
    rep = book["axis_report"]
    assert rep["metric_count"] == len(book["metrics"])
    assert sum(rep["stores"].values()) == len(book["metrics"])
    assert sum(rep["as_of_columns"].values()) == len(book["metrics"])
    # ⚠️ TWO AS-OF COLUMNS INSIDE ONE STORE — the fact PRD §6.2 found and the
    # reason `as_of` is a per-metric field rather than a per-store one.
    assert len(rep["as_of_columns"]) >= 2, (
        "the as-of column is no longer per-metric — if that became true, the "
        "address grammar's as_of axis can simplify, and that is a decision")


# ─────────────────────────────────────────────────────────────────────────────
# INERTNESS — CP1 is data nothing reads
# ─────────────────────────────────────────────────────────────────────────────

def _code_only(path: pathlib.Path) -> str:
    """⛔ CODE, NEVER PROSE. The PRD, the spec and three modules DISCUSS the
    address book by name; a substring search would match the discussion."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
    return ast.unparse(tree)


#: The ONE module CP2's approval lets read the book. ⛔ A LIST OF ONE, NOT A
#: DELETED RAIL: the point was never "nobody reads it", it was "the readers are
#: countable and named".
_ALLOWED_BOOK_READERS = ("api/services/canonical/address_book.py",)


def test_exactly_the_named_module_reads_the_address_book():
    """⛔⛔ THE READERS OF THE BOOK ARE COUNTABLE AND NAMED.

    ⚰️ CP1's version of this test required ZERO readers. Its sentence, kept
    verbatim because it is the reason this rail exists at all:

        "⛔⛔ CP1 IS INERT BY CONSTRUCTION, NOT BY INTENTION. The approval says
         the data is 'not read by any product path'. A reader is CP2 and needs a
         new line. This fails by name if one appears."

    That line was granted. The rail was NOT deleted when the thing it forbade
    was approved — deleting it would have converted "one reader, on purpose"
    into "any number of readers, unnoticed", which is how a canonical form
    becomes a second authority. It now fails by name on the SECOND reader.

    ⭐ `lesson_an_unused_parameter_may_be_older_than_its_consumers` runs the
    other way here: the data shipped BEFORE its consumers, on purpose, and this
    is what stops "before" from quietly becoming "instead of".
    """
    offenders = []
    scanned = 0
    for p in (_REPO / "api").rglob("*.py"):
        try:
            code = _code_only(p)
        except SyntaxError:
            continue
        scanned += 1
        rel = str(p.relative_to(_REPO)).replace(chr(92), "/")
        if "canonical_address_book" in code and rel not in _ALLOWED_BOOK_READERS:
            offenders.append(rel)
    assert scanned > 100, f"the module walk found almost nothing ({scanned}) — it is broken"
    assert offenders == [], (
        "a second product path reads the address book. CP2 approved exactly "
        f"one, {_ALLOWED_BOOK_READERS[0]}; another needs a new line: {offenders}")


def test_the_one_allowed_reader_ACTUALLY_READS_IT():
    """⛔ NON-VACUITY ON THE ALLOWLIST. An allowlist naming a module that does
    not read the book would make the test above pass by excusing nobody, and
    the next real reader would slip in beside it looking equally exempt."""
    for rel in _ALLOWED_BOOK_READERS:
        path = _REPO / rel
        assert path.exists(), f"the allowlist names a module that is not there: {rel}"
        assert "canonical_address_book" in _code_only(path), (
            f"{rel} is on the allowlist and does not read the book in CODE")


def test_the_inertness_rail_can_see_a_real_reference():
    """⛔ THE CONTROL. Without it, a broken walk or an over-eager stripper would
    make the assertion above pass over nothing."""
    raw = _BUILDER.read_text(encoding="utf-8")
    assert "canonical_address_book" in raw, "the needle is not even in the builder"
    code = _code_only(_BUILDER)
    assert "canonical_address_book" in code, (
        "the stripper removed a REAL code reference — then its absence in api/ "
        "proves nothing")


def test_the_book_is_committed_data_not_a_build_artifact():
    """It lives beside `cap_universe.json` in `api/data/`, and it is checked in.
    ⛔ A generated file that is NOT committed cannot be diffed in review, and a
    canonical form nobody reviews is a second authority with extra steps."""
    assert _BOOK_PATH.exists()
    r = subprocess.run(["git", "ls-files", "--error-unmatch",
                        str(_BOOK_PATH.relative_to(_REPO)).replace("\\", "/")],
                       cwd=str(_REPO), capture_output=True, text=True)
    assert r.returncode == 0, "the address book is not tracked by git"


# ─────────────────────────────────────────────────────────────────────────────
# CP2 — THE FIRST NON-SCREENER STORE
#
# ⛔ Every oracle below re-reads `bars_sqlite.py` ITSELF. Importing the builder's
# parser would prove only that the builder agrees with the builder — the shape
# of green that this programme has been caught by before.
# ─────────────────────────────────────────────────────────────────────────────

_BARS_MODULE = _REPO / "api" / "services" / "bars_sqlite.py"
_TICKER_RETURNS = _REPO / "api" / "services" / "ticker_returns.py"


def _ohlcv_ddl() -> str:
    """The `ohlcv` CREATE TABLE literal, read out of CODE.

    ⛔ CODE, NEVER PROSE — and this is not hypothetical here. `bars_sqlite.py`
    contains THREE string constants matching `CREATE TABLE`; one of them is a
    docstring saying a recovery helper "would run `CREATE TABLE` against
    damage". A scan that counted it would be measuring the module's explanation.
    """
    import re as _re
    src = ast.parse(_BARS_MODULE.read_text(encoding="utf-8"))
    for node in ast.walk(src):
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
    hits = [n.value for n in ast.walk(src)
            if isinstance(n, ast.Constant) and isinstance(n.value, str)
            and _re.search(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?ohlcv", n.value, _re.I)]
    assert len(hits) == 1, f"expected one ohlcv DDL in CODE, found {len(hits)}"
    return hits[0]


def _ohlcv_columns() -> list:
    """[(column, SQLTYPE)] in DDL order, parsed here rather than imported."""
    import re as _re
    body = _re.search(r"\((.*)\)", _ohlcv_ddl(), _re.S).group(1)
    cols = []
    for part in _re.split(r",(?![^(]*\))", body):
        part = part.strip()
        if not part or _re.match(r"PRIMARY\s+KEY", part, _re.I):
            continue
        bits = part.split()
        cols.append((bits[0], bits[1].upper()))
    assert cols, "parsed zero columns out of the ohlcv DDL — the oracle is broken"
    return cols


def _bars_store() -> dict:
    store = _book()["stores"].get("bars_sqlite")
    assert store, "the book carries no bars_sqlite store record"
    return store


def test_the_bars_side_is_NON_EMPTY_and_names_a_column_we_can_point_at():
    """⛔ NON-VACUITY FOR THE NEW STORE. Every bars assertion below is over
    these; `{} == {}` would satisfy all of them."""
    cols = dict(_ohlcv_columns())
    assert "c" in cols and cols["c"] == "REAL", (
        f"the DDL oracle cannot see the close column: {sorted(cols)}")
    metrics = {n: d for n, d in _book()["metrics"].items() if d["store"] == "bars_sqlite"}
    assert metrics, "the book carries no bars metrics"
    assert "ohlcv.c" in metrics


def test_every_ohlcv_VALUE_column_is_addressed_and_no_KEY_column_is():
    """A key is an AXIS, never a metric. `uct://ticker@…` would be an address
    whose metric is the entity it is already scoped by."""
    store = _bars_store()
    key = set(store["key"])
    declared = {c for c, _ in _ohlcv_columns()}
    expected = {"%s.%s" % (store["table"], c) for c in declared - key}
    got = {n for n, d in _book()["metrics"].items() if d["store"] == "bars_sqlite"}
    assert got == expected, (
        f"the addressed bars columns are not the DDL's value columns.\n"
        f"  missing: {sorted(expected - got)}\n  extra:   {sorted(got - expected)}")
    for k in key:
        assert "%s.%s" % (store["table"], k) not in got, (
            f"the key column {k!r} is addressed as a metric")


@pytest.mark.parametrize("column,sqltype", _ohlcv_columns())
def test_the_book_agrees_with_the_DDL_about(column, sqltype):
    """Per-column, so a failure names the column rather than the store."""
    store = _bars_store()
    name = "%s.%s" % (store["table"], column)
    if column in store["key"]:
        assert name not in _book()["metrics"]
        return
    entry = _book()["metrics"][name]
    assert entry["column"] == column
    assert entry["store"] == "bars_sqlite"
    assert entry["yields"] in ("num", "bool")
    assert entry["as_of_column"] == store["as_of_column"]


def test_the_as_of_column_is_the_one_the_store_asks_SINCE_WHEN_about():
    """⛔ DERIVED FROM THE DELTA QUERY, NOT FROM A NAME THAT LOOKS TEMPORAL.

    An as-of is the thing you compare against to ask "what is new". The store's
    own `… ts>? ORDER BY ts ASC` is that question written down. A rail that
    matched on the column being called `ts` would pass for a store that called
    it `updated_at` and filtered on something else.
    """
    import re as _re
    store = _bars_store()
    src = _BARS_MODULE.read_text(encoding="utf-8")
    pat = _re.compile(r"FROM\s+" + store["table"] + r"\b.*?\b(\w+)\s*>\s*\?", _re.I | _re.S)
    found = {m.group(1) for m in [pat.search(s) for s in [src]] if m}
    assert found == {store["as_of_column"]}, (
        f"the store's delta filter is over {sorted(found)}, the book says "
        f"{store['as_of_column']!r}")
    assert store["as_of_column"] in store["key"], (
        "the book calls a non-key column an as-of")


def test_THE_ROW_PROJECTION_IS_NOT_THE_SCHEMA_ORDER():
    """⛔⛔ THE FACT CP2's MIGRATED READER EXISTS FOR.

    `ohlcv`'s DDL order is `ticker, tf, ts, o, h, l, c, v` — the close is column
    6. The tuple the store's readers hand back is `SELECT ts,o,h,l,c,v` — the
    close is position 4. Both are true about the same column and only one of
    them indexes the tuple in your hand. If they ever coincided, this rail would
    stop distinguishing the two mistakes, so it asserts they do NOT.
    """
    store = _bars_store()
    ddl_order = [c for c, _ in _ohlcv_columns()]
    projection = store["row_projection"]
    assert projection, "the book declares no row projection"
    assert set(projection) <= set(ddl_order), (
        f"the projection names columns the DDL does not declare: "
        f"{sorted(set(projection) - set(ddl_order))}")
    assert ddl_order.index("c") != projection.index("c"), (
        "the schema position and the projection position now agree. That is not "
        "a failure of the store — it is a failure of THIS RAIL to distinguish "
        "them any more. Re-anchor it on a column where they still differ.")
    print("[cp2] ohlcv.c: DDL column %d, projection position %d"
          % (ddl_order.index("c") + 1, projection.index("c")))


def test_the_projection_is_shared_by_more_than_the_one_function_it_is_read_from():
    """⭐ THE BAR ROW IS A SHAPE, NOT ONE QUERY'S HABIT.

    ⚰️ The builder first demanded that ALL projections over `ohlcv` agree, and
    that was wrong: there are eleven, every one of them correct code answering a
    different question. The bar-row shape is derived from the function carrying
    the delta query, and this asserts at least one OTHER reader hands back the
    same tuple — otherwise the book would be describing a single query.
    """
    store = _bars_store()
    assert store["row_projection_declared_by"], "no declaring function recorded"
    assert store["row_projection_shared_with"], (
        "only one function returns this tuple — then it is that function's "
        "shape, not the store's row")
    assert store["distinct_projections_over_this_table"] > 1, (
        "the census found one projection; the eleven-shape finding that "
        "motivated this derivation is no longer observable")


def test_the_book_records_an_UNDECLARED_field_as_null_never_as_a_default():
    """⛔⛔ "WE COULD NOT COMPUTE IT" AND "NIGHTLY" ARE DIFFERENT FACTS.

    `cadence`, `grain` and `sentence` are declared for all 137 screener scalars
    and for none of the bars columns. Defaulting them to the book's only
    existing value — a one-word change — would make a continuously-fetched store
    look like a nightly batch one, in the very field `cadence_ceiling` reasons
    about. This is `CoverageLine`'s discipline at the metric layer.
    """
    store = _bars_store()
    undeclared = store["undeclared_by_this_store"]
    assert undeclared, "the store record claims to declare everything"
    for name, d in _book()["metrics"].items():
        if d["store"] != "bars_sqlite":
            continue
        for field in undeclared:
            assert d[field] is None, (
                f"{name}.{field} is {d[field]!r}; the store declares no {field}, "
                "so the book must say so rather than inherit a neighbour's value")
    # …and the axis report must SHOW them rather than hide them in a bucket.
    rep = _book()["axis_report"]
    assert "(undeclared)" in rep["cadences"], (
        "the axis report folded the undeclared cadences in with the declared "
        "ones — then nobody reading it can tell how much of the book is blank")


def test_the_declared_fields_are_STILL_declared_for_the_screener_store():
    """⛔ THE CONTROL FOR THE TEST ABOVE. Without it, a builder that wrote
    `None` into every field of every metric would satisfy it perfectly."""
    screener = [d for d in _book()["metrics"].values() if d["store"] == "screener_rows"]
    assert screener, "no screener metrics — the control has nothing to stand on"
    assert all(d["cadence"] is not None for d in screener)
    assert all(d["grain"] is not None for d in screener)
    assert all(d["sentence"] for d in screener)


def test_the_bars_store_record_names_the_module_it_was_derived_from():
    store = _bars_store()
    assert store["declared_in"] == "api/services/bars_sqlite.py"
    assert (_REPO / store["declared_in"]).exists()
    assert store["authority"] == "authoritative", (
        "PRD-D2 §7 classifies bars.db AUTHORITATIVE for bars, with the locked "
        "newest-bar-wins invariant")


# ─────────────────────────────────────────────────────────────────────────────
# THE MIGRATED READER — the static half. The dual-compute half is
# tests/test_d2_dual_read.py.
# ─────────────────────────────────────────────────────────────────────────────

def _legacy_close_index() -> int:
    """`LEGACY_CLOSE_INDEX` read off `ticker_returns.py` by AST.

    ⛔ Read from the module rather than imported so this rail still fails if the
    constant is deleted and a bare `4` reappears at the call sites — an import
    would raise ImportError, which reads as a broken test rather than as the
    regression it is.
    """
    tree = ast.parse(_TICKER_RETURNS.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "LEGACY_CLOSE_INDEX":
                    return node.value.value
    raise AssertionError(
        "ticker_returns.py no longer declares LEGACY_CLOSE_INDEX. If the bare "
        "ordinal came back, F-D2-3 came back with it.")


def test_the_migrated_readers_ORDINAL_agrees_with_the_book():
    """⛔ THE STATIC HALF OF THE MIGRATION, and the mutation subject for
    "rename a book entry".

    `ticker_returns.py` indexes the bars row by a hand-typed integer. The book
    resolves the same position from the store's declared projection. If a book
    entry is renamed, `row_position` returns None and this fails BY NAME —
    which is the difference between an address book and a comment.
    """
    from api.services.canonical import address_book as book_mod
    pos = book_mod.row_position("ohlcv.c")
    assert pos is not None, (
        "the book cannot resolve ohlcv.c — either the metric was renamed or the "
        "store declares no projection. Either way the migrated reader is now "
        "indexing on faith.")
    assert pos == _legacy_close_index(), (
        f"the book says the close is at position {pos}; ticker_returns.py reads "
        f"position {_legacy_close_index()}. One of them is serving the wrong "
        "column to the Desk.")


def test_the_ordinal_rail_CAN_FAIL(monkeypatch):
    """⛔ MUTATION A, run in-process: rename the book entry and watch the
    lookup stop resolving. A rail nobody has seen fail is not a rail."""
    from api.services.canonical import address_book as book_mod
    real = book_mod.book()
    mangled = json.loads(json.dumps(real))
    mangled["metrics"]["ohlcv.cc"] = mangled["metrics"].pop("ohlcv.c")
    monkeypatch.setattr(book_mod, "book", lambda: mangled)
    assert book_mod.row_position("ohlcv.c") is None, (
        "row_position resolved a metric the book no longer carries — then it "
        "would resolve a typo too, and every bad address would answer")
    assert book_mod.row_position("ohlcv.cc") == _legacy_close_index()


def test_row_position_returns_None_rather_than_a_plausible_default(monkeypatch):
    """⛔⛔ THE FAILURE THAT MATTERS IS NOT A MISSING BOOK, IT IS A MISS THAT
    ANSWERS ANYWAY. `0` for an unknown metric would resolve every bad address to
    the OPEN price and every consumer would keep working, wrongly, forever."""
    from api.services.canonical import address_book as book_mod
    assert book_mod.row_position("no_such_metric") is None
    monkeypatch.setattr(book_mod, "book", lambda: {})
    assert book_mod.row_position("ohlcv.c") is None
