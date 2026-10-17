"""uct_trendline_break (team setup recognition rule, third port). INTERNAL.

Synthetic fixtures only. What each test pins:
  * it fires on its named fixture, and each named near-miss (red session, no
    close above the prior high, too far past the line, not the first close
    above the line) stays silent beside a contrast that DOES fire, and moves
    when exactly the threshold that silences it is relaxed;
  * the line comes from the FROZEN drawer vendored in the module: the module
    never imports the display drawer, and a mutated display drawer cannot move
    what the detector fires on;
  * the liquidity floor, the history floor, and the prior-session trigger rule;
  * detection shape: levels, candle_mark anchors with anchor_roles on real bar
    times, the tested line in extras on real bar times, narrative, canonical
    confidence;
  * registration: internal, out of the member catalog, NOT in the team drawing
    set, drawn experimental, no history declared to the scan (the scan's base
    slice already reproduces the full-history answer).
The lab parity (lab vs app, no lookahead, mutations, real bars, scan window)
lives in test_uct_team_setups3_parity.py.
"""
import ast
import inspect

import pytest

from api.services.pattern_engine.detectors import registry
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.detectors.uct import uct_trendline_break as TB
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors import _team_setups3_synth as SY

_ID = "uct_trendline_break"


def _ctx(bars):
    return build_context(bars, sym="TEST")


def _last(bars):
    return TB.evaluate(bars, U.series(bars), len(bars) - 1)


def _facts(bars):
    return TB.features(bars, U.series(bars), len(bars) - 1)


# ── fire ─────────────────────────────────────────────────────────────────────

def test_fires_on_a_green_close_through_the_falling_line():
    bars = SY.trendline_break()
    (d,) = TB.detect_uct_trendline_break(bars, _ctx(bars))
    ex, lv = d["geometry"]["extras"], d["levels"]
    f = _facts(bars)
    assert d["pattern_id"] == _ID and d["direction"] == "bullish"
    assert ex["variant"] == "break" and ex["trigger_bars_ago"] == 0
    assert f["cross0"] and f["green"] and f["gt_ph"] and f["pos"] <= TB.TLB_EXT
    assert f["slope_atr"] < 0 and f["p2"] < f["p1"], "the tested line falls"
    assert lv["entry"] == round(bars[-1]["c"], 2) and lv["stop"] == round(bars[-1]["l"], 2)
    assert lv["pivot"] == round(ex["trendline"]["p_end"], 2)
    assert bars[-1]["c"] > ex["trendline"]["p_end"], "the close is through the line"


# ── near-misses, each beside a contrast that fires ───────────────────────────

def test_a_red_session_through_the_line_is_not_a_break():
    bars = SY.trendline_break(last="red")
    f = _facts(bars)
    assert f["cross0"] and f["gt_ph"] and not f["green"]
    assert _last(bars) is None
    assert _last(SY.trendline_break()) is not None


def test_a_close_not_above_the_prior_high_is_not_a_break():
    bars = SY.trendline_break(last="no_ph")
    f = _facts(bars)
    assert f["cross0"] and f["green"] and not f["gt_ph"]
    assert _last(bars) is None


def test_a_close_far_past_the_line_is_not_a_break(monkeypatch):
    bars = SY.trendline_break(last="extended")
    f = _facts(bars)
    assert f["cross0"] and f["green"] and f["gt_ph"] and f["pos"] > TB.TLB_EXT
    assert _last(bars) is None
    monkeypatch.setattr(TB, "TLB_EXT", 99.0)
    assert _last(bars) is not None


def _first_follow_through():
    """A seeded walk session that meets every condition except "first close
    above the line in ten sessions" (found by scanning fixed seeds, so the
    test is deterministic and the near-miss is a real drawer line)."""
    for seed in range(40):
        bars = SY.regime_walk(n=300, seed=seed)
        S = U.series(bars)
        for i in range(70, len(bars)):
            b, p = bars[i], bars[i - 1]
            if not (b["c"] > b["o"] and b["c"] > p["h"]):
                continue
            f = TB.features(bars, S, i)
            if (f and f["cross0"] and f["pos"] <= TB.TLB_EXT and f["ago"] is not None
                    and f["ago"] <= TB.TLB_FIRST):
                return bars, S, i, f
    raise AssertionError("no follow-through session in the fixed seeds")


