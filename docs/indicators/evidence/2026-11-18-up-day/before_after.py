"""An up DAY is a close above the PREVIOUS close: the two house indicators, before and after.

    python docs/indicators/evidence/2026-11-18-up-day/before_after.py            # print
    python docs/indicators/evidence/2026-11-18-up-day/before_after.py --write    # rewrite before_after.json

Bars: the committed daily fixture `tests/fixtures/alerts/replay_bars.json` -> `spy_daily`.
AFTER is the house set as committed (version 2 of the two indicators). BEFORE is the same trees
with ONE thing put back: every "close against the previous close" comparison becomes "close
against the open", which is what version 1 held. Nothing else differs between the two, and this
file is how that is known: it rebuilds version 1 from version 2 by that single rewrite.

Both are evaluated by the server's own evaluator (`ast_interpret.interpret`).
`tests/test_house_up_day.py` recomputes every number in before_after.json, so the evidence
cannot go stale.
"""
from __future__ import annotations

import copy
import io
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
sys.path.insert(0, ROOT)

CLOSE = {"type": "series", "name": "close"}
OPEN = {"type": "series", "name": "open"}
PREV_CLOSE = {"type": "offset", "value": 1, "args": [CLOSE]}
SLUGS = ("up_down_volume_ratio_50", "volume_with_50_average")
COMPARISONS = (">", "<", ">=", "<=")


def to_version_1(node):
    """The same tree with each close-vs-previous-close comparison put back to close-vs-open."""
    if isinstance(node, list):
        return [to_version_1(x) for x in node]
    if not isinstance(node, dict):
        return node
    out = {k: to_version_1(v) for k, v in node.items()}
    if out.get("type") == "op" and out.get("name") in COMPARISONS and isinstance(out.get("args"), list) and len(out["args"]) == 2:
        a, b = out["args"]
        if a == CLOSE and b == PREV_CLOSE:
            out["args"] = [CLOSE, copy.deepcopy(OPEN)]
        elif a == PREV_CLOSE and b == CLOSE:
            out["args"] = [copy.deepcopy(OPEN), CLOSE]
    return out


def known(v):
    return v is not None and not (isinstance(v, float) and math.isnan(v))


def measure():
    from api.services import ast_interpret
    house = json.load(io.open(os.path.join(ROOT, "app/src/components/chart/house/houseIndicators.json"), encoding="utf-8"))
    bars = json.load(io.open(os.path.join(ROOT, "tests/fixtures/alerts/replay_bars.json"), encoding="utf-8"))["fixtures"]["spy_daily"]["bars"]
    c, o = [b["c"] for b in bars], [b["o"] for b in bars]
    n = len(bars)
    days = {
        "bars": n,
        "first": bars[0]["t"], "last": bars[-1]["t"],
        # the two definitions of the day itself, from bar 1 on (bar 0 has no previous close)
        "up_by_open": sum(1 for i in range(1, n) if c[i] > o[i]),
        "up_by_previous_close": sum(1 for i in range(1, n) if c[i] > c[i - 1]),
        "down_by_open": sum(1 for i in range(1, n) if c[i] < o[i]),
        "down_by_previous_close": sum(1 for i in range(1, n) if c[i] < c[i - 1]),
        "days_the_two_disagree_on": sum(1 for i in range(1, n) if (c[i] > o[i]) != (c[i] > c[i - 1]) or (c[i] < o[i]) != (c[i] < c[i - 1])),
    }
    out = {"fixture": "tests/fixtures/alerts/replay_bars.json#spy_daily", "days": days, "indicators": {}}
    for item in house["indicators"]:
        if item["slug"] not in SLUGS:
            continue
        trees_after = item["definition"]["compute"]["trees"]
        row = {"version": item["definition"]["version"], "outputs": {}}
        for key, after_tree in trees_after.items():
            before_tree = to_version_1(after_tree)
            if before_tree == after_tree:
                continue                                   # an output the ruling does not touch
            before = ast_interpret.interpret(before_tree, bars)
            after = ast_interpret.interpret(after_tree, bars)
            both = [i for i in range(n) if known(before[i]) and known(after[i])]
            cell = {
                "known_before": sum(1 for v in before if known(v)),
                "known_after": sum(1 for v in after if known(v)),
                "bars_that_differ": sum(1 for i in both if abs(before[i] - after[i]) > 1e-9),
                "last_bar_before": round(before[-1], 4) if known(before[-1]) else None,
                "last_bar_after": round(after[-1], 4) if known(after[-1]) else None,
            }
            flags = all(v in (0.0, 1.0) for i in both for v in (before[i], after[i]))
            if flags:
                cell["true_before"] = sum(1 for v in before if v == 1.0)
                cell["true_after"] = sum(1 for v in after if v == 1.0)
            else:
                diffs = [abs(before[i] - after[i]) for i in both]
                cell["largest_difference"] = round(max(diffs), 4) if diffs else None
                cell["mean_before"] = round(sum(before[i] for i in both) / len(both), 4) if both else None
                cell["mean_after"] = round(sum(after[i] for i in both) / len(both), 4) if both else None
            row["outputs"][key] = cell
        out["indicators"][item["slug"]] = row
    return out


if __name__ == "__main__":
    result = measure()
    text = json.dumps(result, indent=1) + "\n"
    if "--write" in sys.argv:
        io.open(os.path.join(HERE, "before_after.json"), "w", encoding="utf-8", newline="\n").write(text)
    print(text)
