"""AI SPEND GUARD — one app-wide ceiling, every paid model call reserved first and counted after.

⭐ WHY THIS EXISTS (owner, 2026-10-11). About $50 of Anthropic credit went in two days
and nothing could say WHERE. The repo already had good per-lane guards (the catalyst
`cost_guard` $15/day, `narrative_cost_guard`, call-recap, theme, pattern-vision,
concierge per-member caps) — but 30 of the 44 member AI doors in `ai_doors.py` have no
meter, several have no dollar bound at all, and no single number bounded the DAY. This
module is that number. It is NOT a second ledger beside the others: it adds no pricing
(`catalyst.cost_guard.estimate_cost` is the one table), no store (`daily_counters`, the
durable per-ET-day counters in auth.db, is the one store), and no "am I in production?"
signal (`vendor_socket_guard.on_production` is the one authority).

⭐⭐ TWO PLACES EVERY PAID CALL PASSES.
  1. The Anthropic SDK's own methods — `messages.create` / `.stream` / `.parse` (and the
     beta twins), sync and async, and `messages.batches.create` — are wrapped once per
     process (`install`): the call's worst-case cost is RESERVED before it is sent and
     SETTLED against the usage the answer reports.
  2. The HTTP clients themselves (`httpx.Client.send`, `httpx.AsyncClient.send`,
     `requests.Session.send`) see every request to a model host (`MODEL_HOSTS`). For
     Anthropic they count each ATTEMPT inside a reserved call (the SDK retries), and in
     enforcement mode they REFUSE a billable request that no reservation covers (raw
     HTTP, a client built some other way). OpenAI and Perplexity have no usage hook
     here, so each billable request reserves a flat, conservative estimate
     (`_OTHER_ESTIMATES`), held as UNCONFIRMED.

TWO MODES (`mode()`), and the difference is the point:
  * ENFORCE — no paid call is sent without a reservation written to the durable store
    under the day ceiling. Everything that cannot be checked refuses: a database error
    (`store-unavailable`), a missing or unreadable ceiling (`misconfigured`), a request
    no reservation covers (`unmetered`). The default OFF Railway ($10/day); on Railway
    only when the owner sets `AI_SPEND_DAILY_CAP_USD` (or `AI_SPEND_MODE=enforce`).
  * RECORD — calls are counted after they finish and nothing is refused for money; a
    database error loses the count (one log line). Production's mode until the owner
    chooses a ceiling, because a ceiling below normal traffic switches member features off.
The kill switch, the runaway breaker, the in-flight cap and the per-process batch cap
apply in both modes.

THREE NUMBERS, never mixed up (`report`):
  * RESERVED  — held for calls still in flight (and for calls whose process died before
    it could settle: never released, so a crash can only over-count);
  * CONFIRMED — priced from the usage Anthropic reported for a finished call;
  * UNCONFIRMED — held at the reservation because no usage could confirm it: a timeout
    or a dropped connection (the provider may still have billed it), a stream that
    never finished, a batch submission (billed later, as results are produced), an
    OpenAI / Perplexity request. ⛔ Never released, by design: the guard does not know
    the call was free, so it does not pretend it was.
  The day ceiling bounds their SUM (`ai_spend_usd` / GLOBAL).

A refusal raises `AiSpendRefused` (a `RuntimeError`, so every caller that already
turns a failed model call into a fallback keeps doing so). Everything here is
APPLICATION-LEVEL: only the Anthropic Console's limits bind a key used anywhere else.
"""
from __future__ import annotations

import contextvars
import logging
import math
import os
import sys
import threading
import time
from collections import deque

log = logging.getLogger(__name__)

SCOPE_USD = "ai_spend_usd"                  # committed dollars: GLOBAL (capped) and "feature:<module>"
SCOPE_CALLS = "ai_spend_calls"              # calls: GLOBAL and "feature:<module>"
SCOPE_RESERVED = "ai_spend_reserved_usd"    # dollars held for calls not yet settled (GLOBAL)
SCOPE_UNCONFIRMED = "ai_spend_unconfirmed_usd"  # dollars charged at the estimate: GLOBAL and per feature
DEV_DAILY_CAP_USD = 10.0            # the owner's proposed dev/testing day (2026-10-11)
LIVE_TEST_BATCH_CAP_USD = 2.0       # the owner's proposed per-batch ceiling
MODE_ENFORCE, MODE_RECORD = "enforce", "record"

ANTHROPIC_HOST = "api.anthropic.com"
MODEL_HOSTS = frozenset({ANTHROPIC_HOST, "api.openai.com", "api.perplexity.ai"})
#: Anthropic POSTs that are never billed (token counting, cancelling a batch, file upload).
_FREE_ANTHROPIC_SUFFIXES = ("/count_tokens", "/cancel")
_FREE_ANTHROPIC_PREFIXES = ("/v1/files",)

