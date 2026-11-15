"""Ticker-lookup instrumentation (owner, #1283) -- NO-LEAK on the server.

The browser counts ticker lookups (counts, ms, verdict-kind counts only) and sends them with the telemetry row. No schema
change was authorised (coordinator, #1283: no new DB column), so the server stores NONE of the ticker_* keys today. This test
holds that whatever the browser sends with a row -- counts, a word the member typed, a symbol, a message, an id -- none of it
reaches any stored column, and the row still records normally.
"""
from __future__ import annotations

import json

import pytest

from api.services.uct_agent import store

TICKER_KEYS = {"ticker_lookups": 2, "ticker_answered": 1, "ticker_timeouts": 1, "ticker_hits": 1, "ticker_misses": 0,
               "ticker_multi": 0, "ticker_wait_ms": 412, "ticker_ambiguous": 0, "ticker_unresolved": 1}
LEAKS = ("amd", "AMD", "take amd to weekly", "ac_9", "u9")


def _row():
    return store.telemetry_rows()[0]


@pytest.mark.parametrize("extra", [
    TICKER_KEYS,
    {"ticker_lookups": "AMD", "ticker_words": ["amd"], "ticker_symbol": "AMD", "conversation": "ac_9", "user": "u9"},
    {"ticker_lookups": {"w": "take amd to weekly"}, "ticker_wait_ms": ["amd"]},
])
def test_no_leak_ticker_keys_and_words_never_reach_a_column(extra):
    store.record_telemetry("u1", "ac_1", {"path": "model", "disposition": "clarify", **extra})
    row = _row()
    assert row["path"] == "model" and row["disposition"] == "clarify"
    assert not any(k.startswith("ticker") for k in row)                 # no column was added for them
    raw = json.dumps(row, default=str)
    for leak in LEAKS:
        assert leak not in raw


# ── the LOG LINE (owner decision (b), #1283): counts / ms / verdict-kind counts only ──
def test_the_log_line_carries_the_counts():
    line = store.ticker_log_line(TICKER_KEYS)
    assert line == ("lookups=2 answered=1 timeouts=1 hits=1 misses=0 multi=0 wait_ms=412 ambiguous=0 unresolved=1")


@pytest.mark.parametrize("bad", ["AMD", "take amd to weekly", {"w": "amd"}, ["amd"], True, -1, None, "ac_9"])
def test_no_leak_the_log_line_carries_no_value_a_member_typed(bad):
    row = {"ticker_lookups": bad, "ticker_wait_ms": 5, "ticker_words": ["amd"], "ticker_symbol": "AMD",
           "conversation": "ac_9", "user": "u9", "member": "take amd to weekly"}
    line = store.ticker_log_line(row)
    assert line == "wait_ms=5"
    for leak in LEAKS:
        assert leak not in line


def test_a_row_without_ticker_counts_logs_nothing():
    assert store.ticker_log_line({"path": "fast", "visible_ms": 10}) is None
    assert store.ticker_log_line(None) is None


def test_the_record_route_logs_only_the_counts(caplog):
    import logging
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import uct_agent as rx
    app = FastAPI()
    app.include_router(rx.router)
    app.dependency_overrides[rx.require_admin_dark] = lambda: {"id": "c0ffee00-0000-4000-8000-0000000000a1", "plan": "pro", "role": "admin"}
    with caplog.at_level(logging.INFO, logger=rx.log.name):
        r = TestClient(app).post("/api/agent/record", json={
            "member": "take amd to weekly", "outcome": "ok",
            "telemetry": {"path": "fast", "ticker_lookups": 1, "ticker_hits": 1, "ticker_words": ["amd"], "ticker_symbol": "AMD"}})
    assert r.status_code == 200
    lines = [m.getMessage() for m in caplog.records if "ticker lookups" in m.getMessage()]
    assert lines == ["[uct-agent] ticker lookups lookups=1 hits=1"]
    for leak in LEAKS:
        assert leak not in lines[0]
