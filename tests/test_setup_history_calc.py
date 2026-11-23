"""SETH, the pure half (`api/services/setup_history_calc.py`): the setup library, the market phase,
one signal per run, and the study's numbers against the screen backtester's own.

Every bar and every episode here is INVENTED (index arithmetic and a seeded generator), never a real
price, a real date range of a real stock, or a real index level.
"""
from __future__ import annotations

import random
from datetime import date, timedelta

import pytest

from api.services import scan_definition
from api.services import setup_history_calc as C
from api.services.ast_interpret import interpret, unresolved_scalars
from api.services.screener import backtest as bt


# ── invented bars ──────────────────────────────────────────────────────────────────────────────

def _weekdays(n, start=date(2031, 1, 6)):
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def _bars(closes, *, opens=None, vols=None, start=date(2031, 1, 6)):
    days = _weekdays(len(closes), start)
    out = []
    for i, c in enumerate(closes):
        o = c if opens is None else opens[i]
        out.append({"t": days[i], "o": float(o), "h": float(max(o, c)) * 1.002, "l": float(min(o, c)) * 0.998,
                    "c": float(c), "v": 1000.0 if vols is None else vols[i]})
    return out


def _walk(n, seed, *, vol=0.02, gap_every=0):
    rng = random.Random(seed)
    out, c = [], 40.0
    for i in range(n):
        g = rng.gauss(0, vol * 0.3)
        if gap_every and i % gap_every == gap_every - 1:
            g += rng.choice((-1, 1)) * rng.uniform(0.03, 0.09)
        o = c * (1 + g)
        cl = max(o * (1 + rng.gauss(0.0005, vol)), 0.5)
        h = max(o, cl) * (1 + abs(rng.gauss(0, vol * 0.4)))
        lo = min(o, cl) * (1 - abs(rng.gauss(0, vol * 0.4)))
        out.append((o, h, lo, cl, float(rng.randint(5, 60) * 1000) * (1 + 4 * abs(cl / c - 1) / vol * 0.2)))
        c = cl
    days = _weekdays(n)
    return [{"t": d, "o": o, "h": h, "l": lo, "c": cl, "v": v} for d, (o, h, lo, cl, v) in zip(days, out)]


def _col(setup_id, bars):
    return interpret(C.BY_ID[setup_id].tree, bars)


# ── the library ────────────────────────────────────────────────────────────────────────────────

def test_the_library_is_six_to_eight_named_setups_each_with_its_words():
    assert 6 <= len(C.LIBRARY) <= 8
    assert len({s.id for s in C.LIBRARY}) == len(C.LIBRARY)
    for s in C.LIBRARY:
        assert s.name and s.words and s.words.endswith(".")
        assert s.warmup >= 1 and s.fields


def test_every_setup_is_a_screen_the_screeners_own_gate_accepts_and_reads_no_value_without_history():
    for s in C.LIBRARY:
        got = scan_definition.assert_scannable({"compute": {"kind": "ast", "ast": s.tree}})
        assert got["yields"] == "bool", s.id
        assert got["scalars"] == [], s.id
        assert unresolved_scalars(s.tree, {}) == [], s.id


def test_every_setup_evaluates_to_a_true_false_column_on_every_bar():
    bars = _walk(700, 5, gap_every=37)
    for s in C.LIBRARY:
        col = interpret(s.tree, bars)
        assert len(col) == len(bars)
        assert {v for v in col if v is not None} <= {0.0, 1.0}, s.id


def test_no_setup_looks_ahead_a_signal_uses_only_the_bars_up_to_its_own_day():
    bars = _walk(620, 11, gap_every=23)
    full = {s.id: interpret(s.tree, bars) for s in C.LIBRARY}
    for k in range(260, 620, 29):
        for s in C.LIBRARY:
            assert interpret(s.tree, bars[:k + 1])[k] == full[s.id][k], (s.id, k)