#: Messages Batches are billed at half the list price (Anthropic pricing page).
BATCH_DISCOUNT = 0.5
#: Reservation pieces that the request cannot state exactly.
_IMAGE_TOKENS = 2_000               # an image block costs at most ~1,600 input tokens
_PDF_MIN_TOKENS = 3_000
_DEFAULT_WEB_SEARCHES = 10          # a web_search tool with no max_uses
_WEB_SEARCH_USD_EACH = 0.01

#: The modules a caller frame is skipped through when the call is attributed.
_SKIP_PREFIXES = ("api.services.ai_spend", "anthropic", "openai", "httpx", "httpcore", "requests",
                  "urllib3", "contextlib", "functools", "asyncio", "concurrent", "threading")


class AiSpendRefused(RuntimeError):
    """A model call refused before it was made. `code` is stable for a rail or a log."""

    def __init__(self, code: str, message: str, feature: str) -> None:
        super().__init__(message)
        self.code, self.feature = code, feature


try:  # the SDK passes its OWN error type through unwrapped and does not retry it
    from anthropic import AnthropicError as _AnthropicError
except Exception:  # noqa: BLE001
    _AnthropicError = Exception


class _TransportRefused(AiSpendRefused, _AnthropicError):
    """Raised from the HTTP layer inside the SDK's retry loop: an `AnthropicError`, so
    the SDK neither wraps it as a connection error nor retries it."""


# ── configuration (read at CALL time, so a test or an operator can change it) ──

_OFF = ("off", "none")


def _float_env(name: str) -> float | None:
    """A dollar ceiling from the environment: unset / blank / "off" / "none" / not a
    finite non-negative number → None (no ceiling); a number → that (0 refuses all)."""
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "" or raw.strip().lower() in _OFF:
        return None
    try:
        v = float(raw)
    except ValueError:
        log.warning("[ai-spend] %s=%r is not a number; ignored", name, raw)
        return None
    return v if math.isfinite(v) and v >= 0 else None


def on_production() -> bool:
    from api.services.vendor_socket_guard import on_production as _on
    return _on()


def mode() -> str:
    """ENFORCE or RECORD (module docstring). `AI_SPEND_MODE` decides when set; an
    unknown value enforces (the safe reading). Unset: off Railway → enforce, unless the
    ceiling is switched off by name; on Railway → enforce only once a ceiling is set."""
    raw = (os.environ.get("AI_SPEND_MODE") or "").strip().lower()
    if raw == MODE_RECORD:
        return MODE_RECORD
    if raw:
        if raw not in (MODE_ENFORCE, "strict"):
            log.warning("[ai-spend] AI_SPEND_MODE=%r is not enforce/record; enforcing", raw)
        return MODE_ENFORCE
    cap_raw = (os.environ.get("AI_SPEND_DAILY_CAP_USD") or "").strip().lower()
    if cap_raw in _OFF:
        return MODE_RECORD
    if on_production():
        return MODE_ENFORCE if cap_raw else MODE_RECORD
    return MODE_ENFORCE


def daily_cap_usd() -> float | None:
    """The day's ceiling, or None when there is none. Set → that; else $10 off Railway."""
    if os.environ.get("AI_SPEND_DAILY_CAP_USD") is not None:
        return _float_env("AI_SPEND_DAILY_CAP_USD")
    return None if on_production() else DEV_DAILY_CAP_USD


def batch_cap_usd() -> float | None:
    return _float_env("AI_SPEND_BATCH_CAP_USD")


def _int_env(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, default)))
    except ValueError:
        return default


def feature_max_per_minute() -> int:
    return _int_env("AI_SPEND_FEATURE_MAX_PER_MIN", 120)


def breaker_cooldown_s() -> int:
    return _int_env("AI_SPEND_BREAKER_COOLDOWN_S", 300)


def max_in_flight() -> int:
    return _int_env("AI_SPEND_MAX_IN_FLIGHT", 32)


def _realtime_allowed() -> bool:
    return os.environ.get("AI_SPEND_ALLOW_REALTIME", "") == "1"


def _et_day() -> str:
    from api.services.journal_two.calendar import et_today
    return et_today()


# ── per-process state (the breaker and the in-flight count are deliberately local:
#    they bound a runaway INSIDE a process; the durable ceiling bounds the day) ──

_lock = threading.Lock()
_in_flight = 0
_recent: dict[str, deque] = {}
_tripped_until: dict[str, float] = {}
_batch_committed = 0.0              # this process's reserved + charged dollars (the batch cap)


def reset_process_state() -> None:
    """For tests: clear the breaker, the in-flight count and the batch account."""
    global _in_flight, _batch_committed
    with _lock:
        _in_flight = 0
        _batch_committed = 0.0
        _recent.clear()
        _tripped_until.clear()


def feature_of_caller() -> str:
    """The first frame outside this guard, the SDKs and the plumbing: the feature."""
    f = sys._getframe(1)
    while f is not None:
        mod = f.f_globals.get("__name__", "") or ""
        if mod and not mod.startswith(_SKIP_PREFIXES):
            return mod
        f = f.f_back
    return "unknown"


