"""Group fundamentals and breadth (api/services/group_stats_calc.py, api/services/group_stats.py,
api/routers/group_stats.py). Every company, price, filing and figure here is INVENTED.

  * the definitions, on invented numbers: a value in force by the store's as-of rule (a later filing, a
    gap, a stale period), revenue growth accelerating (a missing quarter, a restated quarter), the composed
    valuations (a negative EPS, no revenue), the median and its middle half, the five-member rule, the
    ranks (ties), the breadth measures (each average, the 52-week high and low on closes, too little
    history, a session a stock did not trade), the session found from the data (a stray weekend bar,
    stocks whose closes lag);
  * the build: one read per stock, a pause after each, the cap, unmapped stocks never read, the universe
    less the funds, the map GRP groups by, the fundamentals switched off, the store read without its cache;
  * the held answer: never built on a request, built only in the quiet span when due, once an evening,
    an evening that fell short tried again a bounded number of times, a failure said, the disk copy;
  * the reads: the table, one group, a name compared loosely, a group not held, the switch read at serve time;
  * the route: one paid GET, 401 / 402, its own gate, a plain def, mounted, and the evening job registered;
  * the weekly rank (2026-11-22): the points (each week's last session, a holiday Friday, a week with no session,
    the newest session), a stock's change as the RS rating's own period return on the closes up to that day (no
    look-ahead, a day it did not trade, too few closes, a bad base), a group's median of five or more and its rank
    (ties), the places moved and the best and worst week, the build adding it from the same single read with breadth
    unchanged, the reads carrying it, an answer held from before it (pending, rebuilt), and no session (unavailable).
"""
from __future__ import annotations

import json
import math
import pathlib
import threading
import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import group_stats as route
from api.services import group_stats as gs
from api.services import group_stats_calc as C

