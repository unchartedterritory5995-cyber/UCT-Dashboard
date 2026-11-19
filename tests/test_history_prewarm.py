"""The global history pre-warm (api/services/history_prewarm.py) really warms (2026-11-18).

Its boundary read went out without the service token after `/api/bars-history` became paid, was
refused (401) on every pass, and the sweep warmed nothing for weeks while logging "complete".
"""
import logging

import pytest

from api.services import history_prewarm as HP

AUTH = {"Authorization": "Bearer s3cret"}


class _Resp:
    def __init__(self, status, body=None, cf="MISS"):
        self.status_code, self._body, self.headers = status, body or {}, {"cf-cache-status": cf}

    def json(self):
        return self._body


class _Client:
    """The edge as the sweep sees it: every bars-history read needs the service token."""

    def __init__(self):
        self.calls = []

    def get(self, url, headers=None):
        self.calls.append((url, dict(headers or {})))
        if (headers or {}).get("Authorization") != AUTH["Authorization"]:
            return _Resp(401, {"detail": "Not authenticated"})
        return _Resp(200, {"last_sealed": "2026-11-17"})

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture()
def edge(monkeypatch):
    c = _Client()
    monkeypatch.setattr(HP, "_svc_headers", lambda: dict(AUTH))
    monkeypatch.setattr(HP, "_client", lambda: c)
    monkeypatch.setattr(HP, "_universe", lambda: ["AAA", "BBB"])
    monkeypatch.setattr(HP, "_PACE", 0)
    monkeypatch.setattr(HP.time, "sleep", lambda s: None)
    return c


def test_the_boundary_read_carries_the_service_token(edge):
    assert HP._market_last_sealed(edge, "D") == "2026-11-17"
    assert edge.calls[0][1] == AUTH


def test_a_pass_warms_every_symbol_and_timeframe_on_the_browser_s_url(edge):
    stats = HP.prewarm_pass()
    assert stats["requests"] == 6 and stats["err"] == 0
    warmed = [u for u, h in edge.calls if "&d=" in u]
    assert "https://uctintelligence.com/api/bars-history/AAA?tf=D&bars=12500&d=2026-11-17" in warmed
    assert all(h == AUTH for _u, h in edge.calls)


def test_a_pass_that_warms_nothing_is_an_error_not_complete(edge, monkeypatch, caplog):
    monkeypatch.setattr(HP, "_svc_headers", lambda: {})          # the token missing: every read refused
    with caplog.at_level(logging.INFO, logger="history_prewarm"):
        stats = HP.prewarm_pass()
    assert stats["requests"] == 0
    assert any(r.levelno == logging.ERROR and "warmed NOTHING" in r.getMessage() for r in caplog.records)
    assert not any("sweep complete" in r.getMessage() for r in caplog.records)
