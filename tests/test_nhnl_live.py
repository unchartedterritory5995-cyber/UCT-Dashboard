"""Unit tests for the intraday New-High/New-Low accumulator (nhnl_live).

Drives `_tick_once` directly with synthetic whole-market snapshots so the
count/reset/window logic is verified without any network or the background thread.
"""
from datetime import datetime

import pytest

from api.services import nhnl_live


@pytest.fixture(autouse=True)
def _fresh_state(monkeypatch):
    """Reset accumulator state + pin a tiny 2-name universe + tradable-all."""
    nhnl_live._prov_to_app = {"AAA": "AAA", "BBB": "BBB"}
    with nhnl_live._lock:
        nhnl_live._state["session_key"] = None
        nhnl_live._state["window"] = "closed"
        nhnl_live._state["date"] = None
        nhnl_live._state["syms"] = {}
        nhnl_live._state["events"].clear()
        nhnl_live._state["asof"] = None
        nhnl_live._state["ticks"] = 0
    monkeypatch.setattr(nhnl_live, "_is_tradable", lambda sym, row: True)
    yield
    nhnl_live._prov_to_app = None


def _now(minute=0):
    return datetime(2026, 8, 25, 10, minute, 0)


def _snap(**rows):
    """RTH rows: sym -> (day_high, day_low, last_price)."""
    return {s: {"day_high": h, "day_low": l, "last_price": p} for s, (h, l, p) in rows.items()}


def _ext_snap(**rows):
    """Extended-hours rows: sym -> ext_price (as a fresh lastTrade print)."""
    return {s: {"last_trade_p": p, "min_c": p, "day_c": 0.0, "last_price": p} for s, p in rows.items()}


def _tick(snapshot, minute=0, window="rth", today="2026-08-25"):
    nhnl_live._tick_once(snapshot, window, today, _now(minute))


# ── RTH: new highs count up ─────────────────────────────────────────────────────

def test_first_sight_seeds_and_emits_nothing():
    _tick(_snap(AAA=(100.0, 98.0, 99.0)))
    out = nhnl_live.get_live()
    assert out["highs"] == [] and out["lows"] == []
    assert nhnl_live._state["syms"]["AAA"]["hod"] == 100.0


def test_new_high_emits_event_and_increments_count():
    _tick(_snap(AAA=(100.0, 98.0, 99.0)), minute=0)   # seed
    _tick(_snap(AAA=(101.0, 98.0, 101.0)), minute=1)  # new HOD #1
    _tick(_snap(AAA=(102.0, 98.0, 102.0)), minute=2)  # new HOD #2
    out = nhnl_live.get_live()
    assert [e["count"] for e in out["highs"]] == [2, 1]   # newest first
    assert out["highs"][0]["sym"] == "AAA"


def test_new_low_emits_event_and_increments_count():
    _tick(_snap(AAA=(100.0, 98.0, 99.0)), minute=0)    # seed
    _tick(_snap(AAA=(100.0, 97.0, 97.0)), minute=1)    # new LOD #1
    _tick(_snap(AAA=(100.0, 96.0, 96.0)), minute=2)    # new LOD #2
    out = nhnl_live.get_live()
    assert [e["count"] for e in out["lows"]] == [2, 1]


def test_universe_totals_count_distinct_symbols_not_events():
    _tick(_snap(AAA=(100.0, 98.0, 99.0), BBB=(50.0, 48.0, 49.0)), minute=0)   # seed both
    _tick(_snap(AAA=(101.0, 98.0, 101.0), BBB=(51.0, 48.0, 51.0)), minute=1)  # both HOD #1
    _tick(_snap(AAA=(102.0, 98.0, 102.0), BBB=(52.0, 48.0, 52.0)), minute=2)  # both HOD #2
    out = nhnl_live.get_live()
    assert out["highs_total"] == 2          # 2 distinct names at a new high…
    assert len(out["highs"]) == 4           # …but 4 events in the stream
    assert out["lows_total"] == 0


