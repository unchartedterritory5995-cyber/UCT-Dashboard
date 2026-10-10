"""The terminal INS panel's market-wide insider feed.

`fmp_client.search_insider_purchases` (the request it builds),
`insider.get_market_insider_buys` (paging, purchase-only, window, dedupe,
sort, cap, cache TTLs, failure), and `GET /api/insider/feed?scope=` (default
unchanged, market, a bad scope is a 400). FMP is never called for real.
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import insider as insider_router
from api.services import fmp_client, insider, provider_errors
from api.services.cache import cache


def _ttl_remaining(key: str) -> float:
    _, expires_at = cache._store[key]
    return expires_at - time.time()


def _day(offset: int) -> str:
    return (datetime.utcnow() - timedelta(days=offset)).strftime("%Y-%m-%d")


def _row(**kw) -> dict:
    row = {
        "symbol": "ZBUY",
        "filingDate": _day(0),
        "transactionDate": _day(1),
        "reportingName": "Jane Doe",
        "typeOfOwner": "director",
        "transactionType": "P-Purchase",
        "acquisitionOrDisposition": "A",
        "securitiesTransacted": 1000,
        "price": 10.0,
        "securitiesOwned": 5000,
        "directOrIndirect": "D",
        "formType": "4",
        "url": "https://www.sec.gov/x",
    }
    row.update(kw)
    return row


def _ok(rows):
    return provider_errors.ProviderResult(
        value=rows,
        provenance=provider_errors.ProvenanceRecord(
            vendor="fmp", source_activity="fmp_client.search_insider_purchases"),
        licensing_class="R",
    )


class _Pages:
    """A fake `search_insider_purchases`: serves `pages[i]` for page i, a
    callable/exception per page, and records every call."""

    def __init__(self, pages):
        self.pages = pages
        self.calls = []

    def __call__(self, page, limit=100, *, timeout=None):
        self.calls.append((page, limit, timeout))
        if page >= len(self.pages):
            raise fmp_client.FMPNotFound("no more", vendor="fmp")
        p = self.pages[page]
        if isinstance(p, Exception):
            raise p
        return p


def _full(rows):
    """Pad to exactly 100 rows (a full page) with sales on the same filing date."""
    fd = rows[0]["filingDate"] if rows else _day(0)
    pad = [_row(symbol="ZPAD", transactionType="S-Sale", acquisitionOrDisposition="D",
                filingDate=fd, securitiesTransacted=i + 1)
           for i in range(100 - len(rows))]
    return rows + pad


@pytest.fixture(autouse=True)
def _clean_cache():
    cache.invalidate(insider._MARKET_FEED_KEY)
    yield
    cache.invalidate(insider._MARKET_FEED_KEY)


# ── fmp_client.search_insider_purchases ─────────────────────────────────

class TestClientFunction:
    @pytest.fixture(autouse=True)
    def _reset(self, monkeypatch):
        monkeypatch.setenv("FMP_API_KEY", "test-key")
        fmp_client._bucket_tokens = fmp_client._FMP_RATE_LIMIT_PER_MIN
        fmp_client._bucket_updated = time.monotonic()
        cache.invalidate("fmp_forbidden_/stable/insider-trading/search")

    def _session(self, monkeypatch, value):
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = value
        resp.raise_for_status.return_value = None
        get = MagicMock(return_value=resp)
        monkeypatch.setattr(fmp_client._session, "get", get)
        return get

    def test_builds_the_purchase_search_with_page_and_limit_and_no_symbol(self, monkeypatch):
        get = self._session(monkeypatch, [_row()])
        result = fmp_client.search_insider_purchases(3, 100, timeout=7)
        assert get.call_count == 1
        url = get.call_args[0][0]
        assert url == fmp_client._BASE_URL + "/stable/insider-trading/search"
        params = dict(get.call_args[1]["params"])
        assert params["page"] == 3 and params["limit"] == 100
        assert params["transactionType"] == "P-Purchase"
        assert "symbol" not in params
        assert result.value[0]["symbol"] == "ZBUY"
        assert result.provenance.source_activity == "fmp_client.search_insider_purchases"
        assert result.freshness == "end_of_day"

    def test_empty_page_is_not_found(self, monkeypatch):
        self._session(monkeypatch, [])
        with pytest.raises(fmp_client.FMPNotFound):
            fmp_client.search_insider_purchases(0)


# ── insider.get_market_insider_buys ───────────────────────────────────────

class TestMarketFeed:
    def test_purchases_only_classified_by_classify_txn(self, monkeypatch):
        rows = [
            _row(symbol="AAA"),
            _row(symbol="BBB", transactionType="S-Sale", acquisitionOrDisposition="D"),
            _row(symbol="CCC", transactionType="A-Award"),
            _row(symbol="DDD", transactionType="M-Exempt"),
            _row(symbol="EEE", acquisitionOrDisposition=""),  # blank direction: excluded
            _row(symbol="FFF", transactionType=""),
        ]
        fake = _Pages([_ok(rows)])
        monkeypatch.setattr(fmp_client, "search_insider_purchases", fake)
        out = insider.get_market_insider_buys()
        assert [r["symbol"] for r in out] == ["AAA"]
        r = out[0]
        assert r["type"] == "buy" and r["title"] == "director" and r["name"] == "Jane Doe"
        assert r["shares"] == 1000 and r["price"] == 10.0 and r["amount"] == 10000.0
        # every outbound call is bounded
        assert all(c[2] is not None and c[2] > 0 for c in fake.calls)

    def test_classify_txn_is_the_authority(self, monkeypatch):
        """Patch the classifier to call everything a buy: a sale row must
        then appear, proving the feed asks _classify_txn, not its own rule."""
        monkeypatch.setattr(insider, "_classify_txn", lambda r: "buy")
        fake = _Pages([_ok([_row(symbol="SSS", transactionType="S-Sale",
                                 acquisitionOrDisposition="D")])])
        monkeypatch.setattr(fmp_client, "search_insider_purchases", fake)
        assert [r["symbol"] for r in insider.get_market_insider_buys()] == ["SSS"]

    def test_seven_day_window_on_transaction_date(self, monkeypatch):
        rows = [_row(symbol="NEW", transactionDate=_day(2)),
                _row(symbol="OLD", transactionDate=_day(20))]
        monkeypatch.setattr(fmp_client, "search_insider_purchases", _Pages([_ok(rows)]))
        assert [r["symbol"] for r in insider.get_market_insider_buys()] == ["NEW"]

    def test_paging_stops_once_a_page_reaches_past_the_cutoff(self, monkeypatch):
        p0 = _ok(_full([_row(symbol="P0")]))
        p1 = _ok(_full([_row(symbol="P1", filingDate=_day(10), transactionDate=_day(2))]))
        p2 = _ok(_full([_row(symbol="P2")]))
        fake = _Pages([p0, p1, p2])
        monkeypatch.setattr(fmp_client, "search_insider_purchases", fake)
        out = insider.get_market_insider_buys()
        assert [c[0] for c in fake.calls] == [0, 1]
        assert {r["symbol"] for r in out} == {"P0", "P1"}

    def test_paging_is_bounded_by_max_pages(self, monkeypatch):
        monkeypatch.setattr(insider, "_MARKET_MAX_PAGES", 3)
        fake = _Pages([_ok(_full([_row(symbol=f"Q{i}")])) for i in range(10)])
        monkeypatch.setattr(fmp_client, "search_insider_purchases", fake)
        insider.get_market_insider_buys()
        assert [c[0] for c in fake.calls] == [0, 1, 2]

    def test_short_page_ends_paging(self, monkeypatch):
        fake = _Pages([_ok([_row()]), _ok([_row(symbol="NOPE")])])
        monkeypatch.setattr(fmp_client, "search_insider_purchases", fake)
        insider.get_market_insider_buys()
        assert [c[0] for c in fake.calls] == [0]

    def test_skips_blank_and_odd_symbols(self, monkeypatch):
        rows = [_row(symbol=""), _row(symbol=None), _row(symbol="0001234567"),
                _row(symbol="bad sym"), _row(symbol="brk.b")]
        monkeypatch.setattr(fmp_client, "search_insider_purchases", _Pages([_ok(rows)]))
        assert [r["symbol"] for r in insider.get_market_insider_buys()] == ["BRK.B"]

    def test_dedupes_identical_rows_across_pages(self, monkeypatch):
        dup = _row(symbol="DUP")
        p0 = _ok(_full([dup, dict(dup)]))
        p1 = _ok([dict(dup), _row(symbol="DUP", securitiesTransacted=2000)])
        monkeypatch.setattr(fmp_client, "search_insider_purchases", _Pages([p0, p1]))
        out = insider.get_market_insider_buys()
        assert sorted(r["shares"] for r in out) == [1000, 2000]

    def test_sorted_by_amount_desc_and_capped_at_50(self, monkeypatch):
        rows = [_row(symbol=f"S{i}", securitiesTransacted=i + 1) for i in range(80)]
        monkeypatch.setattr(fmp_client, "search_insider_purchases", _Pages([_ok(rows)]))
        out = insider.get_market_insider_buys()
        assert len(out) == 50
        amounts = [r["amount"] for r in out]
        assert amounts == sorted(amounts, reverse=True)
        assert out[0]["symbol"] == "S79"

    def test_complete_run_gets_the_success_ttl(self, monkeypatch):
        monkeypatch.setattr(fmp_client, "search_insider_purchases", _Pages([_ok([_row()])]))
        insider.get_market_insider_buys()
        assert _ttl_remaining(insider._MARKET_FEED_KEY) > insider._FEED_TTL - 5

    def test_partial_failure_serves_rows_at_the_short_ttl(self, monkeypatch):
        fake = _Pages([_ok(_full([_row(symbol="KEEP")])),
                       fmp_client.FMPTransient("boom", vendor="fmp")])
        monkeypatch.setattr(fmp_client, "search_insider_purchases", fake)
        out = insider.get_market_insider_buys()
        assert [r["symbol"] for r in out] == ["KEEP"]
        rem = _ttl_remaining(insider._MARKET_FEED_KEY)
        assert rem <= insider._FEED_FAIL_TTL + 5 and rem < insider._FEED_TTL

    def test_degraded_page_counts_as_partial(self, monkeypatch):
        degraded = provider_errors.ProviderResult(
            value=None,
            provenance=provider_errors.ProvenanceRecord(vendor="fmp", source_activity="x"),
            licensing_class="R", degraded="cached_forbidden")
        fake = _Pages([_ok(_full([_row(symbol="KEEP")])), degraded])
        monkeypatch.setattr(fmp_client, "search_insider_purchases", fake)
        assert [r["symbol"] for r in insider.get_market_insider_buys()] == ["KEEP"]
        assert _ttl_remaining(insider._MARKET_FEED_KEY) <= insider._FEED_FAIL_TTL + 5

    def test_total_failure_returns_empty_cached_short_and_never_raises(self, monkeypatch):
        fake = _Pages([RuntimeError("network down")])
        monkeypatch.setattr(fmp_client, "search_insider_purchases", fake)
        assert insider.get_market_insider_buys() == []
        assert _ttl_remaining(insider._MARKET_FEED_KEY) <= insider._FEED_FAIL_TTL + 5

    def test_cache_hit_makes_no_call(self, monkeypatch):
        cache.set(insider._MARKET_FEED_KEY, [{"symbol": "HIT"}], 60)
        fake = _Pages([])
        monkeypatch.setattr(fmp_client, "search_insider_purchases", fake)
        assert insider.get_market_insider_buys() == [{"symbol": "HIT"}]
        assert fake.calls == []


# ── per-ticker path is unchanged by the shared helper ────────────────────

def test_per_ticker_rows_keep_their_shape(monkeypatch):
    cache.invalidate("insider_ZSHAPE")
    sale = _row(symbol="ZSHAPE", transactionType="S-Sale", acquisitionOrDisposition="D",
                typeOfOwner="officer: CFO", transactionDate="2026-07-30", filingDate="2026-08-01")
    monkeypatch.setattr(insider, "_fetch_insider_raw", lambda tk: ([sale, "junk"], True))
    out = insider.get_insider_activity("ZSHAPE")
    assert out == [{
        "name": "Jane Doe", "title": "officer: CFO", "type": "sell", "shares": 1000,
        "price": 10.0, "amount": 10000.0, "date": "2026-07-30", "filing_date": "2026-08-01",
    }]
    cache.invalidate("insider_ZSHAPE")


# ── GET /api/insider/feed?scope= ──────────────────────────────────────────

def _client():
    app = FastAPI()
    app.include_router(insider_router.router)
    app.dependency_overrides[insider_router.require_paid] = lambda: {"id": "u1", "role": "member"}
    return TestClient(app)


class TestRoute:
    def test_default_feed_is_the_old_feed(self, monkeypatch):
        monkeypatch.setattr(insider_router, "get_recent_insider_buys", lambda: [{"symbol": "OLD"}])
        monkeypatch.setattr(insider_router, "get_market_insider_buys",
                            lambda: pytest.fail("market feed must not run without scope"))
        r = _client().get("/api/insider/feed")
        assert r.status_code == 200 and r.json() == [{"symbol": "OLD"}]

    def test_scope_market_is_the_market_feed(self, monkeypatch):
        monkeypatch.setattr(insider_router, "get_market_insider_buys", lambda: [{"symbol": "MKT"}])
        monkeypatch.setattr(insider_router, "get_recent_insider_buys",
                            lambda: pytest.fail("old feed must not run for scope=market"))
        r = _client().get("/api/insider/feed?scope=market")
        assert r.status_code == 200 and r.json() == [{"symbol": "MKT"}]

    @pytest.mark.parametrize("bad", ["", "MARKET", "uct20", "all"])
    def test_bad_scope_is_400(self, monkeypatch, bad):
        monkeypatch.setattr(insider_router, "get_market_insider_buys", lambda: pytest.fail("ran"))
        monkeypatch.setattr(insider_router, "get_recent_insider_buys", lambda: pytest.fail("ran"))
        r = _client().get("/api/insider/feed", params={"scope": bad})
        assert r.status_code == 400

    def test_feed_requires_a_paid_member(self):
        app = FastAPI()
        app.include_router(insider_router.router)
        r = TestClient(app).get("/api/insider/feed?scope=market")
        assert r.status_code in (401, 402, 403)
