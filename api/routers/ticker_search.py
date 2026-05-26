"""GET /api/ticker-search?q=<prefix>&limit=N — predictive ticker autocomplete.

Loads `api/data/cap_universe.json` (3,685 $300M+ tickers) once at import time
and serves prefix-then-substring matches. Optionally enriches matches with
company names from the in-process ticker_meta TTLCache — never triggers a
yfinance/Finnhub fetch on the hot path (would block the request).
"""
import json
import logging
import os
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
    """Pull a cached company name if it's already in-process. Never fetches."""
    try:
        from api.services.ticker_meta import _mem  # private TTLCache reuse
        hit = _mem.get(f"tmeta_{ticker}")
        if hit:
            return hit.get("name")
    except Exception:
        pass
    return None


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

    results = [{"ticker": t, "name": _name_from_cache(t)} for t in merged]
    return {"results": results}
