"""Insider transaction feed — FMP primary, Finnhub fallback.

Per-ticker: FMP `stable/insider-trading/search?symbol={ticker}` is the
PRIMARY leg (Task 10, 2026-08-05 data-dependability migration) — paid,
richer (real `typeOfOwner` role text, deeper history) than the free-tier
Finnhub endpoint it replaces. Falls back to Finnhub
`GET /stock/insider-transactions?symbol={ticker}` when FMP fails (missing
key, timeout, outage) — that Finnhub endpoint is NOT known-403 on this plan
(unlike `/stock/upgrade-downgrade` etc.), so the fallback is a real safety
net, not a dead branch.

Feed: aggregate notable insider buys across UCT20 + broad market watchlist.

── Sign derivation (the highest-risk part of this migration) ───────────────
Finnhub's `transactionCode` is a single letter (`"P"`=purchase,
`"S"`=sale, ...); FMP's `transactionType` is a hyphenated code
(`"S-Sale"`, `"M-Exempt"`, `"P-Purchase"`, ...) plus a SEPARATE
`acquisitionOrDisposition` field (`"A"`=acquire, `"D"`=dispose). Live
FMP data (probed 2026-08-05, 500 market-wide rows) shows the letter
prefix of `transactionType` and `acquisitionOrDisposition` pairing
1:1 for every code observed (S-Sale <-> D, P-Purchase <-> A, etc.), but
`_classify_txn_fmp` still DERIVES the buy/sell sign from
`acquisitionOrDisposition` alone rather than assuming it from the code
label, and EXCLUDES any row where that field is missing/blank rather than
defaulting it to "A" (acquire) — the `Number(null) === 0` bug family in a
different shape. ~3% of live rows carry an empty string for both fields
and must not silently become a fabricated buy signal.

── C18 cache-completeness (Task 10) ─────────────────────────────────────────
Per-ticker (`get_insider_activity`): a fetch failure (BOTH FMP and the
Finnhub fallback failing — network error/timeout/non-200/no key) is cached
at the short `_PER_TICKER_FAIL_TTL` via `cache_policy.set_by_completeness`,
never the 4h success TTL. A ticker with zero QUALIFYING transactions from a
SUCCESSFUL fetch (a real fetch that just found nothing to classify as
buy/sell) is a genuinely complete empty result and still gets the full 4h
TTL — the two are not the same thing and must not be conflated in either
direction.
"""
from __future__ import annotations

import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

import requests

from api.services.cache import cache
from api.services.cache_policy import set_by_completeness
from api.services.finnhub_client import fh_get, fh_budget_denied_total

_logger = logging.getLogger(__name__)

_PER_TICKER_TTL = 4 * 3600       # 4 hours — success TTL (FMP or Finnhub)
_PER_TICKER_FAIL_TTL = 300       # 5 min — BOTH providers failed (C18 fix)
_FEED_TTL = 3600                 # 1 hour
_FEED_FAIL_TTL = 300             # 5 min — used when a provider was denied/failed mid-fan-out

_FMP_TIMEOUT = 8                 # own bounded timeout — never routed through
                                  # finnhub_client's shared token bucket/budget

# Process-lifetime count of per-ticker fetches where BOTH providers failed
# outright (as opposed to one succeeding with a genuinely empty result).
# Mirrors finnhub_client.fh_budget_denied_total's idiom: `get_recent_insider_buys`
# snapshots this before/after its fan-out to distinguish "some tickers were
# never actually reached" from "market is just quiet this week" — needed
# because FMP is now primary and its failures never touch Finnhub's own
# budget-denial counter (that counter alone went blind to the dominant
# failure mode the moment FMP became primary).
_fetch_fail_total = 0
_fetch_fail_lock = threading.Lock()


def _note_fetch_fail() -> None:
    global _fetch_fail_total
    with _fetch_fail_lock:
        _fetch_fail_total += 1


def fetch_fail_total() -> int:
    """Cumulative (process-lifetime) count of per-ticker insider fetches
    where BOTH FMP and the Finnhub fallback failed. Monotonically
    increasing — callers compare two snapshots, never read it as an
    absolute count of "current" anything."""
    return _fetch_fail_total


def _fmp_get_insider(ticker: str) -> list[dict] | None:
    """Fire the FMP `stable/insider-trading/search` GET for one ticker.

    Returns the raw row list on success — possibly EMPTY; a ticker with
    zero recent filings is a genuine, COMPLETE result, not a failure — or
    None on any failure (missing key, timeout, non-200, malformed body).

    Own tiny client (matches the idiom already in
    api/services/catalyst/analyst_actions.py::_fmp_get) — FMP is a
    different provider from Finnhub and must never touch
    finnhub_client's token bucket / cooldown.
    """
    key = os.environ.get("FMP_API_KEY", "")
    if not key:
        return None
    try:
        r = requests.get(
            "https://financialmodelingprep.com/stable/insider-trading/search",
            params={"symbol": ticker.upper(), "apikey": key},
            timeout=_FMP_TIMEOUT,
        )
        r.raise_for_status()
        data = r.json()
    except Exception as exc:
        _logger.warning("FMP insider-trading/search failed for %s: %s", ticker, exc)
        return None
    if not isinstance(data, list):
        return None
    return data


