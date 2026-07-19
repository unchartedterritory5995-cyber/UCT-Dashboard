"""
Massive OI snapshot fetcher.

Parallels api/oi_snapshots.py (Schwab) but sources OI from Massive's REST
options snapshot endpoint. Designed to be a drop-in alternative or a
fallback when Schwab fails.

Architecture:
  - One HTTP call per UNDERLYING ticker (Massive's snapshot endpoint returns
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

CONFIRMED against Massive (2026-07-19):
  1. Endpoint: https://api.massive.com/v3/snapshot/options/{ticker}
  2. Auth: `?apiKey=<MASSIVE_API_KEY>` QUERY PARAM (NOT a Bearer header — the
     Bearer form is rejected and was the cause of the 7/15-17 "0/198 resolved"
     collapse). Matches the on-demand quote fetch in massive_ws_worker.py and
     the verified snapshot curl (FROG 8/21 $80C → open_interest 8004).
  3. Response shape (per-contract objects under `results`):
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
     The single-contract route (.../{ticker}/{occ}) returns `results` as a
     single OBJECT; this module accepts either an array or a single object.
  4. Pagination: GET next_url with apiKey re-appended (Massive's next_url
     carries the cursor but NOT the key).

HTTP: STDLIB urllib only, run via asyncio.to_thread — httpx is NOT installed
in the flow-worker container (same reason the on-demand quote fetch is stdlib),
so importing it here silently returned all-None whenever oi_fetch_manager
called this on the worker.

Drop-in interface match with Schwab module:
  _fetch_oi_all_async(batch) -> List[Tuple[contract_key, oi_or_None]]
"""
import asyncio
import json as _json
import logging
import os
import urllib.parse
import urllib.request
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

# Real UA to avoid Cloudflare's 1010 block on urllib's default agent (same
# guard the Discord POST + on-demand quote paths use).
_UCT_UA = "UCT-Massive/1.0 (+https://uctintelligence.com)"

# Per-underlying response cache (within a single function call). Avoids
# refetching the same chain if multiple contracts on the same ticker
# appear in the batch.
_PER_CALL_CACHE: dict = {}


def _with_key(url: str) -> str:
    """Append apiKey as a query param — Massive/Polygon auth. Matches the
    verified snapshot curl and the worker's on-demand /v3/quotes fetch; the
    Bearer-header form is rejected. Applied to the initial URL AND every
    next_url (the cursor URL does not carry the key)."""
    if not MASSIVE_API_KEY:
        return url
    sep = "&" if ("?" in url) else "?"
    return f"{url}{sep}apiKey={urllib.parse.quote(MASSIVE_API_KEY)}"


def _contract_key(sym: str, cp_letter: str, strike, exp_mdy: str) -> str:
    """Match the same contract_key format used by the Schwab module
    and the contract_oi_snapshots table.

    Format: 'TICKER|C/P|float_strike|M/D/YYYY'
    Example: 'QCOM|C|192.5|8/7/2026'

    NOTE: exp_mdy is kept verbatim (not canonicalized) so the returned key
    is byte-identical to the Schwab module's make_key() and merges back
    correctly in oi_snapshots._fetch_oi_all_async. Only the internal chain
    LOOKUP canonicalizes the date (see _canon_mdy).
    """
    return f"{sym}|{cp_letter}|{float(strike)}|{exp_mdy}"


def _canon_mdy(s: str) -> str:
    """Canonical 'M/D/YYYY' (no leading zeros) from 'M/D/YYYY' or 'MM/DD/YYYY'.
    Used to make the chain lookup leading-zero-proof. '' if unparseable."""
    try:
        parts = str(s).strip().split("/")
        if len(parts) == 3:
            m, d, y = int(parts[0]), int(parts[1]), int(parts[2])
            if y < 100:
                y += 2000
            return f"{m}/{d}/{y}"
    except (ValueError, TypeError):
        pass
    return ""


def _parse_iso_date_to_mdy(iso_date: str) -> str:
    """Convert '2026-08-07' to '8/7/2026' to match worker convention."""
    try:
        dt = datetime.strptime(iso_date, "%Y-%m-%d")
        return f"{dt.month}/{dt.day}/{dt.year}"
    except (ValueError, TypeError):
        return ""