ROOT = pathlib.Path(__file__).resolve().parents[1]
ET = ZoneInfo("America/New_York")
FREE_USER = {"id": "gfb-free", "email": "free@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "gfb-paid", "email": "paid@example.test", "role": "member", "plan": "pro"}
EVENING = datetime(2031, 6, 4, 21, 0, tzinfo=ET)          # a Wednesday evening, after 20:15 New York time
KEY = date(2031, 6, 4)


def ts(day: str, hour: int = 16) -> float:
    d = date.fromisoformat(day)
    return datetime(d.year, d.month, d.day, hour, 0, tzinfo=ET).timestamp()


def weekdays_ending(end: date, n: int) -> list[str]:
    out, d = [], end
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d -= timedelta(days=1)
    return list(reversed(out))


def closes_of(values, end: date = KEY) -> list[tuple[str, float]]:
    return list(zip(weekdays_ending(end, len(values)), [float(v) for v in values]))


@pytest.fixture(autouse=True)
def _fresh(monkeypatch, tmp_path):
    gs.reset_for_tests()
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(gs, "YIELD_S", 0.0)
    yield
    gs.reset_for_tests()


# ── the definitions ──────────────────────────────────────────────────────────────────────────

def test_the_constants_are_the_stated_definitions():
    assert C.MIN_MEMBERS == 5 and C.MAX_PERIOD_AGE_DAYS == 200 and C.ACCEL_GAP_DAYS == (60, 120)
    assert C.SMA_WINDOWS == (20, 50, 200) and C.HIGH_SESSIONS == 252 and C.NEAR_HIGH == 0.95
    assert C.OFFSETS == (("now", 0), ("week", 5), ("month", 21)) and C.LINE_SESSIONS == 252
    assert C.TAIL_SESSIONS >= C.HIGH_SESSIONS + 21 + 1 and C.TAIL_SESSIONS >= C.LINE_SESSIONS + 49


def test_the_metrics_are_the_catalogs_own_series_and_composers():
    from api.services.fundamentals_pit import catalog
    cat = catalog.by_id()
    for mid, series in C.STORED.items():
        assert cat[mid].series == series and cat[mid].compose is None
    for mid, inputs in C.COMPOSED.items():
        assert tuple(cat[mid].inputs) == inputs and cat[mid].compose in catalog.COMPOSERS
    assert set(C.FUND_ORDER) == set(C.STORED) | set(C.COMPOSED) | {C.ACCEL_ID}


def test_a_value_is_the_one_in_force_by_the_stores_as_of_rule():
    pts = [[ts("2031-02-10"), 10.0, "2030-12-31", "reported"], [ts("2031-05-08"), 12.5, "2031-03-31", "reported"]]
    assert C.in_force(pts, ts("2031-06-04"), KEY) == 12.5
    assert C.in_force(pts, ts("2031-05-07"), date(2031, 5, 7)) == 10.0          # the later filing was not public yet
    assert C.in_force(pts, ts("2031-02-09"), date(2031, 2, 9)) is None          # nothing public yet
    gap = pts + [[ts("2031-06-01"), None, "2031-04-30", "gap"]]
    assert C.in_force(gap, ts("2031-06-04"), KEY) is None                       # a gap is no value, never the old one
    # a period older than 200 days at the reference day is not a current value; exactly 200 still is
    assert C.in_force(pts, ts("2031-10-17"), date(2031, 10, 17)) == 12.5        # 200 days after 2031-03-31
    assert C.in_force(pts, ts("2031-10-18"), date(2031, 10, 18)) is None


def test_revenue_growth_accelerating_compares_the_newest_quarter_with_the_one_before():
    q = lambda end, filed, v: [ts(filed), v, end, "derived"]
    pts = [q("2030-12-31", "2031-02-10", 8.0), q("2031-03-31", "2031-05-08", 11.0)]
    assert C.accelerating(pts, ts("2031-06-04"), KEY) is True
    assert C.accelerating([q("2030-12-31", "2031-02-10", 11.0), q("2031-03-31", "2031-05-08", 11.0)],
                          ts("2031-06-04"), KEY) is False                        # equal is not accelerating
    assert C.accelerating(pts, ts("2031-05-01"), date(2031, 5, 1)) is None      # only one quarter known by then
    # a missing quarter between the two is no answer, never a comparison across the gap
    skipped = [q("2030-09-30", "2030-11-05", 3.0), q("2031-03-31", "2031-05-08", 11.0)]
    assert C.accelerating(skipped, ts("2031-06-04"), KEY) is None
    # a quarter restated while it was the newest: its last known value counts
    restated = [q("2030-12-31", "2031-02-10", 8.0), q("2030-12-31", "2031-03-01", 12.0), q("2031-03-31", "2031-05-08", 11.0)]
    assert C.accelerating(restated, ts("2031-06-04"), KEY) is False
    assert C.accelerating(pts + [[ts("2031-06-01"), None, "2031-04-30", "gap"]], ts("2031-06-04"), KEY) is None


def test_the_valuations_are_composed_like_the_catalog_and_a_bad_base_is_no_value():
    assert C.compose("pe_ttm", 50.0, {"eps_diluted_ttm": 2.0}) == 25.0
    assert C.compose("pe_ttm", 50.0, {"eps_diluted_ttm": -1.0}) is None
    assert C.compose("pe_ttm", 50.0, {"eps_diluted_ttm": 0.0}) is None
    assert C.compose("ps_ttm", 10.0, {"shares_outstanding": 1e6, "revenue_ttm": 5e6}) == 2.0
    assert C.compose("ps_ttm", 10.0, {"shares_outstanding": 1e6, "revenue_ttm": 0.0}) is None
    assert C.compose("fcf_yield", 10.0, {"shares_outstanding": 1e6, "fcf_ttm": 5e5}) == pytest.approx(5.0)
    assert C.compose("fcf_yield", 10.0, {"shares_outstanding": 1e6, "fcf_ttm": -5e5}) == pytest.approx(-5.0)
    assert C.compose("pe_ttm", None, {"eps_diluted_ttm": 2.0}) is None
    assert C.compose("ps_ttm", 10.0, {"shares_outstanding": None, "revenue_ttm": 5e6}) is None


def test_the_median_and_its_middle_half_and_the_five_member_rule():
    assert C.summarize([10, 20, 30, 40, 50, 60]) == {"n": 6, "median": 35.0, "q1": 22.5, "q3": 47.5}
    assert C.summarize([3, 1, 2, 5, 4]) == {"n": 5, "median": 3.0, "q1": 2.0, "q3": 4.0}
    assert C.summarize([1, 2, 3, 4]) == {"n": 4, "median": None, "q1": None, "q3": None}
    assert C.summarize([1, None, float("nan"), 2, 3, 4, True]) == {"n": 4, "median": None, "q1": None, "q3": None}
    assert C.share([True, False, True, None, True, True]) == {"n": 5, "count": 4, "share": 80.0}
    assert C.share([True, True, None]) == {"n": 2, "count": 2, "share": None}


def test_ranks_put_the_highest_first_and_ties_share_a_place():
    assert C.rank({"A": 5.0, "B": 9.0, "C": 5.0, "D": None, "E": 1.0}) == {
        "B": {"position": 1, "of": 4}, "A": {"position": 2, "of": 4}, "C": {"position": 2, "of": 4},
        "E": {"position": 4, "of": 4}}


def test_a_valuation_close_is_the_last_close_on_or_before_its_day_within_reach():
    closes = [("2031-05-29", 10.0), ("2031-06-02", 11.0), ("2031-06-04", 12.0)]
    assert C.close_on_or_before(closes, date(2031, 6, 4)) == 12.0
    assert C.close_on_or_before(closes, date(2031, 6, 3)) == 11.0
    assert C.close_on_or_before(closes, date(2031, 6, 20)) is None              # more than ten days stale
    assert C.close_on_or_before(closes, date(2031, 5, 1)) is None               # before the history


def _breadth(values, targets=None, line=()):
    days, vals = C.tail(closes_of(values))
    ords = list(days)
    targets = targets or {"now": ords[-1]}
    return C.stock_breadth(days, vals, targets, line), ords


def test_the_averages_use_the_stocks_own_last_closes_and_too_little_history_is_no_answer():
    rising, ords = _breadth(list(range(1, 301)))
    now = rising["now"]
    assert (now["above20"], now["above50"], now["above200"]) == (True, True, True)
    assert now["new_high"] is True and now["new_low"] is False and now["near_high"] is True and now["move"] == 1
    falling, _ = _breadth(list(range(300, 0, -1)))
    assert (falling["now"]["above20"], falling["now"]["near_high"], falling["now"]["new_low"]) == (False, False, True)
    young, _ = _breadth(list(range(1, 61)))                                    # 60 closes: no 200-day average, no year
    assert young["now"]["above50"] is True and young["now"]["above200"] is None
    assert young["now"]["near_high"] is None and young["now"]["new_high"] is None
    flat, _ = _breadth([10.0] * 260)
    assert flat["now"]["above20"] is False and flat["now"]["move"] == 0 and flat["now"]["new_high"] is False
    # within 5% of the 52-week closing high: 95.0 of a 100.0 high counts, 94.9 does not
    near, _ = _breadth([50.0] * 200 + [100.0] + [80.0] * 58 + [95.0])
    assert near["now"]["near_high"] is True
    under, _ = _breadth([50.0] * 200 + [100.0] + [80.0] * 58 + [94.9])
    assert under["now"]["near_high"] is False


def test_a_session_the_stock_did_not_trade_is_no_answer_and_the_line_follows_the_sessions():
    b, ords = _breadth(list(range(1, 301)), targets=None)
    missing = C.stock_breadth(*C.tail(closes_of(list(range(1, 301)))), {"now": ords[-1] + 1}, [ords[-1], ords[-1] + 1])
    assert missing["now"]["above50"] is None and missing["held"] is False
    assert missing["line"] == [True, None]
    assert b["held"] is True


def test_the_session_is_found_from_the_data():
    d = date(2031, 6, 2).toordinal()
    counts = {d: 100, d + 1: 98, d + 2: 40, d + 4: 2}           # Thursday reached by 40%; a stray Saturday bar
    sessions, newest = C.sessions_from(counts, 100)
    assert newest == d + 1 and sessions == (d, d + 1)          # 40% is a session but not yet the breadth session
    assert C.sessions_from({}, 0) == ((), None)


def test_a_groups_line_needs_five_stocks_on_the_day():
    t = C.BreadthTally(2)
    for i in range(5):
        t.add({"held": True, "now": {"move": 1}, "line": [True, None if i else True]})
    r = t.result()
    assert r["line"] == [100.0, None] and r["priced"] == 5
    assert r["advance_decline"] == {"n": 5, "advancers": 5, "decliners": 0, "unchanged": 0}
    assert r["net_highs"] is None                              # no stock had a year of closes


# ── the build ────────────────────────────────────────────────────────────────────────────────

def _art(net_margin, eps=2.0, growth=(8.0, 11.0), shares=1e6, revenue=5e7, fcf=1e6):
    """An invented artifact: quarterly figures public 40 days after each quarter."""
    q = lambda end, v, filed: [ts(filed), v, end, "derived"]
    old = [q("2028-03-31", net_margin - 5, "2028-05-10")]          # what was known three years before the evening
    yago = [q("2030-03-31", net_margin - 2, "2030-05-10")]
    return {"metrics": {
        "net_margin_ttm": old + yago + [q("2031-03-31", net_margin, "2031-05-10")],
        "gross_margin_ttm": [q("2031-03-31", net_margin + 30, "2031-05-10")],
        "revenue_growth_yoy_q": [q("2030-12-31", growth[0], "2031-02-09"), q("2031-03-31", growth[1], "2031-05-10")],
        "eps_diluted_ttm": yago + [q("2031-03-31", eps, "2031-05-10")],
        "shares_outstanding": [q("2031-04-30", shares, "2031-05-10")],
        "revenue_ttm": [q("2031-03-31", revenue, "2031-05-10")],
        "fcf_ttm": [q("2031-03-31", fcf, "2031-05-10")],
    }}


TECH = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"]
OIL = ["XOA", "XOB", "XOC"]
GROUPS = {**{s: {"sector": "Technology", "industry": "Software"} for s in TECH[:5]},
          "FFF": {"sector": "Technology", "industry": "Semiconductors"},
          **{s: {"sector": "Energy", "industry": "Oil & Gas"} for s in OIL}}
UP = closes_of([10 + i * 0.1 for i in range(400)])
DOWN = closes_of([60 - i * 0.1 for i in range(400)])
PRICES = {"AAA": UP, "BBB": UP, "CCC": UP, "DDD": DOWN, "EEE": DOWN, "FFF": DOWN, "XOA": UP, "XOB": DOWN, "XOC": UP}
ARTS = {s: _art(10.0 * (i + 1), eps=-1.0 if s == "FFF" else 2.0, growth=(8.0, 11.0) if i % 2 == 0 else (11.0, 8.0))
        for i, s in enumerate(TECH)}
ARTS.update({s: _art(5.0) for s in OIL})
_REAL_BUILD = gs.build                    # tests that replace gs.build still need a real answer to hold


def _build(**kw):
    reads, arts, pauses = [], [], []
    args = dict(read_closes=lambda s: reads.append(s) or ({"status": "ok", "closes": PRICES[s]} if s in PRICES
                                                         else {"status": "unavailable"}),
                read_artifact=lambda s: arts.append(s) or ARTS.get(s), symbols=TECH + OIL + ["ZZZ"],
                groups=GROUPS, pause=pauses.append, yield_s=0.001, fund_on=True)
    args.update(kw)
    return _REAL_BUILD(EVENING, **args), reads, arts, pauses


def test_the_build_reads_each_mapped_stock_once_pauses_after_each_and_never_reads_an_unmapped_one():
    ans, reads, arts, pauses = _build()
    assert reads == TECH + OIL and arts == TECH + OIL                  # ZZZ has no sector or industry: never read
    assert pauses == [0.001] * 9
    assert ans["universe"]["mapped"] == 9 and ans["universe"]["not_mapped"] == 1
    assert ans["built_for"] == "2031-06-04" and ans["session"] == "2031-06-04"
    assert ans["fund_refs"] == {"now": "2031-06-04", "year_ago": "2030-06-04", "three_years_ago": "2028-06-04"}
    assert ans["lagging"] == [] and ans["fundamentals"]["state"] == "ok" and ans["fundamentals"]["with_data"] == 9


def test_the_cap_bounds_the_universe(monkeypatch):
    monkeypatch.setattr(gs, "MAX_SYMBOLS", 4)
    _ans, reads, _arts, _p = _build()
    assert reads == TECH[:4]


def test_group_medians_rest_on_their_members_and_five_is_the_floor():
    ans, *_ = _build()
    tech = ans["kinds"]["sector"]["Technology"]
    assert tech["members"] == 6 and tech["fund_members"] == 6
    nm = tech["fund"]["net_margin"]
    assert nm["now"] == {"n": 6, "median": 35.0, "q1": 22.5, "q3": 47.5}
    assert nm["year_ago"]["median"] == 33.0 and nm["three_years_ago"]["median"] == 30.0
    # P/E: FFF's EPS is negative, so five members; a valuation needs a close, and three years back there is none
    assert tech["fund"]["pe_ttm"]["now"]["n"] == 5
    assert tech["fund"]["pe_ttm"]["three_years_ago"]["n"] == 0
    assert tech["fund"]["revenue_accelerating"]["now"] == {"n": 6, "count": 3, "share": 50.0}
    energy = ans["kinds"]["sector"]["Energy"]
    assert energy["fund"]["net_margin"]["now"] == {"n": 3, "median": None, "q1": None, "q3": None}
    assert energy["fund"]["net_margin"]["rank"] is None
    assert tech["fund"]["net_margin"]["rank"] == {"position": 1, "of": 1}
    soft = ans["kinds"]["industry"]["Software"]
    assert soft["members"] == 5 and soft["fund"]["net_margin"]["now"]["median"] == 30.0
    assert set(ans["kinds"]["industry"]) == {"Software", "Semiconductors", "Oil & Gas"}


def test_group_breadth_counts_the_stocks_with_a_close_that_session():
    ans, *_ = _build()
    b = ans["kinds"]["sector"]["Technology"]["breadth"]
    assert b["priced"] == 6
    assert b["above50"]["now"] == {"n": 6, "count": 3, "share": 50.0}
    assert b["above50"]["rank"] == {"position": 1, "of": 1}
    assert b["new_highs"] == {"n": 6, "count": 3} and b["new_lows"] == {"n": 6, "count": 3} and b["net_highs"] == 0
    assert b["advance_decline"] == {"n": 6, "advancers": 3, "decliners": 3, "unchanged": 0}
    assert b["above50"]["week"]["share"] == 50.0 and b["above50"]["month"]["share"] == 50.0
    assert len(ans["line_dates"]) == C.LINE_SESSIONS and len(b["line"]) == C.LINE_SESSIONS
    assert ans["sessions"]["week"] == weekdays_ending(KEY, 6)[0] and ans["sessions"]["month"] == weekdays_ending(KEY, 22)[0]
    energy = ans["kinds"]["sector"]["Energy"]["breadth"]
    assert energy["above50"]["now"] == {"n": 3, "count": 2, "share": None} and energy["above50"]["rank"] is None
    assert energy["net_highs"] is None and energy["net_highs_rank"] is None


def test_closes_that_stop_short_of_the_evening_say_so():
    short = {s: v[:-1] for s, v in PRICES.items()}                     # nobody has the evening's close yet
    ans, *_ = _build(read_closes=lambda s: {"status": "ok", "closes": short[s]} if s in short else {"status": "x"})
    assert ans["session"] == weekdays_ending(KEY, 2)[0] and ans["lagging"] == ["prices"]


def test_with_the_fundamentals_switched_off_no_filing_is_read():
    asked = []
    ans, _r, _a, _p = _build(fund_on=False, read_artifact=lambda s: asked.append(s))
    assert asked == [] and ans["fundamentals"]["state"] == "off"
    assert ans["kinds"]["sector"]["Technology"]["breadth"]["priced"] == 6


def test_filings_that_could_not_be_read_at_all_are_unavailable_and_tried_again():
    ans, *_ = _build(read_artifact=lambda s: None)
    assert ans["fundamentals"]["state"] == "unavailable" and ans["lagging"] == ["filings"]


def test_one_failing_read_never_stops_the_build():
    def bad(sym):
        if sym == "BBB":
            raise RuntimeError("invented")
        return {"status": "ok", "closes": PRICES[sym]}
    ans, *_ = _build(read_closes=bad)
    assert ans["kinds"]["sector"]["Technology"]["breadth"]["priced"] == 5


def test_the_universe_is_the_stock_list_less_the_funds(monkeypatch):
    from api.services import cap_universe
    monkeypatch.setattr(cap_universe, "symbols", lambda: frozenset({"AAA", "SPYX", "BBB"}))
    monkeypatch.setattr(cap_universe, "etf_symbols", lambda: frozenset({"SPYX"}))
    assert gs._universe() == ["AAA", "BBB"]


def test_the_groups_come_from_the_map_grp_groups_by(monkeypatch):
    from api.services import scan_period
    monkeypatch.setattr(scan_period, "_sector_industry_map", lambda: {"AAA": {"sector": "Technology", "industry": "Software"}})
    assert gs._group_map() == {"AAA": {"sector": "Technology", "industry": "Software"}}
    monkeypatch.setattr(scan_period, "_sector_industry_map", lambda: (_ for _ in ()).throw(RuntimeError("x")))
    assert gs._group_map() == {}


def test_the_store_is_read_through_its_own_source_and_never_into_its_cache(monkeypatch, tmp_path):
    from api.services.fundamentals_pit import publish as P
    from api.services.fundamentals_pit import serving as SV
    for name in ("_mode", "_read_key", "_db_conn", "current_source"):
        assert callable(getattr(SV, name)), name
    from api.services.fundamentals_pit import v5_publish as VP
    assert callable(P.key_for) and callable(VP.obj_key)
    root = tmp_path / "art"
    (root / pathlib.Path(P.index_key()).parent).mkdir(parents=True)
    (root / P.index_key()).write_text(json.dumps({"tickers": {"AAA": 101}}))
    (root / pathlib.Path(P.key_for(101))).parent.mkdir(parents=True, exist_ok=True)
    (root / P.key_for(101)).write_text(json.dumps(ARTS["AAA"]))
    monkeypatch.setenv("FUNDAMENTALS_PIT_SOURCE", "local")
    monkeypatch.setenv("FUNDAMENTALS_PIT_ARTIFACT_DIR", str(root))
    monkeypatch.delenv("FUNDAMENTALS_PIT_SERVE", raising=False)
    SV.clear_cache()
    read, close = gs._artifact_reader()
    try:
        assert read("AAA")["metrics"]["net_margin_ttm"] == ARTS["AAA"]["metrics"]["net_margin_ttm"]
        assert read("NOPE") is None
    finally:
        close()
    assert not [k for k in SV._cache if k.startswith(("art:", "v5o:"))]
    SV.clear_cache()


def test_the_switch_is_the_one_the_point_in_time_routes_answer_behind(monkeypatch):
    monkeypatch.delenv("FUNDAMENTALS_PIT_ENABLED", raising=False)
    assert gs.fundamentals_on() is False
    monkeypatch.setenv("FUNDAMENTALS_PIT_ENABLED", "1")
    assert gs.fundamentals_on() is True
    src = (ROOT / "api" / "routers" / "fundamentals_pit.py").read_text(encoding="utf-8")
    assert 'os.environ.get("FUNDAMENTALS_PIT_ENABLED", "0") != "1"' in src


# ── the clock and the held answer ────────────────────────────────────────────────────────────

def test_the_quiet_span_is_the_one_scan_period_keeps_whole_universe_work_to():
    from api.services.scan_period import _reuse_quiet_now
    start = datetime(2031, 6, 2, 0, 0, tzinfo=ET)
    for step in range(0, 7 * 24 * 60, 5):
        t = start + timedelta(minutes=step)
        assert gs.quiet(t) == _reuse_quiet_now(t), t


def test_the_evening_key_is_the_newest_session_whose_evening_has_begun():
    assert gs.evening_key(datetime(2031, 6, 4, 20, 14, tzinfo=ET)) == "2031-06-03"
    assert gs.evening_key(datetime(2031, 6, 4, 20, 15, tzinfo=ET)) == "2031-06-04"
    assert gs.evening_key(datetime(2031, 6, 7, 12, 0, tzinfo=ET)) == "2031-06-06"     # Saturday: Friday's evening
    assert gs.fund_refs(date(2032, 2, 29))["year_ago"][0] == date(2031, 2, 28)


def _fake_answer(key="2031-06-04", lagging=()):
    ans, *_ = _build()
    ans["built_for"], ans["lagging"] = key, list(lagging)
    return ans


def test_a_request_never_builds(monkeypatch):
    monkeypatch.setattr(gs, "build", lambda *a, **k: (_ for _ in ()).throw(AssertionError("built on a request")))
    monkeypatch.setattr(gs, "_start_job", lambda: (_ for _ in ()).throw(AssertionError("started on a request")))
    assert gs.get_group_stats("sector")["status"] == "not_built"
    assert gs.get_group_stats("sector", "Technology")["status"] == "not_built"


def test_the_scheduler_builds_only_in_the_quiet_span_and_only_once_an_evening(monkeypatch):
    started = []
    monkeypatch.setattr(gs, "_start_job", lambda: started.append(1))
    assert gs.refresh_if_due(datetime(2031, 6, 4, 15, 0, tzinfo=ET)) is False      # a weekday afternoon
    assert gs.refresh_if_due(EVENING) is True and started == [1]
    with gs._lock:
        gs._state.update(answer=_fake_answer(), built_for="2031-06-04")
    assert gs.refresh_if_due(EVENING) is False                                    # built for this evening
    assert gs.refresh_if_due(datetime(2031, 6, 5, 20, 20, tzinfo=ET)) is True     # the next evening


def test_an_evening_that_fell_short_is_tried_again_at_most_three_times(monkeypatch):
    with gs._lock:
        gs._state.update(answer=_fake_answer(), built_for="2031-06-04", lag=("2031-06-04", 2))
    assert gs.refresh_due(EVENING) is True
    with gs._lock:
        gs._state["lag"] = ("2031-06-04", 3)
    assert gs.refresh_due(EVENING) is False


def test_the_background_build_holds_its_answer_counts_a_short_evening_and_saves_it(monkeypatch, tmp_path):
    monkeypatch.setattr(gs, "build", lambda *a, **k: _fake_answer(lagging=["prices"]))
    done = gs._start_job()
    assert done.wait(10)
    assert gs._state["built_for"] == "2031-06-04" and gs._state["lag"] == ("2031-06-04", 1)
    assert (tmp_path / "group_stats" / "group_stats_v1.json").exists()
    gs.reset_for_tests()
    assert gs.get_group_stats("sector")["status"] == "ok"                          # the disk copy, after a restart
    assert gs._state["lag"] == ("2031-06-04", 1)


def test_a_failed_build_says_so_and_waits_before_another(monkeypatch):
    monkeypatch.setattr(gs, "build", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("invented")))
    assert gs._start_job().wait(10)
    assert gs.last_build()["outcome"] == "failed (RuntimeError)"
    assert gs._state["retry_at"] > time.time() and gs.refresh_due(EVENING) is False
    assert gs.get_group_stats("sector")["status"] == "not_built"


