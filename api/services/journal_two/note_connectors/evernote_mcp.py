"""Evernote MCP client: streamable-HTTP JSON-RPC to Evernote's hosted MCP server, READ-ONLY.

Plan E Task 1 (`docs/superpowers/plans/2026-11-02-connector-fidelity-e-evernote.md`). Measured
facts: `docs/notebook-connectors/evernote-mcp-probe.md` and the raw `tools/list` capture
`docs/notebook-connectors/evernote-probe-2026-11-02/tools_list.json`.

The SAFETY RULE this module exists to hold: Evernote's `tools/list` advertises WRITE tools
(create/edit/delete/move notes, notebooks, tags, tasks, attachments) under a `read` grant, so the
grant is no protection. `call_tool` therefore checks its tool name against `READ_TOOLS` as its
FIRST statement, before any I/O, and `tools/call` is the only place a tool name is ever sent.
A name outside the allow-list (a write tool, or a read-only tool nobody chose, such as
`semantic_search`) raises `WriteToolRefused` and nothing reaches the network.
`api/services/journal_two/test_note_connectors_evernote_mcp.py` pins it against the measured
schema, not a typed copy (mutation-proved: removing the check, moving it after the handshake, or
adding `semantic_search` each turn the rail red).

Protocol (MCP 2025-06-18, streamable HTTP): every message is a POST to `MCP_URL`; the session is
opened lazily by the first `call_tool` with `initialize` then `notifications/initialized`; the
server's `Mcp-Session-Id` (when it sends one) and `MCP-Protocol-Version` ride every later request.
A reply is either `application/json` or `text/event-stream`; for SSE the reply is the event whose
JSON-RPC `id` matches the request. A 404 on a request carrying a session id means the session
expired: re-initialise once.

Errors outward are only the `errors` taxonomy. The bearer token is never logged and never put in
an error string (transport errors report their exception TYPE only).
"""

from __future__ import annotations

import asyncio
import codecs
import datetime as _dt
import json
import logging
import math
import random
import re
import threading
import time
from collections import deque
from email.utils import parsedate_to_datetime
from typing import Any, Awaitable, Callable

import httpx

from . import errors
from .providers.base import MEDIA_USER_AGENT

log = logging.getLogger(__name__)

MCP_URL = "https://mcp.evernote.com/mcp"
PROTOCOL_VERSION = "2025-06-18"

# The ONLY tools this product may call. All five are `readOnlyHint: true` in the probe capture.
READ_TOOLS: frozenset[str] = frozenset(
    {"search_notes", "get_note", "get_attachment", "search_notebooks", "search_tags"})

# Ruling (Plan E Task 1): retry 5 times on the doubling ladder, pace calls 0.2 s apart. Evernote
# publishes no limits; the probe saw none in 80+ calls (slowest 2.5 s).
RETRY_DELAYS_S = (1.0, 2.0, 4.0, 8.0, 16.0)
MAX_RETRY_AFTER_S = 60.0
MIN_CALL_INTERVAL_S = 0.2
MAX_RESPONSE_BYTES = 16 * 1024 * 1024
TIMEOUT = httpx.Timeout(60.0, connect=10.0)
# `TIMEOUT` is per operation, so a stream that keeps sending keep-alives resets it forever; this
# wall-clock bound covers one whole request (send + read). Expiry is retried like a timeout.
REQUEST_DEADLINE_S = 120.0

