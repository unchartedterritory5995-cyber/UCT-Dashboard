"""Battery for the uct_launch_pad detector (real-bar fixtures in tests/fixtures/uct_launch_pad/). INTERNAL."""
from api.services.pattern_engine.detectors.uct.uct_launch_pad import detect_uct_launch_pad
from tests.pattern_engine.detectors._uct_setup_battery import make_tests

globals().update(make_tests(
    "uct_launch_pad", detect_uct_launch_pad,
    required_extras=('spread_pct','above_cluster_atr','stack_grade','fired_variants','sma50'),
    rule_fixtures=('neg_not_converged','neg_extended_above','neg_sma50_falling','edge_extended_close'),
    directions=("bullish",),
    public=False,
))
