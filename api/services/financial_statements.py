"""Historical financial statements (income / balance sheet / cash flow) for the
Company Intelligence panel, the earnings model's fiscal calendar and the Agent's
`fundamentals` kind.

ONE payload shape, two possible sources, and `meta.source` names the one used:

* **FMP first.** The statements come from `research/financial_history.get_history`
  (the reader the Financials panels already use: three statement legs, one process
  cache, up to 24 quarters and 12 fiscal years). Nothing is fetched or cached a
  second time here: this module only reshapes that answer.
* **Yahoo Finance (yfinance) only when FMP answered and holds no statements for the
  ticker.** A read that FAILED is not "holds nothing": it returns an honest
  "temporarily unavailable" answer that is retried, never the other source.

We normalize a curated, stable set of line items to snake_case keys, compute a TTM
column for the flow statements (sum of the last 4 reported quarters), and cache the
whole bundle per ticker. Every yfinance access is bounded (yf_util.bounded_call) so
a stalled Yahoo response can never pin a worker thread.

Values are RAW numbers in the reporting currency (the frontend formats to B/M and %);
EPS rows are per-share. Missing cells are `None`, never fabricated: a line the
source in use does not carry is left out, never zero.
"""
from __future__ import annotations

import logging
import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from typing import Any

import yfinance as yf

from api.services import fundamentals_snapshot_store as snap_store
from api.services import yf_util
from api.services.cache import cache

_log = logging.getLogger(__name__)

# Reported financial history is IMMUTABLE except for restatements, so the
# expensive thing (six provider round-trips) should happen roughly once per
# company per reporting cycle — not once per pod restart, and never once per
# user. Serve order mirrors the proven fundamentals path:
#     memory → disk (fresh) → disk (stale, background refresh) → live build
# The in-memory TTLCache alone could not do this: it is an LRU of 1000 that dies
# on every redeploy, so a popular ticker still rebuilt from scratch constantly.
_KIND = "fin_stmts_v2"      # bump with the curated schema (shape is cached)
_TTL = 12 * 3600            # "fresh" window — a new filing can land any day
_STALE_MAX = 30 * 86400     # serve-stale ceiling; history itself doesn't rot
_NEG_TTL = 600              # brief negative cache for dead/failing tickers
_RETRY_TTL = 60             # a FAILED read: held just long enough to absorb a burst

# How long a STORED FMP-built answer stays fresh (`_store_ttl`). Statements change when
# a company reports, once a quarter, and FMP meters bandwidth (the account was cut off
# at its 30-day cap on 2026-11-13, statements the largest line). The armed panel prewarm
# walks the whole universe every ~16 hours, so a flat 12 hours would buy every company's
# six statement reads again on every pass. Instead the stored copy is fresh for as long
# as no newer quarter can have been reported, then checked daily until one arrives.
_QUIET_DAYS = 100           # after a quarter ends, the next one cannot be reported sooner
_QUIET_TTL = 14 * 86400     # inside that window: re-read only to pick up a restatement
_DUE_TTL = 24 * 3600        # outside it: a new quarter can land any day

SOURCE_LICENSED = "FMP"
SOURCE_FALLBACK = "Yahoo Finance"
_LICENSED_CALLS = 6         # three statement legs x (quarterly, annual)
_FALLBACK_CALLS = 6         # the six bounded yfinance statement reads

_refreshing: set[str] = set()
_refresh_lock = threading.Lock()

