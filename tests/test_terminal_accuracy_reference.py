"""Terminal ACCURACY lane (2026-10-06): the backend numbers behind terminal functions, each
checked against an INDEPENDENT reference calculation (numpy / pandas / hand-derived), on real
market data committed under tests/fixtures/terminal_accuracy/.

The fixture is Yahoo Finance daily OHLC for NVDA and SPY, 2023-01-03 .. 2026-10-02
(auto_adjust=False: split-adjusted, NOT dividend-adjusted -- the same basis the bar store
serves). Every reference below is written from the textbook definition, never by calling the
product helper it checks. The audit write-up is
docs/terminal-research/15-accuracy/accuracy-audit-2026-10-06.md.
"""
from __future__ import annotations

import json
import math
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

FIXTURE = Path(__file__).parent / "fixtures" / "terminal_accuracy" / "nvda_spy_daily_2023_2026.json"


@pytest.fixture(scope="module")
def fx():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def _bars(fx, sym):
    return [{"t": d, "o": o, "h": h, "l": l, "c": c} for d, o, h, l, c in fx["rows"][sym]]


def _frame(fx, sym):
    df = pd.DataFrame(fx["rows"][sym], columns=["d", "o", "h", "l", "c"]).set_index("d")
    df.index = pd.to_datetime(df.index)
    return df


# ── VOL / IVH: historical volatility (options_analytics.vol.hv) ─────────────────────────────

@pytest.mark.parametrize("n", [10, 20, 30])
def test_hv_matches_numpy_sample_std_of_log_returns(fx, n):
    from api.services.options_analytics import vol
    closes = [r[4] for r in fx["rows"]["NVDA"]]
    ref = float(np.std(np.diff(np.log(np.array(closes[-(n + 1):]))), ddof=1) * math.sqrt(252))
    assert vol.hv(closes, n) == pytest.approx(ref, rel=1e-12)


def test_hv_needs_n_plus_one_closes():
    from api.services.options_analytics import vol
    assert vol.hv([100.0] * 10, 10) is None


# ── ERX: realized vol, reaction rows, summary stats (earnings_reaction_panel) ────────────────

def test_erx_realized_vol_is_population_std_of_20_log_returns(fx):
    from api.services import earnings_reaction_panel as erp
    bars = _bars(fx, "NVDA")
    closes = np.array([b["c"] for b in bars[-21:]])
    ref = float(np.std(np.diff(np.log(closes)), ddof=0) * math.sqrt(252) * 100)
    got = erp.realized_vol(bars)
    assert got["annualized_pct"] == round(ref, 1)
    assert got["through"] == "2026-10-02"


# NVDA reports after the close; these are its report dates in the fixture window.
NVDA_REPORTS = ["2024-02-21", "2024-05-22", "2024-08-28", "2024-11-20",
                "2025-02-26", "2025-05-28", "2025-08-27", "2025-11-19"]


def test_erx_quarter_rows_match_a_pandas_reference(fx):
    from api.services import earnings_reaction_panel as erp
    bars = _bars(fx, "NVDA")
    df = _frame(fx, "NVDA")
    quarters = [{"reported": True, "report_date": d, "label": d} for d in reversed(NVDA_REPORTS)]
    rows = {r["report_date"]: r for r in erp.quarter_rows(quarters, bars, limit=8)}
    prev_c = df["c"].shift(1)
    gap = (df["o"] / prev_c - 1) * 100
    for d in NVDA_REPORTS:
        i = df.index.get_loc(pd.Timestamp(d))
        # the reacting session: report day or the next one, whichever opened further from its prior close
        s = max((i, i + 1), key=lambda k: abs(gap.iloc[k]))
        r = rows[d]
        assert r["session"] == df.index[s].strftime("%Y-%m-%d")
        assert r["gap_pct"] == round(gap.iloc[s], 2)
        assert r["reaction_pct"] == round((df["c"].iloc[s] / df["c"].iloc[s - 1] - 1) * 100, 2)
        assert r["run_in_pct"] == round((df["c"].iloc[s - 1] / df["c"].iloc[s - 6] - 1) * 100, 2)
        assert r["drift_pct"] == round((df["c"].iloc[s + 5] / df["c"].iloc[s] - 1) * 100, 2)
    # every AMC print reacts on the NEXT session
    assert all(rows[d]["session"] > d for d in NVDA_REPORTS)


