"""Volume & volatility Screener columns (`api/services/screener/volume_volatility.py`).

Every series here is invented. Each column is held to the Terminal definition it reuses (STAT's realized volatility
and drawdown in a correction, VFP's accumulation / distribution days and pocket pivots, MKTH's declines) by computing
that definition on the same invented history and comparing, and each has its NULL cases.
"""
from __future__ import annotations

import importlib
import math
import random
from datetime import date, timedelta

import pytest

from api.services import market_history_calc as MH
from api.services import stock_stats_calc as SC
from api.services import volume_footprint_calc as VF
from api.services.screener import volume_volatility as VV


# ── invented bars ─────────────────────────────────────────────────────────────────────────────

def _weekdays(n, start=date(2019, 1, 2)):
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d += timedelta(days=1)
    return out


def _bar(d, c, v=1_000_000, o=None):
    o = c if o is None else o
    return {"t": int(d.strftime("%Y%m%d")), "o": o, "h": max(o, c) * 1.005, "l": min(o, c) * 0.995, "c": c, "v": v}


def _random_bars(n, seed=7, start=date(2019, 1, 2)):
    rng = random.Random(seed)
    c, out = 40.0, []
    for d in _weekdays(n, start):
        c *= math.exp(rng.gauss(0.0003, 0.021))
        out.append(_bar(d, round(c, 4), v=rng.randint(200_000, 3_000_000), o=round(c * (1 + rng.gauss(0, 0.004)), 4)))
    return out


def _from_closes(closes, vols=None, start=date(2019, 1, 2)):
    vols = vols or [1_000_000] * len(closes)
    return [_bar(d, c, v) for d, c, v in zip(_weekdays(len(closes), start), closes, vols)]


# ── the shape ─────────────────────────────────────────────────────────────────────────────────

def test_the_columns_windows_and_reused_constants_are_one_set():
    assert set(VV.WINDOW_BARS) == set(VV.COLUMNS) and set(VV.INT_COLUMNS) <= set(VV.COLUMNS)
    assert tuple(VV.HV_SESSIONS.values()) == SC.RV_SESSIONS          # STAT's windows, never retyped
    assert VV.HV_SESSIONS == {"hv_20": 20, "hv_60": 60}              # the column names say the numbers
    assert VV.AD_SESSIONS == VF.AD_WINDOWS[0] == 25                  # ad_net_25
    assert VV.PIVOT_SESSIONS == 20                                   # pocket_pivots_20
    assert VV.TAIL_BARS >= VV.WINDOW_BARS["days_since_pocket_pivot"] + 1


# ── realized volatility ───────────────────────────────────────────────────────────────────────

def test_realized_volatility_is_the_number_stat_prints():
    b = _random_bars(700)
    got = VV.row_fields(b[-400:], b)
    stat = SC.volatility(VV.stat_bars(b))["realized"]
    assert [r["sessions"] for r in stat] == [20, 60]
    assert got["hv_20"] == stat[0]["pct"] and got["hv_60"] == stat[1]["pct"]
    assert got["hv_20"] > 0


def test_realized_volatility_is_null_with_too_few_sessions():
    b = _random_bars(21)
    got = VV.row_fields(b, b)
    assert got["hv_20"] is not None and got["hv_60"] is None
    short = VV.row_fields(b[:20], b[:20])
    assert short["hv_20"] is None, "20 closes are 19 returns: not a 20-return volatility"


def test_a_flat_series_has_zero_volatility_not_null():
    b = _from_closes([50.0] * 70)
    got = VV.row_fields(b, b)
    assert got["hv_20"] == 0.0 and got["hv_60"] == 0.0


# ── accumulation minus distribution ───────────────────────────────────────────────────────────

