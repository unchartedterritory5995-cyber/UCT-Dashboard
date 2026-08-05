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
_RETRY_AFTER = int(os.environ.get("STOCK_BRIEF_RETRY_AFTER", "86400") or 86400)          # retry a FAILED gen after 1 day
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
    ck = f"brief_earn_{sym}"
    cached = cache.get(ck)
    if cached is not None:
        return cached

    rows = []
    try:
        from api.services import earnings_estimates
        yr = _year()
        # Pull this year (fresh, so a just-reported quarter surfaces) + the prior
        # two so the trailing 4 REPORTED quarters are always reachable early in a
        # new year. get_year_earnings returns Q1→Q4 with "—" placeholders for
        # quarters not yet reported; we keep only rows that actually have a report.
        for y in (yr, yr - 1, yr - 2):
            for r in (earnings_estimates.get_year_earnings(sym, y, fresh=(y == yr)) or []):
                if r.get("date") and r.get("eps_actual") is not None:
                    rows.append(r)
    except Exception as exc:
        _logger.warning("stock_brief earnings failed for %s: %s", sym, exc)

    # Dedup by (year, quarter), order by report date, keep the last 4.
    seen, uniq = set(), []
    for r in sorted(rows, key=lambda x: x.get("date") or ""):
        key = (r.get("year"), r.get("quarter"))
        if key in seen:
            continue
        seen.add(key)
        uniq.append(r)
    last4 = uniq[-4:]
    cache.set(ck, last4, ttl=_EARN_TTL)
    return last4


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
        else:
            store.mark_attempt(sym, period)
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
