"""`_fetch_snapshots` must request dual-class tickers (BRK-B, BF-B) in Massive's
DOT form (see massive.to_polygon_symbol) and translate the response back to the
app's canonical hyphen form — otherwise Massive returns n=0 for these names and
they silently vanish from the batch response (verified live: SPY's BRK-B holding
had no price/% Chg entry at all while every other holding did).

D1 note: `_fetch_snapshots` now calls `client.get_batch_quotes(tickers)` (the
D1 typed adapter method, which owns this exact translation internally) rather
than building the URL itself and calling `client._get`. The fake client below
still builds the URL/raw JSON via its own `_get` (so the fixture data stays
unchanged) but exposes it through a `get_batch_quotes` adapter matching the
real method's shape — see `_batch_quotes_from_get` in `massive.py`'s own
D1 test file for the identical pattern."""
from __future__ import annotations

from api.routers import live_prices as lp
from api.services import provider_errors as _pe
from api.services.massive import to_polygon_symbol


def _batch_quotes_from_get(client, tickers):
    """Adapts a fake client's pre-D1 `_get`-based batch fetch into the new
    `get_batch_quotes` shape, reusing the fake's own canned JSON/URL-recording
    behavior unchanged."""
    poly_to_canon = {to_polygon_symbol(t): t for t in tickers}
    tickers_param = ",".join(poly_to_canon.keys())
    url = (f"https://api.massive.com/v2/snapshot/locale/us/markets/stocks/tickers"
           f"?tickers={tickers_param}&apiKey={client._api_key}")
    data = client._get(url, timeout=5.0)
    out = {}
    for t in data.get("tickers", []):
        poly_sym = t.get("ticker", "")
        if not poly_sym:
            continue
        out[poly_to_canon.get(poly_sym, poly_sym)] = t
    return _pe.ProviderResult(
        value=out,
        provenance=_pe.ProvenanceRecord(vendor="massive", source_activity="test"),
        licensing_class="R",
    )


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

    def get_batch_quotes(self, tickers, *, entity_ids=None):
        return _batch_quotes_from_get(self, tickers)


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
