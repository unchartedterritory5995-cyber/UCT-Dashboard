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
    # Print-exact globals — reset so one test's tape state can't leak into the next.
    nhnl_live._print_syms = set()
    nhnl_live._print_counts.clear()
    nhnl_live._print_listener_on = False
    nhnl_live._print_events_total = 0
    # H/L Pulse time series.
    with nhnl_live._lock:
        nhnl_live._state["series"] = nhnl_live.deque(maxlen=nhnl_live._SERIES_MAX)
    nhnl_live._cum_buf.clear()
    nhnl_live._rate_ema = {"hi": None, "lo": None}
    nhnl_live._rt_hi = 0
    nhnl_live._rt_lo = 0
    nhnl_live._last_sample = 0.0
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


def test_sector_overview_ranks_member_stock_breadth(monkeypatch):
    # An ETF's own HOD ratchets are too sparse to fill a panel, so the sector
    # overview is BREADTH: how many member STOCKS made a new high per sector, with
    # the sector's SPDR ETF carried as the chartable proxy.
    monkeypatch.setattr(nhnl_live, "_group_map", lambda: {
        "AAA": {"sector": "Technology", "industry": "Software", "theme": None},
        "BBB": {"sector": "Technology", "industry": "Hardware", "theme": None},
        "CCC": {"sector": "Energy", "industry": "Oil", "theme": None},
    })
    nhnl_live._prov_to_app = {"AAA": "AAA", "BBB": "BBB", "CCC": "CCC"}
    _tick(_snap(AAA=(100.0, 98.0, 99.0), BBB=(50.0, 48.0, 49.0), CCC=(20.0, 18.0, 19.0)), minute=0)
    _tick(_snap(AAA=(101.0, 98.0, 101.0), BBB=(51.0, 48.0, 51.0), CCC=(21.0, 18.0, 21.0)), minute=1)
    rows = {e["sym"]: e for e in nhnl_live.get_live(group="sector")["highs"]}
    assert rows["Technology"]["count"] == 2      # AAA + BBB
    assert rows["Energy"]["count"] == 1
    assert rows["Technology"]["pick"] == "XLK"   # the sector's SPDR ETF, chartable
    assert rows["Technology"].get("group") is True
    assert rows["Technology"]["price"] is None   # group rows carry no price


def test_theme_overview_breadth_counts_multi_theme_membership(monkeypatch):
    # A stock is in MANY themes, so theme breadth counts it toward each, and a theme
    # drill filters by full membership (not the single "primary theme").
    monkeypatch.setattr(nhnl_live, "_theme_holdings",
                        lambda: {"AI Theme": ["AAA", "BBB"], "Cloud": ["BBB"]})
    _tick(_snap(AAA=(100.0, 98.0, 99.0), BBB=(50.0, 48.0, 49.0)), minute=0)   # seed
    _tick(_snap(AAA=(101.0, 98.0, 101.0), BBB=(51.0, 48.0, 51.0)), minute=1)  # both new HOD
    rows = {e["sym"]: e for e in nhnl_live.get_live(group="theme")["highs"]}
    assert rows["AI Theme"]["count"] == 2        # AAA + BBB
    assert rows["Cloud"]["count"] == 1           # BBB (also in Cloud)
    assert rows["AI Theme"].get("group") is True
    # Drilling a theme filters by FULL membership.
    out2 = nhnl_live.get_live(group="theme", value="Cloud")
    assert {e["sym"] for e in out2["highs"]} == {"BBB"}


# ── % change column ─────────────────────────────────────────────────────────────

def test_rows_carry_pct_change_vs_prior_close():
    snap0 = {"AAA": {"day_high": 100.0, "day_low": 98.0, "last_price": 99.0, "prev_close": 90.0}}
    snap1 = {"AAA": {"day_high": 101.0, "day_low": 98.0, "last_price": 101.0, "prev_close": 90.0}}
    nhnl_live._tick_once(snap0, "rth", "2026-08-25", _now(0))   # seed (stores prev_close)
    nhnl_live._tick_once(snap1, "rth", "2026-08-25", _now(1))   # new HOD
    row = next(e for e in nhnl_live.get_live()["highs"] if e["sym"] == "AAA")
    assert row["price"] == 101.0
    assert row["pct"] == round((101.0 - 90.0) / 90.0 * 100, 2)   # +12.22% vs prior close


# ── H/L Pulse time series ───────────────────────────────────────────────────────

def test_series_reports_alerts_per_second(monkeypatch):
    monkeypatch.setenv("NHNL_SERIES_WINDOW_SECS", "60")
    monkeypatch.setattr(nhnl_live, "_RATE_EMA_ALPHA", 1.0)   # isolate the raw rate (no EMA)
    t0 = datetime(2026, 8, 25, 10, 0, 0)
    t1 = datetime(2026, 8, 25, 10, 0, 10)   # 10 seconds later
    nhnl_live._rt_hi = 0
    nhnl_live._sample_series(t0)             # first buffer point → rate 0
    nhnl_live._rt_hi = 2                      # 2 real-time new-high events (off the tape)
    nhnl_live._sample_series(t1)             # 2 events over 10s → 0.2 alerts/sec
    assert nhnl_live.get_series()["series"][-1]["hi"] == 0.2