def admit(feature: str) -> None:
    """The money-free checks, both modes: kill switch, breaker, in-flight, and the batch
    cap on what this process already committed. Takes an in-flight slot; `release`
    gives it back. Raises `AiSpendRefused`."""
    global _in_flight
    if os.environ.get("AI_SPEND_DISABLED", "") == "1":
        raise AiSpendRefused("disabled", "AI calls are switched off on this process "
                             "(AI_SPEND_DISABLED=1); nothing was sent.", feature)
    now = time.monotonic()
    with _lock:
        until = _tripped_until.get(feature)
        if until is not None and now < until:
            raise AiSpendRefused("breaker", f"`{feature}` made more than {feature_max_per_minute()} "
                                 f"AI calls in a minute, so its calls are paused for "
                                 f"{int(until - now)} more seconds; nothing was sent.", feature)
        window = _recent.setdefault(feature, deque())
        while window and now - window[0] > 60.0:
            window.popleft()
        if len(window) >= feature_max_per_minute():
            _tripped_until[feature] = now + breaker_cooldown_s()
            log.error("[ai-spend] RUNAWAY BREAKER tripped for %s: %d calls in 60 s; paused %d s",
                      feature, len(window), breaker_cooldown_s())
            raise AiSpendRefused("breaker", f"`{feature}` made more than {feature_max_per_minute()} "
                                 "AI calls in a minute, so its calls are paused; nothing was sent.",
                                 feature)
        if _in_flight >= max_in_flight():
            raise AiSpendRefused("in-flight", f"{_in_flight} AI calls are already in flight on this "
                                 f"process (limit {max_in_flight()}); nothing was sent.", feature)
        bcap = batch_cap_usd()
        if bcap is not None and _batch_committed >= bcap:
            raise AiSpendRefused("batch-cap", f"this process has committed ${_batch_committed:.4f} of "
                                 f"its ${bcap:.2f} batch budget (AI_SPEND_BATCH_CAP_USD); nothing was sent.",
                                 feature)
        window.append(now)
        _in_flight += 1


def release() -> None:
    global _in_flight
    with _lock:
        _in_flight = max(0, _in_flight - 1)


# ── pricing ─────────────────────────────────────────────────────────────────────

def _get(obj, name):
    if obj is None:
        return None
    return obj.get(name) if isinstance(obj, dict) else getattr(obj, name, None)


def _usage_fields(usage) -> tuple[int, int, int, int]:
    def g(name):
        try:
            return int(_get(usage, name) or 0)
        except (TypeError, ValueError):
            return 0
    return (g("input_tokens"), g("output_tokens"),
            g("cache_read_input_tokens"), g("cache_creation_input_tokens"))


def cost_of(model: str, usage) -> float:
    """CONFIRMED dollars for a finished call: its tokens (`cost_guard`'s table) plus
    the server web searches it ran."""
    from api.services.catalyst.cost_guard import estimate_cost
    i, o, cr, cc = _usage_fields(usage)
    try:
        searches = int(_get(_get(usage, "server_tool_use"), "web_search_requests") or 0)
    except (TypeError, ValueError):
        searches = 0
    return (estimate_cost(str(model or ""), i, o, cache_read_tokens=cr, cache_creation_tokens=cc)
            + searches * _WEB_SEARCH_USD_EACH)


def _plain(x):
    dump = getattr(x, "model_dump", None)
    if callable(dump):
        try:
            return dump()
        except Exception:  # noqa: BLE001
            return str(x)
    return x