def test_follow_through_after_an_earlier_close_above_is_not_a_break(monkeypatch):
    bars, S, i, f = _first_follow_through()
    assert TB.evaluate(bars, S, i) is None
    monkeypatch.setattr(TB, "TLB_FIRST", f["ago"] - 1)
    assert TB.evaluate(bars, S, i) is not None


def test_no_falling_line_means_no_answer():
    bars = SY.trend(200, start=40.0, step=0.25, seed=3)   # a steady rise: highs never fall
    S = U.series(bars)
    assert all(TB.features(bars, S, i) is None for i in range(150, len(bars)))


# ── the frozen drawer ────────────────────────────────────────────────────────

def test_the_module_never_imports_the_display_drawer():
    tree = ast.parse(inspect.getsource(TB))
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names |= {a.name for a in node.names}
        elif isinstance(node, ast.ImportFrom):
            names.add(node.module or "")
            names |= {f"{node.module}.{a.name}" for a in node.names}
    assert not any("auto_draw" in n for n in names), names
    # control: the parse does see the imports this module does have
    assert "api.services.pattern_engine.detectors.uct.uct_setups_common" in names


def test_a_changed_display_drawer_cannot_move_the_detector(monkeypatch):
    """Mutate every trendline piece of the live display drawer; the detector's
    answer on the firing fixture must not move."""
    from api.services import auto_draw as AD
    bars = SY.trendline_break()
    before = _last(bars)
    assert before is not None
    monkeypatch.setattr(AD, "t_candidates", lambda *a, **k: [])
    monkeypatch.setattr(AD, "nms_t", lambda *a, **k: [])
    monkeypatch.setattr(AD, "TOUCH_ATR", 9.0)
    monkeypatch.setitem(AD.MODEL["trendline"], "intercept", 40.0)
    assert _last(bars) == before


def test_the_vendored_model_is_the_drawer_model_the_display_drawer_was_ported_from():
    """The display drawer was ported from the same lab file; today its
    trendline weights still equal the frozen ones. This is a record, not a
    dependency: if the display weights move, THIS test is the one to update,
    never the frozen block."""
    from api.services import auto_draw as AD
    for k in ("features", "mean", "scale", "coef", "intercept"):
        assert TB._DR_TRENDLINE_MODEL[k] == AD.MODEL["trendline"][k], k


# ── wrapper ──────────────────────────────────────────────────────────────────

def test_the_liquidity_floor_applies():
    bars = SY.trendline_break()
    penny = SY.as_penny(bars, div=100.0)
    assert penny[-1]["c"] < 2.0 and _last(penny) is not None
    assert TB.detect_uct_trendline_break(penny, {}) == []
    thin = [{**b, "v": 50.0} for b in bars]
    assert _last(thin) is not None and TB.detect_uct_trendline_break(thin, {}) == []
    assert len(TB.detect_uct_trendline_break(bars, {})) == 1


def test_the_warm_up_matches_the_lab_and_nothing_is_declared_to_the_scan():
    import api.routers.patterns  # noqa: F401
    assert TB._WARMUP == 65 and TB._MIN_BARS == 66
    assert registry.min_bars_for(_ID) in (None, 0)
    assert TB.EXACT_WINDOW <= registry.SCAN_BASE_DEPTH, \
        "the scan's base slice must cover the line's look-back for every reported session"
    bars = list(range(300))
    assert registry.bars_for(_ID, bars, registry.SCAN_BASE_DEPTH) == bars[-registry.SCAN_BASE_DEPTH:]


def test_a_prior_session_break_is_reported_only_while_its_stop_holds():
    bars = SY.trendline_break()
    stop, c = _last(bars)["stop"], bars[-1]["c"]
    held = bars + [SY.bar(len(bars), c, c * 1.004, c * 0.997, c * 0.999, 1_500_000)]
    assert _last(held) is None
    assert any(d["geometry"]["extras"]["trigger_bars_ago"] == 1
               for d in TB.detect_uct_trendline_break(held, {}))
    broke = bars + [SY.bar(len(bars), c, c * 1.004, stop * 0.99, c * 0.98, 1_500_000)]
    assert all(d["geometry"]["extras"]["trigger_bars_ago"] != 1
               for d in TB.detect_uct_trendline_break(broke, {}))