def test_while_the_first_build_runs_a_read_says_computing(monkeypatch):
    gate = threading.Event()
    monkeypatch.setattr(gs, "build", lambda *a, **k: gate.wait(10) and _fake_answer())
    done = gs._start_job()
    try:
        assert gs.get_group_stats("industry")["status"] == "computing"
    finally:
        gate.set()
        done.wait(10)
    assert gs.get_group_stats("industry")["status"] == "ok"


# ── the reads ────────────────────────────────────────────────────────────────────────────────

def _hold(monkeypatch, on=True):
    monkeypatch.setenv("FUNDAMENTALS_PIT_ENABLED", "1" if on else "0")
    with gs._lock:
        gs._state.update(answer=_fake_answer(), built_for="2031-06-04", loaded=True)


def test_the_table_lists_every_group_of_a_kind_with_its_medians_and_breadth(monkeypatch):
    _hold(monkeypatch)
    t = gs.get_group_stats("sector")
    assert t["status"] == "ok" and t["kind"] == "sector" and t["count"] == 2 and t["min_members"] == 5
    tech = next(g for g in t["groups"] if g["name"] == "Technology")
    assert tech["fund"]["net_margin"] == {"n": 6, "value": 35.0, "year_ago": {"n": 6, "value": 33.0}}
    assert tech["fund"]["revenue_accelerating"]["value"] == 50.0
    assert tech["breadth"]["above50"]["share"] == 50.0 and tech["breadth"]["above50"]["week_change"] == 0.0
    assert [m["id"] for m in t["metrics"]] == list(C.FUND_ORDER)
    assert next(m for m in t["metrics"] if m["id"] == "pe_ttm")["composed"] is True
    assert t["sources"]["fundamentals"]["state"] == "ok" and t["refreshing"] is False
    assert t["sources"]["breadth"]["state"] == "ok" and t["sources"]["breadth"]["priced"] == 9


