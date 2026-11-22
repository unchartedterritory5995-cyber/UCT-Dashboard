"""MD-1 kind `stock.setups` (owner: terminal-data, data wave 7) — one stock's confirmed setups, as stored.

The setups UCT's chart judge confirmed on a stock's daily chart, as the Technical read panel (TECH) lists them: each
setup's name, the daily bar it was judged on, the judge's confidence and the key level stored with it, newest bar
first, with how many setups were judged in the same window: the Agent half of TECH's confirmed list, over the
confirmed branch of `GET /api/patterns/{sym}` (`api/routers/patterns.py`, `api/services/pattern_vision/store.py`).

⛔ ONLY THE STORED VERDICTS, NEVER A DETECTION RUN AND NEVER A VISION CALL (MD-1 §5). Verdicts are written by a
background job; nothing here runs a detector, renders a chart or asks a model. This adapter reads the store's own
three readers (`get_confirmed`, `count_evaluated`, `last_judged_at`) and nothing else: it does not create the store
(the route calls `init_db`; a read of this kind never does). provider_calls is always 0.

THE MEMBER'S RULES, EXACTLY: the store's own window (a verdict on a bar older than `CONFIRMED_MAX_AGE_DAYS` is not
served, and a setup rejected on a newer bar is not served from an older confirm), the route's default confidence
floor (`MIN_CONFIDENCE`), and the internal setups dropped as for every member (`drop_internal`), whoever asks.

NOT JUDGED IS NOT "NO SETUP": a stock with no verdict of either kind in the window is `unavailable` (nothing was
looked at); a stock judged with none confirmed is a healthy answer with no rows and the count of setups judged.

WHAT IS LEFT OUT, AND SAID: the judge's written rationale and its list of checks are not carried; each row keeps the
count of checks passed and the count made. A level or a confidence that is not stored is null, never 0.

THE CUT IS STATED: at most `rows` setups are returned, newest bar first; a longer list is cut from the OLD end and
the note says so.

TIME (MD-1 §3): `as_of` = the newest daily bar a returned setup was judged on, as the start of that Eastern day; when
none is confirmed it is the day the judge last ran. Never today's date as such and never the time of the read. When
the judge last ran rides as `data.judged_at`. The read is `stale`, with a note, when that bar is older than the
newest completed session. Every read is `historical`; the kind is DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the licensing register
(docs/terminal-research/09-security-licensing-cost/licensing-register.md) row T-11 covers the pattern engine and
the other analytics derived from the vendor's bars as restricted, and row T-14 is the vendor's numbers into a model,
restricted. Neither clears a verdict about the vendor's bars for a model provider, and no other row does. Shown to
the member only; the capability is local-only.
"""
from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import sessions
from api.services.uct_agent.marketdata.bars_daily import _SYMBOL_RE
from api.services.uct_agent.marketdata.short_interest import _day, _num, day_as_of

KIND = "stock.setups"
SOURCE = "uct-setup-verdicts"
TF = "D"                    # the daily chart: the timeframe the Technical read panel reads
DEFAULT_ROWS = 10
MAX_ROWS = 25
#: the route's own default floor on the judge's confidence (`min_conf`; a rail pins the two together)
MIN_CONFIDENCE = 50.0
_ET = ZoneInfo("America/New_York")

NOTE_WHAT = ("the setups UCT's chart judge confirmed on {symbol}'s daily chart, as stored: the setup, the daily bar "
             "it was judged on, the judge's confidence and the key level stored with it. Stored verdicts only: no "
             "detection and no chart reading is run for this read. A record of what the judge confirmed, not a "
             "forecast and not advice")
NOTE_AS_OF = ("`as_of` is the newest daily bar a setup here was judged on ({day}); it is never the time of the "
              "read. The judge last ran on this stock at {at} (UCT's own time)")
NOTE_NONE_CONFIRMED = ("{evaluated} setups were judged on {symbol} in the window and none is confirmed. `as_of` is "
                       "the day the judge last ran ({day}), at {at} (UCT's own time)")
NOTE_WINDOW = ("only verdicts on a daily bar from the last {days} days are served, and a setup rejected on a newer "
               "bar is not served from an older one; {evaluated} setups were judged in that window")
NOTE_CUT = ("{total} setups are confirmed and the newest {shown} are returned, newest bar first: the list is cut "
            "from the OLD end")
NOTE_LEFT_OUT = ("the judge's written reasons and its list of checks are left out of this read: each row keeps the "
                 "count of checks passed and made. The Technical read panel (TECH) in UCT shows them")
NOTE_MISSING = ("{n} of the setups returned have no key level stored and that level is null, never 0")
NOTE_STALE = ("the newest bar judged is {day}, older than the newest completed session ({expected}). This read "
              "never runs the judge: it runs on UCT's own schedule")
NOTE_NOT_JUDGED = ("no setup was judged on {symbol} in the last {days} days, so nothing is stored to read. That is "
                   "not the same as no setup. This read never runs a detection or reads a chart")
NOTE_NOT_HELD = ("the setup verdict store is not on this server, and this read never creates it. That is not the "
                 "same as no setup")
NOTE_FAILED = "the setups read failed; nothing is stated. That is not the same as no setup"