def test_erx_stat_block_matches_numpy():
    from api.services import earnings_reaction_panel as erp
    vals = [3.2, -8.5, None, 16.4, 0.0, -2.1]
    v = np.array([x for x in vals if x is not None])
    got = erp._stat(vals)
    assert got == {"n": 5, "avg": round(float(v.mean()), 2), "avg_abs": round(float(np.abs(v).mean()), 2),
                   "median": round(float(np.median(v)), 2), "pct_up": round(100 * float((v > 0).mean()))}


# ── SEAS: seasonality by month and weekday (services/seasonality) ───────────────────────────

def test_seasonality_months_and_weekdays_match_pandas(fx):
    from api.services import seasonality as seas
    bars = _bars(fx, "NVDA")
    out = seas.compute(bars)
    df = _frame(fx, "NVDA")
    month_end = df["c"].resample("ME").last()
    rets = month_end.pct_change().iloc[1:-1]          # first month = base only; last = still running
    for m in out["months"]:
        sel = rets[rets.index.month == m["month"]]
        assert m["n"] == len(sel)
        if len(sel):
            assert m["avg_pct"] == round(float(sel.mean()) * 100, 2)
            assert m["median_pct"] == round(float(sel.median()) * 100, 2)
            assert m["pct_up"] == round(float((sel > 0).mean()) * 100)
    daily = df["c"].pct_change().iloc[1:]
    for w in out["weekdays"]:
        sel = daily[daily.index.weekday == w["weekday"]]
        assert w["n"] == len(sel)
        assert w["avg_pct"] == round(float(sel.mean()) * 100, 2)
    assert out["full_months"] == len(rets)
    assert (out["covered_from"], out["covered_to"]) == ("2023-01-03", "2026-10-02")


# ── IVH / VOL: constant-maturity IV by total-variance interpolation ──────────────────────────

def test_interpolated_iv_is_total_variance_linear():
    from api.services.options_analytics import vol
    pts = [{"dte": 9, "atm_iv": 0.52}, {"dte": 37, "atm_iv": 0.44}, {"dte": 72, "atm_iv": 0.41}]
    # hand-derived: w = iv^2 * t; w(30) = w9 + (w37 - w9) * (30 - 9) / (37 - 9); iv = sqrt(w / 30)
    w9, w37 = 0.52 ** 2 * 9, 0.44 ** 2 * 37
    ref = math.sqrt((w9 + (w37 - w9) * 21 / 28) / 30)
    assert vol.interpolate_iv(pts, 30)["iv"] == round(ref, 4)
    assert vol.interpolate_iv(pts, 9)["iv"] == 0.52
    assert vol.interpolate_iv(pts, 5)["iv"] is None          # never extrapolated
    assert vol.interpolate_iv(pts, 90)["iv"] is None


# ── POS: max pain (options_analytics.positioning.max_pain_from) ─────────────────────────────

def test_max_pain_matches_a_numpy_brute_force():
    from api.services.options_analytics import positioning as pos
    rng = np.random.default_rng(7)
    strikes = np.arange(150, 231, 5.0)
    rows = []
    for k in strikes:
        rows.append({"expiration": "2026-10-16", "strike": float(k), "cp": "C", "oi": int(rng.integers(0, 9000))})
        rows.append({"expiration": "2026-10-16", "strike": float(k), "cp": "P", "oi": int(rng.integers(0, 9000))})
    rows.append({"expiration": "2026-10-16", "strike": 300.0, "cp": "C", "oi": None})
    ch = {"rows": rows, "spot": 187.4, "source": "yfinance", "window": ["2026-10-06", "2026-11-05"],
          "truncated": False}
    K = np.array([r["strike"] for r in rows if r["oi"]])
    OI = np.array([r["oi"] for r in rows if r["oi"]])
    CALL = np.array([r["cp"] == "C" for r in rows if r["oi"]])
    cands = np.unique(K)
    pain = [float(np.sum(np.where(CALL, np.maximum(0, s - K), np.maximum(0, K - s)) * OI * 100)) for s in cands]
    best = float(cands[int(np.argmin(pain))])
    got = pos.max_pain_from("NVDA", "month", ch)["expirations"][0]
    assert got["max_pain"] == best
    assert got["payout_at_max_pain"] == round(min(pain))
    assert got["distance_pct"] == round((best - 187.4) / 187.4 * 100, 2)


