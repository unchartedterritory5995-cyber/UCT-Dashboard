"""uct_pullback_ma_v5 (detector recall v2, pullback v5). INTERNAL.

Synthetic fixtures only. What each test pins:
  * fires on a pullback that tags a rising 21 EMA and holds it;
  * the named near-misses stay silent: an 8-EMA-only tag (the v5 change), a
    falling 21 EMA (v4 guard A), an excluded leveraged ETF (v4 guard D), and the
    liquidity floor; each near-miss is paired with a contrast that DOES fire, so
    a silent detector cannot pass these by answering "no" to everything;
  * no lookahead: the rule at session i reads bars[:i+1] only;
  * detection shape: levels (entry = close, stop = tag-bar low, pivot = tagged
    MA), candle_mark anchors with anchor_roles on real bar times, display-only
    secondary horizontal lines, a narrative, canonical confidence;
  * the warm-up: fewer than 220 bars cannot fire (the 200 SMA 20 sessions back);
  * internal gating: registered, admin-only, out of the member catalog.
The lab parity lives in test_uct_pullback_ma_v5_parity.py.
"""
import pytest

from api.services.pattern_engine.detectors import registry
from api.services.pattern_engine.detectors.uct import uct_pullback_ma_v5 as PB
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors import _pullback_v5_synth as SY

_ID = "uct_pullback_ma_v5"


def _ctx(bars, sym=None):
    ctx = build_context(bars, sym="TEST")
    if sym is not None:
        ctx = {**ctx, "sym": sym}
    return ctx


def _detect(bars, sym=None):
    return PB.detect_uct_pullback_ma_v5(bars, _ctx(bars, sym))


def _eval_last(bars, sym=None):
    return PB.evaluate(bars, U.series(bars), len(bars) - 1, sym)


# ── fire ─────────────────────────────────────────────────────────────────────

def test_fires_on_a_pullback_that_tags_a_rising_21_ema_and_holds_it():
    bars = SY.fire_e21(U.series)
    (d,) = _detect(bars)
    ex = d["geometry"]["extras"]
    S = U.series(bars)
    last = bars[-1]
    assert d["pattern_id"] == _ID and d["direction"] == "bullish"
    assert ex["variant"] == "tag_e21" and ex["tagged"] == ["e21"]
    assert ex["trigger_bars_ago"] == 0 and ex["tag_bar_ago"] == 0
    assert d["levels"]["entry"] == round(last["c"], 2)
    assert d["levels"]["stop"] == round(last["l"], 2)            # the tag bar's low
    assert d["levels"]["pivot"] == round(S["e21"][-1], 2)        # the tagged MA
    assert S["e21"][-1] > S["e21"][-1 - PB.PB4_E21_N]            # rising 21
    assert last["l"] < S["e21"][-1] <= last["c"]


def test_a_50_sma_tag_is_found_by_the_rule_but_not_surfaced():
    """The rule (lab parity) still classifies a 50-SMA tag as tag_s50, but the
    detector surfaces only tag_e21 (REPORT_RECALL_V2: 50/200-SMA tags 46%
    blind precision vs 97.7% for 21-EMA tags)."""
    bars = SY.pullback_to_ma(U.series, ma="s50")
    c = _eval_last(bars)
    assert c is not None and c["variant"] == "tag_s50" and c["ma"] == "s50"
    assert _detect(bars) == []
    assert PB.detect_uct_pullback_ma_v5(bars, {}) == []


def test_only_tag_e21_is_surfaced():
    assert PB.SURFACED_VARIANTS == frozenset({"tag_e21"})
    (d,) = _detect(SY.fire_e21(U.series))                 # contrast: the 21-EMA fixture still fires
    assert d["geometry"]["extras"]["variant"] == "tag_e21"


def test_the_variant_filter_is_the_only_thing_silencing_the_50_sma_tag(monkeypatch):
    bars = SY.pullback_to_ma(U.series, ma="s50")
    monkeypatch.setattr(PB, "SURFACED_VARIANTS", frozenset({"tag_e21", "tag_s50"}))
    (d,) = _detect(bars)
    assert d["geometry"]["extras"]["variant"] == "tag_s50"


# ── near-misses ──────────────────────────────────────────────────────────────

def test_an_8_ema_only_tag_does_not_fire():
    """The v5 change: v4 fired here (8-EMA tag on the marked bar, close within
    0.5 ATR); v5 never counts an 8-EMA-only tag."""
    bars = SY.eight_ema_only(U.series)
    S = U.series(bars)
    i = len(bars) - 1
    # the fixture really is an 8-EMA tag on the marked bar, and touches no other MA
    assert S["e8"][i] - S["atr"][i] <= bars[i]["l"] <= S["e8"][i] + 0.25 * S["atr"][i]
    for m in ("e21", "s50", "s200"):
        for j in (i, i - 1):
            assert bars[j]["l"] > S[m][j] + PB.PB_TAG_ABOVE_ATR * S["atr"][j], (m, j)
    assert PB.evaluate(bars, S, i) is None
    assert _detect(bars) == []


