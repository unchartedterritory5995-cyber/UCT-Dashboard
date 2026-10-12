"""COV-12 / FT-067 congressional trades.

`fmp_client`'s four congress functions (the request each builds), the service
`congress_trades` (merge, order, normalisation, the four states, cache TTLs,
the latest feed) and the dark routes. FMP is never called for real: the
service's FMP seams are replaced, and the client tests stub the HTTP session.
"""
from __future__ import annotations

import inspect
import time
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import congress_trades as ct
from api.services import fmp_client, provider_errors
from api.services.cache import cache


def _ok(rows, activity="fmp_client.get_senate_trades"):
    return provider_errors.ProviderResult(
        value=rows,
        provenance=provider_errors.ProvenanceRecord(vendor="fmp", source_activity=activity),
        licensing_class="U",
    )


def _forbidden():
    return provider_errors.ProviderResult(
        value=None,
        provenance=provider_errors.ProvenanceRecord(vendor="fmp", source_activity="x"),
        licensing_class="U", degraded="cached_forbidden", degraded_since=time.time(),
    )


def _row(**kw) -> dict:
    row = {
        "symbol": "AAPL", "disclosureDate": "2026-09-20", "transactionDate": "2026-09-01",
        "firstName": "Jane", "lastName": "Doe", "office": "Jane Doe", "district": "CA11",
        "owner": "Spouse", "assetDescription": "Apple Inc", "assetType": "Stock",
        "type": "Purchase", "amount": "$1,001 - $15,000",
        "link": "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/1.pdf",
    }
    row.update(kw)
    return row


def _not_found(*a, **k):
    raise fmp_client.FMPNotFound("FMP /stable/x: no data for this request", vendor="fmp")


def _boom(*a, **k):
    raise fmp_client.FMPTransient("FMP /stable/x timed out", vendor="fmp")


@pytest.fixture(autouse=True)
def _clean_cache():
    for k in list(cache._store):
        if k.startswith("congress_trades"):
            cache.invalidate(k)
    yield
    for k in list(cache._store):
        if k.startswith("congress_trades"):
            cache.invalidate(k)


def _ttl(key: str) -> float:
    _, expires_at = cache._store[key]
    return expires_at - time.time()


@pytest.fixture
def fmp(monkeypatch):
    """Replace the four FMP functions; each test sets what each chamber answers."""
    calls = {"senate": 0, "house": 0, "senate_latest": 0, "house_latest": 0}
    answers = {}

    def make(name):
        def fn(*a, **k):
            calls[name] += 1
            assert k.get("timeout") == ct._TIMEOUT, "every FMP read names its timeout"
            a_ = answers.get(name, _not_found)
            return a_(*a, **k) if callable(a_) else a_
        fn.__name__ = name
        return fn

    monkeypatch.setattr(fmp_client, "get_senate_trades", make("senate"))
    monkeypatch.setattr(fmp_client, "get_house_trades", make("house"))
    monkeypatch.setattr(fmp_client, "get_senate_latest", make("senate_latest"))
    monkeypatch.setattr(fmp_client, "get_house_latest", make("house_latest"))
    return answers, calls


# ── fmp_client: the requests ─────────────────────────────────────────────────

class TestClientFunctions:
    @pytest.fixture(autouse=True)
    def _reset(self, monkeypatch):
        monkeypatch.setenv("FMP_API_KEY", "test-key")
        fmp_client._bucket_tokens = fmp_client._FMP_RATE_LIMIT_PER_MIN
        fmp_client._bucket_updated = time.monotonic()
        for p in ("senate-trades", "house-trades", "senate-latest", "house-latest"):
            cache.invalidate(f"fmp_forbidden_/stable/{p}")

    def _session(self, monkeypatch, value):
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = value
        resp.raise_for_status.return_value = None
        get = MagicMock(return_value=resp)
        monkeypatch.setattr(fmp_client._session, "get", get)
        return get

    @pytest.mark.parametrize("fn,path", [
        (fmp_client.get_senate_trades, "/stable/senate-trades"),
        (fmp_client.get_house_trades, "/stable/house-trades"),
    ])
    def test_per_symbol_reads_name_the_symbol(self, monkeypatch, fn, path):
        get = self._session(monkeypatch, [_row()])
        result = fn("aapl", timeout=9)
        assert get.call_args[0][0] == fmp_client._BASE_URL + path
        params = dict(get.call_args[1]["params"])
        assert params["symbol"] == "AAPL" and get.call_args[1]["timeout"] == 9
        assert result.value[0]["symbol"] == "AAPL"
        assert result.freshness == "end_of_day"

    @pytest.mark.parametrize("fn,path", [
        (fmp_client.get_senate_latest, "/stable/senate-latest"),
        (fmp_client.get_house_latest, "/stable/house-latest"),
    ])
    def test_latest_reads_page_and_limit_and_no_symbol(self, monkeypatch, fn, path):
        get = self._session(monkeypatch, [_row()])
        fn(0, 100, timeout=9)
        assert get.call_args[0][0] == fmp_client._BASE_URL + path
        params = dict(get.call_args[1]["params"])
        assert params["page"] == 0 and params["limit"] == 100 and "symbol" not in params

    def test_an_empty_answer_is_not_found(self, monkeypatch):
        self._session(monkeypatch, [])
        with pytest.raises(fmp_client.FMPNotFound):
            fmp_client.get_house_trades("ZZZZ")

    def test_the_licensing_stamp_is_unknown_not_borrowed(self, monkeypatch):
        self._session(monkeypatch, [_row()])
        assert fmp_client.get_senate_trades("AAPL").licensing_class == "U"