# ── EE / ERN / FA: surprise % (three helpers, one definition) ───────────────────────────────

@pytest.mark.parametrize("actual,estimate", [(0.81, 0.75), (-0.12, -0.20), (1.05, 1.10), (2.0, -0.5)])
def test_surprise_pct_helpers_agree_with_the_definition(actual, estimate):
    from api.services import earnings_estimates as ee
    from api.services import earnings_history_fmp as ehf
    from api.services import earnings_intel as ei
    ref = (actual - estimate) / abs(estimate) * 100
    assert ee._surprise_pct(actual, estimate) == round(ref, 1)
    assert ehf._pct(actual, estimate) == pytest.approx(ref)
    pct, diff, _ = ei._surprise(actual, estimate, eps=True)
    assert pct == pytest.approx(ref) and diff == pytest.approx(actual - estimate)


def test_surprise_on_a_zero_or_near_zero_estimate_is_not_a_percentage():
    from api.services import earnings_estimates as ee
    from api.services import earnings_intel as ei
    assert ee._surprise_pct(0.03, 0) is None
    assert ei._surprise(0.03, 0.01, eps=True)[0] is None     # +200% would overstate a 2-cent beat


# ── fiscal-quarter labelling (fiscal_calendar) against each company's OWN label ─────────────

# (fiscal year ends the company filed, a quarter's period end, the company's own label)
FISCAL_TRUTH = [
    ("NVDA", ["2024-01-28", "2025-01-26", "2026-01-25"], "2025-10-26", (2026, 3)),
    ("NVDA", ["2024-01-28", "2025-01-26", "2026-01-25"], "2026-07-26", (2027, 2)),
    ("AAPL", ["2023-09-30", "2024-09-28", "2025-09-27"], "2025-12-27", (2026, 1)),
    ("AAPL", ["2023-09-30", "2024-09-28", "2025-09-27"], "2026-06-27", (2026, 3)),
    ("MSFT", ["2024-06-30", "2025-06-30"], "2025-09-30", (2026, 1)),
    ("MSFT", ["2024-06-30", "2025-06-30"], "2026-03-31", (2026, 3)),
    ("WMT", ["2025-01-31", "2026-01-31"], "2025-10-31", (2026, 3)),
    ("MU", ["2024-08-29", "2025-08-28"], "2025-11-27", (2026, 1)),
    ("TSM", ["2024-12-31", "2025-12-31"], "2026-06-30", (2026, 2)),
]


@pytest.mark.parametrize("sym,year_ends,period_end,truth", FISCAL_TRUTH)
def test_fiscal_calendar_matches_the_companys_own_quarter_label(sym, year_ends, period_end, truth):
    from api.services.fiscal_calendar import FiscalCalendar
    got = FiscalCalendar(year_ends).resolve(period_end)
    assert (got["fiscal_year"], got["fiscal_quarter"]) == truth, sym


# ── short interest: FINRA settlement dates (hand-derived from FINRA's published rule) ───────

def test_finra_settlement_dates_hand_derived():
    from api.services import short_interest as si
    # 2024-01-15 = MLK day -> Fri 01-12; 2026-02-15 = Sunday -> Fri 02-13;
    # 2026-05-31 = Sunday -> Fri 05-29; 2025-11-30 = Sunday -> Fri 11-28.
    assert si.settlement_dates_before(date(2024, 1, 20), 2) == [date(2024, 1, 12), date(2023, 12, 29)]
    assert si.settlement_dates_before(date(2026, 2, 20), 1) == [date(2026, 2, 13)]
    assert si.settlement_dates_before(date(2026, 6, 3), 2) == [date(2026, 5, 29), date(2026, 5, 15)]
    assert si.settlement_dates_before(date(2025, 12, 3), 1) == [date(2025, 11, 28)]


