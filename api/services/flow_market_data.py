"""Spot prices, the index strip, market caps and one option contract's quote for the flow pages.

Schwab's market-data API was retired from the product on 2026-11-17 by the owner's instruction
("Move it, fix the status and remove schwab from everything"). Everything that used to read it for
these four things reads here now:

  * `equity_spots` / `equity_spot`   last price of a stock or ETF    Massive equities snapshot
  * `market_summary`                 SPY / QQQ / DIA / IWM strip      Massive equities snapshot
  * `massive_option_quote`           one option contract              Massive options snapshot
  * `unpriced_option_results`        the starting list for POST /api/schwab/options-quotes
                                     (Unusual Whales, then Massive, fill it in the router)
  * `mktcap_batch`                   market caps                      flow DB, then Yahoo (unchanged legs)

No function here raises: a vendor failure is an empty answer, and an empty answer is never a 0.

WHAT A NUMBER MEANS, WHERE THE TWO VENDORS DIFFER (said once, here):
  * A stock's price. Schwab sent `lastPrice`, its last trade. Massive's snapshot carries
    `lastTrade.p`, the last trade print (extended hours included); when Massive has no trade on
    record this falls back to the day's close, then the previous close.
  * An option contract's `mark`. Schwab sent its own mark. Massive: the bid/ask midpoint, else the
    last trade (the same rule `api/top_flow_tracker.py` records with).
  * An option contract's `iv`. Schwab sent a percent (35.2); Massive sends a fraction (0.352).
    GET /api/schwab/options-quote keeps the percent it always returned (`massive_option_quote`
    multiplies by 100). The Massive fill in POST /api/schwab/options-quotes passes the fraction
    through as sent, as it has since 2026-07-20; that route is not changed here.
  * `bid` and `ask` of one contract: the Massive helper returns the midpoint, not the two sides,
    so they are null. Null, never 0: 0 would read as "no bid".
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

# One Massive batch snapshot carries every requested ticker, so a request for N tickers is ONE
# vendor call (the Schwab path made one call per ticker). The cap is the caller's own (200).
SPOT_BATCH_MAX = 200
SPOT_TIMEOUT_S = 10.0

MARKET_SYMBOLS = ["SPY", "QQQ", "DIA", "IWM"]
_DISPLAY_NAMES = {"SPY": "S&P 500", "QQQ": "NASDAQ", "DIA": "DOW 30", "IWM": "Russell 2000"}


def _positive(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f > 0 else None


def _percent(fraction):
    """A fraction as a percent (0.352 -> 35.2); None, a non-number or a NaN stays None."""
    try:
        f = float(fraction)
    except (TypeError, ValueError):
        return None
    return round(f * 100, 4) if f == f else None


def _last_price(t: dict):
    """Last trade, else the day's close, else the previous close; None when none is positive."""
    return (_positive((t.get("lastTrade") or {}).get("p"))
            or _positive((t.get("day") or {}).get("c"))
            or _positive((t.get("prevDay") or {}).get("c")))


def _batch_snapshot_blocking(symbols: list) -> dict:
    """{ticker: Massive's raw snapshot row}. {} on any failure (no key, budget spent, vendor error).
    Goes through the app's Massive equities client, so its rate limit and symbol mapping apply."""
    try:
        from api.services import massive
        result = massive._get_client().get_batch_quotes(symbols)
    except Exception as e:  # noqa: BLE001 - typed provider errors included; never raise from here
        logger.warning("[flow-market-data] Massive snapshot failed: %s", type(e).__name__)
        return {}
    value = getattr(result, "value", None)
    return value if isinstance(value, dict) else {}


async def equity_spots(symbols) -> dict:
    """{ticker: last price} for the tickers Massive priced. A ticker it did not price is absent."""
    wanted = []
    for s in symbols or []:
        s = str(s or "").upper().strip()
        # An index ("$SPX") or a dotted symbol was never quoted on this path; still is not.
        if s and not s.startswith("$") and "." not in s and s not in wanted:
            wanted.append(s)
    wanted = wanted[:SPOT_BATCH_MAX]
    if not wanted:
        return {}
    try:
        rows = await asyncio.wait_for(asyncio.to_thread(_batch_snapshot_blocking, wanted),
                                      timeout=SPOT_TIMEOUT_S)
    except Exception as e:  # noqa: BLE001 - a timeout is an empty answer
        logger.warning("[flow-market-data] spot read failed: %s", type(e).__name__)
        return {}
    out = {}
    for sym in wanted:
        price = _last_price(rows.get(sym) or {})
        if price is not None:
            out[sym] = price
    return out


async def equity_spot(symbol):
    """Last price of one stock or ETF, or None."""
    sym = str(symbol or "").upper().strip()
    return (await equity_spots([sym])).get(sym)


