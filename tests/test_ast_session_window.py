r"""⭐⭐ THE `session` LOOKBACK GRAMMAR — AND THE PLANTED-`forward` RAIL.

Two declarations, one new and one only ever proved by a single lucky entry:

  * ``lookback: "session"`` — a window that runs back to the first bar of the
    bar's own New York calendar day. It is not ``argN``: no argument carries it,
    because the number of bars in a session is a property of the CALENDAR and the
    TIMEFRAME, not of anything the author typed.
  * ``forward: "argN"`` — already shipped (``ichimokuChikou`` declares
    ``forward: "arg4"``), and pinned HERE against a grammar the manifest does not
    ship, so the pivot work (which will declare ``forward: "arg2"``) rests on a
    measured rail rather than on one indicator's good behaviour.

🔴 THE NUMBER IS THE WHOLE TASK, AND THE BRIEF'S NUMBER WAS WRONG.

The brief specified ``SESSION_MAX_BARS = 390`` on the reasoning *"a session on 1m
is <= 390 bars"*. 390 is the REGULAR-HOURS session (09:30-16:00 ET). This engine's
session is the **ET CALENDAR DAY** — ``computeVWAP`` says so in its own words
(*"ET midnight IS the extended-hours session boundary for US equity bars, whose
first print is 04:00 ET — and it is deliberately NOT 09:30"*), ``sessionfirst``
says so (*"1 on the first bar of a New York calendar day"*), and
``etAnchorKey(t, 'session')`` is the ET civil date. The extended session runs
04:00-20:00 ET = **960 minutes**, and ``bars_fetch`` sizes every intraday fetch
off exactly that (``bars_per_day = (16 * 60) // multiplier``, *"16hr/day to
account for extended hours"*).

MEASURED ON THE LIVE STORE (bars.db under the shared data root, read-only,
2026-08-26): SPY 1-minute holds **947 bars in one ET calendar day** (2026-06-10),
stamped from minute-of-day 240 (04:00) to 1199 (19:59). 390 UNDER-STATES THAT BY
557 BARS — and ``_functions_warmup`` names under-stating as the one direction a
window declaration may never take, because it hands back numbers computed from
bars that were never fetched.
``test_the_declared_session_window_is_TRUE_on_a_real_session`` below is that
measurement as a test: it trims the series to the declared window and watches the
value hold, and its control trims to 390 and watches it move.
"""
from __future__ import annotations

import datetime
import io
import json
import pathlib
import re

import pytest
from zoneinfo import ZoneInfo

from api.services import ast_budget, ast_interpret, ast_lint
from api.services.indicator_compute import compute_vwap_raw

ET = ZoneInfo("America/New_York")
ROOT = pathlib.Path(__file__).resolve().parents[1]
JS_DIR = ROOT / "app" / "src" / "components" / "chart" / "engine" / "ast"
TABLE_PATH = JS_DIR / "closedTable.json"
TABLE = json.loads(io.open(TABLE_PATH, encoding="utf-8").read())

SER = {"type": "series", "name": "close"}


def _call(name, *args):
    return {"type": "call", "name": name, "args": list(args)}


def _num(v):
    return {"type": "num", "value": v}


# --------------------------------------------------------------------------- #
# the constant — ONE authority, and it is the manifest both lanes already read
# --------------------------------------------------------------------------- #

def test_the_session_bound_is_DATA_in_the_manifest_not_a_constant_in_a_lane():
    """⛔ IT CANNOT LIVE IN A LANE, AND THE LINTER'S IMPORT RAIL IS WHY.

    ``test_no_evaluator_is_reachable_from_the_linter`` pins ``ast_lint``'s import
    set to the standard library — it may not import ``ast_interpret`` or
    ``ast_table`` — and ``lint.test.js`` pins ``lint.js``'s imports to exactly
    ``['./parse.js']``. So the ONE place four readers in two languages can all
    see this number is the table itself, which is DATA for precisely that reason.
    """
    assert isinstance(TABLE.get("sessionMaxBars"), int), (
        "closedTable.json declares no `sessionMaxBars`. A per-lane constant would "
        "be four hand-written copies of one number across two languages — the "
        "shape that branded ADX as repainting in production.")
    assert TABLE["sessionMaxBars"] >= 1


def test_both_python_lanes_read_the_SAME_bound_and_the_same_sentinel():
    """The interpreter and the linter are separate modules on purpose. They may
    not disagree about how long a session is."""
    assert ast_interpret.SESSION_MAX_BARS == ast_lint.SESSION_MAX_BARS
    assert ast_interpret.SESSION_MAX_BARS == TABLE["sessionMaxBars"]
    assert ast_interpret.SESSION_LOOKBACK == ast_lint.SESSION_LOOKBACK == "session"