def test_never_raises_on_short_or_degenerate_input():
    fn = TB.detect_uct_trendline_break
    assert fn([], {}) == []
    assert fn(SY.trendline_break()[:5], {}) == []
    flat = [{**b, "o": 50.0, "h": 50.0, "l": 50.0, "c": 50.0} for b in SY.trendline_break()]
    assert fn(flat, {}) == []
    assert fn(SY.trendline_break(), None) is not None


# ── shape ────────────────────────────────────────────────────────────────────

def test_detection_shape():
    bars = SY.trendline_break()
    (d,) = TB.detect_uct_trendline_break(bars, _ctx(bars))
    g, lv, ex = d["geometry"], d["levels"], d["geometry"]["extras"]
    times = {b["t"] for b in bars}
    assert g["shape"] == "candle_mark" and g["semantic_subtype"] == _ID
    assert g["anchor_roles"] == ["trendline", "session_low"] and len(g["anchors"]) == 2
    assert all(a["t"] in times for a in g["anchors"])
    for x in g["secondary"]:
        assert x["shape"] == "horizontal_line" and x["label"]
        assert x["anchors"][0]["price"] == x["anchors"][1]["price"]
        assert all(a["t"] in times for a in x["anchors"])
        assert x["anchors"][0]["t"] < x["anchors"][1]["t"]
    tl = ex["trendline"]
    assert {tl["t1"], tl["t2"], tl["t_end"], tl["drawn_asof_t"]} <= times
    assert tl["t1"] < tl["t2"] <= tl["drawn_asof_t"] < tl["t_end"], "drawn from bars before the break"
    assert tl["p2"] < tl["p1"]
    assert lv["stop"] < lv["entry"] < lv["target_primary"] < lv["target_secondary"]
    assert d["category"] == "uct" and d["status"] == "triggered"
    for k in ("headline", "what_it_is", "why_it_matters", "what_to_watch_for", "failure_signal"):
        assert d["narrative"][k]
    q = d["quality_components"]
    assert q["historical_score"] == U.HIST_SCORE
    assert d["confidence"] == round(0.40 * q["geometry_score"] + 0.25 * q["volume_score"]
                                    + 0.20 * q["context_score"] + 0.15 * q["historical_score"], 2)
    assert d["confidence"] >= U.CONFIDENCE_FLOOR
    assert ex["lab_rule"].startswith("team_rules_r2.trendline_break_v2")


# ── registration + internal gating ───────────────────────────────────────────

def test_registered_internal_and_kept_out_of_the_member_catalog():
    import api.routers.patterns as patterns_router
    rows = [{"pattern_id": p} for p in (_ID, "bull_flag")]
    assert [r["pattern_id"] for r in registry.drop_internal(rows)] == ["bull_flag"]
    assert _ID in set(registry.list_pattern_ids())
    assert registry.is_internal(_ID) and _ID in registry.INTERNAL_PATTERN_IDS
    assert _ID not in registry.list_public_pattern_ids()
    assert _ID not in patterns_router._PATTERN_METADATA


def test_not_in_the_team_drawing_set_and_drawn_experimental():
    assert _ID not in registry.DISPLAY_TEAM_SET and _ID not in registry.DISPLAY_TRUSTED
    assert _ID not in registry.DISPLAY_HIDDEN
    pol = registry.display_policy(_ID)
    assert pol["display_tier"] == "experimental" and pol["display_layer"] == "structures"


def test_the_universe_scan_computes_it():
    from api.services.pattern_engine import detect_all
    import api.routers.patterns  # noqa: F401
    bars = SY.trendline_break()
    fired = {d["pattern_id"] for d in detect_all(bars, _ctx(bars), pattern_ids=[_ID])}
    assert fired == {_ID}


