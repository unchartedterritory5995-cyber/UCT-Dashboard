"""Unit tests for the intraday New-High/New-Low accumulator (nhnl_live).

Drives `_tick_once` directly with synthetic whole-market snapshots so the
count/reset/window/ranking logic is verified without any network or the thread.
The endpoint returns a RANKED, DE-DUPED leaderboard (one row per symbol, busiest
first), so assertions are per-symbol counts, not per-event rows.
"""
from datetime import datetime

import pytest

from api.services import nhnl_live


@pytest.fixture(autouse=True)
def _fresh_state(monkeypatch):
    """Reset accumulator state + pin a tiny universe + tradable-all + no ETFs."""
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
    monkeypatch.setattr(nhnl_live, "_etf_set", lambda: set())
    monkeypatch.setattr(nhnl_live, "_theme_holdings", lambda: {})
    with nhnl_live._lock:
        nhnl_live._state["themes"] = {}
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


# ── RTH: counts accumulate; the leaderboard is one deduped row per symbol ────────

def test_first_sight_seeds_and_shows_nothing():
    _tick(_snap(AAA=(100.0, 98.0, 99.0)))
    out = nhnl_live.get_live()
    assert out["highs"] == [] and out["lows"] == []
    assert nhnl_live._state["syms"]["AAA"]["hod"] == 100.0


def test_new_high_increments_and_dedupes_to_one_row():
    _tick(_snap(AAA=(100.0, 98.0, 99.0)), minute=0)   # seed
    _tick(_snap(AAA=(101.0, 98.0, 101.0)), minute=1)  # new HOD #1
    _tick(_snap(AAA=(102.0, 98.0, 102.0)), minute=2)  # new HOD #2
    out = nhnl_live.get_live()
    assert [e["count"] for e in out["highs"]] == [2]   # ONE row, its running count
    assert out["highs"][0]["sym"] == "AAA"


def test_new_low_increments_and_dedupes():
    _tick(_snap(AAA=(100.0, 98.0, 99.0)), minute=0)
    _tick(_snap(AAA=(100.0, 97.0, 97.0)), minute=1)
    _tick(_snap(AAA=(100.0, 96.0, 96.0)), minute=2)
    out = nhnl_live.get_live()
    assert [e["count"] for e in out["lows"]] == [2]


def test_ranked_by_count_descending_busiest_first():
    _tick(_snap(AAA=(100.0, 98.0, 99.0), BBB=(50.0, 48.0, 49.0)), minute=0)   # seed both
    _tick(_snap(AAA=(101.0, 98.0, 101.0), BBB=(51.0, 48.0, 51.0)), minute=1)  # both #1
    _tick(_snap(AAA=(102.0, 98.0, 102.0), BBB=(52.0, 48.0, 52.0)), minute=2)  # both #2
    _tick(_snap(AAA=(103.0, 98.0, 103.0), BBB=(52.0, 48.0, 52.0)), minute=3)  # AAA #3 only
    out = nhnl_live.get_live()
    assert [(e["sym"], e["count"]) for e in out["highs"]] == [("AAA", 3), ("BBB", 2)]
    assert out["highs_total"] == 2       # distinct names at a new high


# ── Window gating + reset ───────────────────────────────────────────────────────

def test_closed_window_does_not_accumulate():
    _tick(_snap(AAA=(100.0, 98.0, 99.0)), minute=0, window="closed")
    assert nhnl_live._state["syms"] == {}


def test_window_change_resets_counters():
    _tick(_snap(AAA=(100.0, 98.0, 99.0)), minute=0, window="rth")
    _tick(_snap(AAA=(101.0, 98.0, 101.0)), minute=1, window="rth")
    assert nhnl_live._state["syms"]["AAA"]["nh"] == 1
    _tick(_ext_snap(AAA=50.0), minute=0, window="post")
    assert nhnl_live._state["session_key"] == "2026-08-25:post"
    assert nhnl_live._state["syms"]["AAA"]["nh"] == 0


# ── Pre / post market (ext-price tracking) ──────────────────────────────────────

def test_premarket_new_high_from_ext_price():
    _tick(_ext_snap(AAA=10.0), minute=0, window="pre")
    _tick(_ext_snap(AAA=10.5), minute=1, window="pre")
    _tick(_ext_snap(AAA=11.0), minute=2, window="pre")
    out = nhnl_live.get_live()
    assert [e["count"] for e in out["highs"]] == [2]
    assert out["highs"][0]["sym"] == "AAA"


def test_postmarket_new_low_from_ext_price():
    _tick(_ext_snap(AAA=10.0), minute=0, window="post")
    _tick(_ext_snap(AAA=9.5), minute=1, window="post")
    out = nhnl_live.get_live()
    assert [e["count"] for e in out["lows"]] == [1]


# ── ETF exclusion (stocks only) ─────────────────────────────────────────────────

def test_etfs_are_excluded(monkeypatch):
    monkeypatch.setattr(nhnl_live, "_etf_set", lambda: {"BBB"})   # BBB is an ETF
    _tick(_snap(AAA=(100.0, 98.0, 99.0), BBB=(50.0, 48.0, 49.0)), minute=0)   # seed
    _tick(_snap(AAA=(101.0, 98.0, 101.0), BBB=(51.0, 48.0, 51.0)), minute=1)  # both new HOD
    out = nhnl_live.get_live()
    assert {e["sym"] for e in out["highs"]} == {"AAA"}   # ETF never tracked
    assert "BBB" not in nhnl_live._state["syms"]
    assert out["highs_total"] == 1