def test_the_js_lane_reads_the_bound_off_the_same_manifest_key():
    """⛔ DERIVED FROM THE SOURCE, NEVER RETYPED HERE. `parse.js` is the JS home
    for a grammar constant both the interpreter and the linter must see — the
    placement `LOOKBACK_RE` was forced into by the very same import rail."""
    src = io.open(JS_DIR / "parse.js", encoding="utf-8").read()
    assert re.search(r"export const SESSION_LOOKBACK = 'session'", src), (
        "parse.js does not export the `session` sentinel")
    m = re.search(r"export const SESSION_MAX_BARS = (.*?)(?=\nexport |\n/\*\*|\Z)",
                  src, re.S)
    assert m, "parse.js does not export SESSION_MAX_BARS"
    body = m.group(1)
    assert "TABLE.sessionMaxBars" in body, (
        "SESSION_MAX_BARS does not read the manifest key both lanes share: "
        f"{body!r}")
    # ⛔ THE CONTROL: a read that ALSO carries the number is still a second copy,
    # and it would go stale the day the manifest moved.
    assert str(TABLE["sessionMaxBars"]) not in body, (
        "parse.js spells the session bound as a literal beside the manifest read "
        "— that is the second authority, not a reader")


# --------------------------------------------------------------------------- #
# the grammar — every reader of a declared lookback
# --------------------------------------------------------------------------- #

def test_the_interpreter_reads_a_session_lookback():
    """Step 1's headline: a planted spec, through the interpreter's own reader."""
    node = _call("plantedsession", SER)
    spec = {"args": ["series"], "lookback": "session"}
    assert ast_interpret._own_lookback(node, spec) == ast_interpret.SESSION_MAX_BARS


def test_the_linter_reads_a_session_lookback_as_the_SAME_number():
    """⛔ THE TWO `max_lookback`s MUST NOT DRIFT. `ast_lint.max_lookback` and
    `ast_interpret.max_lookback` are separate implementations, and a lane that
    read `session` as UNKNOWN would brand every session-anchored indicator
    `repaints` — the ADX defect, one grammar later."""
    assert ast_lint._resolve_declaration("session", []) == ast_lint.SESSION_MAX_BARS


def test_a_session_window_reaches_BACKWARD_only():
    """A backward window has forward reach 0 whatever its size — so a session
    function is `non-repainting`, which is the whole reason it may be declared."""
    planted = {**TABLE, "functions": {**TABLE["functions"], "plantedsession": {
        "args": ["series"], "lookback": "session", "yields": "num",
        "sentence": "a planted session-anchored value"}}}
    tree = _call("plantedsession", SER)
    reach = ast_lint.ast_reach(tree, {"table": planted})
    assert reach["back"] == ast_lint.SESSION_MAX_BARS
    assert reach["forward"] == 0
    assert ast_lint.mode_from_reach(reach["forward"]) == "non-repainting"


def test_a_session_lookback_is_NOT_pointwise():
    """`is_pointwise` is `lookback == 0` and it decides whether a value may be
    applied one bar at a time inside a recurrence step. A session-anchored value
    reads a whole day, so it must never qualify — and this asks the shipped
    reader rather than trusting that `"session" != 0`."""
    from api.services.ast_table import is_pointwise
    assert not is_pointwise({"args": ["series"], "lookback": "session"})
    assert is_pointwise({"args": ["series"], "lookback": 0})


def test_an_unreadable_lookback_STILL_refuses_after_session_joins_the_grammar():
    """⛔ THE CONTROL. A grammar that accepted anything would pass every case
    above while letting a typo'd declaration through as some silent default."""
    node = _call("x", _num(5))
    for bad in ("arg1+arg2", "2*", "*arg1", "period", "arg", "2*argX",
                "sessions", "SESSION", "session "):
        with pytest.raises(Exception):
            ast_interpret._own_lookback(node, {"lookback": bad})
        assert ast_lint._resolve_declaration(bad, [_num(5)]) == ast_lint.UNKNOWN


# --------------------------------------------------------------------------- #
# ⭐ THE DECLARED PROPERTY MUST BE TRUE — measured, not asserted
# --------------------------------------------------------------------------- #

