"""Ownership for the research page: institutional holders, short interest /
float, and insider activity.

2026-09-03 modernization (A6/A7 vertical slice): canonical identity now
resolves through Entity Master (`resolve_entity`) before any provider call.
Float/shares-outstanding and Form 13F now route through D1
(`fmp_client.get_shares_float` / `get_institutional_ownership_summary` /
`...holders`), each carrying a real provenance/freshness envelope. Insider
activity reuses the existing `get_insider_activity` service, called with the
entity-resolved FMP symbol. The institutional-holders TABLE and the short-
interest FIELDS (shares_short/short_pct_float/days_to_cover/
prior_month_short) stay on yfinance — no D1 adapter exists for either today,
and this pass does not invent a speculative one (see the D1 completion
report for the deferred-work note).

Cached 12h -- but only when the two HARD provider legs (the yfinance pull,
the insider feed) resolved without raising. A 13F filing genuinely not
existing for a ticker (most small/mid caps) or an insider feed that
legitimately has nothing recent are NOT failures -- only an exception from
the underlying fetch is treated as one, so a quiet ticker doesn't get
needlessly refetched every few minutes.
"""
from __future__ import annotations

import datetime
import logging
import math

from api.services import fmp_client
from api.services.cache import cache
from api.services.cache_policy import set_by_completeness
from api.services.insider import get_insider_activity
from api.services.research.entity_resolution import resolve_entity
from api.services.yfinance_pool import run_in_pool

_logger = logging.getLogger(__name__)

_CACHE_TTL = 43_200  # 12h -- only when both hard legs resolved
_FAIL_TTL = 300        # 5 min -- a partial/failed fetch self-heals fast
_TF_MAX_HOLDERS = 12   # top institutional holders to surface


def _num(v):
    try:
        f = float(v)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def _pct(frac):
    """fraction (0.0073) -> percent (0.73), rounded."""
    f = _num(frac)
    return round(f * 100, 2) if f is not None else None


def _fmp_row_meta(fn, *args, **kwargs):
    """Same 'never raises, (row, meta)' contract as analyst_grades.py's
    `_fmp_row_with_meta` -- copied locally (that helper is module-private
    there too) rather than shared, until a third caller justifies promoting
    it. `meta` is the D1 provenance/freshness envelope shaped for
    ResearchPage's TrustStrip (`_meta.sourceObservedAt`/`.freshnessClass`/
    etc.) -- `None` on any miss, never fabricated."""
    try:
        result = fn(*args, **kwargs)
    except Exception:
        return None, None
    if result.degraded is not None and not result.value:
        return None, None
    row = result.value[0] if isinstance(result.value, list) and result.value else None
    if not isinstance(row, dict):
        return None, None
    meta = {
        "vendor": result.provenance.vendor,
        "sourceActivity": result.provenance.source_activity,
        "fetchedAt": result.provenance.fetched_at,
        "sourceObservedAt": result.provenance.source_observed_at,
        "tieBreak": result.provenance.tie_break,
        "freshnessClass": result.freshness,
        "licensingClass": result.licensing_class,
        "degraded": result.degraded,
    }
    return row, meta


def _institutional(holders_df, info):
    info = info or {}
    # Same class-mixing defect as the float/outstanding pair: yfinance divides
    # a whole-company institutional holding by a single-class share count and
    # reports >100% (ATRO read 101.84% on 2026-08-06). Institutions cannot hold
    # more than all of the shares outstanding, so a figure over 100 is not a
    # number to present — it is a signal the inputs came from two different
    # share classes. Suppress rather than cap: capping to 100.0 would state a
    # precise fact no provider actually reported.
    pct_held = _pct(info.get("heldPercentInstitutions"))
    if pct_held is not None and pct_held > 100:
        _logger.warning("heldPercentInstitutions %.2f%% exceeds 100 — suppressing", pct_held)
        pct_held = None
    out = {"pct_held": pct_held, "holders": []}
    if holders_df is None or getattr(holders_df, "empty", True):
        return out

    def col(row, *names):
        for n in names:
            if n in row.index:
                return row[n]
        return None

    try:
        rows = list(holders_df.head(8).iterrows())
    except Exception:
        rows = []
    for _, r in rows:
        date = col(r, "Date Reported", "dateReported")
        try:
            date = date.strftime("%Y-%m-%d")
        except Exception:
            date = str(date)[:10] if date is not None else None
        out["holders"].append({
            "holder": col(r, "Holder", "holder"),
            "shares": _num(col(r, "Shares", "shares")),
            "pct_out": _pct(col(r, "pctHeld", "% Out")),
            "value": _num(col(r, "Value", "value")),
            "date": date,
        })
    return out


