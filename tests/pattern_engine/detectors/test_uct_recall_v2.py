"""uct_undercut_reclaim + uct_episodic_pivot_v2 (detector recall v2). INTERNAL.

Synthetic fixtures only. What each test pins:
  * each detector fires on its setup and stays silent on the named near-misses
    (downtrend, close below the level, no gap, weak close, gap too old);
  * no lookahead: the rule at session i reads bars[:i+1] only;
  * detection shape: levels (entry / pivot / stop), candle_mark anchors with
    anchor_roles on real bar times, display-only secondary horizontal lines,
    a narrative, canonical confidence, the experimental display tier;
  * internal gating: both ids are registered and admin-only.
The lab parity lives in test_uct_recall_v2_parity.py.
"""
import pytest

from api.services.pattern_engine.detectors import registry
from api.services.pattern_engine.detectors.uct import uct_ep_v2 as EP
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.detectors.uct import uct_undercut_reclaim as UR
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors import _recall_v2_synth as SY

_IDS = ("uct_undercut_reclaim", "uct_episodic_pivot_v2")


def _ctx(bars):
    return build_context(bars, sym="TEST")


def _unr(bars):
    return UR.detect_uct_undercut_reclaim(bars, _ctx(bars))


def _ep(bars):
    return EP.detect_uct_episodic_pivot_v2(bars, _ctx(bars))


# ── undercut & reclaim ───────────────────────────────────────────────────────

def test_unr_fires_on_an_undercut_of_the_prior_low_that_closes_back_above():
    bars = SY.undercut_reclaim()
    (d,) = _unr(bars)
    ex = d["geometry"]["extras"]
    assert d["pattern_id"] == "uct_undercut_reclaim" and d["direction"] == "bullish"
    assert ex["variant"] == "prior_day_low" and "prior_day_low" in ex["levels_hit"]
    assert ex["trigger_bars_ago"] == 0
    prev_low, last = bars[-2]["l"], bars[-1]
    assert d["levels"]["pivot"] == round(prev_low, 2)
    assert d["levels"]["stop"] == round(last["l"], 2)           # the undercut low
    assert d["levels"]["entry"] == round(last["c"], 2)
    assert last["l"] < prev_low < last["c"]


def test_unr_silent_when_the_session_closes_below_the_level():
    assert _unr(SY.undercut_close_below()) == []


def test_unr_silent_in_a_downtrend():
    bars = SY.undercut_in_downtrend()
    S = U.series(bars)
    assert bars[-1]["c"] < S["s50"][-1], "fixture must be below its 50-day"
    assert _unr(bars) == []


def test_unr_silent_on_a_weak_close_in_the_lower_half_of_the_range():
    bars = SY.undercut_reclaim()
    b = dict(bars[-1])
    b["h"] = b["c"] + 3.0                                  # close now in the lower half
    bars[-1] = b
    assert UR.evaluate(bars, U.series(bars), len(bars) - 1) is None


def test_unr_reports_a_prior_session_trigger_only_while_its_stop_holds():
    bars = SY.undercut_reclaim()
    stop = bars[-1]["l"]
    # one quiet session above the stop: the trigger is reported one bar ago
    held = bars + [SY.bar(len(bars), bars[-1]["c"], bars[-1]["c"] + 0.3, stop + 0.2,
                          bars[-1]["c"] + 0.1, 900_000)]
    (d,) = _unr(held)
    assert d["geometry"]["extras"]["trigger_bars_ago"] == 1
    # a session that trades through the undercut low kills it
    broke = bars + [SY.bar(len(bars), bars[-1]["c"], bars[-1]["c"] + 0.1, stop - 0.5,
                           bars[-1]["c"] - 0.2, 900_000)]
    assert all(x["geometry"]["extras"]["trigger_bars_ago"] != 1 for x in _unr(broke))


# ── episodic pivot v2 ────────────────────────────────────────────────────────