# ── normalising one row ──────────────────────────────────────────────────────

class TestNormalize:
    def test_a_full_row(self):
        t = ct.normalize_row(_row(), "house")
        assert t["chamber"] == "house" and t["chamber_label"] == "House"
        assert t["member"] == "Jane Doe" and t["district"] == "CA11" and t["owner"] == "Spouse"
        assert t["side"] == "buy" and t["type"] == "Purchase"
        assert t["amount"] == "$1,001 - $15,000"
        assert (t["amount_low"], t["amount_high"]) == (1001.0, 15000.0)
        assert t["disclosure_date"] == "2026-09-20" and t["transaction_date"] == "2026-09-01"
        assert t["lag_days"] == 19
        assert t["link"].startswith("https://")

    @pytest.mark.parametrize("text,side", [
        ("Purchase", "buy"), ("Sale (Partial)", "sell"), ("Sale (Full)", "sell"),
        ("Sale", "sell"), ("Exchange", "exchange"), ("", "other"), ("Received", "other"),
    ])
    def test_side(self, text, side):
        assert ct.normalize_row(_row(type=text), "senate")["side"] == side

    def test_an_open_ended_range_has_no_upper_bound(self):
        t = ct.normalize_row(_row(amount="Over $50,000,000"), "senate")
        assert (t["amount_low"], t["amount_high"]) == (50000000.0, None)
        assert t["amount"] == "Over $50,000,000"   # shown as filed, never a point value

    def test_odd_fields_never_invent_values(self):
        t = ct.normalize_row(_row(firstName="", lastName="", office="", disclosureDate="soon",
                                  transactionDate=None, amount="", link="javascript:alert(1)"), "senate")
        assert t["member"] == "Member not named"
        assert t["disclosure_date"] is None and t["transaction_date"] is None and t["lag_days"] is None
        assert t["amount"] is None and t["amount_low"] is None
        assert t["link"] is None   # only an http(s) link is passed on

    def test_a_disclosure_dated_before_the_trade_has_no_lag(self):
        assert ct.normalize_row(_row(disclosureDate="2026-08-01"), "house")["lag_days"] is None

    def test_not_a_row(self):
        assert ct.normalize_row("x", "house") is None


# ── per symbol ───────────────────────────────────────────────────────────────