def estimate_input_tokens(params: dict) -> int:
    """An upper-leaning count of a request's input tokens WITHOUT a network call: text at
    3 characters a token (English runs ~4), an image at its ceiling, a PDF by size."""
    chars = 0
    extra = 0

    def walk(x):
        nonlocal chars, extra
        x = _plain(x)
        if x is None or isinstance(x, bool):
            return
        if isinstance(x, str):
            chars += len(x)
        elif isinstance(x, dict):
            kind = x.get("type")
            if kind == "image":
                extra += _IMAGE_TOKENS
                return
            if kind == "document":
                src = x.get("source") if isinstance(x.get("source"), dict) else {}
                data = src.get("data")
                if src.get("type") == "base64" and isinstance(data, str):
                    extra += max(_PDF_MIN_TOKENS, len(data) // 40)
                    return
            for v in x.values():
                walk(v)
        elif isinstance(x, (list, tuple)):
            for v in x:
                walk(v)
        else:
            chars += len(str(x))

    for key in ("system", "messages", "tools", "tool_choice", "output_format", "output_config"):
        walk(params.get(key))
    return chars // 3 + extra + 64


def _web_search_reserve(params: dict) -> float:
    total = 0.0
    for tool in params.get("tools") or ():
        tool = _plain(tool)
        if isinstance(tool, dict) and str(tool.get("type", "")).startswith("web_search"):
            total += int(tool.get("max_uses") or _DEFAULT_WEB_SEARCHES) * _WEB_SEARCH_USD_EACH
    return total


def reservation_usd(params: dict) -> float:
    """The most one Messages call with these parameters can cost: every input token
    priced as a cache WRITE (1.25x, the dearest input rate), `max_tokens` of output (it
    already includes any thinking budget), and each permitted web search."""
    from api.services.catalyst.cost_guard import estimate_cost
    try:
        max_tokens = int(params.get("max_tokens") or 0)
    except (TypeError, ValueError):
        max_tokens = 0
    max_tokens = max(max_tokens, 1)
    return (estimate_cost(str(params.get("model") or ""), 0, max_tokens,
                          cache_creation_tokens=estimate_input_tokens(params))
            + _web_search_reserve(params))


#: OpenAI / Perplexity: no usage hook here, so a flat estimate per billable request,
#: deliberately above the typical call (path prefix → dollars). None = cannot be bounded
#: from the server (a realtime session bills the browser's own connection).
_OTHER_ESTIMATES = {
    "api.openai.com": (("/v1/realtime", None), ("/v1/audio/speech", 0.07),
                       ("/v1/audio/transcriptions", 0.20), ("/v1/images", 0.25), ("", 0.05)),
    "api.perplexity.ai": (("", 0.05),),
}
_PPLX_DEEP_USD = 1.50                # sonar-deep-research: searches + reasoning tokens


def other_provider_estimate(host: str, path: str, body) -> float | None:
    if host == "api.perplexity.ai" and body:
        text = body.decode("utf-8", "replace") if isinstance(body, (bytes, bytearray)) else str(body)
        if "deep-research" in text:
            return _PPLX_DEEP_USD
    for prefix, usd in _OTHER_ESTIMATES.get(host, ()):
        if path.startswith(prefix):
            return usd
    return 0.05


# ── reservations ────────────────────────────────────────────────────────────────

class _Ticket:
    """One paid call: what was reserved for it, and what its attempts did."""

    __slots__ = ("feature", "model", "day", "base", "reserved", "enforce", "attempts",
                 "ambiguous", "last_ambiguous", "settled", "slot", "calls")

    def __init__(self, feature: str, model: str, base: float, enforce: bool, calls: int = 1):
        self.feature, self.model, self.base, self.enforce = feature, str(model or ""), base, enforce
        self.day = _et_day()
        self.reserved = 0.0
        self.attempts = 0           # HTTP attempts the transport saw
        self.ambiguous = 0          # attempts that ended without an HTTP answer (maybe billed)
        self.last_ambiguous = False
        self.settled = False
        self.slot = False
        self.calls = calls


_current: contextvars.ContextVar[_Ticket | None] = contextvars.ContextVar("uct_ai_spend_ticket", default=None)


def _refuse(code: str, message: str, feature: str, *, transport: bool = False):
    cls = _TransportRefused if transport else AiSpendRefused
    return cls(code, message, feature)


def _reserve(t: _Ticket, amount: float, *, transport: bool = False) -> None:
    """ENFORCE: hold `amount` against the day ceiling (and the batch cap) in ONE durable
    transaction, or refuse. Nothing is held when it refuses."""
    global _batch_committed
    from api.services import daily_counters
    cap = daily_cap_usd()
    if cap is None:
        raise _refuse("misconfigured", "AI spending is in enforcement mode but no valid day ceiling "
                      "is set (AI_SPEND_DAILY_CAP_USD); nothing was sent.", t.feature, transport=transport)
    bcap = batch_cap_usd()
    with _lock:
        if bcap is not None and _batch_committed + amount > bcap:
            raise _refuse("batch-cap", f"this call could cost up to ${amount:.4f}, and this process has "
                          f"committed ${_batch_committed:.4f} of its ${bcap:.2f} batch budget "
                          "(AI_SPEND_BATCH_CAP_USD); nothing was sent.", t.feature, transport=transport)
        _batch_committed += amount
    refused = daily_counters.take(t.day, [
        daily_counters.Charge(SCOPE_USD, daily_counters.GLOBAL, amount, cap),
        daily_counters.Charge(SCOPE_RESERVED, daily_counters.GLOBAL, amount),
    ], strict=True)
    if refused is None:
        t.reserved += amount
        return
    with _lock:
        _batch_committed = max(0.0, _batch_committed - amount)
    if refused == daily_counters.STORE_UNAVAILABLE:
        log.error("[ai-spend] budget store unavailable; refusing %s (fail closed)", t.feature)
        raise _refuse("store-unavailable", "today's AI budget could not be checked (the budget store "
                      "is unavailable), so the call was refused; nothing was sent.", t.feature,
                      transport=transport)
    log.error("[ai-spend] DAILY CEILING: a call of up to $%.4f does not fit under $%.2f; refusing %s",
              amount, cap, t.feature)
    raise _refuse("daily-cap", f"today's AI budget (${cap:.2f}, AI_SPEND_DAILY_CAP_USD) has no room for "
                  f"a call that could cost up to ${amount:.4f}; nothing was sent.", t.feature,
                  transport=transport)


def _open(feature: str, model: str, base: float, calls: int = 1) -> _Ticket:
    """Admit a call (both modes) and, enforcing, reserve its worst case. The in-flight
    slot is released by `_settle` — or here, if the reservation refuses."""
    enforce = mode() == MODE_ENFORCE
    t = _Ticket(feature, model, base, enforce, calls)
    admit(feature)
    t.slot = True
    if enforce:
        try:
            _reserve(t, base)
        except BaseException:
            release()
            t.slot = False
            raise
    return t


def _settle(t: _Ticket, confirmed: float, unconfirmed: float = 0.0) -> float:
    """Turn the ticket's reservation into its charge = CONFIRMED (priced from reported
    usage) + UNCONFIRMED (held at the estimate). ⛔ Only ever LOWERS a reservation to a
    charge the call is known to have cost; a store failure leaves the reservation in
    place (an over-count, never an under-count of what was held)."""
    global _batch_committed
    if t.settled:
        return 0.0
    t.settled = True
    if t.slot:
        release()
    from api.services import daily_counters
    G, sub = daily_counters.GLOBAL, f"feature:{t.feature}"
    unconfirmed = max(0.0, float(unconfirmed))
    charge = max(0.0, float(confirmed)) + unconfirmed
    with _lock:
        _batch_committed = max(0.0, _batch_committed + (charge - t.reserved))
    adds = [daily_counters.Charge(SCOPE_USD, sub, charge),
            daily_counters.Charge(SCOPE_CALLS, G, t.calls),
            daily_counters.Charge(SCOPE_CALLS, sub, t.calls)]
    if unconfirmed > 0:
        adds += [daily_counters.Charge(SCOPE_UNCONFIRMED, G, unconfirmed),
                 daily_counters.Charge(SCOPE_UNCONFIRMED, sub, unconfirmed)]
    if charge > t.reserved:                         # it happened: counted, never refused
        adds.append(daily_counters.Charge(SCOPE_USD, G, charge - t.reserved))
    try:
        if daily_counters.take(t.day, adds, strict=True) is not None:
            log.error("[ai-spend] could not record a $%.4f call for %s; its $%.4f reservation stays held",
                      charge, t.feature, t.reserved)
            return charge
        if t.reserved > 0:
            back = [daily_counters.Charge(SCOPE_RESERVED, G, t.reserved)]
            if charge < t.reserved:
                back.append(daily_counters.Charge(SCOPE_USD, G, t.reserved - charge))
            if not daily_counters.give_back(t.day, back):
                log.error("[ai-spend] could not release $%.4f reserved for %s; it stays held",
                          t.reserved, t.feature)
    except Exception as e:  # noqa: BLE001 -- the call already happened; its answer is the caller's
        log.warning("[ai-spend] settling a call for %s failed (%s)", t.feature, type(e).__name__)
    return charge


def _held(t: _Ticket) -> float:
    """What the attempts that ended without an HTTP answer may have cost."""
    return t.ambiguous * t.base


def _settle_success(t: _Ticket, usage, complete: bool = True) -> float:
    """A call that answered. Its usage CONFIRMS it — unless there is none, or the stream
    never finished: then it is held at the reservation (or what was seen, if more)."""
    if usage is not None and complete:
        return _settle(t, cost_of(t.model, usage), _held(t))
    seen = cost_of(t.model, usage) if usage is not None else 0.0
    return _settle(t, 0.0, _held(t) + max(seen, t.base))


def _settle_failure(t: _Ticket, err: BaseException) -> float:
    """A call that raised. An HTTP error answer (`APIStatusError`) is not billed; a
    refusal before sending costs nothing more than the attempts already made; anything
    else (timeout, dropped connection, a 200 that failed to parse) may have been."""
    if isinstance(err, AiSpendRefused):
        return _settle(t, 0.0, _held(t))
    try:
        from anthropic import APIStatusError
    except Exception:  # noqa: BLE001
        APIStatusError = None  # type: ignore[assignment]
    if APIStatusError is not None and isinstance(err, APIStatusError):
        return _settle(t, 0.0, _held(t))
    return _settle(t, 0.0, max(_held(t), t.base))


def record(feature: str, model: str, usage) -> float:
    """Count one finished call outside the SDK hook (record-mode semantics); returns its
    cost. Never raises into the caller."""
    try:
        t = _Ticket(feature, model, 0.0, False)
        return _settle(t, cost_of(model, usage))
    except Exception as e:  # noqa: BLE001
        log.warning("[ai-spend] could not count a call for %s (%s)", feature, type(e).__name__)
        return 0.0


def report(day: str | None = None) -> dict:
    """The day's spend, split RESERVED / CONFIRMED / UNCONFIRMED, and per feature."""
    from api.services import daily_counters
    day = day or _et_day()
    G = daily_counters.GLOBAL
    usd = dict(daily_counters.rows(day, SCOPE_USD))
    calls = dict(daily_counters.rows(day, SCOPE_CALLS))
    unconf = dict(daily_counters.rows(day, SCOPE_UNCONFIRMED))
    reserved = daily_counters.read(day, SCOPE_RESERVED, G)
    features = sorted(
        ({"feature": k[len("feature:"):], "usd": round(v, 6), "calls": int(calls.get(k, 0)),
          "unconfirmed_usd": round(unconf.get(k, 0.0), 6)}
         for k, v in usd.items() if k.startswith("feature:")),
        key=lambda r: -r["usd"])
    committed = usd.get(G, 0.0)
    held = reserved or 0.0
    unconfirmed = unconf.get(G, 0.0)
    cap = daily_cap_usd()
    m = mode()
    return {"day": day, "mode": m, "enforcing": m == MODE_ENFORCE, "daily_cap_usd": cap,
            "committed_usd": round(committed, 6), "total_usd": round(committed, 6),
            "reserved_usd": round(held, 6), "unconfirmed_usd": round(unconfirmed, 6),
            "confirmed_usd": round(max(0.0, committed - held - unconfirmed), 6),
            "remaining_usd": None if cap is None else round(max(0.0, cap - committed), 6),
            "calls": int(calls.get(G, 0)), "store_ok": reserved is not None, "features": features}


# ── the SDK hook ────────────────────────────────────────────────────────────────

class _CountedStream:
    """Wraps `create(stream=True)`'s event stream: usage arrives on its events, and only
    `message_stop` makes it CONFIRMED."""

    def __init__(self, inner, ticket):
        self._inner, self._t = inner, ticket
        self._usage = {"input_tokens": 0, "output_tokens": 0,
                       "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}
        self._seen = False
        self._complete = False

    def _see(self, event):
        t = getattr(event, "type", None)
        if t == "message_start":
            u = getattr(getattr(event, "message", None), "usage", None)
            i, o, cr, cc = _usage_fields(u)
            self._usage.update(input_tokens=i, output_tokens=o,
                               cache_read_input_tokens=cr, cache_creation_input_tokens=cc)
            self._seen = True
        elif t == "message_delta":
            u = getattr(event, "usage", None)
            _, o, _, _ = _usage_fields(u)
            if o:
                self._usage["output_tokens"] = o
            st = _get(u, "server_tool_use")
            if st is not None:
                self._usage["server_tool_use"] = st
        elif t == "message_stop":
            self._complete = True

    def _finish(self):
        if not self._t.settled:
            _settle_success(self._t, self._usage if self._seen else None, self._complete)

    def __iter__(self):
        try:
            for event in self._inner:
                self._see(event)
                yield event
        finally:
            self._finish()

    async def __aiter__(self):
        try:
            async for event in self._inner:
                self._see(event)
                yield event
        finally:
            self._finish()

    def __getattr__(self, name):
        return getattr(self._inner, name)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self._finish()
        close = getattr(self._inner, "close", None)
        if callable(close):
            close()
        return False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        self._finish()
        close = getattr(self._inner, "close", None)
        if callable(close):
            res = close()
            if hasattr(res, "__await__"):
                await res
        return False


class _CountedStreamManager:
    """Wraps `messages.stream(...)`'s context manager (sync and async). The request is
    sent on ENTER, so the ticket is current there."""

    def __init__(self, inner, ticket):
        self._inner, self._t = inner, ticket
        self._stream = None

    def _finish(self, err=None):
        if self._t.settled:
            return
        if self._stream is None:
            _settle_failure(self._t, err or RuntimeError("stream never opened"))
            return
        usage, complete = None, False
        try:
            snap = getattr(self._stream, "current_message_snapshot", None)
            usage = getattr(snap, "usage", None)
            complete = getattr(snap, "stop_reason", None) is not None
        except Exception:  # noqa: BLE001 -- an unfinished stream has no snapshot
            usage = None
        _settle_success(self._t, usage, complete)

    def __enter__(self):
        tok = _current.set(self._t)
        try:
            self._stream = self._inner.__enter__()
        except BaseException as e:
            self._finish(e)
            raise
        finally:
            _current.reset(tok)
        return self._stream

    def __exit__(self, *exc):
        try:
            return self._inner.__exit__(*exc)
        finally:
            self._finish()

    async def __aenter__(self):
        tok = _current.set(self._t)
        try:
            self._stream = await self._inner.__aenter__()
        except BaseException as e:
            self._finish(e)
            raise
        finally:
            _current.reset(tok)
        return self._stream

    async def __aexit__(self, *exc):
        try:
            return await self._inner.__aexit__(*exc)
        finally:
            self._finish()

    def __getattr__(self, name):
        return getattr(self._inner, name)


def _params(args, kwargs) -> dict:
    return kwargs if kwargs else (args[0] if args and isinstance(args[0], dict) else {})


def _wrap_create(orig):
    def create(self, *args, **kwargs):
        if _current.get() is not None:              # a wrapped method calling another: one ticket
            return orig(self, *args, **kwargs)
        params = _params(args, kwargs)
        t = _open(feature_of_caller(), params.get("model"), reservation_usd(params))
        tok = _current.set(t)
        try:
            out = orig(self, *args, **kwargs)
        except BaseException as e:
            _settle_failure(t, e)
            raise
        finally:
            _current.reset(tok)
        if params.get("stream"):
            return _CountedStream(out, t)
        _settle_success(t, getattr(out, "usage", None))
        return out
    create._uct_ai_spend = True
    return create


def _wrap_acreate(orig):
    async def create(self, *args, **kwargs):
        if _current.get() is not None:
            return await orig(self, *args, **kwargs)
        params = _params(args, kwargs)
        t = _open(feature_of_caller(), params.get("model"), reservation_usd(params))
        tok = _current.set(t)
        try:
            out = await orig(self, *args, **kwargs)
        except BaseException as e:
            _settle_failure(t, e)
            raise
        finally:
            _current.reset(tok)
        if params.get("stream"):
            return _CountedStream(out, t)
        _settle_success(t, getattr(out, "usage", None))
        return out
    create._uct_ai_spend = True
    return create


def _wrap_stream(orig):
    def stream(self, *args, **kwargs):
        if _current.get() is not None:
            return orig(self, *args, **kwargs)
        params = _params(args, kwargs)
        t = _open(feature_of_caller(), params.get("model"), reservation_usd(params))
        tok = _current.set(t)
        try:
            inner = orig(self, *args, **kwargs)
        except BaseException as e:
            _settle_failure(t, e)
            raise
        finally:
            _current.reset(tok)
        return _CountedStreamManager(inner, t)
    stream._uct_ai_spend = True
    return stream


def batch_reservation_usd(requests) -> tuple[float, int]:
    total, n = 0.0, 0
    for r in requests or ():
        r = _plain(r)
        params = _plain(r.get("params") if isinstance(r, dict) else None) or {}
        if isinstance(params, dict):
            total += reservation_usd(params) * BATCH_DISCOUNT
        n += 1
    return total, n


def _wrap_batch_create(orig, is_async):
    """A Message Batch is billed as its results are produced — after this call returns —
    so its worst case is held as UNCONFIRMED at submission, and never released."""
    def _ticket(kwargs):
        amount, n = batch_reservation_usd(kwargs.get("requests"))
        return _open(feature_of_caller(), "batch", amount, calls=max(n, 1)), amount

    if is_async:
        async def create(self, *args, **kwargs):
            if _current.get() is not None:
                return await orig(self, *args, **kwargs)
            t, amount = _ticket(kwargs)
            tok = _current.set(t)
            try:
                out = await orig(self, *args, **kwargs)
            except BaseException as e:
                _settle_failure(t, e)
                raise
            finally:
                _current.reset(tok)
            _settle(t, 0.0, amount)
            return out
    else:
        def create(self, *args, **kwargs):
            if _current.get() is not None:
                return orig(self, *args, **kwargs)
            t, amount = _ticket(kwargs)
            tok = _current.set(t)
            try:
                out = orig(self, *args, **kwargs)
            except BaseException as e:
                _settle_failure(t, e)
                raise
            finally:
                _current.reset(tok)
            _settle(t, 0.0, amount)
            return out
    create._uct_ai_spend = True
    return create


# ── the HTTP hook ───────────────────────────────────────────────────────────────

def _billable(host: str, method: str, path: str) -> bool:
    if host not in MODEL_HOSTS or str(method).upper() != "POST":
        return False
    if host == ANTHROPIC_HOST:
        return not (path.endswith(_FREE_ANTHROPIC_SUFFIXES) or path.startswith(_FREE_ANTHROPIC_PREFIXES))
    return True


def _anthropic_attempt_begin(host: str, path: str) -> _Ticket | None:
    """Before an Anthropic request is sent. → the ticket whose attempt this is (None:
    uncovered, record mode). Raises `_TransportRefused`."""
    t = _current.get()
    if t is None:
        if mode() == MODE_ENFORCE:
            feature = feature_of_caller()
            log.error("[ai-spend] refusing an unmetered Anthropic request to %s from %s", path, feature)
            raise _TransportRefused("unmetered", f"a request to {host}{path} was not made through the "
                                    "guarded SDK methods, so no budget covers it; nothing was sent.", feature)
        return None
    if t.attempts > 0 and t.last_ambiguous and t.enforce:
        _reserve(t, t.base, transport=True)         # a retry after a maybe-billed attempt: new room
    t.attempts += 1
    return t


def _attempt_end(t: _Ticket | None, ok: bool) -> None:
    if t is None:
        return
    t.last_ambiguous = not ok
    if not ok:
        t.ambiguous += 1


def _other_begin(host: str, path: str, body) -> _Ticket:
    est = other_provider_estimate(host, path, body)
    feature = feature_of_caller()
    if est is None:
        if mode() == MODE_ENFORCE and not _realtime_allowed():
            raise AiSpendRefused("unmetered", f"{host}{path} starts a session billed outside this "
                                 "server, which no budget can bound; refused in enforcement mode "
                                 "(AI_SPEND_ALLOW_REALTIME=1 allows it); nothing was sent.", feature)
        est = 0.50
    return _open(feature, host, est)


def _other_end(t: _Ticket, status: int | None, err: BaseException | None) -> None:
    if err is None and status is not None and status >= 400:
        _settle(t, 0.0)                             # an error answer is not billed
    else:
        _settle(t, 0.0, t.base)                     # answered (or maybe billed): held at the estimate


def _gate_send(host, method, path, body, send):
    """Run `send()` behind the gate (sync)."""
    if not _billable(host, method, path):
        return send()
    if host == ANTHROPIC_HOST:
        t = _anthropic_attempt_begin(host, path)
        try:
            resp = send()
        except BaseException:
            _attempt_end(t, False)
            raise
        _attempt_end(t, True)
        return resp
    t = _other_begin(host, path, body)
    try:
        resp = send()
    except BaseException as e:
        _other_end(t, None, e)
        raise
    _other_end(t, getattr(resp, "status_code", None), None)
    return resp


async def _gate_asend(host, method, path, body, send):
    if not _billable(host, method, path):
        return await send()
    if host == ANTHROPIC_HOST:
        t = _anthropic_attempt_begin(host, path)
        try:
            resp = await send()
        except BaseException:
            _attempt_end(t, False)
            raise
        _attempt_end(t, True)
        return resp
    t = _other_begin(host, path, body)
    try:
        resp = await send()
    except BaseException as e:
        _other_end(t, None, e)
        raise
    _other_end(t, getattr(resp, "status_code", None), None)
    return resp


def _httpx_body(request):
    try:
        return request.content
    except Exception:  # noqa: BLE001 -- a streaming body has no content yet
        return None


def _wrap_httpx_send(orig):
    def send(self, request, *args, **kwargs):
        url = request.url
        host = url.host
        return _gate_send(host, request.method, url.path, _httpx_body(request) if host in MODEL_HOSTS else None,
                          lambda: orig(self, request, *args, **kwargs))
    send._uct_ai_spend = True
    return send


def _wrap_httpx_asend(orig):
    async def send(self, request, *args, **kwargs):
        url = request.url
        host = url.host
        return await _gate_asend(host, request.method, url.path,
                                 _httpx_body(request) if host in MODEL_HOSTS else None,
                                 lambda: orig(self, request, *args, **kwargs))
    send._uct_ai_spend = True
    return send


def _wrap_requests_send(orig):
    from urllib.parse import urlsplit

    def send(self, request, *args, **kwargs):
        parts = urlsplit(request.url or "")
        host = (parts.hostname or "").lower()
        return _gate_send(host, request.method or "", parts.path or "/",
                          request.body if host in MODEL_HOSTS else None,
                          lambda: orig(self, request, *args, **kwargs))
    send._uct_ai_spend = True
    return send


_installed = False


def _patch(cls, name, wrap) -> None:
    current = cls.__dict__.get(name)
    if current is not None and not getattr(current, "_uct_ai_spend", False):
        setattr(cls, name, wrap(current))


def install() -> bool:
    """Put the guard on the SDK's methods and on the HTTP clients, once per process.
    True when the Anthropic half is on."""
    global _installed
    if _installed:
        return True
    try:
        from anthropic.resources.messages import AsyncMessages, Messages
        from anthropic.resources.messages.batches import AsyncBatches, Batches
    except Exception as e:  # noqa: BLE001 -- no SDK, no calls to guard
        log.warning("[ai-spend] anthropic SDK not importable (%s); guard not installed", type(e).__name__)
        return False
    with _lock:
        if _installed:
            return True
        targets = [(Messages, AsyncMessages, Batches, AsyncBatches)]
        try:
            from anthropic.resources.beta.messages import AsyncMessages as BAM, Messages as BM
            from anthropic.resources.beta.messages.batches import AsyncBatches as BAB, Batches as BB
            targets.append((BM, BAM, BB, BAB))
        except Exception:  # noqa: BLE001 -- an SDK without the beta surface
            pass
        for msgs, amsgs, batches, abatches in targets:
            for name in ("create", "parse"):
                _patch(msgs, name, _wrap_create)
                _patch(amsgs, name, _wrap_acreate)
            _patch(msgs, "stream", _wrap_stream)
            _patch(amsgs, "stream", _wrap_stream)
            _patch(batches, "create", lambda o: _wrap_batch_create(o, False))
            _patch(abatches, "create", lambda o: _wrap_batch_create(o, True))
        import httpx
        _patch(httpx.Client, "send", _wrap_httpx_send)
        _patch(httpx.AsyncClient, "send", _wrap_httpx_asend)
        try:
            import requests
            _patch(requests.Session, "send", _wrap_requests_send)
        except Exception:  # noqa: BLE001
            pass
        _installed = True
    log.info("[ai-spend] guard installed (mode %s, daily cap %s, batch cap %s)",
             mode(), daily_cap_usd(), batch_cap_usd())
    return True