def test_a_falling_21_ema_does_not_fire(monkeypatch):
    bars = SY.falling_e21(U.series)
    S = U.series(bars)
    i = len(bars) - 1
    assert S["e21"][i] <= S["e21"][i - PB.PB4_E21_N], "fixture must have a falling 21 EMA"
    assert PB.evaluate(bars, S, i) is None
    assert _detect(bars) == []
    # contrast: the rising-21 guard is the ONLY thing stopping it
    monkeypatch.setattr(PB, "PB4_E21_N", 1)
    c = PB.evaluate(bars, S, i)
    assert c is not None and c["variant"] == "tag_e21"


@pytest.mark.parametrize("sym", ["TQQQ", "SOXL", "GLD", "uvxy"])
def test_an_excluded_leveraged_or_commodity_fund_does_not_fire(sym):
    bars = SY.fire_e21(U.series)
    assert _detect(bars, sym=sym) == []
    assert _eval_last(bars, sym=sym) is None
    # contrast: the same bars under an ordinary ticker (or none) fire
    assert len(_detect(bars, sym="ABCD")) == 1
    assert len(_detect(bars)) == 1


def test_the_exclusion_list_is_the_labs_size_and_names_real_funds():
    assert {"TQQQ", "SQQQ", "SOXL", "USO", "GLD", "UVXY", "NVDL", "MSTU"} <= PB.PB4_EXCLUDE
    assert not {"SPY", "QQQ", "GDX", "SOXX", "NVDA"} & PB.PB4_EXCLUDE


def test_the_liquidity_floor_applies():
    bars = SY.fire_e21(U.series)
    penny = SY.as_penny(bars, div=100.0)          # last close ~$1.2, under the $2 floor
    assert penny[-1]["c"] < 2.0
    # the rule itself would fire (scale-free), only the floor stops it
    assert _eval_last(penny) is not None
    assert PB.detect_uct_pullback_ma_v5(penny, {}) == []
    thin = [{**b, "v": 50.0} for b in bars]      # ~$6k a session, under the $10k floor
    assert _eval_last(thin) is not None
    assert PB.detect_uct_pullback_ma_v5(thin, {}) == []
    assert len(PB.detect_uct_pullback_ma_v5(bars, {})) == 1


def test_fewer_than_220_bars_cannot_fire():
    """The 200 SMA must exist 20 sessions back. The universe scan in api/main.py
    passes 200 bars, so there the detector can never fire (documented in the
    module docstring); this pins the warm-up so that stays a known fact."""
    bars = SY.fire_e21(U.series)
    assert PB._MIN_BARS == 220
    assert _detect(bars[-200:]) == []
    assert _detect(bars[-(PB._MIN_BARS - 1):]) == []
    assert len(bars) >= PB._MIN_BARS and len(_detect(bars)) == 1


# ── trigger age ──────────────────────────────────────────────────────────────

def test_a_prior_session_trigger_is_reported_only_while_its_stop_holds():
    bars = SY.fire_e21(U.series)
    stop = bars[-1]["l"]
    c = bars[-1]["c"]
    # an up session well above the stop that does not itself qualify (its close
    # is too far above the 21 EMA), so the trigger is the session before it
    held = bars + [SY.bar(len(bars), c, c + 1.2, c + 0.1, c + 1.1, 900_000)]
    assert _eval_last(held) is None
    ds = _detect(held)
    assert any(d["geometry"]["extras"]["trigger_bars_ago"] == 1 for d in ds), ds
    broke = bars + [SY.bar(len(bars), c, c + 1.2, stop - 0.5, c + 1.1, 900_000)]
    assert _eval_last(broke) is None
    assert all(d["geometry"]["extras"]["trigger_bars_ago"] != 1 for d in _detect(broke))


# ── no lookahead ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("seed", range(6))
def test_no_lookahead_rule_at_i_equals_rule_on_bars_through_i(seed):
    bars = SY.random_walk(seed=seed)
    S_full = U.series(bars)
    for i in range(PB._MIN_IDX, len(bars)):
        head = bars[:i + 1]
        assert PB.evaluate(bars, S_full, i) == PB.evaluate(head, U.series(head), i), i


def test_no_lookahead_sweep_is_not_vacuous():
    fires = sum(PB.evaluate(b, U.series(b), i) is not None
                for b in (SY.random_walk(seed=s) for s in range(12))
                for i in range(PB._MIN_IDX, len(b)))
    assert fires > 0, "the random walks must contain at least one fire"


