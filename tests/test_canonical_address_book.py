"""D2 CP1 — the derivation rail, and the rail that keeps CP1 inert.

⛔ APPROVED SCOPE (owner, 2026-09-12): *"CP1 — inert canonical address data …
+ the derivation rail that fails when a scalar name, store, cadence, or grain
diverges from closedTable.json."* Those four are asserted BY NAME below.

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
    """The first of the approval's four: a scalar NAME that diverges fails."""
    scalars, book = set(_scalars()), set(_book()["metrics"])
    missing = sorted(scalars - book)
    extra = sorted(book - scalars)
    assert not missing, (
        "closedTable.json declares metrics the address book does not carry — "
        f"re-run tools/build_canonical_address_book.py: {missing}")
    assert not extra, (
        "the address book carries metrics closedTable.json does not declare. A "
        f"metric with no declaration is a second authority: {extra}")


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


def test_no_product_path_reads_the_address_book():
    """⛔⛔ CP1 IS INERT BY CONSTRUCTION, NOT BY INTENTION.

    The approval says the data is *"not read by any product path"*. A reader is
    CP2 and needs a new line. This fails by name if one appears.

    ⭐ `lesson_an_unused_parameter_may_be_older_than_its_consumers` runs the
    other way here: the data ships BEFORE its consumers, on purpose, and the
    rail is what stops "before" from quietly becoming "instead of".
    """
    offenders = []
    scanned = 0
    for p in (_REPO / "api").rglob("*.py"):
        try:
            code = _code_only(p)
        except SyntaxError:
            continue
        scanned += 1
        if "canonical_address_book" in code:
            offenders.append(str(p.relative_to(_REPO)).replace("\\", "/"))
    assert scanned > 100, f"the module walk found almost nothing ({scanned}) — it is broken"
    assert offenders == [], (
        "a product path reads the CP1 address book. That is CP2 and it needs a "
        f"new approval line: {offenders}")


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