def test_the_existing_detectors_are_untouched():
    import api.routers.patterns  # noqa: F401
    ids = set(registry.list_pattern_ids())
    assert "major_trendlines" in ids and not registry.is_internal("major_trendlines")


# ═════════════════════════════════════════════════════════════════════════════
# uct_launch_pad_v4 (same commit, same pattern)
# ═════════════════════════════════════════════════════════════════════════════
from api.services.pattern_engine.detectors.uct import uct_launch_pad_v4 as LP  # noqa: E402

_LP_ID = "uct_launch_pad_v4"


def _lp_last(bars):
    return LP.evaluate(bars, U.series(bars), len(bars) - 1)


def _lp_facts(bars):
    return LP.features(bars, U.series(bars), len(bars) - 1)


def test_launch_pad_fires_just_above_a_tight_cluster():
    bars = SY.launch_pad()
    (d,) = LP.detect_uct_launch_pad_v4(bars, _ctx(bars))
    ex, lv = d["geometry"]["extras"], d["levels"]
    f = _lp_facts(bars)
    assert d["pattern_id"] == _LP_ID and ex["variant"] == "stacked" and ex["trigger_bars_ago"] == 0
    assert 0 < f["above"] <= LP.LP_ABOVE_MAX and f["spread"] <= LP.LP_SPREAD and not f["f200_over"]
    assert lv["entry"] == round(bars[-1]["c"], 2)
    assert lv["pivot"] == round(max(ex["e8"], ex["e21"], ex["s50"]), 2)


def test_a_wide_cluster_is_not_a_pad(monkeypatch):
    bars = SY.launch_pad(base=22)
    f = _lp_facts(bars)
    assert LP.LP_SPREAD < f["spread"] <= LP.LP_CORE_SPREAD and 0 < f["above"] <= LP.LP_ABOVE_MAX
    assert _lp_last(bars) is None
    monkeypatch.setattr(LP, "LP_SPREAD", 1.0)
    assert _lp_last(bars) is not None


def test_a_close_far_above_the_pad_is_not_a_pad():
    bars = SY.launch_pad(last="extended")
    f = _lp_facts(bars)
    assert f["above"] > LP.LP_ABOVE_MAX
    assert _lp_last(bars) is None
    assert _lp_last(SY.launch_pad()) is not None


def test_a_close_under_the_cluster_is_not_a_pad():
    bars = SY.launch_pad(last="below")
    assert _lp_facts(bars)["above"] <= 0
    assert _lp_last(bars) is None


def test_a_falling_200_overhead_refuses_the_pad():
    bars = SY.launch_pad(falling_base=True)
    S, i = U.series(bars), len(bars) - 1
    f = LP.features(bars, S, i)
    assert f["f200_over"] and LP.falling_200_overhead(bars, S, i)
    assert 0 < f["above"] <= LP.LP_ABOVE_MAX and f["spread"] <= LP.LP_SPREAD, "it IS a pad shape"
    assert LP.evaluate(bars, S, i) is None


def test_no_50_slope_gate_and_no_tightness_gate():
    assert LP.LP_CURL is None and LP.LP_TIGHT is None and LP.LP_MODE == "c>all3"


def test_launch_pad_liquidity_floor_applies():
    bars = SY.launch_pad()
    penny = SY.as_penny(bars, div=100.0)
    assert _lp_last(penny) is not None and LP.detect_uct_launch_pad_v4(penny, {}) == []
    thin = [{**b, "v": 50.0} for b in bars]
    assert _lp_last(thin) is not None and LP.detect_uct_launch_pad_v4(thin, {}) == []


def test_launch_pad_needs_the_history_its_200_gate_reads():
    """The falling-200 gate reads the 200 SMA 20 sessions back; with less
    history the lab rule answers without that gate, which is not the rule that
    was judged."""
    bars = SY.launch_pad()
    assert LP._MIN_BARS == 220 and LP.MIN_BARS == 222
    assert LP.detect_uct_launch_pad_v4(bars[-219:], {}) == []
    assert _lp_last(bars[-219:]) is not None, "the rule itself still answers there"
    assert len(LP.detect_uct_launch_pad_v4(bars[-220:], {})) == 1


