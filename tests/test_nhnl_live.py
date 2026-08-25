"""Unit tests for the intraday New-High/New-Low accumulator (nhnl_live).

Drives `_tick_once` directly with synthetic whole-market snapshots so the
count/reset/filter logic is verified without any network or the background thread.
"""
from datetime import datetime

import pytest

from api.services import nhnl_live


@pytest.fixture(autouse=True)
def _fresh_state(monkeypatch):
    """Reset accumulator state + pin a tiny 2-name universe + tradable-all."""
    nhnl_live._prov_to_app = {"AAA": "AAA", "BBB": "BBB"}
    with nhnl_live._lock:
        nhnl_live._state["session_date"] = None
        nhnl_live._state["syms"] = {}
        nhnl_live._state["events"].clear()
        nhnl_live._state["asof"] = None
        nhnl_live._state["ticks"] = 0
    # By default everything is tradable; individual tests override.
    monkeypatch.setattr(nhnl_live, "_is_tradable", lambda sym, row: True)
    yield
    nhnl_live._prov_to_app = None


def _now(minute=0):
    return datetime(2026, 8, 25, 10, minute, 0)


def _snap(**rows):
    """rows: sym -> (day_high, day_low, last_price)."""
    return {s: {"day_high": h, "day_low": l, "last_price": p} for s, (h, l, p) in rows.items()}


def _tick(snapshot, minute=0, session="regular", today="2026-08-25"):
    nhnl_live._tick_once(snapshot, session, today, _now(minute))


# ── Seeding ───────────────────────────────────────────────────────────────────

def test_first_sight_seeds_and_emits_nothing():
    _tick(_snap(AAA=(100.0, 98.0, 99.0)))
    out = nhnl_live.get_live()
    assert out["highs"] == [] and out["lows"] == []
    assert nhnl_live._state["syms"]["AAA"]["hod"] == 100.0


# ── New highs count up ──────────────────────────────────────────────────────────

def test_new_high_emits_event_and_increments_count():
    _tick(_snap(AAA=(100.0, 98.0, 99.0)), minute=0)   # seed
    _tick(_snap(AAA=(101.0, 98.0, 101.0)), minute=1)  # new HOD #1
    _tick(_snap(AAA=(102.0, 98.0, 102.0)), minute=2)  # new HOD #2
    out = nhnl_live.get_live()
    assert [e["count"] for e in out["highs"]] == [2, 1]   # newest first
    assert out["highs"][0]["sym"] == "AAA"
    assert out["highs"][0]["dir"] == "high"
    assert out["lows"] == []


def test_no_event_when_high_not_exceeded():
    _tick(_snap(AAA=(100.0, 98.0, 99.0)), minute=0)
    _tick(_snap(AAA=(100.0, 98.0, 99.5)), minute=1)  # equal high, no new HOD
    assert nhnl_live.get_live()["highs"] == []
    assert nhnl_live._state["syms"]["AAA"]["nh"] == 0


# ── New lows count down ─────────────────────────────────────────────────────────

def test_new_low_emits_event_and_increments_count():
    _tick(_snap(AAA=(100.0, 98.0, 99.0)), minute=0)    # seed
    _tick(_snap(AAA=(100.0, 97.0, 97.0)), minute=1)    # new LOD #1
    _tick(_snap(AAA=(100.0, 96.0, 96.0)), minute=2)    # new LOD #2
    out = nhnl_live.get_live()
    assert [e["count"] for e in out["lows"]] == [2, 1]
    assert out["lows"][0]["dir"] == "low"
    assert out["highs"] == []


def test_same_tick_can_make_both_new_high_and_new_low():
    _tick(_snap(AAA=(100.0, 98.0, 99.0)), minute=0)     # seed hod=100 lod=98
    _tick(_snap(AAA=(101.0, 97.0, 100.0)), minute=1)    # both extremes extend
    out = nhnl_live.get_live()
    assert len(out["highs"]) == 1 and len(out["lows"]) == 1


# ── Session gating + daily reset ───────────────────────────────────────────────

def test_non_regular_session_does_not_accumulate():
    _tick(_snap(AAA=(100.0, 98.0, 99.0)), minute=0, session="pre_market")
    assert nhnl_live._state["syms"] == {}
    assert nhnl_live.get_live()["highs"] == []


def test_new_day_resets_counters():
    _tick(_snap(AAA=(100.0, 98.0, 99.0)), minute=0, today="2026-08-25")
    _tick(_snap(AAA=(101.0, 98.0, 101.0)), minute=1, today="2026-08-25")
    assert nhnl_live._state["syms"]["AAA"]["nh"] == 1
    # Next session — snapshot arrives under a new ET date.
    _tick(_snap(AAA=(50.0, 49.0, 49.5)), minute=0, today="2026-08-26")
    assert nhnl_live._state["session_date"] == "2026-08-26"
    assert nhnl_live._state["syms"]["AAA"]["nh"] == 0          # reset + reseed
    assert nhnl_live._state["syms"]["AAA"]["hod"] == 50.0
    assert nhnl_live.get_live()["highs"] == []


# ── Tradability gate ────────────────────────────────────────────────────────────

def test_untradable_symbol_advances_mark_but_emits_no_event(monkeypatch):
    monkeypatch.setattr(nhnl_live, "_is_tradable", lambda sym, row: sym != "BBB")
    _tick(_snap(AAA=(10.0, 9.0, 9.5), BBB=(1.0, 0.5, 0.8)), minute=0)   # seed both
    _tick(_snap(AAA=(11.0, 9.0, 11.0), BBB=(2.0, 0.5, 2.0)), minute=1)  # both new HOD
    out = nhnl_live.get_live()
    syms = [e["sym"] for e in out["highs"]]
    assert "AAA" in syms and "BBB" not in syms          # junk filtered from stream
    assert nhnl_live._state["syms"]["BBB"]["nh"] == 0
    assert nhnl_live._state["syms"]["BBB"]["hod"] == 2.0  # mark still advanced


# ── get_live filters ───────────────────────────────────────────────────────────

def test_get_live_min_price_and_min_count_filters():
    _tick(_snap(AAA=(100.0, 98.0, 99.0), BBB=(5.0, 4.0, 4.5)), minute=0)   # seed
    _tick(_snap(AAA=(101.0, 98.0, 101.0), BBB=(6.0, 4.0, 6.0)), minute=1)  # both HOD #1
    _tick(_snap(AAA=(102.0, 98.0, 102.0), BBB=(7.0, 4.0, 7.0)), minute=2)  # both HOD #2
    # Price floor drops the cheap name entirely.
    hi = nhnl_live.get_live(min_price=50.0)["highs"]
    assert {e["sym"] for e in hi} == {"AAA"}
    # min_count keeps only the persistent (count>=2) prints.
    hi2 = nhnl_live.get_live(min_count=2)["highs"]
    assert all(e["count"] >= 2 for e in hi2)
    assert len(hi2) == 2   # AAA#2 + BBB#2


def test_get_live_limit_caps_each_side():
    _tick(_snap(AAA=(100.0, 98.0, 99.0)), minute=0)
    for m in range(1, 6):
        _tick(_snap(AAA=(100.0 + m, 98.0, 100.0 + m)), minute=m)   # 5 new highs
    out = nhnl_live.get_live(limit=3)
    assert len(out["highs"]) == 3
    assert [e["count"] for e in out["highs"]] == [5, 4, 3]   # newest first