def test_ad_net_counts_accumulation_less_distribution_over_25_sessions():
    # 26 closes: a flat start, then 3 accumulation days (up >= 0.2% on more volume), 1 distribution day
    # (down >= 0.2% on more volume), an up day on LESS volume (neither) and a 0.1% move (neither).
    closes = [100.0] * 20 + [101.0, 102.0, 103.0, 101.0, 102.0, 102.1]
    vols = [1000] * 20 + [2000, 3000, 4000, 5000, 4000, 9000]
    b = _from_closes(closes, vols)
    assert VV.row_fields(b, b)["ad_net_25"] == 3 - 1


def test_ad_net_is_vfps_25_session_net_on_any_history():
    for seed in range(5):
        b = _random_bars(300, seed=seed)
        want = VF.accumulation(VV.stat_bars(b))["windows"][0]
        assert want["sessions"] == 25
        assert VV.row_fields(b[-400:], b)["ad_net_25"] == want["net"]


def test_ad_net_is_null_when_short_or_a_session_cannot_be_judged():
    b = _random_bars(25)
    assert VV.row_fields(b, b)["ad_net_25"] is None, "25 bars cannot judge 25 sessions"
    b = _random_bars(60)
    b[-5] = {**b[-5], "v": None}
    assert VV.row_fields(b, b)["ad_net_25"] is None, "a session not judged: never a net of 24"
    b[-5] = {**b[-5], "v": 0}
    assert VV.row_fields(b, b)["ad_net_25"] is not None, "a measured zero volume is a volume"


# ── pocket pivots ─────────────────────────────────────────────────────────────────────────────

def _pivot_series(pivot_back: int, n=60):
    """A gently rising series with one down day before a clean pocket pivot `pivot_back` sessions before the
    newest (0 = the newest session)."""
    closes, vols = [], []
    c = 100.0
    for i in range(n):
        c += 0.05
        closes.append(c)
        vols.append(1000)
    k = n - 1 - pivot_back
    closes[k - 3] = closes[k - 4] - 0.5                             # a down day 3 sessions before
    vols[k - 3] = 5000
    for j in range(k - 2, n):
        closes[j] = closes[j - 1] + 0.05
    closes[k] = closes[k - 1] + 2.0                                 # the up day that clears it
    vols[k] = 9000
    for j in range(k + 1, n):
        closes[j] = closes[j - 1] + 0.05
    return _from_closes(closes, vols)


@pytest.mark.parametrize("back", [0, 4, 19])
def test_a_pocket_pivot_inside_the_last_20_sessions_is_counted_and_dated(back):
    b = _pivot_series(back)
    got = VV.row_fields(b, b)
    assert got["pocket_pivots_20"] == 1
    assert got["days_since_pocket_pivot"] == back


@pytest.mark.parametrize("back", [20, 21])
def test_a_pocket_pivot_20_or_more_sessions_back_is_dated_but_not_counted(back):
    b = _pivot_series(back)
    got = VV.row_fields(b, b)
    assert got["pocket_pivots_20"] == 0 and got["days_since_pocket_pivot"] == back


def test_no_pocket_pivot_in_the_year_is_null_days_since_and_zero_count():
    b = _from_closes([100.0 + 0.05 * i for i in range(300)])          # no down day anywhere: nothing to exceed
    got = VV.row_fields(b, b)
    assert got["pocket_pivots_20"] == 0 and got["days_since_pocket_pivot"] is None


def test_the_tail_gives_the_whole_historys_answer_on_random_series():
    for seed in range(8):
        b = _random_bars(1200, seed=100 + seed)
        tup = VV.stat_bars(b)
        full = VF.pocket_pivots(tup, lambda i: None)
        got = VV.row_fields(b[-400:], b)
        if full["rows"]:
            idx = [x[0] for x in tup].index(full["rows"][0]["date"])
            assert got["days_since_pocket_pivot"] == len(tup) - 1 - idx
        else:
            assert got["days_since_pocket_pivot"] is None
        last20 = {x[0] for x in tup[-20:]}
        assert got["pocket_pivots_20"] == sum(1 for r in full["rows"] if r["date"] in last20)


