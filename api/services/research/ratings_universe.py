"""Nightly universe gather for UCT Ratings percentile ranking (Phase 2).

Walks ``cap_universe`` and persists each ticker's raw rankable metrics into
``ratings_db``, then rebuilds the universe distributions. ``ratings.py`` reads
those distributions to produce true 1-99 percentile ranks.

Cost discipline (this is the whole point):
- **RS return + Acc/Dis come from the LOCAL cached daily bars** (``bars_sqlite``)
  — zero network, reusing the chart system's universe pre-cache.
- **Fundamentals = exactly ONE yfinance ``.info`` call per ticker** via
  ``get_fundamentals``, run through the bounded yfinance pool with a hard
  per-call timeout, processed sequentially with a politeness sleep.
- **Incremental + capped:** only tickers whose metrics are older than
  ``REFRESH_TTL`` are refreshed, at most ``MAX_PER_RUN`` per run — so the
  universe warms over several nights and each night's load is bounded.

Gated by ``RATINGS_PERCENTILE_ENABLED`` (default off) — when off the scheduler
never registers this and ``ratings.py`` simply finds no distributions and uses
absolute bands (today's behavior). Never raises.
"""
from __future__ import annotations

import json
import logging
import os
import time

from api.services import bars_sqlite
from api.services.fundamentals import get_fundamentals
from api.services.yfinance_pool import run_in_pool
from api.services.research import ratings_db
from api.services.research.ratings import _accdis_ratio, _blend_growth, _weighted_rs_return

_logger = logging.getLogger(__name__)

# ── Tunables (env-overridable) ────────────────────────────────────────────────
REFRESH_TTL = float(os.environ.get("RATINGS_PERCENTILE_REFRESH_TTL", str(6 * 86400)))  # 6 days
MAX_PER_RUN = int(os.environ.get("RATINGS_PERCENTILE_MAX_PER_RUN", "800"))
SLEEP_SECONDS = float(os.environ.get("RATINGS_PERCENTILE_SLEEP", "0.1"))
FETCH_TIMEOUT = float(os.environ.get("RATINGS_PERCENTILE_FETCH_TIMEOUT", "12"))
# distributions older than this are considered stale (drives startup catch-up)
STALE_AFTER = float(os.environ.get("RATINGS_PERCENTILE_STALE_AFTER", str(36 * 3600)))  # 36h

_UNIVERSE_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "data", "cap_universe.json")


def is_enabled() -> bool:
    return os.environ.get("RATINGS_PERCENTILE_ENABLED", "0").lower() in ("1", "true", "yes")


