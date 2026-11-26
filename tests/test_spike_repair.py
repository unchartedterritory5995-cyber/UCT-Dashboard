"""The targeted stored-bar spike repair (2026-11-26, `api/services/spike_repair.py`, the spike probe).

A vendor bar whose wick came from a print the live fold never counts (derivatively priced, out of sequence,
contingent) is flagged only when the wick beyond the body exceeds max(3 x the day's median range, 0.3% of price),
re-aggregated from its trades with the live fold's rule, and its high/low replaced only where that differs. A real move
(every eligible print supports the extreme) stays. A real bars.db in a temp dir; the vendor's trades are stubbed.
"""
from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from api.services import bars_fetch, spike_repair as sr
from api.services import bars_live_store as bls

_ET = ZoneInfo("America/New_York")
OLD = date(2024, 5, 20)                    # a Monday
NEW = date(2026, 11, 11)                   # a Wednesday


def _ts(d, h, mi, s=0) -> int:
    return int(datetime(d.year, d.month, d.day, h, mi, s, tzinfo=_ET).timestamp())


def _day(d, step, start=(9, 30), end=(16, 0), px=60.0):
    out, t, i = [], _ts(d, *start), 0
    while t < _ts(d, *end):
        p = px + (i % 5) * 0.02
        out.append({"t": t, "o": p, "h": p + 0.06, "l": p - 0.05, "c": p + 0.03, "v": 1000 + i})
        t += step * 60
        i += 1
    return out


def _trade(d, h, mi, s, price, cond=None, size=100):
    return {"sip_timestamp": _ts(d, h, mi, s) * 10**9, "price": price, "size": size, "conditions": cond}


@pytest.fixture
def env(tmp_path, monkeypatch):
    from api.services import bars_sqlite as sq, trade_conditions as tc
    monkeypatch.setattr(sq, "_DB_PATH", str(tmp_path / "bars.db"))
    sq.bump_db_epoch()
    sq.init_db()
    bls._reset_for_tests()
    monkeypatch.setattr(tc, "FILTER_ENABLED", True)
    monkeypatch.setattr(tc, "_hl_ineligible", set(tc._HL_INELIGIBLE_FALLBACK) | set(tc._HL_PINNED))
    trades = {"rows": [], "calls": [], "fail": False}

    def _pages(sym, lo, hi, take):
        take()
        trades["calls"].append((sym, lo, hi))
        if trades["fail"]:
            raise RuntimeError("provider 503")
        yield [t for t in trades["rows"] if lo * 10**9 <= t["sip_timestamp"] < hi * 10**9]
    yield sq, trades, _pages
    bls._reset_for_tests()
    sq.bump_db_epoch()


def _row(sq, sym, tf, t):
    return next((r for r in sq.get_bars_since(sym, tf, t - 1) if int(r[0]) == t), None)


def test_the_flag_needs_more_than_three_median_ranges_and_more_than_0_3_percent():
    d = OLD
    rows = [(r["t"], r["o"], r["h"], r["l"], r["c"], r["v"]) for r in _day(d, 15)]
    k = 15                                                    # 13:15 ET
    t, o, h, l, c, v = rows[k]
    rows[k] = (t, o, h, 57.65, c, v)                          # a $2.40 wick under the body
    rows[k + 1] = (rows[k + 1][0], rows[k + 1][1], rows[k + 1][2] + 0.10, rows[k + 1][3], rows[k + 1][4], rows[k + 1][5])
    flagged = sr.flag(rows)
    assert [int(r[0]) for r in flagged] == [t], "only the deep wick; a 10-cent wick (3 x median, under 0.3%) is not"


