"""The panel's field names must exist in the payload the route actually sends.

⛔⛔ THE DEFECT THIS COMES FROM, AND IT SHIPPED. `StructureProvenance.jsx` read
`evidence.lift_pp` and `evidence.ci_pp`. `lift_ledger.for_structure()` returns
`lift`, `ci_low` and `ci_high` — and as FRACTIONS, not percentage points. So
`formatLift` returned null for every structure and the panel rendered "No
measured edge published" across the entire library, including the four rows that
had cleared all four gates. TWENTY-SIX GREEN TESTS stood over it, because the
fixture was written from an assumption about the payload instead of from the
payload.

⭐ NEITHER LANE COULD HAVE CAUGHT IT ALONE. A vitest file cannot see Python; a
pytest file cannot render React. The contract lives in the gap between them, and
`lesson_rail_the_mirror_not_just_the_lane` says the fix has to be railed in each
lane — so this is the Python half: it reads the JSX and checks the names against
a real row.

⛔ THE FIELD LIST IS EXTRACTED FROM THE COMPONENT, NEVER TYPED HERE. A typed
list would be a third copy of the contract and would go stale the first time
someone reads a new field — which is exactly the moment this needs to fire.
"""
import sys, pathlib, re
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

from api.services.screener import lift_ledger

ROOT = pathlib.Path(__file__).resolve().parents[1]
PANEL = ROOT / "app/src/components/screener/StructureProvenance.jsx"

#: Fields the panel reads that the ledger legitimately omits on some rows.
#: `reasons` exists only on a REFUSED row; `note` only where one was written.
#: Each must still appear on SOME real row — `test_optional_fields_are_real`
#: refuses to let this become a place to hide a typo.
OPTIONAL = {"reasons", "note"}


def _fields_read_by_the_panel() -> set:
    src = PANEL.read_text(encoding="utf-8")
    # `evidence.foo` in the component body...
    fields = set(re.findall(r"\bevidence\.([a-zA-Z_][a-zA-Z0-9_]*)", src))
    # ...ignoring destructuring of our own derived object (`lift.headline`).
    return fields


#: ⛔ THE ROUTE'S VIEW, not `for_structure`. `api/routers/screener.py` attaches
#: `evidence_for_structure`, and a rail pointed at the wrong function would
#: check a contract nobody uses. `test_the_route_uses_the_view_this_rail_checks`
#: pins that they stay the same function.
def _a_published_row() -> dict:
    for key in lift_ledger.load().get("structures", {}):
        row = lift_ledger.evidence_for_structure(key)
        if row and row.get("published"):
            return row
    pytest.skip("no published row in the ledger to check the contract against")


def _a_refused_row() -> dict:
    for key in lift_ledger.load().get("structures", {}):
        row = lift_ledger.evidence_for_structure(key)
        if row and not row.get("published"):
            return row
    return {}


def test_the_route_uses_the_view_this_rail_checks():
    """⛔ A rail pointed at the wrong function proves nothing about the page.
    Read the router and confirm it attaches the view checked above."""
    src = (ROOT / "api/routers/screener.py").read_text(encoding="utf-8")
    assert "evidence_for_structure" in src, (
        "the provenance route no longer attaches `evidence_for_structure`, so "
        "this rail is checking a contract the page does not use")
    assert 'lift_ledger.for_structure(' not in src, (
        "the route is back on `for_structure`, which collapses refusals to "
        "None — the panel's 'measured, not published' branch would be dead")


def test_a_refusal_carries_no_numeric_field_to_headline():
    """⭐ THE GUARANTEE THAT MAKES THE THIRD STATE SAFE. `for_structure`
    collapses refusals to None precisely so nobody renders one as a weak
    positive. The view keeps the distinction and satisfies that concern by
    CONSTRUCTION instead: there is no number to headline."""
    row = _a_refused_row()
    if not row:
        pytest.skip("no refused row in the ledger right now")
    for banned in ("lift", "ci_low", "ci_high", "n", "null_max", "rate",
                   "baseline"):
        assert banned not in row, (
            f"a refused row exposes {banned!r}; a caller could headline it, "
            f"which is exactly what collapsing refusals was protecting against")
    assert set(row) == {"published", "reasons"}


# ─── controls, first ────────────────────────────────────────────────────────

def test_the_extraction_actually_finds_fields():
    """⛔ NON-VACUITY. The rule below asserts "every extracted field exists".
    An extraction that finds NOTHING satisfies that vacuously and passes
    loudly — which is the same shape as the bug it is guarding."""
    fields = _fields_read_by_the_panel()
    assert len(fields) >= 5, (
        f"only {sorted(fields)} extracted from {PANEL.name} — the regex is not "
        f"reading the component, so this rail proves nothing")
    assert "lift" in fields, (
        "the panel must read the lift; if it no longer does, this rail is "
        "pointed at the wrong file")


def test_the_check_can_fail_on_a_planted_mismatch():
    """The comparison responds to input. Without this, a check that compared a
    set against itself would pass forever."""
    row = _a_published_row()
    planted = {"lift", "lift_pp"}          # `lift_pp` is the field that shipped
    missing = {f for f in planted if f not in row}
    assert missing == {"lift_pp"}, (
        "the contract check cannot tell a real field from an invented one")


# ─── the rule ───────────────────────────────────────────────────────────────

def test_every_field_the_panel_reads_exists_on_a_real_row():
    row = _a_published_row()
    unknown = sorted(f for f in _fields_read_by_the_panel()
                     if f not in row and f not in OPTIONAL)
    assert not unknown, (
        f"`StructureProvenance.jsx` reads {unknown} off `evidence`, but "
        f"`lift_ledger.for_structure()` returns {sorted(row)}. The panel will "
        f"silently render nothing for those. If a name changed, change it in "
        f"BOTH lanes — this is the mirror, and it has to be railed on each side."
    )


def test_optional_fields_are_real_somewhere():
    """⛔ THE OPTIONAL LIST IS NOT AN ESCAPE HATCH. A field exempted here must
    still appear on some real row, or the exemption is hiding a typo."""
    published, refused = _a_published_row(), _a_refused_row()
    for f in OPTIONAL:
        if f not in _fields_read_by_the_panel():
            continue
        assert f in published or f in refused, (
            f"{f!r} is exempted as optional but appears on NO real ledger row")


def test_the_units_are_fractions_so_the_panel_must_scale_them():
    """⭐ THE HALF OF THE BUG A NAME CHECK WOULD MISS. Even with the right field
    name, `lift` is a FRACTION (0.0735), and rendering it as "0.07pp" instead of
    "+7.35pp" is a wrong number rather than a missing one — strictly worse. This
    pins the unit at the source so the panel's `* 100` stays correct."""
    row = _a_published_row()
    assert abs(row["lift"]) < 1.5, (
        f"lift={row['lift']} — the ledger has started storing percentage points "
        f"rather than fractions, and `StructureProvenance.jsx` multiplies by 100")
    for k in ("ci_low", "ci_high", "null_max"):
        if isinstance(row.get(k), (int, float)):
            assert abs(row[k]) < 1.5, f"{k}={row[k]} is not a fraction"


def test_a_refused_row_carries_its_reasons():
    """The panel renders "measured, not published" plus the reasons. If refused
    rows stopped carrying `reasons`, that branch would render an empty list."""
    row = _a_refused_row()
    if not row:
        pytest.skip("no refused row in the ledger right now")
    assert isinstance(row["reasons"], list) and row["reasons"]
    assert all(isinstance(r, str) and r for r in row["reasons"])