def test_short_interest_derived_shares_short(fx):
    from api.services import short_interest as si
    row = {"short_float_pct": 1.12, "short_ratio": 1.41, "float_shares": 23.42e9, "shares_outstanding": 24.3e9}
    got = si._derive(row, set())
    assert got["shares_short"] == round(0.0112 * 23.42e9)
    assert got["short_pct_of_shares_outstanding"] == round(0.0112 * 23.42e9 / 24.3e9 * 100, 2)


# ── the session calendar: every weekday SPY did not trade is an NYSE holiday, and back ──────

def test_nyse_holiday_table_matches_the_sessions_spy_actually_traded(fx):
    from api.services.nyse_calendar import NYSE_HOLIDAYS_YYYYMMDD
    traded = {r[0] for r in fx["rows"]["SPY"]}
    d, end = date(2023, 1, 3), date(2026, 10, 2)
    missing, phantom = [], []
    while d <= end:
        key = int(d.strftime("%Y%m%d"))
        if d.weekday() < 5:
            if d.isoformat() not in traded and key not in NYSE_HOLIDAYS_YYYYMMDD:
                missing.append(d.isoformat())
            if d.isoformat() in traded and key in NYSE_HOLIDAYS_YYYYMMDD:
                phantom.append(d.isoformat())
        d += timedelta(days=1)
    assert missing == [] and phantom == []


# ── ERX / ERN / CAL: implied move must use an expiry that HOLDS the print ────────────────────

# NVDA's listed expiries on 2026-10-06 (read live from the chain): Mon/Wed/Fri weeklies.
NVDA_EXPIRIES = ["2026-10-07", "2026-10-09", "2026-10-12", "2026-10-14", "2026-10-16"]


def test_an_after_close_report_skips_the_same_day_expiry():
    from api.services import implied_move as im
    # Wednesday after the close: the Wednesday expiry settles at 4 PM, BEFORE the print.
    assert im.select_report_expiry(NVDA_EXPIRIES, "2026-10-07", "amc") == "2026-10-09"
    assert im.select_report_expiry(NVDA_EXPIRIES, "2026-10-07", "AMC ") == "2026-10-09"
    # before the open (and unknown timing, unchanged): the same-day expiry settles after the reaction
    assert im.select_report_expiry(NVDA_EXPIRIES, "2026-10-07", "bmo") == "2026-10-07"
    assert im.select_report_expiry(NVDA_EXPIRIES, "2026-10-07") == "2026-10-07"
    # a Thursday AMC with no Thursday expiry is unaffected
    assert im.select_report_expiry(NVDA_EXPIRIES, "2026-10-08", "amc") == "2026-10-09"


def test_get_expected_move_threads_amc_and_caches_it_apart(monkeypatch):
    from api.services import implied_move as im
    seen = []

    def fake_compute(sym, rd, **kw):
        seen.append(kw.get("timing"))
        return {"pct": 6.0, "dollar": 11.0, "expiry": "2026-10-09"}

    im._MOVE_CACHE.clear()
    for k in ("expmove::TSTA::2026-10-07", "expmove::TSTA::2026-10-07::amc"):
        im._MOVE_STALE.forget(k)
    monkeypatch.setattr(im, "compute_expected_move", fake_compute)
    im.get_expected_move("TSTA", "2026-10-07")
    im.get_expected_move("TSTA", "2026-10-07", timing="amc")
    assert seen == [None, "amc"], "an AMC read must not be served the same-day expiry's cached answer"


def test_calendar_enrichment_hands_amc_timing_to_the_straddle(monkeypatch):
    from api.routers import calendar as cal
    from api.services import implied_move as im
    got = {}

    def fake_gem(sym, target, *, outcome=None, timing=None):
        got[sym] = timing
        return None

    monkeypatch.setattr(im, "get_expected_move", fake_gem)
    cal._inhouse_move("NVDA", "2026-10-07", timing="amc")
    cal._inhouse_move("JPM", "2026-10-07")
    assert got == {"NVDA": "amc", "JPM": None}