def test_ep_fires_on_a_gap_with_volume_and_range_expansion():
    bars = SY.ep_gap(days_after=2)
    (d,) = _ep(bars)
    ex = d["geometry"]["extras"]
    g = len(bars) - 3
    assert d["pattern_id"] == "uct_episodic_pivot_v2"
    assert ex["variant"] == "gap_day_2" and ex["bars_since_gap"] == 2
    assert d["levels"]["pivot"] == round(bars[g - 1]["c"], 2)    # the gap edge
    assert d["levels"]["stop"] == round(bars[g]["l"], 2)         # the gap-day low
    assert ex["gap_t"] == bars[g]["t"]


def test_ep_fires_on_a_mid_range_close_that_production_would_reject():
    """The v2 change: close strength 0.50 (production 0.70)."""
    assert _ep(SY.ep_gap(close_frac=0.6))
    assert _ep(SY.ep_gap(close_frac=0.3)) == []


def test_ep_silent_without_a_gap():
    assert _ep(SY.ep_gap(gap=0.01)) == []


def test_ep_silent_once_the_gap_is_older_than_five_sessions():
    assert _ep(SY.ep_gap(days_after=4))
    assert _ep(SY.ep_gap(days_after=5)) == []


def test_ep_silent_without_volume_expansion():
    assert _ep(SY.ep_gap(vol_x=1.5)) == []


def test_ep_does_not_require_a_base_it_labels_one():
    based = _ep(SY.ep_gap())[0]["geometry"]["extras"]
    assert based["base_bars"] is not None and "based" in based["label_variants"]
    # a spike high the session before the gap: the gap day closes above no
    # 15-60 session base high, so there is no base, and v2 still fires
    bars = SY.ep_gap()
    g = len(bars) - 3
    b = dict(bars[g - 1])
    b["h"] = b["c"] * 1.3
    bars[g - 1] = b
    (d,) = _ep(bars)
    assert d["geometry"]["extras"]["base_bars"] is None
    assert "based" not in d["geometry"]["extras"]["label_variants"]


# ── no lookahead ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("seed", range(6))
def test_no_lookahead_rule_at_i_equals_rule_on_bars_through_i(seed):
    bars = SY.random_walk(seed=seed)
    S_full = U.series(bars)
    seen = 0
    for i in range(90, len(bars)):
        head = bars[:i + 1]
        a = UR.evaluate(bars, S_full, i)
        b = UR.evaluate(head, U.series(head), i)
        assert a == b, i
        assert EP.evaluate(bars, i) == EP.evaluate(head, i), i
        seen += a is not None
    assert seen > 0, "non-vacuity: the walk must contain at least one UnR fire"


def test_future_bars_cannot_change_the_newest_answer():
    bars = SY.undercut_reclaim()
    i = len(bars) - 1
    before = UR.evaluate(bars, U.series(bars), i)
    junk = bars + [SY.bar(i + 1 + k, 1, 1000, 0.5, 2, 1) for k in range(5)]
    assert UR.evaluate(junk, U.series(junk), i) == before
    eb = SY.ep_gap()
    assert EP.evaluate(eb + [SY.bar(len(eb) + k, 1, 1000, 0.5, 2, 1) for k in range(5)],
                       len(eb) - 1) == EP.evaluate(eb, len(eb) - 1)


