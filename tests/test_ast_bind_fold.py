"""⭐⭐⭐ THE BIND-TIME FOLD, AND THE SIX RULES THE OWNER SET FOR IT.

`Uncharted Volume` line 233 is `ta.sma(v, isWeekly ? lenWeekly : lenDaily)`. Every
operand is constant once a symbol and timeframe are chosen, so the length IS a
whole number at the only moment anything is evaluated — but `_window_literal`
requires a `num` node and refused it `resolve:window`, which reads as a missing
capability and is really a missing PASS.

⛔ THE PASS IS SEPARATE ON PURPOSE (owner rule c). It rewrites the tree; the
window check then sees the literal it has always required, unchanged. Every
length-taking entry benefits at once and there is ONE place to rail — this file.
"""

import io
import json
import pathlib
import re
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from api.services import ast_bind as B                          # noqa: E402
from api.services import ast_interpret as ai                     # noqa: E402
from api.services import ast_table                               # noqa: E402


NUM = lambda v: {"type": "num", "value": v}                       # noqa: E731
SER = lambda n: {"type": "series", "name": n}                     # noqa: E731
OP = lambda n, *a: {"type": "op", "name": n, "args": list(a)}     # noqa: E731
CALL = lambda n, *a: {"type": "call", "name": n, "args": list(a)}  # noqa: E731

#: Volume line 233, written out. ⛔ NOT read from the fixture: this rail owns its
#: own input, and the fixture is checked against the file by
#: `tests/test_member_fixtures.py`. Two rails, two jobs.
LINE_233 = CALL("sma", SER("volume"),
                OP("?:", SER("isweekly"), SER("lenWeekly"), SER("lenDaily")))

DAILY = {"isdaily": 1, "isweekly": 0, "ismonthly": 0, "isintraday": 0}
WEEKLY = {"isdaily": 0, "isweekly": 1, "ismonthly": 0, "isintraday": 0}
LENGTHS = {"lenDaily": 50, "lenWeekly": 10}


def _consts(tf, inputs=None):
    return B.binding_constants(timeframe=tf, inputs=inputs or LENGTHS)


# ═══ the case it was built for ═══════════════════════════════════════════════

def test_VOLUME_LINE_233_folds_and_the_two_timeframes_give_DIFFERENT_lengths():
    """⭐ THE WHOLE RULING IN ONE CASE. Same saved tree, two bindings, two
    lengths — and the difference is the point: a fold that produced one answer
    for both would be a constant, not a binding."""
    daily = B.fold_bound(LINE_233, _consts(DAILY))
    weekly = B.fold_bound(LINE_233, _consts(WEEKLY))
    assert daily["args"][1] == NUM(50)
    assert weekly["args"][1] == NUM(10)


def test_the_original_tree_is_NOT_MUTATED_so_the_next_symbol_folds_afresh():
    """⛔⛔ THE DEFECT THIS PREVENTS SHOWS AS A WRONG NUMBER, NOT AN ERROR.

    A pass that rewrote in place would let the second symbol of a sweep inherit
    the first symbol's lengths — every later symbol computing a 50-bar average
    while the definition said 10. Nothing would raise; the column would simply be
    wrong, per symbol, forever.
    """
    before = json.dumps(LINE_233, sort_keys=True)
    B.fold_bound(LINE_233, _consts(WEEKLY))
    assert json.dumps(LINE_233, sort_keys=True) == before
    # …and folding again under the OTHER binding still gives the other answer,
    # which is what "re-folded per binding" actually means.
    assert B.fold_bound(LINE_233, _consts(DAILY))["args"][1] == NUM(50)


# ═══ rule (d) — the budget prices the FOLDED value, exactly ══════════════════

def test_the_budget_prices_the_FOLDED_length_and_not_a_min_max_or_guess():
    """⛔ FOLD FIRST, THEN SUM. `max_lookback` is a TREE SUM and stays one; what
    changed is that it is handed a tree whose lengths are settled for THIS
    binding. A pass that reported the wider branch would over-state the warm-up
    on every weekly chart, and one that reported the narrower would UNDER-state
    it — the one direction `_functions_warmup` says a budget cannot use."""
    assert ai.max_lookback(B.fold_bound(LINE_233, _consts(DAILY))) == 50
    assert ai.max_lookback(B.fold_bound(LINE_233, _consts(WEEKLY))) == 10


def test_an_UNFOLDED_tree_is_never_handed_to_the_budget_as_a_number():
    """⛔ THE FAILURE DIRECTION THAT MATTERS. If a tree cannot fold, the budget
    must REFUSE it rather than invent a length — an under-stated window hands
    back numbers computed from bars that were never fetched."""
    unfoldable = CALL("sma", SER("close"), OP("+", SER("close"), NUM(2)))
    left = B.fold_bound(unfoldable, _consts(DAILY))
    assert left["args"][1]["type"] == "op", "it was folded and must not have been"
    with pytest.raises(Exception) as caught:
        ai.max_lookback(left)
    assert "window" in str(caught.value).lower()


# ═══ rule (a) — a fold that succeeds but is not a usable window ══════════════