# Tool-level rate limit (live gate 2026-11-03). Evernote's hosted MCP server reports its per-minute
# limit ("tool calls are rate-limited per minute -- both per tool and across all tools", no numbers
# published) as a TOOL error, not an HTTP 429: a `tools/call` result with `isError: true` and the
# text `Rate limit exceeded: "get_note" is being called faster than allowed. Wait about 60
# second(s)...`. The owner's first pass created 75 of 215 notes and failed the other 140 fast,
# because that result used to be a final `NoteConnUnsupported`.
#
# Handling, the same as an HTTP 429: wait min(N, MAX_RETRY_AFTER_S) + RATE_LIMIT_MARGIN_S, N parsed
# from "Wait about N second(s)" (TOOL_RATE_LIMIT_DEFAULT_WAIT_S when absent), then send the SAME call
# again, at most TOOL_RATE_LIMIT_RETRIES times; after that `NoteConnRateLimited`. Any other
# `isError` is the final `NoteConnUnsupported` it always was.
_TOOL_RATE_LIMIT_RE = re.compile(r"rate limit exceeded|being called faster than allowed", re.IGNORECASE)
_TOOL_RATE_LIMIT_WAIT_RE = re.compile(r"wait\s+about\s+(\d+(?:\.\d+)?)\s*second", re.IGNORECASE)
TOOL_RATE_LIMIT_RETRIES = 3
TOOL_RATE_LIMIT_DEFAULT_WAIT_S = 60.0
RATE_LIMIT_MARGIN_S = 1.0
# Adaptive pacing. Before the first rate limit of a session (one client = one sync pass) calls are
# paced only MIN_CALL_INTERVAL_S apart, so a healthy pass stays fast. At a trip, the calls sent in
# the RATE_WINDOW_S before it are the best measure of the limit we have, so the interval becomes
# RATE_WINDOW_S / that count / ADAPTIVE_RATE_FRACTION (80% of the rate that tripped), and at least
# double the previous adaptive interval on a second trip; always clamped to
# [ADAPTIVE_MIN_INTERVAL_S, ADAPTIVE_MAX_INTERVAL_S]. It only ever slows, and only for the rest of
# that session. The interval runs from the START of the previous call, so a call's own latency
# counts toward it.
RATE_WINDOW_S = 60.0
ADAPTIVE_RATE_FRACTION = 0.8
ADAPTIVE_MIN_INTERVAL_S = 1.0
ADAPTIVE_MAX_INTERVAL_S = 10.0
# The most one session spends WAITING on tool-level rate limits. Once spent, a rate-limited call
# raises `NoteConnRateLimited` at once, so a server that keeps refusing cannot hold a pass for hours
# (215 notes x 3 retries x 61 s would be ~11 h). The notes not read stay pending: the engine holds
# the cursor for any listed note it did not store, and the next pass asks again.
RATE_LIMIT_WAIT_BUDGET_S = 600.0
# Fix round 1 (D2): the wall clock of one session (one sync pass), from its first call. Pacing
# sleeps and rate-limit waits are both charged to it: a sleep that would end past it is not taken,
# and from then on every call raises `NoteConnRateLimited` WITHOUT being sent. So a server that
# refuses everything ends the pass within this, never hours later; the notes not read are
# rate-limit leftovers the engine follows up on (and, with D1, never fetches twice).
SESSION_BUDGET_S = 600.0
# Fix round 1 (I6): after RAMP_DOWN_AFTER_CALLS clean calls in a row the interval eases by
# RAMP_DOWN_FACTOR, never below the first trip's estimate (or the adaptive floor for a seeded
# session), so a doubling a penalty forced is given back slowly.
RAMP_DOWN_AFTER_CALLS = 50
RAMP_DOWN_FACTOR = 0.9
# Fix round 2 (N2): SESSION_BUDGET_S is the clock of the FETCH phase only. It starts at the first
# of these tools; listings (`search_*`) are never charged to it.
FETCH_TOOLS: frozenset[str] = frozenset({"get_note", "get_attachment"})
# N2: each listing (`begin_listing` .. `end_listing`: the main listing, and on a full pass each
# removal listing) gets its own allowance: max(LISTING_ALLOWANCE_MIN_S, pages x the HIGHEST pacing
# interval seen during the listing x LISTING_ALLOWANCE_FACTOR), read at every check, so a trip
# mid-listing widens it and a ramp-down never shrinks it. The
# rate-limit wait budget and the provider's page cap (`_MAX_PAGES`) bound it on top.
LISTING_ALLOWANCE_MIN_S = 900.0
LISTING_ALLOWANCE_FACTOR = 1.5
# NEW-3: the ceilings. `pages` comes from the server's `totalResultCount` (the provider clamps it
# to its `_MAX_PAGES`, 1000 pages = 100 000 notes), and nothing else bounded a listing's clock:
# a pass could hold its slot for LISTING_ATTEMPTS restarts plus a full pass's two removal
# listings, each at 1000 pages x 10 s x 1.5 = 4 h, i.e. a day.
#  * LISTING_ALLOWANCE_MAX_S, one listing: an hour lists 240 pages (24 000 notes) at the 10 s
#    pacing ceiling x 1.5, and 2 400 pages (more than any library the pager reads) at the 1 s
#    adaptive floor, where a session that tripped usually settles. A library too big to list in
#    an hour at the worst pace is a listing that fails (no strike; the next pass lists again, at
#    the pace this one learned), never a pass that owns a slot all day.
#  * PASS_LISTING_BUDGET_S, every listing of one session (pass) together: two hours, i.e. two
#    full hour-long listings (a full pass's complete listing plus its trash listing) or any mix
#    of shorter ones and restarts. Past it every listing call is refused unsent, so a pass holds
#    its slot for at most ~2 h of listing plus the 10 min fetch clock (SESSION_BUDGET_S).
LISTING_ALLOWANCE_MAX_S = 3600.0
PASS_LISTING_BUDGET_S = 7200.0
# N6: only a wait over this closes the session (a server telling us to go away). A wait over
# MAX_RETRY_AFTER_S up to this is slept ONCE per call, charged to the wait budget.
LONG_WAIT_S = 120.0
# D4: the process-level guard. Whether Evernote's limit is per user or per app is unknown; the
# adaptive pacing reacts to a session's own trips either way. On top, every trip of every
# session in this process is logged, and while GLOBAL_TRIP_THRESHOLD or more landed in the last
# RATE_WINDOW_S, a NEW session waits before its first call (until the oldest leaves the window),
# at most GLOBAL_GATE_MAX_WAIT_S. Six a minute is each of the follow-up pool's three slots
# tripping twice. ⚠️ SINGLE-PROCESS state, like the other module-level bounds CLAUDE.md lists: a
# second web process keeps its own log, so each would only see its own trips.
GLOBAL_TRIP_THRESHOLD = 6
GLOBAL_GATE_MAX_WAIT_S = 120.0
_GLOBAL_TRIPS: deque[float] = deque()
# NEW-6: the trip log is written and read from several threads (the uvicorn loop's passes and
# each scheduler job's own loop), so every touch of it holds this lock. Never held across I/O.
_GLOBAL_LOCK = threading.Lock()


