"""Institutional ownership for a ticker.

Two readers, and one order between them:

  `get_ownership`                        FMP's per-holder Form 13F list first (holders with the
                                         change against each filer's prior filing); Yahoo Finance's
                                         holders table only when FMP holds no rows for the ticker.
                                         The Charts ownership panel route reads it.
  `get_institutional_holders_13f_first`  the same holders in the voice tool's shape, with the
                                         institutional percent and the float from the research
                                         ownership record.
  `get_institutional_holders`            the Yahoo Finance table on its own: the fallback the two
                                         above use, never the first read.

For deeper 13F deltas across all filers (who's adding / cutting), see
the SEC EDGAR full-text search tool (`search_sec_filings`).
"""

import logging
from typing import Any

import yfinance as yf

from api.services import yf_util
from api.services.cache import TTLCache

_log = logging.getLogger(__name__)
_CACHE = TTLCache()
_CACHE_TTL = 21600  # 6 hours — 13F data updates quarterly


YAHOO_SOURCE = "yfinance (Yahoo Finance 13F aggregate)"
FMP_13F_SOURCE = "Form 13F filings, through FMP"
#: How many holders the fallback read asks Yahoo for (one read, shared by both callers).
_FALLBACK_TOP_N = 15


def get_institutional_holders(ticker: str, top_n: int = 10) -> dict[str, Any]:
    """The Yahoo Finance holders table: the FALLBACK for a ticker FMP holds no 13F holder rows
    for. Callers reach it through `get_ownership` / `get_institutional_holders_13f_first`."""
    sym = (ticker or "").upper().strip()
    if not sym:
        return {"error": "ticker required"}
    top_n = max(1, min(25, int(top_n or 10)))

    cache_key = f"inst::{sym}::{top_n}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return dict(cached)

    # Both reads (`.info` and `.institutional_holders`) are network calls, so
    # the whole block goes through the shared guard as ONE bounded unit.
    def _read():
        t = yf.Ticker(sym)
        info = t.info or {}
        # institutional_holders is a DataFrame with cols: Holder, Shares, Date Reported, % Out, Value
        try:
            df = t.institutional_holders
        except Exception:
            df = None
        return info, df

    try:
        got = yf_util.bounded_call(_read, None)
        if got is None:
            raise RuntimeError("bounded yfinance call returned no data")
        info, df = got
        held_by_inst = info.get("heldPercentInstitutions")
        held_by_insiders = info.get("heldPercentInsiders")
        float_shares = info.get("floatShares")
    except Exception as e:
        _log.warning("yfinance institutional holders failed for %s: %s", sym, e)
        return {"error": f"yfinance failed: {e}", "ticker": sym}

    holders: list[dict] = []
    if df is not None and not df.empty:
        for _, row in df.head(top_n).iterrows():
            try:
                holders.append({
                    "holder": str(row.get("Holder") or ""),
                    "shares": int(row.get("Shares") or 0),
                    "date_reported": str(row.get("Date Reported") or ""),
                    "pct_out": round(float(row.get("% Out") or 0) * 100.0, 2)
                                if row.get("% Out") is not None else None,
                    "value_usd": float(row.get("Value") or 0),
                })
            except Exception:
                continue

    def _pct(v):
        try:
            return round(float(v) * 100.0, 2)
        except (TypeError, ValueError):
            return None

    result = {
        "ticker": sym,
        "held_by_institutions_pct": _pct(held_by_inst),
        "held_by_insiders_pct": _pct(held_by_insiders),
        "float_shares": float_shares,
        "top_holders_count": len(holders),
        "top_holders": holders,
        "source": YAHOO_SOURCE,
    }
    _CACHE.set(cache_key, dict(result), _CACHE_TTL)
    return result


def _insider_held_pct(sym: str):
    """Percent of the shares held by insiders, or None.

    Form 13F covers institutions only, so the 13F data has no such figure and no other
    source in the code carries it: this ONE number is still read from Yahoo Finance, on its
    own, and the answer that carries it says so. Cached like the rest (6h); a failed read is
    None and is not cached."""
    ckey = f"insider_pct::{sym}"
    hit = _CACHE.get(ckey)
    if hit is not None:
        return hit.get("pct")
    try:
        frac = yf_util.bounded_call(lambda: (yf.Ticker(sym).info or {}).get("heldPercentInsiders"), None)
        pct = round(float(frac) * 100.0, 2)
    except Exception as e:  # noqa: BLE001 -- None when the read failed or the field is absent
        if not isinstance(e, (TypeError, ValueError)):
            _log.warning("yfinance insider percent failed for %s: %s", sym, e)
        return None
    _CACHE.set(ckey, {"pct": pct}, _CACHE_TTL)
    return pct


