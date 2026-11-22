"""Statements: FMP first, one payload shape, and the SAME fiscal labels.

`financial_statements.get_statements` feeds three things: the Charts Financials
dock, the earnings model's fiscal calendar, and the Agent's `fundamentals` kind.
It now asks FMP first and Yahoo Finance only for a ticker FMP holds nothing for.

The risk in that order is the fiscal calendar. FMP reports the day a period
really ended (Apple: Saturday 2025-09-27), the payload has always carried the
month end (2025-09-30), and the calendar turns those dates into "FY2026 Q1". A
date that moves a few days can move a quarter to its neighbour, so the first
half of this file builds the SAME companies through BOTH sources and requires
the labels to be identical, with today's labels written out by hand as pins.

No network: Yahoo is a fake `Ticker`, FMP is a stub of the reader's one fetch
function, and both caches are private to each test.
"""
from __future__ import annotations

import types
from datetime import date, timedelta

import pandas as pd
import pytest

import api.services.earnings_intel as ei
import api.services.financial_statements as fs
import api.services.research.financial_history as fh
from api.services.fiscal_calendar import FiscalCalendar

# ── the companies: period ends AS REPORTED, newest first ─────────────────────
CASES = {
    # December year end; quarters close on the Friday nearest the month end
    "KO": dict(
        annual=["2025-12-31", "2024-12-31", "2023-12-31", "2022-12-31", "2021-12-31"],
        quarterly=["2026-09-25", "2026-06-26", "2026-03-27", "2025-12-31", "2025-09-26", "2025-06-27",
                   "2025-03-28", "2024-12-31", "2024-09-27", "2024-06-28", "2024-03-29", "2023-12-31"]),
    # September year end, 52/53 weeks; the year ended 2023-09-30 had 53
    "AAPL": dict(
        annual=["2025-09-27", "2024-09-28", "2023-09-30", "2022-09-24", "2021-09-25", "2020-09-26",
                "2019-09-28", "2018-09-29", "2017-09-30", "2016-09-24", "2015-09-26", "2014-09-27"],
        quarterly=["2026-06-27", "2026-03-28", "2025-12-27", "2025-09-27", "2025-06-28", "2025-03-29",
                   "2024-12-28", "2024-09-28", "2024-06-29", "2024-03-30", "2023-12-30", "2023-09-30",
                   "2023-07-01", "2023-04-01", "2022-12-31", "2022-09-24", "2022-06-25", "2022-03-26",
                   "2021-12-25", "2021-09-25", "2021-06-26", "2021-03-27", "2020-12-26", "2020-09-26"]),
    # January year end on the month end (a retailer)
    "WMT": dict(
        annual=["2026-01-31", "2025-01-31", "2024-01-31", "2023-01-31", "2022-01-31", "2021-01-31"],
        quarterly=["2026-10-31", "2026-07-31", "2026-04-30", "2026-01-31", "2025-10-31", "2025-07-31",
                   "2025-04-30", "2025-01-31", "2024-10-31", "2024-07-31", "2024-04-30", "2024-01-31"]),
    # January year end, the Saturday nearest 31 January (a retailer); 2024-02-03 closed a 53-week year
    "TGT": dict(
        annual=["2026-01-31", "2025-02-01", "2024-02-03", "2023-01-28", "2022-01-29", "2021-01-30"],
        quarterly=["2026-10-31", "2026-08-01", "2026-05-02", "2026-01-31", "2025-11-01", "2025-08-02",
                   "2025-05-03", "2025-02-01", "2024-11-02", "2024-08-03", "2024-05-04", "2024-02-03",
                   "2023-10-28", "2023-07-29", "2023-04-29", "2023-01-28"]),
    # the last Sunday of January
    "NVDA": dict(
        annual=["2026-01-25", "2025-01-26", "2024-01-28", "2023-01-29", "2022-01-30", "2021-01-31"],
        quarterly=["2026-10-25", "2026-07-26", "2026-04-26", "2026-01-25", "2025-10-26", "2025-07-27",
                   "2025-04-27", "2025-01-26", "2024-10-27", "2024-07-28", "2024-04-28", "2024-01-28",
                   "2023-10-29", "2023-07-30", "2023-04-30", "2023-01-29"]),
    # the Sunday nearest 31 October: some year ends land in November
    "AVGO": dict(
        annual=["2025-11-02", "2024-11-03", "2023-10-29", "2022-10-30", "2021-10-31", "2020-11-01"],
        quarterly=["2026-08-02", "2026-05-03", "2026-02-01", "2025-11-02", "2025-08-03", "2025-05-04",
                   "2025-02-02", "2024-11-03", "2024-08-04", "2024-05-05", "2024-02-04", "2023-10-29",
                   "2023-07-30", "2023-04-30", "2023-01-29", "2022-10-30"]),
    # the Thursday nearest 31 August
    "MU": dict(
        annual=["2025-08-28", "2024-08-29", "2023-08-31", "2022-09-01", "2021-09-02"],
        quarterly=["2026-05-28", "2026-02-26", "2025-11-27", "2025-08-28", "2025-05-29", "2025-02-27",
                   "2024-11-28", "2024-08-29", "2024-05-30", "2024-02-29", "2023-11-30", "2023-08-31"]),
    # the Sunday nearest 31 December: one year ended on 2023-01-01
    "JNJ": dict(
        annual=["2025-12-28", "2024-12-29", "2023-12-31", "2023-01-01", "2022-01-02", "2021-01-03"],
        quarterly=["2026-09-27", "2026-06-28", "2026-03-29", "2025-12-28", "2025-09-28", "2025-06-29",
                   "2025-03-30", "2024-12-29", "2024-09-29", "2024-06-30", "2024-03-31", "2023-12-31",
                   "2023-10-01", "2023-07-02", "2023-04-02", "2023-01-01"]),
    # February year end on the month end. NOT pinned below, on purpose: its leap
    # day already confuses the calendar today, whichever source answers. It is
    # here so that stays EXACTLY as it is.
    "FEB": dict(
        annual=["2026-02-28", "2025-02-28", "2024-02-29", "2023-02-28", "2022-02-28", "2021-02-28"],
        quarterly=["2026-08-31", "2026-05-31", "2026-02-28", "2025-11-30", "2025-08-31", "2025-05-31",
                   "2025-02-28", "2024-11-30", "2024-08-31", "2024-05-31", "2024-02-29", "2023-11-30"]),
}