async def market_summary() -> list:
    """[{symbol, name, price, change, pct}] for SPY, QQQ, DIA, IWM, from one Massive snapshot.

    `change` and `pct` are against the previous session's close, as before. A ticker Massive did not
    price is left out. When Massive answers nothing the result is the one-row error shape the route
    has always returned for a failed read.

    VIX IS NOT HERE. It was read from Schwab alone and this codebase holds no other licensed VIX
    quote, so the row is left out, never written as 0. (Reported to the owner, 2026-11-17.)
    """
    try:
        rows = await asyncio.wait_for(asyncio.to_thread(_batch_snapshot_blocking, list(MARKET_SYMBOLS)),
                                      timeout=SPOT_TIMEOUT_S)
    except Exception as e:  # noqa: BLE001
        logger.warning("[flow-market-data] market summary failed: %s", type(e).__name__)
        rows = {}
    results = []
    for sym in MARKET_SYMBOLS:
        t = rows.get(sym) or {}
        last = _last_price(t)
        if last is None:
            continue
        close = _positive((t.get("prevDay") or {}).get("c"))
        change = last - close if close else 0
        pct = (change / close * 100) if close else 0
        results.append({
            "symbol": sym,
            "name": _DISPLAY_NAMES.get(sym, sym),
            "price": round(last, 2),
            "change": round(change, 2),
            "pct": round(pct, 2),
        })
    return results or [{"error": "Market data unavailable"}]


# ── option contracts ──────────────────────────────────────────────────────────

def _iso_to_mdy(exp_iso: str):
    """'2026-03-20' -> '3/20/2026' (the form the Massive helpers key on), or None."""
    try:
        d = datetime.strptime(str(exp_iso or "").strip(), "%Y-%m-%d")
    except ValueError:
        return None
    return f"{d.month}/{d.day}/{d.year}"


def _today():
    return datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)


def unpriced_option_results(contracts: list) -> list:
    """One result per requested contract, in order, before any source has answered.

    An expired contract (or one whose date cannot be read) is marked `expired` and no source is
    asked for it; a contract with a bad strike gets its own error. Every other contract starts as
    an error result, which is what makes POST /api/schwab/options-quotes hand it to its sources.
    The shapes are the ones the route has always returned for these cases.
    """
    today = _today()
    out = []
    for c in contracts or []:
        c = c if isinstance(c, dict) else {}
        sym = str(c.get("symbol") or "").upper()
        cp = str(c.get("cp") or "").upper()
        try:
            strike = float(c.get("strike") or 0)
        except (TypeError, ValueError):
            out.append({"symbol": sym, "cp": cp, "error": "Bad strike"})
            continue
        exp_raw = c.get("expDate", "")
        try:
            expired = datetime.strptime(str(exp_raw), "%Y-%m-%d") < today
        except ValueError:
            expired = True
        if expired:
            out.append({"symbol": c.get("symbol", ""), "strike": strike, "cp": c.get("cp", ""),
                        "error": f"Expired ({exp_raw})", "expired": True})
        else:
            out.append({"symbol": sym, "strike": strike, "cp": cp, "error": "No quote yet"})
    return out


async def massive_option_quote(symbol: str, strike: float, exp_date: str, cp: str) -> dict:
    """One contract's quote from Massive's single-contract options snapshot, in the keys
    GET /api/schwab/options-quote has always returned. `exp_date` is 'YYYY-MM-DD' and must be the
    contract's own expiry (the Schwab read matched the nearest expiry within five days; this one
    does not guess). See the module docstring for what `mark` means and why `bid`, `ask` are
    null. `iv` is a percent."""
    sym = str(symbol or "").upper().strip()
    cpl = "C" if str(cp or "").upper().startswith("C") else "P"
    exp_mdy = _iso_to_mdy(exp_date)
    if exp_mdy is None:
        return {"error": f"Bad date ({exp_date})"}
    if datetime.strptime(exp_date.strip(), "%Y-%m-%d") < _today():
        return {"error": f"Expired contract ({exp_date})", "expired": True}
    try:
        from api import massive_oi_snapshots as massive
        if not massive.MASSIVE_API_KEY:
            return {"error": "MASSIVE_API_KEY not set"}
        fmap = await asyncio.wait_for(
            massive._fetch_fields_all_async([(sym, cpl, float(strike), exp_mdy)]),
            timeout=massive.HTTP_TIMEOUT_SEC + 3)
        f = (fmap or {}).get(massive._contract_key(sym, cpl, float(strike), exp_mdy))
    except Exception as e:  # noqa: BLE001
        logger.warning("[flow-market-data] option quote failed: %s", type(e).__name__)
        return {"error": "Option quote unavailable"}
    if not isinstance(f, dict):
        return {"error": f"No contract found for {sym} {strike}{cpl} at {exp_date}"}
    last = _positive(f.get("last"))
    mark = _positive(f.get("mid")) or last
    return {
        "symbol": sym,
        "strike": strike,
        "expDate": exp_date,
        "cp": cpl,
        "bid": None,
        "ask": None,
        "last": last,
        "mark": mark,
        "volume": f.get("volume"),
        "openInterest": f.get("oi"),
        # a PERCENT, as this route always returned (Massive sends a fraction: x 100; null stays null)
        "iv": _percent(f.get("iv")),
        "delta": f.get("delta"),
        "gamma": f.get("gamma"),
        "theta": f.get("theta"),
        "underlyingPrice": _positive(f.get("underlying")),
    }