# ── EE: a quarter carries the company's FISCAL label, not a calendar one ─────────────────────

def test_fiscal_calendar_absorbs_a_drifting_quarter_end():
    from api.services.fiscal_calendar import FiscalCalendar
    # FMP's recorded AAPL rows: year end normalised to 09-27, fiscal Q2 2026 ending 03-28.
    cal = FiscalCalendar(["2024-09-27", "2025-09-27", "2026-09-27", "2027-09-27"])
    got = [cal.resolve(p)["fiscal_quarter"] for p in ("2025-12-27", "2026-03-28", "2026-06-27", "2026-09-27")]
    assert got == [1, 2, 3, 4], "two quarters must never share one label"


def test_ee_quarterly_rows_carry_the_companys_fiscal_label():
    from api.services.research import estimates_consensus as ec
    fx = Path(__file__).parent / "fixtures"
    q = json.loads((fx / "broker_estimates" / "fmp_analyst_estimates_quarter_AAPL.json").read_text(encoding="utf-8"))
    a = json.loads((fx / "fmp_depth" / "analyst_estimates_annual_AAPL.json").read_text(encoding="utf-8"))
    rows = ec.fiscal_relabel(ec.shape_rows(q, "quarterly", today=date(2026, 10, 3)), a)
    by_end = {r["period_end"]: r["label"] for r in rows}
    # Apple's own labels: the December quarter opens its fiscal year
    assert by_end["2026-12-27"] == "Q1 FY2027"
    assert by_end["2027-03-27"] == "Q2 FY2027"
    assert by_end["2027-09-27"] == "Q4 FY2027"
    assert len(set(by_end.values())) == len(by_end)


def test_ee_relabel_leaves_a_december_filer_and_an_unanchored_payload_alone():
    from api.services.research import estimates_consensus as ec
    rows = [{"period_end": "2026-12-31", "label": "Q4 2026"}, {"period_end": "2027-03-31", "label": "Q1 2027"}]
    dec = ec.fiscal_relabel([dict(r) for r in rows], [{"date": "2025-12-31"}, {"date": "2026-12-31"}])
    assert [r["label"] for r in dec] == ["Q4 2026", "Q1 2027"]
    assert [r["label"] for r in ec.fiscal_relabel([dict(r) for r in rows], [])] == ["Q4 2026", "Q1 2027"]
    # NVIDIA: January year end. The October 2026 quarter is its Q3 of FY2027.
    nv = ec.fiscal_relabel([{"period_end": "2026-10-31", "label": "Q3 2026"}],
                           [{"date": "2026-01-31"}, {"date": "2027-01-31"}])
    assert nv[0]["label"] == "Q3 FY2027"


def test_get_consensus_serves_the_fiscal_labels(monkeypatch):
    """The wire: get_consensus must hand its quarterly rows through fiscal_relabel."""
    from api.services.research import estimates_consensus as ec
    fx = Path(__file__).parent / "fixtures"
    q = json.loads((fx / "broker_estimates" / "fmp_analyst_estimates_quarter_AAPL.json").read_text(encoding="utf-8"))
    a = json.loads((fx / "fmp_depth" / "analyst_estimates_annual_AAPL.json").read_text(encoding="utf-8"))

    class _C(dict):
        def set(self, k, v, ttl=None):
            self[k] = v

    monkeypatch.setattr(ec, "_cache", lambda c=_C(): c)
    monkeypatch.setattr(ec, "_read", lambda sym, period, limit: ("ok", a if period == "annual" else q))
    monkeypatch.setattr(ec, "read_last_report", lambda sym, timeout=10: ("ok", "2026-07-30"))
    monkeypatch.setattr(ec.reporting_currency, "read", lambda sym, timeout=10: ("ok", "USD"))
    out = ec.get_consensus("AAPLX", today=date(2026, 10, 3))
    labels = {r["period_end"]: r["label"] for r in out["quarterly"]}
    assert labels["2026-12-27"] == "Q1 FY2027"