def _minute_bars(days, first_day=(2026, 6, 10)):
    """One-minute bars across `days` consecutive ET calendar days, 04:00-19:59 ET
    — the extended session this engine's `session` anchor buckets by."""
    y, m, d = first_day
    out = []
    for day in range(days):
        base = datetime.datetime(y, m, d, 4, 0, tzinfo=ET) + datetime.timedelta(days=day)
        for i in range(16 * 60):
            ts = int((base + datetime.timedelta(minutes=i)).timestamp())
            # A price that MOVES, so a truncated accumulator cannot coincidentally
            # match the full one.
            px = 100.0 + (day * 17) + i * 0.01
            out.append({"t": ts, "o": px, "h": px + 0.2, "l": px - 0.2, "c": px,
                        "v": 1000.0 + (i % 97)})
    return out


def test_a_full_extended_session_holds_more_bars_than_the_brief_declared():
    """🔴 THE MEASUREMENT THE BRIEF'S 390 CONTRADICTS."""
    one_day = _minute_bars(1)
    assert len(one_day) == 960, "the extended ET session is 04:00-20:00 = 960 minutes"
    assert ast_lint.SESSION_MAX_BARS >= len(one_day), (
        f"the declared session window ({ast_lint.SESSION_MAX_BARS}) is SHORTER than "
        f"the {len(one_day)} one-minute bars one extended ET session holds. A "
        "declaration that under-states hands back a value computed from bars that "
        "were never fetched — the `sessionfirst lookback: 0` defect, one task on.")


def test_the_declared_session_window_is_TRUE_on_a_real_session():
    """⭐⭐ TRIM THE INPUT WINDOW AND WATCH THE VALUE HOLD.

    This is what makes the declaration a FACT rather than a number: the session
    VWAP at the newest bar, computed on a series trimmed to exactly the declared
    window, must equal the value computed on the whole series. The control trims
    to the brief's 390 and watches it MOVE — the defect the number exists to
    prevent, made visible.
    """
    bars = _minute_bars(2)                       # two whole ET sessions
    full = compute_vwap_raw(bars)[-1]
    assert full is not None

    keep = ast_lint.SESSION_MAX_BARS + 1         # the window, plus the bar it writes
    held = compute_vwap_raw(bars[-keep:])[-1]
    assert held == pytest.approx(full, rel=1e-12), (
        "the session VWAP moved when the series was trimmed to the DECLARED "
        "window, so the declaration under-states the bars the maths reads")

    short = compute_vwap_raw(bars[-391:])[-1]    # the brief's 390 + the bar
    assert short != pytest.approx(full, rel=1e-9), (
        "trimming to 390 bars did not change the value, so this control proves "
        "nothing — pick a session whose 390-bar tail is not the whole session")


# --------------------------------------------------------------------------- #
# the planted-`forward` rail — the pivot work's foundation
# --------------------------------------------------------------------------- #

def _planted_forward_table(lookback="arg1"):
    return {**TABLE, "functions": {**TABLE["functions"], "plantedforward": {
        "args": ["series", "int"], "lookback": lookback, "forward": "arg1",
        "yields": "num", "sentence": "a planted forward-reaching value"}}}


@pytest.mark.parametrize("right,mode", [
    (3, "preview-repaints"),
    (1, "preview-repaints"),
    (26, "preview-repaints"),
    (0, "non-repainting"),
])
def test_a_planted_forward_declaration_decides_the_badge(right, mode):
    """⛔⛔ THE LINTER'S BRAND PROMISE, ON A GRAMMAR THE MANIFEST DOES NOT SHIP.

    `ichimokuChikou` already proves `forward: "argN"` works — for ONE entry, whose
    argument is always 26. A tree that reaches forward must not be able to pass as
    non-repainting for ANY k, and `right=0` is the non-vacuity control: without it
    a linter that answered `preview-repaints` for the mere PRESENCE of a `forward`
    key would pass every other row here.
    """
    tree = _call("plantedforward", SER, _num(right))
    verdict = ast_lint.lint_repaint(tree, {"table": _planted_forward_table()})
    assert verdict["forward"] == right
    assert verdict["mode"] == mode


def test_a_forward_reach_survives_being_wrapped_in_arithmetic():
    """A forward reference laundered through an operator is still forward. This is
    the shape a pivot will actually be written in (`pivothigh(...) > close`)."""
    tree = {"type": "op", "name": ">", "args": [_call("plantedforward", SER, _num(4)), SER]}
    verdict = ast_lint.lint_repaint(tree, {"table": _planted_forward_table()})
    assert verdict["forward"] == 4
    assert verdict["mode"] == "preview-repaints"


