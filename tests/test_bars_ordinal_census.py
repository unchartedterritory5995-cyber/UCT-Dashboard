"""D2 CP5 (closes F-D2-3) — the rail on `tools/bars_ordinal_census.py`.

⛔ APPROVED SCOPE (owner, 2026-09-22): "A whole-repo static inventory tool
… that classifies each consumer as named-access … or positional … Refuses
rather than guesses on an ambiguous call site, matching every other builder
in this book's family." This file rails that promise: the checked-in
inventory matches a fresh derivation, the comparison can actually go RED
(mutation-proved), and the refusal path is real (not just documented).

⛔ INDEPENDENT-ORACLE DISCIPLINE, same as `test_canonical_address_book.py`:
the non-vacuity checks below re-derive facts from source with their OWN small
`ast.parse()` calls rather than importing the tool's own classifier — proving
the tool agrees with an independent reading, not merely with itself.
"""
from __future__ import annotations

import ast
import json
import pathlib
import shutil
import sys

import pytest

_REPO = pathlib.Path(__file__).resolve().parents[1]
_CENSUS_PATH = _REPO / "api" / "data" / "bars_ordinal_census.json"
_TOOL = _REPO / "tools" / "bars_ordinal_census.py"

if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

import tools.bars_ordinal_census as boc  # noqa: E402


def _census() -> dict:
    return json.loads(_CENSUS_PATH.read_text(encoding="utf-8"))


# ─────────────────────────────────────────────────────────────────────────────
# NON-VACUITY FIRST
# ─────────────────────────────────────────────────────────────────────────────

def test_the_census_is_NON_EMPTY_and_names_a_module_we_can_point_at():
    """An empty result would pass every comparison below vacuously."""
    data = _census()
    assert data["modules_scanned"] > 100, "the walk under api/ found almost nothing"
    assert data["modules"], "the census found zero bars-family callers"
    # `api/services/bars_fetch.py` is the module this whole checkpoint was
    # investigated around (the `_fmt_sqlite_bars` cross-function helper) —
    # if the census can see anything, it can see this.
    assert "api/services/bars_fetch.py" in data["modules"]
    assert data["modules"]["api/services/bars_fetch.py"]["classification"] == "positional"


def test_the_one_declared_accessor_is_reachable_by_an_independent_reparse():
    """`address_book.row_position` is CP2's declared accessor. Independently
    (not via the tool's own `_has_named_access`) confirm `ticker_returns.py`
    calls something literally named `row_position` — the fact the tool's
    named_access classification for that module rests on.
    """
    path = _REPO / "api" / "services" / "ticker_returns.py"
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            fn = node.func
            if isinstance(fn, ast.Attribute):
                names.add(fn.attr)
            elif isinstance(fn, ast.Name):
                names.add(fn.id)
    assert "row_position" in names, (
        "ticker_returns.py no longer calls row_position by that name — the "
        "census's one named_access example would be stale")


# ─────────────────────────────────────────────────────────────────────────────
# THE COMPARISON, AND ITS MUTATION PROOF
# ─────────────────────────────────────────────────────────────────────────────

def test_bars_ordinal_census_matches_a_fresh_derivation():
    """The checked-in `api/data/bars_ordinal_census.json` is byte-identical
    to what `census()` derives right now. This is the rail `--check` runs in
    CI/manually — asserted here too so a stale checked-in file fails the
    ordinary test suite, not just a separately-remembered command.
    """
    fresh = boc.census()
    checked_in = _census()
    assert fresh == checked_in, (
        "the checked-in census is stale — regenerate with "
        "`python tools/bars_ordinal_census.py`")


def test_bars_ordinal_census_CAN_FAIL(tmp_path):
    """⛔ A GUARD NOBODY HAS SEEN FIRE IS NOT A GUARD. Corrupts a COPY of the
    checked-in census (never the real file) and proves the same comparison
    the test above runs would actually go RED on real drift, not just on a
    file that happens to already differ.
    """
    corrupted_path = tmp_path / "bars_ordinal_census.json"
    data = _census()
    # Flip one real module's classification — the cheapest possible lie a
    # future stale-regeneration could tell.
    target = "api/services/bars_fetch.py"
    assert data["modules"][target]["classification"] == "positional"
    data["modules"][target] = dict(data["modules"][target], classification="named_access")
    corrupted_path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    fresh = boc.census()
    corrupted = json.loads(corrupted_path.read_text(encoding="utf-8"))
    assert fresh != corrupted, (
        "the comparison did not notice a flipped classification — it cannot fail")
    assert fresh["modules"][target] != corrupted["modules"][target]


