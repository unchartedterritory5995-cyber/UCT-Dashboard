"""Live batch pricing endpoint — returns real-time price data for up to 250 tickers.

Uses Massive.com batch snapshot API (Polygon-compatible).

Caching is TWO-tier (2026-07-01 scale pass, for the ~200-user launch):
  1. A whole-request fast path (one cache key per sorted ticker set) — a user
     polling the same list every 2s pays a single cache lookup.
  2. A SHARED PER-TICKER cache underneath it — so different users' overlapping
     tickers reuse each other's fetches instead of each firing its own Massive
     call (the old per-user cache-key fragmentation). One user fetching AAPL
     warms it for everyone.

A semaphore caps concurrent upstream Massive calls: after a deploy clears the
cache, 200 browsers resuming their 2s polls would otherwise fan out to ~200
simultaneous Massive fetches and exhaust the shared threadpool (the launch-day
524 scenario). The valve + herd-collapse re-check keep that to a handful.
"""
import hashlib
import threading
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from api.services.cache import TTLCache
from api.services.massive import _get_client, _detect_session

router = APIRouter()

# DEDICATED cache instance (not the 500-entry app singleton). The per-ticker
# refactor writes up to 250 `live_px1_*` keys + a whole-set key PER POLL; in
# the shared singleton that churned LRU evictions against bars/news/snapshot
# keys at launch scale, defeating the 15s TTL and re-creating the cold-herd
# semaphore pileup this two-tier design exists to prevent.
cache = TTLCache()

_MAX_TICKERS = 250  # Watchlists page sends every visible ticker in one request.
_CACHE_TTL = 15     # seconds — applies to both the whole-set and per-ticker caches

# Cap concurrent upstream Massive batch calls (cold-herd backpressure valve).
_MASSIVE_SEM = threading.Semaphore(6)
_SEM_WAIT_S = 8.0


def _px_key(tk: str) -> str:
    return f"live_px1_{tk}"