@pytest.mark.parametrize("expr, shown", [
    (OP("/", SER("lenDaily"), NUM(4)), "lenDaily / 4"),
    (OP("-", SER("lenWeekly"), SER("lenWeekly")), "lenWeekly - lenWeekly"),
    (OP("u-", SER("lenWeekly")), "-lenWeekly"),
])
def test_a_bad_folded_window_refuses_HERE_and_QUOTES_THE_MEMBERS_OWN_TEXT(expr, shown):
    """⛔ A REFUSAL THAT SAYS "argument 1 folded to 2.5" AND STOPS IS HALF A
    SENTENCE. The member wrote `lenDaily / 4`; 12.5 is our arithmetic, not their
    text, and a script with several lengths in it gives them nothing to search
    for. Only this pass knows what it folded FROM, which is why the refusal
    belongs here and not downstream.
    """
    with pytest.raises(Exception) as caught:
        B.fold_bound(CALL("sma", SER("close"), expr), _consts(DAILY))
    msg = str(caught.value)
    assert "folded to" in msg
    assert f"`{shown}`" in msg, f"the refusal did not quote the source: {msg}"


def test_the_refusal_reaches_the_manifests_own_window_guard():
    """⭐ ATTRIBUTION. It must be `resolve:window` — the same door a hand-typed
    bad length hits — or a surface branching on the guard learns a new one."""
    with pytest.raises(Exception) as caught:
        B.fold_bound(CALL("sma", SER("close"), OP("/", SER("lenDaily"), NUM(4))),
                     _consts(DAILY))
    assert "resolve:window" in str(caught.value) or "window" in str(caught.value)


# ═══ rule (b) — a series operand stops it, and NEVER partially ══════════════

@pytest.mark.parametrize("bad", [
    SER("close"),
    OP("+", SER("close"), NUM(2)),
    OP("?:", SER("isweekly"), SER("lenWeekly"), SER("close")),
    {"type": "offset", "value": 1, "args": [SER("lenDaily")]},
])
def test_anything_that_reads_a_BAR_stops_the_fold_and_leaves_the_tree_ALONE(bad):
    """⚠️ THE THIRD CASE IS THE SUBTLE ONE. `isweekly ? lenWeekly : close` folds
    on a WEEKLY binding if the selector is read first — and then the same saved
    definition refuses on the next symbol, which is a refusal the member cannot
    reproduce. Both arms are folded before the selector is consulted, so the
    answer is the same for every binding.
    """
    tree = CALL("sma", SER("close"), bad)
    out = B.fold_bound(tree, _consts(WEEKLY))
    assert out["args"][1].get("type") != "num", (
        "a bar-reading operand was folded into a literal window")


def test_the_fold_reports_WHICH_operand_stopped_it():
    with pytest.raises(B.NotFoldable) as caught:
        B.fold_scalar(OP("+", SER("close"), NUM(2)), _consts(DAILY))
    assert caught.value.what == "close"


# ═══ rule (c) — it is a distinct pass, and the window check is untouched ════

def test_the_window_check_still_requires_a_LITERAL_and_knows_nothing_of_folding():
    """⛔ THE SEPARATION IS THE RULING. If `_window_literal` had learned to fold,
    every future length-taking entry would need the same branch and the fold's
    rules would live where nobody looks for them. It must still refuse an
    expression outright when handed one directly.
    """
    src = io.open(pathlib.Path(ai.__file__), encoding="utf-8").read()
    body = src[src.index("def _window_literal"):]
    body = body[:body.index("\ndef ", 1)]
    for leaked in ("fold", "binding", "consts"):
        assert leaked not in body, (
            f"`_window_literal` mentions {leaked!r} — the fold leaked into the "
            "check it was built to sit in front of")


# ═══ the manifest owns the split, and its own prose proves it ═══════════════

def test_the_bind_time_clock_names_are_the_ones_about_THE_CHART_not_THE_BAR():
    """⛔⛔ THE ROSTER IS CHECKED AGAINST THE SENTENCES, NOT TRUSTED.

    `dayofweek` and `isdaily` sit in the same manifest section and are opposite
    kinds. The only thing that says so is the sentence each entry already
    carries: the bind-time ones declare themselves about *the chart's timeframe*,
    the rest about *the bar*. So a clock entry added on either side of the line
    classifies itself, and a mistake is loud rather than silent.
    """
    clock = ast_table.TABLE["clock"]
    declared = set((ast_table.TABLE.get("_bind_time_constants") or {}).get("clock") or ())
    assert declared, "the manifest declares no bind-time clock names"

    def sentence(name):
        v = clock[name]
        return (v.get("sentence") if hasattr(v, "get") else str(v)) or ""

    for name in declared:
        assert name in clock, f"{name} is declared bind-time but is not a clock entry"
        assert re.search(r"chart's timeframe", sentence(name)), (
            f"{name} is declared constant per binding but its sentence does not "
            f"say it is about the chart's timeframe: {sentence(name)!r}")

    for name in set(clock) - declared:
        assert not re.search(r"chart's timeframe", sentence(name)), (
            f"{name} says it is about the chart's timeframe but is NOT declared "
            "bind-time constant — a window using it would refuse for no reason")


def test_the_int_slots_are_READ_OFF_the_table_so_a_new_entry_is_covered():
    """⛔ NOT A HAND-LIST. Deriving the length positions from the manifest is what
    makes this pass cost nothing per function — the owner's rule (c)."""
    assert B.int_slots("sma") == [1]
    assert B.int_slots("cum") == []          # takes a series only
    assert B.int_slots("not_a_function") == []
    # non-vacuity: SOMETHING in the shipped table takes an int
    takers = [n for n in ast_table.TABLE["functions"] if B.int_slots(n)]
    assert len(takers) > 10, f"only {len(takers)} int-taking entries — probe broken"
