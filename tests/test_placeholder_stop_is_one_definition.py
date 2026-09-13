"""H14 — one placeholder-stop detector, and the rail that keeps it one.

⛔ APPROVED SCOPE (owner, 2026-09-13), verbatim: *"one detector … the other two
call sites import it. A rail asserts only one definition exists. Test: a stop
drifted by float epsilon from entry is still classified placeholder; a stop $0.01
away is real. Mutation: restore the weakest tolerance → RED."*

⛔⛔ THE DEFECT THIS CLOSES IS A FALSE ALERT, NOT A WRONG NUMBER. A broker
placeholder the detector fails to recognise reaches `rule_stop_watch`'s distance
test; a stop at-or-through the price emits `stop_hit` at importance 10, and
importance ≥ 8 away-delivers by email and Discord. A member is told their stop
was hit, about a stop they never set.

⭐ THE THREE TOLERANCES, AND THE ROW THAT SEPARATED THEM — ORCL, entry 126.0049
against stop 126.005, a drift of 1.0e-4:

    awareness/rules.py    abs < 1e-9                        -> NOT placeholder
    portfolio_heat.py     rel 1e-9  (1.3e-7 at that price)  -> NOT placeholder
    broker/balances.py    max(0.001, entry*1e-5)            -> placeholder

Two of the three missed the real case, including the one whose own comment calls
itself SAFETY-CRITICAL.
"""
from __future__ import annotations

import ast
import math
import pathlib
import re

import pytest

from api.services import placeholder_stop as ps
from api.services.placeholder_stop import is_placeholder_stop

_REPO = pathlib.Path(__file__).resolve().parents[1]

#: The three modules the scope names. ⛔ Listed so a failure names the FILE.
_CALL_SITES = (
    "api/services/awareness/rules.py",
    "api/services/portfolio_heat.py",
    "api/services/journal_two/broker/balances.py",
    # ⭐ THE RAIL FOUND THESE TWO. The instruction named three detectors; there
    # were five, and neither of these appears in any prior write-up.
    "api/services/journal_two/tag_suggest.py",
    "api/services/journal_two/metrics_registry.py",
)

#: The row that actually happened.
ORCL_ENTRY, ORCL_STOP = 126.0049, 126.005


#: A placeholder TEST, not a risk width.
#:
#: ⛔⛔ THE COMPARISON IS THE WHOLE DISCRIMINATOR, AND THE FIRST VERSION OF THIS
#: PATTERN LACKED IT. `abs(entry - stop)` is ALSO how you compute risk per
#: share — `metrics_registry.py:329` does exactly that, one line below a real
#: placeholder test. A pattern that matched the subtraction alone would report
#: the risk arithmetic as a sixth detector and be "fixed" by deleting the
#: exemption, which is how a rail starts lying.
_STOPISH = r"(?:float\s*\(\s*)?\w*stop\w*\s*\)?"
_ENTRYISH = r"(?:float\s*\(\s*)?\w*entry\w*\s*\)?"
_PLACEHOLDER_TEST_RX = re.compile(
    r"abs\s*\(\s*" + _STOPISH + r"\s*-\s*" + _ENTRYISH + r"\s*\)\s*[<>]=?",
    re.I)