# Curated line items. Each entry: (key, [candidate yfinance row names, first match wins]).
# Ordered for display; the frontend supplies labels/formatting/tooltips.
_INCOME = [
    ("revenue", ["Total Revenue", "Operating Revenue"]),
    ("cost_of_revenue", ["Cost Of Revenue", "Reconciled Cost Of Revenue"]),
    ("gross_profit", ["Gross Profit"]),
    ("operating_expense", ["Operating Expense"]),
    ("rnd", ["Research And Development"]),
    ("sga", ["Selling General And Administration", "Selling General And Administrative"]),
    ("other_opex", ["Other Operating Expenses"]),
    ("total_expenses", ["Total Expenses"]),
    ("operating_income", ["Operating Income", "Total Operating Income As Reported"]),
    ("ebitda", ["EBITDA", "Normalized EBITDA"]),
    ("ebit", ["EBIT"]),
    ("interest_income", ["Interest Income", "Interest Income Non Operating"]),
    ("interest_expense", ["Interest Expense", "Interest Expense Non Operating"]),
    ("net_interest_income", ["Net Interest Income"]),
    ("other_income_expense", ["Other Income Expense", "Other Non Operating Income Expenses"]),
    ("pretax_income", ["Pretax Income"]),
    ("tax", ["Tax Provision"]),
    # yfinance ships this as a FRACTION (0.13), not a percent — normalised below.
    ("tax_rate", ["Tax Rate For Calcs"]),
    ("net_income", ["Net Income", "Net Income Common Stockholders",
                    "Net Income From Continuing Operation Net Minority Interest"]),
    ("net_income_common", ["Diluted NI Availto Com Stockholders",
                           "Net Income Common Stockholders"]),
    ("eps_basic", ["Basic EPS"]),
    ("eps_diluted", ["Diluted EPS"]),
    ("shares_basic", ["Basic Average Shares"]),
    ("shares_diluted", ["Diluted Average Shares"]),
]
_BALANCE = [
    ("cash", ["Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments"]),
    ("short_term_investments", ["Other Short Term Investments", "Available For Sale Securities"]),
    ("receivables", ["Receivables", "Accounts Receivable"]),
    ("inventory", ["Inventory"]),
    ("other_current_assets", ["Other Current Assets"]),
    ("current_assets", ["Current Assets"]),
    ("ppe", ["Net PPE", "Gross PPE"]),
    ("accumulated_depreciation", ["Accumulated Depreciation"]),
    ("goodwill", ["Goodwill"]),
    ("intangibles", ["Other Intangible Assets", "Goodwill And Other Intangible Assets"]),
    ("long_term_investments", ["Investments And Advances", "Investmentin Financial Assets"]),
    ("other_noncurrent_assets", ["Other Non Current Assets"]),
    ("noncurrent_assets", ["Total Non Current Assets"]),
    ("total_assets", ["Total Assets"]),
    ("payables", ["Payables And Accrued Expenses", "Accounts Payable", "Payables"]),
    ("current_debt", ["Current Debt", "Current Debt And Capital Lease Obligation"]),
    ("other_current_liabilities", ["Other Current Liabilities"]),
    ("current_liabilities", ["Current Liabilities"]),
    ("long_term_debt", ["Long Term Debt", "Long Term Debt And Capital Lease Obligation"]),
    ("capital_leases", ["Capital Lease Obligations", "Long Term Capital Lease Obligation"]),
    ("other_noncurrent_liabilities", ["Other Non Current Liabilities"]),
    ("noncurrent_liabilities", ["Total Non Current Liabilities Net Minority Interest"]),
    ("total_debt", ["Total Debt"]),
    ("net_debt", ["Net Debt"]),
    ("total_liabilities", ["Total Liabilities Net Minority Interest"]),
    ("working_capital", ["Working Capital"]),
    ("common_stock", ["Common Stock", "Capital Stock"]),
    ("paid_in_capital", ["Additional Paid In Capital"]),
    ("retained_earnings", ["Retained Earnings"]),
    ("treasury_stock", ["Treasury Stock"]),
    ("equity", ["Stockholders Equity", "Common Stock Equity", "Total Equity Gross Minority Interest"]),
    ("shares_outstanding", ["Ordinary Shares Number", "Share Issued"]),
    ("book_value", ["Tangible Book Value"]),
]
_CASHFLOW = [
    ("net_income", ["Net Income From Continuing Operations", "Net Income"]),
    ("d_and_a", ["Depreciation And Amortization", "Depreciation Amortization Depletion"]),
    ("sbc", ["Stock Based Compensation"]),
    ("change_receivables", ["Change In Receivables"]),
    ("change_inventory", ["Change In Inventory"]),
    ("change_payables", ["Change In Payables And Accrued Expense"]),
    ("change_wc", ["Change In Working Capital"]),
    ("other_noncash", ["Other Non Cash Items"]),
    ("operating_cf", ["Operating Cash Flow", "Cash Flow From Continuing Operating Activities"]),
    ("capex", ["Capital Expenditure", "Purchase Of PPE"]),
    ("acquisitions", ["Net Business Purchase And Sale", "Purchase Of Business"]),
    ("investments_purchased", ["Purchase Of Investment"]),
    ("investments_sold", ["Sale Of Investment"]),
    ("net_investments", ["Net Investment Purchase And Sale"]),
    ("investing_cf", ["Investing Cash Flow", "Cash Flow From Continuing Investing Activities"]),
    ("debt_issued", ["Issuance Of Debt", "Long Term Debt Issuance"]),
    ("debt_repaid", ["Repayment Of Debt", "Long Term Debt Payments"]),
    ("net_debt_issuance", ["Net Issuance Payments Of Debt", "Net Long Term Debt Issuance"]),
    ("stock_issued", ["Issuance Of Capital Stock", "Net Common Stock Issuance"]),
    ("buybacks", ["Repurchase Of Capital Stock", "Common Stock Payments"]),
    ("dividends_paid", ["Cash Dividends Paid", "Common Stock Dividend Paid"]),
    ("financing_cf", ["Financing Cash Flow", "Cash Flow From Continuing Financing Activities"]),
    ("free_cash_flow", ["Free Cash Flow"]),
    ("fx_effect", ["Effect Of Exchange Rate Changes"]),
    ("change_in_cash", ["Changes In Cash"]),
    ("begin_cash", ["Beginning Cash Position"]),
    ("end_cash", ["End Cash Position"]),
]

