"""Dossier widget orchestrator for ONE symbol.

Assembles a per-stock "dossier" for the CURRENT (YTD) year, reusing the Model
Book's own data generation:

  1. STATS — three YTD numbers, computed from this year's daily bars and
     short-cached so they track the developing daily bar (end-of-day real-time):
       • ytd_gain_pct   = (latest close − year open) / year open × 100
       • range_pct+dir  = on an UP year, the low→high run (+); on a DOWN year, the
                          high→low decline (−). (Same low/high extremes the Model
                          Book uses, framed by year direction per the owner ask.)
       • avg_dollar_vol = mean of (volume × close) over the year
  2. EARNINGS — the last 4 REPORTED quarters (rolling across calendar years), same
     row shape as the Model Book earnings table (earnings_estimates.get_year_earnings).
  3. PROFILE — company description + this-year thematic narrative (run_story) +
     sector/industry, generated ONCE per (symbol, year) via the Model Book's
     _generate_descriptions, cached in store and refreshed periodically.

No per-view LLM call — the profile is generated on a background thread the first
time a ticker is viewed (generate-once + daily cap), exactly like News & Catalysts.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from datetime import datetime, timezone

from api.services.cache import cache
from api.services.stock_brief import store

_logger = logging.getLogger(__name__)

_MODEL = os.environ.get("STOCK_BRIEF_LLM_MODEL") or os.environ.get("MODELBOOK_LLM_MODEL", "claude-sonnet-4-6")
_STATS_TTL = int(os.environ.get("STOCK_BRIEF_STATS_TTL", "120") or 120)      # ~2 min → develops through the day
_EARN_TTL = int(os.environ.get("STOCK_BRIEF_EARN_TTL", "900") or 900)        # 15 min
_RETRY_AFTER = int(os.environ.get("STOCK_BRIEF_RETRY_AFTER", "3600") or 3600)            # retry a FAILED gen after ~1h (self-heals once the API is funded again)
# Re-research the company description + thematic narrative ~monthly so the story
# stays current with the year's drivers (a lot changes in a year), WITHOUT paying
# per view. This is the ONLY recurring LLM cost — one call per stock per month.
_REFRESH_AFTER = int(os.environ.get("STOCK_BRIEF_REFRESH_AFTER", str(30 * 86400)))       # re-gen the profile every ~30 days
_DAILY_CAP = int(os.environ.get("STOCK_BRIEF_DAILY_CAP", "300") or 300)      # generations/day (per process)

# Single-process generate-once dedupe + daily cap (matches the one-uvicorn web pod
# assumption — see CLAUDE.md single-process invariants; mirrors news_catalysts).
_gen_lock = threading.Lock()
_generating: set[str] = set()
_gen_day: str | None = None
_gen_count = 0


def _enabled() -> bool:
    return os.environ.get("STOCK_BRIEF_ENABLED", "1") == "1"


def _year() -> int:
    return datetime.now(timezone.utc).year


def _period(year: int) -> str:
    return f"y{year}"


# ── Stats ────────────────────────────────────────────────────────────────────

def _year_bars(sym: str, year: int) -> list:
    """This-year daily bars via the in-process bars path (same one the Model Book
    + News widget use). Filtered to the calendar year by the ISO date prefix."""
    try:
        from api.services import bars_fetch
        resp = bars_fetch._get_bars_inner(sym, "D", 5000)
        body = getattr(resp, "body", None)
        data = json.loads(body) if body is not None else (resp if isinstance(resp, dict) else {})
        ystr = str(year)
        yb = [b for b in data.get("bars", []) if str(b.get("t", "")).startswith(ystr)]
        yb.sort(key=lambda b: b.get("t", ""))
        return yb
    except Exception as exc:
        _logger.warning("stock_brief bars fetch failed for %s: %s", sym, exc)
        return []


def _compute_stats(sym: str) -> dict:
    ck = f"brief_stats_{sym}"
    cached = cache.get(ck)
    if cached is not None:
        return cached

    stats = {"ytd_gain_pct": None, "range_pct": None, "range_dir": None, "avg_dollar_vol": None}
    try:
        yb = _year_bars(sym, _year())
        if yb:
            o = yb[0].get("o")
            c = yb[-1].get("c")
            lows = [b["l"] for b in yb if b.get("l") is not None]
            highs = [b["h"] for b in yb if b.get("h") is not None]
            dvols = [b["v"] * b["c"] for b in yb if b.get("v") is not None and b.get("c") is not None]
            if o and c is not None:
                gain = round((c - o) / o * 100, 1)
                stats["ytd_gain_pct"] = gain
                if lows and highs:
                    lo, hi = min(lows), max(highs)
                    if gain >= 0 and lo:
                        # Up on the year → the low→high run (positive).
                        stats["range_pct"] = round((hi - lo) / lo * 100, 1)
                        stats["range_dir"] = "up"
                    elif hi:
                        # Down on the year → the high→low decline (negative).
                        stats["range_pct"] = round((lo - hi) / hi * 100, 1)
                        stats["range_dir"] = "down"
            if dvols:
                stats["avg_dollar_vol"] = round(sum(dvols) / len(dvols))
    except Exception as exc:
        _logger.warning("stock_brief stats failed for %s: %s", sym, exc)

    cache.set(ck, stats, ttl=_STATS_TTL)
    return stats


# ── Earnings (rolling last 4 reported) ───────────────────────────────────────

def _earnings(sym: str) -> list:
    """The last 4 REPORTED quarters, from the SAME source as the chart's earnings
    markers (earnings_estimates.get_chart_markers) so the table matches the on-chart
    marker popups exactly — including MU-style off-cycle fiscal quarters. Each row
    carries the EPS/revenue actuals + the surprise-vs-estimate %."""
    ck = f"brief_earn_{sym}"
    cached = cache.get(ck)
    if cached is not None:
        return cached

    rows = []
    try:
        from datetime import date as _date
        from api.services import earnings_estimates
        markers = earnings_estimates.get_chart_markers(sym) or {}
        reported = [e for e in (markers.get("earnings") or [])
                    if e.get("eps_actual") is not None and e.get("date")]
        reported.sort(key=lambda e: e.get("date") or "")
        for e in reported[-4:]:
            q, y = e.get("fiscal_quarter"), e.get("fiscal_year")
            if q is None or y is None:
                # Fall back to a calendar quarter when the fiscal join is missing.
                try:
                    dd = _date.fromisoformat(str(e.get("date"))[:10])
                    y = y or dd.year
                    q = q or ((dd.month - 1) // 3 + 1)
                except Exception:
                    pass
            rows.append({
                "date": e.get("date"),
                "quarter": q,
                "year": y,
                "eps_actual": e.get("eps_actual"),
                "eps_surprise_pct": e.get("eps_surprise_pct"),
                "revenue_actual": e.get("revenue_actual"),
                "revenue_surprise_pct": e.get("revenue_surprise_pct"),
            })
    except Exception as exc:
        _logger.warning("stock_brief earnings failed for %s: %s", sym, exc)

    cache.set(ck, rows, ttl=_EARN_TTL)
    return rows


def _company_name(sym: str) -> str | None:
    """Display company name for the header (same source as the chart watermark)."""
    try:
        from api.services import ticker_meta
        return (ticker_meta.get_ticker_meta(sym) or {}).get("name") or None
    except Exception:
        return None


# ── Profile (company description + YTD thematic narrative) ────────────────────

def _cost_ok() -> bool:
    global _gen_day, _gen_count
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    with _gen_lock:
        if _gen_day != today:
            _gen_day, _gen_count = today, 0
        if _DAILY_CAP > 0 and _gen_count >= _DAILY_CAP:
            return False
        _gen_count += 1
        return True


def _generate_and_store(sym: str) -> None:
    sym = sym.upper()
    year = _year()
    period = _period(year)
    try:
        if not _enabled():
            return
        if not _cost_ok():
            store.mark_attempt(sym, period)
            return
        # Reuse the Model Book's exact generator: company_desc + run_story (the
        # per-stock "why it moved this year" narrative) + sector/industry, grounded
        # on the YTD gain so the narrative fits the current year's move.
        gain = (_compute_stats(sym) or {}).get("ytd_gain_pct")
        from api.routers import modelbook
        res = modelbook._generate_descriptions(sym, None, year, gain)
        if res and (res.get("company_desc") or res.get("run_story")):
            store.save_profile(sym, period, res)
            _logger.info("stock_brief profile generated for %s", sym)
        else:
            # Empty/None → the Model Book generator returned nothing (commonly the
            # shared Anthropic client failing, e.g. an out-of-credits 400). Mark the
            # attempt so we retry after the cooldown once the API is funded again.
            store.mark_attempt(sym, period)
            _logger.warning("stock_brief profile generation returned nothing for %s "
                            "(Anthropic call failed or empty — will retry after cooldown)", sym)
    except Exception as exc:
        _logger.warning("stock_brief profile generation failed for %s: %s", sym, exc)
        try:
            store.mark_attempt(sym, period)
        except Exception:
            pass


def _gen_async(sym: str) -> None:
    sym = sym.upper()
    with _gen_lock:
        if sym in _generating:
            return
        _generating.add(sym)

    def _run():
        try:
            _generate_and_store(sym)
        finally:
            with _gen_lock:
                _generating.discard(sym)

    threading.Thread(target=_run, name=f"brief-{sym}", daemon=True).start()


# ── Endpoint payload ─────────────────────────────────────────────────────────

def brief(sym: str) -> dict:
    sym = (sym or "").upper()
    now = int(time.time())
    if not sym:
        return {"symbol": sym, "status": "ready", "stats": {}, "earnings": [],
                "profile": {}, "generated_at": now}

    year = _year()
    period = _period(year)
    status = "ready"
    if _enabled() and store.needs_generation(sym, period, _RETRY_AFTER, _REFRESH_AFTER):
        _gen_async(sym)
        # Only tell the client to poll fast when we have NOTHING to show yet; a
        # background refresh of existing content is silent.
        if not store.has_content(sym, period):
            status = "generating"

    prof = store.get_profile(sym, period) or {}
    return {
        "symbol": sym,
        "company": _company_name(sym),
        "status": status,
        "stats": _compute_stats(sym),
        "earnings": _earnings(sym),
        "profile": {
            "company_desc": prof.get("company_desc"),
            "run_story": prof.get("run_story"),
            "sector": prof.get("sector"),
            "industry": prof.get("industry"),
            "generated_at": prof.get("generated_at"),
        },
        "generated_at": now,
    }