# Today's labels, written out by hand: (company, period end as reported) ->
# (fiscal year, fiscal quarter). These are what members see now.
PINS = [
    ("KO", "2025-09-26", (2025, 3)), ("KO", "2025-12-31", (2025, 4)),
    ("AAPL", "2025-12-27", (2026, 1)), ("AAPL", "2025-09-27", (2025, 4)),
    ("AAPL", "2022-12-31", (2023, 1)), ("AAPL", "2023-04-01", (2023, 2)),
    ("WMT", "2025-10-31", (2026, 3)), ("WMT", "2026-01-31", (2026, 4)),
    ("TGT", "2025-11-01", (2026, 3)), ("TGT", "2024-02-03", (2024, 4)),
    ("NVDA", "2025-10-26", (2026, 3)), ("NVDA", "2026-04-26", (2027, 1)),
    ("AVGO", "2025-08-03", (2025, 3)), ("AVGO", "2025-11-02", (2025, 4)), ("AVGO", "2024-02-04", (2024, 1)),
    ("MU", "2025-11-27", (2026, 1)), ("MU", "2025-08-28", (2025, 4)),
    ("JNJ", "2025-12-28", (2025, 4)), ("JNJ", "2023-01-01", (2022, 4)),
]

YAHOO_ANNUAL, YAHOO_QUARTERS = 4, 5        # what the Yahoo statements carry