def _record_percent_and_float(sym: str):
    """(institutional percent, float shares) from the research ownership record: the Form 13F
    summary's percent and FMP's float. (None, None) when that record cannot be read."""
    try:
        from api.services.research.ownership import get_ownership as research_ownership
        rec = research_ownership(sym) or {}
    except Exception as e:  # noqa: BLE001 -- the holders still answer without the two figures
        _log.warning("research ownership record failed for %s: %s", sym, e)
        return None, None
    return ((rec.get("institutional") or {}).get("pct_held"),
            (rec.get("share_counts") or {}).get("float_shares"))


def get_institutional_holders_13f_first(ticker: str, top_n: int = 10) -> dict[str, Any]:
    """Top institutional holders in the voice tool's shape, read the way the Charts ownership
    panel route reads them: FMP's per-holder Form 13F list first, the Yahoo Finance table only
    when FMP holds no rows for the ticker (then the answer is `get_institutional_holders`'s,
    unchanged).

    From 13F the answer also carries each holder's change against its prior filing and the
    biggest buyers and sellers. `sources` names where each figure came from: the institutional
    percent and the float are the research ownership record's; the insider percent has
    no 13F equivalent and is the one figure still read from Yahoo Finance (`_insider_held_pct`).
    A figure that could not be read is None, never 0."""
    sym = (ticker or "").upper().strip()
    if not sym:
        return {"error": "ticker required"}
    top_n = max(1, min(25, int(top_n or 10)))

    own = _ownership_result(sym)
    if own.get("_source") != "fmp":
        # No 13F holder rows at FMP: the Yahoo answer `get_ownership` just read (cached).
        out = get_institutional_holders(sym, top_n=_FALLBACK_TOP_N)
        if "error" in out:
            return out
        holders = (out.get("top_holders") or [])[:top_n]
        return {**out, "top_holders_count": len(holders), "top_holders": holders}

    def _row(h):
        return {"holder": h.get("holder"), "shares": h.get("shares"), "pct_out": h.get("pct_out"),
                "value_usd": h.get("value"), "change": h.get("change"),
                "change_shares": h.get("change_shares")}

    holders = [_row(h) for h in (own.get("top_holders") or [])[:top_n]]
    inst_pct, float_shares = _record_percent_and_float(sym)
    return {
        "ticker": sym,
        "held_by_institutions_pct": inst_pct,
        "held_by_insiders_pct": _insider_held_pct(sym),
        "float_shares": float_shares,
        "top_holders_count": len(holders),
        "top_holders": holders,
        "biggest_buyers": [_row(h) for h in own.get("biggest_buyers") or []],
        "biggest_sellers": [_row(h) for h in own.get("biggest_sellers") or []],
        "as_of": own.get("as_of"),
        "source": FMP_13F_SOURCE,
        "sources": {
            "top_holders": FMP_13F_SOURCE,
            "held_by_institutions_pct": FMP_13F_SOURCE,
            "float_shares": "FMP shares float",
            "held_by_insiders_pct": "Yahoo Finance (Form 13F covers institutions only)",
        },
    }


# ── 13F ownership with position-change deltas (FMP Ultimate first) ──────────
_OWN_TTL = 21_600  # 6h


def _classify_change(cur, prior):
    """new / added / reduced / sold_out / flat from current vs prior shares."""
    c = cur or 0
    p = prior
    if p is None or p == 0:
        return "new" if c > 0 else "flat"
    if c == 0:
        return "sold_out"
    if c > p:
        return "added"
    if c < p:
        return "reduced"
    return "flat"


_Q_END_MONTH_DAY = {1: (3, 31), 2: (6, 30), 3: (9, 30), 4: (12, 31)}


def _recent_13f_quarters(now=None, tries=3, filing_buffer_days=50):
    """(year, quarter) pairs to try, most-likely-COMPLETE quarter first.

    13F filings are due 45 calendar days after quarter-end, and filers
    trickle in right up to that deadline — a quarter whose deadline hasn't
    passed yet has data from early filers only (small/foreign funds), NOT
    the real top-holders list (BlackRock/Vanguard-scale filers file late).
    Skip any quarter whose deadline + buffer hasn't passed."""
    from datetime import UTC, datetime, timedelta
    now = now or datetime.now(UTC)
    q = (now.month - 1) // 3 + 1
    y = now.year
    candidates = []
    for _ in range(tries + 3):
        m, d = _Q_END_MONTH_DAY[q]
        candidates.append((y, q, datetime(y, m, d, tzinfo=UTC)))
        q -= 1
        if q == 0:
            q, y = 4, y - 1
    filed = [(yy, qq) for yy, qq, end in candidates if now >= end + timedelta(days=filing_buffer_days)]
    return filed[:tries] if filed else [(candidates[-1][0], candidates[-1][1])]