def _code_only(path: pathlib.Path) -> str:
    """⛔ CODE, NEVER PROSE. Every one of these files now QUOTES its retired
    tolerance verbatim in a ⚰️ block — that is the idiom — so a raw search
    would find three copies of the old arithmetic and this rail would fail
    forever on its own documentation."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
    return ast.unparse(tree)


# ═════════════════════════════════════════════════════════════════════════
# THE TWO TESTS THE SCOPE NAMES
# ═════════════════════════════════════════════════════════════════════════

def test_a_stop_drifted_by_float_epsilon_is_STILL_a_placeholder():
    """The trapdoor `portfolio_heat`'s own comment describes: any path that
    RECOMPUTES rather than copies leaves the two a few ULPs apart."""
    for entry in (1.0, 12.34, 126.0049, 999.99, 10_000.0):
        eps = math.ulp(entry)
        for stop in (entry, entry + eps, entry - eps, entry + 8 * eps, entry - 8 * eps):
            assert is_placeholder_stop(stop, entry), (
                f"entry={entry!r} stop={stop!r} (drift {abs(stop-entry):.3e}) "
                "read as a REAL stop")


def test_a_stop_a_CENT_away_is_a_REAL_stop():
    """⛔ THE OTHER DIRECTION, AND IT IS THE COST OF THE WIDE WINDOW. A member
    who set a genuine stop must keep being watched."""
    for entry in (1.0, 12.34, 126.0049, 999.99):
        for stop in (entry - 0.01, entry + 0.01):
            assert not is_placeholder_stop(stop, entry), (
                f"entry={entry!r} stop={stop!r} — a one-cent stop is a real stop")


def test_the_ORCL_ROW_THAT_ACTUALLY_HAPPENED_is_a_placeholder():
    """⭐ The regression this whole item exists for, pinned by its own values."""
    assert is_placeholder_stop(ORCL_STOP, ORCL_ENTRY)
    # …and the two retired tolerances would BOTH have said no. Reproduced here
    # so the failure they shared is checkable rather than remembered.
    assert not (abs(ORCL_STOP - ORCL_ENTRY) < 1e-9), "the old absolute rule"
    assert not (abs(ORCL_STOP - ORCL_ENTRY) <= abs(ORCL_ENTRY) * 1e-9), "the old relative rule"


# ═════════════════════════════════════════════════════════════════════════
# THE UNUSABLE CLAUSE — and the behaviour it changes, declared
# ═════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("stop,entry", [
    (0, 100.0), (-1.0, 100.0), (100.0, 0), (100.0, -1.0),
    (None, 100.0), (100.0, None), ("", 100.0), ("abc", 100.0),
])
def test_an_UNUSABLE_stop_is_not_a_stop(stop, entry):
    """⛔ A STOP OF 0 ON A SHORT COMPUTES A DISTANCE OF -1.0 AND FIRES ON EVERY
    CYCLE. `_stop_distance_pct("Short", price, 0)` is `(0 - price)/price`, which
    is ≤ 0, which is `stop_hit`. Before H14 only `portfolio_heat` treated a
    non-positive stop as unusable; `rule_stop_watch` did not, so this clause is
    a BEHAVIOUR CHANGE for broker rows and is declared rather than absorbed."""
    assert is_placeholder_stop(stop, entry)


def test_it_never_raises_on_anything_a_row_could_hold():
    """The detector sits on a scheduler path that must not die on one bad row."""
    for junk in (object(), [], {}, float("nan"), float("inf")):
        is_placeholder_stop(junk, 100.0)
        is_placeholder_stop(100.0, junk)


def test_NaN_is_unusable_rather_than_silently_real():
    """⚠️ `abs(nan - x) <= y` is False, so a naive comparison calls NaN a REAL
    stop — the worst answer. Asserted separately because it is the one input
    where the arithmetic quietly does the wrong thing."""
    assert is_placeholder_stop(float("nan"), 100.0)
    assert is_placeholder_stop(100.0, float("nan"))


# ═════════════════════════════════════════════════════════════════════════
# ⛔⛔ ONLY ONE DEFINITION EXISTS
# ═════════════════════════════════════════════════════════════════════════

def test_only_ONE_module_defines_a_placeholder_stop_test():
    """⛔ THE RAIL THE SCOPE NAMES. It fails BY NAME on the fourth copy.

    ⭐ Matched on the ARITHMETIC, not on a function name. A second detector
    would not be called `is_placeholder_stop` — the three that existed were
    called `_is_placeholder_stop`, `stop_is_placeholder` and nothing at all.
    What they had in common was comparing a stop to an entry against a
    tolerance, and that is what this looks for.
    """
    rx = _PLACEHOLDER_TEST_RX
    offenders, scanned = [], 0
    for p in (_REPO / "api").rglob("*.py"):
        if p.name.startswith("test_") or p.name.endswith("_test.py"):
            continue
        try:
            code = _code_only(p)
        except SyntaxError:
            continue
        scanned += 1
        rel = str(p.relative_to(_REPO)).replace(chr(92), "/")
        if rx.search(code) and rel != "api/services/placeholder_stop.py":
            offenders.append(rel)
    assert scanned > 100, f"the module walk found almost nothing ({scanned}) — it is broken"
    assert offenders == [], (
        "a second placeholder-stop test exists in code. H14 unified three into "
        f"one; this is the fourth: {offenders}")


def test_the_one_definition_rail_CAN_SEE_A_REAL_ONE():
    """⛔ NON-VACUITY. Without this, a broken regex would report a clean repo."""
    rx = _PLACEHOLDER_TEST_RX
    code = _code_only(_REPO / "api" / "services" / "placeholder_stop.py")
    assert rx.search(code), (
        "the pattern cannot even see the one definition it is meant to exempt — "
        "then its silence about every other file means nothing")


@pytest.mark.parametrize("rel", _CALL_SITES)
def test_each_call_site_IMPORTS_the_detector_and_defines_none(rel):
    """Per file, so a failure names the module rather than 'a call site'."""
    path = _REPO / rel
    code = _code_only(path)
    assert "from api.services.placeholder_stop import is_placeholder_stop" in code, (
        f"{rel} does not import the shared detector")
    assert "is_placeholder_stop(" in code, f"{rel} imports it and never calls it"
    # ⛔ CONTROL: the ⚰️ block quoting the retired arithmetic must still be in
    # the RAW file, so "absent from code" is a statement about code.
    raw = path.read_text(encoding="utf-8")
    assert "1e-9" in raw or "1e-5" in raw, (
        f"{rel}'s ⚰️ record of what was retired is gone — the next reader now "
        "has a change with no reason attached")


def test_portfolio_heats_own_name_still_works_for_its_callers():
    """The forward is kept so this module's call sites and tests do not move."""
    from api.services import portfolio_heat as ph
    assert ph._is_placeholder_stop(ORCL_STOP, ORCL_ENTRY) is True
    assert ph._is_placeholder_stop(ORCL_ENTRY - 0.01, ORCL_ENTRY) is False


