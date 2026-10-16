"""Battery for the uct_capitulation detector (real-bar fixtures in tests/fixtures/uct_capitulation/). INTERNAL."""
from api.services.pattern_engine.detectors.uct.uct_capitulation import detect_uct_capitulation
from tests.pattern_engine.detectors._uct_setup_battery import make_tests

globals().update(make_tests(
    "uct_capitulation", detect_uct_capitulation,
    required_extras=('stars','ext_atr','record_lookback','fired_variants','bb_lower'),
    rule_fixtures=('neg_no_cascade','neg_not_below_band_by_1atr','edge_close_within_1atr_of_band'),
    directions=("bullish",),
    public=False,
))
