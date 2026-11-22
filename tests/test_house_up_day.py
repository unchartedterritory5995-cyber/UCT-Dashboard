"""AN UP DAY IS A CLOSE ABOVE THE PREVIOUS CLOSE, and the house set says so everywhere.

Owner ruling, 2026-11-18: an up DAY is a close above the PREVIOUS close, a down day a close below
it (the common up/down volume ratio counts days that way). A close above its own OPEN is an up
BAR, a green candle.

Before the ruling the house set held both: the up/down volume ratio and the volume colouring
compared the close with the open, while the distribution day and the follow-through day compared
it with the previous close. Two indicators were re-derived (version 2 of each).

What this file holds:

  1. ONE definition, DERIVED, so a fifteenth indicator cannot drift: every tree in the house set,
     the worked examples and the house evaluation cases is scanned for the predicate itself. A
     close compared with the open may appear only where the indicator's own words speak of a bar
     or a candle; an indicator whose words speak of an up or down DAY must compare the close with
     the previous close.
  2. THE VERSION RULE: a house indicator's maths never changes under the same version
     (`house/houseVersions.json`).
  3. THE EVIDENCE REPRODUCES: every number in
     `docs/indicators/evidence/2026-11-18-up-day/before_after.json` is recomputed here.

(The assistant is told the same thing in its instructions; that sentence and its test ship
separately, after a live before and after: `tests/test_converse_up_day_instruction.py`.)
"""
from __future__ import annotations

import importlib.util
import io
import json
import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
HOUSE_DIR = ROOT / "app" / "src" / "components" / "chart" / "house"
HOUSE = json.loads(io.open(HOUSE_DIR / "houseIndicators.json", encoding="utf-8").read())
VERSIONS = json.loads(io.open(HOUSE_DIR / "houseVersions.json", encoding="utf-8").read())
WORKED = json.loads(io.open(ROOT / "api" / "data" / "worked_examples.json", encoding="utf-8").read())
CASES = json.loads(io.open(ROOT / "tests" / "fixtures" / "authoring" / "converse_eval_house_cases.json", encoding="utf-8").read())
EVIDENCE = ROOT / "docs" / "indicators" / "evidence" / "2026-11-18-up-day"

COMPARISONS = (">", "<", ">=", "<=")
CLOSE = {"type": "series", "name": "close"}
OPEN = {"type": "series", "name": "open"}
PREV_CLOSE = {"type": "offset", "value": 1, "args": [CLOSE]}

#: The words that make a close-vs-open comparison the RIGHT one: the member asked about the bar.
#: ⚠️ NOT "green" or "red" alone: they are colours a member asks a SHADING to be ("green shading
#: while it is above 1.2"), and reading them as "a green candle" excused the up/down volume ratio
#: from the rule on this file's first run.
SAYS_BAR = re.compile(r"\b(candles?|(green|red|up|down) bars?|above (its|the) open|below (its|the) open|closes? above the open)\b", re.I)
#: The words that mean a DAY (or the volume counted on such days).
SAYS_DAY = re.compile(r"\b(up|down)[ -](day|days|week|weeks)\b|up/down volume|up days|down days", re.I)


def predicates(node, found=None):
    """Every comparison of the close with the open, and with the previous close, under ``node``."""
    found = found if found is not None else {"open": 0, "previous_close": 0}
    if isinstance(node, list):
        for x in node:
            predicates(x, found)
    elif isinstance(node, dict):
        if node.get("type") == "op" and node.get("name") in COMPARISONS and isinstance(node.get("args"), list) and len(node["args"]) == 2:
            a, b = node["args"]
            if (a, b) in ((CLOSE, OPEN), (OPEN, CLOSE)):
                found["open"] += 1
            if (a, b) in ((CLOSE, PREV_CLOSE), (PREV_CLOSE, CLOSE)):
                found["previous_close"] += 1
        for v in node.values():
            predicates(v, found)
    return found


def _everything():
    """(where, the indicator's own words, its trees) for the three places the house set lives."""
    for item in HOUSE["indicators"]:
        yield f"house:{item['slug']}", item["summary"], item["definition"]["compute"]
    for ex in WORKED["examples"]:
        yield f"worked:{ex['id']}", ex["request"], ex["ops"]
    for case in CASES["cases"]:
        if case["group"] != "example":
            continue
        for turn in case["turns"]:
            yield f"case:{case['id']}", turn["words"], (turn.get("expect") or {}).get("outputs") or []


ALL = list(_everything())


def test_CONTROL_the_scan_sees_both_predicates_and_tells_them_apart():
    up_bar = {"type": "op", "name": ">", "args": [CLOSE, OPEN]}
    up_day = {"type": "op", "name": ">", "args": [CLOSE, PREV_CLOSE]}
    nested = {"type": "call", "name": "sum", "args": [{"type": "op", "name": "?:", "args": [up_bar, {"type": "series", "name": "volume"}, {"type": "num", "value": 0}]}, {"type": "num", "value": 50}]}
    assert predicates(up_bar) == {"open": 1, "previous_close": 0}
    assert predicates(up_day) == {"open": 0, "previous_close": 1}
    assert predicates({"trees": {"a": nested, "b": {"type": "op", "name": "<", "args": [PREV_CLOSE, CLOSE]}}}) == {"open": 1, "previous_close": 1}
    # not the predicate: the close against something else, or another field against the open
    assert predicates({"type": "op", "name": ">", "args": [CLOSE, {"type": "offset", "value": 2, "args": [CLOSE]}]}) == {"open": 0, "previous_close": 0}
    assert predicates({"type": "op", "name": ">", "args": [{"type": "series", "name": "high"}, OPEN]}) == {"open": 0, "previous_close": 0}
    assert len(ALL) >= 14 + 14 + 9, len(ALL)                         # the three places were all read