def _fmp_share_counts(symbol):
    """Float + shares outstanding via D1 (`fmp_client.get_shares_float`).

    PRIMARY over yfinance because yfinance mixes SHARE CLASSES on dual-class
    tickers: it reports a whole-company float against a single-class share
    count, producing a float LARGER than shares outstanding — an impossible
    pair that was rendering on the Ownership tab. Measured 2026-08-06:

        ticker  yfinance float / outstanding     FMP float / outstanding
        ATROB     40,337,603 / 10,900,000  X       19,093,178 /    35,851,963
        ATRO      40,337,603 / 38,448,408  X       31,324,615 /    38,448,408
        BRK-B      1,166,258 /  1.398e9    X    1,393,387,948 / 2,156,853,595
        LEN-B    204,214,039 / 30,389,139  X       78,914,196 /   248,295,271

    On single-class megacaps the two agree (NVDA/MSFT float matched to the
    share), so this is a correctness fix for the broken tail, not a change in
    what the common case shows. Returns ({}, None) on any failure so the
    caller falls back to yfinance rather than blanking the card.
    """
    row, meta = _fmp_row_meta(fmp_client.get_shares_float, symbol)
    if not row:
        return {}, None
    return {
        "float_shares": _num(row.get("floatShares")),
        "shares_outstanding": _num(row.get("outstandingShares")),
    }, meta


def _reconcile_share_counts(info, fmp_counts):
    """FMP first (see `_fmp_share_counts` docstring for the dual-class-mixing
    bug this fixes), yfinance only where FMP had nothing.

    A float larger than shares outstanding is arithmetically impossible —
    float is a SUBSET of shares outstanding. If a pair still contradicts
    itself after the FMP swap, we cannot tell WHICH side is wrong, so we
    publish neither: an em dash is honest, two confident numbers that can't
    both be true are not. Never "repair" by clamping one to the other —
    that invents a figure no provider reported."""
    info = info or {}
    counts = fmp_counts or {}
    float_shares = counts.get("float_shares")
    if float_shares is None:
        float_shares = _num(info.get("floatShares"))
    shares_out = counts.get("shares_outstanding")
    if shares_out is None:
        shares_out = _num(info.get("sharesOutstanding"))

    if float_shares is not None and shares_out is not None and float_shares > shares_out:
        _logger.warning("share counts inconsistent (float %s > outstanding %s) — suppressing both",
                        float_shares, shares_out)
        float_shares = shares_out = None
    return float_shares, shares_out


def _short(info):
    info = info or {}
    return {
        "shares_short": _num(info.get("sharesShort")),
        "short_pct_float": _pct(info.get("shortPercentOfFloat")),
        "days_to_cover": _num(info.get("shortRatio")),
        "prior_month_short": _num(info.get("sharesShortPriorMonth")),
    }


def _recent_quarters(today=None):
    """Candidate (year, quarter) pairs newest-first, covering the current quarter
    plus the prior three. 13F filings lag ~45 days, so the newest one WITH data
    is whatever's been filed — we try newest-first and take the first that hits."""
    today = today or datetime.date.today()
    q = (today.month - 1) // 3 + 1
    out = []
    y = today.year
    for _ in range(4):
        out.append((y, q))
        q -= 1
        if q == 0:
            q = 4
            y -= 1
    return out