def _build_index_from_response(results, index: dict) -> None:
    """Index a Massive snapshot response into `index`, mapping
    (cp_letter, float_strike, canonical M/D/YYYY) -> OI int.

    Accepts `results` as a list of contract objects OR a single contract
    object (the single-contract route returns the latter). Contracts without
    OI, with OI<=0, or with unparseable details are skipped.
    """
    if isinstance(results, dict):
        results = [results]
    elif not results:
        return
    for item in results:
        if not isinstance(item, dict):
            continue
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
        ctype = (details.get("contract_type") or "").lower()
        if ctype == "call":
            cp_letter = "C"
        elif ctype == "put":
            cp_letter = "P"
        else:
            continue
        strike = details.get("strike_price")
        if strike is None:
            continue
        try:
            strike_f = float(strike)
        except (ValueError, TypeError):
            continue
        exp_mdy = _canon_mdy(_parse_iso_date_to_mdy(details.get("expiration_date") or ""))
        if not exp_mdy:
            continue
        index[(cp_letter, strike_f, exp_mdy)] = oi_int


def _fetch_chain_blocking(ticker: str) -> dict:
    """Blocking (run via asyncio.to_thread) full-chain snapshot for one
    underlying. Returns {(cp_letter, float_strike, 'M/D/YYYY'): oi_int}.
    Follows next_url pagination. Empty dict on any error (caller treats as
    'unresolved'). Stdlib urllib only — no httpx dependency."""
    if ticker in _PER_CALL_CACHE:
        return _PER_CALL_CACHE[ticker]

    url = _with_key(f"{MASSIVE_REST_BASE}/v3/snapshot/options/{ticker}"
                    f"?limit={MASSIVE_PAGE_LIMIT}")
    combined: dict = {}
    page = 0
    total_results_seen = 0

    while url and page < MAX_PAGES:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": _UCT_UA})
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_SEC) as resp:
                status = getattr(resp, "status", 200)
                if status != 200:
                    logger.warning("[massive-oi] %s page %d status=%d",
                                   ticker, page, status)
                    break
                data = _json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            logger.warning("[massive-oi] %s page %d request failed: %s",
                           ticker, page, e)
            break

        results = data.get("results")
        n = len(results) if isinstance(results, list) else (1 if results else 0)
        total_results_seen += n
        _build_index_from_response(results, combined)

        # Follow pagination if present (re-append apiKey — the cursor URL
        # carries the marker but not the key).
        next_url = data.get("next_url")
        if next_url:
            base = next_url if next_url.startswith("http") else f"{MASSIVE_REST_BASE}{next_url}"
            url = _with_key(base)
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

    def _norm_cp(cp) -> str:
        """Accept 'C'/'P' or flow-table 'CALL'/'PUT' — the chain index and
        the returned contract_keys both use the single letter."""
        return "C" if str(cp).upper() in ("C", "CALL") else "P"

    # Materialize so we can iterate twice (ticker grouping, then matching)
    # even if a generator was passed.
    batch = list(batch)

    # Unique underlyings to fetch (skip adjusted/when-issued symbols ending
    # in a digit — Massive may 404 on those).
    tickers = []
    seen = set()
    for entry in batch:
        try:
            sym, cp_letter, strike, exp_mdy = entry
        except (ValueError, TypeError):
            continue
        if not sym or sym[-1].isdigit():
            continue
        if sym not in seen:
            seen.add(sym)
            tickers.append(sym)

    if not tickers:
        return []

    # Bounded-concurrency chain fetches, each blocking urllib call off the
    # event loop via a thread.
    sem = asyncio.Semaphore(MAX_CONCURRENCY)

    async def _fetch_one(ticker):
        async with sem:
            idx = await asyncio.to_thread(_fetch_chain_blocking, ticker)
            return ticker, idx

    chain_results = await asyncio.gather(
        *[_fetch_one(t) for t in tickers], return_exceptions=False
    )
    chains_by_ticker = {t: idx for t, idx in chain_results}

    # Match each requested contract to its OI.
    results = []
    for entry in batch:
        try:
            sym, cp_letter, strike, exp_mdy = entry
        except (ValueError, TypeError):
            continue
        cp_letter = _norm_cp(cp_letter)
        ck = _contract_key(sym, cp_letter, strike, exp_mdy)
        chain_idx = chains_by_ticker.get(sym, {})
        try:
            strike_f = float(strike)
        except (ValueError, TypeError):
            results.append((ck, None))
            continue
        lookup_key = (cp_letter, strike_f, _canon_mdy(exp_mdy))
        oi = chain_idx.get(lookup_key)
        results.append((ck, oi))

    resolved = sum(1 for _, oi in results if oi is not None and oi > 0)
    logger.info(
        "[massive-oi] fetched %d tickers -> %d/%d contracts resolved",
        len(tickers), resolved, len(results)
    )
    return results


def _fetch_oi_all(contracts: Iterable[tuple]) -> list:
    """Synchronous wrapper (parity with the Schwab module's _fetch_oi_all)."""
    return asyncio.run(_fetch_oi_all_async(contracts))
