"""THE 1-MINUTE LANE (`api/index_bars.py`, 2026-11-22): SPX / NDX 1m served with FMP's settled 1min history before
Yahoo's 7 sessions, from its own store, behind the 5-minute lane's seam, run and ETF-fill rules. Fred RS on a 1m chart
drew 7 sessions of RS line against months of the stock's own 1m bars. Every price below is SYNTHETIC.

Railed here:
  L1  the 1-minute lane keeps its own store, asks FMP's 1min, and a session is complete at 390 bars (210 on a half day);
  L2  a page FMP cuts at 1,170 rows (3 sessions, measured): the unreached session is not recorded and the next pass
      completes it;
  L3  tf=1 joins the run before Yahoo's first day behind the seam; the 5-minute lane's store is never read for it,
      and the 5 / 30 grids never read the 1-minute store;
  L4  the lane holds DEEP_1M_DAYS: nothing older is asked;
  L5  the pass runs both lanes, each with its own call budget, and kicks a refresh for tf=1 when its store changed;
  L6  the kill switch serves Yahoo only on tf=1;
  L7  the ETF fill in the 1-minute lane reads the ETF's 1m bars and allows the same span of time (300 slots).
"""
import datetime as dt
from types import SimpleNamespace

import pytest

from api import index_bars
from api.services import fmp_client
from api.services import intraday_gap_audit as gap
from tests.test_index_bars_deep_history import (  # noqa: F401 - the sandbox applies here too
    DEC1, DEC2, DEC3, DEC4, DEC5, ET, NOV28, NOW, sandbox)


def _bars1(d):
    base = 6000.0 + (d - DEC1).days * 10
    return [{"t": t, "o": base + i * 0.1, "h": base + i * 0.1 + 0.5, "l": base + i * 0.1 - 0.5,
             "c": base + i * 0.1 + 0.05, "v": 10} for i, t in enumerate(gap.expected_rth_buckets("1", d))]


@pytest.fixture
def fmp1(monkeypatch):
    """A fake `get_index_intraday` honouring the interval: 1min rows on the 1m grid, newest first, cut at `cap`."""
    rec = {"calls": [], "cap": 1170}

    def fake(sym, interval, from_date, to_date, *, timeout=None):
        rec["calls"].append((sym, interval, from_date, to_date))
        tf = {"1min": "1", "5min": "5"}[interval]
        lo, hi = dt.date.fromisoformat(from_date), dt.date.fromisoformat(to_date)
        rows, d = [], hi
        while d >= lo:
            if gap._is_session(d):
                src = _bars1(d) if tf == "1" else [
                    {"t": t, "o": 6000.0, "h": 6001.0, "l": 5999.0, "c": 6000.5, "v": 1}
                    for t in gap.expected_rth_buckets("5", d)]
                for b in reversed(src):
                    rows.append({"date": dt.datetime.fromtimestamp(b["t"], ET).strftime("%Y-%m-%d %H:%M:%S"),
                                 "open": b["o"], "high": b["h"], "low": b["l"], "close": b["c"], "volume": b["v"]})
            d -= dt.timedelta(days=1)
        if rec["cap"]:
            rows = rows[:rec["cap"]]
        if not rows:
            raise fmp_client._ERR.not_found("FMP: no data for this request")
        return SimpleNamespace(value=rows, degraded=None)

    monkeypatch.setattr(fmp_client, "get_index_intraday", fake)
    monkeypatch.setattr(index_bars, "DEEP_1M_DAYS", 10)
    return rec


def _fill1(now=NOW):
    for _ in range(30):
        if not index_bars.deep_step("^GSPC", now=now, max_fetches=50, lane="1")["asked"]:
            return
    raise AssertionError("the 1-minute store never completed")


def _store1():
    return index_bars._load_deep(index_bars._deep_path("^GSPC", "1"))["days"]


# ── L1 ────────────────────────────────────────────────────────────────────────────────────────────────
def test_the_1m_lane_keeps_its_own_store_asks_1min_and_a_session_is_390_bars(fmp1):
    _fill1()
    assert index_bars._deep_path("^GSPC", "1").endswith("GSPC_1min.deep.json")
    assert index_bars._deep_path("^GSPC").endswith("GSPC_5min.deep.json"), "the 5-minute store keeps its name"
    assert {c[1] for c in fmp1["calls"]} == {"1min"}
    days = _store1()
    assert days[DEC4.isoformat()]["state"] == "complete" and len(days[DEC4.isoformat()]["bars"]) == 390
    assert days[NOV28.isoformat()]["state"] == "complete" and len(days[NOV28.isoformat()]["bars"]) == 210
    import os
    assert not os.path.exists(index_bars._deep_path("^GSPC")), "the 5-minute store is never written by the 1m lane"


# ── L2 ────────────────────────────────────────────────────────────────────────────────────────────────
def test_a_page_cut_at_three_sessions_leaves_the_fourth_due_and_the_next_pass_completes_it(fmp1):
    st = index_bars.deep_step("^GSPC", now=NOW, max_fetches=1, lane="1")
    days = _store1()
    assert st["asked"] == 1 and fmp1["calls"][0][2:] == ((DEC4 - dt.timedelta(days=3)).isoformat(), DEC4.isoformat())
    assert [d for d in (DEC4, DEC3, DEC2) if days[d.isoformat()]["state"] == "complete"] == [DEC4, DEC3, DEC2]
    assert DEC1.isoformat() not in days, "1,170 rows reach 3 sessions: the 4th is not recorded"
    index_bars.deep_step("^GSPC", now=NOW, max_fetches=1, lane="1")
    assert _store1()[DEC1.isoformat()]["state"] == "complete"