def test_the_breakout_needs_a_new_closing_high_and_the_volume():
    closes = [50.0 + (i % 7) * 0.1 for i in range(260)] + [52.0]
    loud = _bars(closes, vols=[1000.0] * 260 + [1600.0])
    quiet = _bars(closes, vols=[1000.0] * 260 + [1400.0])
    assert _col("breakout", loud)[-1] == 1.0
    assert _col("breakout", quiet)[-1] == 0.0            # 1.4x its 50-day volume is short of 1.5x
    flat = _bars(closes[:-1] + [50.5], vols=[1000.0] * 260 + [1600.0])
    assert _col("breakout", flat)[-1] == 0.0             # below the 252-session closing high


def test_the_gap_needs_4_percent_and_twice_the_volume():
    closes = [30.0] * 60 + [31.5]
    vols = [1000.0] * 60 + [2100.0]
    assert _col("gap_up", _bars(closes, opens=[30.0] * 60 + [31.25], vols=vols))[-1] == 1.0
    assert _col("gap_up", _bars(closes, opens=[30.0] * 60 + [31.17], vols=vols))[-1] == 0.0   # 3.9%
    assert _col("gap_up", _bars(closes, opens=[30.0] * 60 + [31.25], vols=[1000.0] * 60 + [1900.0]))[-1] == 0.0


def test_the_reclaim_needs_twenty_closes_below_the_50_day_first():
    up = [20.0 + i * 0.05 for i in range(80)]
    below = [up[-1] - 3.0] * 20
    bars = _bars(up + below + [up[-1] + 1.0])
    assert _col("reclaim_50", bars)[-1] == 1.0
    short = _bars(up + below[:19] + [up[-1] + 1.0])
    assert _col("reclaim_50", short)[-1] == 0.0          # 19 closes below is one short


def test_three_weeks_tight_reads_the_closes_five_and_ten_sessions_apart():
    base = [10.0 + i * 0.02 for i in range(60)]
    tight = base + [11.5] * 4 + [11.55] + [11.4] * 4 + [11.52] + [11.6] * 4 + [11.6]
    assert _col("tight_3wk", _bars(tight))[-1] == 1.0
    loose = base + [11.5] * 4 + [11.0] + [11.4] * 4 + [11.52] + [11.6] * 4 + [11.6]
    assert _col("tight_3wk", _bars(loose))[-1] == 0.0    # 11.0 to 11.6 is more than 1.5%


def test_a_pocket_pivot_needs_a_down_day_among_the_10_sessions_before_as_vfp_reads_it():
    """VFP's reading (`volume_footprint_calc.pocket_pivots`): with no down day among the 10 sessions before there
    is no down-day volume to beat, so it is not a pocket pivot; with one, the day's volume must be above it."""
    rising = [20.0 + i * 0.05 for i in range(80)]           # every close above the one before: no down day at all
    day = rising[-1] + 0.5                                  # an up close, above its 50-day average
    loud = [1000.0] * 80 + [5000.0]
    assert _col("pocket_pivot", _bars(rising + [day], vols=loud))[-1] == 0.0     # nothing to beat

    def with_down(k, down_vol):
        closes, vols = list(rising), list(loud)
        closes[80 - k] = closes[80 - k - 1] - 0.02          # one down day, k sessions before the day
        vols[80 - k] = down_vol
        return _bars(closes + [day], vols=vols)

    assert _col("pocket_pivot", with_down(5, 1000.0))[-1] == 1.0      # above the down day's volume
    assert _col("pocket_pivot", with_down(5, 6000.0))[-1] == 0.0      # below it
    assert _col("pocket_pivot", with_down(10, 1000.0))[-1] == 1.0     # 10 sessions back is among the 10
    assert _col("pocket_pivot", with_down(11, 1000.0))[-1] == 0.0     # 11 back is not: none among the 10
    assert "no down day" in C.BY_ID["pocket_pivot"].words


