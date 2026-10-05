"""LCQ-02 support for `api/gex_service.py`: the Massive chain's server-side cache, and the
per-strike parity diff that `GEX_CHAIN_SOURCE=shadow` logs.

⛔ NO GEX ARITHMETIC LIVES HERE. The one formula is `api/gex_service.py::get_gex_data`
(`gamma * oi * 100 * spot**2 * 0.01`), and both sources reach it through Schwab's chain shape.
This module only (a) bounds how often the Massive snapshot is walked, and (b) compares two
results that formula already produced.

Request budget, in one place:
  * one walk per (ticker, from, to) per `CHAIN_TTL_S`  -- the cache below;
  * concurrent identical requests share ONE walk         -- the single-flight below;
  * each walk is capped at 48 pages / 25 s with truncation reported
                                                         -- `gex_service._fetch_chain_massive`.
An ERROR is never cached: the next request retries instead of serving a stale failure.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Awaitable, Callable, Optional

from api.services.cache import TTLCache

logger = logging.getLogger("gex")

CHAIN_TTL_S = 60.0
_CHAIN_CACHE = TTLCache(max_size=128)
_INFLIGHT: dict[str, "asyncio.Future"] = {}
# Background shadow comparisons hold a strong reference here until they finish, so the loop
# cannot garbage-collect one mid-flight (asyncio keeps only weak references to tasks).
_SHADOW_TASKS: set = set()


def chain_key(ticker: str, from_date: str, to_date: str) -> str:
    return f"gexmassive::{ticker.upper()}::{from_date}::{to_date}"


def clear_cache() -> None:
    _CHAIN_CACHE.clear()
    _INFLIGHT.clear()


async def cached_chain(ticker: str, from_date: str, to_date: str,
                       fetch: Callable[[str, str, str], Awaitable[tuple]]) -> tuple:
    """(data, error) for one chain window, walked at most once per CHAIN_TTL_S.

    `fetch` is the uncached walk. A success is cached; an error is returned and NOT cached.
    Callers that arrive while a walk for the same key is running await that walk."""
    key = chain_key(ticker, from_date, to_date)
    hit = _CHAIN_CACHE.get(key)
    if hit is not None:
        return hit, None
    running = _INFLIGHT.get(key)
    if running is not None and running.get_loop() is asyncio.get_running_loop():
        # shield: a caller that goes away (client disconnect) must not cancel the walk the
        # other callers are waiting on.
        return await asyncio.shield(running)
    fut = asyncio.ensure_future(fetch(ticker, from_date, to_date))
    _INFLIGHT[key] = fut

    def _settle(f) -> None:
        if _INFLIGHT.get(key) is f:
            _INFLIGHT.pop(key, None)
        if f.cancelled() or f.exception() is not None:
            return
        data, err = f.result()
        if err is None and data is not None:
            _CHAIN_CACHE.set(key, data, CHAIN_TTL_S)

    fut.add_done_callback(_settle)
    return await asyncio.shield(fut)


# ── Per-strike parity ─────────────────────────────────────────────────────────

def _uncomputable(result: dict) -> set:
    return {s["strike"] for s in (result.get("strikesUncomputable") or [])}


def strike_diff(schwab: dict, massive: dict) -> list:
    """Per strike over the UNION of both results: [strike, schwab_gex, massive_gex, status].

    A side's value is None when that side has no number for the strike, and the status says
    WHY -- `<side>_uncomputable` (the source returned the contracts without gamma or open
    interest) is a different fact from `<side>_absent` (the source returned no such strike).
    Neither is ever written as 0."""
    sa = {s["strike"]: s["gex"] for s in (schwab.get("strikes") or [])}
    sb = {s["strike"]: s["gex"] for s in (massive.get("strikes") or [])}
    ua, ub = _uncomputable(schwab), _uncomputable(massive)
    rows = []
    for k in sorted(set(sa) | set(sb) | ua | ub):
        a, b = sa.get(k), sb.get(k)
        if a is not None and b is not None:
            status = "both"
        elif a is None and b is None:
            status = "both_uncomputable"
        elif a is None:
            status = "schwab_uncomputable" if k in ua else "schwab_absent"
        else:
            status = "massive_uncomputable" if k in ub else "massive_absent"
        rows.append([k, a, b, status])
    return rows


def agreement(schwab: dict, massive: dict) -> dict:
    """Sign agreement and |GEX| Spearman rank correlation over the strikes BOTH sides computed.
    The one implementation behind both `/api/gex/source-parity` and the shadow log."""
    sa = {s["strike"]: s["gex"] for s in schwab["strikes"]}
    sb = {s["strike"]: s["gex"] for s in massive["strikes"]}
    common = sorted(set(sa) & set(sb))
    same_sign = sum(1 for k in common if (sa[k] >= 0) == (sb[k] >= 0))

    def ranks(vals):
        order = sorted(range(len(vals)), key=lambda i: vals[i])
        r = [0.0] * len(vals)
        for pos, i in enumerate(order):
            r[i] = float(pos)
        return r

    rho = None
    if len(common) >= 3:
        ra, rb = ranks([abs(sa[k]) for k in common]), ranks([abs(sb[k]) for k in common])
        n = len(common)
        rho = round(1 - 6 * sum((x - y) ** 2 for x, y in zip(ra, rb)) / (n * (n * n - 1)), 3)
    return {"strikes_common": len(common),
            "sign_agreement": round(same_sign / len(common), 3) if common else None,
            "abs_gex_rank_correlation": rho,
            "total_gex_ratio": (round(massive["totalGex"] / schwab["totalGex"], 3)
                                if schwab["totalGex"] else None)}


def shadow_record(ticker: str, dte_filter: str, adjusted: bool,
                  schwab: dict, massive: dict) -> dict:
    """The one line `shadow` logs per request: both errors, the headline agreement, and the
    per-strike diff. Built from finished results only."""
    rec = {"ticker": ticker, "dte": dte_filter, "adjusted": adjusted,
           "schwab_error": schwab.get("error"), "massive_error": massive.get("error")}
    if rec["schwab_error"] or rec["massive_error"]:
        return rec
    rec.update(agreement(schwab, massive))
    rec.update(massive_truncated=bool(massive.get("chainTruncated")),
               zero_gamma=[schwab.get("zeroGamma"), massive.get("zeroGamma")],
               call_wall=[(schwab.get("callWall") or {}).get("strike"),
                          (massive.get("callWall") or {}).get("strike")],
               put_wall=[(schwab.get("putWall") or {}).get("strike"),
                         (massive.get("putWall") or {}).get("strike")],
               strikes=strike_diff(schwab, massive))
    return rec


def log_shadow(rec: dict) -> None:
    logger.info("[gex-shadow] %s", json.dumps(rec, separators=(",", ":"), default=str))


def spawn_shadow(coro: Awaitable) -> Optional["asyncio.Task"]:
    """Run the Massive side of a shadow request off the served path."""
    try:
        task = asyncio.ensure_future(coro)
    except RuntimeError:
        return None
    _SHADOW_TASKS.add(task)
    task.add_done_callback(_SHADOW_TASKS.discard)
    return task
