"""⭐⭐ R-G — THE PYTHON HALF: four readers of one window, one answer.

Owner ruling 2026-09-12. There are four readers of "how far back does this tree
reach", two per lane::

    lint.js::maxLookback          ast_lint.max_lookback
    interpret.js::maxLookback     ast_interpret.max_lookback

and they had drifted three separate ways, each invisible because every
disagreement fails CLOSED — a refusal at the install door or a ``repaints``
badge, never a wrong number.

⛔ THIS FILE READS THE JS LANE'S OWN ANSWERS, NOT A SECOND CORPUS WALK.
``tools/lookback_agreement.json`` is written by
``app/src/components/chart/engine/ast/lookbackAgreement.test.js`` from the real
trees; this asserts the two Python readers agree with each other AND with the two
JavaScript readers on every one. A rail that re-walked the corpus here would be a
third opinion about which trees exist, and the two lanes could then agree
perfectly about different populations.

⚠️ SO THE ORACLE MUST BE FRESH. It is committed, and the JS test rewrites it on
every run; if the two lanes ever disagree because the artifact is stale, that is
itself worth knowing — the numbers in it are the JS readers' measured answers on
committed fixtures, which do not move on their own.
"""
import json
import pathlib
from collections import Counter

import pytest

from api.services.ast_interpret import TableRefusal, max_lookback as interpret_max
from api.services.ast_lint import UNKNOWN, max_lookback as lint_max

_ORACLE = (pathlib.Path(__file__).resolve().parents[1]
           / "tools" / "lookback_agreement.json")

#: The shapes that DISCRIMINATE. A rail that saw none of them would pass for the
#: wrong reason — measured 2026-09-12, ``corpus/committed`` on its own contains
#: none of the three and agreed 643/643 both before and after the fix.
_DISCRIMINATING = ("series-lookback", "bind-time-text", "bind-foldable-window")


def _load():
    if not _ORACLE.exists():
        pytest.fail(
            f"{_ORACLE} is missing. It is written by "
            "`app/src/components/chart/engine/ast/lookbackAgreement.test.js`; run "
            "that suite. ⛔ Do NOT hand-write it — the numbers in it are the JS "
            "readers' own answers, and a hand-edit makes this rail agree with a "
            "wish instead of with the other lane.")
    return json.loads(_ORACLE.read_text(encoding="utf-8"))


def _read_both(ast):
    """``(interpret, lint)``; ``None`` for "refused / unanalysable"."""
    try:
        i = interpret_max(ast)
    except TableRefusal:
        i = None
    lv = lint_max(ast)
    return i, (None if lv == UNKNOWN or not isinstance(lv, int) else lv)


def test_the_oracle_really_carries_the_shapes_this_rail_exists_for():
    rows = _load()["rows"]
    assert len(rows) > 20
    counts = Counter(s for r in rows for s in r["shapes"])
    for shape in _DISCRIMINATING:
        assert counts.get(shape, 0) > 0, (
            f"the oracle contains no `{shape}` tree any more, so this rail can no "
            "longer see the defect class it exists for. Add a fixture that "
            "exhibits it, or retire the shape with a reason.")
    # …and ordinary trees too, or the rail only ever sees the exotic cases.
    assert any(not r["shapes"] for r in rows)


def test_both_python_readers_answer_the_same_number_on_every_tree():
    bad = []
    for r in _load()["rows"]:
        i, lv = _read_both(r["ast"])
        if i != lv:
            bad.append(f"  {r['from']} [{r['lane']}] {r['title']!r} "
                       f"shapes={'+'.join(r['shapes']) or 'none'} "
                       f"interpret={'REFUSED' if i is None else i} "
                       f"lint={'UNANALYSABLE' if lv is None else lv}")
    assert not bad, (
        f"{len(bad)} trees get two different answers from the two PYTHON readers "
        "about how far back they reach:\n" + "\n".join(bad[:8]) + "\n\n"
        "The shared walk both must use is `ast_table.bind_foldable_window`.")


def test_the_python_readers_agree_with_the_javascript_ones():
    """⛔⛔ THE CROSS-LANE HALF, AND THE ONE THAT MATTERS MOST.

    Two lanes can each be internally consistent and still answer differently — a
    script that installs on the pane and refuses in the sweep. That is what the
    bind-foldable window did for ``uncharted-volume-v2.pine``.
    """
    bad = []
    for r in _load()["rows"]:
        i, lv = _read_both(r["ast"])
        if i != r["interpret"] or lv != r["lint"]:
            bad.append(f"  {r['from']} [{r['lane']}] {r['title']!r} "
                       f"shapes={'+'.join(r['shapes']) or 'none'}\n"
                       f"      python: interpret={i} lint={lv}\n"
                       f"      js:     interpret={r['interpret']} lint={r['lint']}")
    assert not bad, (
        f"{len(bad)} trees are read differently by the two LANES:\n"
        + "\n".join(bad[:6]) + "\n\n"
        "A member's script would install on one side and refuse on the other. "
        "The shared walks are `parse.js::bindFoldableWindow` and "
        "`ast_table.bind_foldable_window`; they must admit the same shapes.")


def test_CONTROL_the_python_readers_really_can_disagree():
    """⛔ The corpus is clean after the fix, so every assertion above passes on a
    rail that had been broken into always-agreeing. This proves the comparison
    still discriminates, on a tree built here rather than found."""
    # A window that is genuinely unreadable: a bare series where an int belongs.
    unreadable = {"type": "call", "name": "sma",
                  "args": [{"type": "series", "name": "close"},
                           {"type": "series", "name": "close"}]}
    i, lv = _read_both(unreadable)
    assert i is None, "the interpreter should refuse a non-window window"
    assert lv is None, "the linter should call a non-window window unanalysable"

    # …and the shape the ruling is about now reads as a NUMBER on both sides.
    ternary = {"type": "call", "name": "sma",
               "args": [{"type": "series", "name": "close"},
                        {"type": "op", "name": "?:",
                         "args": [{"type": "series", "name": "isweekly"},
                                  {"type": "num", "value": 50},
                                  {"type": "num", "value": 10}]}]}
    i2, l2 = _read_both(ternary)
    # ⛔ THE MAXIMUM OVER THE ARMS, never the first and never today's chart's.
    # Over-stating a window costs warm-up bars; under-stating it hands back
    # numbers computed from bars that were never fetched.
    assert i2 == 50 and l2 == 50, (i2, l2)
