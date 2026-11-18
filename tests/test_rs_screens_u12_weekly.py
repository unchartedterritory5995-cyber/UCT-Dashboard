"""RS screens unit U12, item W1: the WEEKLY RS new high.

The house lesson is the weekly RS line making a new high before price. Two screener
columns say it, on completed weeks only:

  * ``rs_nh_weekly``: the last completed week's RS value (weekly close / SPY's weekly
    close) is at or above the highest of the prior 52 completed weeks (a tie counts,
    as on the daily dot);
  * ``rs_nhbp_weekly``: that, while the weekly close is MORE than 3% below the highest
    weekly close of the same 52 weeks.

The maths is ``relative_strength.weekly_rs_high_last``; ``rs_columns.weekly_fields``
resamples, drops a week still in progress and asks it; ``snapshot_builder.build_row``
runs it only for a row on the RS liquid floor, only while ``RS_SCREENS_ENABLED`` is on.

Every expected value below is derived BY HAND from the scripted weekly closes, in the
comment beside it. The scripted series: each ISO week's sessions are the NYSE's own
(the exchange calendar), every session of a week closes at that week's scripted close
unless a test scripts a session, and SPY closes at 100 unless scripted.
"""
from __future__ import annotations

import datetime as dt
import importlib
import json
import re
import sqlite3
from pathlib import Path

import pytest

from api.services import relative_strength as rs
from api.services import session_calendar as sc
from api.services.screener import filters as F
from api.services.screener import methodology as M
from api.services.screener import rs_columns, rs_post_pass, rs_screens, saved_screens, snapshot_db
from api.services.screener import snapshot_builder as sb
from tests.test_screener_rs_columns import AAA, RSP, SPY, _arm_rs_v2

ROOT = Path(__file__).resolve().parents[1]
COLUMN_DEFS_JS = ROOT / "app" / "src" / "pages" / "screener" / "columnDefs.js"
PLAIN_WORDS_JS = ROOT / "app" / "src" / "pages" / "screener" / "focus" / "plainWords.js"
RS_ROWS_JS = ROOT / "app" / "src" / "pages" / "screener" / "focus" / "rsRows.js"
CLOSED_TABLE = ROOT / "app" / "src" / "components" / "chart" / "engine" / "ast" / "closedTable.json"

WEEKLY = ("rs_nh_weekly", "rs_nhbp_weekly")
#: The Monday of the newest scripted week, unless a test names another. Its Friday,
#: 2026-02-27, is an ordinary session.
LAST_MONDAY = dt.date(2026, 2, 23)
#: Good Friday 2026 is April 3, so the week of March 30 ends on Thursday April 2.
GOOD_FRIDAY_MONDAY = dt.date(2026, 3, 30)
BLANK = {"rs_nh_weekly": None, "rs_nhbp_weekly": None}


# ───────────────────────────── the fixtures ─────────────────────────────────

def _ymd(d):
    return d.year * 10000 + d.month * 100 + d.day


def _week_sessions(monday):
    return [d for d in (monday + dt.timedelta(days=i) for i in range(5)) if sc.is_trading_day(d)]


def _daily(week_closes, last_monday=LAST_MONDAY, cut=0, days=None):
    """Daily bars for ``len(week_closes)`` consecutive ISO weeks ending with the week of
    ``last_monday``. ``cut`` drops that many sessions from the END of the newest week (a
    week still in progress). ``days`` scripts single sessions: ``{(week index, session
    index): close}``."""
    n = len(week_closes)
    bars = []
    for w, close in enumerate(week_closes):
        monday = last_monday - dt.timedelta(weeks=n - 1 - w)
        sessions = _week_sessions(monday)
        if w == n - 1 and cut:
            sessions = sessions[:-cut]
        for s, d in enumerate(sessions):
            c = float((days or {}).get((w, s), close))
            bars.append({"t": _ymd(d), "o": c, "h": c, "l": c, "c": c, "v": 1000})
    return bars


def _flat(n, edits=None, base=100.0):
    closes = [base] * n
    for i, v in (edits or {}).items():
        closes[i] = v
    return closes


def _fields(stock_weeks, spy_weeks=None, **kw):
    spy_kw = {k: v for k, v in kw.items() if k in ("last_monday",)}
    spy = _daily(spy_weeks if spy_weeks is not None else _flat(len(stock_weeks)), **spy_kw)
    session = kw.pop("session", None)
    return rs_columns.weekly_fields(_daily(stock_weeks, **kw), spy, session=session)


# ───────────────────────── the two columns, by hand ─────────────────────────

