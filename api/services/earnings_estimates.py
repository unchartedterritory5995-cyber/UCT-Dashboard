"""Earnings Intelligence — Finnhub analyst consensus, EPS beat history, price targets.

Cached 6 hours per ticker via the shared TTLCache singleton.
"""

import os
import logging
import threading
import time as _time

import requests

from api.services.cache import cache
from api.services import yf_util

_logger = logging.getLogger(__name__)

_CACHE_TTL = 21_600  # 6 hours (used by get_earnings_intel)
_FRESH_TTL = 900     # 15 min — earnings-window fast path for an incomplete year
_INTEL_FAIL_TTL = 600  # 10 min — negative cache when ALL intel calls fail (429 storm damper)
_MARKERS_CACHE_TTL = 43_200  # 12 hours (used by get_chart_markers)
_TIMEOUT = 6  # seconds per Finnhub request

# ── chart-markers persistent cache ───────────────────────────────────────────
# The DEEP earnings history is immutable (past prints never change), so markers
# are persisted to the /data volume and served effectively forever: they survive
# redeploys (no cold re-fetch storm) and skip the every-12h refetch. A background
# refresh runs at most once/day to pick up a newly-reported quarter (~4x/yr).
import json as _json

_MARKERS_REFRESH_SECONDS = 24 * 3600
# Bump when the marker BUILD logic changes so stale disk copies are rebuilt instead
# of served forever. v2 = splits/dividends sourced from yfinance (were empty under
# Finnhub's premium-gated endpoints).
_MARKERS_DISK_VERSION = 2
_MARKERS_DISK_DIR = os.path.join(os.environ.get("DATA_DIR", "/data"), "chart_markers")
_markers_refresh_inflight: set[str] = set()
_markers_refresh_lock = threading.Lock()


def _markers_disk_path(ticker: str) -> str:
    return os.path.join(_MARKERS_DISK_DIR, f"{ticker.upper()}.json")


def _markers_disk_read(ticker: str):
    """Return (data, saved_at_epoch) from the /data volume, or None."""
    try:
        with open(_markers_disk_path(ticker)) as f:
            blob = _json.load(f)
        # Version gate: a pre-v2 blob has empty splits/dividends (old Finnhub
        # source) — ignore it so get_chart_markers rebuilds from yfinance.
        if int(blob.get("v") or 0) != _MARKERS_DISK_VERSION:
            return None
        data = blob.get("data")
        if isinstance(data, dict) and "earnings" in data:
            return data, float(blob.get("saved_at") or 0)
    except (FileNotFoundError, ValueError, OSError):
        pass
    return None


def _markers_disk_write(ticker: str, data: dict) -> None:
    try:
        os.makedirs(_MARKERS_DISK_DIR, exist_ok=True)
        path = _markers_disk_path(ticker)
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            _json.dump({"v": _MARKERS_DISK_VERSION, "data": data, "saved_at": _time.time()}, f)
        os.replace(tmp, path)  # atomic
    except OSError as e:
        _logger.warning("chart_markers disk write failed for %s: %s", ticker, e)


def _schedule_markers_refresh(ticker: str) -> None:
    """Rebuild the markers blob in the background (deduped) and re-persist it, so a
    newly-reported quarter is picked up without ever blocking a chart request."""
    ticker = ticker.upper()
    with _markers_refresh_lock:
        if ticker in _markers_refresh_inflight:
            return
        _markers_refresh_inflight.add(ticker)

    def _run():
        try:
            data = _build_chart_markers(ticker)
            # Don't clobber a good disk copy with an empty result on a transient
            # provider failure.
            if data and (data.get("earnings") or data.get("splits") or data.get("dividends")):
                cache.set(f"chart_markers_{ticker}", data, ttl=_MARKERS_CACHE_TTL)
                _markers_disk_write(ticker, data)
        except Exception as e:  # noqa: BLE001
            _logger.warning("chart_markers bg refresh failed for %s: %s", ticker, e)
        finally:
            with _markers_refresh_lock:
                _markers_refresh_inflight.discard(ticker)

    threading.Thread(target=_run, daemon=True, name=f"markers-refresh-{ticker}").start()


# Finnhub free tier = 60 calls/min. When a 429 lands, EVERY caller funneling
# through _fh_get backs off together for this long — without a shared cooldown
# each enrichment/markers/next-report burst keeps hammering an already-exhausted
# minute bucket, and because failures used to be uncached the storm re-fired on
# every recompute (the 2026-07-15 all-dash Beats column).
_FH_COOLDOWN_SECONDS = 20.0
_fh_cooldown_until = 0.0
_fh_cooldown_lock = threading.Lock()