def _thirteen_f(symbol):
    """Form 13F institutional ownership via D1 (`fmp_client.
    get_institutional_ownership_summary` / `...holders`): a position-flow
    summary + the top institutional holders for the most recent filed
    quarter. Returns {quarter, summary, holders, _meta} or None. Best-effort;
    never raises."""
    quarter = None
    summ = None
    meta = None
    for year, q in _recent_quarters():
        row, m = _fmp_row_meta(fmp_client.get_institutional_ownership_summary, symbol, year=year, quarter=q)
        if row:
            quarter, summ, meta = (year, q), row, m
            break
    if not summ:
        return None

    year, q = quarter
    try:
        hresult = fmp_client.get_institutional_ownership_holders(symbol, year=year, quarter=q, limit=_TF_MAX_HOLDERS)
        hraw = hresult.value if hresult.degraded is None else None
    except Exception:
        hraw = None
    holders = []
    if isinstance(hraw, list):
        for h in hraw[:_TF_MAX_HOLDERS]:
            if not isinstance(h, dict):
                continue
            holders.append({
                "name":         h.get("investorName"),
                "shares":       _num(h.get("sharesNumber")),
                "change_shares": _num(h.get("changeInSharesNumber")),
                "change_pct":   _num(h.get("changeInSharesNumberPercentage")),
                "ownership":    _num(h.get("ownership")),
                "market_value": _num(h.get("marketValue")),
                "is_new":       bool(h.get("isNew")),
                "is_sold_out":  bool(h.get("isSoldOut")),
            })

    return {
        "quarter": f"{year}Q{q}",
        "summary": {
            "investors_holding":   _num(summ.get("investorsHolding")),
            "investors_change":    _num(summ.get("investorsHoldingChange")),
            "ownership_pct":       _num(summ.get("ownershipPercent")),
            "ownership_change":    _num(summ.get("ownershipPercentChange")),
            "total_invested":      _num(summ.get("totalInvested")),
            "total_invested_change": _num(summ.get("totalInvestedChange")),
            "new_positions":       _num(summ.get("newPositions")),
            "increased_positions": _num(summ.get("increasedPositions")),
            "reduced_positions":   _num(summ.get("reducedPositions")),
            "closed_positions":    _num(summ.get("closedPositions")),
            "put_call_ratio":      _num(summ.get("putCallRatio")),
        },
        "holders": holders,
        "_meta": meta,
    }


def _fetch_yf(sym):
    """Returns {} ONLY when the pool call itself raised -- callers use that
    as the "did this leg actually fail" signal (`bool(raw)` is False only on
    a genuine provider exception; a successful call always returns a dict,
    even one whose values are individually None/empty)."""
    def _do():
        import yfinance as yf
        t = yf.Ticker(sym)
        return {"info": t.get_info(), "inst": getattr(t, "institutional_holders", None)}
    try:
        return run_in_pool(_do, timeout=15)
    except Exception as exc:
        _logger.warning("yf ownership fetch failed for %s: %s", sym, exc)
        return {}


def get_ownership(sym):
    sym = (sym or "").upper().strip()
    if not sym:
        return {}

    ck = f"research_own::{sym}"
    cached = cache.get(ck)
    if cached is not None:
        return cached

    entity, fmp_symbol = resolve_entity(sym, vendor="fmp")

    raw = _fetch_yf(sym)
    yf_ok = bool(raw)          # {} means _fetch_yf's exception path fired
    raw = raw or {}
    info = raw.get("info") or {}

    insider = []
    insider_ok = True
    try:
        insider = (get_insider_activity(fmp_symbol) or [])[:10]
    except Exception as exc:
        insider_ok = False
        _logger.warning("insider activity failed for %s: %s", sym, exc)

    try:
        thirteen_f = _thirteen_f(fmp_symbol)
    except Exception as exc:
        # _thirteen_f already swallows its own per-endpoint failures
        # internally and returns None for "no 13F filed" too (common and
        # legitimate for most non-mega-caps) -- this outer except is a
        # defensive backstop, not a completeness signal, so it does not
        # factor into `complete` below.
        _logger.warning("13F ownership failed for %s: %s", sym, exc)
        thirteen_f = None

    try:
        share_counts_raw, share_counts_meta = _fmp_share_counts(fmp_symbol)
    except Exception as exc:  # defensive: _fmp_share_counts already swallows
        _logger.warning("share counts failed for %s: %s", sym, exc)
        share_counts_raw, share_counts_meta = {}, None

    float_shares, shares_out = _reconcile_share_counts(info, share_counts_raw)

    out = {
        "sym": sym,
        "entity": entity,
        "institutional": _institutional(raw.get("inst"), info),
        "short": _short(info),
        "share_counts": {
            "float_shares": float_shares,
            "shares_outstanding": shares_out,
            "_meta": share_counts_meta,
        },
        "insider": insider,
        "thirteen_f": thirteen_f,
    }
    complete = yf_ok and insider_ok
    set_by_completeness(ck, out, complete=complete, ttl_ok=_CACHE_TTL, ttl_partial=_FAIL_TTL)
    return out