class TestForSymbol:
    def test_both_chambers_merged_newest_disclosure_first(self, fmp):
        answers, _ = fmp
        answers["senate"] = _ok([_row(disclosureDate="2026-08-10", firstName="Sam", lastName="Senator", type="Sale (Partial)"),
                                 _row(disclosureDate="2026-10-01", firstName="Sue", lastName="Senator")])
        answers["house"] = _ok([_row(disclosureDate="2026-09-20")])
        out = ct.for_symbol("aapl")
        assert out["state"] == "ok" and out["ticker"] == "AAPL"
        assert [t["disclosure_date"] for t in out["trades"]] == ["2026-10-01", "2026-09-20", "2026-08-10"]
        assert [t["chamber_label"] for t in out["trades"]] == ["Senate", "House", "Senate"]
        assert out["counts"] == {"buys": 2, "sells": 1, "other": 0, "members": 3}
        assert out["newest_disclosure"] == "2026-10-01"
        assert "45 days" in out["basis"] and "FMP" in out["source"]
        assert out["chambers"]["senate"] == {"state": "ok", "rows": 2, "reason": None, "at_cap": False}

    def test_a_row_for_a_different_symbol_is_not_this_symbols(self, fmp):
        answers, _ = fmp
        answers["senate"] = _ok([_row(symbol="AAPL"), _row(symbol="MSFT")])
        answers["house"] = _not_found
        out = ct.for_symbol("AAPL")
        assert [t["symbol"] for t in out["trades"]] == ["AAPL"]

    def test_a_class_share_matches_either_spelling(self, fmp):
        answers, _ = fmp
        answers["senate"] = _ok([_row(symbol="BRK.B"), _row(symbol="BRK-B")])
        answers["house"] = _not_found
        assert len(ct.for_symbol("BRK-B")["trades"]) == 2

    def test_nothing_disclosed_is_a_sentence_not_a_failure(self, fmp):
        out = ct.for_symbol("ZZZZ")   # both chambers: FMPNotFound
        assert out["state"] == "none_disclosed" and out["trades"] == []
        assert out["reason"] == "No congressional trades disclosed for ZZZZ in the Senate or House records FMP holds."
        assert {c["state"] for c in out["chambers"].values()} == {"none"}
        assert _ttl("congress_trades::ZZZZ") > 11 * 3600   # a complete answer, kept long

    def test_one_chamber_failing_is_partial_and_names_it(self, fmp):
        answers, _ = fmp
        answers["senate"] = _ok([_row()])
        answers["house"] = _boom
        out = ct.for_symbol("AAPL")
        assert out["state"] == "partial" and len(out["trades"]) == 1
        assert out["chambers"]["house"]["state"] == "unavailable"
        assert out["chambers"]["house"]["reason"] == "FMP could not be read just now"
        assert out["reason"] == "The House records could not be read just now, so this shows the other chamber only."
        assert _ttl("congress_trades::AAPL") <= ct._FAIL_TTL   # retried soon

    def test_one_chamber_failing_and_the_other_empty_is_still_partial(self, fmp):
        answers, _ = fmp
        answers["senate"] = _boom
        out = ct.for_symbol("AAPL")   # house: not found
        assert out["state"] == "partial" and out["trades"] == []
        assert "Senate" in out["reason"]
        assert "No congressional trades disclosed" not in str(out)

    def test_both_failing_is_unavailable_never_empty(self, fmp):
        answers, _ = fmp
        answers["senate"] = _boom
        answers["house"] = lambda *a, **k: _forbidden()
        out = ct.for_symbol("AAPL")
        assert out["state"] == "unavailable"
        assert out["reason"] == "Neither the Senate nor the House records could be read just now."
        assert "refused" in out["chambers"]["house"]["reason"]
        assert _ttl("congress_trades::AAPL") <= ct._FAIL_TTL

    def test_a_rate_limit_says_so(self, fmp):
        answers, _ = fmp
        answers["senate"] = lambda *a, **k: (_ for _ in ()).throw(fmp_client.FMPRateLimited("budget", vendor="fmp"))
        out = ct.for_symbol("AAPL")
        assert out["chambers"]["senate"]["reason"] == "FMP's request budget was used up just now"

    def test_a_complete_read_is_cached_and_not_refetched(self, fmp):
        answers, calls = fmp
        answers["senate"] = _ok([_row()])
        answers["house"] = _ok([_row()])
        ct.for_symbol("AAPL")
        ct.for_symbol("AAPL")
        assert calls["senate"] == 1 and calls["house"] == 1
        assert ct._OK_TTL - 60 < _ttl("congress_trades::AAPL") <= ct._OK_TTL

    def test_at_the_vendor_cap_the_payload_says_older_may_exist(self, fmp):
        answers, _ = fmp
        answers["senate"] = _ok([_row() for _ in range(ct.PER_CHAMBER_CAP)])
        out = ct.for_symbol("AAPL")
        assert out["chambers"]["senate"]["at_cap"] is True and out["chambers"]["house"]["at_cap"] is False


# ── latest feed ──────────────────────────────────────────────────────────────

