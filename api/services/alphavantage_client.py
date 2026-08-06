"""Shared AlphaVantage REST client — the SINGLE process-wide coordination
point for every AlphaVantage call in this codebase.

Modeled on `api/services/finnhub_client.py` (the "SINGLE process-wide
coordination point" pattern already proven there for Finnhub): a token
bucket, a shared reactive cooldown, and a non-blocking `av_get` that returns
`None`/degrades immediately, never sleeps. The SHAPE of the bucket is
different on purpose — AlphaVantage's free tier is **25 requests/DAY**, not
Finnhub's 60/minute, so this is a whole-day allotment with a calendar
rollover, not a rolling per-minute refill. There is also no AlphaVantage
websocket, so there is no Finnhub-style priority-reserve mechanism here.

── Why this exists (2026-08-05 data-dependability migration, Task 15) ──────
Before this module there was no shared AV client. Section B of the plan
found 7 network call sites across 5 modules, all spending the SAME 25/day
account budget with zero coordination — six issued a bare `requests.get`
with no quota accounting at all, and the seventh (`engine._av_get`) had
already been deleted (Task 12, commit `c82f3f60`) along with its 13s
request-path sleep, which the plan explicitly flags as having been "tuned
for the 5/min limit, not the 25/day limit" — a stale, wrong number this
module does not repeat. By the time this module lands, Tasks 3/12/14 have
already deleted or gated most of those six call sites; what remains routes
through here.

── Non-blocking, always ─────────────────────────────────────────────────────
`av_get`/`av_get_status` NEVER sleep to wait for budget. Once the day's 25
calls are spent, every subsequent call returns `None` (`av_get`) or
`(None, True)` (`av_get_status`) immediately — no network call, no wait.
Sleeping here would just move the
524-outage class (see CLAUDE.md "Performance & Scale — 2026-07-01
launch-hardening") from "burst of AV throttle responses" to "burst of hung
request threads" on the shared anyio threadpool — exactly the mistake the
deleted `engine._av_get` made, and exactly what
`finnhub_client._fh_take_token()` (lines ~101-108 there) already documents
as the contract to copy.

── Daily reset convention (a documented CHOICE, not a discovered fact) ─────
AlphaVantage does not publicly document *when* its daily quota resets.
This module resets the bucket at **ET midnight** (`_AV_RESET_TZ =
"America/New_York"`), matching the convention already used for every other
daily/schedule boundary in this codebase (COT Friday/6pm catch-up, the
catalyst engine's premarket window, Desk session day-keys — see CLAUDE.md
"Task Scheduler (local PC, wkdays)"). It is a deliberate, single, easy-to-
change constant — flip `_AV_RESET_TZ` to `datetime.timezone.utc` here (and
nowhere else) if AV's actual reset time is ever confirmed to differ.

── Throttle detection is shared ─────────────────────────────────────────────
AlphaVantage returns **HTTP 200** even when the account is rate-limited —
the body carries a `"Note"` (legacy messaging) or `"Information"` (current
messaging) key instead of the expected payload. `is_av_throttle_response`
is the ONE place that classifies this, so every caller sees identical
behavior instead of five different ad-hoc `"Information" in data` checks
scattered across the codebase.

**Design choice: a throttle-classified response still counts against the
local daily bucket (the token is NOT refunded).** The token bucket already
decremented *before* the network round trip was attempted (that is how the
proactive-shedding design works — see `_av_take_token`), and by the time a
throttle body comes back the HTTP request has already happened. There is no
reliable way to tell "AV's real server-side day-counter was already past 25
before this call" apart from "our local count and AV's have drifted for
some other reason" — refunding the token in that ambiguous case would let a
process that's already out of sync with AV re-attempt further calls on the
same day, which is the wrong failure direction for a 25/day budget. The
conservative, honest choice is: every attempted call — throttled or not —
spends one of today's local slots.
"""
from __future__ import annotations

import logging
import os
import threading
import time as _time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import requests

_logger = logging.getLogger(__name__)

_AV_BASE_URL = "https://www.alphavantage.co/query"
_DEFAULT_TIMEOUT = 10  # seconds

# ── Daily reset convention — see module docstring. Single, easy-to-find knob. ──
_AV_RESET_TZ = ZoneInfo("America/New_York")

