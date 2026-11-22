"""fmp_response_cache: one on-disk cache in front of every FMP GET (2026-11-13, the account hit FMP's
150 GB / 30-day bandwidth cap: ~113K income statements and ~475K profiles a day for a few thousand
symbols, because the callers' long TTLs lived in a 1,000-entry shared LRU)."""
from datetime import date

import pytest

from api.services import earnings_estimates as ee
from api.services import fmp_client
from api.services import fmp_response_cache as frc


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv("FMP_RESPONSE_CACHE", "1")
    monkeypatch.setenv("FMP_API_KEY", "test-key")


class _Resp:
    status_code = 200

    def __init__(self, body):
        self._body = body

    def json(self):
        return self._body

    def raise_for_status(self):
        return None


def test_the_typed_client_downloads_a_statement_once_inside_its_ttl(on, monkeypatch):
    calls = []
    body = [{"date": "2026-09-30", "revenue": 1.0}]
    monkeypatch.setattr(fmp_client._session, "get", lambda url, params, timeout: calls.append(params) or _Resp(body))
    params = {"symbol": "NVDA", "period": "quarter", "limit": 16}
    assert fmp_client._get_raw("/stable/income-statement", params) == body
    assert fmp_client._get_raw("/stable/income-statement", dict(params)) == body
    assert len(calls) == 1                                    # the second answer came off disk
    assert fmp_client._get_raw("/stable/income-statement", {**params, "symbol": "AMD"}) == body
    assert len(calls) == 2                                    # another symbol is another answer


def test_a_cache_hit_spends_no_rate_limit_token(on, monkeypatch):
    monkeypatch.setattr(fmp_client._session, "get", lambda url, params, timeout: _Resp([{"symbol": "NVDA"}]))
    fmp_client._get_raw("/stable/profile", {"symbol": "NVDA"})
    monkeypatch.setattr(fmp_client, "_take_token", lambda: pytest.fail("a hit took a token"))
    assert fmp_client._get_raw("/stable/profile", {"symbol": "NVDA"}) == [{"symbol": "NVDA"}]


def test_live_feeds_are_never_cached(on, monkeypatch):
    calls = []
    monkeypatch.setattr(fmp_client._session, "get", lambda url, params, timeout: calls.append(1) or _Resp([{"t": 1}]))
    for _ in range(2):
        fmp_client._get_raw("/stable/news/stock-latest", {"limit": 50})
        fmp_client._get_raw("/stable/quote", {"symbol": "NVDA"})
    assert len(calls) == 4


def test_the_legacy_helper_shares_the_cache_and_never_stores_the_key(on, monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(ee.requests, "get", lambda url, params, timeout: calls.append(dict(params)) or _Resp(
        [{"symbol": "TANH", "ipoDate": "2020-01-01"}]))
    assert ee._fmp_get("/stable/profile", {"symbol": "TANH"})[0]["symbol"] == "TANH"
    assert ee._fmp_get("/stable/profile", {"symbol": "TANH"})[0]["symbol"] == "TANH"
    assert len(calls) == 1 and calls[0]["apikey"] == "test-key"
    raw = open(frc.db_path(), "rb").read()
    assert b"test-key" not in raw                            # the key is never written to the volume


def test_off_switch_and_ttls(monkeypatch):
    assert not frc.enabled()                                  # the suite runs with it off (conftest)
    monkeypatch.setenv("FMP_RESPONSE_CACHE", "1")
    frc.put("/stable/profile", {"symbol": "X"}, [{"symbol": "X"}])
    assert frc.get("/stable/profile", {"symbol": "X"}) == [{"symbol": "X"}]
    monkeypatch.setenv("FMP_RESPONSE_CACHE", "0")
    assert frc.get("/stable/profile", {"symbol": "X"}) is None      # off means a stored answer is not served
    monkeypatch.setenv("FMP_RESPONSE_CACHE", "1")
    today = date(2026, 11, 13)
    assert frc.ttl_for("/stable/earnings-calendar", {"from": "2026-11-02", "to": "2026-11-06"}, [{"a": 1}], today) \
        == frc.PAST_RANGE_TTL                                 # a past week does not change
    assert frc.ttl_for("/stable/earnings-calendar", {"from": "2026-11-13", "to": "2026-11-20"}, [{"a": 1}], today) \
        == 15 * 60                                            # this week's does
    assert frc.ttl_for("/stable/income-statement", {}, [], today) == frc.EMPTY_TTL
    assert frc.ttl_for("/stable/income-statement", {}, {"Error Message": "Limit Reach"}, today) == 0
    assert frc.ttl_for("/stable/news/stock", {}, [{"a": 1}], today) == 0


def test_an_expired_answer_is_downloaded_again(on, monkeypatch):
    frc.put("/stable/grades", {"symbol": "NVDA"}, [{"g": 1}], now=1_000.0)
    assert frc.get("/stable/grades", {"symbol": "NVDA"}, now=1_000.0 + 3599) == [{"g": 1}]
    assert frc.get("/stable/grades", {"symbol": "NVDA"}, now=1_000.0 + 3601) is None
