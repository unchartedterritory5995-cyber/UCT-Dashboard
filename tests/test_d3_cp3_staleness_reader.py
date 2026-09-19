"""D3 CP3 (G3 + D3-D) — the bars lane's own staleness answer.

`SPEC-D3` §7.4 named G3 as the one gap that "blocks S7": the quote lane has
`realtime_stream.get_last_seen`, the bars lane has nothing, so a quiet symbol
scores as a price and manufactures a finding. `BarBroadcaster.last_tick_age(sym)`
is the read-only mirror of that accessor for the bars lane -- per-SYMBOL, across
any tf, updated on every AM/A/T event.

D3's own gate packet is explicit that CP3 has NO CALLER YET, and is explicit
about why that matters (§3 of the packet, quoting `price_level_projection.py`
verbatim): "all built, tested and green before anything called them -- which is
this repo's most-repeated defect ... and it very nearly shipped again here." A
read path with no caller is this same defect wearing a new name unless the rail
itself asserts the absence, which is what `test_nothing_in_api_calls_last_tick_age_yet`
below does.
"""
from __future__ import annotations

import ast
import pathlib
import time as _time

from api.services import bar_broadcaster as bb

_REPO = pathlib.Path(__file__).resolve().parents[1]
_T = 1_700_000_000_000  # ms, matches the other bar_broadcaster tests' shared timestamp


def _mk():
    b = bb.BarBroadcaster()
    b._emit = lambda *a, **k: None  # isolate: no event loop / subscribers needed
    return b


def _push_T(b, sym, price, size=100, t=_T):
    b.push_aggregate(sym, {"t": t, "p": price, "s": size, "c": None}, "T")


def _push_A(b, sym, close, t=_T):
    b.push_aggregate(sym, {"t": t, "o": close, "h": close, "l": close, "c": close, "v": 1}, "A")


def _push_AM(b, sym, close, t=_T):
    b.push_aggregate(sym, {"t": t, "o": close, "h": close, "l": close, "c": close, "v": 1}, "AM")


# ─────────────────────────────────────────────────────────────────────────────
# Behaviour
# ─────────────────────────────────────────────────────────────────────────────

def test_a_symbol_with_no_tick_ever_reads_none():
    b = _mk()
    assert b.last_tick_age("AAPL") is None


def test_an_AM_tick_makes_the_age_a_small_nonnegative_float():
    b = _mk()
    _push_AM(b, "AAPL", 100.0)
    age = b.last_tick_age("AAPL")
    assert age is not None
    # ⚠️ Generous bound on purpose: the first test in a module can carry several
    # seconds of one-time import overhead (measured: a "notebook migration"
    # side-effect on collection), which is real wall-clock time between the push
    # and the read and has nothing to do with this accessor's correctness. The
    # RELATIVE checks below (grows monotonically, resets on a new tick, never
    # shared across symbols) are what actually pin the behaviour.
    assert 0.0 <= age < 30.0, f"age should be small right after the push, got {age}"


def test_an_A_tick_and_a_T_tick_both_stamp_it_too():
    """G3 covers the bars lane whatever KIND produced the last tick -- AM, A or
    T all arrive through the same push_aggregate, and staleness must not go
    blind just because the last event happened to be a per-trade tick."""
    b = _mk()
    _push_A(b, "MSFT", 200.0)
    assert b.last_tick_age("MSFT") is not None
    b2 = _mk()
    _push_T(b2, "NVDA", 300.0)
    assert b2.last_tick_age("NVDA") is not None


def test_it_is_PER_SYMBOL_not_per_sym_tf():
    """push_aggregate("T") fans one trade out to every rollup tf at once
    (tf="1" plus every ROLLUP_TFS entry) -- last_tick_age must answer from the
    SYMBOL alone, not require the caller to also know which tf last ticked."""
    b = _mk()
    _push_T(b, "AAPL", 100.0)
    # last_tick_age takes only a symbol -- there is no tf parameter to get wrong,
    # and it must case-fold like every other accessor here. Two independent
    # time.monotonic() reads are never bit-identical, so this checks the SAME
    # underlying stamp was found (both non-None, both tiny), not byte equality.
    lower, upper = b.last_tick_age("aapl"), b.last_tick_age("AAPL")
    assert lower is not None and upper is not None
    assert abs(lower - upper) < 0.5, f"aapl/AAPL read different stamps: {lower} vs {upper}"