def test_the_two_columns_and_their_numbers():
    assert rs_columns.WEEKLY_COLUMNS == WEEKLY
    assert (rs.WEEKLY_NH_LOOKBACK, rs.WEEKLY_NHBP_BELOW_PCT) == (52, 3.0)
    assert rs_columns.WEEKLY_LOOKBACK == 52 and rs_columns.WEEKLY_MIN_WEEKS == 53
    assert rs_columns.WEEKLY_BELOW_PCT == 3.0
    # 290 sessions are at least 58 weeks: 53 completed, one in progress, room to spare
    assert rs_columns.WEEKLY_DAILY_TAIL // 5 - 1 >= rs_columns.WEEKLY_MIN_WEEKS


def test_a_new_weekly_high():
    """52 weeks at 100, then a week at 101, SPY flat: the RS value 1.01 is above the prior
    high 1.00. The close is its own high, so it is not "before price"."""
    assert _fields(_flat(53, {52: 101.0})) == {"rs_nh_weekly": 1, "rs_nhbp_weekly": 0}


def test_a_tie_is_a_new_high():
    """53 weeks at 100: the newest RS value EQUALS the prior high. The daily dot counts a
    tie (`rolling_extreme_event`), and so does the weekly reading."""
    assert _fields(_flat(53)) == {"rs_nh_weekly": 1, "rs_nhbp_weekly": 0}


def test_a_week_below_the_prior_high_is_not_one():
    """Week 10 closed at 105 (RS 1.05), the newest at 100 (RS 1.00): no high. It is also
    4.76% under the 105 close, and still not "before price": that needs the RS high."""
    assert _fields(_flat(53, {10: 105.0})) == {"rs_nh_weekly": 0, "rs_nhbp_weekly": 0}


def test_52_completed_weeks_are_blank_and_53_are_not():
    assert _fields(_flat(52, {51: 101.0})) == BLANK
    assert _fields(_flat(53, {52: 101.0})) == {"rs_nh_weekly": 1, "rs_nhbp_weekly": 0}
    assert _fields([]) == BLANK


def test_only_the_prior_52_weeks_are_read():
    """54 weeks. A 200 close 53 weeks before the newest is outside the 52 prior weeks, so
    101 is a high; the same 200 one week later (52 weeks before) is inside, so it is not."""
    assert _fields(_flat(54, {0: 200.0, 53: 101.0})) == {"rs_nh_weekly": 1, "rs_nhbp_weekly": 0}
    assert _fields(_flat(54, {1: 200.0, 53: 101.0})) == {"rs_nh_weekly": 0, "rs_nhbp_weekly": 0}


@pytest.mark.parametrize("close, expect", [
    # SPY's newest week closes at 90, so the RS value (close / 90) beats the prior 1.00
    # in all three rows. The prior weekly closing high is 100.
    (96.9, 1),      # 3.1% below 100: more than 3%, before price
    (97.1, 0),      # 2.9% below: price is near its high
    (97.0, 0),      # exactly 3% below: "more than 3%" does not include 3%
])
def test_the_three_percent_rule(close, expect):
    got = _fields(_flat(53, {52: close}), _flat(53, {52: 90.0}))
    assert got == {"rs_nh_weekly": 1, "rs_nhbp_weekly": expect}


def test_before_price_reads_the_weekly_close_against_the_prior_weeks_only():
    """The newest close 110 is ABOVE every prior close: 0% below, never before price, even
    though the RS value is a high."""
    assert _fields(_flat(53, {52: 110.0})) == {"rs_nh_weekly": 1, "rs_nhbp_weekly": 0}


# ───────────────────────── completed weeks only ─────────────────────────

def test_a_week_still_in_progress_is_not_read():
    """53 completed weeks, week 10 at 105, then a 54th week closing 150 every session.
    Through Wednesday or Thursday that week is not over (Friday February 27 is a session):
    the newest COMPLETED week closed at 100 against a prior 105, no high. Through Friday it
    counts: 150 beats everything."""
    weeks = _flat(54, {10: 105.0, 53: 150.0})
    assert _fields(weeks, cut=2) == {"rs_nh_weekly": 0, "rs_nhbp_weekly": 0}     # Mon-Wed
    assert _fields(weeks, cut=1) == {"rs_nh_weekly": 0, "rs_nhbp_weekly": 0}     # Mon-Thu
    assert _fields(weeks, cut=4) == {"rs_nh_weekly": 0, "rs_nhbp_weekly": 0}     # Monday only
    assert _fields(weeks) == {"rs_nh_weekly": 1, "rs_nhbp_weekly": 0}            # the week is over


def test_the_week_in_progress_does_not_count_towards_the_53():
    """52 completed weeks and three sessions of a 53rd: 53 weekly bars, 52 completed."""
    assert _fields(_flat(53, {52: 150.0}), cut=2) == BLANK