class TestLatest:
    def test_merged_newest_first_and_rows_without_a_ticker_are_counted(self, fmp):
        answers, calls = fmp
        answers["senate_latest"] = _ok([_row(symbol="NVDA", disclosureDate="2026-10-10"),
                                        _row(symbol="", assetDescription="US Treasury Bill")])
        answers["house_latest"] = _ok([_row(symbol="MSFT", disclosureDate="2026-10-11"),
                                       _row(symbol="--", disclosureDate="2026-10-12")])
        out = ct.latest()
        assert out["state"] == "ok"
        assert [t["symbol"] for t in out["trades"]] == ["MSFT", "NVDA"]
        assert out["without_symbol"] == 2
        assert out["newest_disclosure"] == "2026-10-11"
        ct.latest()
        assert calls["senate_latest"] == 1 and calls["house_latest"] == 1   # cached
        assert ct._LATEST_OK_TTL - 60 < _ttl("congress_trades_latest") <= ct._LATEST_OK_TTL

    def test_both_failing_is_unavailable(self, fmp):
        answers, _ = fmp
        answers["senate_latest"] = _boom
        answers["house_latest"] = _boom
        out = ct.latest()
        assert out["state"] == "unavailable" and out["trades"] == []
        assert _ttl("congress_trades_latest") <= ct._FAIL_TTL


# ── the routes ───────────────────────────────────────────────────────────────

@pytest.fixture
def client():
    from api.routers import congress_trades as route
    app = FastAPI()
    app.include_router(route.router)
    app.dependency_overrides[route.require_paid] = lambda: {"id": "u1"}
    return route, TestClient(app)


class TestRoutes:
    def test_dark_by_default_both_routes_404(self, client, monkeypatch):
        _, c = client
        monkeypatch.delenv("CONGRESS_TRADES_ENABLED", raising=False)
        assert c.get("/api/research/congress-trades/AAPL").status_code == 404
        assert c.get("/api/research/congress-latest").status_code == 404

    def test_armed_serves_both(self, client, fmp, monkeypatch):
        _, c = client
        answers, _ = fmp
        answers["senate"] = _ok([_row()])
        answers["house_latest"] = _ok([_row(symbol="NVDA")])
        monkeypatch.setenv("CONGRESS_TRADES_ENABLED", "1")
        r = c.get("/api/research/congress-trades/aapl")
        assert r.status_code == 200 and r.json()["state"] == "ok" and r.json()["ticker"] == "AAPL"
        r = c.get("/api/research/congress-latest")
        assert r.status_code == 200 and r.json()["trades"][0]["symbol"] == "NVDA"

    def test_not_a_ticker_is_a_400_with_a_sentence(self, client, fmp, monkeypatch):
        _, c = client
        monkeypatch.setenv("CONGRESS_TRADES_ENABLED", "1")
        r = c.get("/api/research/congress-trades/$$")
        assert r.status_code == 400 and "not a ticker" in r.json()["detail"]

    def test_paid_gate(self, monkeypatch):
        from api.routers import congress_trades as route
        app = FastAPI()
        app.include_router(route.router)
        monkeypatch.setenv("CONGRESS_TRADES_ENABLED", "1")
        assert TestClient(app).get("/api/research/congress-latest").status_code in (401, 402, 403)

    def test_handlers_are_sync_and_the_payload_key_rides_only_when_on(self, client, monkeypatch):
        from api.routers import auth
        route, _ = client
        assert not inspect.iscoroutinefunction(route.congress_trades_route)
        assert not inspect.iscoroutinefunction(route.congress_latest_route)
        monkeypatch.delenv("CONGRESS_TRADES_ENABLED", raising=False)
        assert "congress_trades_enabled" not in auth._research_depth_flags()
        monkeypatch.setenv("CONGRESS_TRADES_ENABLED", "1")
        assert auth._research_depth_flags()["congress_trades_enabled"] is True
        monkeypatch.setenv("CONGRESS_TRADES_ENABLED", "true")   # only "1" arms it
        assert "congress_trades_enabled" not in auth._research_depth_flags()

    def test_the_router_is_mounted_in_the_app(self):
        """AST over api/main.py: the import AND the include_router are both there."""
        import ast
        from pathlib import Path
        tree = ast.parse((Path(__file__).resolve().parents[1] / "api" / "main.py").read_text(encoding="utf-8"))
        includes = {ast.unparse(n.args[0]) for n in ast.walk(tree)
                    if isinstance(n, ast.Call) and getattr(n.func, "attr", None) == "include_router" and n.args}
        assert "research_depth_router.router" in includes   # non-vacuity: the walk sees a sibling
        assert "congress_trades_router.router" in includes