def _fetch_insider_raw(ticker: str) -> tuple[list[dict], bool]:
    """Fetch raw insider rows for one ticker. FMP primary, Finnhub fallback.

    Returns ``(rows, fetched_ok)``. ``fetched_ok=False`` means BOTH
    providers failed outright — distinct from a provider succeeding with a
    genuinely empty row list, which is ``fetched_ok=True`` with
    ``rows=[]``. Drives the C18 cache-completeness fix in
    ``get_insider_activity`` below.
    """
    fmp_rows = _fmp_get_insider(ticker)
    if fmp_rows is not None:
        return fmp_rows, True

    data = fh_get("/stock/insider-transactions", {"symbol": ticker.upper()}, timeout=15)
    if isinstance(data, dict):
        raw = data.get("data", [])
        return (raw if isinstance(raw, list) else []), True

    _note_fetch_fail()
    return [], False


def get_insider_activity(ticker: str) -> list[dict]:
    """Return recent insider transactions for a single ticker (cached 4h
    on success, `_PER_TICKER_FAIL_TTL` on a total fetch failure).

    FMP is the primary provider (see module docstring); Finnhub is the
    fallback, routed through the shared `api.services.finnhub_client.fh_get`
    so it shares the process-wide token bucket / 429 cooldown with every
    other Finnhub caller instead of spending the same account budget
    uncoordinated.
    """
    cache_key = f"insider_{ticker}"
    hit = cache.get(cache_key)
    if hit is not None:
        return hit

    raw_rows, fetched_ok = _fetch_insider_raw(ticker)

    # Normalize to a clean shape, most recent first
    txns = []
    for r in raw_rows:
        if not isinstance(r, dict):
            continue
        txn_type = _classify_txn(r)
        if txn_type is None:
            continue
        shares, price = _row_shares_price(r)
        if shares is None:
            continue
        txns.append({
            "name": _row_name(r),
            "title": _clean_title(r),
            "type": txn_type,        # "buy" or "sell"
            "shares": abs(int(shares)),
            "price": round(price, 2),
            "amount": round(abs(shares * price), 2),
            "date": r.get("transactionDate", ""),
            "filing_date": r.get("filingDate", ""),
        })

    # Sort by transaction date descending
    txns.sort(key=lambda t: t["date"], reverse=True)

    set_by_completeness(
        cache_key, txns,
        complete=fetched_ok,
        ttl_ok=_PER_TICKER_TTL,
        ttl_partial=_PER_TICKER_FAIL_TTL,
    )
    return txns


def get_recent_insider_buys() -> list[dict]:
    """Return notable insider buys across the market in the last 7 days.

    Pulls from a broad watchlist of UCT20 + large-cap tickers.
    """
    cache_key = "insider_feed"
    hit = cache.get(cache_key)
    if hit is not None:
        return hit

    # Pull current UCT20 tickers from wire data if available
    tickers = _get_feed_tickers()
    cutoff = (datetime.utcnow() - timedelta(days=7)).strftime("%Y-%m-%d")

    # Parallelize the per-ticker fetches (FMP primary, Finnhub fallback).
    # Each get_insider_activity is independently cached (4h success /
    # 5min fail), so a 10-wide pool turns ~55 sequential fetches into a
    # few concurrent waves.
    def _fetch(tk: str):
        try:
            return tk, get_insider_activity(tk)
        except Exception:
            return tk, []

    # Snapshot both process-wide failure signals before the fan-out.
    # fh_budget_denied_total catches the Finnhub-fallback-specific case
    # (its own per-minute budget shed mid-fan-out); fetch_fail_total
    # catches the general case (BOTH providers failed for a ticker,
    # e.g. an FMP outage) that fh_budget_denied_total is structurally
    # blind to now that FMP is primary — a budget-shed OR a genuine
    # dual-provider miss returns [] indistinguishably from "no insider
    # buys this week"; caching that partial batch at the full 1h success
    # TTL would starve the feed of names simply never reached this pass.
    denied_before = fh_budget_denied_total()
    fail_before = fetch_fail_total()
    buys: list[dict] = []
    with ThreadPoolExecutor(max_workers=10) as ex:
        for tk, txns in ex.map(_fetch, tickers):
            for t in txns:
                if t["type"] != "buy":
                    continue
                if t["date"] < cutoff:
                    continue
                buys.append({**t, "symbol": tk})
    throttled = (fh_budget_denied_total() > denied_before) or (fetch_fail_total() > fail_before)

    # Sort by dollar amount descending — most notable first
    buys.sort(key=lambda b: b["amount"], reverse=True)
    result = buys[:50]  # cap at 50
    cache.set(cache_key, result, _FEED_FAIL_TTL if throttled else _FEED_TTL)
    return result


def has_recent_insider_buy(ticker: str, days: int = 30) -> bool:
    """Quick check: did any insider buy this ticker in the last N days?"""
    cutoff = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")
    txns = get_insider_activity(ticker)
    return any(t["type"] == "buy" and t["date"] >= cutoff for t in txns)


