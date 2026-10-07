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


# ── O1 / S4: list_expirations ──────────────────────────────────────────────────────────────────

def _exp_contracts(dates, per=3):
    return [{"expiration_date": d, "strike_price": 600 + i} for d in dates for i in range(per)]


def test_list_expirations_reads_calls_in_a_strike_band_and_reaches_the_leaps(monkeypatch):
    """O1: the walk reads CALLS within +-10% of spot (a few contracts per expiry), so a name
    with 60+ listed expirations gets all of them, LEAPS included -- the old 40-date cap and the
    both-sides-every-strike walk stopped SPY ~7 weeks out."""
    po._CACHE.clear()
    dates = [f"2027-{m:02d}-{d:02d}" for m in range(1, 13) for d in (5, 12, 19, 26)]
    dates += ["2028-01-21", "2028-12-15"]                    # LEAPS at the far end
    seen_params = []

    def fake_get(url, params=None):
        if "/v3/snapshot/options/" in url:                   # the spot hint
            return {"results": [{"underlying_asset": {"price": 600.0}}]}
        seen_params.append(dict(params))
        after = params.get("expiration_date.gt") or ""
        later = [d for d in dates if d > after]
        return {"results": _exp_contracts(later)[:1000]}

    with patch.object(po, "_safe_get", side_effect=fake_get):
        out = po.list_expirations("SPY")
    assert len(dates) > 40, "the fixture must exceed the old 40-date cap"
    assert out["expirations"] == dates, "every listed expiration, LEAPS included"
    p = seen_params[0]
    assert p["contract_type"] == "call"
    assert p["strike_price.gte"] == 540.0 and p["strike_price.lte"] == 660.0
    assert "partial" not in out


def test_list_expirations_without_a_spot_still_walks_calls_only(monkeypatch):
    po._CACHE.clear()
    seen_params = []

    def fake_get(url, params=None):
        if "/v3/snapshot/options/" in url:
            raise httpx.ConnectError("down")
        seen_params.append(dict(params))
        return {"results": _exp_contracts(["2026-12-18"])}

    with patch.object(po, "_safe_get", side_effect=fake_get):
        out = po.list_expirations("TST")
    assert out["expirations"] == ["2026-12-18"]
    assert seen_params[0]["contract_type"] == "call"
    assert "strike_price.gte" not in seen_params[0], "no spot means no guessed band"


def test_list_expirations_has_an_overall_budget(monkeypatch):
    """S4: the walk stops at a 20 s wall clock and says the list is partial."""
    po._CACHE.clear()
    pages = {"n": 0}

    def fake_get(url, params=None):
        if "/v3/snapshot/options/" in url:
            return {"results": []}
        pages["n"] += 1
        d = f"2026-{10 + pages['n']:02d}-01"
        return {"results": [{"expiration_date": d}] * 1000}   # always a full page

    clock = iter([0, 5, 25, 30, 35])
    monkeypatch.setattr(po.time, "monotonic", lambda: next(clock))
    with patch.object(po, "_safe_get", side_effect=fake_get):
        out = po.list_expirations("TST")
    assert pages["n"] == 2, "the third page must not start past the budget"
    assert out["partial"] is True


def test_safe_get_does_not_override_the_client_timeouts(monkeypatch):
    """S4: a per-call `timeout=` replaces the client's connect/pool limits with one number."""
    monkeypatch.setenv("MASSIVE_API_KEY", "K")
    seen = {}

    class _R:
        def raise_for_status(self):
            pass

        def json(self):
            return {}

    def fake_http_get(url, **kw):
        seen.update(kw)
        return _R()

    monkeypatch.setattr(po._http, "get", fake_http_get)
    po._safe_get("https://x", {"a": 1})
    assert "timeout" not in seen


def test_list_expirations_drops_today_after_the_close(monkeypatch):
    po._CACHE.clear()
    from datetime import datetime as _dt
    seen_params = []

    class _Clock(_dt):
        @classmethod
        def now(cls, tz=None):
            return _dt(2026, 10, 5, 16, 30, tzinfo=tz)

    monkeypatch.setattr(po, "datetime", _Clock)

    def fake_get(url, params=None):
        if "/v3/snapshot/options/" in url:
            return {"results": []}
        seen_params.append(dict(params))
        return {"results": []}

    with patch.object(po, "_safe_get", side_effect=fake_get):
        po.list_expirations("TST")
    assert seen_params[0].get("expiration_date.gt") == "2026-10-05"
    assert "expiration_date.gte" not in seen_params[0]


# ── O3: default expiry ─────────────────────────────────────────────────────────────────────────

def test_default_expiration_skips_the_0dte_expiry():
    from datetime import datetime as _dt
    now = _dt(2026, 10, 5, 11, 0, tzinfo=po._ET)
    assert po.default_expiration(["2026-10-05", "2026-10-06", "2026-10-09"], now) == "2026-10-06"
    assert po.default_expiration(["2026-10-02", "2026-10-05"], now) == "2026-10-05", \
        "nothing later listed: the latest on hand, never nothing"
    assert po.default_expiration([], now) is None


