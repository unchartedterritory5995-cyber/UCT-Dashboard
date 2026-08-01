"""Weekly Conviction Flow — ported classifier parity + ranking + render smoke.
The flow.db load + OI-snapshot still-open need the live worker; these cover the
pure pieces (direction port from flowCompute.js, aggregation/ranking, render)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api import weekly_flow as wf


def test_side_norm():
    assert wf._side_norm("ABOVE ASK") == "AA"
    assert wf._side_norm("AA") == "AA"
    assert wf._side_norm("BELOW BID") == "BB"
    assert wf._side_norm("A") == "A" and wf._side_norm("ASK") == "A"
    assert wf._side_norm("B") == "B" and wf._side_norm("BID") == "B"
    assert wf._side_norm("") == "" and wf._side_norm(None) == ""


def test_ty_and_color():
    assert wf._ty("SWEEP") == "SWP" and wf._ty("BLOCK") == "BLK"
    assert wf._ty("ML/") == "ML" and wf._ty("") is None
    assert wf._color_norm("YELLOW") == "YELLOW"
    assert wf._color_norm("MAGENTA") == "MAGENTA"
    assert wf._color_norm("ORANGE") == "ORANGE" and wf._color_norm("ARB") == "ARB"
    assert wf._color_norm("") == "WHITE"


def test_direction_calls():
    assert wf._direction("C", "A", True, 100, 110, 5e9, 60) == "BULL"
    assert wf._direction("C", "AA", False, 100, 110, 5e9, 60) == "BULL"
    assert wf._direction("C", "BB", True, 100, 110, 5e9, 60) == "BEAR"   # BB sweep call = selling calls
    assert wf._direction("C", "", True, 100, 110, 5e9, 60) == "BULL"     # blank sweep → presume ask
    assert wf._direction("C", "B", True, 100, 110, 5e9, 60) is None      # at-bid = ambiguous
    assert wf._direction("C", "BB", False, 100, 110, 5e9, 60) is None    # BB block (not sweep) = none


def test_direction_puts_inverse():
    assert wf._direction("P", "A", True, 100, 90, 5e9, 60) == "BEAR"
    assert wf._direction("P", "BB", True, 100, 90, 5e9, 60) == "BULL"    # BB sweep put = selling puts
    assert wf._direction("P", "", True, 100, 90, 5e9, 60) == "BEAR"


def test_lottery_kill():
    # mega-cap ($200B+), ≤7 DTE, ≥10% OTM → killed
    assert wf._direction("C", "A", True, 100, 115, 300e9, 5) is None
    # >7 DTE → kept; small-cap (<$10B) → kept even short-dated OTM
    assert wf._direction("C", "A", True, 100, 115, 300e9, 30) == "BULL"
    assert wf._direction("C", "A", True, 100, 130, 5e9, 5) == "BULL"


def test_aggregate_ranks_by_directional_premium(monkeypatch):
    monkeypatch.setattr(wf, "_still_open_keys", lambda keys, frac: set(keys))
    monkeypatch.setattr(wf, "_contract_key",
                        lambda t: f'{t["S"]}|{t["CP"]}|{t["K"]}|{t["E"]}')
    trades = [
        {"S": "BE", "CP": "C", "K": 210, "E": "9/18/2026", "P": 27_600_000, "D": "BULL"},
        {"S": "BE", "CP": "C", "K": 210, "E": "9/18/2026", "P": 1_000_000, "D": "BEAR"},
        {"S": "INTC", "CP": "C", "K": 100, "E": "1/21/2028", "P": 22_500_000, "D": "BULL"},
        {"S": "AAPL", "CP": "P", "K": 160, "E": "10/16/2026", "P": 12_400_000, "D": "BEAR"},
    ]
    agg = wf.aggregate(trades, top_n=10, still_open_frac=0.75)
    assert [e["sym"] for e in agg["bulls"]] == ["BE", "INTC"]   # by bull premium
    assert agg["bears"][0]["sym"] == "AAPL"
    assert agg["bulls"][0]["net"] > 0
    assert agg["bulls"][0]["top"]["K"] == 210


def test_render_returns_png():
    agg = {"bulls": [{"sym": "BE", "bull": 26e6, "bear": 1e6, "net": 25e6, "bullPct": 96,
                      "top": {"cp": "C", "K": 210, "exp": "9/18/2026"}}],
           "bears": [{"sym": "AAPL", "bull": 1e6, "bear": 12e6, "net": -11e6, "bullPct": 8,
                      "top": {"cp": "P", "K": 160, "exp": "10/16/2026"}}],
           "n_names": 2, "open_contracts": 2}
    png = wf.render_card(agg, ["7/28/2026", "7/31/2026"], 5, 30)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
