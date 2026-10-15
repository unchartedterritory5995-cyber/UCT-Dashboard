"""Battery for the uct_oops_reversal detector (real-bar fixtures in tests/fixtures/uct_oops_reversal/)."""
from api.services.pattern_engine.detectors.uct.uct_oops_reversal import detect_uct_oops_reversal
from tests.pattern_engine.detectors._uct_setup_battery import make_tests

globals().update(make_tests(
    "uct_oops_reversal", detect_uct_oops_reversal,
    required_extras=('oops_stage','undercut_pct','strong_close_dcr90','at_support','prior_low'),
    rule_fixtures=('neg_no_undercut_v3','neg_closed_back_under','neg_opened_above','edge_low_equals_prior_low'),
    directions=("bullish",),
))