def test_get_chain_default_view_is_not_0dte(monkeypatch):
    po._CACHE.clear()
    from datetime import datetime as _dt

    class _Clock(_dt):
        @classmethod
        def now(cls, tz=None):
            return _dt(2026, 10, 5, 11, 0, tzinfo=tz)

    monkeypatch.setattr(po, "datetime", _Clock)
    rows = [_contract(180, "call", exp="2026-10-05"), _contract(180, "put", exp="2026-10-05"),
            _contract(180, "call", exp="2026-10-09"), _contract(180, "put", exp="2026-10-09")]
    with patch.object(po, "_safe_get", return_value={"results": rows}):
        out = po.get_chain("TST")
    assert out["expiration"] == "2026-10-09"


# ── S3: cache key without n, single flight, errors cached ──────────────────────────────────────

def test_chain_cache_is_shared_across_n(monkeypatch):
    po._CACHE.clear()
    calls = {"n": 0}

    def fake_get(url, params=None):
        calls["n"] += 1
        return {"results": [_contract(170 + i, s) for i in range(21) for s in ("call", "put")]}

    with patch.object(po, "_safe_get", side_effect=fake_get):
        small = po.get_chain("TST", expiration="2026-08-07", strikes_around_spot=2)
        big = po.get_chain("TST", expiration="2026-08-07", strikes_around_spot=10)
    assert calls["n"] == 1, "n only trims; it must not key a second vendor walk"
    assert len(small["calls"]) == 4 and len(big["calls"]) == 20


def test_chain_rows_are_copies_so_a_caller_cannot_edit_the_cache(monkeypatch):
    po._CACHE.clear()
    rows = [_contract(180, "call"), _contract(180, "put")]
    with patch.object(po, "_safe_get", return_value={"results": rows}):
        a = po.get_chain("TST", expiration="2026-08-07")
        a["calls"][0]["strike"] = -1
        b = po.get_chain("TST", expiration="2026-08-07")
    assert b["calls"][0]["strike"] == 180


def test_concurrent_cold_chain_readers_share_one_fetch(monkeypatch):
    import threading
    import time as _t
    po._CACHE.clear()
    calls = {"n": 0}
    gate = threading.Event()

    def fake_get(url, params=None):
        calls["n"] += 1
        gate.wait(2)
        return {"results": [_contract(180, "call"), _contract(180, "put")]}

    outs = []

    def reader(n):
        outs.append(po.get_chain("TST", expiration="2026-08-07", strikes_around_spot=n))

    with patch.object(po, "_safe_get", side_effect=fake_get):
        ts = [threading.Thread(target=reader, args=(n,)) for n in (2, 4, 6, 8)]
        for t in ts:
            t.start()
        _t.sleep(0.2)
        gate.set()
        for t in ts:
            t.join(5)
    assert calls["n"] == 1
    assert len(outs) == 4 and all("error" not in o for o in outs)


def test_a_vendor_failure_is_cached_briefly(monkeypatch):
    po._CACHE.clear()
    calls = {"n": 0}

    def boom(url, params=None):
        calls["n"] += 1
        raise httpx.ConnectError("down")

    with patch.object(po, "_safe_get", side_effect=boom):
        a = po.get_chain("TST", expiration="2026-08-07")
        b = po.get_chain("TST", expiration="2026-08-07")
    assert "error" in a and "error" in b
    assert calls["n"] == 1, "a stampede on a failing vendor pays the failure once"
    assert 15 <= po._ERROR_TTL <= 30


# ── O2: delta wings ────────────────────────────────────────────────────────────────────────────

def test_min_abs_delta_keeps_the_wings_inside_the_band(monkeypatch):
    po._CACHE.clear()

    def row(k, side, delta):
        c = _contract(k, side, price=100.0)
        c["greeks"] = {"delta": delta}
        return c

    rows = [row(100 + i, "call", round(max(0.5 - i * 0.02, 0.01), 4)) for i in range(0, 40)]
    rows += [row(100 - i, "put", -round(max(0.5 - i * 0.02, 0.01), 4)) for i in range(1, 40)]
    with patch.object(po, "_safe_get", return_value={"results": rows}):
        plain = po.get_chain("TST", expiration="2026-08-07", strikes_around_spot=2)
        wings = po.get_chain("TST", expiration="2026-08-07", strikes_around_spot=2,
                             min_abs_delta=0.05)
    assert max(c["strike"] for c in plain["calls"]) < 104
    call_deltas = sorted(c["delta"] for c in wings["calls"])
    assert call_deltas[0] <= 0.10, "the 10-delta call is now reachable"
    assert call_deltas[0] >= 0.05, "nothing below the wing floor is added"
    assert all(75 <= c["strike"] <= 125 for c in wings["calls"] + wings["puts"])
