"""Shared Finnhub REST client — the SINGLE process-wide coordination point for
every Finnhub call in this codebase, REST *and* the realtime WebSocket
reconnect loop.

Extracted 2026-08-05 from `api/services/earnings_estimates.py`, where this
token bucket + reactive cooldown originally lived (Task 13, 2026-08-04) — but
at that time it only paced whatever happened to route through
`earnings_estimates._fh_get`.

── Why this had to move (production incident, 2026-08-04) ──────────────────
Live probe of `/api/earnings/intel/{sym}`:
    CAT  -> beat_history 4, consensus present     (fine)
    TSN  -> beat_history 4, consensus present     (fine)
    AMD  -> beat_history 0, consensus NULL        (all Finnhub legs empty)
    MCD  -> beat_history 0, consensus NULL        (all Finnhub legs empty)
All three Finnhub legs failing together for one symbol but not another is the
signature of an ACCOUNT-level rate limit/cooldown, not a per-endpoint or
per-symbol data gap. A data-coverage audit found two causes:

  1. ~15 files called `requests.get`/`httpx.get("https://finnhub.io/...")`
     directly, spending the SAME 60/min account budget with ZERO
     coordination with the token bucket below. A burst in one caller (a
     heavy earnings day's calendar enrichment fan-out — 80+ symbols x 3
     calls each, fired by a worker pool in a couple of seconds) could
     exhaust the whole account's minute before the earnings modal's own
     calls ever got a token, and the modal's caller had no visibility into
     why it came back empty.
  2. `realtime_stream.py`'s WebSocket reconnect loop shares the same
     account budget but had no concept of it at all — a reconnect storm
     (observed live: "reconnecting in 8s" ... "15s" ... "2s", NON-monotonic)
     could burn the account's request budget continuously and starve the
     REST calls the modal depends on. (The non-monotonic pattern itself was
     a second bug — the old loop reset its backoff to zero the instant a
     connection was accepted, even if Finnhub kicked it again immediately;
     see the fix in realtime_stream.py.)

This module fixes (1): it is the ONE place every Finnhub caller — REST or
WS — routes through, so a burst anywhere is visible, and rationed, from
everywhere else. (2) is fixed in realtime_stream.py by consulting the
priority-aware gate here (`fh_ws_reconnect_allowed`) before every reconnect
attempt, and by reporting a WS-side 429 back into the shared cooldown via
`fh_note_429` so REST backs off in step too.

── Priority: REST over WS ───────────────────────────────────────────────────
The earnings modal (and everything else on the request path) is user-facing;
the WS reconnect loop is a background convenience for live tick updates. When
budget is scarce, WS must yield FIRST. `fh_ws_reconnect_allowed()` requires
`_FH_WS_RESERVE_TOKENS` more headroom than a bare REST call
(`fh_get`/`fh_take_token` always use reserve=0) before it will spend a token —
so during a busy minute the bucket runs dry for WS reconnects well before it
runs dry for REST. WS's own self-throttling on that reserve does NOT count
against `fh_budget_denied_total()` (see `count_denial` on `_fh_take_token`) —
that counter is calendar.py's signal for "REST was actually rate-limited this
window" (see `test_calendar_enrichment_throttle.py`), and WS politely backing
off before REST ever felt pressure must not be misread as REST distress.

── Process-scope caveat ─────────────────────────────────────────────────────
Every piece of state below (`_fh_bucket_tokens`, `_fh_cooldown_until`, the
forbidden-endpoint cache) is per-PROCESS — plain module globals guarded by
`threading.Lock`s, no cross-process store. The web pod is deliberately
single-process (one uvicorn worker, one event loop, one shared anyio
threadpool — see CLAUDE.md "Performance & Scale — 2026-07-01
launch-hardening"), so a single in-process bucket for the whole pod covers
the WHOLE account's traffic today, which is why this design is sufficient
now. It would silently double-book the account's rate limit if the web pod
were ever scaled to multiple processes/instances — same caveat already
called out for `sync._locks` / `recent_orders._last_poll` etc. in the
broker-sync "SINGLE-PROCESS assumptions" section of CLAUDE.md. A durable
(DB- or Redis-backed) budget would be required at that point; out of scope
here.
"""
from __future__ import annotations

import logging
import os
import threading
import time as _time