def test_pocket_pivots_are_null_when_short_or_a_volume_is_missing():
    b = _pivot_series(3, n=30)
    assert VV.row_fields(b, b)["pocket_pivots_20"] is None, "30 bars cannot judge 20 sessions"
    b = _pivot_series(3)
    b[-2] = {**b[-2], "v": None}                                     # an up day of the 20 with no volume
    got = VV.row_fields(b, b)
    assert got["pocket_pivots_20"] is None and got["days_since_pocket_pivot"] is None


# ── drawdown against the S&P 500 in the last correction ───────────────────────────────────────

def _index_series():
    """Invented index closes: a 15% decline that recovers, a later 12% one that recovers, then one still ongoing."""
    seq = [100.0 + i * 0.1 for i in range(100)]                      # to 109.9
    peak1 = seq[-1]
    seq += [peak1 * (1 - 0.15 * (i + 1) / 20) for i in range(20)]    # down 15%
    seq += [seq[-1] + (peak1 * 1.01 - seq[-1]) * (i + 1) / 30 for i in range(30)]   # regained
    peak2 = seq[-1]
    seq += [peak2 * (1 - 0.12 * (i + 1) / 10) for i in range(10)]    # down 12%
    seq += [seq[-1] + (peak2 * 1.02 - seq[-1]) * (i + 1) / 10 for i in range(10)]   # regained
    peak3 = seq[-1]
    seq += [peak3 * (1 - 0.11 * (i + 1) / 10) for i in range(10)]    # down 11%, still down
    return [(d.isoformat(), round(c, 4)) for d, c in zip(_weekdays(len(seq), date(2021, 1, 4)), seq)]


@pytest.fixture
def index_ctx(monkeypatch):
    from api.services import market_history as MKT
    closes = _index_series()
    block = {"symbol": "SPX", "state": "ok", "first": closes[0][0], "last": closes[-1][0],
             "episodes": MH.describe_episodes(closes, "SPX")}
    calls = []
    monkeypatch.setattr(MKT, "build_indexes", lambda now: calls.append(now) or ({"SPX": block}, {"SPX": closes}))
    ctx = VV.index_context()
    ctx["_calls"] = calls
    ctx["_closes"] = closes
    ctx["_block"] = block
    return ctx


def _stock_on(closes_idx, factor):
    """A stock on the index's dates that moves `factor` times the index's moves (from the same start)."""
    base = closes_idx[0][1]
    out = []
    for d, c in closes_idx:
        out.append({"t": int(d.replace("-", "")), "o": 0, "h": 0, "l": 0, "c": 50.0 * (1 + factor * (c / base - 1.0)),
                    "v": 1000})
    for b in out:
        b["o"] = b["h"] = b["l"] = b["c"]
    return out


def test_the_index_context_keeps_only_completed_declines_newest_first(index_ctx):
    eps = index_ctx["_block"]["episodes"]
    assert [e["ongoing"] for e in eps] == [True, False, False]
    assert index_ctx["state"] == "ok" and len(index_ctx["completed"]) == 2
    assert index_ctx["completed"][0][3] is eps[1], "the newest COMPLETED decline, never the ongoing one"
    assert index_ctx["newest"] == eps[1]["id"]


def test_corr_rel_is_stats_ratio_for_the_newest_completed_decline(index_ctx):
    stock = _stock_on(index_ctx["_closes"], 0.5)
    got = VV.row_fields(stock[-400:], stock, index_ctx)["corr_rel_last"]
    ep = index_ctx["completed"][0][3]
    want = SC.in_correction(MH.clean_closes((f"{b['t'] // 10000:04d}-{b['t'] // 100 % 100:02d}-{b['t'] % 100:02d}",
                                             b["c"]) for b in stock), ep)["vs_index_ratio"]
    assert got == want
    assert 0.3 < got < 0.7, "a stock moving half as far fell about half as far"
    held = VV.row_fields(stock, stock, index_ctx)["corr_rel_last"]
    flat = [{**b, "c": 50.0, "o": 50.0, "h": 50.0, "l": 50.0} for b in stock]
    assert VV.row_fields(flat, flat, index_ctx)["corr_rel_last"] == 0.0, "did not fall at all: a real 0"
    assert held == got


