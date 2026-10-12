"""Synthetic world for Slice 2 event-study tests — NOT a test module. Every value is FAKE.

Sessions are the REAL 2024 NYSE trading days (shared `session_calendar`), so calendar logic is
exercised for real. Price: close(i) = 100 + i on session i, so any forward return is checkable by
formula. Breadth (`pct_above_50sma`, percent) is 50.0 except the hand-placed episodes below.
"""
from __future__ import annotations

import socket
from datetime import date, timedelta

from api.services import session_calendar as sc
from api.services.market_intel import breadth_reads as br
from api.services.market_intel import price_reads as pr


def trading_days(first: str, last: str) -> list[str]:
    d, end, out = date.fromisoformat(first), date.fromisoformat(last), []
    while d <= end:
        if sc.is_trading_day(d):
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


S = trading_days("2024-01-02", "2024-12-31")          # 252 sessions

#: hand-placed breadth readings (session index → value); everything else is 50.0
SPECIAL = {
    10: 8.0, 11: 8.0, 12: 8.0,          # run A: 3 qualifying sessions below 10
    50: 9.5,                            # run B: one session
    51: 10.0,                           # exactly the threshold: NOT below
    99: 7.0, 101: 7.0,                  # S[100] has NO breadth value → two separate runs
    240: 5.0, 241: 5.0, 242: 5.0,       # run D near the end: long windows are incomplete
}
BREADTH_GAP = {100}
PRICE_GAP = {60}                         # no stored close on S[60]


def breadth_rows(special=None, gaps=None) -> list[tuple[str, float]]:
    special = SPECIAL if special is None else special
    gaps = BREADTH_GAP if gaps is None else gaps
    return [(d, special.get(i, 50.0)) for i, d in enumerate(S) if i not in gaps]


def price_bars(first_index: int = 0, gaps=None) -> list[dict]:
    gaps = PRICE_GAP if gaps is None else gaps
    return [{"t": d, "o": 0, "h": 0, "l": 0, "c": 100.0 + i, "v": 0}
            for i, d in enumerate(S) if i >= first_index and i not in gaps]


def close(i: int) -> float:
    return 100.0 + i


def install(monkeypatch, *, rows=None, bars=None, authority="exchange-breadth-v1", forbid_network=True) -> dict:
    """Patch the two read seams (`breadth_reads.sealed_series`, `price_reads._load_bars`)."""
    state = {"rows": breadth_rows() if rows is None else rows, "bars": price_bars() if bars is None else bars,
             "breadth_calls": 0, "price_calls": 0}

    def fake_sealed(universe, metric):
        state["breadth_calls"] += 1
        rows_ = state["rows"]
        if not rows_:
            return {"status": "unavailable", "reason": "read_failed", "detail": "empty"}
        return {"status": "ok", "rows": rows_,
                "coverage": {"first": rows_[0][0], "last": rows_[-1][0], "authority": authority}}

    def fake_load(symbol):
        state["price_calls"] += 1
        return state["bars"]

    monkeypatch.setattr(br, "sealed_series", fake_sealed)
    monkeypatch.setattr(pr, "_load_bars", fake_load)
    if forbid_network:
        from tests.market_intel_breadth_fixtures import install_loopback_only_guard
        install_loopback_only_guard(monkeypatch)
    return state