def test_a_week_ends_on_thursday_before_a_friday_holiday():
    """The week of March 30, 2026 has four sessions (Good Friday). Through Thursday it is
    over and its 150 close is a high; through Wednesday it is not."""
    assert not sc.is_trading_day(dt.date(2026, 4, 3)) and sc.is_trading_day(dt.date(2026, 4, 2))
    weeks = _flat(54, {10: 105.0, 53: 150.0})
    assert _fields(weeks, last_monday=GOOD_FRIDAY_MONDAY) == {"rs_nh_weekly": 1, "rs_nhbp_weekly": 0}
    assert _fields(weeks, last_monday=GOOD_FRIDAY_MONDAY, cut=1) == {"rs_nh_weekly": 0, "rs_nhbp_weekly": 0}


def test_a_week_is_its_last_sessions_close():
    """Week 20 closed 300 on its Wednesday and 100 on its Friday. The weekly close is 100,
    so the newest 101 is a high. Read as a daily high it would not be."""
    assert _fields(_flat(53, {52: 101.0}), days={(20, 2): 300.0}) == {"rs_nh_weekly": 1, "rs_nhbp_weekly": 0}
    # and a week whose LAST session closed high does block it
    assert _fields(_flat(53, {52: 101.0}), days={(20, 4): 300.0}) == {"rs_nh_weekly": 0, "rs_nhbp_weekly": 0}


def test_bars_after_the_session_are_not_read():
    """The newest week closed at 150. Asked for the Friday before it, the answer is the
    week before's: 100 against a prior 105."""
    weeks = _flat(54, {10: 105.0, 53: 150.0})
    prior_friday = _ymd(LAST_MONDAY - dt.timedelta(days=3))
    assert _fields(weeks, session=prior_friday) == {"rs_nh_weekly": 0, "rs_nhbp_weekly": 0}
    assert _fields(weeks, session=_ymd(LAST_MONDAY + dt.timedelta(days=4))) == \
        {"rs_nh_weekly": 1, "rs_nhbp_weekly": 0}


def test_a_week_the_calendar_cannot_judge_is_blank(monkeypatch):
    """Mid-week, the answer depends on whether Thursday and Friday are sessions. When the
    exchange calendar does not cover them the columns are blank, never a guessed holiday."""
    weeks = _flat(54, {53: 150.0})
    assert _fields(weeks, cut=2) == {"rs_nh_weekly": 1, "rs_nhbp_weekly": 0}, "the tie of the week before"
    monkeypatch.setattr(sc, "covers", lambda d, cal=None: False)
    assert _fields(weeks, cut=2) == BLANK
    assert _fields(weeks) == {"rs_nh_weekly": 1, "rs_nhbp_weekly": 0}, "a Friday close asks the calendar nothing"


# ───────────────────────── the benchmark, the tail, the shapes ─────────────────────────

def test_a_benchmark_hole_is_blank_never_a_shifted_ratio():
    stock = _daily(_flat(53, {52: 101.0}))
    spy = _daily(_flat(53))
    newest_week = {b["t"] for b in stock[-5:]}
    assert rs_columns.weekly_fields(stock, [b for b in spy if b["t"] not in newest_week]) == BLANK
    week_30 = {_ymd(d) for d in _week_sessions(LAST_MONDAY - dt.timedelta(weeks=22))}
    holed = [b for b in spy if b["t"] not in week_30]
    assert len(holed) == len(spy) - 5, "one whole ISO week of SPY is gone"
    assert rs_columns.weekly_fields(stock, holed) == BLANK, "a window with a hole has no honest maximum"
    assert rs_columns.weekly_fields(stock, []) == BLANK


def test_only_the_tail_is_resampled_and_it_is_the_whole_series_answer(monkeypatch):
    """130 weeks with a 500 close in week 5: far outside the 52 weeks read. The answer is
    the newest 60 weeks' answer, and the ticker's resample is handed at most the tail."""
    weeks = _flat(130, {5: 500.0, 100: 105.0, 129: 104.0})
    stock, spy = _daily(weeks), _daily(_flat(130))
    seen = []
    real = rs_columns._weekly

    def _counted(bars):
        seen.append(len(bars))
        return real(bars)
    monkeypatch.setattr(rs_columns, "_weekly", _counted)
    got = rs_columns.weekly_fields(stock, spy)
    assert got == {"rs_nh_weekly": 0, "rs_nhbp_weekly": 0}           # 104 against week 100's 105
    assert seen[0] == rs_columns.WEEKLY_DAILY_TAIL and len(stock) > 600
    monkeypatch.undo()
    assert got == rs_columns.weekly_fields(_daily(weeks[-60:]), _daily(_flat(60)))
    weeks[100] = 100.0
    assert rs_columns.weekly_fields(_daily(weeks), spy) == {"rs_nh_weekly": 1, "rs_nhbp_weekly": 0}