def test_corr_rel_slice_equals_the_whole_history_on_random_stocks(index_ctx):
    closes = index_ctx["_closes"]
    for seed in range(6):
        rng = random.Random(seed)
        stock = [{"t": int(d.replace("-", "")), "c": 30.0 * math.exp(rng.gauss(0, 0.02) * 1 + i * 0.001)}
                 for i, (d, _c) in enumerate(closes)]
        for b in stock:
            b.update(o=b["c"], h=b["c"], l=b["c"], v=1000)
        whole = MH.clean_closes((f"{b['t'] // 10000:04d}-{b['t'] // 100 % 100:02d}-{b['t'] % 100:02d}", b["c"])
                                for b in stock)
        want = SC.in_correction(whole, index_ctx["completed"][0][3])["vs_index_ratio"]
        assert VV.corr_rel(stock, index_ctx) == want


def test_no_look_ahead_a_decline_recovered_after_the_rows_newest_bar_is_not_used(index_ctx):
    # A stock that held flat through the older decline (ratio 0) and moved with the index in the newer one (ratio 1),
    # so the two declines give different answers and a look-ahead cannot pass for the right one.
    old_rec, old_peak = index_ctx["completed"][1][0], index_ctx["completed"][1][1]
    stock = _stock_on(index_ctx["_closes"], 1.0)
    held = next(b["c"] for b in stock if b["t"] == old_peak)
    for b in stock:
        if old_peak <= b["t"] <= old_rec:
            b.update(c=held, o=held, h=held, l=held)
    assert VV.corr_rel(stock, index_ctx) == 1.0, "as of the newest bar: the newer decline"
    newest_rec = index_ctx["completed"][0][0]
    cut = [b for b in stock if b["t"] < newest_rec]                  # ends inside the newer decline, before its regain
    assert VV.corr_rel(cut, index_ctx) == 0.0, "as of its own newest session the newer decline had not ended"
    before_any = [b for b in stock if b["t"] < old_rec]
    assert VV.corr_rel(before_any, index_ctx) is None, "no decline had ended yet"


def test_corr_rel_is_null_when_the_history_starts_after_the_peak_or_the_index_is_not_held(index_ctx):
    stock = _stock_on(index_ctx["_closes"], 1.0)
    peak = index_ctx["completed"][0][1]
    late = [b for b in stock if b["t"] > peak]
    assert VV.corr_rel(late, index_ctx) is None
    assert VV.corr_rel(stock, {"state": "not_held"}) is None
    assert VV.corr_rel(stock, None) is None
    assert VV.row_fields(stock[-400:], stock, None)["corr_rel_last"] is None


def test_the_index_context_says_not_held(monkeypatch):
    from api.services import market_history as MKT
    monkeypatch.setattr(MKT, "build_indexes", lambda now: ({"SPX": {"state": "not_held"}}, {}))
    ctx = VV.index_context()
    assert ctx["state"] == "not_held" and ctx["rows"] == 0


# ── a series that contradicts itself ──────────────────────────────────────────────────────────

def test_a_seam_withholds_each_column_whose_window_reaches_it():
    b = _random_bars(400)
    full = VV.row_fields(b, b)
    assert all(full[c] is not None for c in ("hv_20", "hv_60", "ad_net_25", "pocket_pivots_20"))
    got = VV.row_fields(b, b, seam_since=40)
    assert got["hv_20"] == full["hv_20"] and got["ad_net_25"] == full["ad_net_25"]
    assert got["pocket_pivots_20"] == full["pocket_pivots_20"]
    assert got["hv_60"] is None and got["days_since_pocket_pivot"] is None
    fresh = VV.row_fields(b, b, seam_since=2)
    assert all(fresh[c] is None for c in VV.COLUMNS)