def test_a_pocket_pivot_closes_above_its_10_day_line_not_its_50_day_as_vfp_reads_it():
    """VFP's (published) reading: the close is above the 10-day simple average of the 10 closes through that day.
    A pullback that bounces above its 10-day line but stays under its 50-day is a pocket pivot; one that stays
    under its 10-day line is not, however far above the 50-day it is."""
    up = [20.0 + i * 0.1 for i in range(70)]                 # a long rise: the 50-day sits far below
    down = [up[-1] - (i + 1) * 0.6 for i in range(9)]        # a sharp 9-day drop, well under the 50-day
    closes = up + down
    vols = [1000.0] * len(closes) + [5000.0]
    bounce = 24.5                                            # an up close that clears the 10-day line (about
    assert (sum(closes[-9:]) + bounce) / 10 < bounce < sum((closes + [bounce])[-50:]) / 50   # 23.9), not the 50-day
    assert _col("pocket_pivot", _bars(closes + [bounce], vols=vols))[-1] == 1.0
    weak = closes[-1] + 0.05                                 # an up close still under its 10-day line
    assert closes[-1] < weak < (sum(closes[-9:]) + weak) / 10
    assert _col("pocket_pivot", _bars(closes + [weak], vols=vols))[-1] == 0.0
    assert "10-day moving average" in C.BY_ID["pocket_pivot"].words


def test_the_fast_trees_answer_exactly_what_the_plain_trees_answer():
    """The 52-week high as four quarters' highs, and "20 closes below" as a count: the same answer on
    every bar either answers, the same declared warm-up."""
    from api.services.ast_interpret import max_lookback
    close, sma50 = C._ser("close"), C._call("sma", C._ser("close"), C._num(50))
    plain_high = C._call("highest", close, C._num(252))
    plain_reclaim = C._and(C._op(">", close, sma50),
                           C._op("<", C._ago(1, C._call("highest", C._op("-", close, sma50), C._num(20))), C._num(0)))
    assert max_lookback(C.high_of_year(close)) == max_lookback(plain_high) == 252
    assert max_lookback(C.BY_ID["reclaim_50"].tree) == max_lookback(plain_reclaim) == 71
    for seed in (3, 8, 13):
        bars = _walk(900, seed, gap_every=19)
        a, b = interpret(C.high_of_year(close), bars), interpret(plain_high, bars)
        assert a[251:] == b[251:]
        assert all(v is None or v != v for v in a[:251])        # no answer inside the warm-up
        r1, r2 = interpret(C.BY_ID["reclaim_50"].tree, bars), interpret(plain_reclaim, bars)
        assert r1[71:] == r2[71:]
        assert any(v == 1.0 for v in r1[71:])                    # CONTROL: the comparison saw real signals


def test_scan_stock_answers_what_the_backtesters_own_scan_answers_for_every_setup():
    bars = _walk(760, 21, gap_every=13)
    bars[400]["v"] = None                                       # a hole one tree reads and another does not
    bars[520]["h"] = None
    frm, to = bars[30]["t"], bars[700]["t"]
    lean = {s.id: sc for s, sc in C.scan_stock(bars, frm, to)}
    for s in C.LIBRARY:
        ref = bt._scan_symbol(s.tree, bars, frm=frm, to=to, warmup=s.warmup, fields=s.fields)
        got = lean[s.id]
        for k in ("in_window", "warmup", "not_computable", "answered", "signal_rows", "answered_rows", "dates", "buckets"):
            assert getattr(got, k) == getattr(ref, k), (s.id, k)
    assert any(lean[s.id].signal_rows for s in C.LIBRARY)        # CONTROL: there were signals to compare