_FLOW_STATEMENTS = {"income", "cashflow"}   # TTM = sum of last 4 quarters

# The same payload keys, read from the FMP reader's series: (payload key, series
# key in `financial_history.LINE_ITEMS` / `EXTRA_LINE_ITEMS`). A payload key with no
# FMP line is simply absent here (the panel hides a line with no value in any
# period): `tax_rate`, `accumulated_depreciation`, `working_capital`,
# `shares_outstanding`, `book_value`, `net_investments`, `debt_issued`,
# `debt_repaid`. None of them is derived: every value stays as reported.
_LICENSED_INCOME = [
    ("revenue", "revenue"),
    ("cost_of_revenue", "cost_of_revenue"),
    ("gross_profit", "gross_profit"),
    ("operating_expense", "operating_expenses"),
    ("rnd", "research_and_development"),
    ("sga", "sga"),
    ("other_opex", "other_expenses"),
    ("total_expenses", "cost_and_expenses"),
    ("operating_income", "operating_income"),
    ("ebitda", "ebitda"),
    ("ebit", "ebit"),
    ("interest_income", "interest_income"),
    ("interest_expense", "interest_expense"),
    ("net_interest_income", "net_interest_income"),
    ("other_income_expense", "non_operating_income"),
    ("pretax_income", "pretax_income"),
    ("tax", "income_tax"),
    ("net_income", "net_income"),
    ("net_income_common", "net_income_to_common"),
    ("eps_basic", "eps_basic"),
    ("eps_diluted", "eps_diluted"),
    ("shares_basic", "shares_basic"),
    ("shares_diluted", "shares_diluted"),
]
_LICENSED_BALANCE = [
    ("cash", "cash_and_equivalents"),
    ("short_term_investments", "short_term_investments"),
    ("receivables", "receivables"),
    ("inventory", "inventory"),
    ("other_current_assets", "other_current_assets"),
    ("current_assets", "total_current_assets"),
    ("ppe", "ppe_net"),
    ("goodwill", "goodwill"),
    ("intangibles", "intangible_assets"),
    ("long_term_investments", "long_term_investments"),
    ("other_noncurrent_assets", "other_noncurrent_assets"),
    ("noncurrent_assets", "total_noncurrent_assets"),
    ("total_assets", "total_assets"),
    ("payables", "accounts_payable"),
    ("current_debt", "short_term_debt"),
    ("other_current_liabilities", "other_current_liabilities"),
    ("current_liabilities", "total_current_liabilities"),
    ("long_term_debt", "long_term_debt"),
    ("capital_leases", "capital_lease_obligations"),
    ("other_noncurrent_liabilities", "other_noncurrent_liabilities"),
    ("noncurrent_liabilities", "total_noncurrent_liabilities"),
    ("total_debt", "total_debt"),
    ("net_debt", "net_debt"),
    ("total_liabilities", "total_liabilities"),
    ("common_stock", "common_stock"),
    ("paid_in_capital", "additional_paid_in_capital"),
    ("retained_earnings", "retained_earnings"),
    ("treasury_stock", "treasury_stock"),
    ("equity", "total_equity"),
]
_LICENSED_CASHFLOW = [
    ("net_income", "cf_net_income"),
    ("d_and_a", "depreciation_amortization"),
    ("sbc", "stock_based_compensation"),
    ("change_receivables", "change_receivables"),
    ("change_inventory", "change_inventory"),
    ("change_payables", "change_payables"),
    ("change_wc", "change_working_capital"),
    ("other_noncash", "other_non_cash_items"),
    ("operating_cf", "operating_cash_flow"),
    ("capex", "capital_expenditure"),
    ("acquisitions", "acquisitions"),
    ("investments_purchased", "purchases_of_investments"),
    ("investments_sold", "sales_of_investments"),
    ("investing_cf", "investing_cash_flow"),
    ("net_debt_issuance", "net_debt_issuance"),
    ("stock_issued", "common_stock_issuance"),
    ("buybacks", "buybacks"),
    ("dividends_paid", "dividends_paid"),
    ("financing_cf", "financing_cash_flow"),
    ("free_cash_flow", "free_cash_flow"),
    ("fx_effect", "fx_effect_on_cash"),
    ("change_in_cash", "net_change_in_cash"),
    ("begin_cash", "cash_at_beginning"),
    ("end_cash", "cash_at_end"),
]