# ── Window gating + reset ───────────────────────────────────────────────────────

def test_closed_window_does_not_accumulate():
    _tick(_snap(AAA=(100.0, 98.0, 99.0)), minute=0, window="closed")
    assert nhnl_live._state["syms"] == {}


def test_window_change_resets_counters():
    _tick(_snap(AAA=(100.0, 98.0, 99.0)), minute=0, window="rth")
    _tick(_snap(AAA=(101.0, 98.0, 101.0)), minute=1, window="rth")
    assert nhnl_live._state["syms"]["AAA"]["nh"] == 1
    # Session rolls into post-market — a fresh window, counters reset.
    _tick(_ext_snap(AAA=50.0), minute=0, window="post")
    assert nhnl_live._state["session_key"] == "2026-08-25:post"
    assert nhnl_live._state["syms"]["AAA"]["nh"] == 0


# ── Pre / post market (ext-price tracking) ──────────────────────────────────────

def test_premarket_new_high_from_ext_price():
    _tick(_ext_snap(AAA=10.0), minute=0, window="pre")   # seed ext high 10
    _tick(_ext_snap(AAA=10.5), minute=1, window="pre")   # ext ticks up → new high
    _tick(_ext_snap(AAA=11.0), minute=2, window="pre")   # again
    out = nhnl_live.get_live()
    assert [e["count"] for e in out["highs"]] == [2, 1]
    assert out["highs"][0]["sym"] == "AAA"


def test_postmarket_new_low_from_ext_price():
    _tick(_ext_snap(AAA=10.0), minute=0, window="post")  # seed
    _tick(_ext_snap(AAA=9.5), minute=1, window="post")   # ext drops → new low
    out = nhnl_live.get_live()
    assert [e["count"] for e in out["lows"]] == [1]
    assert out["lows"][0]["dir"] == "low"


# ── Tradability gate ────────────────────────────────────────────────────────────

def test_untradable_symbol_advances_mark_but_emits_no_event(monkeypatch):
    monkeypatch.setattr(nhnl_live, "_is_tradable", lambda sym, row: sym != "BBB")
    _tick(_snap(AAA=(10.0, 9.0, 9.5), BBB=(1.0, 0.5, 0.8)), minute=0)   # seed both
    _tick(_snap(AAA=(11.0, 9.0, 11.0), BBB=(2.0, 0.5, 2.0)), minute=1)  # both new HOD
    out = nhnl_live.get_live()
    assert {e["sym"] for e in out["highs"]} == {"AAA"}
    assert nhnl_live._state["syms"]["BBB"]["nh"] == 0
    assert nhnl_live._state["syms"]["BBB"]["hod"] == 2.0   # mark still advanced


# ── get_live filters ───────────────────────────────────────────────────────────

def test_get_live_min_price_and_min_count_filters():
    _tick(_snap(AAA=(100.0, 98.0, 99.0), BBB=(5.0, 4.0, 4.5)), minute=0)   # seed
    _tick(_snap(AAA=(101.0, 98.0, 101.0), BBB=(6.0, 4.0, 6.0)), minute=1)  # both HOD #1
    _tick(_snap(AAA=(102.0, 98.0, 102.0), BBB=(7.0, 4.0, 7.0)), minute=2)  # both HOD #2
    assert {e["sym"] for e in nhnl_live.get_live(min_price=50.0)["highs"]} == {"AAA"}
    hi2 = nhnl_live.get_live(min_count=2)["highs"]
    assert all(e["count"] >= 2 for e in hi2) and len(hi2) == 2


def test_get_live_limit_caps_each_side():
    _tick(_snap(AAA=(100.0, 98.0, 99.0)), minute=0)
    for m in range(1, 6):
        _tick(_snap(AAA=(100.0 + m, 98.0, 100.0 + m)), minute=m)   # 5 new highs
    out = nhnl_live.get_live(limit=3)
    assert len(out["highs"]) == 3
    assert [e["count"] for e in out["highs"]] == [5, 4, 3]