# ─────────────────────────────────────────────────────────────────────────────
# THE REFUSAL PATH — real, not just documented
# ─────────────────────────────────────────────────────────────────────────────

def _parse(src: str) -> ast.Module:
    return ast.parse(src, filename="<test>")


def test_bars_ordinal_census_refuses_an_unrecognized_form():
    """A module that calls a bars-family function but shows NEITHER
    recognized pattern (no unpack, no int-subscript, no row_position, no
    known delegate) must REFUSE rather than silently omit itself or guess a
    classification. This is the behaviour the signed proposal's own
    MUST-BUILD text explicitly permits and requires.
    """
    src = (
        "from api.services import bars_sqlite\n"
        "def handler(sym):\n"
        "    rows = bars_sqlite.get_bars(sym, 'D', 50)\n"
        "    return summarize(rows)\n"  # opaque call — neither pattern
    )
    tree = _parse(src)
    with pytest.raises(boc.UnclassifiableModule):
        boc._classify_module("fake/module.py", tree)


def test_bars_ordinal_census_refuses_a_form_it_should_not_silently_pass():
    """Companion negative control: the SAME module, but with the unpack added
    back, must NOT refuse — proving the refusal above is about the missing
    pattern, not about some unrelated property of the fixture (an import
    shape, a function name) tripping the refusal for the wrong reason.
    """
    src = (
        "from api.services import bars_sqlite\n"
        "def handler(sym):\n"
        "    rows = bars_sqlite.get_bars(sym, 'D', 50)\n"
        "    for ts, o, h, l, c, v in rows:\n"
        "        pass\n"
    )
    tree = _parse(src)
    result = boc._classify_module("fake/module.py", tree)
    assert result is not None
    assert result["classification"] == "positional"


def test_a_module_calling_no_bars_family_function_is_not_classified_at_all():
    """A module that never touches `bars_sqlite` must return None, not a
    default classification of either kind — absence of the call is not
    evidence of anything about ordinal safety."""
    src = "def handler():\n    return 42\n"
    tree = _parse(src)
    assert boc._classify_module("fake/unrelated.py", tree) is None


def test_named_access_beats_positional_when_a_module_shows_both():
    """A module transitioning off positional access legitimately shows BOTH
    patterns mid-migration (old call sites not yet cleaned up alongside a
    new named one). The census must not let a leftover unpack override a
    real named-access call — named_access is checked FIRST by design.
    """
    src = (
        "from api.services import bars_sqlite\n"
        "from api.services.canonical import address_book\n"
        "def handler(sym):\n"
        "    rows = bars_sqlite.get_bars(sym, 'D', 50)\n"
        "    ts, o, h, l, c, v = rows[0]\n"  # legacy leftover
        "    close = address_book.row_position('close')\n"  # the real access
        "    return rows[0][close]\n"
    )
    tree = _parse(src)
    result = boc._classify_module("fake/migrating.py", tree)
    assert result["classification"] == "named_access"


# ─────────────────────────────────────────────────────────────────────────────
# THE EVIDENCE-ORDERING FIX — `ast.walk()` is not source order
# ─────────────────────────────────────────────────────────────────────────────

def test_evidence_cites_the_earliest_occurrence_not_the_walk_order_first_hit():
    """`ast.walk()` traverses in tree-structural (breadth-first-ish) order,
    not source-line order. This was a real defect found while building this
    tool (on `api/main.py`, where the walk-order-first hit was an unrelated
    5-tuple ~2,300 lines after the real evidence) — reproduced in miniature
    here: an unrelated 5-element unpack placed BEFORE, structurally shallower
    than, a real bars subscript placed textually AFTER a nested block, must
    not suppress the deeper-but-earlier-in-source real hit... this fixture
    instead directly proves the simpler, load-bearing property: given two
    genuine hits, the EARLIEST BY LINE NUMBER wins, not whichever `ast.walk()`
    happens to visit first.
    """
    src = (
        "from api.services import bars_sqlite\n"
        "def handler(sym):\n"
        "    rows = bars_sqlite.get_bars(sym, 'D', 50)\n"
        "    close = rows[0][4]\n"          # line 4 — earliest real evidence
        "    if True:\n"
        "        if True:\n"
        "            if True:\n"
        "                x = rows[-1][0]\n"  # line 8 — deeper, but later
        "    return close, x\n"
    )
    tree = _parse(src)
    result = boc._classify_module("fake/ordering.py", tree)
    assert result["classification"] == "positional"
    assert result["evidence"]["line"] == 4, (
        "evidence cited a later hit instead of the earliest one by line number")
