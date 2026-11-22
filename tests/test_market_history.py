"""MKTH, market history (api/services/market_history_calc.py, api/services/market_history.py,
api/routers/market_history.py). Every series, price and symbol here is INVENTED.

  * the one definition, on invented series: a decline of exactly 10% (and 9.99%), exactly 20%, a
    double bottom, a rebound short of the peak, a recovery that never comes, a gap day (a one-session
    plunge, and a session the store does not hold), equal record closes, a regain at exactly the peak;
  * the rally after the low (calendar months, first session on or after, null when not reached);
  * the leaders (closes at both dates only, the top list and its order, the index difference, the
    sector medians, too few stocks, a suspect jump inside the window);
  * the reads: the index store's memory copy then its disk snapshot, NEVER a provider call; an
    unsettled row for today dropped;
  * the held answer: one background build, never on the request, the first stage first, a rebuild
    once each evening, the disk copy, failures that never read as "computing" for ever;
  * the route: one paid GET, 401 / 402, its own gate, a plain def, mounted.
"""
from __future__ import annotations

import json
import pathlib
import threading
import time
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import market_history as route
from api.services import market_history as mh
from api.services import market_history_calc as C

ROOT = pathlib.Path(__file__).resolve().parents[1]
FREE_USER = {"id": "mkh-free", "email": "free@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "mkh-paid", "email": "paid@example.test", "role": "member", "plan": "pro"}


def weekdays(start: str, n: int) -> list[str]:
    d, out = date.fromisoformat(start), []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def series(values, start="2031-01-06") -> list[tuple[str, float]]:
    return list(zip(weekdays(start, len(values)), [float(v) for v in values]))


def series_ending(values, end="2031-06-02") -> list[tuple[str, float]]:
    d, days = date.fromisoformat(end), []
    while len(days) < len(values):
        if d.weekday() < 5:
            days.append(d.isoformat())
        d -= timedelta(days=1)
    return list(zip(reversed(days), [float(v) for v in values]))


@pytest.fixture(autouse=True)
def _fresh(monkeypatch, tmp_path):
    mh.reset_for_tests()
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(mh, "YIELD_S", 0.0)
    monkeypatch.setattr(mh, "YIELD_BUSY_S", 0.0)
    yield
    mh.reset_for_tests()


# ── the one definition ─────────────────────────────────────────────────────────────────────────

def test_the_constants_are_the_stated_definition():
    assert (C.CORRECTION_MIN, C.BEAR_MIN) == (0.10, 0.20)
    assert C.RALLY_MONTHS == (1, 3, 6, 12)
    assert (C.LEADER_SESSIONS, C.LEADERS_TOP) == (63, 25)
    assert C.SURVIVORSHIP_NOTE == ("From stocks that trade today: companies later delisted or acquired are not in "
                                   "UCT's price history, so this list can leave out some of that rally's leaders.")


def test_the_depth_is_a_difference_over_the_peak_and_the_line_is_inclusive():
    # two defences, each pinned on its own: the depth of an exact 10% is exactly 0.1 ...
    assert C.depth_of(3000.0, 2700.0) == 0.1 and C.depth_of(500.0, 400.0) == 0.2
    # ... and the line includes a decline exactly on it, and binary rounding just under it, never 9.99%
    assert C.qualifies(0.1) and C.qualifies(0.1 - 1e-12) and not C.qualifies(0.0999)
    assert C.qualifies(0.2, C.BEAR_MIN) and not C.qualifies(0.1999, C.BEAR_MIN)
    assert C.kind_of(0.2) == "bear" and C.kind_of(0.1999) == "correction"


def test_a_decline_of_exactly_ten_percent_counts_and_one_just_short_does_not():
    # the trap: 1 - 2700/3000 is 0.09999999999999998 in binary, so a ratio would miss it
    assert 1 - 2700.0 / 3000.0 < 0.10
    exact = C.describe_episodes(series([3000, 2900, 2700, 2800, 3000, 3010]), "IDX")
    assert len(exact) == 1
    ep = exact[0]
    assert ep["kind"] == "correction" and ep["depth_pct"] == -10.0
    assert ep["peak"] == {"date": weekdays("2031-01-06", 1)[0], "close": 3000.0}
    assert ep["trough"]["close"] == 2700.0 and ep["sessions_down"] == 2
    assert C.describe_episodes(series([3000, 2900, 2700.3, 2800, 3000]), "IDX") == []      # 9.99%


def test_exactly_twenty_percent_is_a_bear_market_and_just_short_is_a_correction():
    bear = C.describe_episodes(series([500, 450, 400, 460, 500]), "IDX")
    assert [e["kind"] for e in bear] == ["bear"] and bear[0]["depth_pct"] == -20.0
    corr = C.describe_episodes(series([500, 450, 400.05, 460, 500]), "IDX")
    assert [e["kind"] for e in corr] == ["correction"]


def test_a_double_bottom_is_one_decline_and_its_trough_is_the_lower_low():
    vals = [100, 92, 85, 95, 84, 90, 101]
    eps = C.find_episodes(series(vals))
    assert len(eps) == 1
    assert eps[0] == {"peak_i": 0, "trough_i": 4, "recover_i": 6}
    # two EQUAL lows: the first one is the trough
    eq = C.find_episodes(series([100, 85, 95, 85, 101]))
    assert eq == [{"peak_i": 0, "trough_i": 1, "recover_i": 4}]


def test_a_rebound_that_falls_short_of_the_peak_is_not_a_new_peak():
    # 100 -> 88 (12%) -> 99 (short of 100) -> 80 -> 100: one decline of 20%, never two
    eps = C.describe_episodes(series([100, 88, 99, 80, 100]), "IDX")
    assert len(eps) == 1 and eps[0]["kind"] == "bear" and eps[0]["trough"]["close"] == 80.0
    assert eps[0]["sessions_to_recover"] == 1


def test_a_recovery_that_never_comes_is_ongoing_with_not_yet():
    eps = C.describe_episodes(series([200, 210, 180, 170, 175, 190]), "IDX")
    assert len(eps) == 1
    ep = eps[0]
    assert ep["ongoing"] is True and ep["recovered"] is None and ep["sessions_to_recover"] is None
    assert ep["peak"]["close"] == 210.0 and ep["trough"]["close"] == 170.0
    assert ep["below_peak_now_pct"] == -9.52          # 190 against 210
    assert ep["depth_pct"] == -19.05


def test_a_gap_day_one_session_plunge_and_a_session_the_store_does_not_hold():
    plunge = C.describe_episodes(series([100, 101, 88, 95, 102]), "IDX")
    assert len(plunge) == 1 and plunge[0]["sessions_down"] == 1 and plunge[0]["depth_pct"] == -12.87
    # a missing day: sessions are the closes the store holds, so the hole is not counted
    full = series([100, 95, 89, 92, 101])
    holed = [full[0], full[1], full[2], full[4]]              # the day before the regain is missing
    a = C.describe_episodes(full, "IDX")[0]
    b = C.describe_episodes(holed, "IDX")[0]
    assert (a["sessions_down"], a["sessions_to_recover"]) == (2, 2)
    assert (b["sessions_down"], b["sessions_to_recover"]) == (2, 1)
    assert a["recovered"] == b["recovered"] == full[4][0]


def test_equal_record_closes_make_the_later_one_the_peak_and_a_regain_at_the_peak_counts():
    eps = C.describe_episodes(series([100, 100, 89, 100, 99]), "IDX")
    assert len(eps) == 1
    assert eps[0]["peak"]["date"] == weekdays("2031-01-06", 2)[1]
    assert eps[0]["recovered"] == weekdays("2031-01-06", 4)[3]          # closed exactly at 100
    assert eps[0]["peak_at_history_start"] is False
    first = C.describe_episodes(series([100, 85, 101]), "IDX")[0]
    assert first["peak_at_history_start"] is True


def test_episodes_come_newest_first_and_the_summary_counts_them():
    vals = [100, 89, 101, 75, 102, 91, 103, 70, 80]
    eps = C.describe_episodes(series(vals), "IDX")
    assert [e["kind"] for e in eps] == ["bear", "correction", "bear", "correction"]
    assert eps[0]["ongoing"] and not any(e["ongoing"] for e in eps[1:])
    s = C.summarize(eps, "2031-01-06")
    assert (s["corrections"], s["bear_markets"], s["ongoing"], s["recovered"]) == (2, 2, 1, 3)
    assert s["median_depth_pct"] == -18.37                       # the middle two of -32.04, -25.74, -11.0, -10.78
    assert s["median_recovery_sessions"] == 1
    assert C.summarize([], None) == {"since": None, "corrections": 0, "bear_markets": 0, "ongoing": 0,
                                     "recovered": 0, "median_depth_pct": None, "median_recovery_sessions": None}


def test_clean_closes_keeps_positive_finite_closes_one_per_date():
    rows = [("2031-01-07", 5), ("2031-01-06", "4"), ("2031-01-07", 6), ("bad", 3), ("2031-01-08", 0),
            ("2031-01-09", float("nan")), ("2031-01-10", None), (None,), ("2031-01-13", float("inf"))]
    assert C.clean_closes(rows) == [("2031-01-06", 4.0), ("2031-01-07", 6.0)]


# ── the rally after the low ────────────────────────────────────────────────────────────────────

def test_the_rally_is_measured_at_calendar_months_on_the_first_session_on_or_after():
    closes = series([100 + i * 0.5 for i in range(300)], start="2031-01-31")   # starts on a Friday
    out = C.rally_after(closes, 0)
    assert [r["months"] for r in out] == [1, 3, 6, 12]
    # Jan 31 + 1 month is Feb 28 (clamped), a Friday in 2031: that day itself
    assert out[0]["target"] == "2031-02-28" and out[0]["date"] == "2031-02-28"
    # Jan 31 + 3 months is Apr 30 (a Wednesday)
    assert out[1]["date"] == "2031-04-30"
    i = [d for d, _ in closes].index(out[1]["date"])
    assert out[1]["return_pct"] == round((closes[i][1] / 100.0 - 1) * 100, 2)


def test_a_rally_window_the_store_has_not_reached_is_null_not_zero():
    out = C.rally_after(series([50, 52, 55, 60]), 0)
    assert all(r["date"] is None and r["return_pct"] is None for r in out)
    mixed = C.rally_after(series([50 + i for i in range(80)]), 0)
    assert mixed[0]["return_pct"] is not None and mixed[1]["return_pct"] is not None
    assert mixed[2]["return_pct"] is None and mixed[3]["return_pct"] is None


def test_a_saturday_target_rolls_forward_to_the_next_held_session():
    closes = series(list(range(10, 60)), start="2031-03-05")      # Wednesday Mar 5 2031
    out = C.rally_after(closes, 0, months=(1,))
    assert out[0]["target"] == "2031-04-05" and out[0]["date"] == "2031-04-07"     # Saturday Apr 5 -> Monday Apr 7
    i = [d for d, _ in closes].index("2031-04-07")
    assert out[0]["return_pct"] == round((closes[i][1] / 10.0 - 1) * 100, 2)
    closes3 = [c for c in series(list(range(10, 60)), start="2031-03-03") if c[0] != "2031-04-03"]
    out3 = C.rally_after(closes3, 0, months=(1,))
    assert out3[0]["target"] == "2031-04-03" and out3[0]["date"] == "2031-04-04"   # the held session after a hole


# ── the leaders ────────────────────────────────────────────────────────────────────────────────

def test_the_leader_window_is_63_index_sessions_and_not_yet_before_that():
    closes = series([100 + i for i in range(70)])
    w = C.leader_window(closes, closes[2][0])
    assert w["end"] == closes[65][0] and w["sessions_so_far"] == 63
    assert w["index_return_pct"] == round((closes[65][1] / closes[2][1] - 1) * 100, 2)
    late = C.leader_window(closes, closes[10][0])
    assert late == {"trough": closes[10][0], "end": None, "sessions_so_far": 59, "index_return_pct": None}
    assert C.leader_window(closes, "2030-01-01")["end"] is None


def _tally(n_stocks, trough="2031-03-03", end="2031-06-02", extra=None):
    t = C.WindowTally(trough, end)
    for i in range(n_stocks):
        t.add(f"S{i:03d}", {trough: 10.0, end: 10.0 + i * 0.1})
    for sym, closes, jumps in extra or []:
        t.add(sym, closes, jumps)
    return t


def test_only_stocks_with_closes_on_both_dates_are_ranked():
    t = C.WindowTally("2031-03-03", "2031-06-02")
    t.add("AAA", {"2031-03-03": 10.0, "2031-06-02": 15.0})
    t.add("BBB", {"2031-03-03": 10.0})                            # no close at the end
    t.add("CCC", {"2031-06-02": 30.0})                            # none at the trough
    t.add("DDD", {"2031-03-04": 10.0, "2031-06-02": 30.0})        # a day off is not the trough
    assert t.priced_at_trough == 2 and [r[1] for r in t.returns] == ["AAA"]


def test_the_top_list_is_ranked_with_sector_and_the_index_difference():
    t = _tally(140, extra=[("ZED", {"2031-03-03": 10.0, "2031-06-02": 40.0}, ()),
                           ("ABC", {"2031-03-03": 10.0, "2031-06-02": 40.0}, ())])
    sectors = {"ZED": "Invented Tech", "ABC": "Invented Tech", **{f"S{i:03d}": ("Invented Energy" if i % 2 else "Invented Tech") for i in range(140)}}
    out = t.result(12.5, sectors)
    assert out["state"] == "ok" and out["priced_both"] == 142 and len(out["top"]) == 25
    assert [r["sym"] for r in out["top"][:2]] == ["ABC", "ZED"]           # a tie goes A to Z
    assert out["top"][0] == {"sym": "ABC", "sector": "Invented Tech", "return_pct": 300.0, "vs_index_pct": 287.5, "check": False}
    rets = [r["return_pct"] for r in out["top"]]
    assert rets == sorted(rets, reverse=True)
    names = {s["sector"]: s for s in out["sectors"]}
    assert set(names) == {"Invented Tech", "Invented Energy"}
    assert names["Invented Tech"]["count"] == 72 and names["Invented Energy"]["count"] == 70
    assert out["sectors"][0]["median_pct"] >= out["sectors"][1]["median_pct"]
    no_idx = t.result(None, {})
    assert no_idx["top"][0]["vs_index_pct"] is None and no_idx["no_sector"] == 142 and no_idx["sectors"] == []


def test_too_few_stocks_priced_at_both_dates_is_thin_not_a_list():
    out = _tally(C.LEADERS_MIN_STOCKS - 1).result(5.0, {})
    assert out["state"] == "thin" and out["top"] == [] and out["priced_both"] == C.LEADERS_MIN_STOCKS - 1
    assert _tally(C.LEADERS_MIN_STOCKS).result(5.0, {})["state"] == "ok"


def test_a_suspect_one_day_jump_inside_the_window_is_flagged_and_one_outside_is_not():
    t = _tally(120, extra=[("JMP", {"2031-03-03": 1.0, "2031-06-02": 9.0}, ["2031-04-15"]),
                           ("OUT", {"2031-03-03": 1.0, "2031-06-02": 8.0}, ["2031-03-03", "2031-07-01"])])
    top = {r["sym"]: r for r in t.result(1.0, {})["top"]}
    assert top["JMP"]["check"] is True and top["OUT"]["check"] is False


# ── the reads ──────────────────────────────────────────────────────────────────────────────────

def _bars(closes):
    return [{"t": int(datetime(*map(int, d.split("-")), tzinfo=timezone.utc).timestamp()), "o": c, "h": c, "l": c, "c": c, "v": 0}
            for d, c in closes]


def test_the_index_is_read_from_memory_then_disk_and_never_from_a_provider(monkeypatch, tmp_path):
    from api import index_bars
    from api.services.cache import cache

    def boom(*_a, **_k):
        raise AssertionError("a provider call")
    for name in ("fetch_index_bars", "_fetch_full_series", "_fetch_fmp_daily", "_fetch_yf_daily", "_kick_bg_refresh", "_refresh"):
        monkeypatch.setattr(index_bars, name, boom)
    monkeypatch.setattr(index_bars, "_DISK_DIR", str(tmp_path / "idx"))
    cache.invalidate("idxbars_SPX_D")
    now = datetime(2031, 6, 2, 21, 0, tzinfo=mh.ET)
    assert mh.index_closes("SPX", now) == {"state": "not_held"}
    closes = series([10, 11, 12, 13])
    (tmp_path / "idx").mkdir()
    (tmp_path / "idx" / "SPX_D.json").write_text(json.dumps({"saved_at": 1.0, "series": _bars(closes)}), encoding="utf-8")
    got = mh.index_closes("SPX", now)
    assert got["state"] == "ok" and got["closes"] == closes and got["first"] == closes[0][0]
    mem = series([20, 21, 22], start="2031-02-03")
    cache.set("idxbars_SPX_D", {"saved_at": 2.0, "series": _bars(mem)}, ttl=60)
    try:
        assert mh.index_closes("SPX", now)["closes"] == mem
    finally:
        cache.invalidate("idxbars_SPX_D")


def test_the_index_store_still_names_what_this_reader_relies_on():
    src = (ROOT / "api" / "index_bars.py").read_text(encoding="utf-8")
    assert 'f"idxbars_{sym}_{tf}"' in src and "def _load_disk(sym: str, tf: str)" in src
    from api import index_bars
    assert index_bars.INDEX_MAP["SPX"][0] == "^GSPC" and index_bars.INDEX_MAP["NDX"][0] == "^NDX"
    assert "^IXIC" not in src                                   # no Nasdaq Composite: the answer says so
    assert index_bars.INDEX_DAILY_HISTORY_START == "1990-01-01"


def test_an_unsettled_row_for_today_is_dropped_and_a_settled_one_kept():
    closes = series([10, 11, 12], start="2026-11-18")            # Wed, Thu, Fri Nov 20 2026
    now = datetime(2026, 11, 20, 19, 0, tzinfo=mh.ET)
    close = datetime(2026, 11, 20, 16, 0, tzinfo=mh.ET).timestamp()
    assert mh._settled(closes, close + 60, now) == closes[:-1]
    assert mh._settled(closes, close + 31 * 60, now) == closes
    assert mh._settled(closes, close + 60, datetime(2026, 11, 21, 10, 0, tzinfo=mh.ET)) == closes   # a day later


def test_the_evening_key_is_the_newest_session_whose_evening_has_begun():
    def key(*a):
        return mh.evening_key(datetime(*a, tzinfo=mh.ET))
    assert mh.REBUILD_AT_ET == (20, 15)
    assert key(2026, 11, 20, 20, 14) == "2026-11-19"           # Friday before 20:15
    assert key(2026, 11, 20, 20, 15) == "2026-11-20"
    assert key(2026, 11, 21, 12, 0) == "2026-11-20"            # Saturday
    assert key(2026, 11, 23, 9, 30) == "2026-11-20"            # Monday morning
    assert key(2026, 11, 27, 10, 0) == "2026-11-25"            # the day after Thanksgiving, before 20:15
    assert key(2026, 11, 26, 22, 0) == "2026-11-25"            # Thanksgiving itself is not a session


def test_the_quiet_span_is_the_one_scan_period_keeps_whole_universe_work_to():
    from api.services import scan_period
    for at in [(2026, 11, 20, 6, 59), (2026, 11, 20, 7, 0), (2026, 11, 20, 12, 0), (2026, 11, 20, 20, 14),
               (2026, 11, 20, 20, 15), (2026, 11, 21, 12, 0), (2026, 11, 23, 23, 30)]:
        t = datetime(*at, tzinfo=mh.ET)
        assert mh.quiet(t) == scan_period._reuse_quiet_now(t), at
    assert mh.quiet(datetime(2026, 11, 20, 12, 0, tzinfo=mh.ET)) is False
    assert mh.quiet(datetime(2026, 11, 20, 21, 0, tzinfo=mh.ET)) is True


def test_the_universe_is_the_stock_list_less_the_funds():
    from api.services import cap_universe
    u = set(mh._universe())
    assert len(u) > 1000 and not (u & cap_universe.etf_symbols())
    assert u <= cap_universe.symbols()


# ── the held answer ────────────────────────────────────────────────────────────────────────────

NOW = datetime(2031, 6, 2, 21, 0, tzinfo=mh.ET)       # a Monday evening, after 20:15


def _install(monkeypatch, *, spx=None, ndx=None, stocks=None, sectors=None, gate=None):
    spx = spx if spx is not None else series_ending([100, 89, 101] + [101 + i for i in range(80)])
    held = {"SPX": spx, "NDX": ndx}

    def entry(sym):
        if not held.get(sym):
            return None
        return {"saved_at": 1e12, "series": _bars(held[sym])}
    monkeypatch.setattr(mh, "_index_entry", entry)
    monkeypatch.setattr(mh, "now_et", lambda: NOW)
    calls = []
    stocks = stocks if stocks is not None else {}

    def read(sym):
        calls.append(sym)
        if gate is not None:
            gate.wait(5)
        c = stocks.get(sym)
        return {"status": "ok", "closes": c, "first": c[0][0], "suspect_jumps": []} if c else {"status": "unavailable"}
    monkeypatch.setattr(mh, "_stock_closes", read)
    monkeypatch.setattr(mh, "_universe", lambda: sorted(stocks) or ["NONE"])
    monkeypatch.setattr(mh, "_sectors", lambda: sectors or {})
    return calls


def _stocks(spx, n=110):
    trough, end = spx[1][0], spx[64][0]
    return {f"Q{i:03d}": [(trough, 20.0), (end, 20.0 + i)] for i in range(n)}


def _wait_idle(timeout=5.0):
    t0 = time.time()
    while mh._state["inflight"] is not None and time.time() - t0 < timeout:
        time.sleep(0.01)
    assert mh._state["inflight"] is None


def test_the_request_never_builds_and_a_cold_start_answers_the_first_stage(monkeypatch):
    spx = series_ending([100, 89, 101] + [101 + i for i in range(80)])
    gate = threading.Event()
    calls = _install(monkeypatch, spx=spx, stocks=_stocks(spx), gate=gate)
    me = threading.current_thread()
    seen = []
    real = mh.build_leaders

    def spy(*a, **k):
        seen.append(threading.current_thread() is me)
        return real(*a, **k)
    monkeypatch.setattr(mh, "build_leaders", spy)
    first = mh.get_market_history(wait_s=3)
    assert first["status"] == "ok" and first["leaders"]["state"] == "computing"
    assert first["indexes"]["SPX"]["state"] == "ok" and first["indexes"]["NDX"]["state"] == "not_held"
    assert first["indexes"]["SPX"]["episodes"][0]["trough"]["close"] == 89.0
    again = mh.get_market_history(wait_s=0)                        # a second member: no second build
    assert again["leaders"]["state"] == "computing"
    gate.set()
    _wait_idle()
    assert seen == [False]                                         # built off the request thread, once
    done = mh.get_market_history(wait_s=0)
    assert done["leaders"]["state"] == "ok" and done["refreshing"] is False
    ep = done["indexes"]["SPX"]["episodes"][0]
    assert ep["leaders"]["state"] == "ok" and ep["leaders"]["priced_both"] == 110
    assert ep["leaders"]["top"][0]["sym"] == "Q109" and ep["leaders"]["note"] == C.SURVIVORSHIP_NOTE
    assert done["leaders"]["read"] == 110 and done["leaders"]["store_first"] == spx[1][0]
    assert done["data_through"] == "2031-06-02" and done["built_for"] == "2031-06-02"
    assert len(calls) == 110                                       # each stock read once
    assert mh.refresh_due(NOW) is False
    assert mh.refresh_due(NOW + timedelta(days=1)) is True         # the next evening


def test_nothing_held_yet_and_a_slow_first_stage_says_computing(monkeypatch):
    _install(monkeypatch)
    gate = threading.Event()
    monkeypatch.setattr(mh, "build_indexes", lambda now: (gate.wait(5), ({}, {}))[1])
    assert mh.get_market_history(wait_s=0.05) == {"status": "computing"}
    gate.set()
    _wait_idle()


def test_an_evening_rebuild_serves_the_last_answer_at_once_marked_refreshing(monkeypatch):
    spx = series_ending([100, 89, 101] + [101 + i for i in range(80)])
    _install(monkeypatch, spx=spx, stocks=_stocks(spx))
    mh.get_market_history(wait_s=3)
    _wait_idle()
    gate = threading.Event()
    monkeypatch.setattr(mh, "now_et", lambda: NOW + timedelta(days=1))
    real = mh.build_leaders
    monkeypatch.setattr(mh, "build_leaders", lambda *a, **k: (gate.wait(5), real(*a, **k))[1])
    held = mh.get_market_history(wait_s=0)
    assert held["leaders"]["state"] == "ok" and held["refreshing"] is True and held["built_for"] == "2031-06-02"
    gate.set()
    _wait_idle()
    assert mh.get_market_history(wait_s=0)["built_for"] == "2031-06-03"


def test_the_complete_answer_survives_a_restart_and_a_first_stage_never_does(monkeypatch, tmp_path):
    spx = series_ending([100, 89, 101] + [101 + i for i in range(80)])
    _install(monkeypatch, spx=spx, stocks=_stocks(spx))
    mh.get_market_history(wait_s=3)
    _wait_idle()
    path = tmp_path / "market_history" / "market_history_v1.json"
    assert path.exists() and b"\r\n" not in path.read_bytes()
    mh.reset_for_tests()
    monkeypatch.setattr(mh, "_index_entry", lambda sym: (_ for _ in ()).throw(AssertionError("rebuilt")))
    ans, how = mh.held_answer()
    assert how == "held" and ans["leaders"]["state"] == "ok" and ans["built_for"] == "2031-06-02"
    assert mh.refresh_due(NOW) is False
    # a first-stage answer on disk is never taken for a whole one
    doc = json.loads(path.read_text(encoding="utf-8"))
    doc["answer"]["leaders"] = {"state": "computing"}
    path.write_text(json.dumps(doc), encoding="utf-8")
    mh.reset_for_tests()
    assert mh.held_answer() == ({"status": "computing"}, "not_held")


def test_a_failed_build_says_so_and_waits_before_another(monkeypatch):
    _install(monkeypatch)

    def broken(now):
        raise RuntimeError("invented failure")
    monkeypatch.setattr(mh, "build_indexes", broken)
    out = mh.get_market_history(wait_s=3)
    _wait_idle()
    out = mh.get_market_history(wait_s=0)
    assert out["status"] == "unavailable" and out["reason"] == "failed"
    assert mh.refresh_due(NOW) is False                            # the retry wait is on
    assert mh.refresh_due(NOW, at=time.time() + mh.FAIL_RETRY_S + 1) is True
    assert mh.last_build()["outcome"] == "failed (RuntimeError)"


def test_the_first_stage_is_a_copy_the_second_stage_never_changes_under_a_reader(monkeypatch):
    spx = series_ending([100, 89, 101] + [101 + i for i in range(80)])
    gate = threading.Event()
    _install(monkeypatch, spx=spx, stocks=_stocks(spx), gate=gate)
    first = mh.get_market_history(wait_s=3)
    held_first = mh._state["answer"]
    gate.set()
    _wait_idle()
    assert all("leaders" not in e for e in held_first["indexes"]["SPX"]["episodes"])    # untouched by the second stage
    assert all("leaders" not in e for e in first["indexes"]["SPX"]["episodes"])
    assert all("leaders" in e for e in mh.get_market_history(wait_s=0)["indexes"]["SPX"]["episodes"])


def test_a_second_stage_that_fails_keeps_the_declines_and_says_the_leaders_failed(monkeypatch):
    spx = series_ending([100, 89, 101] + [101 + i for i in range(80)])
    _install(monkeypatch, spx=spx, stocks=_stocks(spx))

    def broken(*_a, **_k):
        raise RuntimeError("invented failure")
    monkeypatch.setattr(mh, "build_leaders", broken)
    mh.get_market_history(wait_s=3)
    _wait_idle()
    out = mh.get_market_history(wait_s=0)
    assert out["status"] == "ok" and out["indexes"]["SPX"]["episodes"][0]["trough"]["close"] == 89.0
    assert out["leaders"] == {"state": "failed", "note": C.SURVIVORSHIP_NOTE}
    assert mh.refresh_due(NOW) is False and mh.refresh_due(NOW, at=time.time() + mh.FAIL_RETRY_S + 1) is True
    assert not (pathlib.Path(mh._disk_path()).exists())            # a part answer is never written to disk


def test_no_index_held_is_unavailable_in_words_and_looked_at_again_later(monkeypatch):
    _install(monkeypatch, spx=[], ndx=[])
    mh.get_market_history(wait_s=3)
    _wait_idle()
    out = mh.get_market_history(wait_s=0)
    assert out["status"] == "unavailable" and out["leaders"]["state"] == "unavailable"
    assert out["indexes"]["SPX"]["detail"] == "UCT does not hold the S&P 500's daily closes on this server yet."
    assert out["indexes"]["NDX"]["name"] == "Nasdaq-100"
    assert mh.refresh_due(NOW) is False
    assert mh.refresh_due(NOW, at=time.time() + mh.NOT_HELD_RETRY_S + 1) is True


def test_closes_that_stop_short_of_the_evening_are_tried_again_a_bounded_number_of_times(monkeypatch):
    spx = series([100, 89, 101] + [101 + i for i in range(80)])    # ends 2031-04-30, before the evening of 06-02
    _install(monkeypatch, spx=spx, stocks=_stocks(spx))
    mh.get_market_history(wait_s=3)
    _wait_idle()
    assert mh._state["lag"] == ("2031-06-02", 1)
    later = time.time() + mh.LAG_RETRY_S + 1
    assert mh.refresh_due(NOW) is False and mh.refresh_due(NOW, at=later) is True
    mh._state["lag"] = ("2031-06-02", mh.LAG_TRIES)
    assert mh.refresh_due(NOW, at=later) is False


def test_the_build_is_bounded_one_read_per_stock_a_pause_after_each_and_a_cap(monkeypatch):
    spx = series([100, 89, 101] + [101 + i for i in range(80)])
    blocks, closes = {}, {"SPX": spx}
    eps = C.describe_episodes(spx, "SPX")
    blocks["SPX"] = {"episodes": eps}
    pauses, reads = [], []
    stocks = _stocks(spx, n=12)
    monkeypatch.setattr(mh, "YIELD_S", 0.002)
    monkeypatch.setattr(mh, "MAX_SYMBOLS", 10)
    rec = mh.build_leaders(blocks, closes, read=lambda s: reads.append(s) or {"status": "ok", "closes": stocks[s], "first": stocks[s][0][0]},
                           symbols=sorted(stocks), sectors={}, pause=pauses.append)
    assert len(reads) == 10 and pauses == [0.002] * 10
    assert rec["symbols"] == 10 and rec["read"] == 10 and rec["not_held"] == 0
    assert eps[0]["leaders"]["state"] == "thin"                    # 10 stocks is fewer than the floor
    assert rec["note"] == C.SURVIVORSHIP_NOTE and rec["sectors_held"] is False


def test_a_first_build_in_the_busy_span_pauses_longer_after_each_stock(monkeypatch):
    spx = series_ending([100, 89, 101] + [101 + i for i in range(80)])
    _install(monkeypatch, spx=spx, stocks=_stocks(spx))
    seen = []
    real = mh.build_leaders
    monkeypatch.setattr(mh, "build_leaders", lambda *a, **k: (seen.append(k.get("yield_s")), real(*a, **k))[1])
    monkeypatch.setattr(mh, "YIELD_S", 0.001)
    monkeypatch.setattr(mh, "YIELD_BUSY_S", 0.003)
    mh.build(now=datetime(2031, 6, 3, 11, 0, tzinfo=mh.ET))        # a Tuesday, mid-session
    mh.build(now=datetime(2031, 6, 3, 21, 0, tzinfo=mh.ET))        # that evening
    assert seen == [0.003, 0.001]


def test_a_low_too_recent_for_63_sessions_says_not_yet_with_the_count():
    spx = series([100, 89] + [90 + i for i in range(20)])
    eps = C.describe_episodes(spx, "SPX")
    mh.build_leaders({"SPX": {"episodes": eps}}, {"SPX": spx}, read=lambda s: {"status": "unavailable"},
                     symbols=["X"], sectors={}, pause=lambda s: None)
    assert eps[0]["leaders"] == {"state": "not_yet", "trough": spx[1][0], "end": None, "sessions_so_far": 20,
                                 "needed": 63, "note": C.SURVIVORSHIP_NOTE}


# ── the route ──────────────────────────────────────────────────────────────────────────────────

def _client(user):
    app = FastAPI()
    app.include_router(route.router)
    if user is not None:
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app, raise_server_exceptions=False)


def test_the_route_is_one_paid_get_and_a_refused_caller_never_reaches_the_service(monkeypatch):
    asked = []
    monkeypatch.setattr(mh, "get_market_history", lambda: asked.append(1) or {"status": "ok"})
    (r,) = route.router.routes
    assert r.path == "/api/research/market-history" and r.methods == {"GET"}
    assert route.require_paid in {d.call for d in r.dependant.dependencies}
    assert route.require_paid.__module__ == "api.routers.market_history"
    assert _client(None).get("/api/research/market-history").status_code == 401
    refused = _client(FREE_USER).get("/api/research/market-history")
    assert refused.status_code == 402 and refused.json() == {"detail": "Market history requires a paid plan"}
    assert asked == []
    assert _client(PAID_USER).get("/api/research/market-history").json() == {"status": "ok"}
    assert asked == [1]


def test_the_handler_is_a_plain_def_and_the_route_is_mounted():
    import inspect
    assert not inspect.iscoroutinefunction(route.get_market_history)
    main = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
    assert "from api.routers import market_history as market_history_router" in main
    assert "app.include_router(market_history_router.router)" in main