# ── Daily token bucket (25/day — NOT Finnhub's rolling 5/min-shaped bucket) ──
_AV_DAILY_LIMIT = 25
_av_bucket_lock = threading.Lock()
_av_bucket_day: str | None = None
_av_bucket_used = 0
# Process-lifetime count of AV calls shed by the daily bucket OR classified
# as a throttle response (never resets). Lets a consumer (e.g. the
# provider-coverage monitor, `provider_coverage_monitor._denial_snapshot`)
# distinguish "AV was throttled during this window" from "genuinely no
# data" — compare two snapshots, never read as an absolute "current" count.
_av_bucket_denied_total = 0

# ── Reactive cooldown (post-throttle signal, mirrors finnhub_client's SHAPE
# but NOT its auto-blocking wiring — see `av_get_status` docstring "Why the
# cooldown is engaged but not auto-consulted here" for the reasoning) ──────
# Engaged whenever a throttle-classified response lands, so ANY caller that
# explicitly checks `av_in_cooldown()` (mirroring the escape-hatch pattern
# `fh_ws_reconnect_allowed` uses for Finnhub's WS reconnect loop) can see
# "AV was just throttled" without re-deriving it from a raw response body.
_AV_COOLDOWN_SECONDS = 60.0
_av_cooldown_until = 0.0
_av_cooldown_lock = threading.Lock()


def _av_today(now: datetime | None = None) -> str:
    """Calendar-day key (ET, see module docstring) used to detect a bucket
    rollover. Pass `now` for deterministic tests — never depend on the
    wall-clock's actual day (per the plan's test-oracle law)."""
    if now is not None:
        dt = now.astimezone(_AV_RESET_TZ) if now.tzinfo is not None else now.replace(tzinfo=timezone.utc).astimezone(_AV_RESET_TZ)
    else:
        dt = datetime.now(_AV_RESET_TZ)
    return dt.strftime("%Y-%m-%d")


def _av_take_token(now: datetime | None = None) -> bool:
    """Non-blocking daily-bucket check. True = a call may proceed (one of
    today's `_AV_DAILY_LIMIT` slots consumed); False = today's budget is
    spent — proceed with nothing (no network call, no wait). NEVER sleeps.
    """
    global _av_bucket_day, _av_bucket_used, _av_bucket_denied_total
    with _av_bucket_lock:
        today = _av_today(now)
        if today != _av_bucket_day:
            _av_bucket_day = today
            _av_bucket_used = 0
        if _av_bucket_used >= _AV_DAILY_LIMIT:
            _av_bucket_denied_total += 1
            return False
        _av_bucket_used += 1
        return True


def av_take_token(now: datetime | None = None) -> bool:
    """Public wrapper of `_av_take_token` for a caller that can't route
    through `av_get`/`av_get_status` (e.g. an existing call site mid-
    migration) but must still consult the shared daily budget before firing
    a request off its own HTTP client."""
    return _av_take_token(now)


def av_budget_denied_total() -> int:
    """Cumulative (process-lifetime) count of AlphaVantage calls shed by the
    daily bucket or classified as a throttle response. Monotonically
    increasing — callers compare two snapshots to detect whether denial
    happened during a window, never read it as an absolute "current" count.
    """
    return _av_bucket_denied_total


def av_in_cooldown() -> bool:
    """True if a prior throttle response has the shared reactive cooldown
    engaged right now. Non-blocking."""
    with _av_cooldown_lock:
        return _time.monotonic() < _av_cooldown_until


def av_note_throttle(source: str = "unknown") -> None:
    """Engage the shared reactive cooldown after a throttle-classified
    response. `av_get_status` calls this itself; a caller using its own
    HTTP client (bypassing this module's request path entirely) should call
    this explicitly so every AV caller backs off together."""
    global _av_cooldown_until
    with _av_cooldown_lock:
        _av_cooldown_until = _time.monotonic() + _AV_COOLDOWN_SECONDS
    _logger.warning("AlphaVantage throttle (%s) — shared cooldown engaged for %ss", source, _AV_COOLDOWN_SECONDS)


def is_av_throttle_response(data) -> bool:
    """The ONE shared detector for AlphaVantage's "HTTP 200 but actually
    throttled" signature: a dict body carrying a `Note` (legacy) or
    `Information` (current) key instead of the expected payload shape. Every
    caller — this module's own `av_get_status` and any call site that still
    needs to inspect a raw AV body itself — should use this rather than
    reimplementing the `"Information" in data or "Note" in data` check.
    """
    return isinstance(data, dict) and ("Note" in data or "Information" in data)