def _global_clock() -> float:
    """The process-level trip log's clock (tests replace it)."""
    return time.monotonic()


def _prune_global_trips(now: float) -> None:
    """Caller holds `_GLOBAL_LOCK`."""
    while _GLOBAL_TRIPS and _GLOBAL_TRIPS[0] <= now - RATE_WINDOW_S:
        _GLOBAL_TRIPS.popleft()


def _record_global_trip() -> None:
    now = _global_clock()
    with _GLOBAL_LOCK:
        _GLOBAL_TRIPS.append(now)
        _prune_global_trips(now)
        while len(_GLOBAL_TRIPS) > 4096:  # a memory bound
            _GLOBAL_TRIPS.popleft()


def _global_trip_window() -> tuple[int, float | None]:
    """(trips in the last RATE_WINDOW_S, the oldest of them), read in ONE locked step."""
    now = _global_clock()
    with _GLOBAL_LOCK:
        _prune_global_trips(now)
        return len(_GLOBAL_TRIPS), (_GLOBAL_TRIPS[0] if _GLOBAL_TRIPS else None)


def recent_global_trips() -> int:
    """How many Evernote rate-limit trips this process saw in the last RATE_WINDOW_S."""
    return _global_trip_window()[0]

CLIENT_INFO = {"name": "uct-notebook-sync", "version": "1.0"}
# The same User-Agent as our media fetches (`providers/base.py`).
USER_AGENT = MEDIA_USER_AGENT


class WriteToolRefused(errors.NoteConnUnsupported):
    """A tool name outside `READ_TOOLS` was asked for. Raised before any I/O."""


class _SessionLost(Exception):
    """Internal: 404 on a request that carried a session id."""


class _HttpRateLimited(Exception):
    """Internal: an HTTP 429. `call_tool` handles it exactly as a tool-level limit (I5)."""

    def __init__(self, retry_after: float | None) -> None:
        super().__init__("429")
        self.retry_after = retry_after


def _default_jitter() -> float:
    return random.uniform(0.5, 1.5)


def _retry_after_s(resp: httpx.Response) -> float | None:
    """`Retry-After` as seconds (uncapped: the caller caps where it sleeps), or None (use the
    ladder).

    Delta-seconds or an HTTP-date. NaN, infinity, a negative number, an unparseable value or a date
    that is already past all give None."""
    raw = resp.headers.get("retry-after")
    if raw is None:
        return None
    raw = raw.strip()
    try:
        value = float(raw)
    except ValueError:
        try:
            when = parsedate_to_datetime(raw)
        except (TypeError, ValueError, IndexError):
            return None
        if when is None:
            return None
        if when.tzinfo is None:
            when = when.replace(tzinfo=_dt.timezone.utc)
        value = (when - _dt.datetime.now(_dt.timezone.utc)).total_seconds()
        if value <= 0:
            return None
    if not math.isfinite(value) or value < 0:
        return None
    return value


def _tool_error_text(result: dict) -> str:
    """The first text block of an `isError` tool result ('' when none)."""
    for block in result.get("content") or []:
        if isinstance(block, dict) and block.get("type") == "text":
            return str(block.get("text") or "")
    return ""


def _tool_rate_limit_wait_s(result: Any) -> float | None:
    """For a tool-level rate-limit result: the server's asked-for wait in seconds, UNCAPPED
    (`TOOL_RATE_LIMIT_DEFAULT_WAIT_S` when the text names none): a wait over `MAX_RETRY_AFTER_S` is
    not slept through at all (fix round 1, I7). None for anything that is not a rate-limit error."""
    if not isinstance(result, dict) or not result.get("isError"):
        return None
    text = _tool_error_text(result)
    if not _TOOL_RATE_LIMIT_RE.search(text):
        return None
    wait = TOOL_RATE_LIMIT_DEFAULT_WAIT_S
    m = _TOOL_RATE_LIMIT_WAIT_RE.search(text)
    if m:
        wait = float(m.group(1))  # digits only: always finite and >= 0
    return wait


def _sse_event_data(event: str) -> str | None:
    """The joined `data:` payload of one SSE event, or None when it has none (a comment such as a
    keep-alive). Per the SSE spec exactly one leading space after the colon is removed."""
    lines = []
    for line in event.split("\n"):
        if line.startswith("data:"):
            value = line[5:]
            if value.startswith(" "):
                value = value[1:]
            lines.append(value)
    if not lines:
        return None
    return "\n".join(lines)


def _sse_messages(event: str) -> list[Any]:
    """The JSON-RPC message(s) in one SSE event (none for a keep-alive). Raises ValueError on
    data that is not JSON."""
    data = _sse_event_data(event)
    if data is None or not data.strip():
        return []
    parsed = json.loads(data)
    return parsed if isinstance(parsed, list) else [parsed]


