"""GET /api/ticker-search?q=<prefix>&limit=N — predictive ticker autocomplete.

Loads `api/data/cap_universe.json` (3,685 $300M+ tickers) once at import time
and serves prefix-then-substring matches. Enriches results with company
names from the existing ticker_meta cache (in-process TTL → on-disk). For
matches that don't have a cached name, fires a bounded background fetch so
subsequent requests resolve names — never blocks the autocomplete response.
"""
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import List

from fastapi import APIRouter, Query

from api.services import cap_universe

_logger = logging.getLogger(__name__)
router = APIRouter()


def _load_universe() -> List[str]:
    """Sorted, de-duplicated and upper-cased -- the order the prefix scan
    relies on. Reading and caching the file itself belongs to
    `services.cap_universe`, which is also what the article converter asks."""
    out = sorted(cap_universe.symbols())
    _logger.info("[ticker-search] loaded %d tickers from cap_universe", len(out))
    return out


_UNIVERSE: List[str] = _load_universe()


def _name_from_cache(ticker: str):
    """Pull a cached company name without triggering a network fetch.

    Resolution order: in-process TTLCache → on-disk JSON cache (populated
    over time as users view charts; the watermark calls /api/ticker-meta
    which writes here). Never raises, never blocks.
    """
    try:
        from api.services import ticker_meta as tm
        hit = tm._mem.get(f"tmeta_{ticker}")
        if hit:
            return hit.get("name")
        disk = tm._disk_get(ticker)
        if disk:
            try:
                tm._mem.set(f"tmeta_{ticker}", disk, ttl=tm._TTL)
            except Exception:
                pass
            return disk.get("name")
    except Exception:
        pass
    return None


# Background name backfill — when autocomplete returns a match with no
# cached name, schedule a fetch so the next request resolves it. Bounded
# pool keeps the worker thread count safe even under autocomplete bursts.
_BACKFILL_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ticker-name-bf")
_BACKFILL_INFLIGHT = set()
_BACKFILL_LOCK = threading.Lock()
_BACKFILL_CAP = 8  # max in-flight at once


def _enqueue_name_backfill(ticker: str) -> None:
    """Fire-and-forget: warm ticker_meta cache so the next autocomplete sees a name."""
    with _BACKFILL_LOCK:
        if ticker in _BACKFILL_INFLIGHT or len(_BACKFILL_INFLIGHT) >= _BACKFILL_CAP:
            return
        _BACKFILL_INFLIGHT.add(ticker)

    def _job():
        try:
            from api.services.ticker_meta import _base_meta
            _base_meta(ticker)  # writes to disk + memory cache; safe + idempotent
        except Exception as e:
            _logger.info("[ticker-search] name backfill %s failed: %s", ticker, e)
        finally:
            with _BACKFILL_LOCK:
                _BACKFILL_INFLIGHT.discard(ticker)

    try:
        _BACKFILL_POOL.submit(_job)
    except Exception:
        with _BACKFILL_LOCK:
            _BACKFILL_INFLIGHT.discard(ticker)


# Category chip → the index asset-types it selects. 'breadth' is served from the
# breadth registry (not the index); '' / 'all' means no filter.
_CHIP_TYPES = {"stock": {"stock"}, "etf": {"etf"}, "index": {"index"}}


def _fallback_symbol_scan(qq: str, limit: int):
    """Symbol-only scan over cap_universe — used only until the rich index has built
    (best-effort startup window). Names come from the ticker_meta cache."""
    exact, prefix, substring = [], [], []
    for t in _UNIVERSE:
        if t == qq:
            exact.append(t)
        elif t.startswith(qq):
            prefix.append(t)
        elif qq in t:
            substring.append(t)
    out = []
    for t in (exact + prefix + substring)[:limit]:
        out.append({"ticker": t, "name": _name_from_cache(t), "type": "stock",
                    "exchange": None})
    return out


@router.get("/api/ticker-search")
def ticker_search(
    q: str = Query("", max_length=48),
    limit: int = Query(20, ge=1, le=50),
    type: str = Query("", max_length=16),
):
    """Predictive symbol search ranked across ticker AND name: exact symbol > symbol
    prefix > symbol contains > name contains. So "AAPL" returns AAPL then AAPU/AAPD/…
    (leveraged/inverse products whose NAME references it), and "bull 2x" or "uranium"
    find products by description.

    `type` filters by category chip: stock | etf | index | breadth | '' (all).

    Row shape: {"ticker","name"|None,"type","exchange"|None,[breadth|delisted flags]}
    """
    qq = (q or "").strip().upper()
    if not qq:
        return {"results": []}

    chip = (type or "").strip().lower()
    want_breadth = chip in ("", "all", "breadth")
    want_delisted = chip in ("", "all")
    index_types = _CHIP_TYPES.get(chip)  # None for all/breadth
    from api.services import ticker_search_index as _tsi

    results = []
    live_syms = set()
    if chip != "breadth":
        if _tsi.ready():
            for row in _tsi.search(q, limit, types=index_types):
                if row.get("name") is None:
                    _enqueue_name_backfill(row["ticker"])
                results.append(row)
                live_syms.add(row["ticker"])
        elif index_types is None or "stock" in (index_types or set()):
            # Index still building — degrade to the bare symbol scan.
            for row in _fallback_symbol_scan(qq, limit):
                if row.get("name") is None:
                    _enqueue_name_backfill(row["ticker"])
                results.append(row)
                live_syms.add(row["ticker"])

    # UCT BREADTH pseudo-tickers (UCTA50 = % above 50-day MA, UCTNH = new highs…):
    # symbol-level matches jump to the FRONT; name matches sit after live tickers.
    if want_breadth:
        try:
            from api.services import breadth_symbols as _breadth_syms
            b_front, b_back = [], []
            for rec in _breadth_syms.search(qq, limit):
                row = {"ticker": rec["ticker"], "name": rec["name"], "type": "breadth",
                       "exchange": "UCT", "breadth": True, "group_label": rec.get("group_label")}
                (b_front if rec.get("symbol_hit") else b_back).append(row)
            results = b_front + results + b_back
        except Exception:
            pass

    # DELISTED tickers (Yahoo, Twitter, Lehman…) — a live ticker sharing a symbol wins.
    if want_delisted:
        try:
            from api.services import delisted_registry
            for rec in delisted_registry.search(qq, limit):
                if rec["ticker"] in live_syms:
                    continue
                results.append({
                    "ticker": rec["ticker"], "name": rec.get("name"),
                    "type": "delisted", "exchange": None,
                    "delisted": True, "delisted_date": rec.get("delisted_date"),
                })
        except Exception:
            pass
    return {"results": results[:limit]}