# ── Helpers ──────────────────────────────────────────────────────────────────


def _row_shares_price(r: dict) -> tuple[float, float] | tuple[None, None]:
    """(shares, price) for one row, or (None, None) if unparseable.

    FMP rows carry `securitiesTransacted`/`price`; Finnhub rows carry
    `share`/`transactionPrice` (Finnhub extraction UNCHANGED from before
    this migration)."""
    if "transactionType" in r:  # FMP shape
        shares = r.get("securitiesTransacted")
        price = r.get("price")
    else:  # Finnhub shape (unchanged)
        shares = r.get("share")
        price = r.get("transactionPrice")
    shares = shares if shares is not None else 0
    price = price if price is not None else 0
    try:
        return float(shares), float(price)
    except (TypeError, ValueError):
        return None, None


def _row_name(r: dict) -> str:
    if "transactionType" in r:  # FMP shape
        return r.get("reportingName", "Unknown")
    return r.get("name", "Unknown")  # Finnhub shape (unchanged)


def _classify_txn(r: dict) -> str | None:
    """Classify one insider row as 'buy'/'sell', or None to skip.

    Dispatches on shape: FMP `stable/insider-trading/search` rows carry
    `transactionType` (a hyphenated code, e.g. "S-Sale", "M-Exempt") —
    routed to `_classify_txn_fmp`. Finnhub `/stock/insider-transactions`
    rows carry the older single-letter `transactionCode` — this branch is
    UNCHANGED from before the migration (fallback path; kept live, that
    endpoint is not known-403 on this plan)."""
    if "transactionType" in r:
        return _classify_txn_fmp(r)

    # -- Finnhub fallback path (unchanged) --
    code = r.get("transactionCode", "")
    # P = open-market purchase, S = open-market sale
    # Also accept A (grant/award) as informational but skip for now
    if code == "P":
        return "buy"
    if code == "S":
        return "sell"
    # Skip grants, exercises, gifts, etc.
    return None


def _classify_txn_fmp(r: dict) -> str | None:
    """FMP direction derivation (Task 10, 2026-08-05) — see module docstring
    "Sign derivation" for the full rationale.

    `transactionType`'s letter prefix narrows to genuine open-market
    Purchase/Sale rows only ("P-Purchase"/"S-Sale") — mirrors the Finnhub
    branch above (grants/exercises/gifts/conversions/awards are skipped
    there too, same scope). The ACTUAL buy/sell sign is derived from
    `acquisitionOrDisposition` ("A"=acquire, "D"=dispose) — never assumed
    from the transactionType label. A blank/missing/unrecognized direction
    EXCLUDES the row — never defaults to "A" (acquire)."""
    code = str(r.get("transactionType") or "")
    letter = code.split("-", 1)[0].strip().upper()
    if letter not in ("P", "S"):
        return None

    direction = r.get("acquisitionOrDisposition")
    if direction is None:
        return None
    direction = str(direction).strip().upper()
    if direction == "A":
        return "buy"
    if direction == "D":
        return "sell"
    return None  # unrecognized/blank direction -- exclude, never default


def _clean_title(r: dict) -> str:
    """Extract a human-readable title from an insider row.

    FMP's insider-trading/search supplies a real `typeOfOwner` (e.g.
    "officer: SVP, GC and Secretary") — use it directly when present.
    Finnhub's insider-transactions has no title field at all; that branch
    is UNCHANGED from before the migration (generic placeholder — kept
    for the fallback path)."""
    owner = r.get("typeOfOwner")
    if owner and str(owner).strip():
        return str(owner).strip()
    # Finnhub doesn't provide title directly in insider-transactions;
    # use the 'name' field which sometimes includes title info.
    # The transactionType field has codes, not readable titles.
    # We fall back to a generic label.
    change = r.get("change", 0)
    if change and abs(change) > 100_000:
        return "Officer/Director"
    return "Officer/Director"


def _get_feed_tickers() -> list[str]:
    """Get tickers to scan for the feed — UCT20 + broad watchlist."""
    tickers = set()

    # Try to get UCT20 from cache
    wire = cache.get("wire_data")
    if wire and isinstance(wire, dict):
        leadership = wire.get("leadership", [])
        for item in leadership[:20]:
            sym = item.get("ticker") or item.get("sym") or item.get("symbol")
            if sym:
                tickers.add(sym.upper())

    # Add a broad watchlist of commonly-followed large caps
    _WATCHLIST = [
        "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA",
        "JPM", "BAC", "GS", "WFC", "V", "MA",
        "UNH", "JNJ", "PFE", "ABBV", "LLY",
        "XOM", "CVX", "COP",
        "HD", "WMT", "COST", "TGT",
        "CRM", "ORCL", "ADBE", "NOW",
        "AMD", "INTC", "AVGO", "QCOM",
        "DIS", "NFLX", "CMCSA",
        "BA", "CAT", "GE", "RTX",
    ]
    tickers.update(_WATCHLIST)
    return list(tickers)