def test_the_benchmark_is_resampled_once_per_session(monkeypatch):
    spy = _daily(_flat(70))
    cache, n = {}, []
    real = rs_columns._weekly

    def _counted(bars):
        n.append(len(bars))
        return real(bars)
    monkeypatch.setattr(rs_columns, "_weekly", _counted)
    for edit in ({59: 101.0}, {59: 99.0}, {}):
        rs_columns.weekly_fields(_daily(_flat(60, edit)), spy, weekly_cache=cache)
    assert len(cache) == 1
    assert n.count(len(spy)) == 1, "SPY's own resample ran once for three tickers"


def test_a_series_with_no_dates_has_no_weeks():
    closes = [100.0 + 0.1 * i for i in range(400)]
    assert rs_columns.weekly_fields(closes, [100.0] * 400) == BLANK
    assert rs_columns.weekly_fields(_daily(_flat(53)), [100.0] * 400) == \
        {"rs_nh_weekly": 1, "rs_nhbp_weekly": 0}, "a float benchmark takes the ticker's dates"


def test_the_values_are_whole_numbers():
    got = _fields(_flat(53, {52: 96.9}), _flat(53, {52: 90.0}))
    assert all(isinstance(v, int) and not isinstance(v, bool) for v in got.values())


# ───────────────────────── the maths, asked directly ─────────────────────────

def _wk(closes):
    return [{"t": f"w{i:03d}", "c": c} for i, c in enumerate(closes)]


def test_the_maths_on_weekly_bars_directly():
    flat = _wk([100.0] * 53)
    assert rs.weekly_rs_high_last(flat, flat) == {"rsNH": 1.0, "rsNHbeforePx": 0.0}
    assert rs.weekly_rs_high_last(flat[:52], flat) == {"rsNH": None, "rsNHbeforePx": None}
    bench = _wk([100.0] * 52 + [90.0])
    assert rs.weekly_rs_high_last(_wk([100.0] * 52 + [96.0]), bench) == {"rsNH": 1.0, "rsNHbeforePx": 1.0}
    # a shorter lookback and a wider tolerance are the caller's to pass
    assert rs.weekly_rs_high_last(_wk([100.0] * 4 + [96.0]), _wk([100.0] * 4 + [90.0]), 4, 5.0) == \
        {"rsNH": 1.0, "rsNHbeforePx": 0.0}
    # the newest week has no benchmark bar: no ratio, no answer
    assert rs.weekly_rs_high_last(flat, flat[:-1]) == {"rsNH": None, "rsNHbeforePx": None}
    assert rs.weekly_rs_high_last(flat, flat, 0) == {"rsNH": None, "rsNHbeforePx": None}


def test_the_weekly_high_is_the_daily_rule_on_weekly_bars():
    """One rule, two time frames: the weekly answer is the Phase 1 pass's `rsNH` and
    `rsNHbeforePx` asked of the same weekly bars at a 52-bar lookback and a 3% tolerance."""
    import random
    rnd = random.Random(12)
    for _ in range(60):
        stock = _wk([100.0 * (1 + rnd.uniform(-0.2, 0.2)) for _ in range(53)])
        bench = _wk([100.0 * (1 + rnd.uniform(-0.1, 0.1)) for _ in range(53)])
        p1 = rs.compute_phase1_columns(stock, bench, {"lookback": 52, "priceTolerance": 3.0})
        assert rs.weekly_rs_high_last(stock, bench) == \
            {"rsNH": p1["rsNH"][-1], "rsNHbeforePx": p1["rsNHbeforePx"][-1]}


# ───────────────────────── the build ─────────────────────────

LIQUID = {"avg_volume_30d": 5_000_000.0}        # x a price near 135: far over $20M a day


@pytest.fixture
def on(monkeypatch):
    _arm_rs_v2(monkeypatch)
    monkeypatch.setenv("RS_SCREENS_ENABLED", "1")


def _row(bars=AAA, name="AAA", market_row=LIQUID, **kw):
    failures = {}
    row = sb.build_row(name, bars, None, None, failures=failures, spy_bars=SPY, rsp_bars=RSP,
                       market_row=market_row, **kw)
    return row, failures


