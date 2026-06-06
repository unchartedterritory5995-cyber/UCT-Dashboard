"""Earnings Intelligence — Finnhub analyst consensus, EPS beat history, price targets.

Cached 6 hours per ticker via the shared TTLCache singleton.
"""

import os
import logging
import requests

from api.services.cache import cache

_logger = logging.getLogger(__name__)

_CACHE_TTL = 21_600  # 6 hours (used by get_earnings_intel)
_MARKERS_CACHE_TTL = 43_200  # 12 hours (used by get_chart_markers)
_TIMEOUT = 6  # seconds per Finnhub request


def _fh_get(path: str, params: dict, timeout: int | None = None) -> dict | list | None:
    """Fire a Finnhub GET request. Returns parsed JSON or None on failure."""
    api_key = os.environ.get("FINNHUB_API_KEY", "")
    if not api_key:
        _logger.warning("FINNHUB_API_KEY not set — earnings intel unavailable")
        return None
    params["token"] = api_key
    try:
        resp = requests.get(
            f"https://finnhub.io/api/v1{path}",
            params=params,
            timeout=timeout or _TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        _logger.warning("Finnhub %s failed for %s: %s", path, params.get("symbol", "?"), exc)
        return None


def get_earnings_intel(ticker: str) -> dict | None:
    """Return earnings intelligence dict for *ticker*, or None on total failure.

    Keys returned:
        beat_history  – list of last 4 quarters [{period, actual, estimate, beat}]
        consensus     – {buy, hold, sell, strongBuy, strongSell, period}
        price_target  – {targetHigh, targetLow, targetMean, targetMedian, lastUpdated}
    """
    ticker = ticker.upper()
    cache_key = f"earnings_intel_{ticker}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    # ── 1. Historical EPS (last 4 quarters) ─────────────────────────────────
    beat_history = []
    eps_raw = _fh_get("/stock/earnings", {"symbol": ticker, "limit": 4})
    if isinstance(eps_raw, list):
        for q in eps_raw:
            actual = q.get("actual")
            estimate = q.get("estimate")
            beat = None
            if actual is not None and estimate is not None:
                beat = actual >= estimate
            beat_history.append({
                "period": q.get("period", ""),
                "actual": actual,
                "estimate": estimate,
                "beat": beat,
                "surprise": q.get("surprisePercent"),
            })

    # ── 2. Analyst recommendation consensus ──────────────────────────────────
    consensus = None
    rec_raw = _fh_get("/stock/recommendation", {"symbol": ticker})
    if isinstance(rec_raw, list) and rec_raw:
        latest = rec_raw[0]  # most recent month
        consensus = {
            "buy": latest.get("buy", 0),
            "hold": latest.get("hold", 0),
            "sell": latest.get("sell", 0),
            "strongBuy": latest.get("strongBuy", 0),
            "strongSell": latest.get("strongSell", 0),
            "period": latest.get("period", ""),
        }

    # ── 3. Price target ──────────────────────────────────────────────────────
    price_target = None
    pt_raw = _fh_get("/stock/price-target", {"symbol": ticker})
    if isinstance(pt_raw, dict) and pt_raw.get("targetMean") is not None:
        price_target = {
            "targetHigh": pt_raw.get("targetHigh"),
            "targetLow": pt_raw.get("targetLow"),
            "targetMean": pt_raw.get("targetMean"),
            "targetMedian": pt_raw.get("targetMedian"),
            "lastUpdated": pt_raw.get("lastUpdated", ""),
        }

    # If all three failed, return None (don't cache failures long)
    if not beat_history and consensus is None and price_target is None:
        return None

    result = {
        "beat_history": beat_history,
        "consensus": consensus,
        "price_target": price_target,
    }
    cache.set(cache_key, result, ttl=_CACHE_TTL)
    return result


def _surprise_pct(actual, estimate):
    """% surprise of actual vs estimate = (actual - estimate) / |estimate| * 100.
    None when either side is missing or the estimate is zero."""
    try:
        a = float(actual)
        e = float(estimate)
    except (TypeError, ValueError):
        return None
    if e == 0:
        return None
    return round((a - e) / abs(e) * 100, 1)


def _fmp_get(path: str, params: dict, timeout: int = 10):
    """Fire a Financial Modeling Prep GET. Returns parsed JSON or None on failure."""
    key = os.environ.get("FMP_API_KEY", "")
    if not key:
        return None
    params["apikey"] = key
    try:
        r = requests.get(f"https://financialmodelingprep.com{path}", params=params, timeout=timeout)
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        _logger.warning("FMP %s failed for %s: %s", path, params.get("symbol", "?"), exc)
        return None


def _fiscal_q_from_report(date_str: str):
    """(quarter, fiscal_year) for a report ANNOUNCED on date_str, assuming a
    calendar fiscal year — companies report ~1-2 months after the quarter ends:
      Jan-Mar → Q4 of (year-1) · Apr-Jun → Q1 · Jul-Sep → Q2 · Oct-Dec → Q3.
    Lets us label rows Q1-Q4 of the book year from just the report date."""
    try:
        y, m = int(date_str[:4]), int(date_str[5:7])
    except (ValueError, TypeError):
        return None, None
    if m <= 3:
        return 4, y - 1
    if m <= 6:
        return 1, y
    if m <= 9:
        return 2, y
    return 3, y


def _history_limit(year: int, per_year: int = 4, headroom: int = 16, cap: int = 400) -> int:
    """How many of the MOST-RECENT reports to pull to reach back to `year`.

    `stable/earnings` returns the newest reports first, so a fixed limit only
    covers recent years — an older book year falls off the end (e.g. limit=40 ≈
    10y reached only Q3/Q4 2016 when viewed in 2026, dropping Q1/Q2). Scale the
    limit to the gap between now and the book year (+headroom for FMP's duplicate
    rows and future estimate rows), bounded by `cap`."""
    from datetime import datetime, timezone
    cur_y = datetime.now(timezone.utc).year
    span = max(2, cur_y - int(year) + 2)  # +2: Q4 reports land in year+1
    return min(cap, span * per_year + headroom)


def _year_earnings_from_fmp(ticker: str, year: int) -> list:
    """All 4 FISCAL quarters of `year` for `ticker` (EPS + revenue) from FMP's
    `stable/earnings` (the one FMP earnings endpoint still live on this plan;
    the legacy v3 ones 403 after Aug-2025). One symbol-specific call. The report
    date maps to a fiscal quarter via `_fiscal_q_from_report`.

    FMP sometimes carries TWO rows for the same report (e.g. SNDK 2025-11-06 has
    a consensus-tracked row + an alternate figure with no estimate), which would
    otherwise show as a duplicate quarter — so we dedup by (year, quarter),
    keeping the row that has a real surprise (estimate present), else the latest."""
    data = _fmp_get("/stable/earnings", {"symbol": ticker, "limit": _history_limit(year)})
    if not isinstance(data, list):
        return []
    best = {}
    for q in data:
        ds = str(q.get("date") or "")[:10]
        fq, fy = _fiscal_q_from_report(ds)
        if fy != int(year):
            continue
        eps_a, eps_e = q.get("epsActual"), q.get("epsEstimated")
        rev_a, rev_e = q.get("revenueActual"), q.get("revenueEstimated")
        if eps_a is None and rev_a is None:
            continue  # upcoming quarter, nothing reported yet
        row = {
            "date": ds,
            "quarter": fq,
            "year": fy,
            "eps_actual": eps_a,
            "eps_estimate": eps_e,
            "eps_surprise_pct": _surprise_pct(eps_a, eps_e),
            "revenue_actual": rev_a,
            "revenue_estimate": rev_e,
            "revenue_surprise_pct": _surprise_pct(rev_a, rev_e),
        }
        prev = best.get((fy, fq))
        if prev is None or _earn_row_preferred(row, prev):
            best[(fy, fq)] = row
    return list(best.values())


def _earn_row_preferred(new: dict, old: dict) -> bool:
    """Tie-break two reports landing in the same fiscal quarter: the one with a
    real EPS surprise (estimate present) wins; otherwise the later report date."""
    new_has = new.get("eps_surprise_pct") is not None
    old_has = old.get("eps_surprise_pct") is not None
    if new_has != old_has:
        return new_has
    return (new.get("date") or "") > (old.get("date") or "")


def _year_earnings_from_stock(ticker: str, year: int) -> list:
    """EPS-only history from Finnhub /stock/earnings (no revenue, but reliable on
    every Finnhub tier). Keeps the FISCAL quarters of `year`. Used as a gap-fill in
    get_year_earnings to populate quarters FMP is missing."""
    rows = []
    eps_raw = _fh_get("/stock/earnings", {"symbol": ticker, "limit": _history_limit(year)})
    if isinstance(eps_raw, list):
        for q in eps_raw:
            fy = q.get("year")
            period = str(q.get("period") or "")[:10]
            in_year = (str(fy) == str(year)) if fy is not None else period.startswith(str(year))
            if not in_year:
                continue
            eps_a, eps_e = q.get("actual"), q.get("estimate")
            surp = q.get("surprisePercent")
            rows.append({
                "date": period,
                "quarter": q.get("quarter"),
                "year": fy if fy is not None else int(year),
                "eps_actual": eps_a,
                "eps_estimate": eps_e,
                "eps_surprise_pct": round(float(surp), 1) if surp is not None else _surprise_pct(eps_a, eps_e),
                "revenue_actual": None,
                "revenue_estimate": None,
                "revenue_surprise_pct": None,
            })
    return rows


def _av_num(v):
    """Parse an AlphaVantage numeric string ('5.73', 'None', '') → float or None."""
    try:
        if v is None or str(v).strip().lower() in ("", "none", "-"):
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _year_earnings_from_av(ticker: str, year: int) -> list:
    """EPS-only quarters of `year` from AlphaVantage `EARNINGS` — the deepest FREE
    historical source (covers years/ADRs that FMP `stable/earnings` and Finnhub
    lack, e.g. JKS/VIPS 2013). Quarter is taken from `fiscalDateEnding` (authoritative
    period end), not a report-date heuristic. Best-effort: returns [] on any
    failure OR an AV rate-limit Note/Information response (free tier = 25/day)."""
    key = os.environ.get("ALPHAVANTAGE_API_KEY", "")
    if not key:
        return []
    try:
        r = requests.get(
            "https://www.alphavantage.co/query",
            params={"function": "EARNINGS", "symbol": ticker, "apikey": key},
            timeout=12,
        )
        r.raise_for_status()
        j = r.json()
    except Exception as exc:
        _logger.info("AV EARNINGS failed for %s: %s", ticker, exc)
        return []
    if not isinstance(j, dict) or "quarterlyEarnings" not in j:
        # {"Note": ...} / {"Information": ...} (throttled) or {"Error Message": ...}.
        return []
    q_by_month = {3: 1, 6: 2, 9: 3, 12: 4}  # calendar-fiscal quarter end → Q#
    rows = []
    for q in j.get("quarterlyEarnings", []):
        fde = str(q.get("fiscalDateEnding") or "")[:10]
        try:
            fy, fm = int(fde[:4]), int(fde[5:7])
        except (ValueError, IndexError):
            continue
        if fy != int(year):
            continue
        quarter = q_by_month.get(fm)
        if not quarter:
            continue  # off-calendar period end — skip rather than mislabel
        eps_a, eps_e = _av_num(q.get("reportedEPS")), _av_num(q.get("estimatedEPS"))
        surp = _av_num(q.get("surprisePercentage"))
        rows.append({
            "date": str(q.get("reportedDate") or fde)[:10],
            "quarter": quarter,
            "year": fy,
            "eps_actual": eps_a,
            "eps_estimate": eps_e,
            "eps_surprise_pct": round(surp, 1) if surp is not None else _surprise_pct(eps_a, eps_e),
            "revenue_actual": None,
            "revenue_estimate": None,
            "revenue_surprise_pct": None,
        })
    return rows


def get_year_earnings(ticker: str, year: int) -> list:
    """Quarterly EPS + revenue (actual vs estimate, with % surprise) for the 4
    fiscal quarters of `year`. Returns rows sorted Q1→Q4; [] on failure.

    MERGES sources by fiscal quarter to maximize coverage (FMP often has GAPS for
    older years / ADRs — e.g. only Q1 2013 for JKS — and the old all-or-nothing
    fallback never filled them):
      1. FMP `stable/earnings` — EPS + revenue (richest; the only one with revenue).
      2. Finnhub `/stock/earnings` — EPS only — fills quarters FMP is missing.
      3. AlphaVantage `EARNINGS` — EPS only, deepest free history — fills the rest.
    Each fill only populates quarters still empty, so FMP's revenue is never lost.
    Cached per (ticker, year): a closed year that came back COMPLETE (all 4 quarters)
    caches for weeks; an incomplete one caches briefly so it retries (e.g. once an
    AV rate-limit clears) until it fills."""
    ticker = ticker.upper()
    ckey = f"mb_year_earnings_{ticker}_{int(year)}"
    cached = cache.get(ckey)
    if cached is not None:
        return cached

    from datetime import datetime, timezone
    closed = int(year) < datetime.now(timezone.utc).year
    by_q: dict[int, dict] = {}

    def _fill(rows):
        for r in rows:
            q = r.get("quarter")
            try:
                q = int(q) if q is not None else None
            except (TypeError, ValueError):
                q = None
            if q in (1, 2, 3, 4) and q not in by_q:
                r["quarter"] = q
                by_q[q] = r

    _fill(_year_earnings_from_fmp(ticker, year))
    if len(by_q) < 4:
        _fill(_year_earnings_from_stock(ticker, year))
    # AV deep-history fill is gated to CLOSED years: for the in-progress year,
    # missing quarters are simply not reported yet, so spending AV's scarce 25/day
    # quota (shared with the news feed) on it would be wasteful and pointless.
    if closed and len(by_q) < 4:
        _fill(_year_earnings_from_av(ticker, year))

    if not by_q:
        return []  # no earnings at all for this stock/year — no table; don't cache

    # Always present ALL FOUR quarters Q1→Q4: fill the ones a report exists for,
    # placeholder ("—") the rest. Semi-annual filers (e.g. SBSW and many foreign
    # ADRs) only report H1/H2, so Q1/Q3 genuinely have no data and read "—"
    # rather than silently dropping to a 2-row table.
    def _empty_q(q):
        return {
            "date": None, "quarter": q, "year": int(year),
            "eps_actual": None, "eps_estimate": None, "eps_surprise_pct": None,
            "revenue_actual": None, "revenue_estimate": None, "revenue_surprise_pct": None,
        }
    full = [by_q.get(q) or _empty_q(q) for q in (1, 2, 3, 4)]
    real_count = len(by_q)
    if real_count < 4:
        _logger.info("get_year_earnings %s %s: %d/4 quarters had a report (rest shown as —)",
                     ticker, year, real_count)

    # Long cache ONLY for a closed year whose 4 quarters are all REAL (static). An
    # incomplete year gets the short TTL so it re-attempts the fill sources later
    # (e.g. once an AV rate-limit clears, or a semi-annual filer's H2 report lands).
    complete = real_count >= 4
    ttl = 30 * 86400 if (closed and complete) else _CACHE_TTL
    cache.set(ckey, full, ttl=ttl)
    return full


def get_chart_markers(ticker: str) -> dict:
    """Return earnings, stock splits, and dividends for chart annotation.

    Returns:
        {
          "earnings":  [{"date": "2024-11-01", "beat": true, "surprise": 3.2,
                         "eps_actual": 1.5, "eps_estimate": 1.4}, ...],
          "splits":    [{"date": "2020-08-28", "ratio": "4:1",
                         "from_factor": 1, "to_factor": 4}, ...],
          "dividends": [{"date": "2026-03-15", "amount": 0.85}, ...]
        }
    Each section is independently wrapped in try/except — a failing source
    returns an empty list for that section but doesn't fail the whole call.
    Cached 12 h per ticker. Never raises.
    """
    ticker = ticker.upper()
    cache_key = f"chart_markers_{ticker}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    result = {"earnings": [], "splits": [], "dividends": []}

    from datetime import date, timedelta
    today = date.today()
    # 5-year lookback covers the 2-year default request comfortably and lets a
    # single cache entry serve longer-range chart views too.
    from_date = (today - timedelta(days=365 * 5)).strftime("%Y-%m-%d")
    to_date   = today.strftime("%Y-%m-%d")

    # ── Earnings history (last 16 quarters ≈ 4 years) ─────────────────────────
    try:
        eps_raw = _fh_get("/stock/earnings", {"symbol": ticker, "limit": 16})
        if isinstance(eps_raw, list):
            for q in eps_raw:
                date_str = q.get("period") or q.get("date") or q.get("reportDate")
                if not date_str:
                    continue
                actual   = q.get("actual")
                estimate = q.get("estimate")
                beat = bool(actual >= estimate) if (actual is not None and estimate is not None) else None
                result["earnings"].append({
                    "date": str(date_str)[:10],
                    "beat": beat,
                    "surprise": q.get("surprisePercent"),
                    "eps_actual": actual,
                    "eps_estimate": estimate,
                })
    except Exception as exc:
        _logger.warning("get_chart_markers earnings failed for %s: %s", ticker, exc)

    # ── Stock splits (last 5 years) ──────────────────────────────────────────
    try:
        splits_raw = _fh_get("/stock/split", {"symbol": ticker, "from": from_date, "to": to_date})
        if isinstance(splits_raw, list):
            for s in splits_raw:
                date_str = s.get("date")
                from_f   = s.get("fromFactor", 1)
                to_f     = s.get("toFactor", 1)
                if date_str:
                    result["splits"].append({
                        "date": str(date_str)[:10],
                        "ratio": f"{from_f}:{to_f}",
                        "from_factor": from_f,
                        "to_factor": to_f,
                    })
    except Exception as exc:
        _logger.warning("get_chart_markers splits failed for %s: %s", ticker, exc)

    # ── Dividends (last 5 years) ─────────────────────────────────────────────
    try:
        div_raw = _fh_get(
            "/stock/dividend",
            {"symbol": ticker, "from": from_date, "to": to_date},
        )
        if isinstance(div_raw, list):
            for d in div_raw:
                # Finnhub returns ex-date in "date" and amount in "amount".
                date_str = d.get("date") or d.get("payDate") or d.get("recordDate")
                amount   = d.get("amount") or d.get("dividend")
                if date_str is None or amount is None:
                    continue
                try:
                    amount_f = float(amount)
                except (TypeError, ValueError):
                    continue
                result["dividends"].append({
                    "date": str(date_str)[:10],
                    "amount": amount_f,
                })
    except Exception as exc:
        _logger.warning("get_chart_markers dividends failed for %s: %s", ticker, exc)

    cache.set(cache_key, result, ttl=_MARKERS_CACHE_TTL)
    return result