# Endpoints the current Finnhub plan rejects outright (403) — e.g.
# /stock/price-target moved to premium. Re-probed daily via the cache TTL.
_FH_FORBIDDEN_TTL = 86_400

# Distinguishes "cached total failure" from a cache miss (both read back as
# None through TTLCache.get otherwise). Identity-compared, never mutated.
_INTEL_FAIL_SENTINEL = {"_intel_failed": True}


def _junk_symbol(sym) -> bool:
    """Symbols Finnhub can never resolve (index/synthetic notations like
    $IDX:SEMICONDUCTORS or ^VIX). Calling for them burns rate budget on
    guaranteed failures, every single time."""
    s = str(sym or "")
    return (not s) or any(c in s for c in ("$", "^", ":", "/"))


def _fh_get(path: str, params: dict, timeout: int | None = None) -> dict | list | None:
    """Fire a Finnhub GET request. Returns parsed JSON or None on failure.

    Budget guards (all return None without a network call):
      • symbols Finnhub can't resolve ($/^/:-style) are skipped
      • a shared 20s cooldown engages after any 429
      • endpoints that 403'd (plan-forbidden) are skipped for 24h
    """
    global _fh_cooldown_until
    api_key = os.environ.get("FINNHUB_API_KEY", "")
    if not api_key:
        _logger.warning("FINNHUB_API_KEY not set — earnings intel unavailable")
        return None
    if "symbol" in params and _junk_symbol(params.get("symbol")):
        return None
    if cache.get(f"fh_forbidden_{path}"):
        return None
    with _fh_cooldown_lock:
        if _time.monotonic() < _fh_cooldown_until:
            return None
    params["token"] = api_key
    try:
        resp = requests.get(
            f"https://finnhub.io/api/v1{path}",
            params=params,
            timeout=timeout or _TIMEOUT,
        )
        if resp.status_code == 429:
            with _fh_cooldown_lock:
                _fh_cooldown_until = _time.monotonic() + _FH_COOLDOWN_SECONDS
            _logger.warning("Finnhub 429 on %s — cooling down %ss", path, _FH_COOLDOWN_SECONDS)
            return None
        if resp.status_code == 403:
            cache.set(f"fh_forbidden_{path}", True, ttl=_FH_FORBIDDEN_TTL)
            _logger.warning("Finnhub 403 on %s — plan-forbidden, skipping for 24h", path)
            return None
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        _logger.warning("Finnhub %s failed for %s: %s", path, params.get("symbol", "?"), exc)
        return None


def get_earnings_intel(ticker: str) -> dict | None:
    """Return earnings intelligence dict for *ticker*, or None on total failure.

    Keys returned:
        beat_history  – list of last 4 quarters
                         [{period, actual, estimate, beat, surprise, quarter, year}]
                         `quarter`/`year` are Finnhub's own fiscal identifiers
                         (present on /stock/earnings) — the fiscal-quarter
                         pairing key for the implied-vs-realized hero (P2 T8b).
                         None when Finnhub omits them, never a phantom 0.
        consensus     – {buy, hold, sell, strongBuy, strongSell, period}
        price_target  – {targetHigh, targetLow, targetMean, targetMedian, lastUpdated}
    """
    ticker = ticker.upper()
    cache_key = f"earnings_intel_{ticker}"
    cached = cache.get(cache_key)
    if cached is not None:
        return None if cached is _INTEL_FAIL_SENTINEL else cached

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
                # Purely additive — carried through so the client can pair a
                # PAST quarter's history row against implied_store's snapshot
                # (keyed on the announcement date, not this period end) by
                # fiscal identity instead of by date. `_int_or_none` keeps an
                # absent value None rather than coercing it to 0.
                "quarter": _int_or_none(q.get("quarter")),
                "year": _int_or_none(q.get("year")),
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

    # If all three failed, negative-cache briefly. Uncached failures made every
    # 5-min enrichment recompute retry the whole day's reporters × 3 calls —
    # once rate-limited, the 429 storm sustained itself indefinitely.
    if not beat_history and consensus is None and price_target is None:
        cache.set(cache_key, _INTEL_FAIL_SENTINEL, ttl=_INTEL_FAIL_TTL)
        return None

    result = {
        "beat_history": beat_history,
        "consensus": consensus,
        "price_target": price_target,
    }
    # ⛔ NEVER CACHE A FAILED FETCH AS A VALUE — for 6 hours, at least.
    #
    # The negative cache above is correctly conservative: it only fires when
    # ALL THREE legs failed. But a PARTIAL failure used to land here and be
    # stored for the full `_CACHE_TTL` (6h) as though it were complete, so one
    # transient miss on the Finnhub /stock/earnings leg (while recommendation
    # and price-target both answered) pinned `beat_history: []` on that symbol
    # for six hours. Downstream that is not a blank stat — it is the earnings
    # modal's whole Earnings History section rendering "No reported quarters
    # yet" for a company that has plainly reported.
    #
    # Observed live 2026-08-04: /api/calendar/enrichment-batch returned CAT
    # with 4 quarters, then the SAME call returned 0 minutes later, while a
    # direct Finnhub /stock/earnings?symbol=CAT was HTTP 200 with 4 rows — the
    # provider was healthy the whole time and the cache was serving an empty
    # list it should never have stored. (Same class as the market-cap poison
    # already documented in this repo: a failure must not be cached as a value.)
    #
    # A partial result is still worth SERVING — dropping it would throw away
    # good consensus/price-target data — so it is returned, but it is cached
    # only for the short failure TTL so the missing leg self-heals in minutes
    # instead of hours.
    partial = (not beat_history) or consensus is None or price_target is None
    cache.set(cache_key, result, ttl=_INTEL_FAIL_TTL if partial else _CACHE_TTL)
    return result


