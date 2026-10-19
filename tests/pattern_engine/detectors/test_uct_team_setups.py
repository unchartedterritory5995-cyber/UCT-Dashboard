"""uct_inside_day and uct_flat_top_breakout (team setup recognition rules). INTERNAL.

Synthetic fixtures only. What each test pins:
  * each fires on its named fixture, and each named near-miss stays silent
    beside a contrast that DOES fire (a silent detector cannot pass by
    answering "no" to everything);
  * the frozen thresholds are the only thing silencing a near-miss;
  * the liquidity floor, the warm-up, and the prior-session trigger rule;
  * detection shape: levels, candle_mark anchors with anchor_roles on real bar
    times, display-only secondary lines, narrative, canonical confidence;
  * registration: internal, out of the member catalog; inside_day is NOT in the
    team drawing set and is drawn experimental, flat_top IS (team + member set,
    trusted, since 2026-10-18); flat_top declares its history to the scan.
The lab parity (lab vs app, no lookahead) lives in test_uct_team_setups_parity.py.
"""
import pytest

from api.services.pattern_engine.detectors import registry
from api.services.pattern_engine.detectors.uct import uct_flat_top_breakout as FT
from api.services.pattern_engine.detectors.uct import uct_inside_day as ID
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors import _team_setups_synth as SY

_IDS = ("uct_inside_day", "uct_flat_top_breakout")


def _ctx(bars):
    return build_context(bars, sym="TEST")


def _last(mod, bars):
    return mod.evaluate(bars, U.series(bars), len(bars) - 1)


# ── fire ─────────────────────────────────────────────────────────────────────

def test_inside_day_fires_on_a_tight_inside_day_in_a_stacked_uptrend():
    bars = SY.inside_day()
    (d,) = ID.detect_uct_inside_day(bars, _ctx(bars))
    ex, last, prev = d["geometry"]["extras"], bars[-1], bars[-2]
    S = U.series(bars)
    assert d["pattern_id"] == "uct_inside_day" and d["direction"] == "bullish"
    assert ex["variant"] == "inside" and ex["trigger_bars_ago"] == 0
    assert last["h"] <= prev["h"] and last["l"] >= prev["l"]
    assert last["c"] > S["e8"][-1] > S["e21"][-1] > S["s50"][-1]
    assert d["levels"]["entry"] == round(last["h"], 2)
    assert d["levels"]["stop"] == round(last["l"], 2)
    assert ex["range_atr"] <= ID.ID_TIGHT_ATR


def test_a_second_inside_day_is_the_double_inside_variant():
    bars = SY.inside_day()
    p = bars[-1]
    span = p["h"] - p["l"]
    bars = bars + [SY.bar(len(bars), p["l"] + 0.3 * span, p["h"] - 0.2 * span,
                          p["l"] + 0.2 * span, p["h"] - 0.25 * span, 1_000_000)]
    c = _last(ID, bars)
    assert c is not None and c["variant"] == "double_inside"


@pytest.mark.parametrize("last,variant", [("at_line", "at_line"), ("breakout", "breakout")])
def test_flat_top_fires_at_the_line_and_through_it(last, variant):
    bars = SY.flat_top(last=last)
    (d,) = FT.detect_uct_flat_top_breakout(bars, _ctx(bars))
    ex = d["geometry"]["extras"]
    assert d["pattern_id"] == "uct_flat_top_breakout" and ex["variant"] == variant
    assert ex["touch_groups"] >= 2 and ex["base_depth"] <= FT.FT_DEPTH
    assert d["levels"]["pivot"] == ex["ceiling"]
    assert d["levels"]["stop"] == round(bars[-1]["l"], 2)
    if variant == "at_line":
        assert d["levels"]["entry"] == ex["ceiling"] and ex["pos_atr"] <= 0
    else:
        assert d["levels"]["entry"] == round(bars[-1]["c"], 2) and ex["pos_atr"] > 0


# ── near-misses, each beside a contrast that fires ───────────────────────────

def test_an_outside_last_session_is_not_an_inside_day():
    assert _last(ID, SY.outside_last()) is None
    assert ID.detect_uct_inside_day(SY.outside_last(), {}) == []
    assert _last(ID, SY.inside_day()) is not None