# ── Scope: sector / industry / theme filtering ─────────────────────────────────

def test_scope_drill_filters_stocks_and_lists_categories(monkeypatch):
    monkeypatch.setattr(nhnl_live, "_group_map", lambda: {
        "AAA": {"sector": "Tech", "industry": "Software", "theme": "AI"},
        "BBB": {"sector": "Energy", "industry": "Oil", "theme": None},
    })
    _tick(_snap(AAA=(100.0, 98.0, 99.0), BBB=(50.0, 48.0, 49.0)), minute=0)   # seed
    _tick(_snap(AAA=(101.0, 98.0, 101.0), BBB=(51.0, 48.0, 51.0)), minute=1)  # both new HOD

    # Grouped by sector, no value → categories per sector (for the drill dropdown).
    out = nhnl_live.get_live(group="sector")
    assert out["group"] == "sector"
    assert out["categories"] == {"Tech": 1, "Energy": 1}

    # Drill into one sector → only THAT sector's stocks.
    out2 = nhnl_live.get_live(group="sector", value="Tech")
    assert {e["sym"] for e in out2["highs"]} == {"AAA"}

    # A symbol with no theme falls in the "—" bucket.
    out3 = nhnl_live.get_live(group="theme")
    assert out3["categories"] == {"AI": 1, "—": 1}


def test_sector_overview_shows_the_sector_etfs():
    nhnl_live._prov_to_app = {"XLK": "XLK", "AAA": "AAA"}   # XLK is a SPDR sector ETF
    _tick(_snap(XLK=(100.0, 98.0, 99.0), AAA=(50.0, 48.0, 49.0)), minute=0)   # seed
    _tick(_snap(XLK=(101.0, 98.0, 101.0), AAA=(50.0, 48.0, 49.0)), minute=1)  # XLK new high
    out = nhnl_live.get_live(group="sector")   # overview → the sector ETFs themselves
    # XLK maps to the "Technology" sector; the row shows the sector name + XLK's count,
    # and its `pick` (the chartable symbol) is XLK.
    assert [(e["sym"], e["pick"], e["count"]) for e in out["highs"]] == [("Technology", "XLK", 1)]
    assert out["highs"][0].get("group") is True


def test_theme_index_overview_counts_theme_new_highs(monkeypatch):
    monkeypatch.setattr(nhnl_live, "_theme_holdings", lambda: {"AI Theme": ["AAA", "BBB"]})

    def _tsnap(**rows):
        return {s: {"last_price": last, "prev_close": prev, "day_high": last, "day_low": last}
                for s, (last, prev) in rows.items()}

    nhnl_live._tick_once(_tsnap(AAA=(100.0, 100.0), BBB=(50.0, 50.0)), "rth", "2026-08-25", _now(0))  # seed, val 0
    nhnl_live._tick_once(_tsnap(AAA=(102.0, 100.0), BBB=(51.0, 50.0)), "rth", "2026-08-25", _now(1))  # both up → theme index high
    out = nhnl_live.get_live(group="theme")
    assert [(e["sym"], e["count"]) for e in out["highs"]] == [("AI Theme", 1)]
    assert out["highs"][0]["price"] is not None   # index level (100-based)


# ── Tradability gate ────────────────────────────────────────────────────────────

def test_untradable_symbol_advances_mark_but_never_counts(monkeypatch):
    monkeypatch.setattr(nhnl_live, "_is_tradable", lambda sym, row: sym != "BBB")
    _tick(_snap(AAA=(10.0, 9.0, 9.5), BBB=(1.0, 0.5, 0.8)), minute=0)
    _tick(_snap(AAA=(11.0, 9.0, 11.0), BBB=(2.0, 0.5, 2.0)), minute=1)
    out = nhnl_live.get_live()
    assert {e["sym"] for e in out["highs"]} == {"AAA"}
    assert nhnl_live._state["syms"]["BBB"]["nh"] == 0
    assert nhnl_live._state["syms"]["BBB"]["hod"] == 2.0


# ── get_live filters ───────────────────────────────────────────────────────────

def test_get_live_min_price_and_min_count_filters():
    _tick(_snap(AAA=(100.0, 98.0, 99.0), BBB=(5.0, 4.0, 4.5)), minute=0)
    _tick(_snap(AAA=(101.0, 98.0, 101.0), BBB=(6.0, 4.0, 6.0)), minute=1)   # both #1
    _tick(_snap(AAA=(102.0, 98.0, 102.0), BBB=(7.0, 4.0, 7.0)), minute=2)   # both #2
    assert {e["sym"] for e in nhnl_live.get_live(min_price=50.0)["highs"]} == {"AAA"}
    hi2 = nhnl_live.get_live(min_count=2)["highs"]
    assert all(e["count"] >= 2 for e in hi2) and len(hi2) == 2


def test_get_live_limit_caps_each_side():
    _tick(_snap(AAA=(100.0, 98.0, 99.0)), minute=0)
    for m in range(1, 6):
        _tick(_snap(AAA=(100.0 + m, 98.0, 100.0 + m)), minute=m)   # AAA: 5 new highs
    out = nhnl_live.get_live(limit=3)
    assert [e["count"] for e in out["highs"]] == [5]   # ONE deduped row (count 5)
