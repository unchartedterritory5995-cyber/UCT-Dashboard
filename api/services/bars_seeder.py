"""Background bar seeder — pre-populates the SQLite bar store so charts load
instantly without waiting for Massive API on first request.

Priority tiers:
  Tier 1 (~120 tickers, 6 workers, ~2-5 min):  ETFs + UCT20 + theme tickers
  Tier 2 (~600 tickers, 4 workers, ~20 min):   holdings + screener candidates
  Tier 3 (~3,700 tickers, 4 workers, nightly): full $300M+ universe

Each call to _seed_one() is idempotent:
  - SQLite already fresh  → returns immediately (<5 ms, no API call)
  - SQLite stale/missing  → delta or full fetch, stored forever
"""
import json
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

_log = logging.getLogger(__name__)

# ── Tier 1: always warm, immediately on startup ────────────────────────────────
_TIER1_BASE = [
    # Market + macro
    'SPY', 'QQQ', 'IWM', 'DIA', 'VIX', 'GLD', 'TLT', 'UUP',
    # Mega-cap
    'AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMZN', 'META', 'GOOGL', 'GOOG',
    'AMD', 'AVGO', 'SMCI', 'PLTR', 'ARM', 'COIN', 'MSTR', 'HOOD',
    'ANET', 'NFLX', 'CRM', 'ORCL', 'UBER', 'LLY', 'JPM', 'GS', 'COST',
    'PANW', 'CRWD', 'ZS', 'SNOW', 'DDOG', 'NET', 'MDB', 'SHOP', 'TTD',
    # Semis
    'TSM', 'QCOM', 'MU', 'INTC', 'LRCX', 'KLAC', 'ASML', 'SNPS', 'CDNS', 'ON',
    # Sector ETFs
    'XLK', 'XLF', 'XLV', 'XLE', 'XLI', 'XLC', 'XLU', 'XLB', 'XLRE', 'XLY', 'XLP',
    # Crypto proxies + energy
    'IBIT', 'MARA', 'CLSK', 'XOM', 'CVX', 'OXY', 'WMT', 'AMGN', 'ISRG',
]


def _seed_one(sym: str, tf: str, bars: int | None = None) -> bool:
    """Idempotent: warm (ticker, tf) via _get_bars_inner.  Returns True on success."""
    if bars is None:
        bars = 8000 if tf in ('D', 'W') else 5000
    try:
        from api.routers.bars import _get_bars_inner
        _get_bars_inner(sym.upper(), tf, bars)
        return True
    except Exception as e:
        _log.debug(f"[seeder] {sym}/{tf} skipped: {e}")
        return False


def _run_tier(label: str, jobs: list[tuple], workers: int) -> None:
    """Execute a list of (ticker, tf) seed jobs with bounded concurrency."""
    total = len(jobs)
    done = succeeded = errors = 0
    _log.info(f"[seeder/{label}] starting — {total} jobs, {workers} workers")
    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix=f"seed-{label}") as ex:
        futures = {ex.submit(_seed_one, sym, tf): (sym, tf) for sym, tf in jobs}
        for fut in as_completed(futures):
            ok = False
            try:
                ok = fut.result()
            except Exception:
                pass
            done += 1
            if ok:
                succeeded += 1
            else:
                errors += 1
            if done % 100 == 0 or done == total:
                _log.info(f"[seeder/{label}] {done}/{total} done ({succeeded} ok, {errors} err)")
    _log.info(f"[seeder/{label}] complete — {succeeded}/{total} succeeded, {errors} errors")


# ── Ticker-list builders ───────────────────────────────────────────────────────

def _build_tier1() -> list[str]:
    seen: set[str] = set()
    out: list[str] = []

    def _add(sym: str):
        if sym and sym.upper() not in seen:
            seen.add(sym.upper()); out.append(sym.upper())

    for s in _TIER1_BASE:
        _add(s)

    # UCT20 leadership from wire_data
    try:
        from api.services.cache import cache
        wire = cache.get("wire_data") or {}
        for item in (wire.get("leadership") or []):
            _add(item.get("ticker") or item.get("sym") or "")
    except Exception:
        pass

    # Theme ETFs from taxonomy DB
    try:
        from api.services.theme_db import get_all_themes
        # get_all_themes() returns {"sectors": [...], "themes": [...]} — iterating
        # the dict yields string keys, whose .get raised and was swallowed below,
        # making this tier-1 theme-ETF prewarm a silent no-op (mega-review finding).
        for th in get_all_themes().get("themes", []):
            _add(th.get("etf_ticker") or th.get("ticker") or "")
    except Exception:
        pass

    return out


