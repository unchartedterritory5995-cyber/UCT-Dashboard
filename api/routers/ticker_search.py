"""GET /api/ticker-search?q=<prefix>&limit=N — predictive ticker autocomplete.

Loads `api/data/cap_universe.json` (3,685 $300M+ tickers) once at import time
and serves prefix-then-substring matches. Enriches results with company
names from the existing ticker_meta cache (in-process TTL → on-disk). For
matches that don't have a cached name, fires a bounded background fetch so
subsequent requests resolve names — never blocks the autocomplete response.
"""
import json
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import List

from fastapi import APIRouter, Query

_logger = logging.getLogger(__name__)
router = APIRouter()


def _resolve_universe_path() -> str:
    here = os.path.join(os.path.dirname(__file__), "..", "data", "cap_universe.json")
    if os.path.exists(here):
        return here
    return os.path.join("api", "data", "cap_universe.json")


def _load_universe() -> List[str]:
    try:
        with open(_resolve_universe_path(), "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, list):
            # Deduplicate + uppercase + sort alphabetically (stable for prefix scan)
            out = sorted({str(t).upper() for t in data if t})
            _logger.info("[ticker-search] loaded %d tickers from cap_universe", len(out))
            return out
    except Exception as e:
        _logger.warning("[ticker-search] cap_universe load failed: %s", e)
    return []


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


@router.get("/api/ticker-search")
def ticker_search(
    q: str = Query("", max_length=10),
    limit: int = Query(20, ge=1, le=50),
):
    """Return up to `limit` ticker suggestions ranked: exact > prefix > substring.

    Response shape: {"results": [{"ticker": "NVDA", "name": "NVIDIA Corp" | None}, ...]}
    """
    qq = (q or "").strip().upper()
    if not qq:
        return {"results": []}
    if not _UNIVERSE:
        return {"results": []}

    exact = []
    prefix = []
    substring = []
    for t in _UNIVERSE:
        if t == qq:
            exact.append(t)
        elif t.startswith(qq):
            prefix.append(t)
        elif qq in t:
            substring.append(t)
        if len(prefix) + len(exact) >= limit and not substring:
            # Early exit when prefix-only fills the page — substring isn't checked
            # beyond what's already gathered. Acceptable: prefix matches dominate
            # the common case (user is typing the start of the ticker).
            pass

    merged = exact + prefix + substring
    merged = merged[:limit]

    results = []
    live_syms = set()
    for t in merged:
        name = _name_from_cache(t)
        if name is None:
            _enqueue_name_backfill(t)
        results.append({"ticker": t, "name": name})
        live_syms.add(t)

    # Merge in DELISTED tickers (Yahoo, Twitter, Lehman…) so dead names are discoverable
    # too — labeled `delisted` + delisting date so the dropdown can badge them. They live in
    # a separate registry (kept out of cap_universe / the live warmers), so a live ticker
    # that shares a symbol always wins: skip any delisted match already present as a live row.
    try:
        from api.services import delisted_registry
        for rec in delisted_registry.search(qq, limit):
            if rec["ticker"] in live_syms:
                continue
            results.append({
                "ticker": rec["ticker"],
                "name": rec.get("name"),
                "delisted": True,
                "delisted_date": rec.get("delisted_date"),
            })
    except Exception:
        pass
    return {"results": results[:limit]}