def test_build_row_withholds_and_counts_a_contradicting_series():
    from tests.test_screener_series_seams import _dated, _with_ratios
    from api.services.screener import snapshot_builder as sb
    bars = _dated(_with_ratios(300, [0.489, 1.956, 0.493, 1.941], n_after=2))
    failures, ctx = {}, {"state": "not_held", "rows": 0, "ms": 0.0, "seam_withheld": 0}
    row = sb.build_row("ZZQS", bars, None, {}, identity_state={}, failures=failures, vv_context=ctx)
    assert all(row[c] is None for c in VV.COLUMNS)
    assert failures["bars_volume_volatility"]["series_contradicts_itself"] == 1
    assert ctx["rows"] == 1 and ctx["seam_withheld"] == 1 and ctx["ms"] >= 0.0


def test_build_row_writes_the_six_columns_on_an_ordinary_series(index_ctx):
    from api.services.screener import snapshot_builder as sb
    stock = _stock_on(index_ctx["_closes"], 0.5)
    for i, b in enumerate(stock):
        b["v"] = 1000 + (i % 7) * 300
    row = sb.build_row("ZZQT", stock, None, {}, identity_state={}, vv_context=index_ctx)
    assert row["hv_20"] is not None and row["ad_net_25"] is not None and row["corr_rel_last"] is not None
    assert index_ctx["rows"] == 1


def test_a_raising_step_costs_its_six_columns_never_the_row(monkeypatch):
    from api.services.screener import snapshot_builder as sb
    monkeypatch.setattr(VV, "row_fields", lambda *a, **k: (_ for _ in ()).throw(ValueError("boom")))
    failures = {}
    row = sb.build_row("ZZQU", _random_bars(300), None, {}, failures=failures)
    assert row["ticker"] == "ZZQU" and row["bars_asof"] is not None and row["chg_pct_1d"] is not None
    assert all(row[c] is None for c in VV.COLUMNS)
    assert failures["bars_volume_volatility"] == {"ValueError": 1}


# ── the build: one index read, the columns land, the filters screen them ──────────────────────

def test_the_build_reads_the_index_once_and_writes_the_six_columns(tmp_path, monkeypatch, index_ctx):
    from api.services.screener import snapshot_builder as sb, snapshot_db
    from api.services.screener import (finviz_universe, earnings_dates, earnings_context, analyst_pass,
                                       insider_capture, short_columns, fund_trends, beats_insiders_funds as bif,
                                       context_joins as cj)
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    snapshot_db.init_db()
    stock = _stock_on(index_ctx["_closes"], 0.5)
    for i, b in enumerate(stock):
        b["v"] = 1000 + (i % 5) * 400
    rows = [(b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]) for b in stock]
    monkeypatch.setattr(sb, "_load_universe", lambda: ["ZZQA", "ZZQB"])
    import api.services.bars_sqlite as bs
    monkeypatch.setattr(bs, "get_bars", lambda t, tf, n: rows if t == "ZZQA" else rows[:15])
    monkeypatch.setattr(sb, "_read_rs_map", lambda: {})
    monkeypatch.setattr(sb, "_read_bulk_fundamentals", lambda t, failures=None: {})
    monkeypatch.setattr(sb, "_read_ratings", lambda t, failures=None: {})
    monkeypatch.setattr(sb, "_read_fundamentals", lambda t, price=None, failures=None: {})
    monkeypatch.setattr(sb, "settled_session", lambda now=None: date(2021, 12, 31))
    monkeypatch.setattr(sb, "_read_settled_bars", lambda d: {"error": "not in this test"})
    for fn in ("read_breadth_flags", "read_uct20", "read_index_flags", "read_etf_flags"):
        monkeypatch.setattr(cj, fn, lambda targets, failures=None: {})
    for mod, fn in ((finviz_universe, "read_finviz_fields"), (earnings_dates, "read_earnings_dates"),
                    (earnings_context, "read_last_report_move"), (earnings_context, "read_implied_context"),
                    (analyst_pass, "read_analyst_fields"), (insider_capture, "read_insider_fields")):
        monkeypatch.setattr(mod, fn, lambda targets, failures=None: {})
    monkeypatch.setattr(short_columns, "read_short_columns", lambda t, failures=None, receipt=None: {})
    monkeypatch.setattr(fund_trends, "read_fields", lambda t, failures=None, settled=None, receipt=None: {})
    for fn in ("read_earnings_fields", "read_insider_fields"):
        monkeypatch.setattr(bif, fn, lambda t, failures=None, session=None, receipt=None: {})
    monkeypatch.setattr(bif, "read_fund_fields", lambda t, failures=None, receipt=None: {})

    out = sb.run_build(max_tickers=2)
    assert out["built"] == 2 and len(index_ctx["_calls"]) == 2, \
        "one index read per build (the fixture's own read plus the build's), never one per ticker"
    r = out["volume_volatility"]
    assert r["index_state"] == "ok" and r["rows"] == 2 and r["completed"] == 2 and r["ms_per_row"] is not None
    a, b = snapshot_db.get_row("ZZQA"), snapshot_db.get_row("ZZQB")
    assert a["hv_20"] is not None and a["hv_60"] is not None and a["ad_net_25"] is not None
    assert a["corr_rel_last"] is not None and isinstance(a["ad_net_25"], int)
    assert all(b[c] is None for c in ("hv_20", "hv_60", "ad_net_25", "pocket_pivots_20", "corr_rel_last")), \
        "fifteen sessions hold none of these: NULL, never 0"
    assert out["populated"]["hv_20"] == 1