_NO_REPLY = object()


class _SseSplitter:
    """Splits a streamed SSE body into events (separated by a blank line once CRLF is normalised
    to LF), in time LINEAR in the body (final review I1(a)).

    `feed(text)` returns the events `text` completes. Only `text` is normalised and searched: a
    trailing `\r` is held back to the next chunk (it may start a CRLF pair), and whether the pending
    event ends in `\n` is remembered, so a blank line cut across two chunks is still found. The
    pending event is a list of segments, joined once when it completes. `finish()` returns what is
    left at EOF (an event with no blank line after it). Together they give exactly
    `body.replace("\r\n", "\n").split("\n\n")`, the old whole-buffer split, minus empty events."""

    def __init__(self) -> None:
        self._segments: list[str] = []
        self._ends_nl = False
        self._carry_cr = False

    def feed(self, text: str) -> list[str]:
        if self._carry_cr:
            text, self._carry_cr = "\r" + text, False
        if text.endswith("\r"):
            text, self._carry_cr = text[:-1], True
        text = text.replace("\r\n", "\n")
        events: list[str] = []
        pos = 0
        if self._ends_nl and text.startswith("\n"):
            events.append("".join(self._segments)[:-1])  # the blank line straddled two chunks
            self._segments, pos = [], 1
        while True:
            at = text.find("\n\n", pos)
            if at < 0:
                break
            events.append("".join(self._segments) + text[pos:at])
            self._segments, pos = [], at + 2
        rest = text[pos:]
        if rest:
            self._segments.append(rest)
            self._ends_nl = rest.endswith("\n")
        elif pos:
            self._ends_nl = False
        return events

    def finish(self) -> list[str]:
        text = "".join(self._segments) + ("\r" if self._carry_cr else "")
        self._segments, self._carry_cr, self._ends_nl = [], False, False
        return [text] if text else []


def _pick(messages: list[Any], rid: str, method: str) -> Any:
    """The `result` of the message whose JSON-RPC id is `rid`, `_NO_REPLY` when none matches.
    A JSON-RPC `error` reply raises `NoteConnUnsupported`."""
    for msg in messages:
        if not isinstance(msg, dict) or msg.get("id") != rid:
            continue
        if "error" in msg:
            err = msg.get("error") or {}
            message = str(err.get("message") or "error") if isinstance(err, dict) else str(err)
            raise errors.NoteConnUnsupported(
                f"evernote mcp: {method} failed: {message}", reason=message,
                code="evernote_jsonrpc_error", body=err)
        return msg.get("result")
    return _NO_REPLY


