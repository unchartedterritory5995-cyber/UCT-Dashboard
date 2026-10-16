"""Battery for the uct_gap_support detector (real-bar fixtures in tests/fixtures/uct_gap_support/). INTERNAL."""
from api.services.pattern_engine.detectors.uct.uct_gap_support import detect_uct_gap_support
from tests.pattern_engine.detectors._uct_setup_battery import make_tests

globals().update(make_tests(
    "uct_gap_support", detect_uct_gap_support,
    required_extras=('gap_pct','gap_top','levels_touched','first_test','bars_since_gap'),
    rule_fixtures=('neg_gap_filled','neg_no_touch','neg_open_only_touch','neg_small_gap','edge_low_above_gap'),
    directions=("bullish",),
    public=False,
))
