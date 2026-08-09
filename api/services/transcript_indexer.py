"""Fills the cross-company transcript index from FMP's latest-transcripts feed.

Separate from `transcript_index` so the store can be tested without a provider
and the walk can be tested without a database.

FMP Ultimate is uncapped, so the only budget here is wall-clock. The walk is
incremental — `transcript_index.has()` is checked BEFORE the content fetch, so
a resumed sweep costs one cheap feed page per 100 calls it already holds.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Callable, Optional

_log = logging.getLogger(__name__)

# The feed caps at 100 rows per page whatever `limit` says — measured, not
# assumed. Asking for more silently returns 100, so paging is the only way
# through the corpus.
PAGE_SIZE = 100
PACE_SECONDS = 0.15


def _fmp_get(path: str, params: dict, timeout: int = 25):
    from api.services.earnings_estimates import _fmp_get as g
    return g(path, params, timeout=timeout)


def _tradeable(sym: str) -> bool:
    """Is this a ticker the dashboard actually charts?

    Delegates to the recap warmer's cap_universe check so there is ONE answer
    to "do we cover this symbol" rather than two that can drift apart.
    """
    try:
        from api.services.call_recap_warmer import _tradeable as t
        return t(sym)
    except Exception:
        return True


def latest_page(page: int, fmp_get: Callable = None) -> list[dict]:
    """One page of the newest transcripts across all issuers."""
    fmp_get = fmp_get or _fmp_get
    rows = fmp_get("/stable/earning-call-transcript-latest",
                   {"page": page, "limit": PAGE_SIZE})
    return rows if isinstance(rows, list) else []


def fetch_content(symbol: str, year: int, quarter: int,
                  fmp_get: Callable = None) -> Optional[str]:
    fmp_get = fmp_get or _fmp_get
    rows = fmp_get("/stable/earning-call-transcript",
                   {"symbol": symbol, "year": year, "quarter": quarter}, timeout=40)
    if not isinstance(rows, list) or not rows:
        return None
    return (rows[0] or {}).get("content") or None


def _period_to_quarter(period) -> Optional[int]:
    """'Q3' | 3 | '3' → 3. Anything else is not a quarter we can key on."""
    if isinstance(period, int):
        return period if 1 <= period <= 4 else None
    s = str(period or "").strip().upper().lstrip("Q")
    return int(s) if s.isdigit() and 1 <= int(s) <= 4 else None


def run_index_sweep(max_pages: int = None, *, store=None, fmp_get: Callable = None,
                    now=time.monotonic, sleep=time.sleep,
                    max_seconds: int = 900) -> dict[str, Any]:
    """Walk the feed newest-first and index anything not already held."""
    if store is None:
        from api.services import transcript_index as store
    if max_pages is None:
        max_pages = store.MAX_PAGES
    store.init_db()

    counts = {"indexed": 0, "already": 0, "no_content": 0, "bad_row": 0}
    started = now()
    pages = 0

    for page in range(max_pages):
        if now() - started > max_seconds:
            counts["timed_out"] = 1
            break
        try:
            rows = latest_page(page, fmp_get=fmp_get)
        except Exception as exc:
            _log.warning("[tindex] feed page %s failed: %s", page, exc)
            break
        if not rows:
            break
        pages += 1

        for r in rows:
            if now() - started > max_seconds:
                counts["timed_out"] = 1
                break
            sym = (r.get("symbol") or "").upper().strip()
            year = r.get("fiscalYear") or r.get("year")
            q = _period_to_quarter(r.get("period") or r.get("quarter"))
            if not sym or not year or not q:
                counts["bad_row"] += 1
                continue
            # Same universe filter the recap warmer uses, reused rather than
            # restated. Unfiltered, the feed carries foreign listings of
            # companies already in the corpus — DTRUY and DTG.DE are one
            # earnings call under two tickers, and both matched every search
            # with identical text. Cross-company search is worth less when a
            # third of the hits are the same company twice.
            if not _tradeable(sym):
                counts["off_universe"] = counts.get("off_universe", 0) + 1
                continue
            if store.has(sym, year, q):
                counts["already"] += 1
                continue
            try:
                content = fetch_content(sym, year, q, fmp_get=fmp_get)
            except Exception as exc:
                _log.debug("[tindex] content failed %s %sQ%s: %s", sym, year, q, exc)
                content = None
            if not content:
                counts["no_content"] += 1
                continue
            store.put(sym, year, q, r.get("date") or "", content)
            counts["indexed"] += 1
            if PACE_SECONDS:
                sleep(PACE_SECONDS)

    # Report the ARTIFACT, not merely that the sweep ran: "pages walked" alone
    # cannot distinguish a healthy pass from one that indexed nothing.
    out = {"pages": pages, **counts}
    try:
        out["corpus"] = store.stats()["transcripts"]
    except Exception:
        pass
    return out
