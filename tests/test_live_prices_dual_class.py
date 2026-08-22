"""`_fetch_snapshots` must request dual-class tickers (BRK-B, BF-B) in Massive's
DOT form (see massive.to_polygon_symbol) and translate the response back to the
app's canonical hyphen form — otherwise Massive returns n=0 for these names and
they silently vanish from the batch response (verified live: SPY's BRK-B holding
had no price/% Chg entry at all while every other holding did)."""
from __future__ import annotations

from api.routers import live_prices as lp


class _DualClassClient:
    """Massive echoes back whatever ticker form it was ASKED for — dot notation
    only resolves real data for a class share, so the fake mirrors that."""
    _api_key = "k"

    def __init__(self):
        self.requested_url = None

    def _get(self, url, timeout=None):
        self.requested_url = url
        return {"tickers": [
            {
                "ticker": "BRK.B",
                "day": {"c": 490.0, "o": 488.0, "h": 491.0, "l": 487.0, "v": 100},
                "prevDay": {"c": 485.0},
                "lastTrade": {"p": 490.5},
                "todaysChangePerc": 1.03,
                "todaysChange": 5.0,
            },
            {
                "ticker": "AAPL",
                "day": {"c": 220.0, "o": 219.0, "h": 221.0, "l": 218.0, "v": 100},
                "prevDay": {"c": 218.0},
                "lastTrade": {"p": 220.1},
                "todaysChangePerc": 0.92,
                "todaysChange": 2.0,
            },
        ]}


def test_dual_class_ticker_requested_in_dot_form():
    client = _DualClassClient()
    lp._fetch_snapshots(client, ["BRK-B", "AAPL"], "regular")
    assert "BRK.B" in client.requested_url
    assert "BRK-B" not in client.requested_url


def test_dual_class_response_translated_back_to_canonical_hyphen_key():
    out = lp._fetch_snapshots(_DualClassClient(), ["BRK-B", "AAPL"], "regular")
    assert "BRK-B" in out             # canonical key present
    assert "BRK.B" not in out         # never leaks the Massive/polygon form
    assert out["BRK-B"]["price"] == 490.5
    assert out["BRK-B"]["change_pct"] == round((490.0 - 485.0) / 485.0 * 100, 4)
    assert out["AAPL"]["price"] == 220.1  # a normal (no-hyphen) ticker is unaffected


def test_normal_ticker_is_a_no_op_through_the_dot_mapping():
    client = _DualClassClient()
    lp._fetch_snapshots(client, ["AAPL"], "regular")
    assert "tickers=AAPL" in client.requested_url
