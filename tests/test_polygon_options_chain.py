from unittest.mock import patch
from api.services import polygon_options as po


def _contract(strike, side, exp="2026-08-07", price=180.0):
    return {
        "details": {"ticker": f"O:TST{strike}{side[0].upper()}", "strike_price": strike,
                    "expiration_date": exp, "contract_type": side, "shares_per_contract": 100},
        "last_quote": {"bid": 1.0, "ask": 1.2}, "last_trade": {"price": 1.1},
        "day": {}, "greeks": {"delta": 0.5}, "implied_volatility": 0.45,
        "open_interest": 10, "underlying_asset": {"price": price, "ticker": "TST"},
        "break_even_price": strike + 1.1,
    }


def test_get_chain_follows_next_url_pagination():
    po._CACHE.clear()
    page1 = {"results": [_contract(100 + i, "call") for i in range(250)],
             "next_url": "https://api.massive.com/v3/snapshot/options/TST?cursor=abc"}
    page2 = {"results": [_contract(179, "call"), _contract(179, "put"),
                         _contract(181, "call"), _contract(181, "put")]}
    calls = []
    def fake_get(url, params=None):
        calls.append(url)
        return page2 if "cursor=abc" in url else page1
    with patch.object(po, "_safe_get", side_effect=fake_get):
        out = po.get_chain("TST", expiration="2026-08-07", strikes_around_spot=2)
    assert len(calls) == 2, "must follow next_url"
    strikes = [c["strike"] for c in out["calls"]]
    assert 179 in strikes and 181 in strikes, "ATM strikes live on page 2 — truncation loses them"


def test_get_chain_maps_class_share_symbol():
    po._CACHE.clear()
    seen = {}
    def fake_get(url, params=None):
        seen["url"] = url
        return {"results": [_contract(400, "call", price=410.0), _contract(400, "put", price=410.0)]}
    with patch.object(po, "_safe_get", side_effect=fake_get):
        out = po.get_chain("BRK-B", expiration="2026-08-07")
    assert "/v3/snapshot/options/BRK.B" in seen["url"]
    assert out["ticker"] == "BRK-B", "caller-facing ticker keeps hyphen form"


def test_get_chain_pagination_is_bounded():
    po._CACHE.clear()
    looping = {"results": [_contract(100, "call")],
               "next_url": "https://api.massive.com/v3/snapshot/options/TST?cursor=loop"}
    with patch.object(po, "_safe_get", return_value=looping):
        out = po.get_chain("TST", expiration="2026-08-07")
    assert "error" not in out, "bounded pagination must still return the collected pages"