@pytest.mark.parametrize("where, words, trees", ALL, ids=[w for w, _, _ in ALL])
def test_the_close_is_compared_with_the_open_only_where_the_words_speak_of_a_bar(where, words, trees):
    found = predicates(trees)
    if found["open"]:
        assert SAYS_BAR.search(words), (
            f"{where} compares the close with the OPEN ({found['open']} time(s)), which is an up or down BAR, "
            f"and its words do not speak of a bar or a candle: {words!r}. An up or down DAY is the close "
            "against the PREVIOUS close (owner ruling 2026-11-18).")


@pytest.mark.parametrize("where, words, trees", ALL, ids=[w for w, _, _ in ALL])
def test_words_that_speak_of_an_up_or_down_day_compare_with_the_previous_close(where, words, trees):
    if SAYS_DAY.search(words) and not SAYS_BAR.search(words):
        found = predicates(trees)
        assert found["previous_close"] >= 1 and found["open"] == 0, (where, words, found)


def test_the_rule_is_not_vacuous_and_the_two_indicators_are_the_ones_it_names():
    by_day = sorted(w for w, words, _ in ALL if SAYS_DAY.search(words) and not SAYS_BAR.search(words))
    assert {"house:up_down_volume_ratio_50", "house:volume_with_50_average", "worked:up_down_volume_ratio_50",
            "worked:volume_with_50_average", "case:house-up-down-volume-ratio-50",
            "case:house-volume-with-50-average"} <= set(by_day), by_day
    assert sum(predicates(t)["previous_close"] for _, _, t in ALL) >= 12
    assert sum(predicates(t)["open"] for _, _, t in ALL) == 0           # today nothing in the set is about a bar


# ── the version rule ─────────────────────────────────────────────────────────

def _whole_maths(definition):
    compute = definition["compute"]
    return compute.get("treesHash") or compute["fn"]


def test_a_house_indicators_maths_never_changes_under_the_same_version():
    ledger = VERSIONS["indicators"]
    assert set(ledger) == {i["slug"] for i in HOUSE["indicators"]}
    for item in HOUSE["indicators"]:
        history = ledger[item["slug"]]
        versions = [h["version"] for h in history]
        assert versions == list(range(1, len(history) + 1)), (item["slug"], versions)      # 1, 2, 3 ... no gap, no reuse
        assert len({h["maths"] for h in history}) == len(history), item["slug"]             # a version is a CHANGE
        assert all(h.get("why") and re.fullmatch(r"\d{4}-\d{2}-\d{2}", h.get("since", "")) for h in history), item["slug"]
        last = history[-1]
        assert item["definition"]["version"] == last["version"], (
            f"{item['slug']}: the definition says version {item['definition']['version']}, the ledger's last entry is {last['version']}")
        assert _whole_maths(item["definition"]) == last["maths"], (
            f"{item['slug']}: its maths moved and its version did not. Add an entry to house/houseVersions.json "
            "with the next version and the reason, and set the definition's version to it.")


def test_the_two_re_derived_indicators_are_version_2_and_the_rest_are_untouched():
    changed = {s: h for s, h in VERSIONS["indicators"].items() if len(h) > 1}
    assert set(changed) == {"up_down_volume_ratio_50", "volume_with_50_average"}
    for history in changed.values():
        assert [h["version"] for h in history] == [1, 2] and "PREVIOUS close" in history[1]["why"]


# ── the evidence reproduces ──────────────────────────────────────────────────

def _evidence_module():
    spec = importlib.util.spec_from_file_location("up_day_before_after", EVIDENCE / "before_after.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_the_committed_before_and_after_is_what_the_engine_computes_today():
    mod = _evidence_module()
    committed = json.loads(io.open(EVIDENCE / "before_after.json", encoding="utf-8").read())
    assert mod.measure() == committed
    # and it says something: the two definitions of a day differ on real bars, and the ratio moved
    days = committed["days"]
    assert days["bars"] == 400 and days["days_the_two_disagree_on"] > 0
    udr = committed["indicators"]["up_down_volume_ratio_50"]["outputs"]["udr"]
    assert udr["bars_that_differ"] > 0 and udr["last_bar_before"] != udr["last_bar_after"]
    assert set(committed["indicators"]) == {"up_down_volume_ratio_50", "volume_with_50_average"}


def test_version_1_is_version_2_with_the_one_predicate_put_back():
    """How the evidence knows NOTHING ELSE differs: it rebuilds the old trees from the new ones."""
    mod = _evidence_module()
    for item in HOUSE["indicators"]:
        trees = item["definition"]["compute"].get("trees") or {}
        back = {k: mod.to_version_1(t) for k, t in trees.items()}
        if item["slug"] in mod.SLUGS:
            assert back != trees and predicates(back)["previous_close"] == 0 and predicates(back)["open"] >= 2, item["slug"]
        elif predicates(trees)["previous_close"] == 0:
            assert back == trees, item["slug"]                           # an indicator the ruling does not touch
