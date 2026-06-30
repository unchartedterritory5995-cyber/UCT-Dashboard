"""
Massive OI snapshot fetcher.

Parallels api/oi_snapshots.py (Schwab) but sources OI from Massive's REST
options snapshot endpoint. Designed to be a drop-in alternative or a
fallback when Schwab fails.

Architecture:
  - One HTTP call per UNDERLYING ticker (Massive's chain endpoint returns
    OI for all strikes/expirations on that underlying in one response).
    For a typical batch of 50-200 contracts, this is 5-20 calls instead
    of 50-200 individual Schwab calls.
  - Per-ticker dedup: if the same underlying appears multiple times in
    one batch, fetch once and serve all from response.
  - Pagination: follows next_url if response is truncated (typically
    only on very active underlyings — SPY, QQQ — where chain has 5000+
    contracts).
  - Error handling: returns None for unresolved contracts; caller treats
    as "Schwab miss" and falls through.

ASSUMPTIONS (verify against current Massive docs before deploy):
  1. Endpoint: https://api.massive.com/v3/snapshot/options/{ticker}
  2. Auth: Bearer token via Authorization header using MASSIVE_API_KEY
  3. Response shape:
     {
       "status": "OK",
       "results": [
         {
           "details": {
             "ticker": "O:QCOM260807C00192500",
             "contract_type": "call" | "put",
             "strike_price": 192.5,
             "expiration_date": "2026-08-07"
           },
           "open_interest": 29,
           ...
         },
         ...
       ],
       "next_url": "..." (optional, for pagination)
     }
  4. Pagination: GET next_url with same auth, response has same shape

If Massive's actual API differs (different paths, field names, auth
style), only the parsing functions need to change. The orchestration
logic is correct regardless.

Drop-in interface match with Schwab module:
  _fetch_oi_all_async(batch) -> List[Tuple[contract_key, oi_or_None]]
"""
import asyncio
import logging
import os
from collections import defaultdict
from datetime import datetime
from typing import Iterable

logger = logging.getLogger(__name__)

MASSIVE_API_KEY = os.environ.get("MASSIVE_API_KEY", "").strip()
MASSIVE_REST_BASE = os.environ.get(
    "MASSIVE_REST_BASE", "https://api.massive.com"
).rstrip("/")

# Per-call timeout. Massive chain calls can return 5000+ contracts on
# very active underlyings; allow some headroom but don't hang the worker.
HTTP_TIMEOUT_SEC = float(os.environ.get("MASSIVE_OI_TIMEOUT", "12.0"))

# Concurrent requests cap. Massive's Options Advanced plan tolerates
# significant concurrency, but being polite avoids rate limit surprises.
MAX_CONCURRENCY = int(os.environ.get("MASSIVE_OI_CONCURRENCY", "8"))

# Per-page limit. Massive's default page size is only 10 contracts —
# unusable for full-chain fetches (QCOM has 500+ strikes across all
# expirations). Setting to 250 (Massive's API max) reduces page count
# by 25x. A typical liquid ticker (QCOM, NVDA, AMD) returns 800-2000
# contracts in the full chain, so 4-8 pages at 250.
MASSIVE_PAGE_LIMIT = int(os.environ.get("MASSIVE_OI_PAGE_LIMIT", "250"))

# Pagination cap. With limit=250, 40 pages = 10,000 contracts which
# covers SPY/QQQ-sized chains. For most tickers we finish in 3-8 pages.
MAX_PAGES = int(os.environ.get("MASSIVE_OI_MAX_PAGES", "40"))

# Per-underlying response cache (within a single function call). Avoids
# refetching the same chain if multiple contracts on the same ticker
# appear in the batch.
_PER_CALL_CACHE: dict = {}


def _contract_key(sym: str, cp_letter: str, strike, exp_mdy: str) -> str:
    """Match the same contract_key format used by the Schwab module
    and the contract_oi_snapshots table.

    Format: 'TICKER|C/P|float_strike|M/D/YYYY'
    Example: 'QCOM|C|192.5|8/7/2026'
    """
    return f"{sym}|{cp_letter}|{float(strike)}|{exp_mdy}"


def _parse_iso_date_to_mdy(iso_date: str) -> str:
    """Convert '2026-08-07' to '8/7/2026' to match worker convention."""
    try:
        dt = datetime.strptime(iso_date, "%Y-%m-%d")
        return f"{dt.month}/{dt.day}/{dt.year}"
    except (ValueError, TypeError):
        return ""


def _build_index_from_response(results: list) -> dict:
    """Index a Massive chain response by (cp_letter, float_strike, M/D/YYYY).

    Returns a dict mapping that tuple to OI int. Contracts without OI
    or with unparseable details are skipped.
    """
    index = {}
    for item in results:
        details = item.get("details") or {}
        oi = item.get("open_interest")
        if oi is None:
            continue
        try:
            oi_int = int(oi)
        except (ValueError, TypeError):
            continue
        if oi_int <= 0:
            # Massive returning 0 OI is meaningful (real fresh strike)
            # but we let the consumer interpret. Schwab module also
            # filters out 0; matching that for consistency.
            continue
        # Determine cp_letter
        ctype = (details.get("contract_type") or "").lower()
        if ctype == "call":
            cp_letter = "C"
        elif ctype == "put":
            cp_letter = "P"
        else:
            continue
        # Strike
        strike = details.get("strike_price")
        if strike is None:
            continue
        try:
            strike_f = float(strike)
        except (ValueError, TypeError):
            continue
        # Expiration (M/D/YYYY)
        exp_iso = details.get("expiration_date") or ""
        exp_mdy = _parse_iso_date_to_mdy(exp_iso)
        if not exp_mdy:
            continue
        index[(cp_letter, strike_f, exp_mdy)] = oi_int
    return index


