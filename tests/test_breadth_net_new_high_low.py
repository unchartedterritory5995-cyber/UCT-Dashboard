"""Net New High-Low: ONE definition, reached by every derivation path."""
import pytest

from api.services import breadth_metrics as bm
from api.services import breadth_monitor


# ── one definition, every path ───────────────────────────────────────────────

@pytest.mark.parametrize("nh,nl,expected", [
    (137, 800, -663.0),     # the owner's worked example
    (800, 137, 663.0),
    (50, 50, 0.0),
    (0, 0, 0.0),
])
def test_the_derivation_is_highs_minus_lows(nh, nl, expected):
    assert breadth_monitor._net_new_high_low(
        {"new_52w_highs": nh, "new_52w_lows": nl}) == expected


def test_a_missing_side_yields_None_not_a_one_sided_number():
    # ⛔ +137 would read as a strongly positive session on a day we do not know.
    assert breadth_monitor._net_new_high_low({"new_52w_highs": 137}) is None
    assert breadth_monitor._net_new_high_low({"new_52w_lows": 800}) is None
    assert breadth_monitor._net_new_high_low({}) is None
    assert breadth_monitor._net_new_high_low(
        {"new_52w_highs": None, "new_52w_lows": 3}) is None
    assert breadth_monitor._net_new_high_low(
        {"new_52w_highs": "n/a", "new_52w_lows": 3}) is None


def test_the_live_row_and_the_stored_row_derive_it_identically():
    """⭐⭐ The anti-drift rail: the intraday path and the stored/reconstructed path
    must produce the same number, because they call the same function."""
    raw = {"new_52w_highs": 137, "new_52w_lows": 800, "universe_count": 2500}

    live = breadth_monitor.derive_live_row(dict(raw), [])

    rows = [dict(raw, date="2026-01-05")]
    breadth_monitor._derive_ascending(rows, 0)
    stored = rows[0]

    assert live["net_new_high_low"] == stored["net_new_high_low"] == -663.0


def test_the_derived_key_rides_the_numeric_projection():
    # `numeric_of` keeps everything that is not a `*_list`, so a new derived metric
    # is stored and read back without a schema change.
    kept = breadth_monitor.numeric_of(
        {"net_new_high_low": -663.0, "universe_list": [{"t": "AAA"}]})
    assert kept == {"net_new_high_low": -663.0}