def _fetch_snapshots(client, tickers: list[str], session: str) -> dict:
    """One Massive batch call → {ticker: value_dict}."""
    tickers_param = ",".join(tickers)
    url = (
        f"https://api.massive.com/v2/snapshot/locale/us/markets/stocks/tickers"
        f"?tickers={tickers_param}&apiKey={client._api_key}"
    )
    # Short per-call timeout: this runs inside the Semaphore(6) valve on an anyio
    # threadpool worker. The client-level default read timeout is 25s (tuned for
    # large historical-bar fetches) — far too long for a 2s user poll. A slow Massive
    # would otherwise pin up to 6 workers for 25s each and, under a post-deploy cold
    # herd, exhaust the 64-worker pool (the launch-day 524 class). 5s caps that.
    data = client._get(url, timeout=5.0)

    def _f(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    out: dict = {}
    for t in data.get("tickers", []):
        ticker = t.get("ticker", "")
        if not ticker:
            continue
        day = t.get("day", {})
        prev_day = t.get("prevDay", {})
        last_trade = t.get("lastTrade", {})

        price = day.get("c") or last_trade.get("p") or prev_day.get("c") or 0.0
        volume = int(day.get("v") or 0)

        # The day % must be the REGULAR-SESSION move — day close vs prev close, the
        # exact thing the chart's close-vs-prev-close legend shows. Massive's
        # todaysChangePerc is based on the LAST TRADE (incl. after-hours), so after
        # the close it MIS-STATES the regular % (TWST: 2.93% vs the real 2.87%) AND
        # intermittently returns a stale 0. So ALWAYS derive from the closes when we
        # have them; a genuinely flat name still has day_c == prev_c → an honest 0.
        day_c = _f(day.get("c"))
        prev_c = _f(prev_day.get("c"))
        if day_c and prev_c and prev_c != 0:
            chg_pct = (day_c - prev_c) / prev_c * 100.0
            chg_abs = day_c - prev_c
        else:
            chg_pct = _f(t.get("todaysChangePerc"))
            chg_abs = _f(t.get("todaysChange"))
            # No day close AND no real change → too degraded to trust. OMIT the
            # ticker so callers keep their last-good value instead of a 0.00% blank.
            if chg_pct is None or chg_pct == 0.0:
                continue

        ext_price = None
        ext_session = None
        if session != "regular":
            lt_price = last_trade.get("p")
            if lt_price and float(lt_price) > 0:
                ext_price = round(float(lt_price), 2)
                ext_session = session

        out[ticker] = {
            "price": round(float(price), 2),
            # Recomputed above from day/prev close when Massive's field is a
            # spurious 0 — never a raw passthrough that flashes charts to 0.00%.
            "change_pct": round(chg_pct, 4) if chg_pct is not None else 0.0,
            "change": round(chg_abs, 4) if chg_abs is not None else 0.0,
            "volume": volume,
            "day_open": round(float(day.get("o") or 0), 2),
            "day_high": round(float(day.get("h") or 0), 2),
            "day_low": round(float(day.get("l") or 0), 2),
            "prev_close": round(float(prev_day.get("c") or 0), 2),
            # Today's REGULAR-session close — null pre-market (no day bar yet).
            # Powers the RH-style After-Hours split (move since the 4pm close).
            "day_close": round(float(day["c"]), 2) if day.get("c") else None,
            "ext_price": ext_price,
            "ext_session": ext_session,
        }
    return out


@router.get("/api/live-prices")
def get_live_prices(
    tickers: str = Query(..., description="Comma-separated ticker symbols (max 250)"),
):
    """Return real-time price snapshot for a batch of tickers.

    Response: {AAPL: {price, change_pct, change, volume, ...}, ...}
    """
    raw_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not raw_list:
        return JSONResponse(status_code=400, content={"error": "No tickers provided"})
    if len(raw_list) > _MAX_TICKERS:
        return JSONResponse(
            status_code=400,
            content={"error": f"Maximum {_MAX_TICKERS} tickers per request"},
        )

    unique = list(dict.fromkeys(raw_list))  # dedupe, preserve order

    # Tier 1: whole-request fast path (one lookup for a repeated identical poll).
    sorted_key = ",".join(sorted(set(unique)))
    whole_key = f"live_prices_{hashlib.md5(sorted_key.encode()).hexdigest()}"
    whole_hit = cache.get(whole_key)
    if whole_hit is not None:
        return whole_hit  # alerts already ran when this set was last built

    # Tier 2: assemble from the shared per-ticker cache; fetch only what's missing.
    result: dict = {}
    missing: list[str] = []
    for tk in unique:
        hit = cache.get(_px_key(tk))
        if hit is not None:
            result[tk] = hit
        else:
            missing.append(tk)

    if missing:
        try:
            client = _get_client()
        except Exception:
            client = None
        if client is not None:
            acquired = _MASSIVE_SEM.acquire(timeout=_SEM_WAIT_S)
            try:
                if acquired:
                    # Herd collapse: a concurrent request may have filled these
                    # while we waited on the semaphore — re-check before fetching.
                    still: list[str] = []
                    for tk in missing:
                        hit = cache.get(_px_key(tk))
                        if hit is not None:
                            result[tk] = hit
                        else:
                            still.append(tk)
                    if still:
                        session = _detect_session()
                        try:
                            fetched = _fetch_snapshots(client, still, session)
                        except Exception:
                            fetched = {}
                        for tk, val in fetched.items():
                            cache.set(_px_key(tk), val, ttl=_CACHE_TTL)
                            result[tk] = val
                # if not acquired within the wait: serve whatever the cache gave
                # us rather than piling another call onto a saturated upstream.
            finally:
                if acquired:
                    _MASSIVE_SEM.release()

    if not result:
        return JSONResponse(status_code=503, content={"error": "Pricing service unavailable"})

    cache.set(whole_key, result, ttl=_CACHE_TTL)

    # Price alerts run once per freshly-built set (mirrors the pre-refactor cadence
    # of running only on a cache miss, not on every repeated poll).
    try:
        from api.services.watchlist_alert_service import run_alert_check
        run_alert_check(result)
    except Exception:
        pass

    return result