def test_the_filters_screen_the_six_columns_end_to_end(tmp_path, monkeypatch):
    from tests.test_screener_filters import _snapshot
    day = "2026-11-20"
    _snapshot(tmp_path, monkeypatch, [
        {"ticker": "ZZQA", "hv_20": 62.5, "hv_60": 55.0, "ad_net_25": 6, "pocket_pivots_20": 2,
         "days_since_pocket_pivot": 1, "corr_rel_last": 0.45, "snapshot_date": day, "built_at": 1},
        {"ticker": "ZZQB", "hv_20": 18.0, "hv_60": 21.0, "ad_net_25": -4, "pocket_pivots_20": 0,
         "days_since_pocket_pivot": 40, "corr_rel_last": 1.6, "snapshot_date": day, "built_at": 1},
        {"ticker": "ZZQC", "ad_net_25": 0, "corr_rel_last": 0.0, "snapshot_date": day, "built_at": 1},
        {"ticker": "ZZQD", "snapshot_date": day, "built_at": 1},       # NULL: inside no range
    ])
    from api.services.screener import query
    importlib.reload(query)

    def tickers(*fs):
        return sorted(r["ticker"] for r in query.run_scan({"filters": list(fs)})["rows"])

    assert tickers({"key": "hv_20", "op": "gte", "min": 40}) == ["ZZQA"]
    assert tickers({"key": "hv_60", "op": "lte", "max": 30}) == ["ZZQB"]
    assert tickers({"key": "ad_net_25", "op": "gt", "min": 0}) == ["ZZQA"]
    assert tickers({"key": "ad_net_25", "op": "lte", "max": 0}) == ["ZZQB", "ZZQC"]
    assert tickers({"key": "pocket_pivots_20", "op": "gte", "min": 1}) == ["ZZQA"]
    assert tickers({"key": "days_since_pocket_pivot", "op": "lte", "max": 5}) == ["ZZQA"]
    assert tickers({"key": "corr_rel_last", "op": "lt", "max": 1}) == ["ZZQA", "ZZQC"]


# ── the registry, the client text, the methodology ────────────────────────────────────────────