def _fmp_ownership(ticker):
    """FMP Ultimate per-holder 13F ownership + deltas.
    /stable/institutional-ownership/symbol-ownership 404s (not a real FMP
    path) — the real per-holder endpoint is
    /stable/institutional-ownership/extract-analytics/holder, which requires
    year+quarter (see _recent_13f_quarters). Field is `ownership`, NOT
    `ownershipPercent`. Returns [] on any failure."""
    # TERM-072: through the D1 adapter; `body_or_none` keeps the retired
    # `_fmp_get`'s "body, [] or None" contract. The typed function also sends
    # `page=0`, FMP's own default page, so the answer is the same first page.
    from api.services import fmp_client
    for year, quarter in _recent_13f_quarters():
        try:
            data = fmp_client.body_or_none(fmp_client.get_institutional_ownership_holders,
                                           ticker, year=year, quarter=quarter, limit=20,
                                           timeout=10)
        except Exception:
            continue
        rows = data if isinstance(data, list) else []
        out = []
        for r in rows:
            out.append({
                "holder": r.get("investorName") or r.get("holder"),
                "shares": r.get("sharesNumber") or r.get("shares"),
                "prior_shares": r.get("lastSharesNumber") or r.get("prior_shares"),
                "pct_out": r.get("ownership") if r.get("ownership") is not None else r.get("pct_out"),
                "value": r.get("marketValue") or r.get("value"),
                "date": str(r.get("date") or "")[:10] or None,
            })
        out = [r for r in out if r.get("holder")]
        if out:
            return out
    return []


def get_ownership(ticker, debug=False):
    """Top institutional holders + position-change deltas (new/added/reduced/
    sold_out) + biggest buyers/sellers. FMP first, yfinance fallback (no deltas)."""
    result = _ownership_result(ticker, debug=debug)
    return result if debug else {k: v for k, v in result.items() if k != "_source"}


def _ownership_result(ticker, debug=False):
    """`get_ownership`'s answer WITH `_source` ('fmp' | 'yfinance'), so a caller that must say
    where the holders came from can. Held in the cache with it; `get_ownership` strips it."""
    ticker = (ticker or "").upper().strip()
    empty = {"ticker": ticker, "inst_pct": None, "inst_holders_count": None, "as_of": None,
             "top_holders": [], "biggest_buyers": [], "biggest_sellers": []}
    if not ticker:
        return empty
    ckey = f"ownership::{ticker}"
    if not debug:
        hit = _CACHE.get(ckey)
        if hit is not None:
            return dict(hit)

    rows = _fmp_ownership(ticker)
    if rows:
        holders = []
        for r in rows:
            shares = r.get("shares")
            prior = r.get("prior_shares")
            ch = _classify_change(shares, prior)
            holders.append({"holder": r["holder"], "shares": shares, "pct_out": r.get("pct_out"),
                            "value": r.get("value"), "change": ch,
                            "change_shares": (None if shares is None or prior is None else shares - prior)})
        holders.sort(key=lambda h: (h.get("shares") or 0), reverse=True)
        deltas = [h for h in holders if h.get("change_shares") is not None]
        buyers = sorted([h for h in deltas if h["change_shares"] > 0], key=lambda h: h["change_shares"], reverse=True)[:5]
        sellers = sorted([h for h in deltas if h["change_shares"] < 0], key=lambda h: h["change_shares"])[:5]
        as_of = next((r.get("date") for r in rows if r.get("date")), None)
        result = {"ticker": ticker, "inst_pct": None, "inst_holders_count": len(holders),
                  "as_of": as_of, "top_holders": holders[:15],
                  "biggest_buyers": buyers, "biggest_sellers": sellers, "_source": "fmp"}
    else:
        yf_data = get_institutional_holders(ticker, top_n=_FALLBACK_TOP_N) or {}
        raw = yf_data.get("top_holders") or []
        if ("error" in yf_data) and not raw:
            result = dict(empty, **{"_source": "yfinance"})
        else:
            holders = [{"holder": h.get("holder"), "shares": h.get("shares"), "pct_out": h.get("pct_out"),
                        "value": h.get("value_usd") if h.get("value_usd") is not None else h.get("value"),
                        "change": None, "change_shares": None} for h in raw]
            as_of = next((h.get("date_reported") for h in raw if h.get("date_reported")), None)
            result = {"ticker": ticker, "inst_pct": yf_data.get("held_by_institutions_pct"),
                      "inst_holders_count": yf_data.get("top_holders_count") or len(holders),
                      "as_of": as_of, "top_holders": holders,
                      "biggest_buyers": [], "biggest_sellers": [], "_source": "yfinance"}

    if not debug:
        _CACHE.set(ckey, dict(result), _OWN_TTL)
    return result