def test_the_age_actually_grows_between_two_reads():
    """A control against a stub that always returns 0 or a constant."""
    b = _mk()
    _push_AM(b, "AAPL", 100.0)
    first = b.last_tick_age("AAPL")
    _time.sleep(0.05)
    second = b.last_tick_age("AAPL")
    assert second > first, f"age did not grow: {first} -> {second}"


def test_a_later_tick_resets_the_age_toward_zero():
    b = _mk()
    _push_AM(b, "AAPL", 100.0)
    _time.sleep(0.05)
    before_refresh = b.last_tick_age("AAPL")
    _push_AM(b, "AAPL", 101.0)
    after_refresh = b.last_tick_age("AAPL")
    assert after_refresh < before_refresh


def test_two_symbols_do_not_share_a_staleness_clock():
    b = _mk()
    _push_AM(b, "AAPL", 100.0)
    assert b.last_tick_age("MSFT") is None, "an untouched symbol must stay None, not inherit AAPL's stamp"


# ─────────────────────────────────────────────────────────────────────────────
# The inertness rail -- CP3 ships a reader, and D3's own gate packet says the
# rail must assert nothing calls it yet, the same inertness assertion D2's CP1
# carried.
# ─────────────────────────────────────────────────────────────────────────────

_DEFINITION_FILE = "api/services/bar_broadcaster.py"


def _call_sites_of(attr_name: str, path: pathlib.Path):
    """Every `<expr>.<attr_name>(...)` call site in `path`, as (path, lineno).

    ⛔ AST, never a substring/grep match: `attr_name` also appears as the
    method's own `def` name and inside its own docstring/comments (this very
    file's docstring names it too) -- a text search cannot tell "defines it" or
    "talks about it" apart from "calls it". `ast.Call` with an `ast.Attribute`
    func is the one shape that means "somebody invoked it".
    """
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except SyntaxError:
        return []
    hits = []
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr == attr_name):
            hits.append((path, node.lineno))
    return hits


def test_nothing_in_api_calls_last_tick_age_yet():
    """⛔⛔ CP3 IS INERT BY CONSTRUCTION, NOT BY INTENTION. `last_tick_age` is a
    read path with no caller -- CP4 (or whichever checkpoint first consumes it)
    is a new line in D3's gate packet, not a silent adoption. This fails by
    name the moment a caller appears anywhere under api/."""
    offenders = []
    scanned = 0
    for p in (_REPO / "api").rglob("*.py"):
        rel = str(p.relative_to(_REPO)).replace(chr(92), "/")
        scanned += 1
        for _, lineno in _call_sites_of("last_tick_age", p):
            offenders.append(f"{rel}:{lineno}")
    assert scanned > 100, f"the module walk found almost nothing ({scanned}) -- it is broken"
    assert offenders == [], (
        "something now calls last_tick_age -- that is fine, but it needs its "
        f"own line in D3's gate packet (§3), not a silent adoption: {offenders}")


def test_the_call_site_detector_can_see_a_real_call():
    """⛔ THE CONTROL. Without it, a broken AST walk or an over-narrow node
    match would make the assertion above pass over nothing, which is exactly
    the failure mode this whole class of rail exists to catch (see this
    file's own module docstring precedent, `_call_sites_of`'s docstring, and
    `test_canonical_address_book.py::test_the_inertness_rail_can_see_a_real_reference`)."""
    synthetic = ast.parse("broadcaster.last_tick_age('AAPL')")
    hits = [n for n in ast.walk(synthetic)
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
            and n.func.attr == "last_tick_age"]
    assert len(hits) == 1, "the detector's own node-matching logic cannot see an obvious call"


def test_the_definition_itself_is_not_mistaken_for_a_call():
    """A `def last_tick_age(self, sym):` is a FunctionDef, never a Call -- the
    detector must not flag the method's own definition as a call site."""
    hits = _call_sites_of("last_tick_age", _REPO / _DEFINITION_FILE)
    assert hits == [], (
        f"the detector flagged the DEFINITION file as having caller(s): {hits} -- "
        "it is matching the def, not real calls")