# A 52/53-week filer closes on a weekday near a month end (Apple: the last
# Saturday of September; Broadcom: the Sunday nearest 31 October, which can land
# in November). The payload's `period` is that month end, the shape this payload
# has always had, so the fiscal calendar and the panel's period labels read the
# same dates whichever source answered. The date as reported rides beside it.
_SNAP_DAYS = 6
# Four consecutive quarters span about nine months end to end. A window wider than
# this has a quarter missing inside it, and its sum would not be twelve months.
_TTM_MAX_SPAN_DAYS = 290


def _clean(v: Any):
    try:
        if v is None:
            return None
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


def _extract(df, schema):
    """DataFrame (rows=line items, cols=period Timestamps, newest first) → list of
    {period, values:{key:val}} newest-first, using the curated schema."""
    if df is None or getattr(df, "empty", True):
        return []
    idx = set(str(i) for i in df.index)
    # map each curated key to the first candidate row that exists
    resolved = []
    for key, cands in schema:
        row = next((c for c in cands if c in idx), None)
        resolved.append((key, row))
    out = []
    for col in df.columns:
        period = str(col)[:10]
        values = {}
        for key, row in resolved:
            if row is None:
                continue
            try:
                values[key] = _clean(df.loc[row, col])
            except Exception:
                values[key] = None
        out.append({"period": period, "values": values})
    # yfinance is newest-first already; enforce it
    out.sort(key=lambda p: p["period"], reverse=True)
    return out


# Keys that must NOT be summed across four quarters. Share counts and tax RATES
# are point-in-time / already-annualised; summing them yields nonsense (4x shares,
# a 52% tax rate). `begin_cash` is the START of the trailing window, so it comes
# from the OLDEST quarter in the window rather than the newest.
_POINT_KEYS = {"shares_basic", "shares_diluted", "tax_rate", "end_cash"}
_WINDOW_START_KEYS = {"begin_cash"}


def _ttm_at(quarterly, schema, start):
    """TTM ending at quarterly[start] — the sum of the 4 quarters beginning there.
    Returns None when the window is not fully covered."""
    window = quarterly[start:start + 4]
    if len(window) < 4:
        return None
    span = _days_between(window[-1].get("period"), window[0].get("period"))
    if span is not None and span > _TTM_MAX_SPAN_DAYS:
        return None
    out = {}
    for key, _ in schema:
        if key in _POINT_KEYS:
            out[key] = window[0]["values"].get(key)
            continue
        if key in _WINDOW_START_KEYS:
            out[key] = window[-1]["values"].get(key)
            continue
        vals = [q["values"].get(key) for q in window]
        nums = [v for v in vals if v is not None]
        # a partial window would silently understate the trailing figure
        out[key] = sum(nums) if len(nums) == 4 else None
    return out


def _ttm(quarterly, schema):
    return _ttm_at(quarterly, schema, 0)


def _iso(d) -> date | None:
    try:
        return date.fromisoformat(str(d)[:10])
    except (TypeError, ValueError):
        return None


