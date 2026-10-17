"""uct_flag_htf and uct_ma_reclaim (team setup recognition rules, second pair). INTERNAL.

Synthetic fixtures only. What each test pins:
  * each fires on its named fixture, and each named near-miss stays silent
    beside a contrast that DOES fire (a silent detector cannot pass by
    answering "no" to everything);
  * the frozen thresholds and the flag rule's guard are the only things
    silencing a near-miss, each guard clause by name;
  * the liquidity floor, the history floor, and the prior-session trigger rule;
  * detection shape: levels, candle_mark anchors with anchor_roles on real bar
    times, display-only secondary lines, narrative, canonical confidence;
  * registration: internal, out of the member catalog, NOT in the team drawing
    set, drawn experimental; both declare their history to the scan.
The lab parity (lab vs app, no lookahead) lives in test_uct_team_setups2_parity.py.
"""
import pytest

from api.services.pattern_engine.detectors import registry
from api.services.pattern_engine.detectors.uct import uct_flag_htf as FL
from api.services.pattern_engine.detectors.uct import uct_ma_reclaim as MR
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors import _team_setups2_synth as SY

_IDS = ("uct_flag_htf", "uct_ma_reclaim")


def _ctx(bars):
    return build_context(bars, sym="TEST")


def _last(mod, bars):
    return mod.evaluate(bars, U.series(bars), len(bars) - 1)


# ── fire ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("make,variant", [
    (lambda: SY.flag(), "forming"), (lambda: SY.flag(pole_gain=1.2), "forming_htf"),
    (lambda: SY.flag(last="breakout"), "breakout")])
def test_flag_fires_forming_and_through_the_line(make, variant):
    bars = make()
    (d,) = FL.detect_uct_flag_htf(bars, _ctx(bars))
    ex, lv = d["geometry"]["extras"], d["levels"]
    assert d["pattern_id"] == "uct_flag_htf" and d["direction"] == "bullish"
    assert ex["variant"] == variant and ex["trigger_bars_ago"] == 0
    assert ex["pole_gain"] >= FL.FL_GAIN and ex["flag_depth"] <= FL.FL_DEPTH
    assert lv["pivot"] == ex["flag_top"] and lv["stop"] == ex["flag_low"]
    assert ex["label_variants"] == (["high_tight_flag"] if variant.endswith("_htf") else [])
    if variant.startswith("forming"):
        assert lv["entry"] == ex["flag_top"]
    else:
        assert lv["entry"] == round(bars[-1]["c"], 2)


def test_ma_reclaim_fires_on_the_first_close_back_above_the_50():
    bars = SY.ma_reclaim()
    (d,) = MR.detect_uct_ma_reclaim(bars, _ctx(bars))
    ex, S = d["geometry"]["extras"], U.series(bars)
    assert d["pattern_id"] == "uct_ma_reclaim" and ex["variant"] == "reclaim_s50"
    assert bars[-1]["c"] > S["s50"][-1] and bars[-2]["c"] <= S["s50"][-2]
    assert ex["closes_below_prior20"] >= MR.MR_BELOW and ex["pos_atr"] <= MR.MR_EXT_ATR
    assert d["levels"]["entry"] == round(bars[-1]["c"], 2)
    assert d["levels"]["stop"] == round(bars[-1]["l"], 2)
    assert d["levels"]["pivot"] == ex["ma_value"]


# ── near-misses, each beside a contrast that fires ───────────────────────────

def test_a_deep_pullback_is_not_a_flag(monkeypatch):
    bars = SY.flag(depth=0.85)
    f = FL.features(bars, U.series(bars), len(bars) - 1)
    assert f["forming"]["depth"] > FL.FL_DEPTH
    assert _last(FL, bars) is None
    assert _last(FL, SY.flag()) is not None
    monkeypatch.setattr(FL, "FL_DEPTH", 0.99)
    assert FL.evaluate_unguarded(bars, U.series(bars), len(bars) - 1) is not None