def _int_or_none(v):
    """int(v) preserving None. A bare `int(v or 0)` would turn an absent
    quarter/year into a phantom 0 — this keeps absent distinct from a
    genuine (if implausible) 0 in both directions."""
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


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


def _fiscal_q_from_period_end(date_str):
    """(quarter, year) for a fiscal quarter identified by its PERIOD-END date,
    using the SAME calendar scheme _fiscal_q_from_report applies to report dates
    (companies report ~1 month after the period ends). This is the single source
    of truth so every source that keys a quarter — FMP (report date), Finnhub
    (period end), AlphaVantage (fiscalDateEnding), and the widget's forward
    estimates (period end) — shares ONE numbering and lands in the same slot.
    Period-end months: 12→Q4(y) · 9-11→Q3(y) · 6-8→Q2(y) · 3-5→Q1(y) ·
    1-2→Q4(y-1) (Jan/Feb-ending quarters report in Feb-Mar, e.g. NVDA/WMT)."""
    try:
        y, m = int(str(date_str)[:4]), int(str(date_str)[5:7])
    except (ValueError, TypeError, IndexError):
        return None, None
    if m >= 12:
        return 4, y
    if m >= 9:
        return 3, y
    if m >= 6:
        return 2, y
    if m >= 3:
        return 1, y
    return 4, y - 1


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
            period = str(q.get("period") or "")[:10]
            # Re-derive the fiscal (quarter, year) from the PERIOD END with the
            # shared calendar scheme rather than trusting Finnhub's raw
            # quarter/year, which use TRUE fiscal numbering — for an offset-fiscal
            # filer (AAPL/NVDA/NKE) that disagrees with FMP's calendar labeling
            # and would slot the same physical quarter under the wrong Q,
            # duplicating one quarter and dropping another during gap-fill.
            fq, fyy = _fiscal_q_from_period_end(period)
            if fq is None or fyy != int(year):
                continue
            eps_a, eps_e = q.get("actual"), q.get("estimate")
            surp = q.get("surprisePercent")
            rows.append({
                "date": period,
                "quarter": fq,
                "year": fyy,
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
    rows = []
    for q in j.get("quarterlyEarnings", []):
        fde = str(q.get("fiscalDateEnding") or "")[:10]
        # Shared period-end mapper (same scheme as FMP/Finnhub) so offset-fiscal
        # filers land in the SAME slot rather than being dropped/mislabeled.
        quarter, fy = _fiscal_q_from_period_end(fde)
        if quarter is None or fy != int(year):
            continue
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


def _year_earnings_from_yf(ticker: str, year: int) -> list:
    """Quarterly EPS + revenue (ACTUALS only — Yahoo gives no estimates for these,
    so surprise % stays blank) from yfinance's quarterly income statement. Yahoo
    covers international markets (Korea/Japan/etc.) that FMP/Finnhub/AV miss, so
    this is the fallback for foreign Model Book stocks (e.g. 005930.KS, 285A.T).
    Figures are in the listing's LOCAL currency. Period-end date → fiscal quarter
    with the same labeling as the report-date paths (a quarter ENDING Mar 2025 =
    Q1 2025). Best-effort; returns [] on any failure."""
    try:
        import math
        import yfinance as yf
    except Exception:
        return []
    try:
        qf = None
        for attr in ("quarterly_income_stmt", "quarterly_financials"):
            # Bound the Yahoo fetch so a hung response frees the worker thread.
            df = yf_util.bounded_call(lambda a=attr: getattr(yf.Ticker(ticker), a, None), None)
            if df is not None and getattr(df, "empty", True) is False:
                qf = df
                break
        if qf is None:
            return []

        def _row(names):
            for n in names:
                if n in qf.index:
                    return qf.loc[n]
            return None

        rev = _row(["Total Revenue", "TotalRevenue", "Operating Revenue", "OperatingRevenue"])
        eps = _row(["Diluted EPS", "DilutedEPS", "Basic EPS", "BasicEPS"])

        def _num(series, col):
            if series is None:
                return None
            try:
                v = series.get(col)
                if v is None:
                    return None
                fv = float(v)
                return None if math.isnan(fv) else fv
            except Exception:
                return None

        rows = []
        for col in qf.columns:
            try:
                end = col.to_pydatetime() if hasattr(col, "to_pydatetime") else col
                ey, em = int(end.year), int(end.month)
            except Exception:
                continue
            if ey != int(year):
                continue
            q = (em - 1) // 3 + 1
            eps_a = _num(eps, col)
            rev_a = _num(rev, col)
            if eps_a is None and rev_a is None:
                continue
            rows.append({
                "date": end.strftime("%Y-%m-%d"),
                "quarter": q,
                "year": ey,
                "eps_actual": eps_a,
                "eps_estimate": None,
                "eps_surprise_pct": None,
                "revenue_actual": rev_a,
                "revenue_estimate": None,
                "revenue_surprise_pct": None,
            })
        return rows
    except Exception:
        return []


def get_year_earnings(ticker: str, year: int, data_symbol: str = None, fresh: bool = False) -> list:
    """Quarterly EPS + revenue (actual vs estimate, with % surprise) for the 4
    fiscal quarters of `year`. Returns rows sorted Q1→Q4; [] on failure.

    `fresh=True` (set by the fundamentals widget inside a ticker's earnings
    window) caps an INCOMPLETE year's cache to _FRESH_TTL so a just-reported
    quarter surfaces within ~15 min instead of being pinned by the 6h cache.
    Model Book callers omit it → unchanged 6h/30d behavior.

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

    # Gather all sources for one provider symbol. AV deep-history fill is gated to
    # CLOSED years: for the in-progress year, missing quarters simply aren't
    # reported yet, so spending AV's scarce 25/day quota on it is wasteful.
    def _gather(prov):
        prov = (prov or "").upper().strip()
        if not prov:
            return
        _fill(_year_earnings_from_fmp(prov, year))
        if len(by_q) < 4:
            _fill(_year_earnings_from_stock(prov, year))
        if closed and len(by_q) < 4:
            _fill(_year_earnings_from_av(prov, year))
        # yfinance (Yahoo) covers international markets the US providers miss.
        # Only for foreign-looking symbols (suffixed/numeric) to avoid adding a
        # slow yfinance call to every US stock that merely has an FMP gap.
        if len(by_q) < 4 and ("." in prov or any(ch.isdigit() for ch in prov)):
            _fill(_year_earnings_from_yf(prov, year))

    # 1. The admin's explicit provider symbol (e.g. 005930.KS) wins; else the
    #    bare display ticker (the US-stock common case).
    _gather(data_symbol or ticker)
    # 2. Auto-suffix fallback for a non-US ticker with no explicit data_symbol:
    #    a numeric/digit-bearing symbol (005930, 000660, 285A) has no data under
    #    its bare form, so try the common exchange suffixes until one resolves.
    if not by_q and not data_symbol and any(ch.isdigit() for ch in ticker):
        for suf in (".KS", ".KQ", ".T", ".TW", ".HK", ".L", ".SS", ".SZ"):
            _gather(ticker + suf)
            if by_q:
                break

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
    if fresh and not complete:
        # In an earnings window: don't let a stale 6h entry hide a quarter that
        # just reported — freshen the incomplete year every 15 min.
        ttl = min(ttl, _FRESH_TTL)
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

    # Disk layer — deep history is immutable, so serve the persisted copy
    # effectively forever (survives redeploys; no 12h refetch). Stale-while-
    # revalidate: serve instantly + background-refresh only if it has aged out.
    disk = _markers_disk_read(ticker)
    if disk is not None:
        data, saved_at = disk
        cache.set(cache_key, data, ttl=_MARKERS_CACHE_TTL)
        if _time.time() - saved_at > _MARKERS_REFRESH_SECONDS:
            _schedule_markers_refresh(ticker)
        return data

    result = _build_chart_markers(ticker)
    cache.set(cache_key, result, ttl=_MARKERS_CACHE_TTL)
    _markers_disk_write(ticker, result)
    return result


def _ts_date(ts) -> str | None:
    """A pandas Timestamp / date → 'YYYY-MM-DD' (None on failure)."""
    try:
        if hasattr(ts, "date"):
            return ts.date().strftime("%Y-%m-%d")
        return str(ts)[:10]
    except Exception:
        return None


def _yf_corporate_actions(ticker: str):
    """Return (splits, dividends) as lists of (YYYY-MM-DD, value) tuples from
    yfinance's corporate-action series — split ratio float / dividend amount.
    Network-bound: call via yf_util.bounded_call. Returns ([], []) if empty."""
    import yfinance as yf
    t = yf.Ticker(ticker)

    def _pairs(series):
        out = []
        if series is None or getattr(series, "empty", True):
            return out
        for ts, val in series.items():
            ds = _ts_date(ts)
            if ds is not None:
                out.append((ds, val))
        return out

    return _pairs(t.splits), _pairs(t.dividends)


def _build_chart_markers(ticker: str) -> dict:
    """Fetch + assemble the markers blob (earnings history + fiscal-quarter join +
    splits + dividends). Wrapped by get_chart_markers' memory + disk cache layers.
    Best-effort — each section is independently guarded and never raises."""
    result = {"earnings": [], "splits": [], "dividends": []}

    from datetime import date, timedelta
    today = date.today()
    # 5-year lookback covers the 2-year default request comfortably and lets a
    # single cache entry serve longer-range chart views too.
    from_date = (today - timedelta(days=365 * 5)).strftime("%Y-%m-%d")
    to_date   = today.strftime("%Y-%m-%d")
    # Splits are rare AND highly relevant on a since-inception chart, so look back
    # far (unlike dividends, which would clutter the chart with 100+ ex-dates).
    splits_from_date = (today - timedelta(days=365 * 45)).strftime("%Y-%m-%d")

    # ── Earnings history (EPS + revenue) ──────────────────────────────────────
    # FMP `stable/earnings` is primary: it carries EPS AND revenue AND the report
    # date in one call, so each marker gets full data (the click-popup shows EPS +
    # revenue) and lands on the day the stock actually moved on the print. Finnhub
    # `/stock/earnings` (EPS only, keyed to the fiscal period-end) is the fallback
    # when FMP has nothing. Dedup by report date, preferring the estimate-bearing
    # row (FMP occasionally carries a consensus row + an alternate for one report).
    try:
        # limit 400 ≈ full available history (FMP returns newest-first) so markers
        # go back as far as the provider has data — matches the since-inception
        # chart history. Future estimate rows (epsActual=None) are skipped below.
        fmp_rows = _fmp_get("/stable/earnings", {"symbol": ticker, "limit": 400})
        best_by_date = {}
        if isinstance(fmp_rows, list):
            for q in fmp_rows:
                ds = str(q.get("date") or "")[:10]
                if not ds:
                    continue
                eps_a, eps_e = q.get("epsActual"), q.get("epsEstimated")
                rev_a, rev_e = q.get("revenueActual"), q.get("revenueEstimated")
                if eps_a is None and rev_a is None:
                    continue  # upcoming quarter — nothing reported yet
                beat = bool(eps_a >= eps_e) if (eps_a is not None and eps_e is not None) else None
                row = {
                    "date": ds,
                    "beat": beat,
                    "surprise": _surprise_pct(eps_a, eps_e),
                    "eps_actual": eps_a,
                    "eps_estimate": eps_e,
                    "eps_surprise_pct": _surprise_pct(eps_a, eps_e),
                    "revenue_actual": rev_a,
                    "revenue_estimate": rev_e,
                    "revenue_surprise_pct": _surprise_pct(rev_a, rev_e),
                }
                prev = best_by_date.get(ds)
                if prev is None or (row["eps_estimate"] is not None and prev.get("eps_estimate") is None):
                    best_by_date[ds] = row
        if best_by_date:
            result["earnings"] = list(best_by_date.values())
        else:
            # Fallback: Finnhub EPS-only (no revenue) when FMP has nothing.
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
                        "eps_surprise_pct": q.get("surprisePercent"),
                        "revenue_actual": None,
                        "revenue_estimate": None,
                        "revenue_surprise_pct": None,
                    })
    except Exception as exc:
        _logger.warning("get_chart_markers earnings failed for %s: %s", ticker, exc)

    # ── Accurate fiscal quarter/year per report ───────────────────────────────
    # FMP `stable/earnings` carries NO fiscal period, and a calendar mapping is
    # WRONG for off-cycle fiscal years (e.g. MU's Aug year-end: its Sep print is
    # fiscal Q4, not the naive "Q2"). `earning-call-transcript-dates` carries the
    # real {quarter, fiscalYear} keyed to the call/report date — join it to the
    # markers by report date. Best-effort: markers still render (just without a
    # quarter label) if this source is unavailable for the ticker.
    if result["earnings"]:
        try:
            def _coerce_q(q):
                if isinstance(q, (int, float)):
                    return int(q)
                s = str(q or "").upper().strip().lstrip("Q")
                return int(s) if s.isdigit() else None

            td = _fmp_get("/stable/earning-call-transcript-dates", {"symbol": ticker})
            qmap = {}
            if isinstance(td, list):
                for t in td:
                    ds = str(t.get("date") or "")[:10]
                    q = _coerce_q(t.get("quarter"))
                    fy = t.get("fiscalYear")
                    if ds and q is not None and fy is not None:
                        try:
                            qmap[ds] = (q, int(fy))
                        except (TypeError, ValueError):
                            pass
            if qmap:
                q_dates = sorted(qmap)
                for row in result["earnings"]:
                    rd = row.get("date")
                    if not rd:
                        continue
                    hit = qmap.get(rd)
                    if hit is None:
                        # Report date vs call date can differ by a day or two —
                        # fall back to the nearest transcript date within 5 days.
                        try:
                            rdt = date.fromisoformat(rd)
                            best_gap = 6
                            for qd in q_dates:
                                gap = abs((date.fromisoformat(qd) - rdt).days)
                                if gap < best_gap:
                                    best_gap, hit = gap, qmap[qd]
                        except (ValueError, TypeError):
                            hit = None
                    if hit:
                        row["fiscal_quarter"], row["fiscal_year"] = hit
        except Exception as exc:
            _logger.warning("get_chart_markers quarter-join failed for %s: %s", ticker, exc)

    # ── Stock splits + dividends (yfinance corporate actions) ─────────────────
    # Finnhub's /stock/split + /stock/dividend are premium and return empty on
    # this tier, so the toggles rendered nothing. yfinance's actions series carry
    # full split-adjusted history and cost nothing — the same source
    # dividends_calendar.py uses. One bounded fetch feeds both.
    try:
        from api.services.yf_util import bounded_call
        yf_splits, yf_divs = bounded_call(lambda: _yf_corporate_actions(ticker), ([], []), timeout=12.0)

        # Splits — deep lookback (rare + highly relevant on a since-inception chart).
        for date_str, ratio_val in yf_splits:
            if not date_str or date_str < splits_from_date:
                continue
            try:
                r = float(ratio_val)
            except (TypeError, ValueError):
                continue
            if r <= 0:
                continue
            # yfinance ratio is a float: 4.0 = 4-for-1, 0.5 = 1-for-2 reverse.
            if r >= 1:
                ratio_str = f"{int(r)}:1" if r == int(r) else f"{round(r, 2)}:1"
            else:
                inv = 1.0 / r
                ratio_str = f"1:{int(inv)}" if inv == int(inv) else f"1:{round(inv, 2)}"
            result["splits"].append({
                "date": date_str,
                "ratio": ratio_str,
                "from_factor": 1,
                "to_factor": r,
            })

        # Dividends — 5-year lookback (a full history would clutter with 100+ ex-dates).
        for date_str, amount in yf_divs:
            if not date_str or date_str < from_date:
                continue
            try:
                amount_f = float(amount)
            except (TypeError, ValueError):
                continue
            if amount_f <= 0:
                continue
            result["dividends"].append({
                "date": date_str,
                "amount": amount_f,
            })
    except Exception as exc:
        _logger.warning("get_chart_markers splits/dividends failed for %s: %s", ticker, exc)

    return result
