"""Battery for the uct_kicker detector (real-bar fixtures in tests/fixtures/uct_kicker/)."""
from api.services.pattern_engine.detectors.uct.uct_kicker import detect_uct_kicker
from tests.pattern_engine.detectors._uct_setup_battery import make_tests

globals().update(make_tests(
    "uct_kicker", detect_uct_kicker,
    required_extras=('prior_dcr','gap_pct','push_held_k4','rvol50','prior_high'),
    rule_fixtures=('neg_strong_prior_close','neg_red_prior_closed_high','neg_gap_too_small','neg_no_break_of_prior_high','neg_no_gap_up','edge_gap_just_under_a_tenth'),
    directions=("bullish",),
))
