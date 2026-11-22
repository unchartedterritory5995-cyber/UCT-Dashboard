"""A window site inside a weekly ``request.security``: what the ROOT still withholds (PYTHON lane).

Engine 59's open note. ``builtin_witness_mask`` and ``window_hole_mask`` list ``tf``, ``tf_live``,
``sym`` and ``ltf`` as reads whose child is analysed on its own bars, and NOT ``tf_merge`` (Pine's
look-ahead-off ``request.security(…, "W", …)``), so the root asks such a site about the chart's daily
bars too and withholds daily bars the weekly read does not need. It never serves a wrong value.

Left as it is on 2026-11-16: no committed capture plots a window call inside a weekly request, so
serving those bars would rest on no witness. They stay withheld until one exists
(``docs/pine/capture-queue-2026-11-16-tick-tie-and-htf-windows.md``, H01-H05). This rail pins what is
withheld, on the same fixture as the JS lanes
(``app/src/components/chart/engine/ast/tfMergeNestedMasks.test.js``, which holds the fixture's tree to
the Pine door's own output).
"""
import copy
import json
from pathlib import Path

from api.services import ast_interpret as ai

ROOT = Path(__file__).resolve().parent.parent
FIX = json.loads((ROOT / "tests" / "fixtures" / "pine_tfmerge_nested_masks.json").read_text(encoding="utf-8"))
BARS = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}
        for r in json.loads((ROOT / FIX["bars"]).read_text(encoding="utf-8"))["bars"]["rows"]]
OPTS = FIX["opts"]


def _ones(mask):
    return None if mask is None else [i for i, v in enumerate(mask) if v]


def _retyped(tree, to):
    if isinstance(tree, list):
        return [_retyped(c, to) for c in tree]
    if not isinstance(tree, dict):
        return tree
    return {k: (to if k == "type" and v == "tf_merge" else _retyped(v, to)) for k, v in tree.items()}


def test_the_root_withholds_the_same_daily_bars_as_the_js_lane():
    want = FIX["rootWithheld"]
    sink = {}
    mask = ai.builtin_witness_mask(FIX["tree"], BARS, None, None, None, dict(OPTS, chartClockSink=sink))
    assert _ones(mask) == list(range(want["first"], want["last"] + 1))
    assert len(_ones(mask)) == want["count"] == 36
    assert list(sink) == [want["code"]] == [ai.STOCH_FLAT_WINDOW]
    # no other root mask speaks on this tree from the listing
    assert ai.tf_merge_mask(FIX["tree"], BARS, OPTS) is None
    assert ai.window_hole_mask(FIX["tree"], BARS, None, None, None, OPTS) is None


def test_CONTROL_the_same_site_under_a_nested_read_is_not_asked_at_the_root():
    """``tf_live`` IS listed as a nested read: the root mask is silent, the child withholds on its own bars."""
    live = _retyped(copy.deepcopy(FIX["tree"]), "tf_live")
    assert "tf_merge" not in json.dumps(live) and "tf_live" in json.dumps(live)
    assert ai.builtin_witness_mask(live, BARS, None, None, None, OPTS) is None
