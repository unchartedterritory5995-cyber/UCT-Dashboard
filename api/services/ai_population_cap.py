"""A population-wide daily cap over member AI requests (TERM-078, FB-I1-04).

WHY. Every member AI door carries a PER-MEMBER allowance, and some a shared
dollar cap of their own, but nothing bounds the membership as a whole: R-18
records Compass chat with "no population-level cap", and item 22 §0(3) records
that at 1,000 members the per-member caps alone would let spend exceed the
product's own base case. This is the one counter every wired door passes
through, AFTER its own per-member reservation succeeded -- so a member who is
already over their own allowance can never burn the population's.

THE FLAG. `AI_POPULATION_CAP_MODE`, a MODE (declared in the table below so
`feature_flag_index.mode_flags()` derives it), read PER CALL:
  * off (default, unset)  -- exactly today's behaviour: no read, no write.
  * shadow                -- every admitted request is COUNTED; a request the
    cap would have refused is logged ONCE per (door, ET day) as
    `[ai-population-cap] would-cap ...` and ADMITTED. Shadow never blocks.
  * enforce               -- a request past the cap is REFUSED with
    `REFUSAL_SENTENCE`, which names the cap; the door gives back its own
    per-member reservation first, so the refusal costs the member nothing.
  An unrecognised value is treated as `shadow` (never blocks, never silent).

THE CAP. `AI_POPULATION_DAILY_CAP` member AI requests per ET day across every
wired door (default 5000). One request = one unit, whatever the door bills
the member. Counted in `daily_counters` (auth.db, scope `SCOPE`, subject
`daily_counters.GLOBAL`), so a deploy does not reset it.

⛔ FAILS OPEN. `daily_counters.take` admits on a database error (its own rule,
ruling D-H5b): a cost cap that fails closed is an outage for every member. The
meter says so instead (`ai_meters`, `readable: false`).

⛔ SQLite, so a caller on the event loop must reach `admit` through a thread
(`run_in_threadpool`), exactly as `note_ask`'s reservations do (ruling D-H11).
In `off` mode `admit` returns before touching the database.
"""
from __future__ import annotations

import logging
import os
import threading
from datetime import datetime, timedelta, timezone

from api.services import daily_counters

log = logging.getLogger(__name__)

FLAG = "AI_POPULATION_CAP_MODE"
CAP_ENV = "AI_POPULATION_DAILY_CAP"
MODE_OFF = "off"
MODE_SHADOW = "shadow"
MODE_ENFORCE = "enforce"

AI_POPULATION_MODE_FLAGS = {
    "AI_POPULATION_CAP_MODE": (MODE_OFF, (MODE_OFF, MODE_SHADOW, MODE_ENFORCE)),
}

DEFAULT_DAILY_CAP = 5000

# ⛔ The durable counter's scope. Renaming it orphans the day's row -- a free
# day's population allowance at the deploy.
SCOPE = "ai_population_requests"

# The refusal a member reads. It NAMES the cap (PROD-2: asserted as text), says
# it is not their own allowance, and when it resets. A door must show THIS, not
# its own per-member sentence (PROD-5: a refusal overwritten by another).
REFUSAL_CODE = "POPULATION_DAILY_LIMIT_REACHED"
REFUSAL_SENTENCE = (
    "UCT's AI features have reached today's shared limit for the whole "
    "membership. This is not your own allowance, and nothing was charged to it. "
    "It resets at midnight ET."
)

_warned_modes: set = set()
_would_cap_logged: set = set()
_log_lock = threading.Lock()


def mode() -> str:
    """Read PER CALL. Unset/blank/'off'/'0'/'false' -> off; 'shadow';
    'enforce'; anything else -> shadow (warned once)."""
    default, allowed = AI_POPULATION_MODE_FLAGS[FLAG]
    raw = (os.environ.get(FLAG) or "").strip().lower()
    if raw in ("", "0", "false", "no", "none"):
        return default
    if raw in allowed:
        return raw
    if raw not in _warned_modes:
        _warned_modes.add(raw)
        log.warning("[ai-population-cap] %s=%r is not one of %s; treating it as "
                    "'shadow' (never blocks, never silent)", FLAG, raw, allowed)
    return MODE_SHADOW


def daily_cap() -> int:
    """Read PER CALL. Unparseable or negative falls back to the default."""
    raw = os.environ.get(CAP_ENV, str(DEFAULT_DAILY_CAP))
    try:
        cap = int(str(raw).strip())
    except (TypeError, ValueError):
        return DEFAULT_DAILY_CAP
    return cap if cap >= 0 else DEFAULT_DAILY_CAP


def et_day() -> str:
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/New_York")).strftime("%Y-%m-%d")
    except Exception:  # noqa: BLE001 -- no tzdata: a fixed -4h is close enough for a key
        return (datetime.now(timezone.utc) - timedelta(hours=4)).strftime("%Y-%m-%d")


def _log_would_cap(door: str, day: str, cap: int) -> None:
    key = (door, day)
    with _log_lock:
        if key in _would_cap_logged:
            return
        _would_cap_logged.add(key)
    log.warning("[ai-population-cap] would-cap mode=shadow door=%s day=%s cap=%d "
                "(admitted: shadow never blocks)", door, day, cap)


def admit(door: str, *, day: str | None = None) -> str | None:
    """Count one member AI request for `door` against the population's day.

    -> None when the request may proceed (always, in off and shadow; and on a
    database error, which fails open), or `REFUSAL_SENTENCE` when enforce
    refuses it (nothing counted). The caller has ALREADY taken its own
    per-member reservation and must give it back on a refusal."""
    m = mode()
    if m == MODE_OFF:
        return None
    day = day or et_day()
    cap = daily_cap()
    refused = daily_counters.take(day, [daily_counters.Charge(SCOPE, daily_counters.GLOBAL, 1, cap)])
    if refused is None:
        return None
    if m == MODE_ENFORCE:
        log.warning("[ai-population-cap] capped mode=enforce door=%s day=%s cap=%d", door, day, cap)
        return REFUSAL_SENTENCE
    # shadow: count the real demand anyway, say so once, never block
    daily_counters.take(day, [daily_counters.Charge(SCOPE, daily_counters.GLOBAL, 1, None)])
    _log_would_cap(door, day, cap)
    return None


def snapshot(*, day: str | None = None) -> dict:
    """What the meter shows: the mode, and -- when a mode is on -- the day's
    count against the cap, or `readable: False` when the store cannot be read
    (the cap is then failing OPEN, and the meter says so)."""
    m = mode()
    if m == MODE_OFF:
        return {"mode": m}
    day = day or et_day()
    used = daily_counters.read(day, SCOPE, daily_counters.GLOBAL)
    cap = daily_cap()
    if used is None:
        return {"mode": m, "readable": False, "limit": cap}
    return {"mode": m, "readable": True, "used": int(used), "limit": cap,
            "reached": used >= cap}


def _reset_for_tests() -> None:
    with _log_lock:
        _would_cap_logged.clear()
    _warned_modes.clear()