def test_one_group_in_full_with_its_ranks_and_line(monkeypatch):
    _hold(monkeypatch)
    g = gs.get_group_stats("industry", "Software")
    assert g["found"] is True and g["members"] == 5 and g["peers"] == 3
    assert g["sources"]["breadth"]["state"] == "ok" and g["breadth"]["priced"] == 5          # the group's own, apart
    assert g["fund"]["net_margin"]["now"]["median"] == 30.0 and g["fund"]["net_margin"]["rank"] == {"position": 1, "of": 1}
    assert len(g["line_dates"]) == C.LINE_SESSIONS and len(g["breadth"]["line"]) == C.LINE_SESSIONS
    assert gs.get_group_stats("industry", "oil and gas")["name"] == "Oil & Gas"          # compared loosely
    missing = gs.get_group_stats("industry", "Shipping")
    assert missing["found"] is False and missing["status"] == "ok" and "fund" not in missing


def test_the_switch_is_read_when_a_member_asks(monkeypatch):
    _hold(monkeypatch, on=False)
    t = gs.get_group_stats("sector")
    assert t["sources"]["fundamentals"]["state"] == "off" and all(g["fund"] is None for g in t["groups"])
    assert gs.get_group_stats("sector", "Technology")["fund"] is None
    assert gs.get_group_stats("sector", "Technology")["breadth"]["priced"] == 6
    with gs._lock:
        gs._state["answer"]["fundamentals"]["state"] = "off"
    monkeypatch.setenv("FUNDAMENTALS_PIT_ENABLED", "1")
    assert gs.get_group_stats("sector")["sources"]["fundamentals"]["state"] == "pending"