def test_a_session_lookback_does_not_LAUNDER_a_declared_forward_reach():
    """⛔ THE ONE INTERACTION BETWEEN THIS TASK'S TWO HALVES. A session window is
    large and backward; a `forward` declared beside it must still decide the
    badge. If `session` were read as a NEGATIVE or as UNKNOWN, this row would
    quietly change answer."""
    tree = _call("plantedforward", SER, _num(2))
    verdict = ast_lint.lint_repaint(tree, {"table": _planted_forward_table("session")})
    assert verdict["back"] == ast_lint.SESSION_MAX_BARS
    assert verdict["forward"] == 2
    assert verdict["mode"] == "preview-repaints"


# --------------------------------------------------------------------------- #
# ⚰️ THE FIFTH HAND-WRITTEN COPY OF THE LOOKBACK GRAMMAR
# --------------------------------------------------------------------------- #

def test_the_python_linter_reads_a_MULTIPLIED_window_like_every_other_reader():
    r"""🔴 A LIVE DEFECT, FOUND WHILE ADDING `session` TO THE SAME FUNCTION.

    `lint.js` records: *"⚰️ THIS WAS `/^arg(\d+)$/` AND IT BRANDED ADX AS
    REPAINTING … IT WAS THE FOURTH HAND-WRITTEN COPY OF ONE GRAMMAR"*. There was a
    FIFTH — `ast_lint._ARG_REF` — and it still read the narrow form, so the Python
    repaint linter answered `repaints` for `adx(high, low, close, 14)` with the
    reason *"declares a window this linter cannot bound"*, while the JS lane and
    both interpreters answered 28. `canSaveFormula` refuses `repaints` outright.
    """
    tree = _call("adx", {"type": "series", "name": "high"},
                 {"type": "series", "name": "low"}, SER, _num(14))
    assert TABLE["functions"]["adx"]["lookback"] == "2*arg3"
    assert ast_lint.max_lookback(tree) == 28
    assert ast_lint.max_lookback(tree) == ast_interpret.max_lookback(tree)
    assert ast_lint.lint_repaint(tree)["mode"] == "non-repainting"


# --------------------------------------------------------------------------- #
# 🔴 THE COLLISION THIS NUMBER MAKES VISIBLE — pinned, not hidden
# --------------------------------------------------------------------------- #

def test_a_session_window_does_not_fit_the_lookback_budget_and_that_is_DECLARED():
    """🔴 A MEASURED PRODUCT CONSTRAINT, NOT A BUG IN THIS NUMBER.

    One extended ET session is 960 one-minute bars; ``DEFAULT_BUDGET.maxLookback``
    is 550. So a tree calling a ``lookback: "session"`` function refuses
    ``budget:lookback``, at the save door and at compute. The brief's 390 hid this
    by declaring a window shorter than the maths reads — which is not a fix, it is
    the defect wearing the fix's clothes.

    This case exists so the collision cannot be rediscovered by a member: it is a
    ruling the owner of the cap has to make (raise it to hold one session, or
    state that session-anchored functions do not ship on 1-minute bars). When that
    ruling lands, THIS TEST IS THE ONE TO EDIT — and it names both numbers, so the
    edit cannot be made without seeing them.
    """
    cap = ast_budget.DEFAULT_BUDGET["maxLookback"]
    assert ast_lint.SESSION_MAX_BARS > cap, (
        f"the session window ({ast_lint.SESSION_MAX_BARS}) now fits the lookback "
        f"budget ({cap}). If the cap was raised deliberately, delete this case and "
        "say so in the record; if the session was SHRUNK into agreement, read this "
        "file's header — 390 is the regular-hours session, not this engine's.")

    # …and the refusal that will arrive, through the same cap, on the one shape
    # that can reach `max_lookback` with a session-sized window today.
    too_far = {"type": "offset", "value": ast_lint.SESSION_MAX_BARS, "args": [SER]}
    assert ast_interpret.max_lookback(too_far) == ast_lint.SESSION_MAX_BARS
    with pytest.raises(ast_budget.BudgetExceeded) as exc:
        ast_budget.check_budget(too_far)
    assert exc.value.guard == ast_budget.CAP_GUARD["maxLookback"]


def test_the_budget_INHERITS_the_session_bound_and_holds_no_reader_of_its_own():
    """⭐ THE POINT OF THIS CASE IS THE ABSENCE OF A CHANGE.

    ``ast_budget`` learned nothing about ``session``: it thresholds
    ``max_lookback``, and ``max_lookback`` learned it once, in ``ast_interpret``.
    A ``session`` arm added there would be the second authority over one window
    that this engine keeps paying for — and it would be invisible, because it
    would agree with the first one on the day it was written.
    """
    src = io.open(pathlib.Path(ast_budget.__file__), encoding="utf-8").read()
    assert "session" not in src, (
        "ast_budget.py names the session window itself instead of inheriting it "
        "from the measurement it thresholds")