# ═════════════════════════════════════════════════════════════════════════
# THE SOURCE GATE STAYED AT THE CALL SITE
# ═════════════════════════════════════════════════════════════════════════

def test_rule_stop_watch_still_gates_on_SOURCE_and_now_skips_the_drifted_row():
    """⭐ END TO END, THROUGH THE REAL RULE. The detector could be perfect and
    the rule could still fire if the wiring were wrong."""
    from api.services.awareness import rules as r

    def pos(**kw):
        base = dict(symbol="ORCL", side="Long", stop_price=ORCL_STOP,
                    entry_price=ORCL_ENTRY, source="broker")
        base.update(kw)
        return base

    ctx = {"live_prices": {"ORCL": 100.0}}          # well through the "stop"

    # NON-VACUITY: the same position with a REAL stop must fire, or the
    # assertions below prove only that the rule is inert.
    fired = r.rule_stop_watch(ctx, {"positions": [pos(stop_price=110.0)]})
    assert [c.kind for c in fired] == ["stop_hit"], (
        "the rule does not fire on a genuine through-the-stop row — then its "
        "silence on the placeholder proves nothing")

    # THE FIX: the drifted broker placeholder is skipped.
    assert r.rule_stop_watch(ctx, {"positions": [pos()]}) == []

    # THE POLICY THAT STAYED: a non-broker row is NOT skipped by source, so the
    # member's own stop is still watched whatever its value.
    manual = r.rule_stop_watch(ctx, {"positions": [pos(source="manual")]})
    assert [c.kind for c in manual] == ["stop_hit"], (
        "the source gate was folded into the detector — a member's own stop "
        "must not be discarded because it happens to sit near their entry")


def test_a_zero_stop_on_a_SHORT_no_longer_fires_every_cycle():
    """⛔ THE SECOND FALSE ALERT THE UNUSABLE CLAUSE REMOVES, demonstrated
    rather than described."""
    from api.services.awareness import rules as r
    ctx = {"live_prices": {"XYZ": 50.0}}
    short0 = dict(symbol="XYZ", side="Short", stop_price=0.0,
                  entry_price=50.0, source="broker")
    assert r.rule_stop_watch(ctx, {"positions": [short0]}) == []
    # NON-VACUITY: the pre-H14 arithmetic really did produce a fire here.
    assert r._stop_distance_pct("Short", 50.0, 0.0) <= 0


# ═════════════════════════════════════════════════════════════════════════
# THE TOLERANCE IS THE PROTECTIVE ONE, PINNED
# ═════════════════════════════════════════════════════════════════════════

def test_the_adopted_tolerance_is_the_WIDEST_of_the_three_not_the_narrowest():
    """⛔⛔ THE MUTATION SUBJECT, AND THE READING IT ENCODES.

    "Strictest" split two ways: narrowest tolerance is `rules.py`'s absolute
    1e-9 — the value that PRODUCED the defect — and strictest-about-what-counts-
    as-a-real-stop is `balances.py`'s wide window. This pins the second, so
    restoring either retired value goes red here by name.
    """
    assert ps.PLACEHOLDER_STOP_ABS_TOL == 0.001
    assert ps.PLACEHOLDER_STOP_REL_TOL == 1e-5
    width = lambda e: max(ps.PLACEHOLDER_STOP_ABS_TOL, e * ps.PLACEHOLDER_STOP_REL_TOL)
    for entry in (1.0, 126.0049, 10_000.0):
        assert width(entry) > entry * 1e-9, (
            "the adopted window is narrower than portfolio_heat's retired "
            "relative rule — that rule missed the real row")
        assert width(entry) > 1e-9, (
            "the adopted window is narrower than rules.py's retired absolute "
            "rule — that rule is the defect")
