"""The Pine runtime lane's STOP telemetry -- Phase 3 WS-H, arming item S8.

Before this, a member's runtime pane that stopped (over its 1,000 ms budget, past
a named VM limit, a worker that hung or died) said so only on that member's own
disclosure strip: the operator could not see that a script was stopping without
reading somebody's screen. This is a counted beacon, one row per stop:

    guard    which stop, from the closed set `STOP_GUARDS`
    limit    for `runtime:limit`, which named limit, from `LIMIT_NAMES`
    hash     the first 12 hex characters of the script's sha256 -- the same
             prefix the kill list and the allowlist already print
    bars     how many bars the run was handed
    ms       how long it ran, in whole milliseconds
    lane     where it ran: the worker, or this thread where no worker exists

⛔⛔ NO MEMBER SOURCE AND NO MEMBER ID. The source never leaves the browser (only
its hash prefix does), and the row's `visitor_id` is the constant `VISITOR`, not
the member's id: the operator's question is "which scripts stop, how, how often",
and no part of it needs to know who. That is strictly less than
`indicator_telemetry.py` stores.

⛔ THE SAME ALLOWLIST DISCIPLINE AS `indicator_telemetry.EVENT_SCHEMAS`: every
field has a type AND a closed value set or a strict pattern, an unknown field is
REJECTED (422, `extra="forbid"`), and no value is free-form text. There is no
`message` field on purpose: a stop's sentence can quote the script.

⭐ THE CLOSED SETS ARE PINNED TO THEIR SOURCES by
`tests/test_pine_runtime_stop_telemetry.py`, which parses `limits.js` and the
guard constants in the client rather than restating them, so a new limit or stop
guard on the client cannot be silently refused here.

Storage is `landing_events` (the table `indicator_telemetry` already writes),
bounded by TWO durable daily caps in `daily_counters`, taken together or not at
all: a global one (subject GLOBAL) and a per-member one, so one member posting
directly cannot fill the day for everyone. ⛔ The per-member counter's subject is
a KEYED HASH of the member id (`member_subject`: HMAC-SHA256 under `PUSH_SECRET`,
this module's own domain, the `indicator_support.member_key` pattern), never the
id itself, and it is pruned within two ET days like every counter row; the
`landing_events` row carries no member identity at all. Over either cap a beacon
is answered and not stored.

⚠️ PSEUDONYMOUS, NOT ANONYMOUS: the hash prefix names a SCRIPT, and an operator
holding the stored runtime definitions can join it to them (and so to their
owners). It carries no member id, but it is not unlinkable.
Never raises into the caller: a telemetry failure must never break anything.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from api.middleware.auth_middleware import get_current_user, require_admin
from api.services import daily_counters
from api.services.auth_db import get_connection

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/pine-runtime-telemetry", tags=["pine-runtime-telemetry"])

EVENT = "pine_runtime_stop"
VISITOR = "pine-runtime"          # ⛔ never a member id
SCOPE = "pine_runtime_stop"
DAILY_CAP = 5000                  # global, per ET day
MEMBER_DAILY_CAP = 200            # per member, per ET day
_MEMBER_DOMAIN = b"pine-runtime-stop:v1|"
_DEV_FALLBACK_SECRET = b"uct-pine-runtime-stop-dev-salt"


def member_subject(user_id: Any) -> str:
    """The per-member counter's subject: a keyed hash, never the id. `PUSH_SECRET`
    (the server secret `indicator_support.member_key` keys with), or a fixed dev
    salt where it is unset (a local box)."""
    secret = (os.environ.get("PUSH_SECRET") or "").strip().encode("utf-8") or _DEV_FALLBACK_SECRET
    return "m:" + hmac.new(secret, _MEMBER_DOMAIN + str(user_id).encode("utf-8"), hashlib.sha256).hexdigest()[:32]

#: The stops arming item S3 names (`PHASE3-RUNTIME-PLAN.md` 4.1). A refusal
#: (killed, not yet graded, a construct the lane cannot mean) is not a stop.
STOP_GUARDS = frozenset({
    "runtime:time-budget", "runtime:limit", "runtime:failed",
    "runtime:worker-unresponsive", "runtime:worker-failed", "runtime:load-failed",
})

#: `limits.js` `LIMIT_NAMES` -- pinned against that file by the test.
LIMIT_NAMES = frozenset({
    "PROGRAM_SIZE", "IR_SIZE", "INSTRUCTIONS_PER_BAR", "TOTAL_INSTRUCTIONS",
    "LOOP_ITERATIONS", "WHILE_ITERATIONS", "LOOP_NESTING", "CALL_DEPTH", "CALL_COUNT",
    "ARRAY_ELEMENTS", "ARRAY_OPERATIONS", "LIVE_OBJECTS", "OBJECT_OPERATIONS", "HISTORY",
    "HISTORY_SLOTS", "HISTORY_VALUES", "WINDOW_CELLS", "CARRIED_INSTANCES", "CARRIED_CELLS",
    "CARRIED_STEPS", "REQUEST_COUNT", "REQUEST_FANOUT", "MEMORY", "WALL_TIME",
})

_HASH_PATTERN = r"^[0-9a-f]{12}$"


class StopBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    guard: str = Field(..., max_length=40)
    limit: Optional[str] = Field(default=None, max_length=40)
    hash: str = Field(..., pattern=_HASH_PATTERN)
    bars: int = Field(..., ge=0, le=1_000_000, strict=True)
    ms: int = Field(..., ge=0, le=600_000, strict=True)
    lane: Literal["worker", "main"]

    def violation(self) -> Optional[str]:
        if self.guard not in STOP_GUARDS:
            return "guard is not a runtime stop"
        if self.limit is not None:
            if self.guard != "runtime:limit":
                return "limit is carried only by runtime:limit"
            if self.limit not in LIMIT_NAMES:
                return "limit is not a declared runtime limit"
        return None


def _et_day() -> str:
    return datetime.now(ZoneInfo("America/New_York")).date().isoformat()


def record_stop(body: StopBody, user_id: Any = None) -> bool:
    """Store one stop. True when a row was written. Never raises."""
    if body.violation() is not None:
        return False
    try:
        charges = [daily_counters.Charge(SCOPE, daily_counters.GLOBAL, 1, DAILY_CAP)]
        if user_id is not None:
            charges.insert(0, daily_counters.Charge(SCOPE, member_subject(user_id), 1, MEMBER_DAILY_CAP))
        refused = daily_counters.take(_et_day(), charges)
    except Exception:  # noqa: BLE001
        refused = None
    if refused is not None:
        return False
    props = {"guard": body.guard, "hash": body.hash, "bars": body.bars, "ms": body.ms, "lane": body.lane}
    if body.limit is not None:
        props["limit"] = body.limit
    try:
        conn = get_connection()
    except Exception:  # noqa: BLE001
        log.exception("[pine-runtime-telemetry] no connection")
        return False
    try:
        conn.execute("INSERT INTO landing_events (visitor_id, event, props) VALUES (?, ?, ?)",
                     (VISITOR, EVENT, json.dumps(props, separators=(",", ":"), sort_keys=True)))
        conn.commit()
        return True
    except Exception:  # noqa: BLE001
        log.exception("[pine-runtime-telemetry] write failed")
        return False
    finally:
        conn.close()


@router.post("/stop")
def stop(body: StopBody, user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """⛔ Signed in (an open write door would let anybody fill the day's cap).
    The member's id is read only to key the per-member cap, as a keyed hash; it
    is stored nowhere."""
    reason = body.violation()
    if reason is not None:
        return {"ok": False, "logged": False, "reason": reason}
    return {"ok": True, "logged": record_stop(body, user.get("id"))}


def _pct(values: list, q: float):
    if not values:
        return None
    v = sorted(values)
    return v[min(len(v) - 1, max(0, int(round(q * (len(v) - 1)))))]


def stop_report(days: int = 7) -> dict[str, Any]:
    """Aggregates only: stops by guard (and limit), and by script hash prefix."""
    days = max(1, min(int(days), 30))
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
    try:
        conn = get_connection()
    except Exception:  # noqa: BLE001
        return {"days": days, "stops": 0, "by_guard": {}, "by_script": []}
    try:
        rows = conn.execute(
            "SELECT props FROM landing_events WHERE event = ? AND visitor_id = ? AND created_at >= ?",
            (EVENT, VISITOR, since)).fetchall()
    except Exception:  # noqa: BLE001
        log.exception("[pine-runtime-telemetry] report read failed")
        rows = []
    finally:
        conn.close()
    by_guard: dict = {}
    scripts: dict = {}
    for (raw,) in rows:
        try:
            p = json.loads(raw or "{}")
        except (TypeError, ValueError):
            continue
        key = p.get("guard") if not p.get("limit") else f"{p.get('guard')}:{p.get('limit')}"
        by_guard[key] = by_guard.get(key, 0) + 1
        cell = scripts.setdefault(p.get("hash"), {"hash": p.get("hash"), "stops": 0, "guards": {}, "ms": [], "bars": []})
        cell["stops"] += 1
        cell["guards"][key] = cell["guards"].get(key, 0) + 1
        if isinstance(p.get("ms"), int):
            cell["ms"].append(p["ms"])
        if isinstance(p.get("bars"), int):
            cell["bars"].append(p["bars"])
    by_script = []
    for cell in sorted(scripts.values(), key=lambda c: -c["stops"]):
        by_script.append({"hash": cell["hash"], "stops": cell["stops"], "guards": cell["guards"],
                          "ms_p50": _pct(cell["ms"], 0.5), "ms_p95": _pct(cell["ms"], 0.95),
                          "bars_max": max(cell["bars"]) if cell["bars"] else None})
    return {"days": days, "stops": sum(by_guard.values()),
            "by_guard": dict(sorted(by_guard.items(), key=lambda kv: -kv[1])), "by_script": by_script}


@router.get("/stops")
def stops(days: int = 7, user: dict = Depends(require_admin)) -> dict[str, Any]:
    """The operator's read. ADMIN ONLY."""
    return stop_report(days)