class EvernoteMcpClient:
    """One member's MCP session. Not shared between members; calls are serialised."""

    def __init__(
        self,
        access_token: str,
        *,
        http: httpx.AsyncClient | None = None,
        on_unauthorized: Callable[[], Awaitable[str]] | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        clock: Callable[[], float] = time.monotonic,
        jitter: Callable[[], float] = _default_jitter,
    ) -> None:
        self._token = access_token
        self._owns_http = http is None
        self._http = http if http is not None else httpx.AsyncClient(timeout=TIMEOUT)
        self._on_unauthorized = on_unauthorized
        self._sleep = sleep
        self._clock = clock
        self._jitter = jitter
        self._session_id: str | None = None
        self._initialized = False
        self._next_id = 0
        self._last_call_at: float | None = None
        # Adaptive pacing state (see RATE_WINDOW_S): this session's per-call interval, whether a
        # rate limit has slowed it yet, the send times of recent tool calls, and the seconds spent
        # waiting on tool-level rate limits (bounded by RATE_LIMIT_WAIT_BUDGET_S).
        self.call_interval_s = MIN_CALL_INTERVAL_S
        self._adapted = False
        self._sent_at: deque[float] = deque()
        self._rate_limit_waited_s = 0.0
        # Fix round 1: the first trip's estimate (the ramp-down floor), whether a trip happened
        # this session (what the engine stores, D3), clean calls since the last trip or ease (I6),
        # when the session started and whether it is closed (D2), and M1's once-per-session log.
        self._estimate = ADAPTIVE_MIN_INTERVAL_S
        self._tripped = False
        self._clean_calls = 0
        self._started_at: float | None = None
        # Fix round 2 (N2): the fetch clock's start, the current listing's start and size (None
        # outside a listing), and which phases ran out of clock ("fetch", "listing").
        self._fetch_started_at: float | None = None
        self._listing_started_at: float | None = None
        self._listing_pages: int | None = None
        self._listing_peak_interval = MIN_CALL_INTERVAL_S
        # NEW-3: listing seconds this session already spent (closed listings), against
        # PASS_LISTING_BUDGET_S.
        self._listing_spent_s = 0.0
        self._phase_closed: set[str] = set()
        self._closed_reason: str | None = None
        self._closed_retry_after: float | None = None
        self._unmatched_logged = False
        self._refresh_spent = False
        self._lock = asyncio.Lock()
        # The name of every `tools/call` actually sent (each attempt), kept for rails.
        self.tool_calls: list[str] = []

    # ------------------------------------------------------------------ public

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if name not in READ_TOOLS:
            raise WriteToolRefused(
                f"evernote mcp: tool {name!r} is not on the read-only allow-list",
                reason="This connector only reads from Evernote.",
                code="evernote_write_refused")
        async with self._lock:
            # At most ONE `on_unauthorized` per call_tool: each refresh rotates the refresh token.
            self._refresh_spent = False
            if self._started_at is None:
                await self._global_gate()  # D4: a new session waits out a burst of trips
                self._started_at = self._clock()
            if name in FETCH_TOOLS and self._fetch_started_at is None:
                self._fetch_started_at = self._clock()  # N2: the fetch clock starts here
            limited = 0
            while True:
                self._refuse_if_closed(name)
                if limited == 0:
                    # A retry goes straight after the server's own wait; pacing resumes with
                    # the next new call.
                    await self._pace(name)
                try:
                    result = await self._call_once(name, arguments, self._deadline(name))
                    wait = _tool_rate_limit_wait_s(result)
                    status = None
                except _HttpRateLimited as hit:
                    # I5: an HTTP 429 takes the same path as the tool-level limit. No Retry-After
                    # means the transport ladder's step, never an unbounded guess.
                    result, status = None, 429
                    wait = hit.retry_after
                    if wait is None:
                        wait = RETRY_DELAYS_S[min(limited, len(RETRY_DELAYS_S) - 1)] * self._jitter()
                if wait is None:
                    self._note_clean()
                    self._log_unmatched(name, result)
                    return self._structured(name, result)
                limited = await self._rate_limited(name, wait, limited, status)

    def seed_interval(self, interval_s: float) -> None:
        """D3: start this session at the interval an earlier pass learned (the engine decays it
        by age first), clamped to [ADAPTIVE_MIN_INTERVAL_S, ADAPTIVE_MAX_INTERVAL_S]. A seeded
        session counts as adapted: its first trip doubles rather than re-estimates."""
        if not isinstance(interval_s, (int, float)) or not math.isfinite(interval_s):
            return
        self.call_interval_s = min(max(float(interval_s), ADAPTIVE_MIN_INTERVAL_S),
                                   ADAPTIVE_MAX_INTERVAL_S)
        self._adapted = True
        self._estimate = ADAPTIVE_MIN_INTERVAL_S

    def begin_listing(self) -> None:
        """N2: a listing starts (the provider calls this before its first page). Its search_notes
        calls are charged to their own allowance, never to the fetch clock."""
        self._listing_started_at = self._clock()
        self._listing_pages = None
        self._listing_peak_interval = self.call_interval_s
        self._phase_closed.discard("listing")

    def size_listing(self, pages: int) -> None:
        """N2: the listing's page count, once page 0 has said how many results there are."""
        if isinstance(pages, int) and pages >= 0:
            self._listing_pages = pages

    def end_listing(self) -> None:
        if self._listing_started_at is not None:
            self._listing_spent_s += max(0.0, self._clock() - self._listing_started_at)
        self._listing_started_at = None
        self._listing_pages = None
        self._phase_closed.discard("listing")

    def listing_allowance_s(self) -> float:
        """Sized by the HIGHEST interval seen during this listing: a trip widens it, and a
        ramp-down never shrinks it below what the listing already spent."""
        self._listing_peak_interval = max(self._listing_peak_interval, self.call_interval_s)
        sized = max(LISTING_ALLOWANCE_MIN_S,
                    (self._listing_pages or 0) * self._listing_peak_interval
                    * LISTING_ALLOWANCE_FACTOR)
        # NEW-3: never past one listing's ceiling, nor past what the pass's budget has left.
        left = max(0.0, PASS_LISTING_BUDGET_S - self._listing_spent_s)
        return min(sized, LISTING_ALLOWANCE_MAX_S, left)

    def _phase(self, name: str) -> str | None:
        if name in FETCH_TOOLS:
            return "fetch"
        if name == "search_notes" and self._listing_started_at is not None:
            return "listing"
        return None

    def _deadline(self, name: str) -> float | None:
        """N2: when the clock of this tool's phase runs out (None: uncharged)."""
        phase = self._phase(name)
        if phase == "fetch" and self._fetch_started_at is not None:
            return self._fetch_started_at + SESSION_BUDGET_S
        if phase == "listing":
            return self._listing_started_at + self.listing_allowance_s()
        return None

    async def _global_gate(self) -> None:
        """D4: before a session's first call, wait while this process saw GLOBAL_TRIP_THRESHOLD
        or more Evernote trips in the last minute, at most GLOBAL_GATE_MAX_WAIT_S in all."""
        waited = 0.0
        while waited < GLOBAL_GATE_MAX_WAIT_S:
            # NEW-6: the count and the oldest trip in one locked read (another thread may prune).
            trips, oldest = _global_trip_window()
            if trips < GLOBAL_TRIP_THRESHOLD or oldest is None:
                return
            step = max(1.0, oldest + RATE_WINDOW_S - _global_clock())
            step = min(step, GLOBAL_GATE_MAX_WAIT_S - waited)
            log.info("evernote mcp: %d trips in the last minute across sessions; a new session "
                     "waits %.0f s", trips, step)
            await self._sleep(step)
            waited += step

    def learned_interval(self) -> tuple[float | None, bool]:
        """(the session's adaptive interval or None, whether a rate limit tripped this session).
        The engine stores the interval only when it was learned THIS session (D3)."""
        return (self.call_interval_s if self._adapted else None), self._tripped

    def _close(self, reason: str, retry_after: float | None = None) -> None:
        if self._closed_reason is None:
            self._closed_reason = reason
            self._closed_retry_after = retry_after
            log.info("evernote mcp: session closed (%s); the rest is left for the follow-up pass",
                     reason)

    def _refuse_if_closed(self, name: str) -> None:
        phase = self._phase(name)
        deadline = self._deadline(name)
        if phase is not None and deadline is not None and self._clock() >= deadline:
            self._phase_closed.add(phase)
        if self._closed_reason is not None:
            raise errors.NoteConnRateLimited(
                f"evernote mcp: {name} not sent: this sync's Evernote budget is spent "
                f"({self._closed_reason})", retry_after=self._closed_retry_after,
                code="evernote_session_closed")
        if phase is not None and phase in self._phase_closed:
            raise errors.NoteConnRateLimited(
                f"evernote mcp: {name} not sent: this sync's {phase} clock is spent",
                code="evernote_session_closed")

    def _within_wall_clock(self, seconds: float, name: str) -> bool:
        deadline = self._deadline(name)
        return deadline is None or self._clock() + seconds <= deadline

    def _out_of_clock(self, name: str) -> errors.NoteConnRateLimited:
        phase = self._phase(name)
        if phase is not None:
            self._phase_closed.add(phase)
        return errors.NoteConnRateLimited(
            f"evernote mcp: {name} not sent: this sync's {phase or 'session'} clock is spent",
            code="evernote_session_closed")

    async def _rate_limited(self, name: str, wait: float, limited: int, status: int | None) -> int:
        """The ONE handler for a rate limit, tool-level or HTTP 429 (I5): slow the session, then
        wait and retry the same call, or raise. Returns the new retry count."""
        self._slow_down()
        if wait > LONG_WAIT_S:
            # I7 + N6: never slept through. The session is closed (nothing more is sent this
            # pass) and the real wait goes up, so the engine books the follow-up for then.
            self._close("Evernote asked for a long wait", retry_after=wait)
            raise errors.NoteConnRateLimited(
                f"evernote mcp: {name} rate limited by Evernote for {wait:.0f} s",
                retry_after=wait, status=status, code="evernote_tool_rate_limited")
        # N6: a wait over MAX_RETRY_AFTER_S (up to LONG_WAIT_S) is slept once per call; a second
        # one on the same call raises, leaving the session open for the next call.
        second_long = wait > MAX_RETRY_AFTER_S and limited > 0
        delay = wait + RATE_LIMIT_MARGIN_S
        over_budget = self._rate_limit_waited_s + delay > RATE_LIMIT_WAIT_BUDGET_S
        over_clock = not self._within_wall_clock(delay, name)
        if over_budget:
            self._close("rate-limit wait budget spent")
        elif over_clock:
            self._out_of_clock(name)
        if limited >= TOOL_RATE_LIMIT_RETRIES or over_budget or over_clock or second_long:
            raise errors.NoteConnRateLimited(
                f"evernote mcp: {name} rate limited by Evernote after {limited} "
                f"retr{'y' if limited == 1 else 'ies'}", retry_after=wait, status=status,
                code="evernote_tool_rate_limited")
        self._rate_limit_waited_s += delay
        log.info("evernote mcp: %s rate limited; waiting %.0f s (retry %d of %d), "
                 "pacing %.2f s per call", name, delay, limited + 1,
                 TOOL_RATE_LIMIT_RETRIES, self.call_interval_s)
        await self._sleep(delay)
        return limited + 1

    def _note_clean(self) -> None:
        """I6: a slow, bounded ramp down after RAMP_DOWN_AFTER_CALLS clean calls in a row."""
        if not self._adapted:
            return
        self._clean_calls += 1
        if self._clean_calls >= RAMP_DOWN_AFTER_CALLS:
            self._clean_calls = 0
            self.call_interval_s = max(self._estimate, self.call_interval_s * RAMP_DOWN_FACTOR)

    def _log_unmatched(self, name: str, result: Any) -> None:
        """M1: a tool error that is NOT the rate-limit wording, logged once per session, so a
        changed wording shows up in the log instead of reading as many unrelated failures."""
        if (self._unmatched_logged or not isinstance(result, dict)
                or not result.get("isError")):
            return
        self._unmatched_logged = True
        log.warning("evernote mcp: %s returned a tool error that is not a rate limit: %s",
                    name, _tool_error_text(result)[:300])

    async def _call_once(self, name: str, arguments: dict[str, Any],
                         deadline: float | None = None) -> Any:
        for attempt in range(2):
            try:
                # Inside the try: a 404 on the handshake's `notifications/initialized` is a lost
                # session too, and must never leak `_SessionLost` (review m3).
                await self._ensure_session()
                return await self._request(
                    "tools/call", {"name": name, "arguments": arguments}, tool=name,
                    deadline=deadline)
            except _SessionLost:
                self._session_id = None
                self._initialized = False
                if attempt == 1:
                    raise errors.NoteConnTransient(
                        "evernote mcp: session lost twice in a row", status=404) from None
        raise AssertionError("unreachable")

    async def aclose(self) -> None:
        if self._owns_http:
            await self._http.aclose()

    # ------------------------------------------------------------------ session

    async def _pace(self, name: str = "call") -> None:
        if self._last_call_at is None:
            return
        wait = self.call_interval_s - (self._clock() - self._last_call_at)
        if wait > 0:
            if not self._within_wall_clock(wait, name):
                # D2: pacing is charged to the phase's clock too.
                raise self._out_of_clock(name)
            await self._sleep(wait)

    def _slow_down(self) -> None:
        """A rate limit tripped: slow this session's calls. I6: the FIRST trip estimates from the
        window that ended at it (see RATE_WINDOW_S); every later trip (a retry right after a wait,
        whose window holds almost nothing, included) doubles. Clamped, and only ever slower."""
        self._tripped = True
        self._clean_calls = 0
        _record_global_trip()  # D4
        if not self._adapted:
            now = self._clock()
            while self._sent_at and self._sent_at[0] <= now - RATE_WINDOW_S:
                self._sent_at.popleft()
            observed = max(len(self._sent_at), 1)
            interval = RATE_WINDOW_S / observed / ADAPTIVE_RATE_FRACTION
            interval = min(max(interval, ADAPTIVE_MIN_INTERVAL_S), ADAPTIVE_MAX_INTERVAL_S)
            self._estimate = interval
        else:
            interval = min(max(2 * self.call_interval_s, ADAPTIVE_MIN_INTERVAL_S),
                           ADAPTIVE_MAX_INTERVAL_S)
        self.call_interval_s = max(self.call_interval_s, interval)
        self._adapted = True

    async def _ensure_session(self) -> None:
        if self._initialized:
            return
        self._session_id = None
        await self._request("initialize", {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": dict(CLIENT_INFO),
        })
        await self._request("notifications/initialized", None, notification=True)
        self._initialized = True

    # ------------------------------------------------------------------ transport

    def _headers(self) -> dict[str, str]:
        # The version header rides EVERY request, `initialize` included, as in the probe request
        # that worked against the real server (review m2).
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
            "MCP-Protocol-Version": PROTOCOL_VERSION,
            "User-Agent": USER_AGENT,
        }
        if self._session_id:
            headers["Mcp-Session-Id"] = self._session_id
        return headers

    async def _request(self, method: str, params: dict | None, *, notification: bool = False,
                       tool: str | None = None, deadline: float | None = None) -> Any:
        """`deadline` (N7): the clock the call's phase ends at. A transport or 5xx retry whose
        ladder sleep would end past it is not taken: the call raises `NoteConnRateLimited` (a
        leftover), so one call overruns the clock by at most one REQUEST_DEADLINE_S."""
        payload: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            payload["params"] = params
        rid: str | None = None
        if not notification:
            self._next_id += 1
            rid = f"uct-{self._next_id}"
            payload["id"] = rid
        body = json.dumps(payload).encode("utf-8")
        handshake = method == "initialize"

        attempt = 0
        while True:
            headers = self._headers()
            had_session = "Mcp-Session-Id" in headers
            if tool is not None:
                self.tool_calls.append(tool)
                self._last_call_at = self._clock()
                self._sent_at.append(self._last_call_at)
                if len(self._sent_at) > 4096:  # a memory bound; each trip prunes to the window
                    self._sent_at.popleft()
            try:
                status, resp, reply = await asyncio.wait_for(
                    self._send(body, headers, rid, method), REQUEST_DEADLINE_S)
            except (httpx.TransportError, asyncio.TimeoutError) as exc:
                if attempt >= len(RETRY_DELAYS_S):
                    raise errors.NoteConnTransient(
                        f"evernote mcp: transport error ({type(exc).__name__}) on {method}"
                    ) from None
                delay = RETRY_DELAYS_S[attempt] * self._jitter()
                if deadline is not None and self._clock() + delay > deadline:
                    raise errors.NoteConnRateLimited(
                        f"evernote mcp: {method} not retried: this sync's clock is spent",
                        code="evernote_session_closed") from None
                await self._sleep(delay)
                attempt += 1
                continue

            if status == 401:
                if self._on_unauthorized is not None and not self._refresh_spent:
                    self._refresh_spent = True
                    self._token = await self._on_unauthorized()
                    continue
                raise errors.NoteConnAuthError(
                    "evernote mcp: access token rejected (401)", status=401)
            if status == 403:
                raise errors.NoteConnAuthError(
                    "evernote mcp: access forbidden (403)", status=403,
                    code="evernote_forbidden")
            if status == 404 and had_session and not handshake:
                raise _SessionLost()
            if status == 429:
                # I5: handled by `call_tool`'s one rate-limit handler (slow down, budget, cap).
                raise _HttpRateLimited(_retry_after_s(resp))
            if status >= 500:
                if attempt >= len(RETRY_DELAYS_S):
                    raise errors.NoteConnTransient(
                        f"evernote mcp: HTTP {status} on {method}", status=status)
                retry_after = _retry_after_s(resp) if status == 503 else None
                if retry_after is not None:
                    retry_after = min(retry_after, MAX_RETRY_AFTER_S)
                delay = retry_after if retry_after is not None else (
                    RETRY_DELAYS_S[attempt] * self._jitter())
                if deadline is not None and self._clock() + delay > deadline:
                    raise errors.NoteConnRateLimited(
                        f"evernote mcp: {method} not retried: this sync's clock is spent",
                        status=status, code="evernote_session_closed")
                await self._sleep(delay)
                attempt += 1
                continue
            if status == 404:
                raise errors.NoteConnTransient(
                    f"evernote mcp: HTTP 404 on {method}", status=404)
            if status >= 400:
                raise errors.NoteConnError(
                    f"evernote mcp: HTTP {status} on {method}", status=status)

            if handshake:
                sid = resp.headers.get("mcp-session-id")
                if sid:
                    self._session_id = sid
            if notification:
                return None
            return reply

    async def _send(self, body: bytes, headers: dict[str, str], rid: str | None,
                    method: str) -> tuple[int, httpx.Response, Any]:
        """POST; on a 2xx reply to a request (not a notification) read and return its JSON-RPC
        `result`. The body is streamed and capped at `MAX_RESPONSE_BYTES` by a running count (a
        chunked SSE reply has no Content-Length). An SSE reply is parsed event by event and the
        read STOPS at the event carrying `rid`: the server may hold the stream open with
        keep-alives after it, so waiting for EOF could never end (review m5)."""
        async with self._http.stream("POST", MCP_URL, content=body, headers=headers,
                                     timeout=TIMEOUT) as resp:
            status = resp.status_code
            if rid is None or not 200 <= status < 300:
                return status, resp, None
            declared = resp.headers.get("content-length")
            if declared is not None and declared.isdigit() and int(declared) > MAX_RESPONSE_BYTES:
                raise errors.NoteConnTooLarge(
                    f"evernote mcp: response of {declared} bytes is over the cap")
            is_sse = "text/event-stream" in resp.headers.get("content-type", "").lower()
            decoder = codecs.getincrementaldecoder("utf-8")()
            # Final review I1(a): LINEAR in the reply. A `get_note` reply is one SSE event, so
            # nothing is consumed until it ends; normalising and searching the whole buffer on every
            # chunk was quadratic (a 16 MB reply cost ~20 s of CPU on the event loop). Each chunk's
            # text is handled once: `_SseSplitter` normalises and searches only the new text (plus
            # one carried character), and the JSON path joins its parts once, at the end.
            splitter = _SseSplitter() if is_sse else None
            parts: list[str] = []
            total = 0
            chunks = resp.aiter_bytes()
            try:
                async for chunk in chunks:
                    total += len(chunk)
                    if total > MAX_RESPONSE_BYTES:
                        raise errors.NoteConnTooLarge("evernote mcp: response is over the cap")
                    text = decoder.decode(chunk)
                    if splitter is None:
                        parts.append(text)
                        continue
                    for event in splitter.feed(text):
                        found = _pick(_sse_messages(event), rid, method)
                        if found is not _NO_REPLY:
                            return status, resp, found
                tail = decoder.decode(b"", final=True)
                if splitter is not None:
                    messages = [m for event in [*splitter.feed(tail), *splitter.finish()]
                                for m in _sse_messages(event)]
                else:
                    parsed = json.loads("".join(parts) + tail)
                    messages = parsed if isinstance(parsed, list) else [parsed]
            except (UnicodeDecodeError, ValueError):
                raise errors.NoteConnTransient(
                    f"evernote mcp: unreadable reply to {method}") from None
            finally:
                # Leaving the loop early (the reply arrived, or the cap) must close the iterator.
                await chunks.aclose()
            found = _pick(messages, rid, method)
            if found is _NO_REPLY:
                raise errors.NoteConnTransient(f"evernote mcp: no reply to {method}")
            return status, resp, found

    @staticmethod
    def _structured(name: str, result: Any) -> dict[str, Any]:
        if not isinstance(result, dict):
            raise errors.NoteConnTransient(f"evernote mcp: {name} returned no result")
        if result.get("isError"):
            text = _tool_error_text(result) or f"{name} failed"
            raise errors.NoteConnUnsupported(
                f"evernote mcp: {name}: {text}", reason=text, code="evernote_tool_error")
        sc = result.get("structuredContent")
        if not isinstance(sc, dict):
            raise errors.NoteConnUnsupported(
                f"evernote mcp: {name} returned no structuredContent",
                code="evernote_shape")
        return sc