def _days_between(older, newer) -> int | None:
    a, b = _iso(older), _iso(newer)
    return (b - a).days if a and b else None


def _ttm_series(quarterly, schema):
    """Rolling TTM, newest first — one point per quarter with a full trailing
    window. yfinance returns ~5-7 quarters, so this is typically 2-4 points:
    enough for a TTM sparkline, and enough for a TRUE TTM YoY only when 8
    quarters exist (index 4). The frontend must not invent one otherwise."""
    out = []
    for start in range(0, max(0, len(quarterly) - 3)):
        vals = _ttm_at(quarterly, schema, start)
        if vals is None:
            break
        out.append({"period": quarterly[start]["period"], "values": vals})
    return out


def _month_end_period(reported: str) -> str:
    """The month end a reported period end belongs to: '2025-09-27' -> '2025-09-30',
    '2024-11-03' -> '2024-10-31'. A date further than `_SNAP_DAYS` from any month
    end is returned as reported."""
    d = _iso(reported)
    if d is None:
        return str(reported)[:10]
    prev_end = d.replace(day=1) - timedelta(days=1)
    this_end = (d.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    best = min((prev_end, this_end), key=lambda e: abs((e - d).days))
    return best.isoformat() if abs((best - d).days) <= _SNAP_DAYS else d.isoformat()


def _licensed_rows(hist: dict, pairs) -> list:
    """One statement's rows, newest first, from the FMP reader's aligned series.

    The reader joins balance sheet and cash flow onto the income statement's
    dates, so a statement it has nothing for arrives as columns of gaps. Dates
    with no figure at either END are not periods of this statement and are
    dropped (an absent statement then reaches the panel's own empty state, and a
    statement that lags the income statement starts at its own newest period).
    A gap BETWEEN two real periods is kept as an empty period, so the rows stay
    one period apart and "four rows back" is still the same quarter a year ago."""
    dates = hist.get("dates") or []
    cols = {**(hist.get("series") or {}), **(hist.get("extra_series") or {})}
    by_period: dict = {}
    for i, reported in enumerate(dates):
        values = {}
        for key, src in pairs:
            col = cols.get(src)
            values[key] = _clean(col[i]) if isinstance(col, list) and i < len(col) else None
        reported = str(reported)[:10]
        period = _month_end_period(reported)
        prior = by_period.get(period)
        # Two reported dates on one month end: the later filing date stands.
        if prior is None or reported > prior["reported_period"]:
            by_period[period] = {"period": period, "reported_period": reported, "values": values}
    rows = sorted(by_period.values(), key=lambda p: p["period"], reverse=True)

    def blank(row):
        return all(v is None for v in row["values"].values())

    while rows and blank(rows[0]):
        rows.pop(0)
    while rows and blank(rows[-1]):
        rows.pop()
    return rows


def _licensed_state(hist) -> str:
    """'ok' (periods), 'empty' (FMP answered: no statements) or 'error' (the read failed)."""
    if not isinstance(hist, dict):
        return "error"
    if hist.get("dates"):
        return "ok"
    return "error" if hist.get("state") == "error" else "empty"


def _read_licensed(sym: str) -> tuple:
    """(quarterly, annual) from the FMP reader, read side by side. Never raises:
    a reader that raised is reported as a failed read."""
    from api.services.research import financial_history

    def one(period):
        try:
            return financial_history.get_history(sym, period=period, full=True)
        except Exception as e:  # noqa: BLE001
            _log.warning("statements %s %s read failed: %s", sym, period, e)
            return None

    try:
        with ThreadPoolExecutor(max_workers=2, thread_name_prefix="stmts-read") as ex:
            fq, fa = ex.submit(one, "quarter"), ex.submit(one, "annual")
            return fq.result(), fa.result()
    except Exception as e:  # noqa: BLE001
        _log.warning("statements %s read failed: %s", sym, e)
        return None, None


def _build_licensed(sym: str) -> tuple:
    """(payload | None, state). `state` is 'ok'; 'partial' (served, one statement
    leg missing: not stored); 'half' (served, the quarterly or the annual read
    failed: not stored, retried soon); 'empty' (FMP holds no statements for this
    ticker); or 'error' (the read failed, so nothing can be said about the ticker)."""
    hq, ha = _read_licensed(sym)
    sq, sa = _licensed_state(hq), _licensed_state(ha)
    if "ok" not in (sq, sa):
        return None, ("error" if "error" in (sq, sa) else "empty")
    hq = hq if sq == "ok" else {}
    ha = ha if sa == "ok" else {}

    inc_a, inc_q = _licensed_rows(ha, _LICENSED_INCOME), _licensed_rows(hq, _LICENSED_INCOME)
    bal_a, bal_q = _licensed_rows(ha, _LICENSED_BALANCE), _licensed_rows(hq, _LICENSED_BALANCE)
    cf_a, cf_q = _licensed_rows(ha, _LICENSED_CASHFLOW), _licensed_rows(hq, _LICENSED_CASHFLOW)
    if not any([inc_a, inc_q, bal_a, bal_q, cf_a, cf_q]):
        return None, "empty"

    gaps = sorted({*(hq.get("partial") or []), *(ha.get("partial") or [])})
    half = "error" in (sq, sa)
    if half:
        gaps.append("quarterly" if sq == "error" else "annual")
    meta = {
        "source": SOURCE_LICENSED,
        "source_kind": "provider-normalised reported figures",
        "retrieved_at": time.time(),
        # As the provider states it (TSM: "TWD"); None when it does not say.
        "currency": ha.get("currency") or hq.get("currency"),
        "units": "reporting currency, absolute (EPS per share, rates in %)",
        "fiscal_year_end": (inc_a[0]["period"][5:] if inc_a else None),
        "annual_periods": len(inc_a),
        "quarterly_periods": len(inc_q),
        "reported_keys": sorted({k for s in (_LICENSED_INCOME, _LICENSED_BALANCE, _LICENSED_CASHFLOW)
                                 for k, _ in s}),
        "calculated_in_client": ["gross_margin", "operating_margin", "ebitda_margin",
                                 "net_margin", "fcf_margin", "yoy", "cagr"],
        "ttm_method": "sum of the last four reported quarters; point-in-time keys carried from the latest quarter",
        "period_basis": ("period is the fiscal period end on its month end; "
                         "reported_period is the period end as reported"),
        "build_calls": _LICENSED_CALLS,
    }
    if gaps:
        meta["partial"] = gaps
    result = {
        "ticker": sym,
        "income": {"annual": inc_a, "quarterly": inc_q, "ttm": _ttm(inc_q, _LICENSED_INCOME),
                   "ttm_series": _ttm_series(inc_q, _LICENSED_INCOME)},
        "balance": {"annual": bal_a, "quarterly": bal_q,
                    "ttm": bal_q[0]["values"] if bal_q else None,
                    "ttm_series": []},
        "cashflow": {"annual": cf_a, "quarterly": cf_q, "ttm": _ttm(cf_q, _LICENSED_CASHFLOW),
                     "ttm_series": _ttm_series(cf_q, _LICENSED_CASHFLOW)},
        "meta": meta,
    }
    return result, ("half" if half else "partial" if gaps else "ok")


def _today() -> date:
    return date.today()


def _store_ttl(payload: dict) -> int:
    """Seconds a stored copy of `payload` is served before it is refreshed.

    A Yahoo Finance answer keeps the 12 hours it always had. An FMP answer is
    fresh until its newest quarter is `_QUIET_DAYS` old (no newer quarter can
    have been reported before then), for at most `_QUIET_TTL` at a time; from
    then on, and whenever the newest quarter cannot be read, it is `_DUE_TTL`.
    Never below `_DUE_TTL`, so the day the window opens is not a burst of reads."""
    meta = payload.get("meta") if isinstance(payload, dict) else None
    if not isinstance(meta, dict) or meta.get("source") != SOURCE_LICENSED:
        return _TTL
    rows = (payload.get("income") or {}).get("quarterly") or []
    newest = rows[0] if rows and isinstance(rows[0], dict) else {}
    ended = _iso(newest.get("reported_period") or newest.get("period"))
    if ended is None:
        return _DUE_TTL
    age_days = (_today() - ended).days
    if not 0 <= age_days < _QUIET_DAYS:
        return _DUE_TTL
    return max(_DUE_TTL, min(_QUIET_TTL, (_QUIET_DAYS - age_days) * 86400))


def _unavailable(sym: str) -> dict:
    """The statements read failed. Not an empty statement and not a fund: a state
    of its own, so no screen has to say "this company has no financials"."""
    return {"error": "statements temporarily unavailable", "state": "unavailable",
            "ticker": sym,
            "meta": {"retrieved_at": time.time(), "source": SOURCE_LICENSED,
                     "build_calls": _LICENSED_CALLS}}


def _build_first(sym: str) -> tuple:
    """(payload, hold): FMP first, Yahoo Finance only for a ticker FMP holds
    nothing for. `hold` says what the caller may do with the answer:

      'keep'   a complete answer: cache it and store it
      'brief'  an answer worth serving but not worth remembering (a gap that
               should heal, or no statements anywhere)
      'retry'  a read failed: hold it for seconds, never store it
    """
    licensed, state = _build_licensed(sym)
    if licensed is not None:
        return licensed, {"ok": "keep", "half": "retry"}.get(state, "brief")
    if state == "error":
        return _unavailable(sym), "retry"
    out = _build(sym)
    meta = out.setdefault("meta", {})
    meta["sources_tried"] = [SOURCE_LICENSED, SOURCE_FALLBACK]
    # the security-type lookup on the empty path is one more read
    meta["build_calls"] = _LICENSED_CALLS + _FALLBACK_CALLS + (1 if out.get("error") else 0)
    return out, ("brief" if out.get("error") else "keep")


def _build(sym: str) -> dict:
    """The Yahoo Finance build: six bounded provider round-trips. Reached only
    through `_build_first`, for a ticker FMP holds no statements for."""

    def _fetch(attr):
        try:
            return yf_util.bounded_call(lambda: getattr(yf.Ticker(sym), attr), None)
        except Exception as e:  # noqa: BLE001
            _log.warning("statements %s.%s failed: %s", sym, attr, e)
            return None

    inc_a = _extract(_fetch("income_stmt"), _INCOME)
    inc_q = _extract(_fetch("quarterly_income_stmt"), _INCOME)
    bal_a = _extract(_fetch("balance_sheet"), _BALANCE)
    bal_q = _extract(_fetch("quarterly_balance_sheet"), _BALANCE)
    cf_a = _extract(_fetch("cashflow"), _CASHFLOW)
    cf_q = _extract(_fetch("quarterly_cashflow"), _CASHFLOW)

    if not any([inc_a, inc_q, bal_a, bal_q, cf_a, cf_q]):
        # Not necessarily a failure: ETFs, funds and many trusts simply do not
        # publish company financial statements. Say WHICH so the UI can show a
        # correct explanation instead of an income statement full of dashes.
        return {"error": "no statements available", "ticker": sym,
                "security_type": _security_type(sym),
                "meta": {"retrieved_at": time.time(), "source": SOURCE_FALLBACK}}

    # yfinance reports "Tax Rate For Calcs" as a FRACTION (0.13). Everything else
    # in this payload is a raw reporting-currency number or a per-share figure, so
    # normalise it here rather than teaching the frontend a one-off unit.
    for series in (inc_a, inc_q):
        for p in series:
            tr = p["values"].get("tax_rate")
            if tr is not None and abs(tr) <= 1.5:
                p["values"]["tax_rate"] = tr * 100.0

    result = {
        "ticker": sym,
        "income": {"annual": inc_a, "quarterly": inc_q, "ttm": _ttm(inc_q, _INCOME),
                   "ttm_series": _ttm_series(inc_q, _INCOME)},
        "balance": {"annual": bal_a, "quarterly": bal_q,
                    # a balance sheet is a SNAPSHOT — "TTM" is simply the most
                    # recent quarter, and a rolling sum would be meaningless.
                    "ttm": bal_q[0]["values"] if bal_q else None,
                    "ttm_series": []},
        "cashflow": {"annual": cf_a, "quarterly": cf_q, "ttm": _ttm(cf_q, _CASHFLOW),
                     "ttm_series": _ttm_series(cf_q, _CASHFLOW)},
        # Provenance travels WITH the data. The UI surfaces part of this under
        # "Data & methodology"; the rest exists so a value can later be traced to
        # the filing it came from without reshaping the payload.
        "meta": {
            "source": SOURCE_FALLBACK,
            "source_kind": "provider-normalised reported figures",
            "retrieved_at": time.time(),
            "currency": _currency(inc_a or bal_a or cf_a),
            "units": "reporting currency, absolute (EPS per share, rates in %)",
            "fiscal_year_end": (inc_a[0]["period"][5:] if inc_a else None),
            "annual_periods": len(inc_a),
            "quarterly_periods": len(inc_q),
            # Every value in `values` is AS REPORTED by the provider. Margins,
            # FCF margin, CAGR and YoY are computed in the client and are not
            # persisted here — so nothing stored can be mistaken for a filing.
            "reported_keys": sorted({k for _, s in (("i", _INCOME), ("b", _BALANCE), ("c", _CASHFLOW)) for k, _ in s}),
            "calculated_in_client": ["gross_margin", "operating_margin", "ebitda_margin",
                                     "net_margin", "fcf_margin", "yoy", "cagr"],
            "ttm_method": "sum of the last four reported quarters; point-in-time keys carried from the latest quarter",
        },
    }
    return result


def _currency(periods) -> str | None:
    # yfinance statements are reported in the filing currency but do not carry a
    # currency field per row; leave it unset rather than assume USD.
    return None


def _security_type(sym: str) -> str | None:
    """Only called when NOTHING was returned — so the extra provider round-trip
    happens on the rare empty path, never on the hot one."""
    try:
        info = yf_util.bounded_call(lambda: yf.Ticker(sym).info, None) or {}
        qt = info.get("quoteType")
        return str(qt).lower() if qt else None
    except Exception:  # noqa: BLE001
        return None


def _schedule_refresh(sym: str) -> None:
    """Background rebuild for ONE ticker. De-duplicated, so a burst of viewers
    on the same symbol produces a single upstream refresh, not one per user."""
    with _refresh_lock:
        if sym in _refreshing:
            return
        _refreshing.add(sym)

    def _run():
        try:
            fresh, hold = _build_first(sym)
            # Only a complete answer replaces the stored copy: a gap or a failed
            # read must not overwrite the last good statements.
            if hold == "keep":
                cache.set(f"{_KIND}::{sym}", fresh, _TTL)
                snap_store.put(_KIND, sym, fresh, _store_ttl(fresh))
        except Exception as e:  # noqa: BLE001
            _log.warning("statements refresh %s failed: %s", sym, e)
        finally:
            with _refresh_lock:
                _refreshing.discard(sym)

    threading.Thread(target=_run, name=f"stmts-refresh-{sym}", daemon=True).start()


def get_statements(ticker: str) -> dict:
    """Statements for a ticker, shared across every user of the app.

    memory → disk (fresh) → disk (stale, refresh behind the response) → build.
    How long a stored copy counts as fresh is `_store_ttl`'s answer for that copy.
    Financial history is company-level intelligence, not per-user data: the first
    viewer of a ticker pays for the fetch and everyone after that is served from
    storage, across restarts.

    The build asks FMP first (`_build_first`); `meta.source` names the source of
    the answer being served, including a stored copy built before this order.
    Never raises.
    """
    sym = (ticker or "").upper().strip()
    if not sym:
        return {"error": "ticker required"}

    ck = f"{_KIND}::{sym}"
    hit = cache.get(ck)
    if hit is not None:
        return hit

    stored = snap_store.get(_KIND, sym)
    if stored is not None:
        payload, age, ttl = stored
        if isinstance(payload, dict) and not payload.get("error"):
            payload.setdefault("meta", {})["age_seconds"] = int(age)
            if age <= ttl:
                # memory holds it for 12 hours at most, however long the stored copy is good
                cache.set(ck, payload, max(60, int(min(ttl - age, _TTL))))
                return payload
            if age <= _STALE_MAX:
                # Serve the last validated copy NOW; refresh out of band. A slow
                # or failing provider degrades to "slightly old", never to a
                # spinner or an empty statement.
                payload["meta"]["stale"] = True
                cache.set(ck, payload, 300)
                _schedule_refresh(sym)
                return payload

    try:
        result, hold = _build_first(sym)
    except Exception as e:  # noqa: BLE001 -- a build that raised is a failed read
        _log.warning("statements build %s failed: %s", sym, e)
        result, hold = _unavailable(sym), "retry"
    if hold != "keep":
        cache.set(ck, result, _RETRY_TTL if hold == "retry" else _NEG_TTL)
        return result
    cache.set(ck, result, _TTL)
    snap_store.put(_KIND, sym, result, _store_ttl(result))
    return result