# ── L3 ────────────────────────────────────────────────────────────────────────────────────────────────
def test_tf1_joins_the_1m_run_and_the_grids_never_cross_stores(fmp1, monkeypatch):
    _fill1()
    yahoo = _bars1(DEC4) + _bars1(DEC5)[:120]
    read = []
    real = index_bars._load_deep
    monkeypatch.setattr(index_bars, "_load_deep", lambda path: read.append(path) or real(path))
    out, rec = index_bars._merge_deep("SPX", "1", list(yahoo))
    assert rec["joined"] and rec["seam"]["compared"] == 390 and rec["seam"]["equal"] == 390, rec["seam"]
    assert rec["sessions"] >= 4 and out[len(out) - len(yahoo):] == yahoo
    held = [dt.date.fromisoformat(x) for x in _store1() if dt.date.fromisoformat(rec["from"]) <= dt.date.fromisoformat(x) < DEC4]
    assert rec["sessions"] == len(held)
    assert len(out) - len(yahoo) == sum(len(gap.expected_rth_buckets("1", d)) for d in held)
    assert read and all(p.endswith("GSPC_1min.deep.json") for p in read)
    read.clear()
    five = [b for b in index_bars._roll_into_buckets("5", DEC4, {b["t"]: b for b in _bars1(DEC4)}, 60).values()]
    out5, rec5 = index_bars._merge_deep("SPX", "5", five)
    assert rec5 is None and out5 == five, "no 5-minute store: the 5 grid serves Yahoo, never the 1-minute store"
    assert read == []


# ── L4 ────────────────────────────────────────────────────────────────────────────────────────────────
def test_the_lane_holds_deep_1m_days_and_asks_nothing_older(fmp1):
    _fill1()
    start = index_bars._et_date(NOW) - dt.timedelta(days=index_bars.DEEP_1M_DAYS)
    assert min(dt.date.fromisoformat(x) for x in _store1()) >= start
    assert all(dt.date.fromisoformat(c[2]) >= start - dt.timedelta(days=index_bars.DEEP_1M_PAGE_DAYS)
               for c in fmp1["calls"])


# ── L5 ────────────────────────────────────────────────────────────────────────────────────────────────
def test_the_pass_runs_both_lanes_each_with_its_own_budget_and_kicks_tf1(fmp1, monkeypatch):
    kicked = []
    monkeypatch.setattr(index_bars, "_kick_bg_refresh", lambda sym, tf: kicked.append((sym, tf)))
    monkeypatch.setattr(index_bars, "_deep_turn", lambda: __import__("contextlib").nullcontext())
    monkeypatch.setattr(index_bars, "DEEP_MAX_FETCHES", 2)
    passes = index_bars.deep_backfill_pass(now=NOW)
    asked = {(p["sym"], p["lane"]): p["asked"] for p in passes}
    assert sum(v for (s, l), v in asked.items() if l == "5") == 2
    assert sum(v for (s, l), v in asked.items() if l == "1") == 2, "the 1-minute lane has its own budget"
    assert ("SPX", "1") in kicked and ("SPX", "5") in kicked


# ── L6 ────────────────────────────────────────────────────────────────────────────────────────────────
def test_the_kill_switch_serves_yahoo_only_on_tf1(fmp1, monkeypatch):
    _fill1()
    monkeypatch.setenv("INDEX_INTRADAY_DEEP_ENABLED", "0")
    yahoo = _bars1(DEC4)
    assert index_bars._merge_deep("SPX", "1", list(yahoo)) == (yahoo, None)


# ── L7 ────────────────────────────────────────────────────────────────────────────────────────────────
def test_the_1m_fill_reads_the_etfs_1m_bars_and_allows_the_same_span(monkeypatch):
    import json
    import sys
    import types
    asked = []

    class R:
        body = json.dumps({"bars": [dict(b, o=b["o"] / 10, h=b["h"] / 10, l=b["l"] / 10, c=b["c"] / 10)
                                    for b in _bars1(DEC2)]}).encode()

    fake = types.ModuleType("api.routers.bars")
    fake.serve_bars = lambda *a, **k: asked.append((a, k)) or R()
    monkeypatch.setitem(sys.modules, "api.routers.bars", fake)
    import api.routers as routers
    monkeypatch.setattr(routers, "bars", fake, raising=False)
    pb = index_bars._proxy_session_bars("SPY", DEC2, "1")
    assert asked == [(("SPY", "1"), {"bars": 1000, "to": DEC2.isoformat(), "warm": 1})]
    exp = gap.expected_rth_buckets("1", DEC2)
    held = {b["t"]: b for b in _bars1(DEC2)}
    span = index_bars.DEEP_FILL_MAX_SLOTS * 5
    have = {t: b for t, b in held.items() if not (60 <= exp.index(t) < 60 + span)}
    f = index_bars._fill_session(DEC2, have, pb, "1")
    assert f["state"] == "filled" and f["slots"] == span
    assert {b["t"]: b["c"] for b in f["bars"]} == {t: round(held[t]["c"], 2) for t in exp[60:60 + span]}
    have = {t: b for t, b in held.items() if not (60 <= exp.index(t) < 61 + span)}
    assert index_bars._fill_session(DEC2, have, pb, "1")["state"] == "refused"