def test_a_bad_kind_is_refused_in_words():
    assert gs.get_group_stats("theme")["status"] == "error"


# ── the route and the job ────────────────────────────────────────────────────────────────────

def _client(user):
    app = FastAPI()
    app.include_router(route.router)
    if user is not None:
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app, raise_server_exceptions=False)


def test_the_route_is_one_paid_get_and_a_refused_caller_never_reaches_the_service(monkeypatch):
    asked = []
    monkeypatch.setattr(gs, "get_group_stats", lambda kind, name: asked.append((kind, name)) or {"status": "ok"})
    # the router also carries ERNSC's season read (tests/test_sector_earnings.py)
    (r,) = [x for x in route.router.routes if x.path == "/api/research/group-stats"]
    assert r.path == "/api/research/group-stats" and r.methods == {"GET"}
    assert route.require_paid in {d.call for d in r.dependant.dependencies}
    assert route.require_paid.__module__ == "api.routers.group_stats"
    assert _client(None).get("/api/research/group-stats").status_code == 401
    refused = _client(FREE_USER).get("/api/research/group-stats")
    assert refused.status_code == 402 and refused.json() == {"detail": "Group figures require a paid plan"}
    assert asked == []
    paid = _client(PAID_USER)
    assert paid.get("/api/research/group-stats").json() == {"status": "ok"}
    assert paid.get("/api/research/group-stats?kind=industry&name=Oil%20%26%20Gas").status_code == 200
    assert asked == [("sector", None), ("industry", "Oil & Gas")]
    assert paid.get("/api/research/group-stats?kind=theme").status_code == 422
    assert paid.get("/api/research/group-stats?name=" + "x" * 81).status_code == 422
    assert len(asked) == 2


