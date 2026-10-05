"""W19-H2 -- ``ta.nvi`` / ``ta.pvi``'s level, the Python lane's half.

The JS lane writes ``exp(cum(step ? ln(close / close[1]) : 0))`` for Pine's ``ta.nvi`` /
``ta.pvi`` on the host lane (``interpret.js::volumeIndexLevelTree``) and withholds every
bar of a tree that reads it off the listing (``interpret.js::cumulativeLevelMask``, code
``cum:volume-index``). This lane builds the same tree (``ast_interpret.
volume_index_level_tree``), evaluates it to TradingView's capture, and mirrors the mask.
The hand-made column is the one the JS rail (``vendorHarness.w19h2VolumeIndex.test.js``)
asserts, so the two lanes are held to one answer.
"""
import datetime
import json
import math
import pathlib

import api.services.ast_interpret as ai

REPO = pathlib.Path(__file__).resolve().parents[1]
FULL = REPO / "tests/fixtures/vendor/vw-nvi-pvi-spy-1d-full-2026-09-27.json"

BARS = [{"t": f"2025-01-{i + 6:02d}", "o": c, "h": c, "l": c, "c": c, "v": v}
        for i, (c, v) in enumerate([(10, 100), (11, 50), (12, 60), (6, 10), (6, 5), (12, 7)])]
OFF = {"tf": "D", "barIndexAbsolute": True}


def _close(a, b):
    return all(abs(x - y) <= 1e-12 * max(1.0, abs(y)) for x, y in zip(a, b))


def test_seed_one_and_the_step_fires_only_on_its_own_volume_test():
    nvi = ai.interpret(ai.volume_index_level_tree("nvi"), BARS, opts={"tf": "D"})
    pvi = ai.interpret(ai.volume_index_level_tree("pvi"), BARS, opts={"tf": "D"})
    assert _close(nvi, [1, 1.1, 1.1, 0.55, 0.55, 0.55])
    assert _close(pvi, [1, 1, 12 / 11, 12 / 11, 12 / 11, 24 / 11])


def test_the_level_is_tradingviews_on_every_bar_of_spy_from_the_listing():
    cap = json.loads(FULL.read_text(encoding="utf-8"))
    assert cap["history"]["startsAtBar0"] is True
    bars = [{"t": datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime("%Y-%m-%d"),
             "o": o, "h": h, "l": lo, "c": c, "v": v} for t, o, h, lo, c, v in cap["bars"]["rows"]]
    fields = cap["plotValues"]["fields"]
    titles = {p["title"]: p["id"] for p in cap["study"]["plots"]}
    for kind, title in (("nvi", "P01_nvi_RAW"), ("pvi", "P02_pvi_RAW")):
        ours = ai.interpret(ai.volume_index_level_tree(kind), bars, opts={"tf": "D"})
        tv = [r[fields.index(titles[title])] for r in cap["plotValues"]["rows"]]
        assert len(ours) == len(tv) == 8472
        assert ours[0] == 1 and tv[0] == 1
        worst = max(abs(a - b) / abs(b) for a, b in zip(ours, tv))
        assert worst < 1e-9, (kind, worst)


def test_off_the_listing_every_bar_is_withheld_and_named():
    sink = {}
    tree = {"type": "op", "name": "-", "args": [ai.volume_index_level_tree("nvi"),
            ai.volume_index_level_tree("pvi")]}
    col = ai.interpret(tree, BARS, opts=dict(OFF, chartClockSink=sink))
    assert all(v is None for v in col)
    assert "cum:volume-index" in sink
    assert ai.whole_series_withheld(ai.volume_index_level_tree("pvi"), BARS, opts=OFF) == ("cum:volume-index",)


def test_from_the_listing_and_outside_a_pine_document_nothing_is_withheld():
    t = ai.volume_index_level_tree("nvi")
    assert ai.cumulative_level_mask(t, BARS, opts=dict(OFF, historyFromListing=True)) is None
    assert ai.cumulative_level_mask(t, BARS, opts={"tf": "D"}) is None


def test_the_recogniser_is_exact_and_the_code_is_declared():
    looser = ai.volume_index_level_tree("nvi")
    looser["args"][0]["args"][0]["args"][0]["args"][1]["name"] = "<="
    assert ai.volume_index_kind_of(looser) is None
    assert ai.cumulative_level_mask(looser, BARS, opts=OFF) is None
    assert ai.cumulative_level_mask(ai.volume_index_level_tree("nvi"), BARS, opts=OFF) == [1] * len(BARS)
    assert "cum:volume-index" in ai.CHART_CLOCK_WHOLE
    assert not math.isnan(ai.interpret(looser, BARS, opts=OFF)[-1])