import requests

from api.services.cache import cache

_logger = logging.getLogger(__name__)

_FH_V1 = "https://finnhub.io/api/v1"
_DEFAULT_TIMEOUT = 6  # seconds — matches the original earnings_estimates._TIMEOUT

# ── Reactive cooldown (post-429 backstop) ────────────────────────────────────
# When a 429 lands (from REST OR the WS handshake), EVERY caller funneling
# through fh_get / fh_ws_reconnect_allowed backs off together for this long —
# without a shared cooldown each caller keeps hammering an already-exhausted
# minute bucket independently.
_FH_COOLDOWN_SECONDS = 20.0
_fh_cooldown_until = 0.0
_fh_cooldown_lock = threading.Lock()

# Endpoints the current Finnhub plan rejects outright (403) — e.g.
# /stock/price-target moved to premium. Re-probed daily via the cache TTL.
_FH_FORBIDDEN_TTL = 86_400

# ── Proactive rate limiting (token bucket) ───────────────────────────────────
# `_FH_RATE_LIMIT_PER_MIN` sits a hair under Finnhub's advertised 60/min —
# headroom for clock/measurement slop, not a magic number. `_fh_take_token()`
# NEVER blocks or sleeps: it returns True (proceed) or False (shed)
# immediately — this runs on the shared request threadpool, so sleeping here
# to "wait for a slot" would just move the 524-outage surface from "burst of
# 429s" to "burst of hung request threads."
_FH_RATE_LIMIT_PER_MIN = 55.0
_fh_bucket_tokens = _FH_RATE_LIMIT_PER_MIN
_fh_bucket_updated = _time.monotonic()
_fh_bucket_lock = threading.Lock()
# Process-lifetime count of REST calls shed by the bucket (never resets).
# Calendar enrichment snapshots this before/after a day's fan-out to tell
# "genuinely no data" apart from "throttled — try again soon". WS's own
# reserve-based self-yields are deliberately NOT counted here (see module
# docstring) so they can't manufacture a false "REST was throttled" signal.
_fh_bucket_denied_total = 0

# How much MORE headroom (beyond the 1.0 token a bare call needs) a WS
# reconnect attempt must see before it's allowed to spend a token. REST
# always checks with reserve=0 (the full bucket is available to it) — this
# is the mechanism that makes WS yield to REST under contention.
_FH_WS_RESERVE_TOKENS = 10.0


def _fh_take_token(reserve: float = 0.0, count_denial: bool = True) -> bool:
    """Non-blocking token-bucket check. True = a call may proceed now and one
    token was consumed; False = the process-wide Finnhub budget for this
    rolling minute (minus `reserve` headroom) is spent — proceed with
    nothing (no network call, no wait).

    `count_denial=False` (used by the WS gate) skips incrementing
    `_fh_bucket_denied_total` — see module docstring "Priority: REST over
    WS" for why a WS self-yield must not look like REST distress.
    """
    global _fh_bucket_tokens, _fh_bucket_updated, _fh_bucket_denied_total
    with _fh_bucket_lock:
        now = _time.monotonic()
        elapsed = max(0.0, now - _fh_bucket_updated)
        _fh_bucket_updated = now
        _fh_bucket_tokens = min(
            _FH_RATE_LIMIT_PER_MIN,
            _fh_bucket_tokens + elapsed * (_FH_RATE_LIMIT_PER_MIN / 60.0),
        )
        if _fh_bucket_tokens >= 1.0 + reserve:
            _fh_bucket_tokens -= 1.0
            return True
        if count_denial:
            _fh_bucket_denied_total += 1
        return False


def fh_take_token(reserve: float = 0.0) -> bool:
    """Public wrapper of `_fh_take_token` for callers that can't route
    through `fh_get` (e.g. an httpx-based service) but must still consult
    the shared budget before firing a request off their own HTTP client."""
    return _fh_take_token(reserve=reserve)


def fh_budget_denied_total() -> int:
    """Cumulative (process-lifetime) count of Finnhub REST calls shed by the
    proactive token bucket. Monotonically increasing — callers compare two
    snapshots to detect whether budget-shedding happened during a window,
    never read it as an absolute count of "current" anything."""
    return _fh_bucket_denied_total