def test_a_small_pole_is_not_a_flag(monkeypatch):
    bars = SY.flag(pole_gain=0.20)
    f = FL.features(bars, U.series(bars), len(bars) - 1)
    assert f["forming"]["gain"] < FL.FL_GAIN
    assert _last(FL, bars) is None
    monkeypatch.setattr(FL, "FL_GAIN", 0.10)
    assert _last(FL, bars) is not None


@pytest.mark.parametrize("make,reason", [
    (lambda: SY.flag(falling_base=True), "falling200"), (lambda: SY.flag_pinned(), "pinned")])
def test_the_guard_suppresses_a_flag_through_each_clause(make, reason):
    """The unguarded rule fires; the guard names exactly one clause; the
    confirmed rule and the detector stay silent."""
    bars = make()
    S, i = U.series(bars), len(bars) - 1
    assert FL.evaluate_unguarded(bars, S, i) is not None, "it IS a flag; only the guard refuses it"
    assert FL.guard(bars, S, i) == (True, [reason])
    assert FL.evaluate(bars, S, i) is None
    assert all(d["geometry"]["extras"]["trigger_bars_ago"] != 0
               for d in FL.detect_uct_flag_htf(bars, _ctx(bars)))


def test_the_guard_does_not_touch_a_flag_in_an_uptrend():
    bars = SY.flag()
    assert FL.guard(bars, U.series(bars), len(bars) - 1) == (False, [])


def test_an_extended_reclaim_does_not_fire(monkeypatch):
    bars = SY.ma_reclaim(last="extended")
    f = MR.features(bars, U.series(bars), len(bars) - 1)
    assert f["s50"]["days"] == 0 and f["s50"]["pos"] > MR.MR_EXT_ATR
    assert _last(MR, bars) is None
    monkeypatch.setattr(MR, "MR_EXT_ATR", 99.0)
    assert _last(MR, bars) is not None


def test_two_closes_under_is_not_enough(monkeypatch):
    bars = SY.ma_reclaim(under=2)
    f = MR.features(bars, U.series(bars), len(bars) - 1)
    assert f["s50"]["days"] == 0 and f["s50"]["below"] < MR.MR_BELOW
    assert _last(MR, bars) is None
    monkeypatch.setattr(MR, "MR_BELOW", 1)
    assert _last(MR, bars) is not None


def test_a_reclaim_one_session_old_is_not_a_new_fire():
    bars = SY.ma_reclaim()
    c = bars[-1]["c"]
    held = bars + [SY.bar(len(bars), c, c * 1.004, c * 0.999, c * 1.003, 1_500_000)]
    f = MR.features(held, U.series(held), len(held) - 1)
    assert f["s50"]["days"] == 1
    assert _last(MR, held) is None
    assert any(d["geometry"]["extras"]["trigger_bars_ago"] == 1
               for d in MR.detect_uct_ma_reclaim(held, {}))


# ── wrapper ──────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("mod,make,detect", [
    (FL, SY.flag, "detect_uct_flag_htf"), (MR, SY.ma_reclaim, "detect_uct_ma_reclaim")])
def test_the_liquidity_floor_applies(mod, make, detect):
    bars = make()
    fn = getattr(mod, detect)
    penny = SY.as_penny(bars, div=100.0)
    assert penny[-1]["c"] < 2.0 and _last(mod, penny) is not None
    assert fn(penny, {}) == []
    thin = [{**b, "v": 50.0} for b in bars]
    assert _last(mod, thin) is not None and fn(thin, {}) == []
    assert len(fn(bars, {})) == 1


def test_the_flag_detector_needs_the_history_its_guard_reads():
    """G1 reads the 200 SMA 20 sessions back; with less history the lab rule
    would answer unguarded, which is the rule that was NOT confirmed."""
    bars = SY.flag()
    assert FL._MIN_BARS == 220 and FL.MIN_BARS == 222
    assert FL.detect_uct_flag_htf(bars[-219:], {}) == []
    assert _last(FL, bars[-219:]) is not None, "the rule itself still answers there"
    assert len(FL.detect_uct_flag_htf(bars[-220:], {})) == 1