def _build_tier2(tier1_set: set[str]) -> list[str]:
    seen = set(tier1_set)
    out: list[str] = []

    def _add(sym: str):
        if sym and sym.upper() not in seen:
            seen.add(sym.upper()); out.append(sym.upper())

    try:
        from api.services.cache import cache
        wire = cache.get("wire_data") or {}
        # Screener candidates — ⛔ VIA `engine.candidate_tickers()`. This read
        # the ENVELOPE as if it were the buckets AND asked for `gappers`, a
        # bucket name that has never existed (it is `gapper_news`), so it seeded
        # ZERO candidates. Two independent wrong keys on one line, both failing
        # silently to an empty list.
        from api.services.engine import candidate_tickers
        for _sym in candidate_tickers():
            _add(_sym)
        # Theme holdings
        for th in (wire.get("themes") or []):
            for sym in (th.get("holdings") or []):
                _add(sym)
    except Exception:
        pass

    # Breadth drill-list tickers — every ticker a user might click in a DrillModal.
    # These are the most frequently charted non-Tier-1 tickers and must be in SQLite
    # at startup so stale-while-revalidate serves them instantly (no Massive API wait).
    try:
        from api.services import breadth_monitor as _bm
        latest = _bm.get_latest()
        if latest:
            for k, v in latest.items():
                if not k.endswith('_list') or not isinstance(v, list):
                    continue
                for item in v:
                    sym = item.get('t') if isinstance(item, dict) else None
                    if sym:
                        _add(sym.upper())
    except Exception:
        pass

    # Watchlist items from DB
    try:
        from api.services.auth_db import get_connection
        conn = get_connection()
        rows = conn.execute("SELECT DISTINCT sym FROM watchlist_items").fetchall()
        conn.close()
        for r in rows:
            _add(r[0])
    except Exception:
        pass

    return out


def _build_universe() -> list[str]:
    paths = [
        os.path.join(os.environ.get("DATA_DIR", "/data"), "..", "api", "data", "cap_universe.json"),
        os.path.join(os.path.dirname(__file__), "..", "data", "cap_universe.json"),
    ]
    for p in paths:
        try:
            with open(os.path.normpath(p)) as f:
                return json.load(f)
        except Exception:
            pass
    return []


# ── Public entry points ────────────────────────────────────────────────────────

def seed_priority() -> None:
    """Tier 1 + Tier 2 on startup (runs in a daemon thread)."""
    t1 = _build_tier1()
    t1_set = set(t1)

    # Tier 1: D + W immediately (most-viewed TFs first)
    _run_tier("t1-DW", [(s, tf) for tf in ("D", "W") for s in t1], workers=6)

    # Tier 1: intraday (5/15/30/60min) for the top 40 only
    _run_tier("t1-intra", [(s, tf) for tf in ("5", "15", "30", "60") for s in t1[:40]], workers=4)

    # Tier 2: Daily only
    t2 = _build_tier2(t1_set)
    if t2:
        _run_tier("t2-D", [(s, "D") for s in t2], workers=4)

    _log.info("[seeder] priority seeding complete")


def seed_full_universe() -> None:
    """Tier 3: nightly delta refresh for all universe tickers (triggered by APScheduler)."""
    tickers = _build_universe()
    if not tickers:
        _log.warning("[seeder/universe] cap_universe.json not found — skipping")
        return
    _log.info(f"[seeder/universe] nightly refresh — {len(tickers)} tickers")
    _run_tier("universe-D", [(s, "D") for s in tickers], workers=6)
    _run_tier("universe-W", [(s, "W") for s in tickers], workers=4)
    _log.info("[seeder/universe] nightly refresh complete")


def start_background_seeder() -> None:
    """Launch seed_priority() in a daemon thread (non-blocking startup)."""
    t = threading.Thread(target=seed_priority, daemon=True, name="bars-seeder")
    t.start()
    _log.info("[seeder] background seeder started")
