"""Battery for the uct_go_signal detector (real-bar fixtures in tests/fixtures/uct_go_signal/). INTERNAL."""
from api.services.pattern_engine.detectors.uct.uct_go_signal import detect_uct_go_signal
from tests.pattern_engine.detectors._uct_setup_battery import make_tests

globals().update(make_tests(
    "uct_go_signal", detect_uct_go_signal,
    required_extras=('swept','red_to_green','wick_frac','fired_variants','daily_footprint_only'),
    rule_fixtures=('neg_ema20_falling','neg_weak_close','neg_opened_above','edge_close_mid_range'),
    directions=("bullish",),
    public=False,
))
