"""THE yfinance chokepoint: one pool, one deadline, one rate-limit breaker.

Every yfinance call in this process goes through `bounded_call`. That is not a
style preference — it is the only place where three separate failure modes can
be bounded at once, and each one has already taken the site down or flooded the
log:

  1. A HUNG upstream pins the caller's worker thread. With anyio's pool at 64,
     64 hung yfinance calls saturate FastAPI (the 2026-07-01 incident). Bounded
     by the pool width + a hard `Future.result(timeout=...)`.

  2. A RATE-LIMITED upstream. yfinance raises `YFRateLimitError` and this repo
     had ZERO handlers for it (`grep -rn YFRateLimitError api/` → 0 hits before
     2026-08-08), so a 429 was indistinguishable from any other failure: every
     caller swallowed it, retried on the next poll, and the log filled with
     dozens of `Too Many Requests` per second, sustained. Bounded by the
     circuit breaker below — once tripped, calls return their default WITHOUT
     touching the network and WITHOUT logging, until the cooldown expires.

  3. A STAMPEDE. Three separate pools used to exist (`yf_util._POOL` 6,
     `massive._YF_POOL` 4, `yfinance_pool._pool` 8) plus every unguarded call
     riding the 64-wide anyio pool. `massive._bounded_yf`, `yfinance_pool.
     run_in_pool` and `yfinance_pool.fetch_history` are now THIN ADAPTERS over
     this function — they own no pool and no policy of their own. That matters:
     a second guard is the same defect wearing a nicer hat, because a breaker
     that only sees a third of the traffic trips a third as often.

⛔ DO NOT add a fourth wrapper. `tests/test_yf_guard_census.py` runs an AST
census over `api/**` and fails BY FILE:LINE on any yfinance reach outside this
guard, and a second rail proves every accepted alias actually delegates here.

⚠️ IMPORT THE MODULE, NEVER THE FUNCTION.

    from api.services import yf_util      ✅  yf_util.bounded_call(...)
    from api.services.yf_util import bounded_call   ⛔

`from`-importing binds a PRIVATE copy of the function into the caller's module
namespace, which escapes every monkeypatch of `yf_util.bounded_call` — the same
`lesson_from_import_severs_a_module_from_its_guards` that let three
function-local `import yfinance` statements in `earnings_enrichment.py` bypass
this module entirely. The census rail fails on the from-import form too.
"""
from __future__ import annotations

import concurrent.futures as _cf
import logging
import os
import threading
import time

_log = logging.getLogger(__name__)

# ── The rate-limit exception, BY NAME ────────────────────────────────────────
# yfinance raises this from `YfData.cache_get` on an HTTP 429. Imported by name
# so the handler below is a real, typed handler and not a string match. The
# shim exists only so this module still imports in an environment without
# yfinance (some workers never touch it); `is_rate_limit_error` carries the
# signature fallbacks for that case.
try:  # pragma: no cover - import shape depends on the installed yfinance
    from yfinance.exceptions import YFRateLimitError  # noqa: F401
    _HAVE_REAL_YF_RATE_LIMIT = True
except Exception:  # pragma: no cover
    class YFRateLimitError(Exception):
        """Stand-in for yfinance.exceptions.YFRateLimitError."""
    _HAVE_REAL_YF_RATE_LIMIT = False


class YFGuardPaused(YFRateLimitError):
    """Raised (only on `reraise=True`) while the shared breaker is open.

    A subclass so that `except YFRateLimitError` — the handler a caller would
    naturally write — catches a suppressed call as well as a real 429.

    ⚠️ It calls `Exception.__init__` directly, NOT `super().__init__`, because
    yfinance's `YFRateLimitError.__init__(self)` takes NO arguments and hard-codes
    its own message. `raise YFRateLimitError("...")` is a TypeError, which would
    have turned every suppressed call on the raising adapters into a crash of a
    different shape — exactly the kind of thing a breaker is supposed to prevent.
    """

    def __init__(self, message: str = "yfinance calls are paused by the shared rate-limit breaker"):
        Exception.__init__(self, message)


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name) or default)
    except (TypeError, ValueError):
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name) or default)
    except (TypeError, ValueError):
        return default


# ── The one pool ─────────────────────────────────────────────────────────────
# 8 matches what `yfinance_pool` documented and shipped as its default (the
# widest of the three pools it replaces), so consolidating does not narrow the
# busiest path. `YFINANCE_POOL_WORKERS` is honoured for back-compat with the
# env already set in production.
_MAX_WORKERS = _env_int("YF_POOL_WORKERS", _env_int("YFINANCE_POOL_WORKERS", 8))
_POOL = _cf.ThreadPoolExecutor(max_workers=_MAX_WORKERS, thread_name_prefix="yf-util")