# ── shape ────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("make,detect", [(SY.undercut_reclaim, _unr), (SY.ep_gap, _ep)])
def test_detection_shape(make, detect):
    bars = make()
    (d,) = detect(bars)
    g = d["geometry"]
    lv = d["levels"]
    assert g["shape"] == "candle_mark" and g["semantic_subtype"] == d["pattern_id"]
    assert len(g["anchors"]) == len(g["anchor_roles"]) == 2
    times = {b["t"] for b in bars}
    assert all(a["t"] in times for a in g["anchors"]), "anchors must sit on real bar times"
    assert round(g["anchors"][0]["price"], 2) == lv["pivot"]
    assert round(g["anchors"][1]["price"], 2) == lv["stop"]
    # display-only horizontal levels via the shared U.hline shape
    sec = {x["role"]: x for x in g["secondary"]}
    assert set(sec) == {"stop", "pivot" if d["pattern_id"] == _IDS[0] else "gap_edge"}
    for x in sec.values():
        assert x["shape"] == "horizontal_line" and x["label"]
        assert x["anchors"][0]["price"] == x["anchors"][1]["price"]
        assert all(a["t"] in times for a in x["anchors"])
    assert round(sec["stop"]["anchors"][0]["price"], 2) == lv["stop"]
    level_role = "pivot" if d["pattern_id"] == _IDS[0] else "gap_edge"
    assert round(sec[level_role]["anchors"][0]["price"], 2) == lv["pivot"]
    assert lv["stop"] < lv["entry"] < lv["target_primary"] < lv["target_secondary"]
    assert d["category"] == "uct" and d["status"] == "triggered"
    for k in ("headline", "what_it_is", "why_it_matters", "what_to_watch_for", "failure_signal"):
        assert d["narrative"][k]
    q = d["quality_components"]
    assert q["historical_score"] == U.HIST_SCORE
    assert d["confidence"] == round(0.40 * q["geometry_score"] + 0.25 * q["volume_score"]
                                    + 0.20 * q["context_score"] + 0.15 * q["historical_score"], 2)
    assert d["confidence"] >= U.CONFIDENCE_FLOOR


@pytest.mark.parametrize("detect", [UR.detect_uct_undercut_reclaim, EP.detect_uct_episodic_pivot_v2])
def test_never_raises_on_short_or_degenerate_input(detect):
    assert detect([], {}) == []
    assert detect(SY.undercut_reclaim()[:5], {}) == []
    flat = [{**b, "o": 10.0, "h": 10.0, "l": 10.0, "c": 10.0, "v": 0.0} for b in SY.ep_gap()]
    assert detect(flat, {}) == []
    penny = [{**b, "o": b["o"] / 40, "h": b["h"] / 40, "l": b["l"] / 40, "c": b["c"] / 40}
             for b in SY.ep_gap()]
    assert detect(penny, {}) == [], "the liquidity floor applies"


# ── registration + internal gating ───────────────────────────────────────────

def test_both_are_registered_internal_and_kept_out_of_the_member_catalog():
    import api.routers.patterns as patterns_router
    ids = set(registry.list_pattern_ids())
    for pid in _IDS:
        assert pid in ids, pid
        assert registry.is_internal(pid) and pid in registry.INTERNAL_PATTERN_IDS
        assert pid not in registry.list_public_pattern_ids()
        assert pid not in patterns_router._PATTERN_METADATA
    rows = [{"pattern_id": p} for p in (*_IDS, "bull_flag")]
    assert [r["pattern_id"] for r in registry.drop_internal(rows)] == ["bull_flag"]


def test_both_draw_as_experimental():
    """The display policy (registry.display_policy) is the one authority on how
    a detection is drawn; neither id is in a trusted or hidden list."""
    for pid in _IDS:
        pol = registry.display_policy(pid)
        # uct_pullback_ma_v5 joined the team drawing set (2026-10-17): its own test pins that.
        assert pol["display_tier"] == "experimental" and pol["display_layer"] == "structures"
        assert pid not in registry.DISPLAY_TRUSTED and pid not in registry.DISPLAY_HIDDEN


def test_the_universe_scan_computes_both():
    """`detect_all` (what the background scan stores) runs them like any detector."""
    from api.services.pattern_engine import detect_all
    import api.routers.patterns  # noqa: F401
    fired = set()
    for make, pid in ((SY.undercut_reclaim, _IDS[0]), (SY.ep_gap, _IDS[1])):
        bars = make()
        fired |= {d["pattern_id"] for d in detect_all(bars, _ctx(bars), pattern_ids=[pid])}
    assert fired == set(_IDS)
