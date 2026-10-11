"""A Perplexity 4xx logs the provider's own reason, server-side only.

2026-10-11: production logged 85 `perplexity request failed: 400 Client Error: Bad Request`
lines on surface=news_catalysts in a few hours and nothing else, so nobody could tell which
request field Perplexity refused (a 400 is never retried, it just fails). The warning now
carries the response body; the member-facing error stays status-only.
"""
from __future__ import annotations

import logging

import requests

import api.services.perplexity_search as ps


class _Resp:
    def __init__(self, status: int, text: str):
        self.status_code = status
        self.text = text

    def raise_for_status(self):
        err = requests.HTTPError(f"{self.status_code} Client Error: Bad Request for url: x")
        err.response = self
        raise err

    def json(self):
        return {}


def _hermetic(monkeypatch):
    monkeypatch.setenv("PERPLEXITY_API_KEY", "test-key")
    monkeypatch.setattr(ps, "_retry_pause", lambda attempt: 0.0)
    monkeypatch.setattr(ps, "_check_daily_budget", lambda surface: None)
    monkeypatch.setattr(ps, "_notify_auth_failure", lambda status: None)
    try:
        ps._SEARCH_CACHE._data.clear()
    except Exception:
        pass


def test_a_400_logs_the_providers_reason_and_keeps_the_member_error_masked(monkeypatch, caplog):
    _hermetic(monkeypatch)
    body = '{"error":{"message":"Invalid search_recency_filter","type":"invalid_request"}}'
    monkeypatch.setattr(ps.requests, "post", lambda *a, **k: _Resp(400, body))
    with caplog.at_level(logging.WARNING, logger=ps._log.name):
        res = ps.web_search("why is NVDA up today", mode="fast", recency="day",
                            cost_surface="news_catalysts", cache_salt="reason-1")
    assert res["error"] == "request failed (400)", "the member-facing error stays status-only"
    joined = "\n".join(r.getMessage() for r in caplog.records)
    assert "Invalid search_recency_filter" in joined, joined


def test_CONTROL_a_5xx_adds_no_body_and_a_network_error_adds_nothing():
    class _E(requests.RequestException):
        pass

    five = requests.HTTPError("503")
    five.response = _Resp(503, "upstream html page")
    assert ps._provider_reason(five) == ""
    assert ps._provider_reason(_E("connection reset")) == ""
    four = requests.HTTPError("400")
    four.response = _Resp(400, "line one\nline two")
    assert ps._provider_reason(four) == " | provider said: line one line two"