def test_the_build_writes_the_two_for_a_liquid_row(on):
    """AAA gains 0.1% a session for 60 weeks against a flat SPY: every weekly RS value is
    a high, and the weekly close is its own high. The fixture ends on Friday 2026-02-27."""
    assert AAA[-1]["t"] == 20260227
    timing = {}
    row, failures = _row(rs_timing=timing)
    assert row["price"] >= 10 and row["dollar_vol_30d"] >= 20_000_000
    assert (row["rs_nh_weekly"], row["rs_nhbp_weekly"]) == (1, 0)
    assert {c: row[c] for c in WEEKLY} == rs_columns.weekly_fields(AAA, SPY)
    assert "bars_rs_weekly" not in failures
    assert timing["weekly_rows"] == 1 and timing["weekly_ms"] >= 0
    assert row["rs_nh_bars_ago"] == 9 and row["rs_nh_count_20"] == 11, "the daily columns stand"


@pytest.mark.parametrize("why, kw", [
    ("under $20M traded a day", {"market_row": {"avg_volume_30d": 1000.0}}),
    ("no volume on the row", {"market_row": {}}),
])
def test_a_row_off_the_liquid_floor_is_not_computed(on, monkeypatch, why, kw):
    def _never(*a, **k):
        raise AssertionError(f"weekly_fields ran for a row off the floor ({why})")
    monkeypatch.setattr(rs_columns, "weekly_fields", _never)
    timing = {}
    row, failures = _row(rs_timing=timing, **kw)
    assert [row[c] for c in WEEKLY] == [None, None], why
    assert "weekly_rows" not in timing and "bars_rs_weekly" not in failures


def test_a_cheap_stock_and_a_fund_are_off_the_floor(on, monkeypatch):
    monkeypatch.setattr(rs_columns, "weekly_fields",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("ran")))
    cheap = [{**b, "o": b["o"] / 20, "h": b["h"] / 20, "l": b["l"] / 20, "c": b["c"] / 20} for b in AAA]
    row, _ = _row(cheap, market_row={"avg_volume_30d": 50_000_000.0})
    assert row["price"] < 10 and row["dollar_vol_30d"] > 20_000_000 and row["rs_nh_weekly"] is None
    monkeypatch.setattr(sb, "_security_types", lambda: {"AAA": "ETF"})
    row, _ = _row()
    assert row["is_etf"] is True and row["rs_nh_weekly"] is None
    assert sb._on_rs_floor({"price": 50.0, "dollar_vol_30d": 3e7, "is_etf": False}) is True
    assert sb._on_rs_floor({"price": 50.0, "dollar_vol_30d": 3e7}) is True, "no full year is asked"


def test_flag_off_the_weekly_step_does_not_run(monkeypatch):
    _arm_rs_v2(monkeypatch)
    monkeypatch.delenv("RS_SCREENS_ENABLED", raising=False)
    monkeypatch.setattr(rs_columns, "weekly_fields",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("ran while off")))
    timing = {}
    row, failures = _row(rs_timing=timing)
    assert [row[c] for c in WEEKLY] == [None, None]
    assert sorted(timing) == ["ms", "rows"] and "bars_rs_weekly" not in failures


def test_without_the_rs_step_or_a_benchmark_there_is_no_weekly_reading(on, monkeypatch):
    failures = {}
    row = sb.build_row("AAA", AAA, None, None, failures=failures, market_row=LIQUID)   # no SPY
    assert [row[c] for c in WEEKLY] == [None, None]
    monkeypatch.setattr(sb, "rs_v2_enabled", lambda: False)
    row, _ = _row()
    assert [row[c] for c in WEEKLY] == [None, None]


def test_a_series_that_contradicts_itself_gets_no_weekly_reading(on):
    closes = [100.0] * 300
    for i in (250, 251, 260, 261, 270, 271):
        closes[i] = 50.0
    bars = [{**b, "o": c, "h": c, "l": c, "c": c} for b, c in zip(AAA, closes)]
    row, failures = _row(bars, "SEAM")
    assert [row[c] for c in WEEKLY] == [None, None]
    assert failures["bars_rs_weekly"] == {"series_contradicts_itself": 1}
    assert rs_columns.weekly_fields(bars, SPY)["rs_nh_weekly"] is not None, "the maths alone would answer"


def test_a_raising_weekly_step_costs_its_two_columns_only(on, monkeypatch):
    def _boom(*a, **k):
        raise RuntimeError("dead")
    monkeypatch.setattr(rs_columns, "weekly_fields", _boom)
    row, failures = _row()
    assert [row[c] for c in WEEKLY] == [None, None]
    assert failures["bars_rs_weekly"] == {"RuntimeError": 1}
    assert row["rs_nh_count_20"] == 11 and row["rs_setup"] == "uptrend" and row["price"] == AAA[-1]["c"]


