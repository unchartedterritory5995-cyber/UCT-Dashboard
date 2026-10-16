"""Battery for the uct_hve detector (real-bar fixtures in tests/fixtures/uct_hve/)."""
from api.services.pattern_engine.detectors.uct.uct_hve import detect_uct_hve
from tests.pattern_engine.detectors._uct_setup_battery import make_tests

globals().update(make_tests(
    "uct_hve", detect_uct_hve,
    required_extras=('hvc','hve_26wk','ever_in_data','edge_ratio_vs_prior_max','up_day'),
    rule_fixtures=('neg_only_26wk_high','neg_second_highest','edge_volume_ties_prior_max'),
    directions=("bullish", "bearish"),
))


# ── the lookback is stated, never claimed (production's scan passes 200 bars) ──

def _record_bar_slice(n):
    from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures
    f = next(f for f in load_all_fixtures("uct_hve") if f.category == "positive")
    return f.bars[-n:]   # every positive fixture's record bar is its LAST bar


def _detect(bars):
    from api.services.pattern_engine.primitives.context import build_context
    return detect_uct_hve(bars, build_context(bars, sym="T"))


def test_200_bar_input_fires_and_reports_a_199_session_lookback():
    (d,) = _detect(_record_bar_slice(200))
    ex = d["geometry"]["extras"]
    assert ex["lookback_sessions"] == 199
    assert ex["variant"] == "hve_199"
    assert "hve_252" not in ex["label_variants"] and ex["full_252_history"] is False
    assert "last 199 sessions" in d["narrative"]["headline"]
    assert "252" not in d["narrative"]["headline"]


def test_150_bar_input_does_not_fire_for_lack_of_history():
    from api.services.pattern_engine.detectors.uct import uct_setups_common as U
    bars = _record_bar_slice(150)
    # control: the last bar IS still a record bar over the history it has, so the
    # refusal below is the 190-prior-session floor, not a missing record.
    hb = U.hve_bar(bars, U.series(bars), len(bars) - 1)
    assert hb is not None and hb["a1_252"] and hb["lookback"] == 149
    assert _detect(bars) == []


def test_260_bar_input_reports_the_full_252_session_lookback():
    (d,) = _detect(_record_bar_slice(260))
    ex = d["geometry"]["extras"]
    assert ex["lookback_sessions"] == 252
    assert ex["variant"] == "hve_252" and "hve_252" in ex["label_variants"]
    assert "last 252 sessions" in d["narrative"]["headline"]
