"""AI SPEND GUARD — one app-wide ceiling, and every Anthropic call counted, by feature.

⭐ WHY THIS EXISTS (owner, 2026-10-11). About $50 of Anthropic credit went in two days
and nothing could say WHERE. The repo already had good per-lane guards (the catalyst
`cost_guard` $15/day, `narrative_cost_guard`, call-recap, theme, pattern-vision,
concierge per-member caps) — but 30 of the 44 member AI doors in `ai_doors.py` have no
meter, several have no dollar bound at all, and no single number bounded the DAY. This
module is that number. It is NOT a second ledger beside the others: it adds no pricing
(`catalyst.cost_guard.estimate_cost` is the one table), no store (`daily_counters`, the
durable per-ET-day counters in auth.db, is the one store), and no "am I in production?"
signal (`vendor_socket_guard.on_production` is the one authority).

⭐⭐ THE ONE PLACE EVERY CALL PASSES. 39 modules share `engine._get_anthropic_client`,
18 construct their own client, and the next one will do something else again. So the
guard sits on the SDK's own message methods (`Messages.create` / `.stream`, sync and
async), installed once per process (`install`): every call through ANY client is
admitted first and counted after, whoever constructed it. ⛔ The Message Batches API
(`llm_batch`, wisdom extraction) is billed when results are fetched, not here; those
lanes keep their own dollar budgets (`CALL_RECAP_DAILY_CAP_USD`, the wisdom budget).

WHAT IT ENFORCES (all APPLICATION-LEVEL — none of this is a billing-provider cap):
  * a DAILY ceiling across every feature (`AI_SPEND_DAILY_CAP_USD`), durable across
    deploys. Off Railway it defaults to $10/day (the owner's development/testing
    ceiling); ON Railway it is unset — record-only — until the owner sets it, because
    changing production's effective budget is the owner's call, not this module's;
  * a PER-PROCESS batch ceiling (`AI_SPEND_BATCH_CAP_USD`), for an authorized
    live-AI test batch or a CLI run ($2 by the owner's proposal; set by `conftest.py`
    when `ALLOW_LIVE_AI=1`);
  * a RUNAWAY breaker per feature: more than `AI_SPEND_FEATURE_MAX_PER_MIN` calls in
    60 s trips that feature for `AI_SPEND_BREAKER_COOLDOWN_S`, every other feature
    unaffected;
  * an IN-FLIGHT cap per process (`AI_SPEND_MAX_IN_FLIGHT`): refused, never queued,
    so a burst cannot pin worker threads;
  * a kill switch (`AI_SPEND_DISABLED=1`): every call refused by name.

A refusal raises `AiSpendRefused` (a `RuntimeError`, so every caller that already
turns a failed model call into a fallback keeps doing so). Recording follows
`daily_counters`' contract: a database error FAILS OPEN with one log line — the
in-flight cap, the breaker and the SDK timeout still bound a call.
"""
from __future__ import annotations

import logging
import os
import sys
import threading
import time
from collections import deque

log = logging.getLogger(__name__)

SCOPE_USD = "ai_spend_usd"          # dollars, subject GLOBAL or "feature:<module>"
SCOPE_CALLS = "ai_spend_calls"      # calls, subject GLOBAL or "feature:<module>"
DEV_DAILY_CAP_USD = 10.0            # the owner's proposed dev/testing day (2026-10-11)
LIVE_TEST_BATCH_CAP_USD = 2.0       # the owner's proposed per-batch ceiling

#: The modules a caller frame is skipped through when the call is attributed.
_SKIP_PREFIXES = ("api.services.ai_spend", "anthropic", "httpx", "contextlib", "functools",
                  "asyncio", "concurrent", "threading")


class AiSpendRefused(RuntimeError):
    """A model call refused before it was made. `code` is stable for a rail or a log."""

    def __init__(self, code: str, message: str, feature: str) -> None:
        super().__init__(message)
        self.code, self.feature = code, feature


# ── configuration (read at CALL time, so a test or an operator can change it) ──

def _float_env(name: str) -> float | None:
    """A dollar ceiling from the environment: unset / blank / "off" / "none" → None (no
    ceiling); a number → that number (0 refuses every call)."""
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "" or raw.strip().lower() in ("off", "none"):
        return None
    try:
        return float(raw)
    except ValueError:
        log.warning("[ai-spend] %s=%r is not a number; ignored", name, raw)
        return None


def on_production() -> bool:
    from api.services.vendor_socket_guard import on_production as _on
    return _on()


def daily_cap_usd() -> float | None:
    """The day's ceiling, or None when only recording. Set → that; else $10 off Railway."""
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


