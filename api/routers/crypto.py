"""Currency pairs (Bitcoin, BTC/USD): the HTTP side of `api/crypto_bars.py`.

Dark behind `CRYPTO_BARS_ENABLED` (unset or 0 = off, `admin` = admins only, `1` = everyone
the chart-data gate admits). Three doors, one rule (`crypto_bars.allowed`):

  GET /api/crypto/pairs            the pairs this caller may read. It is how a page learns
                                   that `BTCUSD` is a currency pair: 404 means "treat it as
                                   any other symbol", which is what every page does today.
  GET /api/crypto/quote/{symbol}   the pair's quote, with the vendor's own time for the price.
  GET /api/bars/{symbol}           the chart's bars. That route lives in `routers/bars.py`;
                                   it hands an admitted pair to `pair_bars_response` below
                                   BEFORE its tier proxy and its stock/index serve, and
                                   everything else falls through untouched.
  GET /api/bars-history/{symbol}   the older, settled bars a chart reads on scroll-back; the
                                   same hand-off, to `pair_history_response`.

Off, the two routes here answer 404 to everyone (signed in or not), and `/api/bars/BTCUSD`
answers as it always has (the stock path, which carries no such stock).

⛔ THE BARS TIER AND THE EDGE. `bars-api` has no member identity, so a pair is served by the
web pod only. The Cloudflare Worker in front of `/api/bars/*` sends a stock-shaped symbol to
the tier first; the tier answers a pair with 501 (`bars_api_main._pair_handed_to_web`), which
the Worker's fall-back rule (any 5xx that is not a deliberate 503 shed) sends to web at once.
No Worker change and no Worker deploy: `tests/test_crypto_bars.py` pins both halves. In-process
callers of `bars.serve_bars` (Discord charts, the symbol resolver) do not come through here and
see a pair as an unknown symbol, as today.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from api import crypto_bars
from api.bars_auth import require_bars_access


def _armed() -> None:
    """Off answers 404 to everyone, before any sign-in check: the route does not exist."""
    if not crypto_bars.enabled():
        raise HTTPException(status_code=404, detail="Not found")


router = APIRouter(prefix="/api/crypto", tags=["crypto"], dependencies=[Depends(_armed)])


def _no_store(resp: JSONResponse) -> JSONResponse:
    resp.headers["Cache-Control"] = "no-store, must-revalidate"
    resp.headers["Pragma"] = "no-cache"
    return resp


def serves(ticker, access) -> bool:
    """Should the bars routes hand this request to this module? Only an exact pair, for a
    caller the switch admits. With the switch off this is False for everything."""
    return crypto_bars.is_pair(ticker) and crypto_bars.allowed(access)


def pair_bars_response(ticker, tf="D", bars=200, since="", to="") -> JSONResponse:
    """`/api/bars/{pair}` for an admitted caller. Never cached by a browser or the edge."""
    status, body = crypto_bars.serve_bars(ticker, tf, bars, since, to)
    resp = JSONResponse(status_code=status, content=body)
    if status == 503:
        resp.headers["Retry-After"] = "3"
        resp.headers["X-Bars-Shed"] = "warming"
    return _no_store(resp)


def pair_history_response(ticker, tf="D", bars=60000) -> JSONResponse:
    """`/api/bars-history/{pair}`: the pair's SETTLED bars, every bar whose own UTC bucket has
    ended. A chart opens on the newest 600 bars of `/api/bars` and reads the older ones here
    when the member scrolls back (`useLegacyChartBars` merges only an answer marked
    `sealed`); answering nothing here ended a pair's daily chart about 20 months back.

    The same held series as `/api/bars` (`crypto_bars.serve_bars`): never a vendor wait. The
    forming bar is left to `/api/bars`. Never cached by a browser or the edge, unlike a
    stock's sealed history: the switch can be turned off."""
    tf_s = tf.strip().upper() if isinstance(tf, str) and tf.strip() else "D"
    try:
        want = max(1, int(bars))
    except (TypeError, ValueError):
        want = 60000
    status, body = crypto_bars.serve_bars(ticker, tf_s, want + 1)
    if status == 503:
        resp = JSONResponse(status_code=503, content=body)
        resp.headers["Retry-After"] = "3"
        resp.headers["X-Bars-Shed"] = "warming"
        return _no_store(resp)
    settled = list(body.get("bars") or [])
    if settled and body.get("newest_bar_is_forming"):
        settled = settled[:-1]
    settled = settled[-want:]
    out = {"ticker": crypto_bars.normalize(ticker), "tf": tf_s, "bars": settled,
           "sealed": bool(settled), "last_sealed": settled[-1]["t"] if settled else "",
           "count": len(settled), "source": crypto_bars.SOURCE}
    if not settled and body.get("reason"):
        out["reason"] = body["reason"]
    return _no_store(JSONResponse(content=out))


@router.get("/pairs")
def pairs(access: dict = Depends(require_bars_access)):
    if not crypto_bars.allowed(access):
        raise HTTPException(status_code=404, detail="Not found")
    return _no_store(JSONResponse(content={"pairs": crypto_bars.pairs_public(),
                                           "source": crypto_bars.SOURCE}))


@router.get("/quote/{symbol}")
def quote(symbol: str, access: dict = Depends(require_bars_access)):
    if not crypto_bars.allowed(access) or not crypto_bars.is_pair(symbol):
        raise HTTPException(status_code=404, detail="Not found")
    return _no_store(JSONResponse(content=crypto_bars.quote(symbol)))
