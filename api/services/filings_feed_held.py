"""READ ONLY: the SEC filings feed (FEED) as this server already holds it, for the market and for one stock.

`filings_feed.market_feed()` is cache-only already and is read as it is. `filings_feed.ticker_feed()` QUEUES a read of
the company's EDGAR submissions on a miss (`_schedule`, its own worker thread). A reader that must never cause that work
(the UCT Agent's `filings.feed` data kind, MD-1 §4.23) reads one stock through `held_ticker()` instead: the route's own
answer when the stock's submissions are held, built the route's way (the held submissions merged with any newer rows the
market poll holds for the same CIK, newest first, the form filter applied), or `not_held`. It never queues, never asks
the SEC and never writes the cache.

It lives beside the service and not inside it, so the service's own calls are unchanged. The cache keys are the
service's own (`_TICKER_PREFIX`, `_MARKET_KEY`), read at call time. A rail holds a stock through the service's own
`_refresh` over an invented SEC answer and checks `held_ticker` gives `ticker_feed`'s answer.
"""
from __future__ import annotations

from typing import Optional


def held_market(form: Optional[str] = None) -> dict:
    """READ ONLY: the market feed's route answer (`filings_feed.market_feed`, a cache read that starts nothing)."""
    from api.services import filings_feed as svc
    return svc.market_feed(form=form)


def held_ticker(sym: str, form: Optional[str] = None) -> tuple[Optional[dict], str]:
    """READ ONLY: `(answer, how)`; `how` is `held` (the route's own answer) or `not_held`. Never queues a read."""
    from api.services import filings_feed as svc
    from api.services.cache import cache
    sym = (sym or "").upper().strip()
    snap = cache.get(svc._TICKER_PREFIX + sym) if sym else None
    if not isinstance(snap, dict):
        return None, "not_held"
    if snap.get("state") != "ok":
        return {"state": snap.get("state"), "ticker": sym, "source": svc.SOURCE_SUBMISSIONS, "rows": None,
                "reason": snap.get("detail") or "unknown"}, "held"
    rows = list(snap.get("rows") or [])
    have = {r["accession"] for r in rows}
    market = cache.get(svc._MARKET_KEY) or {}
    newer = [dict(r, ticker=sym) for r in market.get("rows") or []
             if r.get("cik") == snap.get("cik") and r.get("accession") not in have]
    rows = sorted(newer + rows, key=lambda r: (r.get("accepted") or r.get("filed") or "", r["accession"]), reverse=True)
    if form:
        rows = [r for r in rows if svc.base_form(r["form"]) == svc.base_form(form)]
    out = {"state": "ok", "ticker": sym, "cik": snap.get("cik"), "company": snap.get("company"),
           "source": svc.SOURCE_SUBMISSIONS, "fetched_at": snap.get("fetched_at"), "merged_from_feed": len(newer),
           "rows": rows}
    if not rows:
        out["state"] = "none_in_scope"
        out["reason"] = ("SEC's recent-filings list for this company holds no "
                         + (form or "8-K, 10-Q, 10-K, Form 4, 13D/G or S-1") + " filing"
                         + f" (up to {svc.TICKER_ROWS} of each form are kept)")
    return out, "held"