def month_end(reported: str) -> str:
    """The month end nearest a reported date. Written out here, independently of
    the code under test."""
    d = date.fromisoformat(reported)
    before = d.replace(day=1) - timedelta(days=1)
    after = (d.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    return min((before, after), key=lambda e: abs((e - d).days)).isoformat()


# One underlying period carries the same figures in both sources' fixtures.
def _n(reported: str) -> int:
    return int(reported.replace("-", "")) % 9973 + 1000


def rev(d): return _n(d) * 1e6
def net(d): return _n(d) * 2e5
def eps(d): return round(_n(d) / 4000.0, 4)
def assets(d): return _n(d) * 3e6
def cash_end(d): return _n(d) * 4e5
def ocf(d): return _n(d) * 3e5


# ── fakes ────────────────────────────────────────────────────────────────────
class _Cache:
    def __init__(self):
        self.d, self.ttl = {}, {}

    def get(self, k):
        return self.d.get(k)

    def set(self, k, v, ttl=None):
        self.d[k], self.ttl[k] = v, ttl


class _Store:
    def __init__(self):
        self.rows, self.puts = {}, []

    def get(self, kind, sym):
        return self.rows.get((kind, sym))

    def put(self, kind, sym, payload, ttl):
        self.puts.append((kind, sym, payload, ttl))


class _Feed:
    """Stands in for the FMP reader's ONE fetch function. Records every call."""
    LEG = {"income-statement": "income", "balance-sheet-statement": "balance",
           "cash-flow-statement": "cash"}

    def __init__(self):
        self.calls, self.data, self.fail = [], {}, set()

    def __call__(self, path, sym, period, limit):
        leg = self.LEG[path]
        self.calls.append((sym, period, leg))
        if (period, leg) in self.fail:
            raise RuntimeError("timed out")
        return ((self.data.get(sym) or {}).get(period) or {}).get(leg) or []

    def load(self, sym, annual, quarterly, currency="USD"):
        self.data[sym] = {"annual": fmp_legs(annual, currency), "quarter": fmp_legs(quarterly, currency)}


class _Yahoo:
    """Stands in for the `yfinance` module. Records every statement read."""

    def __init__(self):
        self.frames, self.info, self.reads = {}, {}, []

    def Ticker(self, sym):  # noqa: N802 -- yfinance's own name
        outer = self

        class _T:
            def __getattr__(self, attr):
                outer.reads.append((sym, attr))
                if attr == "info":
                    return outer.info.get(sym, {})
                return outer.frames.get(sym, {}).get(attr)
        return _T()

    def load(self, sym, annual, quarterly):
        a, q = annual[:YAHOO_ANNUAL], quarterly[:YAHOO_QUARTERS]
        self.frames[sym] = {
            "income_stmt": yahoo_income(a), "quarterly_income_stmt": yahoo_income(q),
            "balance_sheet": yahoo_balance(a), "quarterly_balance_sheet": yahoo_balance(q),
            "cashflow": yahoo_cash(a), "quarterly_cashflow": yahoo_cash(q),
        }


def _frame(rows: dict, reported: list):
    return pd.DataFrame(rows, index=[pd.Timestamp(month_end(d)) for d in reported]).T


def yahoo_income(dates):
    return _frame({"Total Revenue": [rev(d) for d in dates], "Net Income": [net(d) for d in dates],
                   "Diluted EPS": [eps(d) for d in dates]}, dates)


def yahoo_balance(dates):
    return _frame({"Total Assets": [assets(d) for d in dates]}, dates)


def yahoo_cash(dates):
    return _frame({"Operating Cash Flow": [ocf(d) for d in dates],
                   "End Cash Position": [cash_end(d) for d in dates]}, dates)


def fmp_legs(dates, currency="USD"):
    income = [{"date": d, "period": "Q1", "fiscalYear": d[:4], "reportedCurrency": currency,
               "revenue": rev(d), "netIncome": net(d), "epsDiluted": eps(d), "eps": eps(d) + 0.01,
               "weightedAverageShsOutDil": 15e9 + _n(d), "interestExpense": 0,
               "bottomLineNetIncome": net(d)} for d in dates]
    balance = [{"date": d, "totalAssets": assets(d), "retainedEarnings": -_n(d) * 1e5} for d in dates]
    cash = [{"date": d, "operatingCashFlow": ocf(d), "cashAtEndOfPeriod": cash_end(d),
             "cashAtBeginningOfPeriod": cash_end(d) - 7.0, "netIncome": net(d)} for d in dates]
    return {"income": income, "balance": balance, "cash": cash}


@pytest.fixture
def env(monkeypatch):
    e = types.SimpleNamespace(feed=_Feed(), yahoo=_Yahoo(), cache=_Cache(), store=_Store(),
                              history_cache=_Cache())
    monkeypatch.setattr(fh, "_fmp", e.feed)
    monkeypatch.setattr(fh, "_cache", lambda: e.history_cache)
    monkeypatch.setattr(fs, "cache", e.cache)
    monkeypatch.setattr(fs, "snap_store", e.store)
    monkeypatch.setattr(fs, "yf", e.yahoo)
    # The guard itself is covered by test_yf_guard_binds; here it just runs the read.
    monkeypatch.setattr(fs.yf_util, "bounded_call", lambda fn, default, *a, **kw: fn())
    return e


def both_sources(env, name, case=None):
    """The same company built through each source: (Yahoo payload, FMP payload)."""
    case = case or CASES[name]
    env.yahoo.load(name, case["annual"], case["quarterly"])
    env.feed.load(name, case["annual"], case["quarterly"])
    old = fs._build(name)
    new, state = fs._build_licensed(name)
    assert state == "ok" and new is not None
    return old, new


def placed(cal, when):
    return {k: cal.resolve(when)[k] for k in ("fiscal_year", "fiscal_quarter", "confidence", "year_end")}


# ── 1. the fiscal calendar reads the same thing from either source ───────────
class TestFiscalLabelsDoNotDependOnTheSource:
    @pytest.mark.parametrize("name", sorted(CASES))
    def test_every_label_is_identical_from_both_sources(self, env, name):
        old, new = both_sources(env, name)
        assert old["meta"]["source"] == "Yahoo Finance" and new["meta"]["source"] == "FMP"

        # the periods both sources carry are the same strings, in the same order
        for grain, depth in (("annual", YAHOO_ANNUAL), ("quarterly", YAHOO_QUARTERS)):
            was = [p["period"] for p in old["income"][grain]]
            now = [p["period"] for p in new["income"][grain]]
            assert len(was) == depth and now[:depth] == was, grain
        assert new["meta"]["fiscal_year_end"] == old["meta"]["fiscal_year_end"]

        # BEFORE: the calendar exactly as it was built from the Yahoo payload.
        # AFTER: the calendar the earnings model builds from the FMP payload.
        before = FiscalCalendar.from_statements(old)
        after = ei._calendar_for(new)
        assert after.describe() == before.describe()

        for reported in CASES[name]["quarterly"]:
            when = month_end(reported)
            assert placed(after, when) == placed(before, when), reported
            # a report published a month after the quarter closed lands on the same quarter
            published = (date.fromisoformat(reported) + timedelta(days=30)).isoformat()
            assert after.period_end_for_report(published) == before.period_end_for_report(published), reported

        # the reported actuals the earnings model lifts off the statements
        was = ei._actuals_from_statements(old, before)
        now = ei._actuals_from_statements(new, after)
        assert len(was) == YAHOO_QUARTERS or name == "FEB"
        for key, row in was.items():
            got = now[key]
            for field in ("period_end", "fiscal_year", "fiscal_quarter", "fiscal_confidence",
                          "eps_actual", "revenue_actual", "net_margin_pct", "eps_basis"):
                assert got[field] == row[field], (key, field)
            assert (row["source"], got["source"]) == ("yfinance-statement", "fmp-statement")

    @pytest.mark.parametrize("name,reported,label", PINS, ids=[f"{n}-{d}" for n, d, _ in PINS])
    def test_todays_labels_are_pinned(self, env, name, reported, label):
        old, new = both_sources(env, name)
        when = month_end(reported)
        for cal in (FiscalCalendar.from_statements(old), ei._calendar_for(new)):
            got = cal.resolve(when)
            assert (got["fiscal_year"], got["fiscal_quarter"]) == label

    def test_the_payload_carries_month_ends_and_keeps_the_reported_date_beside_them(self, env):
        _, new = both_sources(env, "AVGO")
        newest_year = new["income"]["annual"][0]
        # the Sunday nearest 31 October 2025 was 2 November
        assert (newest_year["period"], newest_year["reported_period"]) == ("2025-10-31", "2025-11-02")
        assert new["meta"]["fiscal_year_end"] == "10-31"
        for block in ("income", "balance", "cashflow"):
            for grain in ("annual", "quarterly"):
                for row in new[block][grain]:
                    assert row["period"] == month_end(row["reported_period"])

    def test_reported_dates_fed_to_the_calendar_would_renumber_a_53_week_year(self, env):
        """WHY the payload carries month ends. Apple's year ended 2023-09-30 had
        53 weeks, so its quarters closed on 2022-12-31, 2023-04-01 and
        2023-07-01. Read as written, 1 April is "the month after March"."""
        _, new = both_sources(env, "AAPL")
        as_reported = {"income": {g: [{"period": p["reported_period"]} for p in new["income"][g]]
                                  for g in ("annual", "quarterly")}}
        raw = FiscalCalendar.from_statements(as_reported)
        kept = ei._calendar_for(new)
        assert (kept.resolve("2023-03-31")["fiscal_year"], kept.resolve("2023-03-31")["fiscal_quarter"]) == (2023, 2)
        assert raw.resolve("2023-04-01")["fiscal_quarter"] != 2

    def test_a_year_end_moved_long_ago_does_not_renumber_todays_quarters(self, env):
        """A company that moved its year end from December to June in 2019. The
        calendar reads every year end it is given to decide whether a company
        keeps a 52/53-week year, and FMP reaches back past the move."""
        annual = [f"{y}-06-30" for y in range(2026, 2018, -1)] + ["2018-12-31", "2017-12-31", "2016-12-31"]
        quarterly = ["2026-09-30", "2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30", "2025-06-30",
                     "2025-03-31", "2024-12-31", "2024-09-30"]
        old, new = both_sources(env, "MOVED", dict(annual=annual, quarterly=quarterly))
        assert len(new["income"]["annual"]) == 11            # the whole history still reaches the panel
        before, after = FiscalCalendar.from_statements(old), ei._calendar_for(new)
        assert after.describe() == before.describe()
        for when in quarterly:
            assert placed(after, when) == placed(before, when)
        assert (after.resolve("2025-09-30")["fiscal_year"], after.resolve("2025-09-30")["fiscal_quarter"]) == (2026, 1)

    def test_a_yahoo_payload_reaches_the_calendar_untouched(self):
        payload = {"meta": {"source": "Yahoo Finance"},
                   "income": {"annual": [{"period": f"{y}-12-31"} for y in range(2025, 2018, -1)],
                              "quarterly": [{"period": "2025-09-30"}]}}
        assert ei._anchor_view(payload) is payload
        assert ei._anchor_view({}) == {} and ei._anchor_view(None) is None


# ── 2. the payload: same shape, honest label, honest gaps ────────────────────
class TestPayload:
    def test_same_shape_as_before_and_names_its_source(self, env):
        old, new = both_sources(env, "AAPL")
        assert set(new) == set(old) == {"ticker", "income", "balance", "cashflow", "meta"}
        for block in ("income", "balance", "cashflow"):
            assert set(new[block]) == set(old[block]) == {"annual", "quarterly", "ttm", "ttm_series"}
        assert set(old["meta"]) <= set(new["meta"])
        assert new["meta"]["source"] == "FMP"
        assert new["meta"]["units"] == old["meta"]["units"]
        assert (new["meta"]["annual_periods"], new["meta"]["quarterly_periods"]) == (12, 24)
        # newest first, as every reader of this payload indexes it
        periods = [p["period"] for p in new["income"]["quarterly"]]
        assert periods == sorted(periods, reverse=True) and periods[0] == "2026-06-30"
        # the same period carries the same figures whichever source built it
        for i, was in enumerate(old["income"]["quarterly"]):
            now = new["income"]["quarterly"][i]
            assert {k: now["values"][k] for k in was["values"]} == was["values"]

    def test_not_known_is_none_and_never_zero(self, env):
        _, new = both_sources(env, "AAPL")
        newest = new["income"]["quarterly"][0]["values"]
        assert newest["rnd"] is None and newest["gross_profit"] is None      # FMP sent no such field
        assert newest["interest_expense"] == 0.0                             # a zero FMP DID send
        assert new["income"]["ttm"]["rnd"] is None
        # lines FMP has no field for are left out, here and in the list of keys
        for gone in ("tax_rate", "working_capital", "book_value", "debt_repaid"):
            assert gone not in new["meta"]["reported_keys"]
        assert "tax_rate" not in newest and "debt_repaid" not in new["cashflow"]["quarterly"][0]["values"]

    def test_the_lines_beyond_the_panels_series_come_through(self, env):
        _, new = both_sources(env, "AAPL")
        d = CASES["AAPL"]["quarterly"][0]
        assert new["income"]["quarterly"][0]["values"]["net_income_common"] == net(d)
        assert new["income"]["quarterly"][0]["values"]["eps_basic"] == eps(d) + 0.01
        assert new["balance"]["quarterly"][0]["values"]["retained_earnings"] == -_n(d) * 1e5
        assert new["cashflow"]["quarterly"][0]["values"]["end_cash"] == cash_end(d)
        assert new["cashflow"]["quarterly"][0]["values"]["net_income"] == net(d)

    def test_trailing_twelve_months(self, env):
        _, new = both_sources(env, "AAPL")
        q = CASES["AAPL"]["quarterly"]
        inc, cf = new["income"], new["cashflow"]
        assert inc["ttm"]["revenue"] == sum(rev(d) for d in q[:4])
        assert inc["ttm"]["shares_diluted"] == 15e9 + _n(q[0])              # a count, never summed
        assert cf["ttm"]["operating_cf"] == sum(ocf(d) for d in q[:4])
        assert cf["ttm"]["end_cash"] == cash_end(q[0])
        assert cf["ttm"]["begin_cash"] == cash_end(q[3]) - 7.0              # the START of the window
        assert new["balance"]["ttm"] == new["balance"]["quarterly"][0]["values"]
        assert new["balance"]["ttm_series"] == []
        # 24 quarters give 21 rolling windows: a true year-on-year on the TTM
        assert len(inc["ttm_series"]) == 21
        assert inc["ttm_series"][4]["values"]["revenue"] == sum(rev(d) for d in q[4:8])

    def test_a_missing_quarter_is_never_summed_into_twelve_months(self, env):
        case = CASES["AAPL"]
        quarterly = [d for i, d in enumerate(case["quarterly"]) if i != 2]   # one quarter absent
        env.feed.load("AAPL", case["annual"], quarterly)
        new, _ = fs._build_licensed("AAPL")
        assert len(new["income"]["quarterly"]) == 23
        assert new["income"]["ttm"] is None and new["cashflow"]["ttm"] is None
        assert new["income"]["ttm_series"] == []

    def test_empty_edges_are_dropped_and_an_inner_gap_keeps_its_place(self, env):
        case = CASES["KO"]
        env.feed.load("KO", case["annual"], case["quarterly"])
        legs = env.feed.data["KO"]["quarter"]
        q = case["quarterly"]
        absent = {q[0], q[5], q[10], q[11]}          # newest, one inside, the two oldest
        legs["balance"] = [r for r in legs["balance"] if r["date"] not in absent]
        new, state = fs._build_licensed("KO")
        assert state == "ok"
        rows = new["balance"]["quarterly"]
        assert [r["reported_period"] for r in rows] == q[1:10]
        assert all(v is None for v in rows[4]["values"].values())            # q[5], held open
        assert new["balance"]["ttm"]["total_assets"] == assets(q[1])
        # four rows back is still the same quarter a year earlier
        assert (rows[0]["period"], rows[4]["period"]) == ("2026-06-30", "2025-06-30")
        assert len(new["income"]["quarterly"]) == 12

    @pytest.mark.parametrize("reported,period", [
        ("2025-09-27", "2025-09-30"), ("2024-11-03", "2024-10-31"), ("2023-01-01", "2022-12-31"),
        ("2024-02-26", "2024-02-29"), ("2025-01-25", "2025-01-31"), ("2025-12-31", "2025-12-31"),
        ("2025-06-15", "2025-06-15"),     # nowhere near a month end: left as reported
        ("2025-06-24", "2025-06-30"), ("2025-06-23", "2025-06-23"), ("2025-07-06", "2025-06-30"),
        ("2025-07-07", "2025-07-07"), ("not a date", "not a date"),
    ])
    def test_month_end_of_a_reported_date(self, reported, period):
        assert fs._month_end_period(reported) == period

    def test_a_foreign_filer_keeps_its_currency_and_its_scale(self, env):
        annual, quarterly = ["2025-12-31", "2024-12-31"], ["2026-09-30", "2026-06-30", "2026-03-31", "2025-12-31"]
        env.feed.load("TSM", annual, quarterly, currency="TWD")
        env.feed.data["TSM"]["quarter"]["income"][0]["revenue"] = 989_918_300_000.0
        new, _ = fs._build_licensed("TSM")
        assert new["meta"]["currency"] == "TWD"
        assert new["income"]["quarterly"][0]["values"]["revenue"] == 989_918_300_000.0     # as reported
        assert new["meta"]["units"].startswith("reporting currency, absolute")
        # FMP not naming a currency is "not known": never assumed to be dollars
        env.feed.load("XYZ", annual, quarterly, currency=None)
        assert fs._build_licensed("XYZ")[0]["meta"]["currency"] is None


# ── 3. which source, what it costs, and what is remembered ───────────────────
def load_aapl(env, yahoo=False):
    case = CASES["AAPL"]
    env.feed.load("AAPL", case["annual"], case["quarterly"])
    if yahoo:
        env.yahoo.load("AAPL", case["annual"], case["quarterly"])


class TestSourceOrderAndCost:
    def test_a_cold_read_is_six_fmp_reads_and_no_yahoo_read(self, env):
        load_aapl(env, yahoo=True)
        out = fs.get_statements("aapl")
        assert out["meta"]["source"] == "FMP" and out["meta"]["build_calls"] == 6
        assert sorted(env.feed.calls) == sorted(("AAPL", p, leg) for p in ("annual", "quarter")
                                                for leg in ("income", "balance", "cash"))
        assert env.yahoo.reads == []
        assert env.cache.ttl["fin_stmts_v2::AAPL"] == fs._TTL
        assert [(k, s) for k, s, _, _ in env.store.puts] == [("fin_stmts_v2", "AAPL")]
        assert env.store.puts[0][3] == fs._store_ttl(out)      # TestStoredCopyFreshness pins the rule
        # warm: memory answers
        assert fs.get_statements("AAPL") is out and len(env.feed.calls) == 6

    def test_a_stored_copy_costs_nothing_and_keeps_its_own_label(self, env):
        load_aapl(env)
        stored = {"ticker": "AAPL", "income": {"annual": [], "quarterly": []},
                  "meta": {"source": "Yahoo Finance", "retrieved_at": 1.0}}
        env.store.rows[("fin_stmts_v2", "AAPL")] = (stored, 3600.0, fs._TTL)
        out = fs.get_statements("AAPL")
        assert out is stored and out["meta"]["source"] == "Yahoo Finance"
        assert env.feed.calls == [] and env.yahoo.reads == [] and env.store.puts == []

    def test_the_financials_panels_and_the_statements_share_one_read(self, env):
        load_aapl(env)
        fs.get_statements("AAPL")
        panel = fh.get_history("AAPL", period="quarter")
        assert len(env.feed.calls) == 6                      # nothing fetched again
        # and the panels' payload is exactly what it was: no extra lines in it
        assert set(panel) == {"sym", "period", "periods", "dates", "series", "ratios", "count",
                              "currency", "source"}
        full = fh.get_history("AAPL", period="quarter", full=True)
        assert set(full) - set(panel) == {"extra_series"}
        assert {len(col) for col in full["extra_series"].values()} == {len(full["dates"])}
        assert set(full["extra_series"]) == {k for k, _leg, _names in fh.EXTRA_LINE_ITEMS}

    def test_the_other_way_round_is_one_read_too(self, env):
        load_aapl(env)
        fh.get_history("AAPL", period="quarter")
        fh.get_history("AAPL", period="annual")
        fs.get_statements("AAPL")
        assert len(env.feed.calls) == 6

    def test_fmp_holding_nothing_falls_back_to_yahoo_and_says_so(self, env):
        case = CASES["KO"]
        env.yahoo.load("KO", case["annual"], case["quarterly"])       # FMP has no rows for KO
        out = fs.get_statements("KO")
        assert out["meta"]["source"] == "Yahoo Finance"
        assert out["meta"]["sources_tried"] == ["FMP", "Yahoo Finance"]
        assert out["meta"]["build_calls"] == 12
        assert len(env.feed.calls) == 6 and len(env.yahoo.reads) == 6
        assert len(out["income"]["quarterly"]) == YAHOO_QUARTERS
        assert env.cache.ttl["fin_stmts_v2::KO"] == fs._TTL and len(env.store.puts) == 1

    def test_nothing_anywhere_is_the_empty_state_it_always_was(self, env):
        env.yahoo.info["SPY"] = {"quoteType": "ETF"}
        out = fs.get_statements("SPY")
        assert out["error"] == "no statements available" and out["security_type"] == "etf"
        assert "state" not in out
        assert out["meta"]["sources_tried"] == ["FMP", "Yahoo Finance"] and out["meta"]["build_calls"] == 13
        assert env.cache.ttl["fin_stmts_v2::SPY"] == fs._NEG_TTL and env.store.puts == []

    def test_a_failed_fmp_read_is_unavailable_and_never_the_other_source(self, env):
        load_aapl(env, yahoo=True)
        env.feed.fail = {("quarter", "income"), ("annual", "income")}
        out = fs.get_statements("AAPL")
        assert out["state"] == "unavailable" and out["error"] == "statements temporarily unavailable"
        assert out["meta"]["source"] == "FMP" and "security_type" not in out
        assert env.yahoo.reads == []
        assert env.cache.ttl["fin_stmts_v2::AAPL"] == fs._RETRY_TTL and env.store.puts == []
        # the failure was not remembered by the reader either: the vendor recovers, so do we
        env.feed.fail = set()
        env.cache.d.clear()
        assert fs.get_statements("AAPL")["meta"]["source"] == "FMP"

    def test_one_failed_half_is_served_but_not_remembered(self, env):
        load_aapl(env, yahoo=True)
        env.feed.fail = {("quarter", "income")}
        out = fs.get_statements("AAPL")
        assert len(out["income"]["annual"]) == 12 and out["income"]["quarterly"] == []
        assert out["income"]["ttm"] is None and out["meta"]["partial"] == ["quarterly"]
        assert env.yahoo.reads == []
        assert env.cache.ttl["fin_stmts_v2::AAPL"] == fs._RETRY_TTL and env.store.puts == []

    def test_a_failed_leg_is_served_briefly_and_not_stored(self, env):
        load_aapl(env)
        env.feed.fail = {("quarter", "balance")}
        out = fs.get_statements("AAPL")
        assert out["balance"]["quarterly"] == [] and out["balance"]["ttm"] is None
        assert len(out["balance"]["annual"]) == 12 and len(out["income"]["quarterly"]) == 24
        assert out["meta"]["partial"] == ["balance"]
        assert env.cache.ttl["fin_stmts_v2::AAPL"] == fs._NEG_TTL and env.store.puts == []

    def test_never_raises_into_the_request(self, env, monkeypatch):
        def boom(*a, **kw):
            raise RuntimeError("boom")
        monkeypatch.setattr(fh, "get_history", boom)
        out = fs.get_statements("AAPL")
        assert out["state"] == "unavailable" and env.yahoo.reads == []
        env.cache.d.clear()
        monkeypatch.setattr(fs, "_build_first", boom)
        assert fs.get_statements("AAPL")["state"] == "unavailable"
        assert fs.get_statements("")["error"] == "ticker required"

    def test_a_refresh_that_fails_keeps_the_last_good_copy(self, env, monkeypatch):
        class _Now:                       # the refresh runs before get_statements returns
            def __init__(self, target, name=None, daemon=None):
                self.target = target

            def start(self):
                self.target()
        monkeypatch.setattr(fs, "threading", types.SimpleNamespace(Thread=_Now))
        load_aapl(env, yahoo=True)
        last_good = {"ticker": "AAPL", "income": {"annual": [], "quarterly": []},
                     "meta": {"source": "Yahoo Finance", "retrieved_at": 1.0}}
        env.store.rows[("fin_stmts_v2", "AAPL")] = (last_good, fs._TTL + 60.0, fs._TTL)

        env.feed.fail = {("quarter", "income"), ("annual", "income")}
        out = fs.get_statements("AAPL")
        assert out is last_good and out["meta"]["stale"] is True
        assert env.store.puts == [] and env.yahoo.reads == []

        env.feed.fail = {("quarter", "cash")}           # a gap is not a complete answer either
        env.cache.d.clear()
        fs.get_statements("AAPL")
        assert env.store.puts == []

        env.feed.fail = set()
        env.cache.d.clear()
        env.history_cache.d.clear()
        fs.get_statements("AAPL")
        assert [p[2]["meta"]["source"] for p in env.store.puts] == ["FMP"]
        assert env.cache.d["fin_stmts_v2::AAPL"]["meta"]["source"] == "FMP"


# ── 4. every caller names the source that answered ───────────────────────────
class TestCallersNameTheSource:
    def test_the_earnings_model(self):
        assert ei._statement_source({"meta": {"source": "FMP"}}) == "fmp-statement"
        assert ei._statement_source({"meta": {"source": "Yahoo Finance"}}) == "yfinance-statement"
        assert ei._statement_source({}) == ei._statement_source(None) == "yfinance-statement"

    @pytest.fixture
    def agent(self, monkeypatch):
        from api.services.uct_agent.marketdata import statements as stm

        def read(payload):
            monkeypatch.setattr(fs, "get_statements", lambda s: payload)
            return stm.read_fundamentals({"symbol": "AAPL"}, {})
        return types.SimpleNamespace(read=read, stm=stm)

    def _payload(self, source, **meta):
        row = {"period": "2026-06-30", "reported_period": "2026-06-27", "values": {"revenue": 1.0}}
        return {"ticker": "AAPL", "meta": {"source": source, "retrieved_at": 1.0, **meta},
                **{st: {"annual": [row], "quarterly": [row]} for st in ("income", "balance", "cashflow")}}

    def test_the_agent_kind_names_fmp_or_yahoo(self, agent):
        assert agent.read(self._payload("FMP"))["source"] == "fmp"
        assert agent.read(self._payload("Yahoo Finance"))["source"] == "yahoo-finance"
        # the row shape the Agent receives has not changed
        row = agent.read(self._payload("FMP"))["data"]["statements"]["income"][0]
        assert row == {"period_end": "2026-06-30", "values": {"revenue": 1.0}}

    def test_the_agent_kind_counts_what_the_build_cost(self, agent):
        import time
        now = time.time()
        assert agent.read(self._payload("FMP", retrieved_at=now, build_calls=6))["provider_calls"] == 6
        assert agent.read(self._payload("Yahoo Finance", retrieved_at=now, build_calls=12))["provider_calls"] == 12
        assert agent.read(self._payload("Yahoo Finance", retrieved_at=now))["provider_calls"] == 6
        assert agent.read(self._payload("FMP", retrieved_at=now - 3600, build_calls=6))["provider_calls"] == 0

    def test_the_agent_kind_tells_a_failed_read_from_no_statements(self, agent):
        failed = agent.read(fs._unavailable("AAPL"))
        assert failed["status"] == "unavailable" and failed["source"] == "fmp"
        assert any(agent.stm.NOTE_UNAVAILABLE in n for n in failed["notes"])
        assert not any("no financial statements" in n for n in failed["notes"])
        fund = agent.read({"error": "no statements available", "ticker": "SPY", "security_type": "etf",
                           "meta": {"source": "Yahoo Finance", "retrieved_at": 1.0}})
        assert fund["source"] == "yahoo-finance"
        assert any("does not publish company statements" in n for n in fund["notes"])


# ── how long a stored copy is fresh: FMP bandwidth is metered ────────────────

def _fmp_payload(newest_quarter_reported, period=None):
    rows = [] if newest_quarter_reported is None else [
        {"period": period or fs._month_end_period(newest_quarter_reported),
         "reported_period": newest_quarter_reported, "values": {"revenue": 1.0}}]
    return {"ticker": "X", "income": {"annual": [], "quarterly": rows}, "meta": {"source": "FMP"}}


class TestStoredCopyFreshness:
    TODAY = date(2026, 11, 19)

    @pytest.fixture(autouse=True)
    def _clock(self, monkeypatch):
        monkeypatch.setattr(fs, "_today", lambda: self.TODAY)

    def _ended(self, days_ago):
        return (self.TODAY - timedelta(days=days_ago)).isoformat()

    @pytest.mark.parametrize("days_ago, expected", [
        (0, 14 * 86400),         # the quarter ended today: nothing newer can exist for 100 days
        (30, 14 * 86400),        # deep in the quiet window: the restatement guard is the limit
        (86, 14 * 86400),        # exactly 14 days before the window opens
        (87, 13 * 86400),        # fresh only until the window opens
        (95, 5 * 86400),
        (98, 2 * 86400),
        (99, 86400),             # one day left: the daily floor
        (100, 86400),            # the window is open: a new quarter can land any day
        (145, 86400),
        (400, 86400),            # FMP is far behind: keep checking daily
    ])
    def test_an_fmp_copy_is_fresh_until_a_newer_quarter_can_exist(self, days_ago, expected):
        assert fs._store_ttl(_fmp_payload(self._ended(days_ago))) == expected

    def test_the_date_as_reported_decides_not_the_month_end(self):
        """Reported 2026-08-11 is exactly 100 days back (due); its month end, 2026-08-11 kept as
        `period` here on purpose, must not be what is read when the two differ."""
        reported = self._ended(100)
        later_label = self._ended(60)
        assert fs._store_ttl(_fmp_payload(reported, period=later_label)) == fs._DUE_TTL

    def test_a_copy_with_no_reported_date_reads_its_period(self):
        p = _fmp_payload(self._ended(30))
        del p["income"]["quarterly"][0]["reported_period"]
        p["income"]["quarterly"][0]["period"] = self._ended(30)
        assert fs._store_ttl(p) == fs._QUIET_TTL

    @pytest.mark.parametrize("payload", [
        _fmp_payload(None),                                              # annual-only filer
        {"meta": {"source": "FMP"}},                                     # no income block
        {"income": {"quarterly": ["2026-09-30"]}, "meta": {"source": "FMP"}},
        {"income": {"quarterly": [{"reported_period": "soon"}]}, "meta": {"source": "FMP"}},
        {"income": {"quarterly": [{"reported_period": "2027-03-31"}]}, "meta": {"source": "FMP"}},  # future
    ])
    def test_an_fmp_copy_whose_newest_quarter_cannot_be_read_is_checked_daily(self, payload):
        assert fs._store_ttl(payload) == fs._DUE_TTL

    @pytest.mark.parametrize("payload", [
        {"income": {"quarterly": [{"period": "2026-10-31"}]}, "meta": {"source": "Yahoo Finance"}},
        {"income": {"quarterly": [{"period": "2026-10-31"}]}, "meta": {}},
        {"income": {"quarterly": [{"period": "2026-10-31"}]}},
        None,
    ])
    def test_any_other_copy_keeps_its_twelve_hours(self, payload):
        assert fs._store_ttl(payload) == fs._TTL

    def test_a_build_is_stored_for_that_long_and_held_in_memory_for_twelve_hours(self, env):
        case = CASES["WMT"]                       # newest quarter 2026-10-31: 19 days old
        env.feed.load("WMT", case["annual"], case["quarterly"])
        fs.get_statements("WMT")
        assert [(k, s, t) for k, s, _, t in env.store.puts] == [("fin_stmts_v2", "WMT", fs._QUIET_TTL)]
        assert env.cache.ttl["fin_stmts_v2::WMT"] == fs._TTL

    def test_a_company_due_to_report_is_stored_for_a_day(self, env):
        load_aapl(env)                            # newest quarter 2026-06-27: 145 days old
        fs.get_statements("AAPL")
        assert [t for _, _, _, t in env.store.puts] == [fs._DUE_TTL]

    def test_a_long_lived_stored_copy_is_served_without_a_read_and_memory_is_capped(self, env):
        load_aapl(env)
        stored = fs._build_licensed("AAPL")[0]
        env.feed.calls.clear()
        five_days = 5 * 86400.0
        env.store.rows[("fin_stmts_v2", "AAPL")] = (stored, five_days, fs._QUIET_TTL)
        out = fs.get_statements("AAPL")
        assert out["meta"]["source"] == "FMP" and "stale" not in out["meta"]
        assert env.feed.calls == [] and env.store.puts == []
        assert env.cache.ttl["fin_stmts_v2::AAPL"] == fs._TTL      # not the nine days left on disk

    def test_a_background_refresh_stores_for_that_long_too(self, env):
        case = CASES["WMT"]
        env.feed.load("WMT", case["annual"], case["quarterly"])
        fs._schedule_refresh("WMT")
        import threading
        for t in threading.enumerate():
            if t.name == "stmts-refresh-WMT":
                t.join(10)
        assert "WMT" not in fs._refreshing
        assert [(s, t) for _, s, _, t in env.store.puts] == [("WMT", fs._QUIET_TTL)]


class TestWarmerMarkReachesTheReaderThreads:
    """The statements reader shares one FMP read between concurrent callers, and a
    member never waits on a read a WARMER leads. That mark is per thread, and the
    two statement bases are read on threads of their own."""

    def _spy(self, monkeypatch):
        from api.services import single_flight
        from api.services.research import financial_history
        seen = []

        def get_history(sym, period="quarter", full=False):
            seen.append((period, full, single_flight.in_background()))
            return {"sym": sym, "period": period, "periods": [], "series": {}}
        monkeypatch.setattr(financial_history, "get_history", get_history)
        return seen

    def test_a_warmers_statement_reads_are_marked_as_background(self, monkeypatch):
        from api.services import single_flight
        seen = self._spy(monkeypatch)
        with single_flight.background():
            fs._read_licensed("AAPL")
        assert sorted(seen) == [("annual", True, True), ("quarter", True, True)]

    def test_a_members_statement_reads_are_not(self, monkeypatch):
        seen = self._spy(monkeypatch)
        fs._read_licensed("AAPL")
        assert sorted(seen) == [("annual", True, False), ("quarter", True, False)]
