"""Rails for the V2c2 corrected specification (targeted corrections to the validated V2c
pipeline). Each test pins one finding of the 2026-09-23 final validation."""
import datetime as dt
import json
import math

import numpy as np
import pandas as pd
import pytest

from api.services import breadth_adjusted_guard as bag
from api.services import breadth_calendar as bcal
from api.services import breadth_identity as bi
from api.services import breadth_live as bl
from api.services import breadth_ticker as bt
from api.services import breadth_universes as bu
from api.services import breadth_wick_recon as wr


# ── dual-class spelling ───────────────────────────────────────────────────────
def test_canon_maps_the_collector_dash_to_the_provider_dot_and_nothing_else():
    assert bt.canon("BRK-B") == "BRK.B"
    assert bt.canon("BRK.B") == "BRK.B"          # provider spelling is already canonical
    assert bt.canon("SPGI-WI") == "SPGI.WI"
    assert bt.canon("BFSpD") == "BFSpD"          # no upper-casing: ABCp must not become ABCP
    assert bt.canon("AAPL") == "AAPL"


def test_canon_map_refuses_a_spelling_collision():
    with pytest.raises(ValueError):
        bt.canon_map({"BRK-B": 1.0, "BRK.B": 2.0})
    assert bt.canon_map({"BRK-B": 1.0, "BRK.B": 1.0}) == {"BRK.B": 1.0}


def test_session_basis_keys_the_factor_by_the_provider_spelling(monkeypatch):
    from api.services import massive
    monkeypatch.setattr(massive, "get_grouped_daily_closes",
                        lambda iso, adjusted=True: {"BRK.B": 500.0 if adjusted else 250.0})
    f = wr.session_basis(None, 20200316, {"BRK.B"})
    assert f == {"BRK.B": 2.0}                   # was keyed BRK-B and so never matched


# ── session calendar ──────────────────────────────────────────────────────────
@pytest.mark.parametrize("iso,trading", [
    ("2012-10-29", False), ("2012-10-30", False), ("2018-12-05", False), ("2025-01-09", False),
    ("2022-06-20", False), ("2021-06-18", True), ("2011-01-03", True), ("2010-12-31", True),
    ("2021-12-24", False), ("2020-07-03", False), ("2015-04-03", False), ("2026-09-11", True)])
def test_calendar_trading_days(iso, trading):
    assert bcal.is_trading_day(iso) is trading


@pytest.mark.parametrize("iso,last_bar", [
    ("2008-11-28", 12 * 60 + 59), ("2012-07-03", 12 * 60 + 59), ("2019-12-24", 12 * 60 + 59),
    ("2008-10-10", 15 * 60 + 59), ("2020-03-16", 15 * 60 + 59), ("2021-12-23", 15 * 60 + 59)])
def test_session_window_excludes_the_closing_auction(iso, last_bar):
    assert bcal.session_window(iso) == (9 * 60 + 30, last_bar)