# ── LANES: isolation WITHOUT a second guard ──────────────────────────────────
# A burst caller (the earnings enrichment sweep: 6 workers × 2 dates, plus a
# 7×/weekday warmer) can monopolize a shared pool and starve `fundamentals` /
# `dividends_calendar` into their own timeouts. That is a REAL argument for a
# separate set of slots — and it is the argument every private pool in this
# repo was built on. It is not an argument for a separate GUARD: partitioning
# the slots is orthogonal to knowing that Yahoo has started refusing us.
#
# So: N bounded lanes, ONE breaker, ONE handler, ONE census. A lane must be
# declared here — that keeps "how many yfinance threads can this process have"
# answerable by reading one dict instead of grepping for ThreadPoolExecutor.
_LANE_WORKERS = {
    "default": _MAX_WORKERS,
    # earnings enrichment / preview warmer — the burstiest caller.
    "earnings": _env_int("YF_LANE_EARNINGS_WORKERS", 4),
}
_LANES: dict[str, _cf.ThreadPoolExecutor] = {"default": _POOL}
_LANES_LOCK = threading.Lock()


def _lane(name: str) -> _cf.ThreadPoolExecutor:
    if name not in _LANE_WORKERS:
        # Fail SOFT onto the default lane — an undeclared lane must never be
        # the reason a data call raises — but say so once, loudly.
        _log.warning("[yf-guard] undeclared lane %r — using the default lane", name)
        return _POOL
    with _LANES_LOCK:
        pool = _LANES.get(name)
        if pool is None:
            pool = _cf.ThreadPoolExecutor(
                max_workers=_LANE_WORKERS[name], thread_name_prefix=f"yf-{name}"
            )
            _LANES[name] = pool
        return pool

# Re-entrancy marker. Set on the worker thread while it runs a guarded callable.
#
# WITHOUT THIS, CONSOLIDATION SELF-STARVES. `ratings_universe` submits
# `_compute_one` through the guard, and `_compute_one` calls
# `fundamentals.get_fundamentals`, which is itself guarded. Two pools tolerated
# that by accident; one pool would have every worker blocked waiting for a slot
# only another worker could free. A nested call therefore runs INLINE on the
# thread that is already inside the pool: it inherits the OUTER deadline (which
# is already a hard wall-clock bound) and still passes through the breaker.
_local = threading.local()

# ── The circuit breaker ──────────────────────────────────────────────────────
# Cooldown doubles per consecutive trip and resets on the first clean call, so
# a single blip costs 60s while a sustained block backs all the way off instead
# of re-probing 320 times per warm cycle.
_COOLDOWN_BASE_S = _env_float("YF_RATE_LIMIT_COOLDOWN_SECONDS", 60.0)
_COOLDOWN_MAX_S = _env_float("YF_RATE_LIMIT_COOLDOWN_MAX_SECONDS", 900.0)

_state_lock = threading.Lock()
_state = {
    "cooldown_until": 0.0,   # monotonic deadline; <= now means closed
    "strikes": 0,            # consecutive trips, drives the backoff
    "trips": 0,              # lifetime trips
    "rate_limited": 0,       # lifetime 429s actually seen on the wire
    "suppressed": 0,         # lifetime calls short-circuited by the breaker
    "calls": 0,              # lifetime calls that reached the pool
    "last_trip_epoch": None,
}


def is_rate_limit_error(exc: BaseException) -> bool:
    """True when `exc` is yfinance's rate-limit signal.

    Name first (`YFRateLimitError`), then defensive fallbacks: a duplicated
    module object under `importlib.reload` breaks `isinstance` while the class
    name is still right, and some yfinance code paths surface the 429 as a
    plain `requests`/`curl_cffi` HTTP error instead. Missing a 429 costs the
    breaker; mis-flagging one costs a 60s cooldown. Both are bounded, and the
    first is the failure that already happened.
    """
    if isinstance(exc, YFRateLimitError):
        return True
    for klass in type(exc).__mro__:
        if klass.__name__ == "YFRateLimitError":
            return True
    resp = getattr(exc, "response", None)
    if getattr(resp, "status_code", None) == 429 or getattr(exc, "status_code", None) == 429:
        return True
    text = str(exc).lower()
    return "too many requests" in text or "rate limit" in text


