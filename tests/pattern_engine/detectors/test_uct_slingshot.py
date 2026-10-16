"""Battery for the uct_slingshot detector (real-bar fixtures in tests/fixtures/uct_slingshot/)."""
from api.services.pattern_engine.detectors.uct.uct_slingshot import detect_uct_slingshot
from tests.pattern_engine.detectors._uct_setup_battery import make_tests

globals().update(make_tests(
    "uct_slingshot", detect_uct_slingshot,
    required_extras=('e4h','prior_closes_below_e4h','tight_pullback','sma50','alt_stop_prev_day_low'),
    rule_fixtures=('neg_below_sma50','neg_no_strength_day','neg_pullback_too_short','edge_close_just_under_sma50'),
    directions=("bullish",),
))