# ── market caps ───────────────────────────────────────────────────────────────

async def mktcap_batch(symbols: list) -> dict:
    """
    Market cap for a batch of tickers. Tries the local flow DB first (instant, no external calls;
    covers any ticker that has ever appeared in options flow), then Yahoo's v7 quote endpoint, then
    Yahoo's v10 quoteSummary per symbol. These are the legs this lookup has always had; the Schwab
    leg that sat between the flow DB and Yahoo is gone.

    Returns: { "AAPL": 2940000000000, "MSFT": 3100000000000, ... }
    Symbols missing from all providers are simply omitted.
    """
    import httpx

    results = {}
    symbols = [s.strip().upper() for s in symbols if s]
    if not symbols:
        return results

    # ── Path 0: flow DB (fastest — no network, no auth, ~100% coverage on
    # any ticker that's appeared in options flow CSV exports) ──
    try:
        # Import lazily so this module doesn't hard-fail if flow_db isn't
        # available (some deploys may not have it).
        try:
            from api.flow_db import FlowDB
        except ImportError:
            from flow_db import FlowDB
        flow = FlowDB()
        flow_mc = flow.get_mktcap_batch(symbols)
        if flow_mc:
            results.update(flow_mc)
            logger.info("[mktcap] flow DB resolved %d/%d", len(flow_mc), len(symbols))
    except Exception as e:
        logger.warning("[mktcap] flow DB lookup failed: %s", e)

    # If flow DB gave us everything, skip the external API calls entirely
    still_missing = [s for s in symbols if s not in results]
    if not still_missing:
        return results

    # ── Path 1: Yahoo v7 quote (batch capable, returns marketCap field) ──
    # The /v7/finance/quote endpoint returns marketCap directly per symbol
    # in quoteResponse.result[]. Sometimes Yahoo demands a "crumb" cookie;
    # most of the time the bare call still works for US equities. We send
    # all missing symbols in one request (Yahoo allows ~200 per call).
    logger.info("[mktcap] Yahoo v7 fallback for %d symbol(s): %s",
                len(still_missing), still_missing[:5])
    ua = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
          "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
    async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
        try:
            resp = await client.get(
                "https://query1.finance.yahoo.com/v7/finance/quote",
                params={"symbols": ",".join(still_missing[:200])},
                headers={"User-Agent": ua, "Accept": "application/json"},
            )
            if resp.status_code == 200:
                items = (resp.json().get("quoteResponse", {}) or {}).get("result", []) or []
                for q in items:
                    sym = (q.get("symbol") or "").upper()
                    mc = q.get("marketCap") or 0
                    if sym and mc and mc > 0:
                        results[sym] = mc
            else:
                logger.warning("[mktcap] Yahoo v7 HTTP %s", resp.status_code)
        except Exception as e:
            logger.warning("[mktcap] Yahoo v7 error: %s", e)

    # ── Path 2: Yahoo v10 quoteSummary per-symbol (last resort) ──
    # Some symbols (recent IPOs, non-US listings) fail the v7 batch. Hit
    # quoteSummary one at a time as a final attempt. modules=price returns
    # marketCap.raw which is the canonical Yahoo number.
    final_missing = [s for s in symbols if s not in results]
    if final_missing:
        logger.info("[mktcap] Yahoo v10 per-symbol fallback for %d: %s",
                    len(final_missing), final_missing[:5])
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            for sym in final_missing[:50]:
                try:
                    resp = await client.get(
                        f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{sym}",
                        params={"modules": "price"},
                        headers={"User-Agent": ua, "Accept": "application/json"},
                    )
                    if resp.status_code == 200:
                        result = (((resp.json().get("quoteSummary", {}) or {})
                                   .get("result", []) or [{}])[0])
                        price = result.get("price", {}) or {}
                        mc_obj = price.get("marketCap") or {}
                        mc = mc_obj.get("raw") if isinstance(mc_obj, dict) else mc_obj
                        if mc and mc > 0:
                            results[sym] = mc
                except Exception:
                    continue

    logger.info("[mktcap] Final: resolved %d/%d symbols", len(results), len(symbols))
    return results