# ── the weekly rank ──────────────────────────────────────────────────────────────────────────

def test_the_rank_measures_are_the_rs_ratings_own_lookbacks():
    from api.services.rs_weighted_return import RS_TERMS
    bars = {label: n for label, n, _w in RS_TERMS}
    assert dict(C.RANK_MEASURES) == {"m6": bars["6m"], "m3": bars["3m"]} and C.RANK_PRIMARY == "m6"
    assert C.RANK_WEEKS == 52 and C.RANK_BACK == (("w4", 4), ("w13", 13), ("w52", 52))
    assert C.RANK_TAIL >= C.RANK_WEEKS * 5 + max(bars.values()) + 1 and C.RANK_TAIL > C.TAIL_SESSIONS


def _ords(days):
    return [date.fromisoformat(d).toordinal() for d in days]


def test_the_weekly_points_are_each_weeks_last_session_then_the_newest():
    days = [d for d in weekdays_ending(date(2031, 6, 4), 300)                 # the newest session is a Wednesday
            if d not in ("2031-04-18",)                                      # a holiday Friday: Thursday closes the week
            and not ("2031-03-03" <= d <= "2031-03-07")]                     # a week with no session at all
    pts = C.week_points(tuple(_ords(days)))
    iso = [date.fromordinal(p).isoformat() if p is not None else None for p in pts]
    assert len(pts) == C.RANK_WEEKS + 1
    assert iso[-1] == "2031-06-04" and iso[-2] == "2031-05-30" and iso[-3] == "2031-05-23"
    assert "2031-04-17" in iso and "2031-04-18" not in iso
    assert iso[iso.index("2031-03-14") - 1] is None                          # the empty week has no point
    assert iso[0] == "2030-06-07"                                            # 52 weeks before the newest week
    friday = C.week_points(tuple(_ords(weekdays_ending(date(2031, 6, 6), 300))))
    assert [date.fromordinal(p).isoformat() for p in friday[-2:]] == ["2031-05-30", "2031-06-06"]
    short = C.week_points(tuple(_ords(weekdays_ending(date(2031, 6, 4), 30))))
    assert short[0] is None and short[-1] is not None                         # weeks before the history have no point
    assert C.week_points(()) == ()