def test_the_reclaim_declares_the_history_of_its_200_sma_branch():
    assert MR._MIN_IDX == 222 and MR.MIN_BARS == 225
    bars = SY.ma_reclaim(n_up=300)
    short = bars[-MR._MIN_IDX:]
    f = MR.features(short, U.series(short), len(short) - 1)
    assert "s50" in f and "s200" not in f, "one bar short: the 200 SMA branch is not evaluable"
    w = bars[-(MR._MIN_IDX + 1):]
    assert "s200" in MR.features(w, U.series(w), len(w) - 1)


def test_a_prior_session_flag_is_reported_only_while_its_stop_holds():
    bars = SY.flag(last="breakout")
    stop, c = FL.evaluate(bars, U.series(bars), len(bars) - 1)["stop"], bars[-1]["c"]
    held = bars + [SY.bar(len(bars), c, c + 0.5, c - 0.6, c + 0.2, 1_500_000)]
    assert _last(FL, held) is None
    assert any(d["geometry"]["extras"]["trigger_bars_ago"] == 1 for d in FL.detect_uct_flag_htf(held, {}))
    broke = bars + [SY.bar(len(bars), c, c + 0.5, stop - 0.5, c - 0.3, 1_500_000)]
    assert all(d["geometry"]["extras"]["trigger_bars_ago"] != 1 for d in FL.detect_uct_flag_htf(broke, {}))


def test_never_raises_on_short_or_degenerate_input():
    for fn in (FL.detect_uct_flag_htf, MR.detect_uct_ma_reclaim):
        assert fn([], {}) == []
        assert fn(SY.flag()[:5], {}) == []
        flat = [{**b, "o": 50.0, "h": 50.0, "l": 50.0, "c": 50.0} for b in SY.flag()]
        assert fn(flat, {}) == []
        assert fn(SY.flag(), None) is not None


# ── shape ────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("pid,make,roles,lab_rule", [
    ("uct_flag_htf", lambda: SY.flag(), ["pole_high", "flag_low"],
     "team_rules.flag_htf+team_rules_r2.guard"),
    ("uct_flag_htf", lambda: SY.flag(last="breakout"), ["pole_high", "flag_low"],
     "team_rules.flag_htf+team_rules_r2.guard"),
    ("uct_ma_reclaim", lambda: SY.ma_reclaim(), ["reclaimed_ma", "session_low"], "team_rules.ma_reclaim")])
def test_detection_shape(pid, make, roles, lab_rule):
    bars = make()
    fn = FL.detect_uct_flag_htf if pid == "uct_flag_htf" else MR.detect_uct_ma_reclaim
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


def test_not_in_the_team_drawing_set_and_drawn_experimental():
    for pid in _IDS:
        assert pid not in registry.DISPLAY_TEAM_SET and pid not in registry.DISPLAY_TRUSTED
        assert pid not in registry.DISPLAY_HIDDEN
        pol = registry.display_policy(pid)
        assert pol["display_tier"] == "experimental" and pol["display_layer"] == "structures"


def test_scan_depth_declarations():
    import api.routers.patterns  # noqa: F401
    assert registry.min_bars_for("uct_flag_htf") == FL.MIN_BARS
    assert registry.min_bars_for("uct_ma_reclaim") == MR.MIN_BARS
    assert not registry.wants_sym("uct_flag_htf") and not registry.wants_sym("uct_ma_reclaim")
    bars = list(range(300))
    assert registry.bars_for("uct_flag_htf", bars, 200) == bars[-FL.MIN_BARS:]
    assert registry.bars_for("uct_ma_reclaim", bars, 200) == bars[-MR.MIN_BARS:]


def test_the_universe_scan_computes_both():
    from api.services.pattern_engine import detect_all
    import api.routers.patterns  # noqa: F401
    fired = set()
    for make, pid in ((SY.flag, _IDS[0]), (SY.ma_reclaim, _IDS[1])):
        bars = make()
        fired |= {d["pattern_id"] for d in detect_all(bars, _ctx(bars), pattern_ids=[pid])}
    assert fired == set(_IDS)


def test_the_existing_detectors_are_untouched():
    import api.routers.patterns  # noqa: F401
    ids = set(registry.list_pattern_ids())
    for pid in ("bull_flag", "high_tight_flag", "pennant", "remount"):
        assert pid in ids
        assert not registry.is_internal(pid)
