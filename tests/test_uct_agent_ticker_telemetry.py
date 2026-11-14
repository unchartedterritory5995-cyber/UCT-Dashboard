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
