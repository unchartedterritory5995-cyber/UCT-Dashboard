"""A theme index (`$IDX:<THEME>`) is not a bars symbol: /api/bars says so once, and finally.

Measured on production 2026-11-16: one pass through the app made 123 requests of
`/api/bars/$IDX:<theme>`, each answered 503 "warming" with Retry-After (or an empty 200), which
invites the page to ask again for a series this lane can never hold.
"""
from __future__ import annotations

import asyncio
import json

import pytest

from api.routers import bars


@pytest.mark.parametrize("ticker", ["$IDX:BIOTECH", "$idx:biotech", " $IDX:GLP-1 ", "$IDX:NO-SUCH-THEME", "$IDX:"])
def test_the_whole_idx_namespace_is_a_theme_index(ticker):
    assert bars.is_theme_index_symbol(ticker) is True


@pytest.mark.parametrize("ticker", ["NVDA", "IDX", "$SPX", "IDX:BIOTECH", "$IDXX:BIOTECH", "ECON:CPI", "BRK.B", "", None, 7])
def test_ordinary_symbols_are_not(ticker):
    assert bars.is_theme_index_symbol(ticker) is False


def _body(resp) -> dict:
    return json.loads(bytes(resp.body))


def test_the_answer_is_final_not_retryable():
    resp = bars._theme_index_refusal("$idx:biotech", "D")
    assert resp.status_code == 200
    assert _body(resp) == {"ticker": "$IDX:BIOTECH", "tf": "D", "bars": [], "no_data": True, "reason": "not_a_bars_symbol"}
    assert "retry-after" not in resp.headers
    assert "warming" not in resp.body.decode() and "error" not in _body(resp)
    assert bars._fetch_already_running(resp) is False, "the page must not read this as a fetch in flight"


def test_only_the_members_own_browser_may_keep_it():
    cc = bars._theme_index_refusal("$IDX:BIOTECH", "D").headers["cache-control"]
    assert cc == "private, max-age=3600" and "public" not in cc


def _never(*a, **k):
    raise AssertionError("a theme index reached the bars lane")


def test_the_route_refuses_before_the_proxy_and_the_provider(monkeypatch):
    monkeypatch.setenv("BARS_ORIGIN_URL", "http://tier.invalid")
    monkeypatch.setattr(bars, "_bars_proxy_should_route", _never)
    monkeypatch.setattr(bars, "_proxy_bars_to_tier", _never)
    monkeypatch.setattr(bars, "serve_bars", _never)
    resp = asyncio.run(bars.get_bars("$IDX:BIOTECH", _access={}, tf="5", bars=200, since="", to="", warm=1, session=""))
    assert resp.status_code == 200 and _body(resp)["reason"] == "not_a_bars_symbol" and _body(resp)["tf"] == "5"


def test_the_tier_entry_point_refuses_before_any_fetch(monkeypatch):
    monkeypatch.setattr(bars._bars_fetch, "set_request_interactive", _never)
    resp = bars.serve_bars("$IDX:SOLAR", "D")
    assert resp.status_code == 200 and _body(resp)["no_data"] is True
    assert _body(resp)["ticker"] == "$IDX:SOLAR"


def test_an_economic_series_keeps_its_own_answer():
    resp = asyncio.run(bars.get_bars("ECON:CPI", _access={}, tf="D", bars=200, since="", to="", warm=0, session=""))
    assert resp.status_code == 404 and "economic series" in _body(resp)["error"]