def _bars(minutes, px, date="2020-03-16"):
    from zoneinfo import ZoneInfo
    d = dt.date.fromisoformat(date)
    out = []
    for m in minutes:
        t = dt.datetime(d.year, d.month, d.day, m // 60, m % 60, tzinfo=ZoneInfo("America/New_York"))
        out.append({"t": int(t.timestamp()), "o": px, "h": px, "l": px, "c": px, "v": 100})
    return out


def test_calendar_window_keeps_1559_drops_the_auction_and_keeps_a_halt_as_a_gap():
    # 60 names print 09:30-15:59 except a 15-minute halt; the 16:00 cross is thin (would have
    # moved the derived boundary to 15:58), and a 16:00 print exists.
    mins = [m for m in range(570, 960) if not (600 <= m < 615)] + [960]
    per = {"T%02d" % i: _bars(mins, 10.0) for i in range(60)}
    n = 60
    lv = {"tickers": list(per), "prev_close": np.full(n, 9.0), "n_dates": 380, "n52": 252, "n20": 20,
          "sma_prev_sum": {w: np.full(n, 9.0 * (w - 1)) for w in (5, 10, 40, 50, 100, 150, 200)},
          "sma_ok": {w: np.ones(n, bool) for w in (5, 10, 40, 50, 100, 150, 200)},
          "ema20_prev": np.full(n, 9.0), "back": {b: np.full(n, 9.0) for b in (1, 5, 21, 34, 65)},
          "max52": np.full(n, 11.0), "max52_ok": np.ones(n, bool), "min52": np.full(n, 8.0),
          "min52_ok": np.ones(n, bool), "max20": np.full(n, 11.0), "max20_ok": np.ones(n, bool),
          "min20": np.full(n, 8.0), "min20_ok": np.ones(n, bool), "maxath": np.full(n, 11.0),
          "maxath_ok": np.ones(n, bool), "sma200_back21": np.full(n, 8.5), "vol_max52": np.full(n, np.nan),
          "vol_avg20": np.full(n, np.nan), "mcc_ema19": 0.0, "mcc_ema39": 0.0}
    out = wr.session_ohlc("2020-03-16", per, lv, 1, calendar_window=True,
                          eod_prices={t: 10.0 for t in per})
    s = out["_session"]
    assert s["last_bar_min"] == 959 and s["expected_buckets"] == 390
    assert s["buckets"] == 390 - 15                   # the halt stays a gap, never repaired


# ── adjusted-series guard ─────────────────────────────────────────────────────
def _write_cache(tmp_path, series, manifest_times=None):
    cal = sorted({d for d, _t, _r, _a in series})
    for d in cal:
        adj = {t: a for dd, t, r, a in series if dd == d}
        raw = {t: r for dd, t, r, a in series if dd == d}
        (tmp_path / f"{d}_1.json").write_text(json.dumps(adj))
        (tmp_path / f"{d}_0.json").write_text(json.dumps(raw))
    man = {"manifest": {f"{d}_1": {"fetched_start": (manifest_times or {}).get(d, "2026-09-23T18:00:00Z")}
                        for d in cal}}
    return cal, man


def test_guard_classes(tmp_path):
    days = ["2020-01-0%d" % i for i in range(2, 10)]
    s = []
    for i, d in enumerate(days):
        s.append((d, "SPLT", 100.0 if i < 3 else 50.5, 50.0 if i < 3 else 50.5))  # real 2:1 split
        s.append((d, "BAD", 20.0, 20.0 if i < 5 else 40.0))                       # adjusted-only doubling
        s.append((d, "OK", 10.0 + i, 10.0 + i))
    cal, man = _write_cache(tmp_path, s)
    t = bag.build_events(str(tmp_path), man, [{"ticker": "BAD", "execution_date": days[5],
                                               "split_from": 1, "split_to": 2}], cal)
    cls = {(e["t"], e["to"]): e["class"] for e in t["events"]}
    assert cls[("SPLT", days[3])] == "REAL_ACTION"
    assert cls[("BAD", days[5])] == "PROVIDER_DEFECT"        # a ledger row never overrules raw
    assert ("OK", days[3]) not in cls
    g = bag.Guard(t)
    assert g.withheld("BAD", days[0], days[5]) and g.withheld("BAD", days[0], days[7])
    assert not g.withheld("BAD", days[5], days[7])           # frame no longer straddles E
    assert not g.withheld("SPLT", days[0], days[7])


def test_guard_marks_a_split_executed_between_fetches_as_inconsistent_vintage(tmp_path):
    days = ["2026-09-09", "2026-09-10", "2026-09-11"]
    s = [(days[0], "WHLR", 3.0, 3.0), (days[1], "WHLR", 3.0, 3.0), (days[2], "WHLR", 3.1, 0.34)]
    cal, man = _write_cache(tmp_path, s, {days[1]: "2026-09-22T08:06:00Z", days[2]: "2026-09-21T02:08:00Z"})
    t = bag.build_events(str(tmp_path), man, [{"ticker": "WHLR", "execution_date": "2026-09-22",
                                               "split_from": 9, "split_to": 1}], cal)
    assert [e["class"] for e in t["events"]] == ["INCONSISTENT_VINTAGE"]


def test_guard_ignores_a_sub_tick_step_and_refuses_a_step_across_a_gap(tmp_path):
    days = ["2020-02-%02d" % i for i in range(3, 20) if dt.date(2020, 2, i).weekday() < 5]
    s = [(days[0], "PNY", 0.10, 0.10), (days[1], "PNY", 0.10, 0.11),              # one raw cent
         (days[0], "GAP", 10.0, 10.0), (days[8], "GAP", 10.0, 20.0)]               # 8 sessions apart
    for d in days:
        s.append((d, "FILL", 1.0, 1.0))
    cal, man = _write_cache(tmp_path, s)
    t = bag.build_events(str(tmp_path), man, [], cal)
    cls = {e["t"]: e["class"] for e in t["events"]}
    assert "PNY" not in cls and cls["GAP"] == "UNRESOLVED"


# ── identity ──────────────────────────────────────────────────────────────────
def _ledger(cur, events, segs, asof):
    return {"current": cur, "events": {"events": [{"type": "ticker_change", "date": d,
                                                   "ticker_change": {"ticker": t}} for d, t in events]},
            "segments": segs, "asof_at_segment_start": asof}


def test_identity_rules():
    raw = {("2024-10-01", "BLK"): 934.0, ("2024-10-02", "BLK"): 957.2,
           ("2023-09-20", "ABAT"): 1.0, ("2023-09-21", "ABAT"): 1.1}
    prev = {"2024-10-02": "2024-10-01", "2023-09-21": "2023-09-20"}
    rc, ps = (lambda iso, t: raw.get((iso, t))), (lambda iso: prev.get(iso))
    blk = bi.classify_ticker("BLK", _ledger({"cik": "new", "list_date": "1999-10-01"},
                                            [("2024-10-02", "BLK")], [("2005-10-24", "2026-09-11")],
                                            {"2005-10-24": {"cik": "old", "name": "BLACKROCK INC"}}), rc, ps, "2026-09-11")
    assert blk[0][3] == "REORG" and blk[0][2] == "2005-10-24"
    abat = bi.classify_ticker("ABAT", _ledger({"cik": "1576873", "list_date": "2019-01-01"},
                                              [("2023-09-11", "ABML"), ("2023-09-21", "ABAT")],
                                              [("2008-02-26", "2011-11-15"), ("2023-09-21", "2026-09-11")],
                                              {"2008-02-26": None, "2023-09-21": {"cik": "1576873"}}), rc, ps, "2026-09-11")
    assert [r[3] for r in abat] == ["EXCLUDED", "PIT_MATCH"]
    I = bi.Identity({"rule": "t", "tickers": {"ABAT": abat, "BLK": blk}})
    assert not I.allowed("ABAT", "2010-06-01") and I.allowed("ABAT", "2024-01-02")
    assert I.allowed("BLK", "2008-10-10")


def test_research_universe_is_not_in_the_production_registry():
    from api.services import breadth_corrected_pass as cp
    assert "uct_backtest" not in bu.UNIVERSES and "uct_backtest" not in bu.UNIVERSE_IDS
    assert cp.applies("pct_above_50sma", "uct_backtest") and not cp.applies("breadth_score", "uct_backtest")
    assert cp.applies("ratio_5day", "nyse")


# ── EMA ───────────────────────────────────────────────────────────────────────
def test_ewm_last_equals_pandas_adjust_false_with_gaps():
    rng = np.random.default_rng(3)
    X = 100 + np.cumsum(rng.normal(0, 1, (7, 80)), axis=1)
    X[1, 30] = np.nan; X[2, 10:14] = np.nan; X[3, :6] = np.nan; X[4, 79] = np.nan
    X[5, ::7] = np.nan; X[6] = X[6] * 0.25                     # sparse; split-adjusted scale
    ref = pd.DataFrame(X.T).ewm(alpha=bl._EMA20_ALPHA, adjust=False, ignore_na=False).mean().iloc[-1]
    assert np.allclose(bl._ewm_last(X, bl._EMA20_ALPHA), ref.to_numpy(), rtol=0, atol=1e-10)


# ── rolling ratios ────────────────────────────────────────────────────────────
def test_rolling_ratios_follow_the_monitor_definition_and_need_a_full_window():
    m = {"up_4pct_today": 30.0, "down_4pct_today": 10.0}
    wr._add_rolling(m, {5: (70.0, 90.0), 10: (100.0, 0.0)})
    assert m["ratio_5day"] == round(100.0 / 100.0, 2) and m["ratio_10day"] == round(130 / 10, 2)
    m = {"up_4pct_today": 1.0, "down_4pct_today": 0.0}
    wr._add_rolling(m, {5: (0.0, 0.0)})
    assert "ratio_5day" not in m                              # zero down-sum is not a value
    m = {"up_4pct_today": 1.0, "down_4pct_today": 1.0}
    wr._add_rolling(m, {})
    assert "ratio_5day" not in m                              # no prior window, no value