def fh_in_cooldown() -> bool:
    """True if a prior 429 (from ANY source — REST or WS) has the shared
    reactive cooldown engaged right now. Non-blocking."""
    with _fh_cooldown_lock:
        return _time.monotonic() < _fh_cooldown_until


def fh_note_429(source: str = "rest") -> None:
    """Engage the shared reactive cooldown. `fh_get` calls this itself on a
    REST 429. Callers whose own HTTP client received a 429 directly from
    Finnhub — e.g. the WebSocket handshake rejection in realtime_stream.py —
    must call this explicitly so REST and WS back off TOGETHER instead of
    each independently re-discovering the account is rate-limited."""
    global _fh_cooldown_until
    with _fh_cooldown_lock:
        _fh_cooldown_until = _time.monotonic() + _FH_COOLDOWN_SECONDS
    _logger.warning("Finnhub 429 (%s) — shared cooldown engaged for %ss", source, _FH_COOLDOWN_SECONDS)


def fh_ws_reconnect_allowed() -> bool:
    """Non-blocking gate consulted by realtime_stream.py before EVERY
    WebSocket (re)connect attempt. Returns False (don't even attempt the
    handshake — an attempt we already know will fail/compete is worse than
    no attempt) when:
      • a REST or WS 429 has the shared cooldown engaged, or
      • the token bucket doesn't have `_FH_WS_RESERVE_TOKENS` of headroom
        spare beyond a bare call.

    This is the mechanism that makes the background WS reconnect loop yield
    to the user-facing REST path: see "Priority: REST over WS" above.
    """
    if fh_in_cooldown():
        return False
    return _fh_take_token(reserve=_FH_WS_RESERVE_TOKENS, count_denial=False)


def _junk_symbol(sym) -> bool:
    """Symbols Finnhub can never resolve (index/synthetic notations like
    $IDX:SEMICONDUCTORS or ^VIX). Calling for them burns rate budget on
    guaranteed failures, every single time."""
    s = str(sym or "")
    return (not s) or any(c in s for c in ("$", "^", ":", "/"))


def fh_get(path: str, params: dict, timeout: int | None = None, base_url: str = _FH_V1) -> dict | list | None:
    """Fire a Finnhub GET request. Returns parsed JSON or None on failure.

    THE function every Finnhub REST caller in this codebase should route
    through (a caller stuck on `httpx` because of an existing async
    call-site can instead call `fh_take_token()`/`fh_in_cooldown()`/
    `fh_note_429()` directly — see industry_map.py / implied_store.py).

    Budget guards (all return None without a network call):
      • symbols Finnhub can't resolve ($/^/:-style) are skipped
      • a proactive token bucket sheds calls once ~55/min is spent
      • a shared 20s cooldown engages after any 429 — REST OR the WS
        handshake (see fh_note_429) — backstop for whatever slips past the
        bucket (clock slop, other processes, a WS-side rejection, etc.)
      • endpoints that 403'd (plan-forbidden) are skipped for 24h

    A denied call degrades exactly like any other Finnhub failure: returns
    None, never a fabricated value. Callers are responsible for their own
    honest-degradation handling downstream (see earnings_estimates.
    get_earnings_intel's partial-vs-total-failure caching for the pattern).
    """
    api_key = os.environ.get("FINNHUB_API_KEY", "")
    if not api_key:
        _logger.warning("FINNHUB_API_KEY not set — Finnhub call skipped (%s)", path)
        return None
    if "symbol" in params and _junk_symbol(params.get("symbol")):
        return None
    if cache.get(f"fh_forbidden_{path}"):
        return None
    if fh_in_cooldown():
        return None
    if not _fh_take_token():
        return None
    call_params = dict(params)
    call_params["token"] = api_key
    try:
        resp = requests.get(f"{base_url}{path}", params=call_params, timeout=timeout or _DEFAULT_TIMEOUT)
        if resp.status_code == 429:
            fh_note_429(f"rest:{path}")
            return None
        if resp.status_code == 403:
            cache.set(f"fh_forbidden_{path}", True, ttl=_FH_FORBIDDEN_TTL)
            _logger.warning("Finnhub 403 on %s — plan-forbidden, skipping for 24h", path)
            return None
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        _logger.warning("Finnhub %s failed for %s: %s", path, params.get("symbol", "?"), exc)
        return None