def _clean(v: Any) -> Optional[str]:
    s = v.strip().upper().lstrip("$") if isinstance(v, str) else ""
    return s if s and _SYMBOL_RE.match(s) else None


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    if not isinstance(params, dict):
        return "the request must be an object"
    if _clean(params.get("symbol")) is None:
        return "`symbol` must be one US stock or fund ticker"
    n = params.get("rows", DEFAULT_ROWS)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_ROWS:
        return f"`rows` must be a whole number from 1 to {MAX_ROWS}"
    return None


def held_answer(sym: str) -> Optional[tuple[list, int, Optional[int], int]]:
    """(the member's confirmed verdicts, how many setups were judged, when the judge last ran, the window in days)
    from the verdict store, or None when the store is not on this server. READ ONLY: it never creates the store,
    never runs a detection and never asks a model."""
    from api.services.pattern_engine.detectors import registry
    from api.services.pattern_vision import store
    if not os.path.exists(store.get_db_path()):
        return None
    try:
        verdicts = store.get_confirmed(sym, TF)
        evaluated = store.count_evaluated(sym, TF)
        judged = store.last_judged_at(sym, TF)
    except sqlite3.OperationalError:                           # a file with no verdict table: nothing is stored
        return None
    verdicts = [v for v in verdicts if float(v.get("vision_confidence") or 0.0) >= MIN_CONFIDENCE]
    verdicts = registry.drop_internal(verdicts, key="setup")   # the member's rule, whoever asks
    return verdicts, int(evaluated or 0), judged, int(store.CONFIRMED_MAX_AGE_DAYS)


def setup_name(setup_id: Any) -> Optional[str]:
    """The member-facing name of a setup, from the route's one metadata table; None when it has no entry."""
    from api.routers import patterns
    name = (patterns._PATTERN_METADATA.get(setup_id or "") or {}).get("name")
    return name if isinstance(name, str) and name else None


def _checks(v: Any) -> tuple[Optional[int], Optional[int]]:
    if not isinstance(v, list) or not v:
        return None, None
    made = [c for c in v if isinstance(c, dict) and isinstance(c.get("passed"), bool)]
    return (sum(1 for c in made if c["passed"]), len(made)) if made else (None, None)


def _row(v: Any) -> Optional[dict]:
    if not isinstance(v, dict) or not isinstance(v.get("setup"), str) or not v["setup"] or _day(v.get("asof_date")) is None:
        return None
    passed, made = _checks(v.get("checks"))
    return {"setup": v["setup"], "name": setup_name(v["setup"]), "asof_date": _day(v["asof_date"]),
            "confidence": _num(v.get("vision_confidence")), "key_level": _num(v.get("key_level")),   # null, never 0
            "checks_passed": passed, "checks_made": made}


def read_setups(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    sym, limit = _clean(params["symbol"]), params.get("rows", DEFAULT_ROWS)
    try:
        got = held_answer(sym)                                 # the stored verdicts only
        expected = sessions.last_completed_session()
        if got is None:
            return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD)
        verdicts, evaluated, judged, window = got
        if evaluated <= 0 or judged is None:
            return env.unavailable(KIND, params, SOURCE, NOTE_NOT_JUDGED.format(symbol=sym, days=window))
        rows = [x for x in (_row(v) for v in verdicts) if x]
        judged_dt = datetime.fromtimestamp(int(judged), tz=timezone.utc)
    except Exception:  # noqa: BLE001 — a failing read is an honest unavailable, never "no setup"
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    judged_at = env.utc_iso(judged_dt)
    total, shown = len(rows), rows[:limit]
    expected_day = f"{expected // 10000:04d}-{expected // 100 % 100:02d}-{expected % 100:02d}"

    notes = [NOTE_WHAT.format(symbol=sym)]
    if shown:
        day = shown[0]["asof_date"]
        notes.append(NOTE_AS_OF.format(day=day, at=judged_at))
    else:
        day = judged_dt.astimezone(_ET).strftime("%Y-%m-%d")
        notes.append(NOTE_NONE_CONFIRMED.format(evaluated=evaluated, symbol=sym, day=day, at=judged_at))
    notes.append(NOTE_WINDOW.format(days=window, evaluated=evaluated))
    if total > len(shown):
        notes.append(NOTE_CUT.format(total=total, shown=len(shown)))
    if shown:
        notes.append(NOTE_LEFT_OUT)
    no_level = sum(1 for r in shown if r["key_level"] is None)
    if no_level:
        notes.append(NOTE_MISSING.format(n=no_level))
    stale = bool(shown) and day < expected_day
    if stale:
        notes.append(NOTE_STALE.format(day=day, expected=expected_day))

    data = {"symbol": sym, "tf": TF, "rows": shown, "count": len(shown), "confirmed_total": total,
            "cut": total > len(shown), "evaluated": evaluated, "window_days": window, "min_confidence": MIN_CONFIDENCE,
            "as_of": day, "judged_at": judged_at, "expected_session": expected_day,
            "left_out": ["rationale", "checks"]}
    coverage = {"evaluated": evaluated, "answered": len(shown), "dropped": total - len(shown),
                "not_computable": no_level}
    return env.make_envelope(KIND, params, status="ok", freshness="historical", as_of=day_as_of(day), source=SOURCE,
                             data=data, stale=stale, coverage=coverage, notes=notes, provider_calls=0)