def _load_universe() -> list[str]:
    """Full cap_universe ticker list (deduped, uppercased). Mirrors ticker_search."""
    try:
        with open(_UNIVERSE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return sorted({str(t).upper() for t in data if t})
    except Exception as exc:
        _logger.warning("ratings_universe: cap_universe load failed: %s", exc)
        return []


def _compute_one(sym: str, bulk_fund: dict | None = None) -> dict | None:
    """Compute one ticker's raw rankable metrics. Local bars + fundamentals.
    Uses the prefetched FMP bulk fundamentals map when provided, else makes the
    per-ticker yfinance ``get_fundamentals`` call."""
    closes = vols = None
    try:
        rows = bars_sqlite.get_bars(sym, "D", 300)  # local, no network; oldest-first (ts,o,h,l,c,v)
        if rows:
            closes = [r[4] for r in rows]
            vols = [r[5] for r in rows]
    except Exception:
        pass

    rs_return = _weighted_rs_return(closes) if closes else None
    accdis_ratio = _accdis_ratio(closes, vols) if (closes and vols) else None

    fund: dict = {}
    if bulk_fund is not None:
        fund = bulk_fund
    else:
        try:
            fund = get_fundamentals(sym) or {}
        except Exception:
            fund = {}
        if "error" in fund:
            fund = {}

    eps_g = fund.get("earnings_growth_pct")
    rev_g = fund.get("revenue_growth_pct")
    return {
        "earnings_growth": eps_g,
        "rev_growth": rev_g,
        "blended_growth": _blend_growth(rev_g, eps_g),
        "rs_return": rs_return,
        "peg": fund.get("peg"),
        "pe_fwd": fund.get("pe_forward"),
        "op_margin": fund.get("operating_margin_pct"),
        "roe": fund.get("roe_pct"),
        "inst_pct": fund.get("held_pct_institutions"),
        "accdis_ratio": accdis_ratio,
        "sector": fund.get("sector"),  # for Sector RS (per-sector distributions)
    }


def _has_data(m: dict | None) -> bool:
    """True if we gathered at least one real signal (so the row is worth storing)."""
    if not m:
        return False
    return any(m.get(k) is not None for k in ("earnings_growth", "rev_growth", "roe", "rs_return"))


def run_percentile_refresh(max_per_run: int | None = None, force: bool = False) -> dict:
    """Refresh stale tickers' metrics then rebuild distributions. Never raises.

    ``force=True`` (admin trigger) runs even when the feature flag is off and
    ignores the freshness skip. Returns a summary dict.
    """
    if not force and not is_enabled():
        return {"status": "disabled"}

    try:
        ratings_db.init_db()
        universe = _load_universe()
        if not universe:
            return {"status": "no_universe"}

        fresh = set() if force else ratings_db.get_fresh_syms(REFRESH_TTL)
        stale = [s for s in universe if s not in fresh]
        cap = max_per_run if max_per_run is not None else MAX_PER_RUN
        batch = stale[:cap]

        # FMP bulk fundamentals (gated) — one whole-market pull so the per-ticker
        # yfinance call (and its politeness sleep) is skipped for covered symbols.
        # Optimization layer only: misses fall back to the per-ticker path.
        bulk: dict = {}
        if os.environ.get("FMP_BULK_ENABLED", "").lower() in ("1", "true", "yes"):
            try:
                from api.services.fmp_bulk import fetch_fundamentals_bulk
                bulk = fetch_fundamentals_bulk()
                _logger.info("ratings_universe: FMP bulk fundamentals loaded for %d symbols", len(bulk))
            except Exception as e:
                _logger.warning("ratings_universe: bulk pull failed, per-ticker fallback: %s", e)
                bulk = {}

        processed = 0
        for sym in batch:
            bulk_fund = bulk.get(sym)
            try:
                m = run_in_pool(lambda s=sym, bf=bulk_fund: _compute_one(s, bulk_fund=bf), timeout=FETCH_TIMEOUT)
            except Exception:
                m = None
            if _has_data(m):
                ratings_db.upsert_metrics(sym, m)
                processed += 1
            # Only the per-ticker yfinance path needs the politeness sleep.
            if SLEEP_SECONDS and bulk_fund is None:
                time.sleep(SLEEP_SECONDS)

        summary = ratings_db.rebuild_distributions()
        result = {
            "status": "ok",
            "universe": len(universe),
            "stale": len(stale),
            "processed": processed,
            "remaining": max(0, len(stale) - len(batch)),
            "distributions": summary,
        }
        _logger.info("ratings_universe refresh: %s", result)
        return result
    except Exception as exc:  # pragma: no cover - defensive top-level guard
        _logger.warning("ratings_universe refresh failed: %s", exc)
        return {"status": "error", "error": str(exc)}


def distributions_stale() -> bool:
    """True if distributions are missing or older than STALE_AFTER (startup catch-up)."""
    st = ratings_db.status()
    last = st.get("last_computed_at")
    if not last:
        return True
    return (time.time() - last) > STALE_AFTER


def nightly_job() -> None:
    """Scheduler entry point — runs a refresh, swallows everything."""
    try:
        run_percentile_refresh()
    except Exception as exc:  # pragma: no cover
        _logger.warning("ratings_universe nightly_job failed: %s", exc)
