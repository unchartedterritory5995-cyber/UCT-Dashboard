"""Battery for the uct_hve detector (real-bar fixtures in tests/fixtures/uct_hve/)."""
from api.services.pattern_engine.detectors.uct.uct_hve import detect_uct_hve
from tests.pattern_engine.detectors._uct_setup_battery import make_tests

globals().update(make_tests(
    "uct_hve", detect_uct_hve,
    required_extras=('hvc','hve_26wk','ever_in_data','edge_ratio_vs_prior_max','up_day'),
    rule_fixtures=('neg_only_26wk_high','neg_second_highest','edge_volume_ties_prior_max'),
    directions=("bullish", "bearish"),
))