# ── Persistence across deploys ──────────────────────────────────────────────────

def test_persist_restores_counts_for_the_same_session(monkeypatch, tmp_path):
    monkeypatch.setenv("NHNL_STATE_PATH", str(tmp_path / "nhnl_state.json"))
    now = nhnl_live._now_et()
    key = f"{now.strftime('%Y-%m-%d')}:{nhnl_live._active_window(now)}"
    with nhnl_live._lock:
        nhnl_live._state["session_key"] = key
        nhnl_live._state["date"] = now.strftime("%Y-%m-%d")
        nhnl_live._state["window"] = nhnl_live._active_window(now)
        nhnl_live._state["syms"] = {"AAA": {"hod": 101.0, "lod": 98.0, "nh": 7, "nl": 0,
                                            "last": 101.0, "prev": 90.0, "hi_ts": None, "lo_ts": None}}
    nhnl_live._persist_state()
    with nhnl_live._lock:                       # simulate a deploy wiping in-memory state
        nhnl_live._state["syms"] = {}
        nhnl_live._state["session_key"] = None
    nhnl_live._load_state()
    assert nhnl_live._state["syms"]["AAA"]["nh"] == 7   # count survived the "deploy"


def test_persist_ignored_when_session_is_stale(monkeypatch, tmp_path):
    import json as _json
    p = tmp_path / "nhnl_state.json"
    p.write_text(_json.dumps({"session_key": "1999-01-01:rth", "date": "1999-01-01",
                              "window": "rth", "ticks": 5, "syms": {"AAA": {"nh": 9}}}))
    monkeypatch.setenv("NHNL_STATE_PATH", str(p))
    with nhnl_live._lock:
        nhnl_live._state["syms"] = {}
    nhnl_live._load_state()
    assert nhnl_live._state["syms"] == {}       # different day/window → not restored


# ── Print-exact counting (bounded live trade tape) ──────────────────────────────

def test_print_exact_counts_every_ratchet_and_poll_does_not_double(monkeypatch):
    import api.services.bar_stream as bs
    monkeypatch.setattr(nhnl_live, "_print_exact", lambda: True)
    added = []
    monkeypatch.setattr(bs, "subscribe_symbols", lambda syms, owner="bars": added.append((set(syms), owner)))
    monkeypatch.setattr(bs, "unsubscribe_symbols", lambda syms, owner="bars": None)
    monkeypatch.setattr(bs, "add_trade_listener", lambda fn: None)

    # 1) poll sees AAA's FIRST new high (nh 0→1).
    _tick(_snap(AAA=(100.0, 98.0, 99.0)), minute=0)     # seed
    _tick(_snap(AAA=(101.0, 98.0, 101.0)), minute=1)    # nh=1 via poll
    # 2) manage → subscribes AAA to the T. tap, seeded from the poll mark.
    nhnl_live._manage_print_set()
    assert any("AAA" in s and o == "nhnl" for s, o in added)
    assert "AAA" in nhnl_live._print_syms
    assert nhnl_live._print_counts["AAA"]["nh"] == 1

    # 3) three prints each ratchet the HOD → every one counts (the poll would show +1).
    for px in (101.5, 102.0, 102.5):
        nhnl_live._on_trade_print("AAA", {"p": px, "s": 100, "t": 1})
    nhnl_live._manage_print_set()   # fold print counts into served state
    aaa = next(e for e in nhnl_live.get_live()["highs"] if e["sym"] == "AAA")
    assert aaa["count"] == 4        # 1 (poll) + 3 (prints)

    # 4) the poll no longer double-counts a print-owned name.
    _tick(_snap(AAA=(103.0, 98.0, 103.0)), minute=2)    # tick_once: AAA skipped
    nhnl_live._manage_print_set()
    aaa2 = next(e for e in nhnl_live.get_live()["highs"] if e["sym"] == "AAA")
    assert aaa2["count"] == 4       # unchanged by the poll


def test_print_exact_disabled_clears_subscriptions(monkeypatch):
    import api.services.bar_stream as bs
    dropped = []
    monkeypatch.setattr(bs, "subscribe_symbols", lambda syms, owner="bars": None)
    monkeypatch.setattr(bs, "unsubscribe_symbols", lambda syms, owner="bars": dropped.append((set(syms), owner)))
    monkeypatch.setattr(bs, "add_trade_listener", lambda fn: None)
    # pretend a name is print-subscribed, then the flag flips off.
    nhnl_live._print_syms = {"AAA"}
    nhnl_live._print_counts["AAA"] = {"app": "AAA", "hod": 1.0, "lod": 1.0,
                                      "nh": 3, "nl": 0, "last": 1.0, "hi_ms": None, "lo_ms": None}
    monkeypatch.setattr(nhnl_live, "_print_exact", lambda: False)
    nhnl_live._manage_print_set()
    assert nhnl_live._print_syms == set() and not nhnl_live._print_counts
    assert any("AAA" in s and o == "nhnl" for s, o in dropped)


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