def av_get_status(
    params: dict,
    timeout: int | float | None = None,
    now: datetime | None = None,
    api_key: str | None = None,
) -> tuple[dict | list | None, bool]:
    """Fire an AlphaVantage GET request, returning `(data, throttled)`.

    Use this (rather than `av_get`) when the caller must distinguish "AV is
    rate-limited right now" from "this specific query genuinely had
    nothing" — e.g. `av_transcripts.py` stops probing further candidate
    quarters on a throttle (conserve the scarce 25/day budget) but tries the
    next candidate on an ordinary miss. `throttled=True` covers: the local
    daily bucket is already spent, or AV's own 200-body carried a
    Note/Information key. `data` is `None` whenever `throttled` is True, and
    is also `None` on an ordinary network/parse failure — in that last case
    `throttled=False` (it is not a rate-limit signal, just a normal
    failure; treat it like any other honest-degradation miss).

    `api_key` overrides the default `ALPHAVANTAGE_API_KEY` env lookup — for
    a caller holding its own dedicated/premium AV key (e.g.
    `catalyst/sources.py`'s `CATALYST_AV_NEWS_KEY`). Note the daily bucket
    below is still ONE process-wide counter regardless of which key is
    actually used — matching finnhub_client's single-account model. A
    genuinely separate-quota key sharing this bucket is a known, documented
    simplification (see `alphavantage_client.py` module docstring and
    `catalyst/sources.py::_pull_av_news`), not a bug.

    Budget guard (returns `(None, True)` without a network call):
      • the proactive daily token bucket has no slots left today

    **Why the cooldown is engaged but not auto-consulted here:** unlike
    Finnhub's 60/min bucket (where a reactive cooldown meaningfully protects
    against a burst *within the same minute* slipping past proactive
    shedding), AV's bucket is 25/DAY — once a throttle response is observed
    the local day-counter is already the thing doing the real protecting
    (it won't allow another attempt until the calendar day rolls over
    regardless of any cooldown), so a blocking pre-check here buys very
    little extra safety. It does cost real test fragility: a wall-clock
    cooldown that outlives a single pytest process tick means two
    back-to-back tests in the SAME file — one intentionally exercising a
    throttle response, the next expecting an ordinary successful call
    seconds (in wall-clock terms, milliseconds in test terms) later — would
    otherwise collide (verified against this repo's existing,
    pre-Task-15 `tests/test_catalyst_finviz_av_news.py::test_av_aggregates_
    sentiment`, which runs immediately after a throttle test in the same
    file). The cooldown is still engaged on every throttle (`av_note_
    throttle`) and is still queryable via `av_in_cooldown()` for a caller
    that explicitly wants to consult it (mirroring the opt-in pattern
    `finnhub_client.fh_ws_reconnect_allowed` uses for the WS reconnect
    loop) — it just isn't a silent, blocking precondition of the common
    `av_get`/`av_get_status` path.

    NEVER sleeps — see module docstring "Non-blocking, always".
    """
    api_key = api_key or os.environ.get("ALPHAVANTAGE_API_KEY", "")
    if not api_key:
        _logger.warning("ALPHAVANTAGE_API_KEY not set — AlphaVantage call skipped (%s)", params.get("function"))
        return None, False
    if not _av_take_token(now):
        return None, True
    call_params = dict(params)
    call_params["apikey"] = api_key
    try:
        resp = requests.get(_AV_BASE_URL, params=call_params, timeout=timeout or _DEFAULT_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        _logger.warning("AlphaVantage %s failed: %s", params.get("function", "?"), exc)
        return None, False
    if is_av_throttle_response(data):
        global _av_bucket_denied_total
        with _av_bucket_lock:
            _av_bucket_denied_total += 1
        av_note_throttle(f"function:{params.get('function', '?')}")
        return None, True
    return data, False


def av_get(
    params: dict,
    timeout: int | float | None = None,
    now: datetime | None = None,
    api_key: str | None = None,
) -> dict | list | None:
    """Fire an AlphaVantage GET request. Returns parsed JSON, or `None` on
    any failure (budget exhausted, throttle response, or an ordinary
    network/parse error).

    THE function most AlphaVantage callers in this codebase should route
    through — it is the common-case wrapper over `av_get_status` for
    callers that don't need to distinguish *why* a call came back empty. A
    denied call degrades exactly like any other AlphaVantage failure:
    returns `None`, never a fabricated value. Callers are responsible for
    their own honest-degradation handling downstream.
    """
    data, _throttled = av_get_status(params, timeout=timeout, now=now, api_key=api_key)
    return data
