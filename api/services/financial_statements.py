"""Historical financial statements (income / balance sheet / cash flow) for the
Company Intelligence panel — sourced from yfinance, which is ALREADY a dependency,
so this adds **no new paid data provider** (cost-control mandate).

yfinance returns ~5 annual + ~5 quarterly periods of fully-itemized statements.
We normalize a curated, stable set of line items to snake_case keys, compute a TTM
column for the flow statements (sum of the last 4 reported quarters), and cache the
whole bundle per ticker. Every yfinance access is bounded (yf_util.bounded_call) so
a stalled Yahoo response can never pin a worker thread.

Values are RAW numbers in the reporting currency (the frontend formats to B/M and %);
EPS rows are per-share. Missing cells are `None`, never fabricated.
"""
from __future__ import annotations

import logging
import math
import threading
import time
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


def _build(sym: str) -> dict:
    """Live build — six bounded provider round-trips. Callers should reach this
    at most once per company per refresh cycle (see get_statements)."""

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
                "meta": {"retrieved_at": time.time(), "source": "Yahoo Finance"}}

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
            "source": "Yahoo Finance",
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
            fresh = _build(sym)
            if not fresh.get("error"):
                cache.set(f"{_KIND}::{sym}", fresh, _TTL)
                snap_store.put(_KIND, sym, fresh, _TTL)
        except Exception as e:  # noqa: BLE001
            _log.warning("statements refresh %s failed: %s", sym, e)
        finally:
            with _refresh_lock:
                _refreshing.discard(sym)

    threading.Thread(target=_run, name=f"stmts-refresh-{sym}", daemon=True).start()


def get_statements(ticker: str) -> dict:
    """Statements for a ticker, shared across every user of the app.

    memory → disk (fresh) → disk (stale, refresh behind the response) → build.
    Financial history is company-level intelligence, not per-user data: the first
    viewer of a ticker pays for the fetch and everyone after that is served from
    storage, across restarts.
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
                cache.set(ck, payload, max(60, int(ttl - age)))
                return payload
            if age <= _STALE_MAX:
                # Serve the last validated copy NOW; refresh out of band. A slow
                # or failing provider degrades to "slightly old", never to a
                # spinner or an empty statement.
                payload["meta"]["stale"] = True
                cache.set(ck, payload, 300)
                _schedule_refresh(sym)
                return payload

    result = _build(sym)
    if result.get("error"):
        cache.set(ck, result, _NEG_TTL)
        return result
    cache.set(ck, result, _TTL)
    snap_store.put(_KIND, sym, result, _TTL)
    return result