def test_a_wick_from_a_pinned_print_is_repaired_and_nothing_else_moves(env):
    sq, trades, pages = env
    day = _day(OLD, 15)
    spike = next(b for b in day if b["t"] == _ts(OLD, 13, 30))
    spike["l"] = 57.65                                        # the vendor counted the late-reported prints
    sq.put_bars("RDDT", "15", day)
    sq.put_bars("RDDT", "15", [{"t": _ts(date(2024, 6, 3), 10, 0), "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}])
    before = sq.series_meta("RDDT", "15")["history_rev"]
    untouched = {int(r[0]): tuple(r) for r in sq.get_bars_since("RDDT", "15", 0) if int(r[0]) != spike["t"]}
    trades["rows"] = [_trade(OLD, 13, 31, 0, spike["o"]), _trade(OLD, 13, 40, 0, spike["l"] + 2.55),
                      _trade(OLD, 13, 43, 44, 57.65, [32], 457), _trade(OLD, 13, 43, 45, 57.95, [32, 37], 2)]
    got = sr.repair_day("RDDT", OLD, lambda: None, trade_pages=pages, rederive=bls._settle_rederive)
    assert got == {"flagged": 1, "replaced": 1}
    r = _row(sq, "RDDT", "15", spike["t"])
    assert round(r[3], 4) == round(min(spike["o"], spike["c"], spike["l"] + 2.55), 4), "the wick from [32] is gone"
    assert (r[1], r[4], r[5]) == (spike["o"], spike["c"], spike["v"]), "open, close and volume stay the vendor's"
    assert {int(x[0]): tuple(x) for x in sq.get_bars_since("RDDT", "15", 0) if int(x[0]) != spike["t"]} == untouched
    assert sq.series_meta("RDDT", "15")["history_rev"] != before, "a past day's change is held history: one bump"
    assert sr.repair_day("RDDT", OLD, lambda: None, trade_pages=pages)["replaced"] == 0, "idempotent"


def test_a_real_move_every_eligible_print_supports_stays(env):
    sq, trades, pages = env
    day = _day(OLD, 15)
    spike = next(b for b in day if b["t"] == _ts(OLD, 13, 30))
    spike["l"] = 57.65
    sq.put_bars("RDDT", "15", day)
    trades["rows"] = [_trade(OLD, 13, 31, 0, spike["o"]), _trade(OLD, 13, 43, 44, 57.65, None, 5000)]
    got = sr.repair_day("RDDT", OLD, lambda: None, trade_pages=pages)
    assert got == {"flagged": 1, "replaced": 0}, "only the flagged low is judged; the high stays the vendor's"
    assert round(_row(sq, "RDDT", "15", spike["t"])[3], 4) == 57.65, "no statistical filter: a real low stays"


def test_a_day_with_5m_repairs_the_base_and_re_derives_15m(env):
    sq, trades, pages = env
    five = _day(NEW, 5, start=(9, 30), end=(16, 0), px=700.0)
    spike = next(b for b in five if b["t"] == _ts(NEW, 15, 0))
    spike["h"] = 774.18
    sq.put_bars("SPY", "5", five)
    fifteen = bars_fetch._resample_derived("15", five)
    sq.put_bars("SPY", "15", fifteen)
    trades["rows"] = [_trade(NEW, 15, 1, 0, spike["o"]), _trade(NEW, 15, 2, 0, spike["c"] + 0.02),
                      _trade(NEW, 15, 3, 0, 774.18, [32], 103), _trade(NEW, 15, 4, 0, 771.29, [53, 52, 41], 125783)]
    got = sr.repair_day("SPY", NEW, lambda: None, trade_pages=pages, rederive=bls._settle_rederive)
    assert got["replaced"] == 1 and trades["calls"] == [("SPY", _ts(NEW, 15, 0), _ts(NEW, 15, 5))]
    assert round(_row(sq, "SPY", "5", spike["t"])[2], 4) < 771
    assert max(round(r[2], 4) for r in sq.get_bars_since("SPY", "15", _ts(NEW, 14, 59)) if r[0] < _ts(NEW, 15, 15)) < 771


def test_a_failed_read_writes_nothing_for_that_ticker(env):
    sq, trades, pages = env
    day = _day(OLD, 15)
    day[15]["l"] = 57.65
    sq.put_bars("RDDT", "15", day)
    trades["fail"] = True
    with pytest.raises(RuntimeError):
        sr.repair_day("RDDT", OLD, lambda: None, trade_pages=pages)
    assert round(_row(sq, "RDDT", "15", day[15]["t"])[3], 4) == 57.65


def test_the_backfill_goes_newest_first_and_remembers_its_days(env, monkeypatch):
    sq, trades, pages = env
    monkeypatch.setattr(sr, "repair_day", lambda sym, d, take, **k: {"flagged": 1, "replaced": 0})
    monkeypatch.setattr(bls, "enabled", lambda: True)
    with bls._lock:
        bls._covered5.add("SPY")
    today = date(2026, 11, 12)
    assert sr.pending_days(today, days=3) == [date(2026, 11, 11), date(2026, 11, 10), date(2026, 11, 9)]
    bls.spike_backfill_step(datetime(2026, 11, 12, 21, 0, tzinfo=_ET))
    assert sr.pending_days(today, days=3) == [date(2026, 11, 10), date(2026, 11, 9)]
    bls._reset_for_tests()                                      # a restart: bars.db keeps the ledger
    assert sr.pending_days(today, days=3) == [date(2026, 11, 10), date(2026, 11, 9)]


def test_the_settle_runs_the_repair_for_today(env, monkeypatch):
    sq, trades, pages = env
    seen = []
    monkeypatch.setattr(bls, "enabled", lambda: True)
    monkeypatch.setattr(bls, "SETTLE_ENABLED", True)
    monkeypatch.setattr(bls, "_fetch", lambda *a: [])
    monkeypatch.setattr(sr, "repair_day", lambda sym, d, take, **k: seen.append((sym, d)) or {"flagged": 2, "replaced": 1})
    with bls._lock:
        bls._covered5.add("SPY")
    counts = bls.settle_pass(datetime(2026, 11, 11, 20, 31, tzinfo=_ET))
    assert seen == [("SPY", NEW)] and counts["spike"]["flagged"] == 2 and counts["spike"]["replaced"] == 1


def test_on_a_quiet_day_the_0_3_percent_floor_keeps_a_small_wick_unflagged():
    d = OLD
    rows = []
    for i, r in enumerate(_day(d, 15)):
        p = r["o"]
        rows.append((r["t"], p, p + 0.01, p - 0.005, p + 0.005, r["v"]))        # a 1.5-cent median range
    t, o, h, l, c, v = rows[10]
    rows[10] = (t, o, c + 0.10, l, c, v)                     # 10 cents above the body: > 3 x median, < 0.3% of $60
    t2, o2, h2, l2, c2, v2 = rows[20]
    rows[20] = (t2, o2, c2 + 0.25, l2, c2, v2)               # 25 cents: beyond both
    assert [int(r[0]) for r in sr.flag(rows)] == [t2]


def test_a_spike_flagged_on_1m_and_5m_reads_the_5m_bucket_once_and_repairs_both(env):
    """#2825 review (2): one spike flags its 1m bar and its 5m bar; the 5m bucket's trades are read once and both
    rows are repaired from that one read (per-minute extremes, page by page)."""
    sq, trades, pages = env
    one = _day(NEW, 1, start=(14, 30), end=(15, 30), px=700.0)
    five = _day(NEW, 5, start=(9, 30), end=(16, 0), px=700.0)
    s1 = next(b for b in one if b["t"] == _ts(NEW, 15, 3))
    s5 = next(b for b in five if b["t"] == _ts(NEW, 15, 0))
    s1["h"] = s5["h"] = 774.18
    sq.put_bars("SPY", "1", one)
    sq.put_bars("SPY", "5", five)
    trades["rows"] = [_trade(NEW, 15, 0, 5, s5["o"]), _trade(NEW, 15, 1, 0, s5["c"] + 0.02),
                      _trade(NEW, 15, 3, 2, s1["o"]), _trade(NEW, 15, 3, 9, s1["c"] + 0.01),
                      _trade(NEW, 15, 3, 30, 774.18, [32], 103), _trade(NEW, 15, 4, 0, 771.29, [53, 52, 41], 125783)]
    got = sr.repair_day("SPY", NEW, lambda: None, trade_pages=pages)
    assert got == {"flagged": 2, "replaced": 2}
    assert trades["calls"] == [("SPY", _ts(NEW, 15, 0), _ts(NEW, 15, 5))], "one read of the 5m bucket"
    assert round(_row(sq, "SPY", "1", s1["t"])[2], 4) == round(max(s1["o"], s1["c"], s1["c"] + 0.01), 4)
    assert round(_row(sq, "SPY", "5", s5["t"])[2], 4) == round(max(s5["o"], s5["c"], s5["c"] + 0.02, s1["c"] + 0.01), 4)


def test_the_settles_same_day_repair_marks_today_done_so_the_backfill_never_re_reads_it(env, monkeypatch):
    """#2825 review (3): the settle's repair of today counts as that day's backfill."""
    sq, trades, pages = env
    monkeypatch.setattr(bls, "enabled", lambda: True)
    monkeypatch.setattr(bls, "SETTLE_ENABLED", True)
    monkeypatch.setattr(bls, "_fetch", lambda *a: [])
    monkeypatch.setattr(sr, "repair_day", lambda sym, d, take, **k: {"flagged": 0, "replaced": 0})
    with bls._lock:
        bls._covered5.add("SPY")
    bls.settle_pass(datetime(2026, 11, 11, 20, 31, tzinfo=_ET))
    assert NEW not in sr.pending_days(date(2026, 11, 12), days=3)
    assert sr.pending_days(date(2026, 11, 12), days=3) == [date(2026, 11, 10), date(2026, 11, 9)]


def test_a_settle_whose_repair_mostly_failed_leaves_today_pending(env, monkeypatch):
    sq, trades, pages = env
    monkeypatch.setattr(bls, "enabled", lambda: True)
    monkeypatch.setattr(bls, "SETTLE_ENABLED", True)
    monkeypatch.setattr(bls, "_fetch", lambda *a: [])

    def _boom(sym, d, take, **k):
        raise RuntimeError("provider 503")
    monkeypatch.setattr(sr, "repair_day", _boom)
    with bls._lock:
        for i in range(8):
            bls._covered5.add(f"T{i}")
    bls.settle_pass(datetime(2026, 11, 11, 20, 31, tzinfo=_ET))
    assert NEW in sr.pending_days(date(2026, 11, 12), days=3)