def test_each_column_is_a_bare_member_control_in_its_own_family_with_a_seat_in_its_view():
    from api.services.screener import filters, snapshot_db
    assert {"key": "volume_volatility", "label": "Volume & Volatility"} in filters.CATEGORIES
    labels = [c["label"] for c in filters.CATEGORIES]
    assert len(labels) == len(set(labels)), "no two categories share a label"
    family = {k for k, f in filters.FILTERS.items() if f["category"] == "volume_volatility"}
    assert family == set(VV.COLUMNS)
    view = filters.VIEWS["volume_volatility"]["columns"]
    catalog = {f["key"]: f for f in filters.field_catalog()}
    for c in VV.COLUMNS:
        f = filters.FILTERS[c]
        assert f["column"] == c and f["type"] == "range" and f["allow_custom"] is True
        assert [p["label"] for p in f["presets"]] == ["Any"] and f["presets_deferred"] is True
        assert f.get("agent_omit") is True and catalog[c].get("agent_omit") is True, c
        assert c in view and c in snapshot_db.COLUMNS, c
    assert set(VV.INT_COLUMNS) <= snapshot_db._INT
    assert not (set(VV.COLUMNS) - set(VV.INT_COLUMNS)) & snapshot_db._INT
    # the range columns the Screener already carries sit beside them, not second controls
    assert {"atr_pct", "adr_pct", "vol_ratio"} <= set(view)


def test_the_client_text_states_the_owners_numbers():
    from tests.test_screener_filters import _column_def_block as block
    for col, k in VV.HV_SESSIONS.items():
        assert f"over the last {k} sessions" in block(col) and f"fewer than {k + 1} sessions" in block(col)
    move = f"{VF.AD_MIN_MOVE * 100:g}%"
    ad = block("ad_net_25")
    assert f"over the last {VV.AD_SESSIONS} sessions" in ad and f"at least {move} higher" in ad
    pp = block("pocket_pivots_20")
    assert f"the last {VV.PIVOT_SESSIONS} sessions" in pp and f"of the {VF.PIVOT_LOOKBACK} sessions before it" in pp
    assert f"its {VF.PIVOT_MA}-day average" in pp
    assert f"fewer than {VV.PIVOT_SESSIONS + VF.PIVOT_LOOKBACK + 1} sessions" in pp
    assert f"a fall of {round(MH.CORRECTION_MIN * 100)}% or more" in block("corr_rel_last")


def test_every_column_publishes_a_method_with_its_owners_definition():
    from api.services import realized_vol as RV
    from api.services.screener import methodology as M
    doc = M.all_methods()
    published = {m["column"]: m for m in doc["methods"]}
    for c in VV.COLUMNS:
        m = published.get(c)
        assert m is not None, f"{c} ships without a method"
        assert m["family"] == "volume_volatility" and m["one_line"] and m["scale"] and m["how"] and m["caveat"]
        assert "never 0" in m["caveat"] and "stored daily bars" in m["how"], c
    assert RV.METHOD in published["hv_20"]["how"]
    assert "Acc/Dis" in published["ad_net_25"]["caveat"]
    assert "MKTH's one definition" in published["corr_rel_last"]["how"]
    assert doc["volume_volatility"]["columns"] == list(VV.COLUMNS)
    assert "20:15" in doc["as_of_note"] and "None of them" in doc["as_of_note"]


def test_the_new_methods_are_read_from_the_owners(monkeypatch):
    from api.services.screener import methodology as M
    monkeypatch.setattr(VF, "AD_MIN_MOVE", 0.003)
    monkeypatch.setattr(VF, "PIVOT_LOOKBACK", 12)
    monkeypatch.setattr(VV, "PIVOT_SESSIONS", 15)
    monkeypatch.setattr(SC, "MAX_GAP_DAYS", 7)
    by = {m["column"]: m for m in M._volume_volatility_methods()}
    assert "at least 0.3% above" in by["ad_net_25"]["how"]
    assert "among the 12 sessions before it" in by["pocket_pivots_20"]["how"]
    assert by["pocket_pivots_20"]["label"] == "Pocket Pivots, Last 15 Sessions"
    assert "within 7 days on or before it" in by["corr_rel_last"]["caveat"]