def test_future_bars_cannot_change_the_newest_answer():
    bars = SY.fire_e21(U.series)
    i = len(bars) - 1
    before = PB.evaluate(bars, U.series(bars), i)
    assert before is not None
    junk = bars + [SY.bar(i + 1 + k, 1, 1000, 0.5, 2, 1) for k in range(5)]
    assert PB.evaluate(junk, U.series(junk), i) == before


# ── shape ────────────────────────────────────────────────────────────────────

def test_detection_shape():
    bars = SY.fire_e21(U.series)
    (d,) = _detect(bars)
    g = d["geometry"]
    lv = d["levels"]
    assert g["shape"] == "candle_mark" and g["semantic_subtype"] == _ID
    assert g["anchor_roles"] == ["tagged_ma", "tag_bar_low"]
    assert len(g["anchors"]) == 2
    times = {b["t"] for b in bars}
    assert all(a["t"] in times for a in g["anchors"]), "anchors must sit on real bar times"
    assert round(g["anchors"][0]["price"], 2) == lv["pivot"]
    assert round(g["anchors"][1]["price"], 2) == lv["stop"]
    sec = {x["role"]: x for x in g["secondary"]}
    assert set(sec) == {"tagged_ma", "stop"}
    for x in sec.values():
        assert x["shape"] == "horizontal_line" and x["label"]
        assert x["anchors"][0]["price"] == x["anchors"][1]["price"]
        assert all(a["t"] in times for a in x["anchors"])
        assert x["anchors"][0]["t"] < x["anchors"][1]["t"], "drawn from the pullback's high"
    assert round(sec["stop"]["anchors"][0]["price"], 2) == lv["stop"]
    assert round(sec["tagged_ma"]["anchors"][0]["price"], 2) == lv["pivot"]
    assert lv["stop"] < lv["entry"] < lv["target_primary"] < lv["target_secondary"]
    assert d["category"] == "uct" and d["status"] == "triggered"
    for k in ("headline", "what_it_is", "why_it_matters", "what_to_watch_for", "failure_signal"):
        assert d["narrative"][k]
    assert "EMA" in d["narrative"]["headline"]
    q = d["quality_components"]
    assert q["historical_score"] == U.HIST_SCORE
    assert d["confidence"] == round(0.40 * q["geometry_score"] + 0.25 * q["volume_score"]
                                    + 0.20 * q["context_score"] + 0.15 * q["historical_score"], 2)
    assert d["confidence"] >= U.CONFIDENCE_FLOOR
    assert g["extras"]["lab_rule"] == "recall_v2.pullback_ma_v5"


def test_never_raises_on_short_or_degenerate_input():
    detect = PB.detect_uct_pullback_ma_v5
    assert detect([], {}) == []
    assert detect(SY.fire_e21(U.series)[:5], {}) == []
    flat = [{**b, "o": 50.0, "h": 50.0, "l": 50.0, "c": 50.0} for b in SY.fire_e21(U.series)]
    assert detect(flat, {}) == []
    assert detect(SY.fire_e21(U.series), None) is not None


# ── registration + internal gating ───────────────────────────────────────────

def test_registered_internal_and_kept_out_of_the_member_catalog():
    import api.routers.patterns as patterns_router
    assert _ID in set(registry.list_pattern_ids())
    assert registry.is_internal(_ID) and _ID in registry.INTERNAL_PATTERN_IDS
    assert _ID not in registry.list_public_pattern_ids()
    assert _ID not in patterns_router._PATTERN_METADATA
    rows = [{"pattern_id": p} for p in (_ID, "bull_flag")]
    assert [r["pattern_id"] for r in registry.drop_internal(rows)] == ["bull_flag"]


def test_draws_in_the_team_set():
    """Owner direction 2026-10-17: MA pullbacks are in the team drawing set (trusted tier).
    It stays INTERNAL, so no member path serves it whatever its tier."""
    pol = registry.display_policy(_ID)
    assert pol["display_tier"] == "trusted" and pol["display_layer"] == "structures"
    assert _ID in registry.DISPLAY_TEAM_SET and _ID not in registry.DISPLAY_HIDDEN
    assert registry.is_internal(_ID)


def test_the_universe_scan_computes_it():
    from api.services.pattern_engine import detect_all
    import api.routers.patterns  # noqa: F401
    bars = SY.fire_e21(U.series)
    fired = {d["pattern_id"] for d in detect_all(bars, _ctx(bars), pattern_ids=[_ID])}
    assert fired == {_ID}


def test_the_existing_pullback_detectors_are_untouched():
    """A NEW id beside the four production pullback detectors, which stay registered."""
    ids = set(registry.list_pattern_ids())
    for pid in ("pullback_to_10ema", "pullback_to_21ema", "pullback_to_50sma", "pullback_to_200sma"):
        assert pid in ids