def test_an_inside_day_in_a_downtrend_does_not_fire(monkeypatch):
    bars = SY.inside_downtrend()
    assert _last(ID, bars) is None
    f = ID.features(bars, U.series(bars), len(bars) - 1)
    assert f is not None and f["i0"] and not f["stack"], "it IS an inside day; only the trend gate refuses it"
    monkeypatch.setattr(ID, "ID_TREND", None)
    assert _last(ID, bars) is not None


def test_a_wide_inside_day_does_not_fire(monkeypatch):
    bars = SY.inside_day(rng_atr=0.95)
    c = ID.features(bars, U.series(bars), len(bars) - 1)
    assert c["i0"] and c["stack"] and c["rng0"] > ID.ID_TIGHT_ATR
    assert _last(ID, bars) is None
    monkeypatch.setattr(ID, "ID_TIGHT_ATR", 1.5)
    assert _last(ID, bars) is not None


def test_a_close_far_under_the_ceiling_does_not_fire():
    assert _last(FT, SY.flat_top(last="deep")) is None
    assert _last(FT, SY.flat_top()) is not None


def test_a_single_touch_ceiling_does_not_fire(monkeypatch):
    bars = SY.flat_top(touches=(22,))           # one touch inside the 40-session window
    f = FT.features(bars, U.series(bars), len(bars) - 1)
    assert f["groups"] == 1
    assert _last(FT, bars) is None
    assert _last(FT, SY.flat_top()) is not None


def test_a_flat_top_without_the_200_sma_does_not_fire():
    """The frozen trend gate needs s50 > s200, so fewer than 200 bars cannot fire."""
    bars = SY.flat_top()
    assert FT._MIN_BARS == 200 and FT.MIN_BARS == 202
    assert FT.detect_uct_flat_top_breakout(bars[-199:], {}) == []
    assert len(FT.detect_uct_flat_top_breakout(bars[-200:], {})) == 1


# ── wrapper ──────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("mod,make,detect", [
    (ID, SY.inside_day, "detect_uct_inside_day"),
    (FT, SY.flat_top, "detect_uct_flat_top_breakout")])
def test_the_liquidity_floor_applies(mod, make, detect):
    bars = make()
    fn = getattr(mod, detect)
    penny = SY.as_penny(bars, div=100.0)
    assert penny[-1]["c"] < 2.0 and _last(mod, penny) is not None
    assert fn(penny, {}) == []
    thin = [{**b, "v": 50.0} for b in bars]
    assert _last(mod, thin) is not None and fn(thin, {}) == []
    assert len(fn(bars, {})) == 1


def test_a_prior_session_trigger_is_reported_only_while_its_stop_holds():
    bars = SY.inside_day()
    stop, c = bars[-1]["l"], bars[-1]["c"]
    held = bars + [SY.bar(len(bars), c, c + 1.5, c - 0.1, c + 1.4, 1_000_000)]
    assert _last(ID, held) is None
    assert any(d["geometry"]["extras"]["trigger_bars_ago"] == 1 for d in ID.detect_uct_inside_day(held, {}))
    broke = bars + [SY.bar(len(bars), c, c + 1.5, stop - 0.5, c + 1.4, 1_000_000)]
    assert all(d["geometry"]["extras"]["trigger_bars_ago"] != 1 for d in ID.detect_uct_inside_day(broke, {}))


def test_never_raises_on_short_or_degenerate_input():
    for fn in (ID.detect_uct_inside_day, FT.detect_uct_flat_top_breakout):
        assert fn([], {}) == []
        assert fn(SY.flat_top()[:5], {}) == []
        flat = [{**b, "o": 50.0, "h": 50.0, "l": 50.0, "c": 50.0} for b in SY.flat_top()]
        assert fn(flat, {}) == []
        assert fn(SY.flat_top(), None) is not None


# ── shape ────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("pid,bars,roles,lab_rule", [
    ("uct_inside_day", SY.inside_day(), ["inside_high", "inside_low"], "team_rules.inside_day"),
    ("uct_flat_top_breakout", SY.flat_top(last="breakout"), ["ceiling", "session_low"],
     "team_rules.flat_top_breakout")])