def test_the_identity_holds_on_a_built_row(on):
    from api.services.screener import identities
    ident = {i.name: i for i in identities.build_identities()}["rs_nhbp_weekly_implies_rs_nh_weekly"]
    assert ident.severity == "proof" and ident.columns == WEEKLY[::-1]
    state = {}
    row = sb.build_row("AAA", AAA, None, None, spy_bars=SPY, rsp_bars=RSP, market_row=LIQUID,
                       identity_state=state)
    assert identities.verdict(ident, row).state == "satisfied"
    assert identities.verdict(ident, {"rs_nhbp_weekly": 1, "rs_nh_weekly": 0}).state == "violated"
    assert ident.name not in state


def _stub_build(monkeypatch, tmp_path):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "rs.db"))
    import api.services.screener.snapshot_builder as b
    import api.services.screener.snapshot_db as sdb
    importlib.reload(sdb)
    importlib.reload(b)
    from tests.test_screener_rs_columns import CCC
    series = {"AAA": AAA, "CCC": CCC, "SPY": SPY, "RSP": RSP}
    monkeypatch.setattr(b, "_load_universe", lambda: ["AAA", "CCC"])
    monkeypatch.setattr(b, "_read_daily_bars", lambda t: list(series.get(t, [])))
    monkeypatch.setattr(b, "_read_ratings", lambda t, failures=None: {})
    monkeypatch.setattr(b, "_read_fundamentals", lambda t, price=None, failures=None: {})
    monkeypatch.setattr(b, "_read_rs_map", lambda: {})
    monkeypatch.setattr(b, "_read_bulk_fundamentals", lambda targets, failures=None: {})
    from api.services.screener import context_joins as cj
    for fn in ("read_breadth_flags", "read_uct20", "read_index_flags", "read_etf_flags"):
        monkeypatch.setattr(cj, fn, lambda targets, failures=None: {})
    return b, sdb


def test_run_build_stores_the_two_and_times_the_step_apart(on, tmp_path, monkeypatch):
    """Both fixture rows trade 1,000 shares a day, so neither is on the floor: the step
    runs for none, and the receipt says so. One made liquid, it runs for that one."""
    b, sdb = _stub_build(monkeypatch, tmp_path)
    stats = b.run_build()
    t = stats["bars_rs"]
    assert (t["weekly_rows"], t["weekly_ms"], t["weekly_ms_per_row"]) == (0, 0.0, None)
    assert t["screens_rows"] == 2, "the daily steps' own count is untouched"
    real = b.build_row
    monkeypatch.setattr(b, "build_row", lambda t_, *a, **k: real(
        t_, *a, **{**k, "market_row": {**(k.get("market_row") or {}), **(LIQUID if t_ == "AAA" else {})}}))
    stats = b.run_build()
    t = stats["bars_rs"]
    assert t["weekly_rows"] == 1 and isinstance(t["weekly_ms"], float)
    assert t["weekly_ms_per_row"] == round(t["weekly_ms"] / 1, 3)
    assert stats["populated"]["rs_nh_weekly"] == 1 and stats["populated"]["rs_nhbp_weekly"] == 1
    with sdb.connect() as conn:
        got = {r["ticker"]: (r["rs_nh_weekly"], r["rs_nhbp_weekly"]) for r in conn.execute(
            "SELECT ticker, rs_nh_weekly, rs_nhbp_weekly FROM screener_rows")}
    assert got == {"AAA": (1, 0), "CCC": (None, None)}


def test_the_step_sits_after_the_dollar_volume_it_is_gated_on():
    src = Path(sb.__file__).read_text(encoding="utf-8")
    assert src.index('row["dollar_vol_30d"] = row["price"] * row["avg_volume_30d"]') < \
        src.index('_step("bars_rs_weekly"')
    assert src.count('_step("bars_rs_weekly"') == 1


# ───────────────────────── the schema and the registries ─────────────────────────

def test_the_two_columns_are_declared_whole_and_written_by_the_loop(tmp_path, monkeypatch):
    for c in WEEKLY:
        assert snapshot_db.COLUMNS.count(c) == 1 and snapshot_db._coldef(c) == f"{c} INTEGER", c
        assert c in snapshot_db._INT
    assert not (set(WEEKLY) & snapshot_db.POST_PASS_COLUMNS), "the build loop writes these"
    db = tmp_path / "old.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(db))
    with sqlite3.connect(db) as conn:
        conn.execute("CREATE TABLE screener_rows (ticker TEXT PRIMARY KEY, price REAL)")
    snapshot_db.init_db()
    with sqlite3.connect(db) as conn:
        info = {r[1]: r[2] for r in conn.execute("PRAGMA table_info(screener_rows)")}
    assert [info[c] for c in WEEKLY] == ["INTEGER", "INTEGER"]