def test_scan_stock_refuses_bars_out_of_order_as_the_backtester_does():
    bars = _walk(120, 4)
    dup = bars[:60] + bars[59:]
    with pytest.raises(bt.BacktestRefusal) as ref:
        bt._scan_symbol(C.LIBRARY[0].tree, dup, frm=dup[0]["t"], to=dup[-1]["t"], warmup=1, fields=("c",))
    got = C.scan_stock(dup, dup[0]["t"], dup[-1]["t"])
    assert {type(sc).__name__ for _s, sc in got} == {"BacktestRefusal"}
    assert {sc.reason for _s, sc in got} == {ref.value.reason} == {"unordered_bars"}
    intraday = [dict(b, t=1_900_000_000 + i) for i, b in enumerate(bars)]
    assert {sc.reason for _s, sc in C.scan_stock(intraday, "1900-01-01", "2100-01-01")} == {"non_daily_bars"}


# ── the market phase ───────────────────────────────────────────────────────────────────────────

def _ep(peak, trough):
    return {"peak": {"date": peak, "close": 100.0}, "trough": {"date": trough, "close": 85.0}}


def test_the_phase_is_peak_to_low_then_three_calendar_months_then_the_uptrend():
    pm = C.PhaseMap([_ep("2031-03-03", "2031-04-14")], "2031-01-02", "2032-06-30")
    assert pm.phase("2031-03-03") is None                 # the peak day itself: before the first low, no phase
    assert pm.phase("2031-03-04") == C.PHASE_CORRECTION
    assert pm.phase("2031-04-14") == C.PHASE_CORRECTION   # the low day is the last day of the correction
    assert pm.phase("2031-04-15") == C.PHASE_AFTER_LOW
    assert pm.phase("2031-07-13") == C.PHASE_AFTER_LOW
    assert pm.phase("2031-07-14") == C.PHASE_UPTREND      # the same calendar day 3 months on starts the uptrend
    assert pm.phase("2032-07-01") is None                 # past the index history held
    assert pm.phase("2030-12-31") is None                 # before it


def test_a_new_correction_inside_the_three_months_after_a_low_wins():
    pm = C.PhaseMap([_ep("2031-05-10", "2031-06-20"), _ep("2031-03-03", "2031-04-14")], "2031-01-02", "2032-06-30")
    assert pm.phase("2031-05-01") == C.PHASE_AFTER_LOW
    assert pm.phase("2031-05-12") == C.PHASE_CORRECTION
    assert pm.phase("2031-06-21") == C.PHASE_AFTER_LOW
    assert pm.phase("2031-09-20") == C.PHASE_UPTREND


def test_a_bad_episode_is_skipped_and_no_episodes_means_no_phase():
    pm = C.PhaseMap([{"peak": {}}, None, {"peak": {"date": "2031-02-01"}}, _ep("2031-03-03", "2031-04-14")],
                    "2031-01-02", "2032-06-30")
    assert pm.phase("2031-04-01") == C.PHASE_CORRECTION
    assert C.PhaseMap([], "2031-01-02", "2032-06-30").phase("2031-04-01") is None
    assert C.PhaseMap([_ep("2031-03-03", "2031-04-14")], None, None).phase("2031-04-01") is None


# ── one signal per run ─────────────────────────────────────────────────────────────────────────

class _Scan:
    def __init__(self, signal_rows, answered_rows):
        self.signal_rows, self.answered_rows = signal_rows, answered_rows


def test_a_run_counts_once_on_its_first_session_and_an_unseen_start_never():
    scan = _Scan([10, 11, 12, 20, 30], list(range(10, 40)))
    assert C.first_of_run(scan) == [20, 30]               # 10 is the first answered bar: its run's start is unseen
    scan2 = _Scan([11, 12, 13, 20, 21], list(range(10, 40)))
    assert C.first_of_run(scan2) == [11, 20]
    holed = _Scan([16, 25], [i for i in range(10, 40) if i != 15])
    assert C.first_of_run(holed) == [25]                  # the bar before 16 is a hole


# ── the study against the screen backtester ────────────────────────────────────────────────────

def _first_only(tree):
    """`tree && !tree[1]`: true only on a run's first bar, so the backtester's every-bar count IS one per run."""
    return {"type": "op", "name": "&&", "args": [tree, {"type": "op", "name": "!", "args": [
        {"type": "offset", "value": 1, "args": [tree]}]}]}