def rate_limited() -> bool:
    """True while the breaker is open — no yfinance call will leave this
    process. Callers do not need to consult this; `bounded_call` enforces it."""
    with _state_lock:
        return _state["cooldown_until"] > time.monotonic()


def _trip(exc: BaseException) -> None:
    with _state_lock:
        _state["rate_limited"] += 1
        already_open = _state["cooldown_until"] > time.monotonic()
        if already_open:
            # A call already in flight when the breaker closed comes back 429.
            # Do NOT compound the backoff for it — that would multiply one
            # event by the pool width.
            return
        _state["strikes"] += 1
        _state["trips"] += 1
        _state["last_trip_epoch"] = time.time()
        wait = min(_COOLDOWN_MAX_S, _COOLDOWN_BASE_S * (2 ** (_state["strikes"] - 1)))
        _state["cooldown_until"] = time.monotonic() + wait
        strikes = _state["strikes"]
    # ONE line per trip, never one per suppressed call. The whole point is that
    # a rate-limited provider can no longer flood the log.
    _log.warning(
        "[yf-guard] yfinance rate-limited (%s) — pausing ALL yfinance calls for "
        "%.0fs (consecutive trip #%d): %s",
        type(exc).__name__, wait, strikes, exc,
    )


def _note_success() -> None:
    with _state_lock:
        if _state["strikes"]:
            _state["strikes"] = 0
            _state["cooldown_until"] = 0.0
            recovered = True
        else:
            recovered = False
    if recovered:
        _log.info("[yf-guard] yfinance recovered — breaker closed")


def _note_suppressed() -> None:
    with _state_lock:
        _state["suppressed"] += 1


def bounded_call(fn, default, timeout: float = 12.0, *, reraise: bool = False,
                 lane: str = "default"):
    """Run `fn()` under a bounded pool, the hard `timeout`, and the breaker.

    Returns `default` on timeout, on a rate limit, or on any other exception —
    the calling thread is freed even if `fn` hangs. This is the contract every
    existing caller was written against and it has not changed.

    `reraise=True` propagates instead of returning `default`, for the two
    adapters (`yfinance_pool.run_in_pool` / `.fetch_history`) whose callers
    distinguish "provider failed" from "provider returned nothing". `default`
    is then unused. Every such call site catches broad `Exception`.

    `lane` picks a declared slot pool (see `_LANE_WORKERS`) so a burst caller
    can be isolated from the general traffic. The breaker, the handler and the
    census are shared across every lane — isolation of THREADS, never of POLICY.
    """
    if rate_limited():
        _note_suppressed()
        if reraise:
            raise YFGuardPaused()
        return default

    with _state_lock:
        _state["calls"] += 1

    try:
        if getattr(_local, "in_pool", False):
            # Nested call — run inline under the outer deadline. See _local.
            out = fn()
        else:
            out = _lane(lane).submit(_marked(fn)).result(timeout=timeout)
    except YFRateLimitError as exc:
        # ── the handler that did not exist ──────────────────────────────────
        _trip(exc)
        if reraise:
            raise
        return default
    except Exception as exc:
        if is_rate_limit_error(exc):
            _trip(exc)
        if reraise:
            raise
        return default
    _note_success()
    return out


def _marked(fn):
    """Wrap `fn` so the worker thread advertises that it is inside the pool."""
    def _run():
        _local.in_pool = True
        try:
            return fn()
        finally:
            _local.in_pool = False
    return _run


def guard_status() -> dict:
    """Diagnostics. `cooldown_seconds_remaining` > 0 means every yfinance call
    in this process is currently being short-circuited."""
    with _state_lock:
        remaining = max(0.0, _state["cooldown_until"] - time.monotonic())
        return {
            "max_workers": _MAX_WORKERS,
            "lanes": dict(_LANE_WORKERS),
            "rate_limit_exception_bound": _HAVE_REAL_YF_RATE_LIMIT,
            "breaker_open": remaining > 0,
            "cooldown_seconds_remaining": round(remaining, 1),
            "consecutive_trips": _state["strikes"],
            "trips_total": _state["trips"],
            "rate_limited_total": _state["rate_limited"],
            "suppressed_total": _state["suppressed"],
            "calls_total": _state["calls"],
            "last_trip_epoch": _state["last_trip_epoch"],
        }


def reset_guard_state() -> None:
    """Test hook — clear the breaker. Never call from production code."""
    with _state_lock:
        _state.update(
            cooldown_until=0.0, strikes=0, trips=0, rate_limited=0,
            suppressed=0, calls=0, last_trip_epoch=None,
        )
    _local.in_pool = False