def test_a_prior_session_pad_is_reported_only_while_its_stop_holds():
    bars = SY.launch_pad()
    cand = _lp_last(bars)
    stop, pad, c = cand["stop"], cand["pad"], bars[-1]["c"]
    mid = (pad + stop) / 2          # closes back under the pad (no new fire), low above the floor
    held = bars + [SY.bar(len(bars), c, c, stop * 1.001, mid, 1_500_000)]
    assert _lp_last(held) is None
    assert [d["geometry"]["extras"]["trigger_bars_ago"]
            for d in LP.detect_uct_launch_pad_v4(held, {})] == [1]
    broke = bars + [SY.bar(len(bars), c, c, stop * 0.99, mid, 1_500_000)]
    assert _lp_last(broke) is None
    assert LP.detect_uct_launch_pad_v4(broke, {}) == []


def test_launch_pad_never_raises_on_short_or_degenerate_input():
    fn = LP.detect_uct_launch_pad_v4
    assert fn([], {}) == [] and fn(SY.launch_pad()[:5], {}) == []
    flat = [{**b, "o": 50.0, "h": 50.0, "l": 50.0, "c": 50.0} for b in SY.launch_pad()]
    assert fn(flat, {}) == []
    assert fn(SY.launch_pad(), None) is not None


def test_launch_pad_detection_shape():
    bars = SY.launch_pad()
    (d,) = LP.detect_uct_launch_pad_v4(bars, _ctx(bars))
    g, lv = d["geometry"], d["levels"]
    times = {b["t"] for b in bars}
    assert g["shape"] == "candle_mark" and g["semantic_subtype"] == _LP_ID
    assert g["anchor_roles"] == ["pad", "cluster_floor"] and len(g["anchors"]) == 2
    assert all(a["t"] in times for a in g["anchors"])
    for x in g["secondary"]:
        assert x["shape"] == "horizontal_line" and x["label"]
        assert x["anchors"][0]["price"] == x["anchors"][1]["price"]
        assert x["anchors"][0]["t"] < x["anchors"][1]["t"]
        assert all(a["t"] in times for a in x["anchors"])
    assert lv["stop"] < lv["entry"] < lv["target_primary"] < lv["target_secondary"]
    for k in ("headline", "what_it_is", "why_it_matters", "what_to_watch_for", "failure_signal"):
        assert d["narrative"][k]
    q = d["quality_components"]
    assert d["confidence"] == round(0.40 * q["geometry_score"] + 0.25 * q["volume_score"]
                                    + 0.20 * q["context_score"] + 0.15 * q["historical_score"], 2)
    assert g["extras"]["lab_rule"] == "team_rules_r6.launch_pad_v4"


def test_launch_pad_registered_internal_out_of_the_catalog_and_the_team_set():
    import api.routers.patterns as patterns_router
    assert _LP_ID in set(registry.list_pattern_ids())
    assert registry.is_internal(_LP_ID) and _LP_ID not in registry.list_public_pattern_ids()
    assert _LP_ID not in patterns_router._PATTERN_METADATA
    assert _LP_ID not in registry.DISPLAY_TEAM_SET and _LP_ID not in registry.DISPLAY_HIDDEN
    assert registry.display_policy(_LP_ID)["display_tier"] == "experimental"
    assert registry.min_bars_for(_LP_ID) == LP.MIN_BARS
    bars = list(range(300))
    assert registry.bars_for(_LP_ID, bars, 200) == bars[-LP.MIN_BARS:]


def test_the_earlier_uct_launch_pad_is_a_different_untouched_detector():
    import api.routers.patterns  # noqa: F401
    from api.services.pattern_engine.detectors.uct import uct_launch_pad as OLD
    assert OLD._PATTERN_ID == "uct_launch_pad" != LP._PATTERN_ID
    assert registry.get_detector("uct_launch_pad") is not registry.get_detector(_LP_ID)


def test_the_universe_scan_computes_the_launch_pad():
    from api.services.pattern_engine import detect_all
    import api.routers.patterns  # noqa: F401
    bars = SY.launch_pad()
    assert {d["pattern_id"] for d in detect_all(bars, _ctx(bars), pattern_ids=[_LP_ID])} == {_LP_ID}