def test_a_stocks_change_is_the_rs_period_return_on_the_closes_up_to_that_day():
    from api.services.rs_weighted_return import period_return
    values = [20 + (i % 17) * 0.7 + i * 0.05 for i in range(420)]
    closes = closes_of(values)
    days, vals = C.tail(closes, C.RANK_TAIL)
    assert len(days) == C.RANK_TAIL                                          # the rank keeps more than breadth's tail
    pts = C.week_points(tuple(days))
    out = C.stock_changes(days, vals, pts)
    n_pts = len(pts)
    full_days = [d for d, _ in closes]
    checked = 0
    for m, (_mid, bars) in enumerate(C.RANK_MEASURES):
        for j, p in enumerate(pts):
            upto = [c for d, c in closes if d <= date.fromordinal(p).isoformat()]
            want = period_return(upto, bars)
            assert out[m * n_pts + j] == pytest.approx(want), (m, j)
            checked += 1
    assert checked == 2 * n_pts and full_days[-1] == "2031-06-04"
    # no look-ahead: a later close changes nothing at an earlier point
    later = closes[:-10] + [(d, c * 3) for d, c in closes[-10:]]
    again = C.stock_changes(*C.tail(later, C.RANK_TAIL), pts)
    assert list(again[:n_pts - 3]) == list(out[:n_pts - 3])                 # the last three points hold a changed close
    # a point the stock did not trade, too few closes, and a base that is not a positive price are no change
    missing = [(d, c) for d, c in closes if d != date.fromordinal(pts[-1]).isoformat()]
    assert math.isnan(C.stock_changes(*C.tail(missing, C.RANK_TAIL), pts)[n_pts - 1])
    young = C.stock_changes(*C.tail(closes[-60:], C.RANK_TAIL), pts)
    assert all(math.isnan(v) for v in young)
    bars6 = dict(C.RANK_MEASURES)["m6"]
    zero = closes[:-1 - bars6] + [(closes[-1 - bars6][0], 0.0)] + closes[-bars6:]
    zd, zv = C.tail(zero, C.RANK_TAIL)
    assert math.isnan(C.stock_changes(zd, zv, pts)[n_pts - 1])
    assert not math.isnan(C.stock_changes(zd, zv, pts)[2 * n_pts - 1])        # the 3-month change still has its base


def test_a_groups_rank_is_its_median_of_five_or_more_and_ties_share_a_place():
    from array import array
    nan = float("nan")
    one = lambda m6, m3: array("d", [m6, m6, m3, m3])                         # two points, each measure
    groups = {
        "Alpha": [one(v, -v) for v in (10, 20, 30, 40, 50)],                 # median 30 / -30
        "Beta": [one(v, -v) for v in (30, 30, 30, 10, 99)],                  # median 30 too: a tie
        "Gamma": [one(v, v) for v in (1, 2, 3, 4)] + [one(nan, nan)],        # four with a change: no figure
        "Delta": [one(v, v) for v in (-5, -4, -3, -2, -1, 0)],               # median -2.5 / -2.5
    }
    hist, ofs = C.group_rank_history(groups, 2)
    assert hist["Alpha"]["m6"] == {"rank": [1, 1], "median": [30.0, 30.0], "n": [5, 5]}
    assert hist["Beta"]["m6"]["rank"] == [1, 1] and hist["Delta"]["m6"]["rank"] == [3, 3]
    assert hist["Gamma"]["m6"] == {"rank": [None, None], "median": [None, None], "n": [4, 4]}
    assert ofs == {"m6": [3, 3], "m3": [3, 3]}
    assert hist["Delta"]["m3"]["rank"] == [1, 1] and hist["Alpha"]["m3"]["rank"] == [2, 2]
    assert hist["Delta"]["m3"]["median"] == [-2.5, -2.5]
    assert C.group_rank_history({}, 3) == ({}, {"m6": [0, 0, 0], "m3": [0, 0, 0]})


def test_the_rank_summary_says_the_places_moved_and_the_best_and_worst_week():
    dates = [f"2031-01-{d:02d}" for d in range(1, 31)] + [f"2031-02-{d:02d}" for d in range(1, 24)]
    assert len(dates) == C.RANK_WEEKS + 1
    ranks = [10] * 53
    ranks[0], ranks[39], ranks[48], ranks[52] = 30, 20, 8, 5                 # 52, 13 and 4 points back, and now
    ranks[20], ranks[21], ranks[45] = 2, 2, 31                               # the best twice (the later one wins)
    ofs, ns, med = [40] * 53, [12] * 53, [1.5] * 53
    s = C.rank_summary(ranks, ofs, ns, med, dates)
    assert s["now"] == {"position": 5, "of": 40, "n": 12, "median": 1.5, "date": "2031-02-23"}
    assert (s["w4"]["position"], s["w4"]["change"]) == (8, 3)
    assert (s["w13"]["position"], s["w13"]["change"]) == (20, 15)
    assert (s["w52"]["position"], s["w52"]["change"], s["w52"]["date"]) == (30, 25, "2031-01-01")
    assert (s["best"]["position"], s["best"]["date"]) == (2, dates[21])
    assert (s["worst"]["position"], s["worst"]["date"]) == (31, dates[45]) and s["weeks_ranked"] == 53
    unranked = list(ranks)
    unranked[-1] = None
    assert C.rank_summary(unranked, ofs, ns, med, dates)["w4"]["change"] is None
    gap = list(dates)
    gap[48] = None
    assert C.rank_summary(ranks, ofs, ns, med, gap)["w4"] is None
    assert C.rank_summary([], [], [], [], [])["now"] is None