LABELS = {"rs_nh_weekly": "Weekly RS new high", "rs_nhbp_weekly": "Weekly RS high before price"}
BANNED = re.compile(r"\b(buys|buying|buyable|sell|sells|selling|RSI)\b|\bbuy\b(?! point)", re.I)


def test_each_is_a_dark_relative_strength_control_kept_from_the_agent():
    catalog = {f["key"]: f for f in F.field_catalog()}
    for key, label in LABELS.items():
        f = F.FILTERS[key]
        assert (f["label"], f["type"], f["category"], f["column"]) == (label, "bool", "relative_strength", key)
        assert f.get("agent_omit") is True and catalog[key].get("agent_omit") is True, key
        assert key in F.RS_SCREENS_KEYS and key in F.VIEWS["relative_strength"]["columns"]
        assert F.is_valid_op(key, "eq")
    for v2 in (True, False):
        assert set(WEEKLY) <= F.rs_dark_keys(v2_on=v2, history_on=True, v3_on=True, screens_on=False)
        assert not (set(WEEKLY) & F.rs_dark_keys(v2_on=v2, history_on=False, v3_on=False, screens_on=True))


def test_each_publishes_a_method_with_the_writers_numbers(monkeypatch):
    for key, label in LABELS.items():
        m = M.for_column(key)
        assert m is not None and m["label"] == label and m["family"] == M.RS_FAMILY, key
        assert m["how"].endswith(M._RS_SCREENS_BUILD_NOTE) and "Blank until the stock has 53 finished weeks" in m["how"]
        text = " ".join(m[k] for k in ("one_line", "scale", "how", "caveat"))
        assert "—" not in text and "–" not in text and not BANNED.search(text), key
        assert "of the 52 weeks before it" in m["how"] and "price of $10" in m["how"] and "$20M" in m["how"]
    assert "more than 3% below the highest weekly close of the same 52 weeks" in M.for_column("rs_nhbp_weekly")["how"]
    monkeypatch.setattr(rs_columns, "WEEKLY_LOOKBACK", 40)
    monkeypatch.setattr(rs_columns, "WEEKLY_MIN_WEEKS", 41)
    monkeypatch.setattr(rs_columns, "WEEKLY_BELOW_PCT", 4.5)
    how = M.for_column("rs_nhbp_weekly")["how"]
    assert "41 finished weeks" in how and "of the 40 weeks before it" in how and "more than 4.5% below" in how


def test_the_client_registries_name_both_and_state_the_same_numbers():
    src = COLUMN_DEFS_JS.read_text(encoding="utf-8")
    plain = PLAIN_WORDS_JS.read_text(encoding="utf-8")
    for key in WEEKLY:
        m = re.search(rf"\n  {key}: \{{ label: '([^']*)', fmt: tri,\s*\n    desc: '((?:[^'\\]|\\.)*)' \}},", src)
        assert m, f"{key} has no column definition"
        desc = m.group(2)
        assert len(desc) > 60 and "—" not in desc and not BANNED.search(desc), key
        assert f"{rs_columns.WEEKLY_LOOKBACK} weeks" in desc and f"{rs_columns.WEEKLY_MIN_WEEKS} finished weeks" in desc
        assert re.search(rf"\n  {key}: '[^']+',", plain), f"{key} has no plain name"
    assert f"more than {rs_columns.WEEKLY_BELOW_PCT:g}% below" in src
    table = json.loads(CLOSED_TABLE.read_text(encoding="utf-8"))
    for key in WEEKLY:
        assert key not in table["scalars"]
        why = table["_scalars_excluded"][key]
        assert "2026-11-14" in why and "RS_SCREENS_ENABLED" in why and "unit U12" in why, key


# ───────────────────────── the contract: the tag and When -> Weekly ─────────────────────────

@pytest.fixture
def starters_on(monkeypatch):
    from api.services.signature import registry_defs
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", True)
    monkeypatch.setenv("RS_SCREENS_ENABLED", "1")
    return {s["id"]: s for s in saved_screens.starters()}


def test_the_weekly_tag_follows_earnings_on_the_two_rs_high_screens(starters_on):
    assert starters_on["starter_rs_new_high"]["row"]["tags"] == \
        ["earnings", "weekly", "before_price", "down_day", "flag", "new"]
    assert starters_on["starter_rs_nh_before_price"]["row"]["tags"] == \
        ["earnings", "weekly", "down_day", "flag", "new"]
    for sid in ("starter_rs_top_rating", "starter_rs_leaders", "starter_rs_exit_warning_5"):
        assert "weekly" not in starters_on[sid]["row"]["tags"], sid
    assert rs_screens.WEEKLY_TAG == "weekly"