def test_detection_shape(pid, bars, roles, lab_rule):
    fn = ID.detect_uct_inside_day if pid == "uct_inside_day" else FT.detect_uct_flat_top_breakout
    (d,) = fn(bars, _ctx(bars))
    g, lv = d["geometry"], d["levels"]
    times = {b["t"] for b in bars}
    assert g["shape"] == "candle_mark" and g["semantic_subtype"] == pid
    assert g["anchor_roles"] == roles and len(g["anchors"]) == 2
    assert all(a["t"] in times for a in g["anchors"])
    for x in g["secondary"]:
        assert x["shape"] == "horizontal_line" and x["label"]
        assert x["anchors"][0]["price"] == x["anchors"][1]["price"]
        assert all(a["t"] in times for a in x["anchors"])
        assert x["anchors"][0]["t"] < x["anchors"][1]["t"]
    assert lv["stop"] < lv["entry"] < lv["target_primary"] < lv["target_secondary"]
    assert d["category"] == "uct" and d["status"] == "triggered"
    for k in ("headline", "what_it_is", "why_it_matters", "what_to_watch_for", "failure_signal"):
        assert d["narrative"][k]
    q = d["quality_components"]
    assert q["historical_score"] == U.HIST_SCORE
    assert d["confidence"] == round(0.40 * q["geometry_score"] + 0.25 * q["volume_score"]
                                    + 0.20 * q["context_score"] + 0.15 * q["historical_score"], 2)
    assert d["confidence"] >= U.CONFIDENCE_FLOOR
    assert g["extras"]["lab_rule"] == lab_rule


# ── registration + internal gating ───────────────────────────────────────────

def test_registered_internal_and_kept_out_of_the_member_catalog():
    import api.routers.patterns as patterns_router
    rows = [{"pattern_id": p} for p in (*_IDS, "bull_flag")]
    assert [r["pattern_id"] for r in registry.drop_internal(rows)] == ["bull_flag"]
    for pid in _IDS:
        assert pid in set(registry.list_pattern_ids())
        assert registry.is_internal(pid) and pid in registry.INTERNAL_PATTERN_IDS
        assert pid not in registry.list_public_pattern_ids()
        assert pid not in patterns_router._PATTERN_METADATA


def test_inside_day_is_not_in_the_team_drawing_set_and_drawn_experimental():
    pid = "uct_inside_day"
    assert pid not in registry.DISPLAY_TEAM_SET and pid not in registry.DISPLAY_TRUSTED
    assert pid not in registry.DISPLAY_HIDDEN
    pol = registry.display_policy(pid)
    assert pol["display_tier"] == "experimental" and pol["display_layer"] == "structures"


def test_flat_top_is_in_the_team_and_member_sets_and_drawn_trusted():
    """2026-10-18 (lab flattop_draw_v2): the "flat top" ceiling passed two blind packets AS DRAWN,
    so the detector joined the team set and the member set; a member is served only its v2-stamped
    drawing (tests/test_flat_top_member_drawing.py). Firing is unchanged: it stays INTERNAL."""
    pid = "uct_flat_top_breakout"
    assert pid in registry.DISPLAY_TEAM_SET and pid in registry.DISPLAY_MEMBER_SET
    assert pid not in registry.DISPLAY_HIDDEN and registry.is_internal(pid)
    pol = registry.display_policy(pid)
    assert pol["display_tier"] == "trusted" and pol["display_layer"] == "structures"
    assert pol["draw_entry"] is False


def test_scan_depth_declarations():
    import api.routers.patterns  # noqa: F401
    assert registry.min_bars_for("uct_flat_top_breakout") == FT.MIN_BARS
    assert registry.min_bars_for("uct_inside_day") is None, "66 bars is inside the scan's base 200"
    assert not registry.wants_sym("uct_inside_day") and not registry.wants_sym("uct_flat_top_breakout")
    bars = list(range(300))
    assert registry.bars_for("uct_flat_top_breakout", bars, 200) == bars[-FT.MIN_BARS:]
    assert registry.bars_for("uct_inside_day", bars, 200) == bars[-200:]


def test_the_universe_scan_computes_both():
    from api.services.pattern_engine import detect_all
    import api.routers.patterns  # noqa: F401
    fired = set()
    for make, pid in ((SY.inside_day, _IDS[0]), (SY.flat_top, _IDS[1])):
        bars = make()
        fired |= {d["pattern_id"] for d in detect_all(bars, _ctx(bars), pattern_ids=[pid])}
    assert fired == set(_IDS)


def test_the_existing_detectors_are_untouched():
    import api.routers.patterns  # noqa: F401
    ids = set(registry.list_pattern_ids())
    for pid in ("inside_bar_breakout", "nr7", "flat_base", "rectangle", "donchian_breakout",
                "ascending_triangle"):
        assert pid in ids
        assert not registry.is_internal(pid)
