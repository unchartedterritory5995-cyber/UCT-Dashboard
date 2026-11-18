"""LCQ-02 support for `api/gex_service.py`: the Massive chain's server-side cache.

⛔ NO GEX ARITHMETIC LIVES HERE. The one formula is `api/gex_service.py::get_gex_data`
(`gamma * oi * 100 * spot**2 * 0.01`). This module only bounds how often the Massive snapshot is
walked. (Until 2026-11-17 it also held the per-strike diff between a Schwab chain and a Massive
one; Schwab was retired from the product that day and the comparison went with it.)

Request budget, in one place:
  * one walk per (ticker, from, to) per `CHAIN_TTL_S`  -- the cache below;
  * concurrent identical requests share ONE walk         -- the single-flight below;
  * each walk is capped at 48 pages / 25 s with truncation reported
                                                         -- `gex_service._fetch_chain_massive`.
An ERROR is never cached: the next request retries instead of serving a stale failure.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable

from api.services.cache import TTLCache

logger = logging.getLogger("gex")

CHAIN_TTL_S = 60.0
_CHAIN_CACHE = TTLCache(max_size=128)
_INFLIGHT: dict[str, "asyncio.Future"] = {}


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