@pytest.mark.parametrize("sid, age_key, weekly_key", [
    ("starter_rs_new_high", "rs_nh_bars_ago", "rs_nh_weekly"),
    ("starter_rs_nh_before_price", "rs_nhbp_age", "rs_nhbp_weekly"),
])
def test_when_gains_a_weekly_choice_that_clears_the_daily_age(starters_on, sid, age_key, weekly_key):
    st = starters_on[sid]
    when = next(c for c in st["controls"] if c["id"] == "when")
    assert when["keys"] == [age_key, weekly_key]
    assert [o["id"] for o in when["options"]] == ["today", "week", "month", "weekly"]
    weekly = when["options"][3]
    assert weekly == {"id": "weekly", "label": "Weekly",
                      "filters": [{"key": weekly_key, "op": "eq", "value": 1}]}
    assert [o["id"] for o in when["options"] if o.get("default")] == ["week"]
    # the default spec carries no weekly clause; the daily options carry none either
    assert not [f for f in st["spec"]["filters"] if f["key"] == weekly_key]
    for o in when["options"][:3]:
        assert [f["key"] for f in o["filters"]] == [age_key]
    # no other control of the screen owns either key
    others = [k for c in st["controls"] if c["id"] != "when" for k in c["keys"]]
    assert age_key not in others and weekly_key not in others


def test_the_weekly_choice_lists_weekly_highs_whatever_their_daily_age(tmp_path, monkeypatch, starters_on):
    """Applied the way the client applies an option (every clause on the control's keys
    replaced by the option's): a stock whose daily RS high is 30 sessions old is on the
    Weekly list and on none of the daily ones; a stock with a fresh daily high and no
    weekly one is the reverse."""
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    snapshot_db.init_db()
    base = {"security_type": "Stock", "snapshot_date": "2026-11-13", "built_at": 1, "price": 50.0,
            "dollar_vol_30d": 5e7, "pct_vs_sma200": 10.0, "px_below_high_pct": -8.0, "rs_rating_score": 1.2}
    snapshot_db.upsert_rows([
        {**base, "ticker": "WKLY", "rs_nh_bars_ago": 30, "rs_nhbp_age": None, "rs_nh_weekly": 1, "rs_nhbp_weekly": 1},
        {**base, "ticker": "DAILY", "rs_nh_bars_ago": 1, "rs_nhbp_age": 1, "rs_nh_weekly": 0, "rs_nhbp_weekly": 0},
        {**base, "ticker": "BLANK", "rs_nh_bars_ago": 2, "rs_nhbp_age": 2},
    ])
    from api.services.screener import query
    monkeypatch.setattr(query, "stale_gate", lambda conn: None)

    def run(sid, option_id):
        st = starters_on[sid]
        when = next(c for c in st["controls"] if c["id"] == "when")
        option = next(o for o in when["options"] if o["id"] == option_id)
        spec = {**st["spec"], "filters": [f for f in st["spec"]["filters"] if f["key"] not in when["keys"]]
                + option["filters"]}
        return sorted(r["ticker"] for r in query.run_scan(spec)["rows"])

    for sid in ("starter_rs_new_high", "starter_rs_nh_before_price"):
        assert run(sid, "weekly") == ["WKLY"], sid
        assert run(sid, "week") == ["BLANK", "DAILY"], sid
        assert run(sid, "month") == ["BLANK", "DAILY"], sid


def test_the_client_words_the_tag_from_the_weekly_high_column():
    src = RS_ROWS_JS.read_text(encoding="utf-8")
    assert re.search(r"weekly:\s*\['rs_nh_weekly'\]", src), "the weekly tag's column moved"
    assert "row?.rs_nh_weekly === 1 ? 'Weekly RS high' : ''" in src


def test_the_method_page_says_what_the_weekly_reading_is(starters_on, monkeypatch):
    doc = M.rs_screens_section()
    assert doc["weekly"] == (
        "The Weekly RS high tag and the Weekly choice of When read weekly closes in place of daily "
        "ones: the stock's weekly RS line finished its last full week at or above its highest value "
        "of the 52 weeks before, and on RS New High Before Price the Weekly choice also needs that "
        "week's close more than 3% below its highest weekly close of those 52 weeks.")
    assert doc["weekly"].count(".") == 1, "one sentence"
    by_id = {s["id"]: s for s in doc["screens"]}
    for sid in ("starter_rs_new_high", "starter_rs_nh_before_price"):
        assert "or Weekly, which reads finished weeks in place of sessions." in by_id[sid]["controls"], sid
    monkeypatch.setattr(rs_columns, "WEEKLY_BELOW_PCT", 5.0)
    assert "more than 5% below" in M.rs_screens_section()["weekly"]
