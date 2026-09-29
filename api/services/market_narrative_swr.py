"""Serve `/api/schwab/market-narrative`'s last good answer; refresh it behind
the member (TERM-070, FB-A10-03).

WHY THIS EXISTS
---------------
The route's handler (`api/schwab_router.py`, partner-co-edited) answers a cache
miss with a synchronous `claude-sonnet-4-6` call that runs the server-side
`web_search` tool before it writes a word. Measured 2026-09-26 in a foreground
browser: **20,768 ms cold and 7,531 ms warm of server time for a 1 KB body**,
the slowest call on `/options-flow`'s load path both times. From the source,
three properties put that call on a member's request:

  1. **The TTL cache decides WHICH member pays, not WHETHER one does.**
     `cache.set(cache_key, text, ttl=1800)` expires on a hard clock
     (`serve_stale.py` explains why), so every 30 minutes, per date, the first
     reader waits for the full model-plus-search call.
  2. **No single-flight.** N members arriving on a miss each fired their OWN
     billed call, in parallel.
  3. **A failure is never cached.** The write is guarded by `if text:` and the
     `except` branch returns a 500 without writing, so an empty answer or an
     outage re-fired the full call for EVERY caller, with no backoff.

(The research note's headline — "a 30-minute cache on a 26-minute pod" — is
only half true on today's code: `cache_snapshot.py` carries the TTL entry
across a deploy with its absolute expiry. What it does NOT carry is a
last-good slot, because there was none. That is fixed below.)

WHAT THIS DOES — around the handler, never inside it
----------------------------------------------------
`serve_last_good` wraps the route. The handler is unchanged and remains the
ONLY thing that knows how to write a narrative; this module only decides
whether a member has to wait for it.

  * **Fresh** TTL hit → returned exactly as the handler would have.
  * **Stale**: the TTL lapsed but a good narrative for the SAME DATE was built
    less than `STALE_MAX_AGE` seconds ago → that narrative is returned at once,
    marked `Server-Timing: market-narrative;desc="stale-swr"` with its age, and
    ONE background refresh runs the handler.
  * **Cold**: nothing servable → the caller builds, exactly as before; a herd
    of concurrent cold callers collapses onto that one build.
  * **A failed build is never last-good.** "Good" is DERIVED from the handler's
    own decision: a build is good only if the handler wrote its narrative to
    the TTL cache (its `if text:`). Its placeholder, its 429 and its 500s are
    served but never remembered — `cache_policy.set_by_completeness`'s rule,
    applied to a handler that already owns its own success write.
  * **A failure is remembered briefly** (`NEGATIVE_TTL_SECONDS`) so an outage
    costs one upstream attempt per window instead of one per caller — and so
    single-flight waiters queued behind a failed build do not each re-run a
    call that can take the full request-path timeout.
  * **The last good narrative survives a deploy**: it is also written to the
    shared cache (which `cache_snapshot` persists) with its BUILD time, and a
    fresh pod re-seeds its slot from it with that original age. A deploy never
    extends a narrative's servable life.

⛔ WHAT THIS DOES NOT CHANGE: the model, the prompt, the web-search tool, the
text clean-up, the cost guard, the auth gate, the timeout, or what the
narrative says. Keyed by DATE, as the handler is: a narrative is never served
on a later date than the one it was built for.
"""
from __future__ import annotations

import functools
import logging
import threading
import time
from datetime import datetime
from typing import Any, Callable

from fastapi.responses import JSONResponse
from starlette.responses import Response

from api.services.cache import cache
from api.services.serve_stale import ServeStale, serve_with_tier, server_timing

_logger = logging.getLogger(__name__)

#: Every key this module (and the handler, through `cache_key`) writes.
KEY_PREFIX = "market_narrative_"

# Bound on serving a stale narrative: the handler's 1800 s TTL + 30 minutes.
# The slot's age counts from the BUILD, so it is already ~1800 s old the moment
# the TTL lapses; a bound at or under the TTL would never serve at all (a rail
# derives the handler's real TTL from its cache write and holds this above it).
# The extra 30 minutes is many refresh attempts' worth. Past it, a refresh that
# keeps FAILING degrades to the old synchronous build rather than pinning the
# member to an hour-old summary.
STALE_MAX_AGE = 3600

# How long one failed build answers for its key. Covers the request-path LLM
# timeout (60 s), so a herd behind one hung call does not queue up N more.
NEGATIVE_TTL_SECONDS = 60.0

_STALE = ServeStale("market-narrative", max_age_seconds=STALE_MAX_AGE, max_keys=4)

# key -> (frozen failed result, monotonic time it failed)
_FAILED: dict[str, tuple[tuple, float]] = {}
_FAILED_LOCK = threading.Lock()