def _universe(n_sym=4, n=520):
    return {f"QZA{i}": _walk(n, 100 + i, gap_every=11 + i) for i in range(n_sym)}


def test_the_studys_numbers_are_the_screen_backtesters_own_for_the_same_screen():
    base = C.BY_ID["gap_up"].tree
    probe = C.Setup("probe", "Probe", "Invented.", _first_only(base))
    data = _universe()
    frm, to = data["QZA0"][0]["t"], data["QZA0"][-1]["t"]
    study = C.Study(C.PhaseMap([], None, None), frm, to, setups=(probe,))
    for sym in sorted(data):
        study.add(data[sym])
    got = {g["phase"]: g for g in study.result(min_signals=3)[0]["groups"]}["all"]
    ref = bt.run_backtest(probe.tree, sorted(data), frm, to, bars_for=data.get, horizons=C.HORIZONS, min_signals=3)
    assert ref.backtestable, ref.detail
    assert got["signals"] == ref.signals and ref.signals >= 10
    for hz in ref.horizons:
        mine = got["horizons"][str(hz.horizon)]
        assert mine["n"] == hz.strategy.n
        assert mine["strategy"] == hz.strategy.to_dict()
        for k in ("n", "win_rate"):
            assert mine["baseline"][k] == getattr(hz.baseline, k)
        for k in ("avg_pct", "avg_pct_winsorised"):
            assert mine["baseline"][k] == pytest.approx(getattr(hz.baseline, k), rel=1e-9, abs=1e-9)
        sd, rsd = mine["same_day"], hz.same_day
        for k in ("n_matched", "n_unmatched", "n_unmatched_unmeasurable", "n_cells", "excess_null_reason"):
            assert sd[k] == rsd[k], k
        if rsd["excess_pct_winsorised"] is None:
            assert sd["excess_pct_winsorised"] is None
        else:
            assert sd["excess_pct_winsorised"] == pytest.approx(rsd["excess_pct_winsorised"], rel=1e-9, abs=1e-9)


def test_each_setups_baseline_is_every_bar_it_answered_even_though_the_study_tallies_them_once():
    data = _universe(3, 420)
    frm, to = data["QZA0"][0]["t"], data["QZA0"][-1]["t"]
    # the volume-reading setup loses a bar where the volume is missing; the close-only one keeps it
    data["QZA1"][300]["v"] = None
    study = C.Study(C.PhaseMap([], None, None), frm, to)
    for sym in sorted(data):
        study.add(data[sym])
    res = {r["id"]: {g["phase"]: g for g in r["groups"]} for r in study.result(min_signals=1)}
    for sid in ("gap_up", "tight_3wk", "pocket_pivot"):
        tree = C.BY_ID[sid].tree
        ref = bt.run_backtest(tree, sorted(data), frm, to, bars_for=data.get, horizons=C.HORIZONS, min_signals=1)
        for hz in ref.horizons:
            mine = res[sid]["all"]["horizons"][str(hz.horizon)]["baseline"]
            assert mine["n"] == hz.baseline.n, sid
            assert mine["avg_pct"] == pytest.approx(hz.baseline.avg_pct, rel=1e-9), sid


def test_a_group_under_the_floor_keeps_its_count_and_withholds_every_rate():
    data = _universe(2, 400)
    frm, to = data["QZA0"][0]["t"], data["QZA0"][-1]["t"]
    study = C.Study(C.PhaseMap([], None, None), frm, to, setups=(C.BY_ID["reclaim_50"],))
    for sym in sorted(data):
        study.add(data[sym])
    g = study.result()[0]["groups"][-1]
    h = g["horizons"]["20"]
    assert h["n"] < C.MIN_SIGNALS and h["below_floor"] is True
    assert h["strategy"]["n"] == h["n"] and h["strategy"]["win_rate"] is None and h["strategy"]["avg_pct"] is None
    assert h["baseline"]["win_rate"] is None
    assert h["same_day"]["excess_pct_winsorised"] is None and h["same_day"]["excess_null_reason"] == "below_floor"