async def _fetch_chain_for_ticker(client, ticker: str) -> dict:
    """Fetch full chain snapshot for one underlying ticker.

    Returns dict mapping (cp_letter, float_strike, M/D/YYYY) -> oi_int.
    Follows pagination if next_url is present.
    On any error, returns empty dict (caller treats as 'unresolved').
    """
    if ticker in _PER_CALL_CACHE:
        return _PER_CALL_CACHE[ticker]

    headers = {}
    if MASSIVE_API_KEY:
        headers["Authorization"] = f"Bearer {MASSIVE_API_KEY}"

    # Use ?limit=250 to get 25x more per page than Massive's default of 10.
    # Without this, full chain fetches require 50+ pages and almost never
    # complete within the 12s timeout for liquid tickers.
    url = (f"{MASSIVE_REST_BASE}/v3/snapshot/options/{ticker}"
           f"?limit={MASSIVE_PAGE_LIMIT}")
    combined: dict = {}
    page = 0
    total_results_seen = 0

    while url and page < MAX_PAGES:
        try:
            resp = await client.get(url, headers=headers,
                                    timeout=HTTP_TIMEOUT_SEC)
        except Exception as e:
            logger.warning("[massive-oi] %s page %d request failed: %s",
                           ticker, page, e)
            break

        if resp.status_code != 200:
            logger.warning("[massive-oi] %s page %d status=%d",
                           ticker, page, resp.status_code)
            break

        try:
            data = resp.json()
        except Exception as e:
            logger.warning("[massive-oi] %s page %d JSON parse failed: %s",
                           ticker, page, e)
            break

        results = data.get("results") or []
        total_results_seen += len(results)
        if results:
            combined.update(_build_index_from_response(results))

        # Follow pagination if present
        next_url = data.get("next_url")
        if next_url:
            # Massive's next_url is sometimes relative, sometimes absolute.
            # Either way it carries the cursor; append our auth via header.
            if next_url.startswith("http"):
                url = next_url
            else:
                url = f"{MASSIVE_REST_BASE}{next_url}"
            page += 1
        else:
            url = None

    logger.info(
        "[massive-oi] %s: %d pages, %d total results, %d indexed with OI>0",
        ticker, page + 1, total_results_seen, len(combined)
    )
    _PER_CALL_CACHE[ticker] = combined
    return combined


async def _fetch_oi_all_async(batch: Iterable[tuple]) -> list:
    """Public entry point — matches the Schwab module's interface.

    Input: iterable of (sym, cp_letter, strike, exp_mdy) tuples
    Output: list of (contract_key, oi_or_None) tuples

    contract_key uses the same format as the Schwab module so callers
    can substitute this function for the Schwab one with no other
    changes.
    """
    # Drop module-level cache from any prior call to keep memory bounded
    _PER_CALL_CACHE.clear()

    # Group batch by underlying ticker
    by_ticker: dict = defaultdict(list)
    for entry in batch:
        try:
            sym, cp_letter, strike, exp_mdy = entry
        except (ValueError, TypeError):
            continue
        if not sym or sym[-1].isdigit():
            # Skip adjusted/when-issued symbols — Massive may 404
            continue
        by_ticker[sym].append((cp_letter, strike, exp_mdy))

    if not by_ticker:
        return []

    try:
        import httpx
    except ImportError:
        logger.warning("[massive-oi] httpx not installed; cannot fetch")
        return [(_contract_key(*e), None) for e in batch]

    # Bounded concurrency for chain fetches
    sem = asyncio.Semaphore(MAX_CONCURRENCY)

    async def _fetch_one(client, ticker):
        async with sem:
            return ticker, await _fetch_chain_for_ticker(client, ticker)

    async with httpx.AsyncClient() as client:
        tasks = [_fetch_one(client, t) for t in by_ticker.keys()]
        chain_results = await asyncio.gather(*tasks, return_exceptions=False)

    chains_by_ticker = {t: idx for t, idx in chain_results}

    # Now match each requested contract to its OI
    results = []
    for entry in batch:
        try:
            sym, cp_letter, strike, exp_mdy = entry
        except (ValueError, TypeError):
            continue
        ck = _contract_key(sym, cp_letter, strike, exp_mdy)
        chain_idx = chains_by_ticker.get(sym, {})
        try:
            strike_f = float(strike)
        except (ValueError, TypeError):
            results.append((ck, None))
            continue
        lookup_key = (cp_letter, strike_f, exp_mdy)
        oi = chain_idx.get(lookup_key)
        results.append((ck, oi))

    # Log diagnostic summary
    resolved = sum(1 for _, oi in results if oi is not None and oi > 0)
    total = len(results)
    tickers = len(by_ticker)
    logger.info(
        "[massive-oi] fetched %d tickers -> %d/%d contracts resolved",
        tickers, resolved, total
    )

    return results
