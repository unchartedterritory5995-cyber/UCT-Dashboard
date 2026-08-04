from unittest.mock import patch
import httpx
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
    # Page 1: strikes 100-159 (all below ATM at 180)
    page1 = {"results": [_contract(100 + i, "call") for i in range(60)],
             "next_url": "https://api.massive.com/v3/snapshot/options/TST?cursor=abc"}
    # Page 2: ATM strikes (179, 181)
    page2 = {"results": [_contract(179, "call"), _contract(179, "put"),
                         _contract(181, "call"), _contract(181, "put")]}
    calls = []
    def fake_get(url, params=None):
        calls.append(url)
        return page2 if "cursor=abc" in url else page1

    # Mock both _safe_get (page 1) and _http.get (page 2+)
    def mock_http_get(url, timeout=None):
        calls.append(url)
        response_mock = type('Response', (), {})()
        if "cursor=abc" in url:
            response_mock.json = lambda: page2
        else:
            response_mock.json = lambda: page1
        response_mock.raise_for_status = lambda: None
        return response_mock

    with patch.object(po, "_safe_get", side_effect=fake_get):
        with patch.object(po._http, "get", side_effect=mock_http_get):
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

    def mock_http_get(url, timeout=None):
        response_mock = type('Response', (), {})()
        response_mock.json = lambda: looping
        response_mock.raise_for_status = lambda: None
        return response_mock

    with patch.object(po, "_safe_get", return_value=looping):
        with patch.object(po._http, "get", side_effect=mock_http_get):
            out = po.get_chain("TST", expiration="2026-08-07")
    assert "error" not in out, "bounded pagination must still return the collected pages"


def test_get_chain_pagination_stops_at_wall_clock_budget(monkeypatch):
    """I7: pagination has a per-operation wall-clock budget (20s) independent
    of the 8-page cap, so a stuck/looping cursor can't pin a thread forever —
    it must yield the partial chain collected so far instead of erroring."""
    po._CACHE.clear()
    calls = {"n": 0}
    looping = {"results": [_contract(100, "call")],
               "next_url": "https://api.massive.com/v3/snapshot/options/TST?cursor=loop"}

    def fake_get(url, params=None):
        calls["n"] += 1
        return looping

    def mock_http_get(url, timeout=None):
        calls["n"] += 1
        response_mock = type('Response', (), {})()
        response_mock.json = lambda: looping
        response_mock.raise_for_status = lambda: None
        return response_mock

    monotonic_values = iter([0, 25])
    monkeypatch.setattr(po.time, "monotonic", lambda: next(monotonic_values))

    with patch.object(po, "_safe_get", side_effect=fake_get):
        with patch.object(po._http, "get", side_effect=mock_http_get):
            out = po.get_chain("TST", expiration="2026-08-07")

    assert calls["n"] == 1, "the wall-clock budget must stop pagination after the first page"
    assert "error" not in out, "a budget-truncated chain is still a valid partial result"


def test_next_url_page_preserves_cursor_real_httpx(monkeypatch):
    po._CACHE.clear()
    monkeypatch.setenv("MASSIVE_API_KEY", "TESTKEY")
    seen = []
    def handler(request):
        seen.append(str(request.url))
        if "cursor=abc" in str(request.url):
            body = {"results": [_contract(181, "call"), _contract(181, "put")]}
        else:
            body = {"results": [_contract(179, "call"), _contract(179, "put")],
                    "next_url": "https://api.massive.com/v3/snapshot/options/TST?cursor=abc"}
        return httpx.Response(200, json=body)
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(po, "_http", httpx.Client(transport=transport))
    out = po.get_chain("TST", expiration="2026-08-07")
    assert len(seen) == 2
    assert "cursor=abc" in seen[1] and "apiKey=TESTKEY" in seen[1], \
        "page-2 request must preserve the cursor AND carry the api key"
    assert "error" not in out