def test_signals_are_grouped_by_the_phase_of_their_own_day_and_all_days_holds_every_one():
    data = _universe(4, 520)
    days = data["QZA0"]
    frm, to = days[0]["t"], days[-1]["t"]
    pm = C.PhaseMap([_ep(days[150]["t"], days[200]["t"]), _ep(days[380]["t"], days[420]["t"])], days[0]["t"], days[480]["t"])
    study = C.Study(pm, frm, to)
    for sym in sorted(data):
        study.add(data[sym])
    for r in study.result(min_signals=1):
        groups = {g["phase"]: g for g in r["groups"]}
        assert [g["phase"] for g in r["groups"]] == list(C.GROUPS)
        three = sum(groups[p]["signals"] for p in C.PHASES)
        assert groups["all"]["signals"] >= three          # a day with no phase counts in all days only
        assert groups["all"]["signals"] == r["signals"]


def test_a_setup_that_fires_past_the_cap_is_withheld_never_cut():
    data = _universe(2, 400)
    frm, to = data["QZA0"][0]["t"], data["QZA0"][-1]["t"]
    study = C.Study(C.PhaseMap([], None, None), frm, to, setups=(C.BY_ID["pocket_pivot"],), max_signals=3)
    for sym in sorted(data):
        study.add(data[sym])
    (row,) = study.result()
    assert row["state"] == "capped" and row["groups"] == [] and "withheld" in row["detail"]


def test_the_study_holds_compact_arrays_never_a_stocks_bars():
    data = _universe(2, 400)
    frm, to = data["QZA0"][0]["t"], data["QZA0"][-1]["t"]
    study = C.Study(C.PhaseMap([], None, None), frm, to)
    for sym in sorted(data):
        study.add(data[sym])
    for v in vars(study).values():
        assert not (isinstance(v, list) and v and isinstance(v[0], dict) and "t" in v[0])
    assert all(type(a).__name__ == "array" for s in study._sig for a in (*s.ret, s.cell, s.phase))


# ── one stock ──────────────────────────────────────────────────────────────────────────────────

def test_one_stocks_signals_are_newest_first_with_their_phase_and_forward_returns():
    bars = _walk(600, 7, gap_every=29)
    pm = C.PhaseMap([_ep(bars[300]["t"], bars[340]["t"])], bars[0]["t"], bars[-1]["t"])
    got = C.stock_signals(bars, pm, bars[0]["t"], bars[-1]["t"])
    rows = got["signals"]
    assert rows and [r["date"] for r in rows] == sorted((r["date"] for r in rows), reverse=True)
    assert {r["setup"] for r in rows} <= set(C.BY_ID)
    for r in rows:
        assert r["phase"] == pm.phase(r["date"])
        assert set(r["returns"]) == {"5", "20", "60"}
    newest = [r for r in rows if r["date"] >= bars[-61]["t"]]
    assert all(r["returns"]["60"] is None for r in newest)  # 60 sessions have not passed: not a 0
    i = next(k for k, b in enumerate(bars) if b["t"] == rows[-1]["date"])
    want = (bars[i + 1 + 5]["o"] - bars[i + 1]["o"]) / bars[i + 1]["o"] * 100
    assert rows[-1]["returns"]["5"] == round(want, 2)      # next open to the open 5 sessions later
    assert {s["id"] for s in got["setups"]} == set(C.BY_ID)


def test_the_horizons_and_floor_are_the_briefs_and_the_backtesters():
    assert C.HORIZONS == (5, 20, 60)
    assert C.MIN_SIGNALS == bt.DEFAULT_MIN_SIGNALS == 30
    assert C.N_BUCKETS == len(bt.MOVE_BUCKETS) + 1
    assert len(C.GROUPS) == 4 and C.GROUPS[-1] == C.PHASE_ALL