def test_the_build_adds_the_weekly_rank_from_the_same_single_read():
    ans, reads, _arts, _p = _build()
    assert reads == TECH + OIL                                              # one read each, no second pass
    rk = ans["rank"]
    assert rk["state"] == "ok" and len(rk["dates"]) == C.RANK_WEEKS + 1 and rk["dates"][-1] == ans["session"]
    assert rk["measures"] == [{"id": mid, "sessions": bars} for mid, bars in C.RANK_MEASURES]
    assert rk["counted"] == {"sector": {"groups": 2, "ranked": 1, "unranked": 1},
                             "industry": {"groups": 3, "ranked": 1, "unranked": 2}}
    tech = ans["kinds"]["sector"]["Technology"]["rank"]["m6"]
    assert tech["now"]["position"] == 1 and tech["now"]["of"] == 1 and tech["now"]["n"] == 6
    # the oldest point needs more closes than breadth keeps: it is there because the rank's tail is longer
    assert tech["rank"][0] == 1 and tech["n"][0] == 6 and tech["weeks_ranked"] == C.RANK_WEEKS + 1
    # three UP and three DOWN stocks: the median 6-month change is the middle of the two middle ones
    up_last = [c for _d, c in UP]
    down_last = [c for _d, c in DOWN]
    bars = dict(C.RANK_MEASURES)["m6"]
    want = ((up_last[-1] / up_last[-1 - bars] - 1) * 100 + (down_last[-1] / down_last[-1 - bars] - 1) * 100) / 2
    assert tech["now"]["median"] == round(want, 1)
    energy = ans["kinds"]["sector"]["Energy"]["rank"]["m6"]
    assert energy["now"] == {"position": None, "of": 1, "n": 3, "median": None, "date": ans["session"]}
    assert ans["build"]["rank_cpu_s"] >= 0


def test_the_longer_tail_leaves_breadth_exactly_as_it_was(monkeypatch):
    ans, *_ = _build()
    monkeypatch.setattr(C, "RANK_TAIL", 0)                                  # the tail breadth alone kept
    old, *_ = _build()
    for k in gs.KINDS:
        for name, block in ans["kinds"][k].items():
            assert block["breadth"] == old["kinds"][k][name]["breadth"], (k, name)
    assert ans["sessions"] == old["sessions"] and ans["line_dates"] == old["line_dates"]
    # and breadth still reads its full tail: six stocks with 400 closes have a 50-day average on every line day and a
    # 200-day average a month back
    tech = ans["kinds"]["sector"]["Technology"]["breadth"]
    assert None not in tech["line"] and tech["above200"]["month"]["n"] == 6 and tech["near_high"]["month"]["n"] == 6


def test_with_no_session_the_rank_is_unavailable():
    ans, *_ = _build(read_closes=lambda s: {"status": "unavailable"})
    assert ans["rank"]["state"] == "unavailable" and ans["rank"]["dates"] == []
    assert ans["kinds"]["sector"]["Technology"]["rank"] is None


def test_the_table_and_one_group_carry_the_rank(monkeypatch):
    _hold(monkeypatch)
    t = gs.get_group_stats("industry")
    assert t["sources"]["rank"]["state"] == "ok" and len(t["sources"]["rank"]["dates"]) == C.RANK_WEEKS + 1
    soft = next(g for g in t["groups"] if g["name"] == "Software")
    assert set(soft["rank"]) == {"m6", "m3"}
    assert set(soft["rank"]["m6"]) == {"now", "w4", "w13", "w52", "best", "worst", "weeks_ranked", "line"}
    assert "line" not in soft["rank"]["m3"] and len(soft["rank"]["m6"]["line"]) == C.RANK_WEEKS + 1
    assert soft["rank"]["m6"]["now"]["position"] == 1
    semis = next(g for g in t["groups"] if g["name"] == "Semiconductors")
    assert semis["rank"]["m6"]["now"] == {"position": None, "of": 1, "n": 1, "median": None, "date": "2031-06-04"}
    g = gs.get_group_stats("industry", "Software")
    assert len(g["rank"]["m6"]["rank"]) == len(g["rank"]["m6"]["of_line"]) == C.RANK_WEEKS + 1
    assert g["rank"]["m3"]["median"][-1] is not None and g["rank"]["m6"]["n"][-1] == 5
    assert "rank" not in gs.get_group_stats("industry", "Shipping")


def test_an_answer_held_from_before_the_rank_says_pending_and_is_rebuilt(monkeypatch):
    old = _fake_answer()
    old.pop("rank")
    for blocks in old["kinds"].values():
        for b in blocks.values():
            b.pop("rank")
    monkeypatch.setenv("FUNDAMENTALS_PIT_ENABLED", "1")
    with gs._lock:
        gs._state.update(answer=old, built_for="2031-06-04", loaded=True)
    t = gs.get_group_stats("sector")
    assert t["sources"]["rank"]["state"] == "pending" and all(g["rank"] is None for g in t["groups"])
    assert gs.get_group_stats("sector", "Technology")["rank"] is None
    assert gs.refresh_due(EVENING) is True                                  # built for this evening, but before the rank
    with gs._lock:
        gs._state.update(answer=_fake_answer())
    assert gs.refresh_due(EVENING) is False


def test_the_handler_is_a_plain_def_the_route_is_mounted_and_the_evening_job_registered():
    import inspect
    assert not inspect.iscoroutinefunction(route.get_group_stats)
    main = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
    assert "from api.routers import group_stats as group_stats_router" in main
    assert "app.include_router(group_stats_router.router)" in main
    assert '_boot_mark("GRPS-evening")' in main and main.count('_boot_mark("GRPS-evening")') == 1
    assert 'id="group_stats_evening"' in main and 'id="group_stats_boot"' in main
    assert "_group_stats.scheduled_refresh" in main