def _now() -> datetime:
    """The handler's clock (`datetime.now()`, local). A seam for tests."""
    return datetime.now()


def _clock() -> float:
    """Monotonic clock for the negative memo. A seam for tests."""
    return time.monotonic()


def cache_key(day: datetime) -> str:
    """THE cache key for `day`'s narrative. The handler calls this too, so the
    key it writes and the key this module reads have one authority."""
    return f"{KEY_PREFIX}{day.strftime('%Y%m%d')}"


def _carry_key(key: str) -> str:
    return f"{key}:lastgood"


# ── the negative memo ────────────────────────────────────────────────────────

def _freeze(result: Any) -> tuple:
    """A failed result, as data — never the Response object itself, which is
    per-request and whose headers are mutated on the way out."""
    if isinstance(result, Response):
        return ("response", result.status_code, bytes(result.body), result.media_type)
    return ("json", result)


def _thaw(frozen: tuple) -> Any:
    if frozen[0] == "response":
        _kind, status, body, media_type = frozen
        return Response(content=body, status_code=status, media_type=media_type)
    value = frozen[1]
    return dict(value) if isinstance(value, dict) else value


def _recent_failure(key: str) -> Any | None:
    with _FAILED_LOCK:
        entry = _FAILED.get(key)
        if entry is None:
            return None
        frozen, at = entry
        if _clock() - at > NEGATIVE_TTL_SECONDS:
            _FAILED.pop(key, None)
            return None
    return _thaw(frozen)


def _remember_failure(key: str, result: Any) -> None:
    try:
        frozen = _freeze(result)
    except Exception:                          # an unfreezable result: not memoised
        return
    with _FAILED_LOCK:
        _FAILED[key] = (frozen, _clock())
        if len(_FAILED) > 8:                   # keys are per date; stay bounded
            for stale_key in sorted(_FAILED, key=lambda k: _FAILED[k][1])[:-8]:
                _FAILED.pop(stale_key, None)


def _clear_failure(key: str) -> None:
    with _FAILED_LOCK:
        _FAILED.pop(key, None)


# ── last-good ────────────────────────────────────────────────────────────────

def _good(key: str, result: Any) -> bool:
    """A build is good iff the handler itself cached the narrative it returned.

    Derived, not restated: the handler's `if text: cache.set(...)` is the one
    authority on what a usable narrative is. Its placeholder answer, its 429
    and its 500s all leave the TTL cache empty, so none of them can become the
    narrative every member sees for the next hour."""
    if not isinstance(result, dict):
        return False
    text = result.get("narrative")
    return bool(text) and cache.get(key) == text


def _seed_from_carry(key: str) -> None:
    """A fresh pod has an empty slot. Re-seed it from the carried copy, with
    the narrative's ORIGINAL build time, so a deploy does not turn the next TTL
    lapse into a cold member-facing build — and does not extend its life."""
    value, _age = _STALE.peek(key)
    if value is not None:
        return
    carried = cache.get(_carry_key(key))
    if not isinstance(carried, dict):
        return
    text = carried.get("narrative")
    built_at = carried.get("built_at")
    if not text or not isinstance(built_at, (int, float)):
        return
    _STALE.remember(key, {"narrative": text}, at=float(built_at))


# ── the wrapper ──────────────────────────────────────────────────────────────

def serve_last_good(handler: Callable[..., Any]) -> Callable[..., Any]:
    """Decorate the route handler. `functools.wraps` keeps its signature, so
    FastAPI still resolves the handler's own dependencies (its auth gate)."""

    @functools.wraps(handler)
    def route(*args, **kwargs):
        t0 = time.perf_counter()
        key = cache_key(_now())
        _seed_from_carry(key)

        def fresh():
            hit = cache.get(key)
            return None if hit is None else {"narrative": hit}

        def build():
            failed = _recent_failure(key)
            if failed is not None:
                return failed
            result = handler(*args, **kwargs)
            if _good(key, result):
                cache.set(_carry_key(key),
                          {"narrative": result["narrative"], "built_at": time.time()},
                          STALE_MAX_AGE)
                _clear_failure(key)
            else:
                _remember_failure(key, result)
            return result

        value, tier, age = serve_with_tier(
            _STALE, key, fresh=fresh, build=build,
            good=lambda r: _good(key, r),
        )
        timing = server_timing("market-narrative", tier,
                               (time.perf_counter() - t0) * 1000.0, age)
        if isinstance(value, Response):
            value.headers["Server-Timing"] = timing
            return value
        return JSONResponse(content=value, headers={"Server-Timing": timing})

    return route


def _reset_for_test() -> None:
    """Empty every module-level slot and this route's cache keys."""
    _STALE._slots.clear()
    with _FAILED_LOCK:
        _FAILED.clear()
    cache.delete_prefix(KEY_PREFIX)