def _et_day() -> str:
    from api.services.journal_two.calendar import et_today
    return et_today()


# ── per-process state (the breaker and the in-flight count are deliberately local:
#    they bound a runaway INSIDE a process; the durable ceiling bounds the day) ──

_lock = threading.Lock()
_in_flight = 0
_recent: dict[str, deque] = {}
_tripped_until: dict[str, float] = {}
_batch_spent = 0.0


def reset_process_state() -> None:
    """For tests: clear the breaker, the in-flight count and the batch account."""
    global _in_flight, _batch_spent
    with _lock:
        _in_flight = 0
        _batch_spent = 0.0
        _recent.clear()
        _tripped_until.clear()


def feature_of_caller() -> str:
    """The first frame outside this guard, the SDK and the plumbing: the feature."""
    f = sys._getframe(1)
    while f is not None:
        mod = f.f_globals.get("__name__", "") or ""
        if mod and not mod.startswith(_SKIP_PREFIXES):
            return mod
        f = f.f_back
    return "unknown"


def admit(feature: str) -> None:
    """Refuse (raise `AiSpendRefused`) a call that must not be made; else reserve a slot."""
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
        if bcap is not None and _batch_spent >= bcap:
            raise AiSpendRefused("batch-cap", f"this process has spent ${_batch_spent:.4f} of its "
                                 f"${bcap:.2f} batch budget (AI_SPEND_BATCH_CAP_USD); nothing was sent.",
                                 feature)
        window.append(now)
        _in_flight += 1
    cap = daily_cap_usd()
    if cap is not None:
        from api.services import daily_counters
        spent = daily_counters.value(_et_day(), SCOPE_USD, daily_counters.GLOBAL)
        if spent >= cap:
            release()
            log.error("[ai-spend] DAILY CEILING reached: $%.4f >= $%.2f; refusing %s", spent, cap, feature)
            raise AiSpendRefused("daily-cap", f"today's AI budget is spent (${spent:.2f} of "
                                 f"${cap:.2f}, AI_SPEND_DAILY_CAP_USD); nothing was sent.", feature)


def release() -> None:
    global _in_flight
    with _lock:
        _in_flight = max(0, _in_flight - 1)


def _usage_fields(usage) -> tuple[int, int, int, int]:
    def g(name):
        v = getattr(usage, name, None) if usage is not None and not isinstance(usage, dict) else (usage or {}).get(name)
        try:
            return int(v or 0)
        except (TypeError, ValueError):
            return 0
    return (g("input_tokens"), g("output_tokens"),
            g("cache_read_input_tokens"), g("cache_creation_input_tokens"))


def cost_of(model: str, usage) -> float:
    from api.services.catalyst.cost_guard import estimate_cost
    i, o, cr, cc = _usage_fields(usage)
    return estimate_cost(str(model or ""), i, o, cache_read_tokens=cr, cache_creation_tokens=cc)


def record(feature: str, model: str, usage) -> float:
    """Count one finished call (dollars and the call) for the day; returns its cost.
    ⛔ Never raises into the caller: the call already happened and its answer is the
    caller's; a counting failure is one log line (and `daily_counters` fails open)."""
    global _batch_spent
    try:
        cost = cost_of(model, usage)
        with _lock:
            _batch_spent += cost
        from api.services import daily_counters
        sub = f"feature:{feature}"
        daily_counters.take(_et_day(), [
            daily_counters.Charge(SCOPE_USD, daily_counters.GLOBAL, cost),
            daily_counters.Charge(SCOPE_USD, sub, cost),
            daily_counters.Charge(SCOPE_CALLS, daily_counters.GLOBAL, 1),
            daily_counters.Charge(SCOPE_CALLS, sub, 1),
        ])
        return cost
    except Exception as e:  # noqa: BLE001
        log.warning("[ai-spend] could not count a call for %s (%s)", feature, type(e).__name__)
        return 0.0


def report(day: str | None = None) -> dict:
    """The day's spend: total, ceiling, and per feature (dollars and calls), largest first."""
    from api.services import daily_counters
    day = day or _et_day()
    usd = dict(daily_counters.rows(day, SCOPE_USD))
    calls = dict(daily_counters.rows(day, SCOPE_CALLS))
    features = sorted(
        ({"feature": k[len("feature:"):], "usd": round(v, 4), "calls": int(calls.get(k, 0))}
         for k, v in usd.items() if k.startswith("feature:")),
        key=lambda r: -r["usd"])
    cap = daily_cap_usd()
    total = usd.get(daily_counters.GLOBAL, 0.0)
    return {"day": day, "total_usd": round(total, 4), "calls": int(calls.get(daily_counters.GLOBAL, 0)),
            "daily_cap_usd": cap, "remaining_usd": None if cap is None else round(max(0.0, cap - total), 4),
            "enforcing": cap is not None, "features": features}


# ── the SDK hook ────────────────────────────────────────────────────────────────

class _CountedStream:
    """Wraps `create(stream=True)`'s event stream: usage arrives on its events."""

    def __init__(self, inner, feature, model):
        self._inner, self._feature, self._model = inner, feature, model
        self._usage = {"input_tokens": 0, "output_tokens": 0,
                       "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}
        self._done = False

    def _see(self, event):
        t = getattr(event, "type", None)
        if t == "message_start":
            u = getattr(getattr(event, "message", None), "usage", None)
            i, o, cr, cc = _usage_fields(u)
            self._usage.update(input_tokens=i, output_tokens=o,
                               cache_read_input_tokens=cr, cache_creation_input_tokens=cc)
        elif t == "message_delta":
            _, o, _, _ = _usage_fields(getattr(event, "usage", None))
            if o:
                self._usage["output_tokens"] = o

    def _finish(self):
        if not self._done:
            self._done = True
            release()
            record(self._feature, self._model, self._usage)

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


class _CountedStreamManager:
    """Wraps `messages.stream(...)`'s context manager (sync and async)."""

    def __init__(self, inner, feature, model):
        self._inner, self._feature, self._model = inner, feature, model
        self._stream = None
        self._done = False

    def _finish(self):
        if self._done:
            return
        self._done = True
        release()
        usage = None
        try:
            snap = getattr(self._stream, "current_message_snapshot", None)
            usage = getattr(snap, "usage", None)
        except Exception:  # noqa: BLE001 -- an unfinished stream has no snapshot
            usage = None
        record(self._feature, self._model, usage)

    def __enter__(self):
        self._stream = self._inner.__enter__()
        return self._stream

    def __exit__(self, *exc):
        try:
            return self._inner.__exit__(*exc)
        finally:
            self._finish()

    async def __aenter__(self):
        self._stream = await self._inner.__aenter__()
        return self._stream

    async def __aexit__(self, *exc):
        try:
            return await self._inner.__aexit__(*exc)
        finally:
            self._finish()

    def __getattr__(self, name):
        return getattr(self._inner, name)


def _wrap_create(orig):
    def create(self, *args, **kwargs):
        feature = feature_of_caller()
        admit(feature)
        model = kwargs.get("model")
        try:
            out = orig(self, *args, **kwargs)
        except BaseException:
            release()
            raise
        if kwargs.get("stream"):
            return _CountedStream(out, feature, model)
        release()
        record(feature, model, getattr(out, "usage", None))
        return out
    create._uct_ai_spend = True
    return create


def _wrap_acreate(orig):
    async def create(self, *args, **kwargs):
        feature = feature_of_caller()
        admit(feature)
        model = kwargs.get("model")
        try:
            out = await orig(self, *args, **kwargs)
        except BaseException:
            release()
            raise
        if kwargs.get("stream"):
            return _CountedStream(out, feature, model)
        release()
        record(feature, model, getattr(out, "usage", None))
        return out
    create._uct_ai_spend = True
    return create


def _wrap_stream(orig):
    def stream(self, *args, **kwargs):
        feature = feature_of_caller()
        admit(feature)
        try:
            inner = orig(self, *args, **kwargs)
        except BaseException:
            release()
            raise
        return _CountedStreamManager(inner, feature, kwargs.get("model"))
    stream._uct_ai_spend = True
    return stream


_installed = False


def install() -> bool:
    """Put the guard on the SDK's message methods, once per process. True when it is on."""
    global _installed
    if _installed:
        return True
    try:
        from anthropic.resources.messages import AsyncMessages, Messages
    except Exception as e:  # noqa: BLE001 -- no SDK, no calls to guard
        log.warning("[ai-spend] anthropic SDK not importable (%s); guard not installed", type(e).__name__)
        return False
    with _lock:
        if _installed:
            return True
        for cls, name, wrap in ((Messages, "create", _wrap_create), (Messages, "stream", _wrap_stream),
                                (AsyncMessages, "create", _wrap_acreate), (AsyncMessages, "stream", _wrap_stream)):
            current = getattr(cls, name, None)
            if current is not None and not getattr(current, "_uct_ai_spend", False):
                setattr(cls, name, wrap(current))
        _installed = True
    log.info("[ai-spend] guard installed (daily cap %s, batch cap %s)",
             daily_cap_usd(), batch_cap_usd())
    return True
